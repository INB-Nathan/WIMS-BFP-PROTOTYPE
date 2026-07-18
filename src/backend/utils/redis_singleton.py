"""Shared sync + async Redis client singletons.

Centralizes the per-process Redis connections used by public-facing rate
limiters (`consent`, `civilian notify`, `public_dmz`, etc.) so all callers
share one sync pool and one async pool, and the same REDIS_URL fallback.

Created for PR #428 (issue #392). Consolidates the previous per-module
`_get_redis()` singletons that lived in ``civilian.py`` and ``consent.py``.

The async singleton (PR public-surface bucket A) reuses a single shared
aioredis ConnectionPool across requests instead of building a per-request
pool, eliminating pool churn. It is recreated only when the running event
loop differs from the loop the pool was created on, which is the failure
mode the previous per-request pool was created to avoid.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from typing import Optional

import redis
import redis.asyncio as aioredis

logger = logging.getLogger("wims.redis")

_REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")

_client: Optional[redis.Redis] = None
_lock = threading.Lock()


def get_redis_client() -> redis.Redis:
    """Return the shared sync Redis client singleton.

    Uses double-checked locking to avoid a startup race where multiple
    threads could create concurrent connections before the global
    reference is published. Under CPython GIL the window is narrow,
    but the lock eliminates it entirely.
    """
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                _client = redis.from_url(
                    _REDIS_URL,
                    decode_responses=True,
                    socket_connect_timeout=0.5,
                    socket_timeout=0.5,
                    health_check_interval=30,
                    max_connections=10,
                )
                logger.debug("Redis singleton client created url=%s", _REDIS_URL)
    return _client


# ---------------------------------------------------------------------------
# Async singleton (public_dmz rate limiter + any other asyncio callers)
# ---------------------------------------------------------------------------
# A single shared aioredis ConnectionPool is reused across requests. The pool
# (and therefore the client) is recreated only when the running event loop is
# not the loop the pool was bound to — the exact cross-event-loop failure mode
# the old per-request pool was created to avoid. We keep the lazy creation,
# decode_responses, and timeouts aligned with the sync singleton.
_async_client: Optional[aioredis.Redis] = None
_async_loop: Optional[asyncio.AbstractEventLoop] = None
_async_lock = asyncio.Lock()


async def get_async_redis_client() -> aioredis.Redis:
    """Return the shared async Redis client singleton.

    Lazily creates a single shared ``aioredis.ConnectionPool`` bound to the
    current running event loop. If the running loop changes (e.g. a new
    asyncio loop per request under FastAPI TestClient / reload), the pool and
    client are recreated so connections never cross event-loop boundaries.

    Backoff: on connection-creation failure we log and re-raise so the caller
    can fail open/closed as appropriate. We deliberately do NOT cache a dead
    client — the next call retries from scratch.
    """
    global _async_client, _async_loop
    loop = asyncio.get_running_loop()
    if _async_client is None or _async_loop is not loop:
        async with _async_lock:
            loop = asyncio.get_running_loop()
            if _async_client is None or _async_loop is not loop:
                # Close a stale pool bound to a different loop, if any.
                if _async_client is not None and _async_loop is not loop:
                    try:
                        await _async_client.aclose(close_connection_pool=True)
                    except Exception:  # noqa: BLE001 - best-effort cleanup
                        pass
                _async_client = aioredis.Redis.from_url(
                    _REDIS_URL,
                    decode_responses=True,
                    socket_connect_timeout=0.5,
                    socket_timeout=0.5,
                    health_check_interval=30,
                    max_connections=10,
                )
                _async_loop = loop
                logger.debug("Redis async singleton client created url=%s", _REDIS_URL)
    return _async_client
