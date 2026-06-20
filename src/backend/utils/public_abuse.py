"""Shared helpers for public abuse controls — throttles, neutral responses, audit.

Implements D18 (Public abuse controls), D5 (Public audit logging), and D6 (Redis
fail-open policy) from docs/specs/api-validation-hardening.md.
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
import redis
from fastapi import HTTPException, Request, status

logger = logging.getLogger("wims.public_abuse")

# ---------------------------------------------------------------------------
# Rotating salt for IP hashing in public audit logs.
# Salt is rotated periodically (daily) so that a hash compromise does not
# expose historical IP data. The current salt is stored in Redis and refreshed
# by a background task; if Redis is unavailable, a static fallback is used
# but a warning is emitted.
# ---------------------------------------------------------------------------
_IP_SALT_TTL = 86400  # 24 hours


def _get_ip_hash_salt() -> bytes:
    """Return the current rotating salt for IP hashing.

    Salt is stored in Redis with a 24h TTL. On expiry or unavailability,
    a static fallback salt is used with a warning.
    """
    try:
        r = redis.from_url(
            os.environ.get("REDIS_URL", "redis://redis:6379/0"),
            decode_responses=False,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
        )
        salt_key = "wims:public_audit:ip_salt"
        salt = r.get(salt_key)
        if salt is None:
            salt = os.urandom(32)
            r.setex(salt_key, _IP_SALT_TTL, salt)
        r.close()
        return salt
    except Exception:
        logger.warning("Redis unavailable — using static fallback for IP hash salt")
        return b"wims-static-public-audit-salt-v1"


def _hash_ip(ip: str) -> str:
    """Hash an IP address with a rotating salt for privacy-preserving audit.

    Returns a hex-encoded SHA-256 hash. The salt rotation limits the
    window during which a compromised hash can be correlated.
    """
    salt = _get_ip_hash_salt()
    return hashlib.sha256(salt + ip.encode("utf-8")).hexdigest()


def _hash_user_agent(user_agent: str | None) -> str | None:
    """Hash a User-Agent header for privacy-preserving audit."""
    if not user_agent:
        return None
    return hashlib.sha256(user_agent.encode("utf-8")).hexdigest()[:16]


def _resolve_client_ip(request: Request) -> str:
    """Extract the real client IP from trusted reverse-proxy headers.

    Prefers X-Forwarded-For (first hop), then X-Real-IP, then socket peer.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first_hop = forwarded.split(",", 1)[0].strip()
        if first_hop:
            return first_hop

    real_ip = request.headers.get("x-real-ip")
    if real_ip and real_ip.strip():
        return real_ip.strip()

    if request.client:
        return request.client.host
    return "unknown"


# ---------------------------------------------------------------------------
# Sliding-window Redis rate limiter (fail-closed on public surfaces per D6)
# ---------------------------------------------------------------------------


def rate_limit_public(
    redis_client: redis.Redis,
    ip: str,
    key_prefix: str,
    limit: int,
    window: int,
    *,
    fail_closed: bool = True,
) -> None:
    """Enforce a Redis sliding-window rate limit.

    Uses an atomic Lua script (ZSET-based) for correctness under concurrency.
    Raises HTTPException 429 with Retry-After header if the limit is exceeded.

    Args:
        redis_client: A connected synchronous Redis client.
        ip: The client IP address (already extracted from request headers).
        key_prefix: Namespace prefix for the Redis key (e.g. 'public_consent').
        limit: Maximum number of requests within the window.
        window: Window size in seconds.
        fail_closed: If True and Redis is unavailable, raise 503 (public surfaces).
                     If False, log a warning and allow the request through.

    Raises:
        HTTPException 429: Rate limit exceeded.
        HTTPException 503: Redis unavailable (only when fail_closed=True).
    """
    key = f"wims:rl:{key_prefix}:{ip}"
    now = time.time()

    lua_script = """
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])

    -- Remove entries older than the window
    redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

    -- Count entries in the current window
    local count = redis.call('ZCARD', key)

    if count >= limit then
        local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        local retry_after = 1
        if oldest and #oldest >= 2 then
            retry_after = math.ceil(window - (now - tonumber(oldest[2])))
            if retry_after < 1 then retry_after = 1 end
        end
        return {1, retry_after}
    end

    redis.call('ZADD', key, now, now .. '-' .. math.random())
    redis.call('EXPIRE', key, window + 60)

    return {0, 0}
    """

    try:
        result = redis_client.eval(
            lua_script,
            1,
            key,
            str(now),
            str(window),
            str(limit),
        )
        blocked, retry_after = int(result[0]), int(result[1])
        if blocked:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded. Max {limit} requests per {window}s per IP.",
                headers={"Retry-After": str(retry_after)},
            )
    except HTTPException:
        raise
    except Exception as exc:
        if fail_closed:
            logger.error("Redis eval failed for key=%s — fail-closed: raising 503", key)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Service temporarily unavailable — rate limiter unreachable",
            ) from exc
        else:
            logger.warning("Redis eval failed for key=%s — fail-open: allowing request", key)
            return


# ---------------------------------------------------------------------------
# Neutral 404 response helper
#
# All public /{id} routes must return the same 404 shape for missing vs.
# wrong-owner to prevent information leakage about report/incident existence.
# ---------------------------------------------------------------------------


def neutral_404(detail: str = "Not found") -> HTTPException:
    """Return a neutral 404 with no distinguishing info about what was not found.

    Public-facing endpoints use this instead of crafting a detailed 404 message
    to avoid leaking existence of report IDs / device IDs / incident IDs.
    """
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


# ---------------------------------------------------------------------------
# Privacy-preserving public audit logging
#
# Logs action, endpoint, report_id, IP hash (rotating salt), and user-agent
# hash. Never logs plaintext PII or request body.
# ---------------------------------------------------------------------------


def log_public_audit(
    db,
    action: str,
    endpoint: str,
    report_id: int | None,
    request: Request,
):
    """Write a privacy-preserving audit log entry for a public action.

    Logs: action type, endpoint path, report/incident ID (if generated),
    IP hash (rotating salt), and user-agent hash. Does NOT log plaintext
    IP, request body, or any PII.

    Uses the shared system_audit_trails table with user_id=NULL.
    Audit failures are logged but do not block the main action.
    """
    from sqlalchemy import text

    ip = _resolve_client_ip(request)
    ip_hash = _hash_ip(ip)
    user_agent = request.headers.get("user-agent")
    ua_hash = _hash_user_agent(user_agent)

    try:
        db.execute(
            text("""
                INSERT INTO wims.system_audit_trails (
                    user_id, action_type, table_affected, record_id,
                    ip_address, user_agent, timestamp
                ) VALUES (
                    NULL, :action, :table, :rec,
                    :ip, :ua, now()
                )
            """),
            {
                "action": action,
                "table": endpoint,
                "rec": report_id,
                "ip": ip_hash,
                "ua": ua_hash,
            },
        )
        # Caller commits the transaction
    except Exception:
        logger.warning(
            "Failed to log public audit for action=%s endpoint=%s report_id=%s",
            action,
            endpoint,
            report_id,
            exc_info=True,
        )
