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
import time

import redis.asyncio as aioredis
from fastapi import FastAPI, Request, Depends
from fastapi.responses import JSONResponse
from celery import Celery
import auth
from auth import get_current_user

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="WIMS-BFP Backend")

logger = logging.getLogger("wims.rate_limit")

# ---------------------------------------------------------------------------
# Celery
# ---------------------------------------------------------------------------
celery_app = Celery("wims_worker", broker=os.environ.get("REDIS_URL", "redis://redis:6379/0"))
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")

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

from typing import Annotated

@app.get("/api/user/me")
async def get_me(user: Annotated[dict, Depends(get_current_user)]):
    """Protected route that returns the validated user claims."""
    return user
