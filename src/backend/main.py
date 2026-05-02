"""
Backend Foundation — FastAPI + Redis Sliding Window Rate Limiter.

Rate-limit key : rate_limit:{client_ip}
Window         : 900 s (15 minutes)
Threshold      : 5 requests per window
Atomicity      : Lua script executed via redis.eval
"""

from __future__ import annotations

import logging
from typing import Annotated
import os
import time
import tasks.suricata  # noqa: F401, E402
import tasks.exports  # noqa: F401, E402
import httpx
import redis.asyncio as aioredis
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session


import auth
from auth import get_current_user
from database import get_db

from api.routes import incidents, admin, civilian, triage, regional, analytics, ref
from api.routes.public_dmz import router as public_dmz_router
from api.routes.user import router as user_profile_router

# WIMS roles in precedence order (highest first). Used when resolving from Keycloak JWT.
WIMS_ROLES_FROM_KEYCLOAK = (
    "CIVILIAN_REPORTER",
    "REGIONAL_ENCODER",
    "NATIONAL_VALIDATOR",
    "NATIONAL_ANALYST",
    "SYSTEM_ADMIN",
)


def _resolve_role_from_token(payload: dict) -> str:
    """
    Extract WIMS role from Keycloak JWT. realm_access.roles or resource_access.<client>.roles.
    Returns ONLY roles in WIMS_ROLES_FROM_KEYCLOAK (exact FRS literals).
    Returns None if no FRS role is present in the token — callers must handle this.
    """
    roles: list[str] = []
    if isinstance(payload.get("realm_access"), dict):
        ra = payload["realm_access"].get("roles")
        if isinstance(ra, list):
            roles.extend(ra)
    if isinstance(payload.get("resource_access"), dict):
        for cid, client_data in payload["resource_access"].items():
            if isinstance(client_data, dict) and isinstance(
                client_data.get("roles"), list
            ):
                roles.extend(client_data["roles"])
    for wims_role in WIMS_ROLES_FROM_KEYCLOAK:
        if wims_role in roles:
            return wims_role
    return None  # No FRS role found — do not silently default


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="WIMS-BFP Backend")
app.include_router(incidents.router)
app.include_router(admin.router, prefix="/api/admin")
app.include_router(
    user_profile_router
)  # PATCH /api/user/me, PATCH /api/user/me/password
app.include_router(civilian.router)
app.include_router(triage.router)
app.include_router(regional.router)
app.include_router(analytics.router)
app.include_router(
    ref.router
)  # GET /api/ref/regions, /api/ref/provinces, /api/ref/cities
app.include_router(public_dmz_router)  # POST /api/v1/public/report (no-auth DMZ)

logger = logging.getLogger("wims.rate_limit")

# ---------------------------------------------------------------------------
# Celery
# ---------------------------------------------------------------------------

# Re-export for celery CLI: celery -A main.celery_app
# (tasks.suricata and tasks.exports are imported at module top for registration)
from celery_config import celery_app  # noqa: E402, F401

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")

_redis: aioredis.Redis | None = None


async def _get_redis() -> aioredis.Redis | None:
    """Return a shared async Redis connection, or None if unavailable."""
    global _redis
    if _redis is None:
        try:
            _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
            await _redis.ping()
        except Exception:
            logger.warning(
                "Redis unavailable at %s — rate limiting disabled", REDIS_URL
            )
            _redis = None
    return _redis


# ---------------------------------------------------------------------------
# Lua script — fully atomic sliding-window rate limiter
# ---------------------------------------------------------------------------
# KEYS[1] = rate_limit:{ip}
# ARGV[1] = now        (float seconds)
# ARGV[2] = window     (900)
# ARGV[3] = threshold  (5)
#
# Returns:
#   {0}             → allowed  (count < threshold)
#   {1, retry_after} → blocked  (count >= threshold)
RATE_LIMIT_LUA = """
local key       = KEYS[1]
local now       = tonumber(ARGV[1])
local window    = tonumber(ARGV[2])
local threshold = tonumber(ARGV[3])

-- 1. Prune timestamps older than the window
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)

-- 2. Count remaining entries
local count = redis.call('ZCARD', key)

if count >= threshold then
    -- 3a. Blocked: compute Retry-After from oldest entry
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retry_after = 0
    if #oldest > 0 then
        -- oldest[1] is member, oldest[2] is score (timestamp)
        retry_after = math.ceil(tonumber(oldest[2]) + window - now)
        if retry_after < 1 then retry_after = 1 end
    end
    return {1, retry_after}
end

-- 3b. Allowed: record this request and set TTL
redis.call('ZADD', key, now, tostring(now) .. ':' .. tostring(math.random(1, 1000000)))
redis.call('EXPIRE', key, window)
return {0}
"""

WINDOW_SECONDS = 900
RATE_LIMIT_THRESHOLD = 5


