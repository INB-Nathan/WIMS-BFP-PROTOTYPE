"""Device token + device block middleware — Wayfinder device abuse controls (#567).

Two fail-open ASGI middlewares:

- ``device_token_middleware`` — reads/verifies the ``wims_device_token`` cookie,
  issues a fresh signed token when absent or corrupted, and injects
  ``request.state.device_token_hash``. Exposes the hash via the
  ``X-Device-Token-Hash`` response header (no bootstrap API endpoint — headers
  avoid hash enumeration, per the Wayfinder #565 resolved design decision).
  Also writes a best-effort Redis telemetry record correlating source IP →
  device hash for Suricata ingestion correlation (read side: issue #568).

- ``device_block_middleware`` — checks ``device:block:{hash}`` in Redis. Public
  endpoints get a soft flag (``request.state.device_blocked``) for downstream
  escalation (issue #572); authenticated endpoints get a hard 403.

Token format: ``v<version>.<base64url_32_random_bytes>.<base64url_hmac_sha256>``
See docs/superpowers/specs/2026-07-06-device-token-abuse-controls-design.md §3-4.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import time
from datetime import datetime, timezone

import redis.asyncio as aioredis
from fastapi import Request
from fastapi.responses import JSONResponse

from services.device_blocklist import is_device_blocked
from utils.audit import trusted_client_ip

logger = logging.getLogger("wims.device_token")

DEVICE_TOKEN_COOKIE = "wims_device_token"
DEVICE_TOKEN_MAX_AGE = 365 * 24 * 3600  # 1 year
DEVICE_TELEMETRY_TTL = 300  # seconds — issue #568

_EXEMPT_PATHS = ("/health", "/api/v1/public/health", "/metrics")
_PUBLIC_PATH_PREFIXES = ("/api/civilian/", "/tracking", "/api/v1/public/")

_TOKEN_RE = re.compile(r"^v(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$")

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
_async_pool: aioredis.ConnectionPool | None = None


async def _get_async_pool() -> aioredis.ConnectionPool:
    global _async_pool
    if _async_pool is None:
        _async_pool = aioredis.ConnectionPool.from_url(
            REDIS_URL,
            decode_responses=True,
            max_connections=20,
            socket_connect_timeout=0.5,
            health_check_interval=30,
        )
    return _async_pool


async def _get_redis() -> aioredis.Redis | None:
    try:
        return aioredis.Redis(connection_pool=await _get_async_pool())
    except Exception:
        logger.warning("Redis unavailable for device_token middleware — fail open")
        return None


# ── Token signing ────────────────────────────────────────────────────────────


def _active_version() -> int:
    try:
        return int(os.environ.get("DEVICE_TOKEN_SIGNING_KEY_ACTIVE_VERSION", "1"))
    except ValueError:
        return 1


def _signing_key(version: int) -> str | None:
    if version == 1:
        return os.environ.get("DEVICE_TOKEN_SIGNING_KEY")
    return os.environ.get(f"DEVICE_TOKEN_SIGNING_KEY_V{version}")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _sign(body_b64: str, key: str) -> str:
    sig = hmac.new(key.encode("utf-8"), body_b64.encode("ascii"), hashlib.sha256).digest()
    return _b64url(sig)


def _issue_token() -> tuple[str, str] | None:
    """Generate a fresh signed device token. Returns (raw_token, token_hash), or
    None if no signing key is configured (fail-open — caller proceeds without a
    device identity rather than crashing)."""
    version = _active_version()
    key = _signing_key(version)
    if not key:
        logger.warning("DEVICE_TOKEN_SIGNING_KEY not set — cannot issue device token")
        return None
    body_b64 = _b64url(os.urandom(32))
    sig_b64 = _sign(body_b64, key)
    raw_token = f"v{version}.{body_b64}.{sig_b64}"
    token_hash = hashlib.sha256(raw_token.encode("ascii")).hexdigest()
    return raw_token, token_hash


def _verify_token(raw_token: str) -> str | None:
    """Verify a presented device token. Returns its SHA-256 hash if valid, else None."""
    match = _TOKEN_RE.match(raw_token)
    if not match:
        return None
    version_str, body_b64, sig_b64 = match.groups()
    key = _signing_key(int(version_str))
    if not key:
        return None
    expected_sig = _sign(body_b64, key)
    if not hmac.compare_digest(expected_sig, sig_b64):
        return None
    return hashlib.sha256(raw_token.encode("ascii")).hexdigest()


# ── Corrupt-token warning throttle (max once/minute/IP) ─────────────────────

_WARN_TTL_SECONDS = 60
_last_warned: dict[str, float] = {}


def _should_warn(ip: str) -> bool:
    now = time.time()
    last = _last_warned.get(ip, 0.0)
    if now - last >= _WARN_TTL_SECONDS:
        _last_warned[ip] = now
        return True
    return False


# ── Middlewares ──────────────────────────────────────────────────────────────


async def device_token_middleware(request: Request, call_next):
    """Read/verify/issue the device token cookie; inject
    ``request.state.device_token_hash``. Register AFTER correlation_id_middleware
    (i.e. later in main.py) so it runs immediately after it."""
    if request.url.path in _EXEMPT_PATHS:
        request.state.device_token_hash = None
        return await call_next(request)

    raw_cookie = request.cookies.get(DEVICE_TOKEN_COOKIE)
    token_hash: str | None = None
    new_raw_token: str | None = None

    if raw_cookie:
        token_hash = _verify_token(raw_cookie)
        if token_hash is None:
            if _should_warn(trusted_client_ip(request)):
                logger.warning("Corrupt/invalid device token cookie — reissuing")
            issued = _issue_token()
            if issued is not None:
                new_raw_token, token_hash = issued
    else:
        issued = _issue_token()
        if issued is not None:
            new_raw_token, token_hash = issued

    request.state.device_token_hash = token_hash

    response = await call_next(request)

    if new_raw_token is not None:
        response.set_cookie(
            DEVICE_TOKEN_COOKIE,
            new_raw_token,
            max_age=DEVICE_TOKEN_MAX_AGE,
            httponly=True,
            secure=True,
            samesite="lax",
            path="/",
        )
    if token_hash is not None:
        response.headers["X-Device-Token-Hash"] = token_hash

    await _write_telemetry(request, token_hash)

    return response


async def _write_telemetry(request: Request, token_hash: str | None) -> None:
    """Best-effort Redis telemetry write correlating source IP → device hash(es).

    Stored as a Redis hash keyed by IP, with one field per distinct device
    hash seen for that IP within the TTL window (``{hash: payload_json}``).
    This lets the reader (Suricata ingestion correlation, issue #568)
    distinguish a single confident match from an ambiguous multi-device IP
    (e.g. CGNAT) without a second lookup key. Repeat requests from the same
    device simply overwrite their own field. TTL is refreshed on every write.
    """
    if token_hash is None:
        return
    try:
        r = await _get_redis()
        if r is None:
            return
        wims_user = getattr(request.state, "wims_user", None)
        authenticated_user_id = (
            wims_user.get("user_id") if isinstance(wims_user, dict) else None
        )
        client_ip = trusted_client_ip(request)
        payload = json.dumps(
            {
                "device_token_hash": token_hash,
                "user_agent": request.headers.get("user-agent", ""),
                "authenticated_user_id": str(authenticated_user_id)
                if authenticated_user_id
                else None,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "path": request.url.path,
            }
        )
        key = f"device:telemetry:{client_ip}"
        await r.hset(key, token_hash, payload)
        await r.expire(key, DEVICE_TELEMETRY_TTL)
    except Exception:
        logger.warning("Device telemetry Redis write failed — best effort, continuing")


async def device_block_middleware(request: Request, call_next):
    """Check device:block:{hash}. Register AFTER device_token_middleware (i.e.
    later in main.py) so it runs immediately after it and has access to
    request.state.device_token_hash."""
    request.state.device_blocked = False
    token_hash = getattr(request.state, "device_token_hash", None)

    if token_hash:
        blocked = await is_device_blocked(token_hash)
        if blocked:
            path = request.url.path
            if path.startswith(_PUBLIC_PATH_PREFIXES):
                request.state.device_blocked = True
            else:
                return JSONResponse(status_code=403, content={"detail": "Device blocked"})

    return await call_next(request)
