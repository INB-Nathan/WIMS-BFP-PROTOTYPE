"""Device abuse escalation for public civilian endpoints (Wayfinder — issue #572).

Three-tier progressive escalation, applied by calling ``check_device_abuse()``
explicitly inside a route handler (same calling convention as the existing
``services.captcha.verify_turnstile`` — an explicit call with the route's own
parsed body field, not a header-based ``Depends()``, so it reuses the
``turnstile_token`` body field civilian.py routes already have rather than
inventing a parallel header contract the frontend doesn't send):

- Tier 1 — CAPTCHA gate: every device must pass Turnstile verification.
- Tier 2 — adaptive rate limit: 5 req/min normally, 2 req/min for a device
  already in the device_blocklist (issue #566). Keyed on (device hash, IP) so
  CGNAT-shared IPs don't punish unrelated devices.
- Tier 3 — quarantine: repeated Tier-2 violations (3 normally, 2 if already
  blocked) within 60 minutes sets a 24h quarantine flag. Callers read
  ``request.state.device_quarantined`` after a successful call to decide
  whether to route the submission to manual review.

See docs/superpowers/specs/2026-07-06-device-token-abuse-controls-design.md §7.
"""

from __future__ import annotations

import logging
import os

import redis
from fastapi import HTTPException, Request

from services.captcha import verify_turnstile
from services.device_blocklist import is_device_blocked
from utils.audit import trusted_client_ip
from utils.public_abuse import rate_limit_public

logger = logging.getLogger("wims.device_abuse")

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")

_ABUSE_WINDOW_SECONDS = 3600  # 60 minutes — Tier-3 violation counter TTL
_QUARANTINE_TTL_SECONDS = 86400  # 24 hours
_NORMAL_RATE_LIMIT = 5  # requests/minute for an unblocked device
_BLOCKED_RATE_LIMIT = 2  # requests/minute for an already-blocked device
_NORMAL_QUARANTINE_THRESHOLD = 3  # violations within the window
_BLOCKED_QUARANTINE_THRESHOLD = 2  # halved for already-blocked devices

_sync_redis: redis.Redis | None = None


def _get_sync_redis() -> redis.Redis:
    global _sync_redis
    if _sync_redis is None:
        _sync_redis = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    return _sync_redis


async def captcha_required(token: str | None, remote_ip: str | None) -> None:
    """Tier 1: every device must present a valid Turnstile token.

    Normalizes all failure modes to 403 (missing token, invalid token) — the
    tier semantics care only about pass/fail, not the underlying verification
    service's own status codes.
    """
    if not token:
        raise HTTPException(status_code=403, detail="CAPTCHA token required")
    try:
        await verify_turnstile(token, remote_ip)
    except HTTPException as exc:
        if exc.status_code == 500:
            raise  # CAPTCHA service misconfiguration — not a client-abuse verdict
        raise HTTPException(status_code=403, detail="CAPTCHA verification failed") from exc


def _record_violation_and_maybe_quarantine(device_hash: str, is_blocked: bool) -> None:
    """Best-effort: increment the Tier-3 violation counter and quarantine if
    the (halved, for already-blocked devices) threshold is reached."""
    try:
        r = _get_sync_redis()
        key = f"device:abuse:{device_hash}"
        count = r.incr(key)
        if count == 1:
            r.expire(key, _ABUSE_WINDOW_SECONDS)
        threshold = _BLOCKED_QUARANTINE_THRESHOLD if is_blocked else _NORMAL_QUARANTINE_THRESHOLD
        if count >= threshold:
            r.set(f"device:quarantine:{device_hash}", "1", ex=_QUARANTINE_TTL_SECONDS)
    except Exception as exc:
        logger.warning("Device abuse counter update failed for %s: %s", device_hash, exc)


def _is_quarantined(device_hash: str) -> bool:
    try:
        r = _get_sync_redis()
        return bool(r.exists(f"device:quarantine:{device_hash}"))
    except Exception as exc:
        logger.warning("Quarantine check failed for %s: %s", device_hash, exc)
        return False


async def check_device_abuse(request: Request, turnstile_token: str | None) -> None:
    """Apply the full three-tier escalation. Sets
    ``request.state.device_quarantined`` on success so the caller can flag
    the submission for review. Raises 403 (CAPTCHA) or 429 (rate limit) via
    HTTPException; never raises for the quarantine tier itself (quarantine is
    advisory — the request still proceeds, just flagged).
    """
    ip = trusted_client_ip(request)
    await captcha_required(turnstile_token, ip)

    device_hash = getattr(request.state, "device_token_hash", None)
    is_blocked = await is_device_blocked(device_hash) if device_hash else False
    limit = _BLOCKED_RATE_LIMIT if is_blocked else _NORMAL_RATE_LIMIT

    rate_key = f"{device_hash or 'nodevice'}:{ip}"
    try:
        rate_limit_public(
            _get_sync_redis(),
            rate_key,
            "device_abuse",
            limit=limit,
            window=60,
            fail_closed=False,
        )
    except HTTPException as exc:
        if exc.status_code == 429 and device_hash:
            _record_violation_and_maybe_quarantine(device_hash, is_blocked)
        raise

    request.state.device_quarantined = _is_quarantined(device_hash) if device_hash else False
