"""
Auth routes for self-service operations.

POST /api/auth/change-email  — Step 1: verify password, store pending email + code, send verification email
POST /api/auth/verify-email  — Step 2: verify code, update email in Keycloak and DB
POST /api/auth/register      — Civilian self-service signup (public, rate-limited, Turnstile)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
from datetime import datetime, timezone
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
from schemas.auth import (
    CivilianRegisterRequest,
    RegisterResponse,
    VerifyRegistrationRequest,
    VerifyRegistrationResponse,
)
from services.captcha import verify_turnstile
from services.email.sender import send_email_async
from services.keycloak_admin import (
    _KC_BASE_URL,
    _KC_REALM,
    _get_admin_client,
    create_keycloak_user,
    set_user_enabled,
    update_user_profile,
)
from utils.audit import log_system_audit, trusted_client_ip

logger = logging.getLogger("wims.auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])

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


# ── Self-service registration ──────────────────────────────────────────────────

REGISTER_RATE_LIMIT = 3
REGISTER_RATE_WINDOW = 3600  # 1 hour


def _lookup_user_by_email(adm, email: str) -> str | None:
    """Check if a Keycloak user with the given email exists.

    Returns the user_id string if found, None otherwise.
    """
    try:
        users = adm.get_users({"email": email, "exact": True})
        if users:
            return users[0].get("id")
        return None
    except KeycloakError:
        logger.warning("Keycloak get_users lookup failed for email=%s", email)
        return None


@router.post("/register", response_model=RegisterResponse, status_code=201)
async def register(
    body: CivilianRegisterRequest,
    request: Request,
):
    """
    Civilian self-service signup (verify-first flow).

    Public — no auth required. Validates Turnstile, enforces rate limiting,
    checks email uniqueness, and creates a DISABLED Keycloak user with
    CIVILIAN_REPORTER role. A 6-digit verification code is stored in Redis and
    emailed to the user. The account is finalized (DB records created and the
    Keycloak user enabled) only after the user verifies via
    POST /api/auth/verify-registration.
    """
    client_ip = trusted_client_ip(request)

    # 1. Rate limit (3/IP/hour)
    r = await _get_redis()
    if r is not None:
        await _check_rate_limit(
            r,
            f"rate:register:{client_ip}",
            REGISTER_RATE_LIMIT,
            REGISTER_RATE_WINDOW,
        )

    # 2. Verify Turnstile (skip when not configured)
    if os.environ.get("TURNSTILE_SECRET_KEY", ""):
        await verify_turnstile(body.turnstile_token, client_ip)

    # 3. Validate email uniqueness via Keycloak lookup
    try:
        adm = _get_admin_client()
    except Exception as e:
        logger.error("Keycloak admin client unavailable for registration: %s", e)
        raise HTTPException(status_code=503, detail="Registration service temporarily unavailable")

    existing_user_id = _lookup_user_by_email(adm, body.email)
    if existing_user_id is not None:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists",
        )

    # 4. Create DISABLED Keycloak user (enabled only after email verification)
    try:
        kc_user_id, _email_sent = create_keycloak_user(
            email=body.email,
            first_name=body.first_name,
            last_name=body.last_name,
            username=body.email,
            role="CIVILIAN_REPORTER",
            temp_password=body.password,
            contact_number=body.contact_number,
            temporary=False,
            enabled=False,
            email_verified=False,
        )
    except KeycloakError as e:
        logger.error("Keycloak user creation failed for %s: %s", body.email, e)
        # Surface Keycloak password-policy violations (400) with the actual
        # message so the user can fix their password. Everything else is an
        # upstream infrastructure failure (502).
        http_detail = "Failed to create account. Email may already exist."
        http_status = 502
        if e.response_code == 400 and e.response_body:
            import json as _json

            try:
                body_data = _json.loads(e.response_body)
                detail = body_data.get("error_description")
                if detail:
                    http_detail = detail
                    http_status = 400
            except _json.JSONDecodeError:
                pass
        raise HTTPException(status_code=http_status, detail=http_detail)

    # 5. Store verification code in Redis and send verification email.
    #    The DB account record is created only after verification (see
    #    /verify-registration). contact_number and dpa_consent are carried in
    #    the Redis payload because that endpoint receives only email + code.
    if r is None:
        # Cannot complete the verify-first flow without Redis; roll back the
        # disabled Keycloak account to avoid an orphan.
        try:
            adm.delete_user(kc_user_id)
        except Exception:
            pass
        raise HTTPException(
            status_code=503,
            detail="Verification service temporarily unavailable. Try again later.",
        )

    code = _generate_code()
    redis_key = f"reg_verify:{body.email.lower()}"
    try:
        await r.setex(
            redis_key,
            VERIFICATION_CODE_TTL,
            json.dumps(
                {
                    "code": code,
                    "contact_number": body.contact_number,
                    "dpa_consent": body.dpa_consent,
                }
            ),
        )
    except Exception as e:
        logger.error("Failed to store verification code for %s: %s", body.email, e)
        try:
            adm.delete_user(kc_user_id)
        except Exception:
            pass
        raise HTTPException(
            status_code=503,
            detail="Verification service temporarily unavailable. Try again later.",
        )

    try:
        await send_email_async(
            to=body.email,
            template_name="email_verification",
            context={
                "username": body.email,
                "pending_email": body.email,
                "code": code,
            },
        )
    except Exception as e:
        logger.error("Failed to send verification email to %s: %s", body.email, e)
        # Clean up the Redis key and the disabled Keycloak user so we don't
        # leave an orphan disabled account that can never be verified.
        try:
            await r.delete(redis_key)
        except Exception:
            pass
        try:
            adm.delete_user(kc_user_id)
        except Exception:
            pass
        raise HTTPException(
            status_code=502,
            detail="Failed to send verification email. Try again later.",
        )

    logger.info(
        "Civilian registration initiated: keycloak_id=%s email=%s (verification pending)",
        kc_user_id,
        body.email,
    )

    return RegisterResponse(
        status="ok",
        message=f"Verification email sent to {body.email}",
        email=body.email,
    )


@router.post(
    "/verify-registration",
    response_model=VerifyRegistrationResponse,
    status_code=200,
)
async def verify_registration(
    body: VerifyRegistrationRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    """
    Finalize civilian self-service registration (verify-first flow).

    Public — no auth required. Validates the 6-digit code emailed during
    /register, enables the (previously disabled) Keycloak account, marks the
    email verified, and creates the wims.users + wims.civilian_contributors
    records. On success the user may log in.
    """
    r = await _get_redis()
    if r is None:
        raise HTTPException(
            status_code=503,
            detail="Email verification is temporarily unavailable. Try again later.",
        )

    # Rate limit: 5 code attempts per 10 minutes per email
    await _check_rate_limit(
        r,
        f"rate:reg_verify:{body.email}",
        5,
        VERIFICATION_CODE_TTL,
    )

    if not body.code or not body.code.strip():
        raise HTTPException(status_code=400, detail="Verification code is required")
    code = body.code.strip()

    redis_key = f"reg_verify:{body.email.lower()}"
    raw = await r.get(redis_key)
    if raw is None:
        raise HTTPException(
            status_code=404,
            detail="No pending registration found. The code may have expired or already been used.",
        )

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        await r.delete(redis_key)
        raise HTTPException(status_code=500, detail="Invalid verification state")

    stored_code = data.get("code")
    if not stored_code:
        await r.delete(redis_key)
        raise HTTPException(status_code=500, detail="Invalid verification state")

    if code != stored_code:
        logger.warning("Registration verification code mismatch for %s", body.email)
        raise HTTPException(
            status_code=400,
            detail="Invalid verification code. Please check and try again.",
        )

    # Look up the Keycloak user by email to obtain the keycloak_id (the user
    # was created disabled during /register).
    try:
        adm = _get_admin_client()
    except Exception as e:
        logger.error("Keycloak admin client unavailable for verify-registration: %s", e)
        raise HTTPException(status_code=503, detail="Verification service temporarily unavailable")

    kc_user_id = _lookup_user_by_email(adm, body.email)
    if kc_user_id is None:
        # Should not happen if a code was issued, but guard against drift.
        await r.delete(redis_key)
        raise HTTPException(
            status_code=404,
            detail="No account found for this email. Please register again.",
        )

    # Enable the Keycloak user and mark the email as verified.
    try:
        set_user_enabled(kc_user_id, enabled=True, email_verified=True)
    except KeycloakError as e:
        logger.error("Keycloak enable failed for %s: %s", kc_user_id, e)
        raise HTTPException(
            status_code=502,
            detail="Failed to activate account. Try again later.",
        )

    contact_number = data.get("contact_number")
    now = datetime.now(timezone.utc)
    dpa_consented_at = now if data.get("dpa_consent") else None

    # ── Create wims.users (moved from register()) ──
    try:
        result = db.execute(
            text(
                """INSERT INTO wims.users (keycloak_id, email, username, role, is_active, contact_number, created_at, updated_at)
                   VALUES (:kid, :eml, :uname, :role, TRUE, :phone, :now, :now)
                   ON CONFLICT (keycloak_id) DO UPDATE SET
                       email = EXCLUDED.email,
                       username = EXCLUDED.username,
                       updated_at = EXCLUDED.updated_at
                   RETURNING user_id"""
            ),
            {
                "kid": kc_user_id,
                "eml": body.email,
                "uname": body.email,
                "role": "CIVILIAN_REPORTER",
                "phone": contact_number,
                "now": now,
            },
        ).fetchone()
        db.commit()
        user_id = result.user_id if result else None
        if not user_id:
            raise RuntimeError("RETURNING user_id was null")
    except Exception as e:
        db.rollback()
        logger.error("Failed to insert wims.users for %s (%s): %s", body.email, kc_user_id, e)
        # Attempt to clean up Keycloak user to avoid orphan
        try:
            adm.delete_user(kc_user_id)
        except Exception:
            pass
        raise HTTPException(status_code=502, detail="Account creation failed. Try again later.")

    # ── Create wims.civilian_contributors (moved from register()) ──
    try:
        db.execute(
            text(
                """INSERT INTO wims.civilian_contributors
                       (user_id, trust_score, badge, dpa_consented_at, formula_version)
                   VALUES (:uid, 0, 'NOVICE', :dpa_at, 'reliability-v1')"""
            ),
            {
                "uid": str(user_id),
                "dpa_at": dpa_consented_at,
            },
        )
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(
            "Failed to insert civilian_contributors for %s (%s): %s",
            body.email,
            user_id,
            e,
        )
        # Attempt to clean up Keycloak and users row
        try:
            adm.delete_user(kc_user_id)
        except Exception:
            pass
        try:
            db.execute(text("DELETE FROM wims.users WHERE user_id = :uid"), {"uid": str(user_id)})
            db.commit()
        except Exception:
            pass
        raise HTTPException(status_code=502, detail="Account creation failed. Try again later.")

    # ── Audit DPA consent if given (moved from register()) ──
    if dpa_consented_at is not None:
        log_system_audit(
            db,
            str(user_id),
            "DPA_CONSENT",
            "wims.civilian_contributors",
            None,
            request,
            new_values={
                "dpa_consented_at": dpa_consented_at.isoformat(),
                "ip_address": trusted_client_ip(request),
            },
        )
        db.commit()

    # Clean up Redis after successful verification
    await r.delete(redis_key)

    logger.info(
        "Civilian registration verified: user_id=%s keycloak_id=%s email=%s",
        user_id,
        kc_user_id,
        body.email,
    )

    return VerifyRegistrationResponse(
        status="ok",
        message="Email verified. You can now log in.",
    )


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
