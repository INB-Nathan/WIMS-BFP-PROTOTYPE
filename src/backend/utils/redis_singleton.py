"""Shared sync Redis client singleton.

Centralizes the per-process Redis connection used by public-facing rate limiters
(`consent`, `civilian notify`, etc.) so all callers share one connection pool
and the same REDIS_URL fallback.

Created for PR #428 (issue #392). Consolidates the previous per-module
`_get_redis()` singletons that lived in ``civilian.py`` and ``consent.py``.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional

import redis

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