# ---------------------------------------------------------------------------
# Rate-limit middleware
# ---------------------------------------------------------------------------
@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Sliding-window rate limiter applied before every request."""
    # Only rate-limit the login endpoint
    if request.url.path != "/api/auth/login" or request.method != "POST":
        return await call_next(request)

    r = await _get_redis()
    if r is None:
        # Redis down → fail open
        return await call_next(request)

    # Resolve client IP from X-Forwarded-For or socket
    client_ip = request.headers.get("x-forwarded-for")
    if client_ip:
        client_ip = client_ip.split(",")[0].strip()
    else:
        client_ip = request.client.host if request.client else "unknown"

    key = f"rate_limit:{client_ip}"
    now = time.time()

    try:
        result = await r.eval(
            RATE_LIMIT_LUA,
            1,
            key,
            str(now),
            str(WINDOW_SECONDS),
            str(RATE_LIMIT_THRESHOLD),
        )
    except Exception:
        logger.warning("Redis eval failed — allowing request through")
        return await call_next(request)

    blocked = int(result[0])
    if blocked:
        retry_after = int(result[1])
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests"},
            headers={"Retry-After": str(retry_after)},
        )

    return await call_next(request)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.post("/api/auth/login")
async def login():
    """Stub login — always rejects with 401 (no auth backend wired yet)."""
    return JSONResponse(
        status_code=401,
        content={"detail": "Invalid credentials"},
    )


# ---------------------------------------------------------------------------
# Auth Callback (PKCE → Keycloak → Identity Sync)
# ---------------------------------------------------------------------------
class AuthCallbackRequest(BaseModel):
    code: str
    code_verifier: str
    redirect_uri: str | None = None


KEYCLOAK_REALM_URL = os.environ.get(
    "KEYCLOAK_REALM_URL",
    os.environ.get("KEYCLOAK_URL", "http://keycloak:8080/auth/realms/bfp"),
)
TOKEN_ENDPOINT = f"{KEYCLOAK_REALM_URL}/protocol/openid-connect/token"
AUTH_REDIRECT_URI = os.environ.get(
    "AUTH_REDIRECT_URI", "http://localhost:3000/auth/callback"
)


@app.post("/api/auth/callback")
async def auth_callback(
    body: AuthCallbackRequest,
    db: Annotated[Session, Depends(get_db)],
):
    """
    PKCE handshake: exchange code + code_verifier with Keycloak.
    Verify JWT, upsert wims.users, return access_token + user_id.
    """
    redirect_uri = body.redirect_uri or AUTH_REDIRECT_URI

    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            TOKEN_ENDPOINT,
            data={
                "grant_type": "authorization_code",
                "code": body.code,
                "code_verifier": body.code_verifier,
                "client_id": auth.CLIENT_ID,
                "redirect_uri": redirect_uri,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if token_resp.status_code != 200:
        raise HTTPException(
            status_code=401,
            detail="Token exchange failed",
        )

    token_data = token_resp.json()
    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=401, detail="No access token in response")

    payload = await auth.authenticator.validate_token(access_token)
    keycloak_sub = payload.get("sub")
    preferred_username = payload.get("preferred_username") or keycloak_sub or "unknown"

    if not keycloak_sub:
        raise HTTPException(status_code=401, detail="Invalid token: missing sub")

    username = preferred_username[:50]
    role = _resolve_role_from_token(payload)
    if role is None:
        raise HTTPException(
            status_code=403,
            detail="No valid WIMS role found in Keycloak token — access denied",
        )

    try:
        result = db.execute(
            text("""
                INSERT INTO wims.users (keycloak_id, username, role)
                VALUES (CAST(:kid AS uuid), :username, :role)
                ON CONFLICT (keycloak_id) DO UPDATE SET
                    username = EXCLUDED.username,
                    role = EXCLUDED.role,
                    last_login = now(),
                    updated_at = now()
                RETURNING user_id
            """),
            {"kid": keycloak_sub, "username": username, "role": role},
        ).fetchone()
        db.commit()
        user_id = result.user_id if result else None
    except Exception:
        db.rollback()
        raise

    if not user_id:
        raise HTTPException(status_code=500, detail="Failed to upsert user")

    return {
        "access_token": access_token,
        "refresh_token": token_data.get("refresh_token"),
        "user_id": str(user_id),
    }


@app.get("/api/user/me")
async def get_me(
    token_payload: Annotated[dict, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Protected route that returns merged JWT + wims.users payload. JIT-provisions user if not in wims.users."""
    keycloak_sub = token_payload.get("sub")
    if not keycloak_sub:
        raise HTTPException(status_code=401, detail="Invalid token: missing sub")

    preferred_username = (
        token_payload.get("preferred_username") or keycloak_sub or "unknown"
    )
    username = preferred_username[:50]

    row = db.execute(
        text("""
            SELECT user_id, username, role, assigned_region_id
            FROM wims.users
            WHERE keycloak_id = CAST(:kid AS uuid) AND is_active = TRUE
        """),
        {"kid": keycloak_sub},
    ).fetchone()

    if row is None:
        role = _resolve_role_from_token(token_payload)
        if role is None:
            raise HTTPException(
                status_code=403,
                detail="No valid WIMS role found in Keycloak token — access denied",
            )
        try:
            result = db.execute(
                text("""
                    INSERT INTO wims.users (keycloak_id, username, role)
                    VALUES (CAST(:kid AS uuid), :username, :role)
                    ON CONFLICT (keycloak_id) DO UPDATE SET
                        username = EXCLUDED.username,
                        role = EXCLUDED.role,
                        last_login = now(),
                        updated_at = now()
                    RETURNING user_id, username, role, assigned_region_id
                """),
                {"kid": keycloak_sub, "username": username, "role": role},
            ).fetchone()
            db.commit()
            row = result
        except Exception:
            db.rollback()
            raise HTTPException(status_code=500, detail="JIT user provisioning failed")

    if row is None:
        raise HTTPException(status_code=500, detail="Failed to upsert user")

    user_id, username, role, assigned_region_id = row
    email = token_payload.get("email") or token_payload.get("preferred_username") or ""

    return {
        "email": email,
        "username": username,
        "role": role,
        "user_id": str(user_id),
        "assigned_region_id": assigned_region_id,
    }
