"""
Backend Foundation — FastAPI + Redis Sliding Window Rate Limiter.

Rate-limit key : rate_limit:{client_ip}
Window         : 900 s (15 minutes)
Threshold      : 5 requests per window
Atomicity      : Lua script executed via redis.eval
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from typing import Annotated
from urllib.parse import urlparse

import httpx
import redis.asyncio as aioredis
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
from sqlalchemy import text
from sqlalchemy.orm import Session

from utils.metrics import (
    API_REQUEST_DURATION,
    SYSTEM_CPU_PERCENT,
    SYSTEM_MEMORY_PERCENT,
    SYSTEM_DISK_PERCENT,
)


import auth
from auth import get_current_user
from database import get_db
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker as _sessionmaker

from api.routes import (
    incidents,
    admin,
    civilian,
    triage,
    regional,
    analytics,
    ref,
    sessions,
    dashboard,
)
from api.routes.public_dmz import router as public_dmz_router
from api.routes.user import router as user_profile_router
from api.routes.map import router as public_map_router, operational_router as validator_map_router
from api.routes.events import router as events_router
from api.routes.geocode import router as geocode_router
from api.routes.operations import router as operations_router
from api.routes.auth import router as auth_router
from api.routes.consent import router as consent_router

# WIMS role resolution — canonical source in auth.py
from auth import resolve_wims_role_from_token as _resolve_role_from_token
from utils.csrf import csrf_middleware

# Module-level logger — must be defined before use in schema patches and rate limiter
logger = logging.getLogger("wims.rate_limit")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="WIMS-BFP Backend")
app.middleware("http")(csrf_middleware)

_schema_patches_attempted = False
_schema_patches_in_progress = False
_schema_patches_lock = threading.Lock()


def _reset_schema_patch_state_for_tests() -> None:
    global _schema_patches_attempted, _schema_patches_in_progress
    with _schema_patches_lock:
        _schema_patches_attempted = False
        _schema_patches_in_progress = False


_STARTUP_ADMIN_URL: str = os.environ.get("DATABASE_ADMIN_URL") or os.environ.get(
    "SQLALCHEMY_DATABASE_URL", os.environ.get("DATABASE_URL", "")
)
_startup_admin_engine = None
_startup_admin_session_factory = None

# Derive wims_app_user password from env rather than hardcoding it in source.
# Priority: explicit WIMS_APP_USER_PASSWORD env var > password embedded in DATABASE_URL.
_APP_USER_PASSWORD: str | None = os.environ.get("WIMS_APP_USER_PASSWORD") or None
if _APP_USER_PASSWORD is None:
    try:
        _parsed_db_url = urlparse(os.environ.get("DATABASE_URL", ""))
        _APP_USER_PASSWORD = _parsed_db_url.password or None
    except Exception:
        pass


def _get_admin_session():
    """Return a superuser session for DDL operations in startup patches.

    The app connects as wims_app_user (non-superuser) so RLS is enforced.
    Schema-level DDL (CREATE RULE, CREATE POLICY, ALTER TABLE) requires
    the table owner or superuser — use DATABASE_ADMIN_URL for those ops.
    Falls back to the regular DATABASE_URL if the admin URL is not set.
    """
    global _startup_admin_engine, _startup_admin_session_factory
    if _startup_admin_engine is None:
        if not _STARTUP_ADMIN_URL:
            raise RuntimeError(
                "DATABASE_ADMIN_URL (or DATABASE_URL) must be set for startup DDL patches"
            )
        _startup_admin_engine = create_engine(_STARTUP_ADMIN_URL)
        _startup_admin_session_factory = _sessionmaker(
            autocommit=False, autoflush=False, bind=_startup_admin_engine
        )
    return _startup_admin_session_factory()


@app.on_event("startup")
def apply_schema_patches() -> None:
    """Idempotent schema patches for containers that predate specific init migrations.

    postgres-init/ scripts only run on first boot. This hook ensures schema fixes
    that shipped after a container was first created are applied on every restart
    without requiring a manual docker exec or down -v.

    Currently patches:
    - no_update_verified rule: allows is_archived FALSE→TRUE and TRUE→FALSE on VERIFIED rows
      (migration 41_fix_immutable_rule_for_archive.sql — may not have run on
      existing containers).
    - ref_regions / ref_provinces / ref_cities RLS policies: REGIONAL_ENCODER sees only
      their assigned region; NATIONAL_VALIDATOR/ANALYST/ADMIN see all
      (migration 42_ref_table_rls.sql — may not have run on existing containers).
    - svc_task system service account: background Celery task service account with
      SYSTEM_ADMIN role for cross-table RLS access (seeded in 03_users.sql for new installs).
    - Analytics MV ownership: transfers wims.mv_* materialized view ownership to
      wims_app_user so the non-superuser can run REFRESH MATERIALIZED VIEW.
    - analytics_incident_facts RLS: rewrites policies from TO <role> (PG database roles) to
      wims.current_user_role() IN (...) so wims_app_user is subject to the correct policies.

    Uses DATABASE_ADMIN_URL (superuser) because CREATE RULE / CREATE POLICY /
    ALTER TABLE require the table owner; wims_app_user (the runtime role) is not
    the owner and cannot run DDL.

    Note: email column (migration 44_add_email_to_users.sql) is intentionally NOT
    patched at startup. Startup DDL on wims.users can deadlock with open read
    transactions (e.g. test fixtures querying wims.users while TestClient(app)
    triggers startup). The postgres-init migration handles fresh CI databases.
    """
    global _schema_patches_attempted, _schema_patches_in_progress
    with _schema_patches_lock:
        if _schema_patches_attempted or _schema_patches_in_progress:
            logger.debug("Schema patches already attempted or in progress; skipping")
            return
        _schema_patches_in_progress = True

    try:
        db = _get_admin_session()
    except Exception:
        with _schema_patches_lock:
            _schema_patches_in_progress = False
        raise

    # Ensure wims_app_user exists — postgres-init only runs on first boot,
    # so existing containers (e.g. VPS) won't have this role until this patch runs.
    if _APP_USER_PASSWORD is None:
        logger.warning(
            "Schema patch (wims_app_user) skipped: WIMS_APP_USER_PASSWORD is not set "
            "and could not be derived from DATABASE_URL. "
            "Set WIMS_APP_USER_PASSWORD or ensure DATABASE_URL includes credentials."
        )
    else:
        try:
            # Password comes from env/DATABASE_URL — escape PL/pgSQL string literal (double quotes).
            _escaped_pw = _APP_USER_PASSWORD.replace("'", "''")
            db.execute(
                text(
                    f"""
                    DO $$
                    BEGIN
                      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wims_app') THEN
                        CREATE ROLE wims_app NOLOGIN;
                      END IF;
                      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wims_app_user') THEN
                        CREATE ROLE wims_app_user LOGIN PASSWORD '{_escaped_pw}' INHERIT;
                        GRANT wims_app TO wims_app_user;
                      END IF;
                    END
                    $$
                    """
                )
            )
            db.execute(text("GRANT USAGE ON SCHEMA wims TO wims_app"))
            db.execute(
                text(
                    "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA wims TO wims_app"
                )
            )
            db.execute(
                text("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA wims TO wims_app")
            )
            db.commit()
            logger.info("Schema patch applied: wims_app_user role ensured")
        except Exception as exc:
            logger.warning("Schema patch (wims_app_user) failed (non-fatal): %s", exc)
            db.rollback()

    try:
        db.execute(text("DROP RULE IF EXISTS no_update_verified ON wims.fire_incidents"))
        db.execute(
            text("""
                CREATE RULE no_update_verified AS
                    ON UPDATE TO wims.fire_incidents
                    WHERE (
                        OLD.verification_status = 'VERIFIED'
                        AND NEW.verification_status != 'REPLACED'
                        AND NOT (NEW.is_archived = TRUE AND OLD.is_archived = FALSE)
                        AND NOT (NEW.is_archived = FALSE AND OLD.is_archived = TRUE)
                    )
                    DO INSTEAD NOTHING
            """)
        )
        db.commit()
        logger.info(
            "Schema patch applied: no_update_verified rule updated to allow archival and unarchival"
        )
    except Exception as exc:
        logger.warning("Schema patch (no_update_verified) failed (non-fatal): %s", exc)
        db.rollback()

    try:
        _apply_ref_table_rls(db)
        db.commit()
        logger.info("Schema patch applied: ref_regions/ref_provinces/ref_cities RLS policies")
    except Exception as exc:
        logger.warning("Schema patch (ref RLS) failed (non-fatal): %s", exc)
        db.rollback()

    try:
        _apply_users_rls(db)
        db.commit()
        logger.info("Schema patch applied: wims.users SELECT policy broadened for BFP staff roles")
    except Exception as exc:
        logger.warning("Schema patch (users RLS) failed (non-fatal): %s", exc)
        db.rollback()

    try:
        db.execute(
            text("""
                INSERT INTO wims.users (user_id, keycloak_id, username, role, is_active)
                VALUES (
                    '00000000-0000-0000-0000-000000000002'::uuid,
                    '00000000-0000-0000-0000-000000000002'::uuid,
                    'svc_task',
                    'SYSTEM_ADMIN',
                    TRUE
                )
                ON CONFLICT (user_id) DO NOTHING
            """)
        )
        db.commit()
        logger.info("Schema patch applied: svc_task system service account ensured")
    except Exception as exc:
        logger.warning("Schema patch (svc_task user) failed (non-fatal): %s", exc)
        db.rollback()

    try:
        for mv in (
            "wims.mv_incident_counts_daily",
            "wims.mv_incident_by_region",
            "wims.mv_incident_type_distribution",
        ):
            db.execute(text(f"ALTER MATERIALIZED VIEW IF EXISTS {mv} OWNER TO wims_app_user"))
        db.commit()
        logger.info(
            "Schema patch applied: analytics materialized view ownership transferred to wims_app_user"
        )
    except Exception as exc:
        logger.warning("Schema patch (MV ownership) failed (non-fatal): %s", exc)
        db.rollback()

    try:
        _apply_analytics_facts_rls(db)
        db.commit()
        logger.info(
            "Schema patch applied: analytics_incident_facts RLS policies rewritten "
            "to use current_user_role() (removed incompatible TO <role> syntax)"
        )
    except Exception as exc:
        logger.warning("Schema patch (analytics_facts RLS) failed (non-fatal): %s", exc)
        db.rollback()

    # Ensure RLS helper functions are SECURITY DEFINER to prevent infinite
    # recursion: current_user_role() queries wims.users, which has RLS policies
    # that call current_user_role(). Without SECURITY DEFINER this stack-overflows.
    try:
        db.execute(text("ALTER FUNCTION wims.current_user_role() SECURITY DEFINER"))
        db.execute(text("ALTER FUNCTION wims.current_user_uuid() SECURITY DEFINER"))
        db.execute(text("ALTER FUNCTION wims.current_user_region_id() SECURITY DEFINER"))
        db.commit()
        logger.info("Schema patch applied: RLS helper functions set to SECURITY DEFINER")
    except Exception as exc:
        logger.warning("Schema patch (RLS helpers SECURITY DEFINER) failed (non-fatal): %s", exc)
        db.rollback()

    # Migration 45: client_id column for offline-first idempotency
    try:
        db.execute(text("ALTER TABLE wims.fire_incidents ADD COLUMN IF NOT EXISTS client_id UUID"))
        db.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_fire_incidents_client_id"
                " ON wims.fire_incidents (client_id)"
                " WHERE client_id IS NOT NULL"
            )
        )
        db.commit()
        logger.info("Schema patch applied: client_id column + unique index on fire_incidents")
    except Exception as exc:
        logger.warning("Schema patch (client_id) failed (non-fatal): %s", exc)
        db.rollback()

    finally:
        db.close()
        with _schema_patches_lock:
            _schema_patches_attempted = True
            _schema_patches_in_progress = False


def _apply_users_rls(db) -> None:  # type: ignore[type-arg]
    """Broaden users SELECT policy so BFP staff roles can JOIN wims.users."""
    db.execute(text("DROP POLICY IF EXISTS users_self_or_admin_select ON wims.users"))
    db.execute(
        text("""
            CREATE POLICY users_self_or_admin_select
            ON wims.users FOR SELECT USING (
                wims.current_user_role() IN (
                    'SYSTEM_ADMIN', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER'
                )
                OR user_id = wims.current_user_uuid()
            )
        """)
    )


def _apply_ref_table_rls(db) -> None:  # type: ignore[type-arg]
    """Enable RLS and upsert policies on reference geography tables (M15).

    SELECT is region-scoped per FRS M15 vi — REGIONAL_ENCODER and
    NATIONAL_VALIDATOR see only their assigned region; NATIONAL_ANALYST and
    SYSTEM_ADMIN see all.  Writes are SYSTEM_ADMIN only.
    A SECURITY DEFINER helper (wims.get_first_region_id) allows the
    public_dmz unauthenticated fallback to read a single region_id
    without weakening the SELECT policies to global-read open access.
    """
    for table in ("wims.ref_regions", "wims.ref_provinces", "wims.ref_cities"):
        db.execute(text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
        db.execute(text(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY"))

    # SECURITY DEFINER fallback helper — bypasses RLS for public_dmz
    db.execute(
        text(
            "CREATE OR REPLACE FUNCTION wims.get_first_region_id()"
            " RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER"
            " SET search_path = wims, pg_temp"
            " AS $$ SELECT region_id FROM wims.ref_regions ORDER BY region_id LIMIT 1 $$;"
        )
    )
    db.execute(text("REVOKE ALL ON FUNCTION wims.get_first_region_id() FROM PUBLIC"))
    db.execute(text("GRANT EXECUTE ON FUNCTION wims.get_first_region_id() TO wims_app"))

    _select_policy = (
        " USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST')"
        " OR (wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')"
        " AND region_id = wims.current_user_region_id()))"
    )
    _cities_select_policy = (
        " USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST')"
        " OR (wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')"
        " AND province_id IN (SELECT province_id FROM wims.ref_provinces"
        " WHERE region_id = wims.current_user_region_id())))"
    )
    _write_policy = (
        " USING (wims.current_user_role() = 'SYSTEM_ADMIN')"
        " WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN')"
    )

    for table, select_pol, write_pol, select_using in (
        ("wims.ref_regions", "ref_regions_select", "ref_regions_write", _select_policy),
        ("wims.ref_provinces", "ref_provinces_select", "ref_provinces_write", _select_policy),
        ("wims.ref_cities", "ref_cities_select", "ref_cities_write", _cities_select_policy),
    ):
        db.execute(text(f"DROP POLICY IF EXISTS {select_pol} ON {table}"))
        db.execute(text(f"CREATE POLICY {select_pol} ON {table} FOR SELECT{select_using}"))
        db.execute(text(f"DROP POLICY IF EXISTS {write_pol} ON {table}"))
        db.execute(text(f"CREATE POLICY {write_pol} ON {table} FOR ALL{_write_policy}"))


def _apply_analytics_facts_rls(db) -> None:  # type: ignore[type-arg]
    """Rewrite analytics_incident_facts RLS policies from TO <role> to current_user_role() IN (...).

    TO <role> addresses PostgreSQL database roles; wims_app_user inherits from wims_app, not from
    NATIONAL_ANALYST / REGIONAL_ENCODER / etc. FORCE ROW LEVEL SECURITY therefore denies everything.

    Write policies are split into separate INSERT/UPDATE/DELETE (not FOR ALL) to avoid OR-broadening
    the region-scoped SELECT policies — PostgreSQL ORs multiple policies for the same command.
    NATIONAL_ANALYST is included in write policies because correct_verified_incident permits analysts
    to modify incidents and trigger sync_incident_to_analytics.
    """
    _write_roles = "('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST', 'SYSTEM_ADMIN')"
    for policy in (
        "aif_national_analyst_read",
        "aif_regional_read",
        "aif_validator_read",
        "aif_system_admin_all",
        "aif_staff_write",
        "aif_staff_insert",
        "aif_staff_update",
        "aif_staff_delete",
    ):
        db.execute(text(f"DROP POLICY IF EXISTS {policy} ON wims.analytics_incident_facts"))

    db.execute(
        text("""
            CREATE POLICY aif_national_analyst_read ON wims.analytics_incident_facts
                FOR SELECT USING (wims.current_user_role() IN ('NATIONAL_ANALYST', 'SYSTEM_ADMIN'))
        """)
    )
    db.execute(
        text("""
            CREATE POLICY aif_regional_read ON wims.analytics_incident_facts
                FOR SELECT USING (
                    wims.current_user_role() = 'REGIONAL_ENCODER'
                    AND region_id = wims.current_user_region_id()
                )
        """)
    )
    db.execute(
        text("""
            CREATE POLICY aif_validator_read ON wims.analytics_incident_facts
                FOR SELECT USING (
                    wims.current_user_role() = 'NATIONAL_VALIDATOR'
                    AND region_id = wims.current_user_region_id()
                )
        """)
    )
    db.execute(
        text(f"""
            CREATE POLICY aif_staff_insert ON wims.analytics_incident_facts
                FOR INSERT WITH CHECK (wims.current_user_role() IN {_write_roles})
        """)
    )
    db.execute(
        text(f"""
            CREATE POLICY aif_staff_update ON wims.analytics_incident_facts
                FOR UPDATE
                USING (wims.current_user_role() IN {_write_roles})
                WITH CHECK (wims.current_user_role() IN {_write_roles})
        """)
    )
    db.execute(
        text(f"""
            CREATE POLICY aif_staff_delete ON wims.analytics_incident_facts
                FOR DELETE USING (wims.current_user_role() IN {_write_roles})
        """)
    )
    db.execute(text("GRANT INSERT, UPDATE, DELETE ON wims.analytics_incident_facts TO wims_app"))


app.include_router(incidents.router)
app.include_router(admin.router, prefix="/api/admin")
app.include_router(sessions.router, prefix="/api/admin")
app.include_router(user_profile_router)  # PATCH /api/user/me, PATCH /api/user/me/password
app.include_router(civilian.router)
app.include_router(triage.router)
app.include_router(regional.router)
app.include_router(analytics.router)
app.include_router(ref.router)  # GET /api/ref/regions, /api/ref/provinces, /api/ref/cities
app.include_router(public_dmz_router)  # POST /api/v1/public/report (no-auth DMZ)
app.include_router(public_map_router)  # GET /api/public/clusters, /api/public/emergency-services
app.include_router(events_router)  # GET /api/events/stream (SSE real-time notifications)
app.include_router(validator_map_router)  # GET /api/validator/operational-map (auth)
app.include_router(
    geocode_router
)  # GET /api/geocode/reverse, /api/geocode/search (Nominatim proxy)
app.include_router(dashboard.router)  # GET /api/dashboard/widgets
app.include_router(operations_router)  # GET/POST/PATCH/DELETE /api/operations
app.include_router(auth_router)  # POST /api/auth/change-email, POST /api/auth/verify-email
app.include_router(consent_router)  # POST /api/auth/consent (public, no-auth)

# ---------------------------------------------------------------------------
# Celery
# ---------------------------------------------------------------------------

# Re-export for celery CLI: celery -A main.celery_app
# Task modules are registered explicitly in celery_config.py.
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
            logger.warning("Redis unavailable at %s — rate limiting disabled", REDIS_URL)
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
    # Rate-limit the PKCE callback endpoint (real auth flow)
    if request.url.path != "/api/auth/callback" or request.method != "POST":
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

    # Read dynamic threshold / window from Redis (set by admin UI #363).
    # Fall back to module-level defaults when config is missing or invalid.
    window = WINDOW_SECONDS
    threshold = RATE_LIMIT_THRESHOLD
    try:
        config = await r.hgetall("rate_limit_config:login")
        if config:
            parsed_window = int(config.get("window_seconds", ""))  # type: ignore[arg-type]
            parsed_threshold = int(config.get("threshold", ""))  # type: ignore[arg-type]
            if parsed_window > 0 and parsed_threshold > 0:
                window = parsed_window
                threshold = parsed_threshold
    except (ValueError, TypeError):
        pass  # non-numeric or missing → keep defaults
    except Exception:
        logger.warning("Redis hgetall failed — using default rate-limit config")

    key = f"rate_limit:{client_ip}"
    now = time.time()

    try:
        result = await r.eval(
            RATE_LIMIT_LUA,
            1,
            key,
            str(now),
            str(window),
            str(threshold),
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


@app.middleware("http")
async def prometheus_metrics_middleware(request: Request, call_next):
    """Record API request duration for Prometheus."""
    if request.url.path == "/metrics":
        return await call_next(request)

    start = time.time()
    response = await call_next(request)
    duration = time.time() - start

    path = request.url.path
    path = re.sub(r"/\d+", "/{id}", path)
    path = re.sub(
        r"/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        "/{uuid}",
        path,
    )

    API_REQUEST_DURATION.labels(
        method=request.method,
        endpoint=path,
        status_code=str(response.status_code),
    ).observe(duration)

    return response


@app.get("/health", include_in_schema=False)
def health():
    """Liveness probe for container orchestration and uptime monitoring."""
    return {"status": "ok"}


@app.get("/metrics", include_in_schema=False)
async def metrics_endpoint():
    """Prometheus metrics scrape endpoint. Updates system resource gauges before returning."""
    import psutil  # lazy import — only loaded when /metrics is hit

    SYSTEM_CPU_PERCENT.set(psutil.cpu_percent(interval=None))
    SYSTEM_MEMORY_PERCENT.set(psutil.virtual_memory().percent)
    SYSTEM_DISK_PERCENT.labels(mountpoint="/").set(psutil.disk_usage("/").percent)
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


# ---------------------------------------------------------------------------
# Routes
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
AUTH_REDIRECT_URI = os.environ.get("AUTH_REDIRECT_URI", "http://localhost:3000/auth/callback")


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

    preferred_username = token_payload.get("preferred_username") or keycloak_sub or "unknown"
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


# ---------------------------------------------------------------------------
# Analytics Summary — Dashboard (all authenticated users)
# ---------------------------------------------------------------------------
class AnalyticsSummaryRequest(BaseModel):
    from_date: str | None = None
    to_date: str | None = None
    region_id: int | None = None
    province_id: int | None = None
    city_id: int | None = None


@app.post("/api/analytics-summary")
async def get_analytics_summary(
    body: AnalyticsSummaryRequest,
    db: Annotated[Session, Depends(auth.get_db_with_rls)],
):
    """
    Dashboard summary counts — reads fire_incidents directly so that
    triage-promoted incidents (no nonsensitive_details row) are included.
    Accessible to all authenticated WIMS users.
    """
    from sqlalchemy import text as _text

    where_clauses = [
        "fi.verification_status = 'VERIFIED'",
        "fi.is_archived = FALSE",
    ]
    params: dict = {}

    if body.from_date:
        where_clauses.append("fi.created_at >= CAST(:from_date AS timestamptz)")
        params["from_date"] = body.from_date
    if body.to_date:
        where_clauses.append("fi.created_at <= CAST(:to_date AS timestamptz) + interval '1 day'")
        params["to_date"] = body.to_date
    if body.region_id is not None:
        where_clauses.append("fi.region_id = :region_id")
        params["region_id"] = body.region_id
    if body.city_id is not None:
        where_clauses.append("nd.city_id = :city_id")
        params["city_id"] = body.city_id

    where_sql = " AND ".join(where_clauses)
    join_sql = "LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id"
    if body.city_id is not None:
        # city_id is on nonsensitive_details so we need the join in WHERE too
        join_sql = "JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id"

    # NOTE: 4 sequential COUNT queries (total, by_region, by_alarm, by_category).
    # Acceptable for current data volumes. See issue #196 for single-scan optimization.
    # Total
    total = (
        db.execute(
            _text(f"SELECT COUNT(*) FROM wims.fire_incidents fi {join_sql} WHERE {where_sql}"),
            params,
        ).scalar()
        or 0
    )

    # By region
    by_region_rows = db.execute(
        _text(f"""
            SELECT r.region_name, COUNT(*) as cnt
            FROM wims.fire_incidents fi
            {join_sql}
            LEFT JOIN wims.ref_regions r ON r.region_id = fi.region_id
            WHERE {where_sql}
            GROUP BY r.region_name ORDER BY cnt DESC
        """),
        params,
    ).fetchall()

    # By alarm level
    by_alarm_rows = db.execute(
        _text(f"""
            SELECT COALESCE(nd.alarm_level, 'Unknown') as alarm_level, COUNT(*) as cnt
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE {where_sql}
            GROUP BY nd.alarm_level ORDER BY cnt DESC
        """),
        params,
    ).fetchall()

    # By general category
    by_category_rows = db.execute(
        _text(f"""
            SELECT COALESCE(nd.general_category, 'UNCATEGORIZED') as general_category, COUNT(*) as cnt
            FROM wims.fire_incidents fi
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE {where_sql}
            GROUP BY nd.general_category ORDER BY cnt DESC
        """),
        params,
    ).fetchall()

    return {
        "status": "ok",
        "total_incidents": total,
        "by_region": [{"region_name": r[0] or "Unknown", "count": r[1]} for r in by_region_rows],
        "by_alarm_level": [{"alarm_level": r[0], "count": r[1]} for r in by_alarm_rows],
        "by_general_category": [
            {"general_category": r[0], "count": r[1]} for r in by_category_rows
        ],
    }
