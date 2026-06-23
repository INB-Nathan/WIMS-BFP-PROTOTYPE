"""
Email verification routes for self-service email changes.

POST /api/auth/change-email — Step 1: verify password, store pending email + code, send verification email
POST /api/auth/verify-email — Step 2: verify code, update email in Keycloak and DB
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
from typing import Annotated, Optional

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr
from keycloak import KeycloakOpenID
from keycloak.exceptions import KeycloakError

from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_current_wims_user, get_db_with_rls
from database import get_db
from utils.audit import log_system_audit, trusted_client_ip
from services.email.sender import send_email_async
from services.keycloak_admin import (
    _KC_BASE_URL,
    _KC_REALM,
    _get_admin_client,
    update_user_profile,
)

logger = logging.getLogger("wims.email_verify")

router = APIRouter(prefix="/api/auth", tags=["email-verification"])

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
VERIFICATION_CODE_TTL = 600  # 10 minutes

# Rate-limit windows (per user)
CHANGE_EMAIL_RATE_LIMIT = 3  # max requests per window
CHANGE_EMAIL_RATE_WINDOW = 600  # seconds (10 min)
VERIFY_EMAIL_RATE_LIMIT = 5  # max code attempts per window
VERIFY_EMAIL_RATE_WINDOW = 600  # seconds (10 min)

_redis: aioredis.Redis | None = None
_redis_lock = asyncio.Lock()


async def _get_redis() -> aioredis.Redis | None:
    """Return a shared async Redis connection, or None if unavailable.

    Uses a module-level asyncio.Lock to guard initialization so that
    concurrent coroutines do not race on _redis and orphan connections.
    Cached connections are pinged before reuse so a Redis restart can recover
    without waiting for a process restart.
    """
    global _redis
    if _redis is not None:
        try:
            await _redis.ping()
            return _redis
        except Exception:
            logger.warning("Cached Redis connection unavailable; reconnecting")
            _redis = None
    async with _redis_lock:
        if _redis is not None:  # double-check after acquiring lock
            try:
                await _redis.ping()
                return _redis
            except Exception:
                logger.warning("Cached Redis connection unavailable after lock; reconnecting")
                _redis = None
        try:
            _redis = aioredis.from_url(REDIS_URL, decode_responses=True, health_check_interval=30)
            await _redis.ping()
        except Exception:
            logger.warning("Redis unavailable for email verification at %s", REDIS_URL)
            _redis = None
    return _redis


async def _check_rate_limit(
    r: aioredis.Redis, key: str, max_requests: int, window_seconds: int
) -> None:
    """Increment a rate-limit counter in Redis; raise HTTPException(429) if exceeded."""
    try:
        current = await r.incr(key)
        if current == 1:
            await r.expire(key, window_seconds)
        if current > max_requests:
            ttl = await r.ttl(key) or window_seconds
            raise HTTPException(
                status_code=429,
                detail=f"Too many requests. Try again in {ttl} seconds.",
            )
    except HTTPException:
        raise
    except Exception:
        logger.warning("Rate-limit check failed for key %s; allowing request", key)


def _generate_code() -> str:
    """Generate a cryptographically random 6-digit verification code."""
    return f"{secrets.randbelow(1000000):06d}"


# ── Schemas ───────────────────────────────────────────────────────────────────


class ChangeEmailRequest(BaseModel):
    new_email: EmailStr
    current_password: str
    otp_code: Optional[str] = None  # Required if user has TOTP/2FA enrolled


class VerifyEmailRequest(BaseModel):
    code: str


# ── Helpers ───────────────────────────────────────────────────────────────────


def _verify_password(
    current_user: dict, current_password: str, otp_code: Optional[str] = None
) -> str:
    """Verify the user's current password against Keycloak.

    Returns the resolved Keycloak username on success; raises HTTPException on failure.

    When *otp_code* is provided it is passed as the ``totp`` parameter to
    Keycloak's Direct Grant token endpoint so that users with TOTP configured
    can still verify their password (see #243).
    """
    keycloak_id = current_user["keycloak_id"]

    try:
        adm = _get_admin_client()
        kc_user_data = adm.get_user(keycloak_id)
        target_username = (
            kc_user_data.get("username")
            or current_user.get("kc_username")
            or current_user["username"]
        )
    except KeycloakError:
        # Fall back to username from current-user dict when Keycloak admin
        # API is unavailable; password verification will still proceed
        # but the admin can see the real auth error instead of a masked one.
        target_username = current_user.get("kc_username") or current_user["username"]

    kc_openid = KeycloakOpenID(
        server_url=_KC_BASE_URL,
        realm_name=_KC_REALM,
        client_id="bfp-client",
        verify=True,
    )
    try:
        token_kwargs: dict[str, str] = {}
        if otp_code:
            token_kwargs["totp"] = otp_code
        kc_openid.token(username=target_username, password=current_password, **token_kwargs)
    except KeycloakError as e:
        logger.warning("Email change verification failed for %s: %s", keycloak_id, e)
        raise HTTPException(status_code=401, detail="Incorrect current password or OTP code")

    return target_username


# ── Routes ────────────────────────────────────────────────────────────────────


@router.post("/change-email")
async def change_email(
    body: ChangeEmailRequest,
    current_user: Annotated[dict, Depends(get_current_wims_user)],
):
    """
    Step 1: Initiate email change.

    Verifies current password, stores pending email + 6-digit verification code
    in Redis with a 10-minute TTL, and sends the code to the new email address.
    """
    r = await _get_redis()
    if r is None:
        raise HTTPException(
            status_code=503,
            detail="Email verification is temporarily unavailable. Try again later.",
        )

    user_id = current_user["user_id"]
    username = current_user.get("username", "user")

    # Rate-limit: prevent email bombing and password brute-force
    await _check_rate_limit(
        r,
        f"rate:change_email:{user_id}",
        CHANGE_EMAIL_RATE_LIMIT,
        CHANGE_EMAIL_RATE_WINDOW,
    )

    # Verify current password
    if not body.current_password or not body.current_password.strip():
        raise HTTPException(
            status_code=400,
            detail="Current password is required to change email/login identity",
        )
    _verify_password(current_user, body.current_password, otp_code=body.otp_code)

    # Generate code and store in Redis
    code = _generate_code()
    redis_key = f"email_verify:{user_id}"
    payload = json.dumps({"pending_email": body.new_email, "code": code})

    await r.setex(redis_key, VERIFICATION_CODE_TTL, payload)

    # Send verification email
    try:
        await send_email_async(
            to=body.new_email,
            template_name="email_verification",
            context={
                "username": username,
                "pending_email": body.new_email,
                "code": code,
            },
        )
    except Exception as e:
        logger.error("Failed to send verification email to %s: %s", body.new_email, e)
        # Clean up Redis key so user can retry
        await r.delete(redis_key)
        raise HTTPException(
            status_code=502,
            detail="Failed to send verification email. Try again later.",
        )

    logger.info(
        "Email verification code sent to %s for user %s (keycloak_id=%s)",
        body.new_email,
        user_id,
        current_user["keycloak_id"],
    )

    return {
        "status": "ok",
        "message": f"Verification code sent to {body.new_email}. Code expires in 10 minutes.",
    }


@router.post("/verify-email")
async def verify_email(
    body: VerifyEmailRequest,
    current_user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """
    Step 2: Confirm email change.

    Verifies the 6-digit code against the pending change stored in Redis.
    On success, updates the email in both Keycloak and the wims.users database.
    """
    r = await _get_redis()
    if r is None:
        raise HTTPException(
            status_code=503,
            detail="Email verification is temporarily unavailable. Try again later.",
        )

    user_id = current_user["user_id"]
    keycloak_id = current_user["keycloak_id"]
    redis_key = f"email_verify:{user_id}"

    # Rate-limit: prevent brute-force code attempts
    await _check_rate_limit(
        r,
        f"rate:verify_email:{user_id}",
        VERIFY_EMAIL_RATE_LIMIT,
        VERIFY_EMAIL_RATE_WINDOW,
    )

    # Check for whitespace-only or empty code
    if not body.code or not body.code.strip():
        raise HTTPException(status_code=400, detail="Verification code is required")

    code = body.code.strip()

    # Retrieve and verify
    raw = await r.get(redis_key)
    if raw is None:
        raise HTTPException(
            status_code=404,
            detail="No pending email change found. The code may have expired or already been used.",
        )

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        await r.delete(redis_key)
        raise HTTPException(status_code=500, detail="Invalid verification state")

    pending_email = data.get("pending_email")
    stored_code = data.get("code")

    if not pending_email or not stored_code:
        await r.delete(redis_key)
        raise HTTPException(status_code=500, detail="Invalid verification state")

    if code != stored_code:
        logger.warning(
            "Email verification code mismatch for user %s (expected=%s, got=%s)",
            user_id,
            stored_code,
            code,
        )
        raise HTTPException(
            status_code=400,
            detail="Invalid verification code. Please check and try again.",
        )

    # Code matches — update email in Keycloak
    try:
        update_user_profile(keycloak_id, email=pending_email)
    except KeycloakError as e:
        logger.error("Keycloak email update failed for %s: %s", keycloak_id, e)
        raise HTTPException(
            status_code=502,
            detail="Failed to update email in identity provider. Try again later.",
        )

    # Update DB
    db_sync_failed = False
    try:
        db.execute(
            text(
                "UPDATE wims.users SET email = :eml, username = :uname, updated_at = now() WHERE user_id = :uid"
            ),
            {"eml": pending_email, "uname": pending_email, "uid": user_id},
        )
        db.commit()
    except Exception:
        db.rollback()
        db_sync_failed = True
        logger.exception("DB email sync failed for user %s after Keycloak update", user_id)

    # Clean up Redis
    await r.delete(redis_key)

    logger.info(
        "Email changed to %s for user %s (keycloak_id=%s)",
        pending_email,
        user_id,
        keycloak_id,
    )

    if db_sync_failed:
        return {
            "status": "partial",
            "message": f"Email changed to {pending_email} in identity provider, but database sync failed. Contact support if your email is missing from your profile.",
        }
    return {"status": "ok", "message": f"Email successfully changed to {pending_email}."}


# ── Auth-lifecycle audit (RP-08, RP-18, RP-19) ────────────────────────────────
# Authentication is delegated to Keycloak, so failed logins, self-service
# password resets, and logouts happen inside Keycloak and never reach the WIMS
# backend. The frontend reports these events here so they land in
# wims.system_audit_trails and the user cannot deny them. The event is recorded
# with the trusted client IP (X-Real-IP / socket peer) and the supplied
# username; user_id is left NULL when it cannot be resolved without leaking
# whether an account exists.

# Map of client-reportable event -> default audit result tag.
_AUTH_EVENT_RESULTS = {
    "FAILED_LOGIN": "failure",
    "PASSWORD_RESET": "success",
    "LOGOUT": "success",
}

# Per-IP cap on client-reported events to keep this public endpoint from being
# used to flood the audit trail.
SECURITY_EVENT_RATE_LIMIT = 30
SECURITY_EVENT_RATE_WINDOW = 60


class SecurityEventRequest(BaseModel):
    event_type: str
    username: Optional[str] = None


@router.post("/security-event", status_code=202)
async def record_security_event(
    body: SecurityEventRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    """Record a client-reported authentication-lifecycle event in the audit trail.

    Called by the frontend on Keycloak failed login (FAILED_LOGIN), forgot-password
    initiation (PASSWORD_RESET), and client logout (LOGOUT). Public — Keycloak owns
    the credential check; this only writes a non-repudiation record.
    """
    event_type = (body.event_type or "").upper().strip()
    if event_type not in _AUTH_EVENT_RESULTS:
        raise HTTPException(status_code=422, detail="Unsupported event_type")

    # Light per-IP rate limit so the endpoint can't be used to flood audit rows.
    r = await _get_redis()
    if r is not None:
        ip_for_key = trusted_client_ip(request)
        await _check_rate_limit(
            r,
            f"rate:sec_event:{ip_for_key}",
            SECURITY_EVENT_RATE_LIMIT,
            SECURITY_EVENT_RATE_WINDOW,
        )

    username = (body.username or "").strip()[:255] or None
    log_system_audit(
        db,
        None,  # user_id left NULL — username is captured below without an RLS-gated lookup
        event_type,
        "wims.users",
        None,
        request,
        new_values={"username": username, "reported_by": "client"},
        result=_AUTH_EVENT_RESULTS[event_type],
    )
    db.commit()
    return {"status": "recorded", "event_type": event_type}
