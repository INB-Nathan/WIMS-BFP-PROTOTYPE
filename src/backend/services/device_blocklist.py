"""Device blocklist service — block/unblock/list + repeat-offender escalation.

Postgres device_blocklist is the durable write-path (repeat-offender count +
audit). Redis device:block:{hash} is the hot-path source of truth (middleware
EXISTS only). All functions take a db Session from get_db_with_rls (RLS
WITH CHECK requires the role GUC). Redis writes are best-effort AFTER the
Postgres commit; periodic resync (issue #569) covers drift.

Independent from services/ip_blocklist.py — see
docs/superpowers/specs/2026-07-06-device-token-abuse-controls-design.md
section 5.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any
from uuid import UUID

import redis.asyncio as aioredis
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from utils.audit import log_system_audit

logger = logging.getLogger("wims.device_blocklist")

_resync_engine: Engine | None = None

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
        logger.warning("Redis unavailable for device_blocklist — fail open")
        return None


def _get_repeat_offender_threshold(db: Session) -> int:
    """Read the repeat-offender threshold from system_config (default 3)."""
    val = db.execute(
        text(
            "SELECT config_value FROM wims.system_config "
            "WHERE config_key = 'device_blocklist.repeat_offender_threshold'"
        )
    ).scalar()
    try:
        n = int(str(val))
        return n if n > 0 else 3
    except (TypeError, ValueError):
        return 3


async def _redis_set_block(device_token_hash: str, ttl_seconds: int | None, is_permanent: bool) -> None:
    """SET device:block:{hash} in Redis with optional TTL. Best-effort."""
    r = await _get_redis()
    if r is None:
        return
    try:
        if is_permanent or ttl_seconds is None:
            await r.set(f"device:block:{device_token_hash}", "1")
        else:
            await r.set(f"device:block:{device_token_hash}", "1", ex=ttl_seconds)
    except Exception as e:
        logger.warning("Redis SET device:block:%s failed (best-effort): %s", device_token_hash, e)
    finally:
        try:
            await r.aclose()
        except Exception:
            pass


async def _redis_del_block(device_token_hash: str) -> None:
    """DEL device:block:{hash} in Redis. Best-effort."""
    r = await _get_redis()
    if r is None:
        return
    try:
        await r.delete(f"device:block:{device_token_hash}")
    except Exception as e:
        logger.warning("Redis DEL device:block:%s failed (best-effort): %s", device_token_hash, e)
    finally:
        try:
            await r.aclose()
        except Exception:
            pass


async def is_device_blocked(device_token_hash: str) -> bool:
    """Redis-only lookup for middleware hot-path. Fail-open: Redis down → False."""
    r = await _get_redis()
    if r is None:
        return False
    try:
        return bool(await r.exists(f"device:block:{device_token_hash}"))
    except Exception as e:
        logger.warning("Redis EXISTS device:block:%s failed (fail-open): %s", device_token_hash, e)
        return False
    finally:
        try:
            await r.aclose()
        except Exception:
            pass


async def block_device(
    db: Session,
    device_token_hash: str,
    blocked_by: UUID,
    reason: str,
    threat_log_id: int | None,
    ttl_hours: int | None,
    requester_device_hash: str | None,
    user_agent: str | None = None,
    authenticated_user_id: UUID | None = None,
) -> dict[str, Any]:
    """Block a device: self-device guard → already-active no-op → repeat-offender
    count → INSERT → Redis SET → audit.

    Returns a dict with ``already_active``, ``is_permanent``, ``expires_at``,
    ``block_count``, and ``repeat_offender``.
    """
    # 1. Self-block prevention
    if requester_device_hash is not None and device_token_hash == requester_device_hash:
        raise ValueError("Cannot block your own device")

    # 2. Already-active no-op
    existing = db.execute(
        text(
            "SELECT 1 FROM wims.device_blocklist "
            "WHERE device_token_hash = :hash AND is_active = true"
        ),
        {"hash": device_token_hash},
    ).fetchone()
    if existing is not None:
        return {"device_token_hash": device_token_hash, "already_active": True}

    # 3. Repeat-offender count (all rows = all distinct block episodes)
    count = (
        db.execute(
            text("SELECT COUNT(*) FROM wims.device_blocklist WHERE device_token_hash = :hash"),
            {"hash": device_token_hash},
        ).scalar()
        or 0
    )

    # 4. Threshold
    threshold = _get_repeat_offender_threshold(db)

    # 5. Determine permanence (count+1 includes this new block episode)
    is_permanent = (count + 1 >= threshold) or (ttl_hours is None)
    now = datetime.now(timezone.utc)
    if is_permanent:
        expires_at = None
        ttl_seconds = None
    else:
        hours = ttl_hours if ttl_hours and ttl_hours > 0 else 24
        expires_at = now + timedelta(hours=hours)
        ttl_seconds = hours * 3600

    # 6. INSERT
    result = db.execute(
        text(
            "INSERT INTO wims.device_blocklist "
            "(device_token_hash, blocked_at, expires_at, is_permanent, blocked_by, "
            "block_reason, threat_log_id, user_agent, authenticated_user_id, is_active) "
            "VALUES (:hash, :now, :expires_at, :is_permanent, :blocked_by, "
            ":reason, :threat_log_id, :user_agent, :authenticated_user_id, true) "
            "RETURNING block_id"
        ),
        {
            "hash": device_token_hash,
            "now": now,
            "expires_at": expires_at,
            "is_permanent": is_permanent,
            "blocked_by": str(blocked_by),
            "reason": reason,
            "threat_log_id": threat_log_id,
            "user_agent": user_agent,
            "authenticated_user_id": str(authenticated_user_id) if authenticated_user_id else None,
        },
    )
    block_id = result.scalar()
    db.commit()

    # 7. Best-effort Redis (after commit)
    await _redis_set_block(device_token_hash, ttl_seconds, is_permanent)

    # 8. Audit
    log_system_audit(
        db,
        blocked_by,
        "BLOCK_DEVICE_TOKEN",
        "device_blocklist",
        block_id,
        new_values={
            "device_token_hash": device_token_hash,
            "is_permanent": is_permanent,
            "expires_at": expires_at.isoformat() if expires_at else None,
            "reason": reason,
        },
    )
    db.commit()

    return {
        "device_token_hash": device_token_hash,
        "is_permanent": is_permanent,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "block_count": count + 1,
        "repeat_offender": count + 1 >= threshold,
        "already_active": False,
    }


async def unblock_device(
    db: Session,
    device_token_hash: str,
    unblocked_by: UUID,
) -> dict[str, Any]:
    """Soft-unblock a device: set is_active=false + expires_at=now() → Redis DEL → audit."""
    result = db.execute(
        text(
            "UPDATE wims.device_blocklist "
            "SET is_active = false, expires_at = now() "
            "WHERE device_token_hash = :hash AND is_active = true"
        ),
        {"hash": device_token_hash},
    )
    rows = result.rowcount
    db.commit()

    await _redis_del_block(device_token_hash)

    log_system_audit(
        db,
        unblocked_by,
        "UNBLOCK_DEVICE_TOKEN",
        "device_blocklist",
        None,
        new_values={"device_token_hash": device_token_hash, "rows": rows},
    )
    db.commit()

    return {"device_token_hash": device_token_hash, "unblocked_rows": rows}


async def list_blocked_devices(db: Session) -> list[dict[str, Any]]:
    """List all active (is_active=true) blocked devices with derived block_count."""

    rows = db.execute(
        text(
            "SELECT device_token_hash, blocked_at, expires_at, is_permanent, "
            "blocked_by, block_reason, user_agent, authenticated_user_id "
            "FROM wims.device_blocklist "
            "WHERE is_active = true "
            "ORDER BY blocked_at DESC"
        )
    ).fetchall()

    out: list[dict[str, Any]] = []
    for r in rows:
        count = (
            db.execute(
                text(
                    "SELECT COUNT(*) FROM wims.device_blocklist WHERE device_token_hash = :hash"
                ),
                {"hash": r[0]},
            ).scalar()
            or 0
        )
        out.append(
            {
                "device_token_hash": r[0],
                "blocked_at": r[1].isoformat() if r[1] else None,
                "expires_at": r[2].isoformat() if r[2] else None,
                "is_permanent": r[3],
                "blocked_by": str(r[4]) if r[4] else None,
                "block_reason": r[5],
                "user_agent": r[6],
                "authenticated_user_id": str(r[7]) if r[7] else None,
                "block_count": count,
            }
        )
    return out


async def resync_device_blocklist_to_redis() -> int:
    """Boot + periodic resync of active device blocks from Postgres to Redis TTL keys.

    Uses a non-RLS engine connection (no role GUC available at boot / Celery).
    Reads ``DATABASE_ADMIN_URL`` first for RLS bypass, falls back to
    ``DATABASE_URL``.

    Returns the number of devices restored to Redis.
    """
    global _resync_engine
    if _resync_engine is None:
        db_url = (
            os.environ.get("DATABASE_ADMIN_URL")
            or os.environ.get("DATABASE_URL")
            or "postgresql://postgres:password@postgres:5432/wims"
        )
        _resync_engine = create_engine(
            db_url,
            pool_pre_ping=True,
            pool_size=2,
            max_overflow=2,
        )

    r = await _get_redis()
    if r is None:
        logger.warning("Redis unavailable — skip device blocklist resync")
        return 0

    count = 0
    now = datetime.now(timezone.utc)
    try:
        with _resync_engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT device_token_hash, expires_at, is_permanent "
                    "FROM wims.device_blocklist "
                    "WHERE is_active = true "
                    "AND (expires_at IS NULL OR expires_at > now())"
                )
            ).fetchall()

        for row in rows:
            device_token_hash, expires_at, is_permanent = row[0], row[1], row[2]
            try:
                if is_permanent or expires_at is None:
                    await r.set(f"device:block:{device_token_hash}", "1")
                else:
                    remaining = int((expires_at - now).total_seconds())
                    if remaining > 0:
                        await r.set(f"device:block:{device_token_hash}", "1", ex=remaining)
                count += 1
            except Exception as e:
                logger.warning("Resync Redis SET failed for %s: %s", device_token_hash, e)
    except Exception as e:
        logger.warning("Device blocklist resync query failed: %s", e)
    finally:
        try:
            await r.aclose()
        except Exception:
            pass

    return count
