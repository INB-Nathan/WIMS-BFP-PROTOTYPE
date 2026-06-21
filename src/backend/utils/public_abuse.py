"""Shared helpers for public abuse controls — throttles, neutral responses, audit.

Implements D18 (Public abuse controls), D5 (Public audit logging), and D6 (Redis
fail-open policy) from docs/specs/api-validation-hardening.md.
"""

from __future__ import annotations

import logging
import time

import redis
from fastapi import HTTPException, status

logger = logging.getLogger("wims.public_abuse")

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
