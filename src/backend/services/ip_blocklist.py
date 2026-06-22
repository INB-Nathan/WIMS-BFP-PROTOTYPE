"""IP blocklist service — block/unblock/list + repeat-offender escalation.

Postgres ip_blocklist is the durable write-path (repeat-offender count + audit).
Redis ip:block:{ip} is the hot-path source of truth (middleware EXISTS only).
All functions take a db Session from get_db_with_rls (RLS WITH CHECK requires
the role GUC). Redis writes are best-effort AFTER the Postgres commit; periodic
resync covers drift.
"""

from __future__ import annotations

import ipaddress
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any
from uuid import UUID

import redis.asyncio as aioredis
from fastapi import Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from utils.audit import log_system_audit

logger = logging.getLogger("wims.ip_blocklist")

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
        logger.warning("Redis unavailable for ip_blocklist — fail open")
        return None


def _get_request_client_ip(request: Request) -> str:
    """X-Real-IP first (nginx-set, not client-appendable). Never parse XFF leftmost."""
    ip = request.headers.get("x-real-ip")
    if ip:
        return ip.strip()
    return request.client.host if request.client else "unknown"


def _is_allowlisted(db: Session, ip: str) -> bool:
    """Check if ip is in the never-block allowlist (supports IPs and CIDRs)."""
    row = db.execute(
        text(
            "SELECT config_value FROM wims.system_config "
            "WHERE config_key = 'ip_blocklist.allowlist'"
        )
    ).scalar()
    if not row:
        return False
    try:
        target = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for entry in str(row).split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            if "/" in entry:
                if target in ipaddress.ip_network(entry, strict=False):
                    return True
            elif ipaddress.ip_address(entry) == target:
                return True
        except ValueError:
            continue
    return False


def _get_repeat_offender_threshold(db: Session) -> int:
    """Read the repeat-offender threshold from system_config (default 3)."""
    val = db.execute(
        text(
            "SELECT config_value FROM wims.system_config "
            "WHERE config_key = 'ip_blocklist.repeat_offender_threshold'"
        )
    ).scalar()
    try:
        n = int(str(val))
        return n if n > 0 else 3
    except (TypeError, ValueError):
        return 3


async def _redis_set_block(ip: str, ttl_seconds: int | None, is_permanent: bool) -> None:
    """SET ip:block:{ip} in Redis with optional TTL. Best-effort."""
    r = await _get_redis()
    if r is None:
        return
    try:
        if is_permanent or ttl_seconds is None:
            await r.set(f"ip:block:{ip}", "1")
        else:
            await r.set(f"ip:block:{ip}", "1", ex=ttl_seconds)
    except Exception as e:
        logger.warning("Redis SET ip:block:%s failed (best-effort): %s", ip, e)
    finally:
        try:
            await r.aclose()
        except Exception:
            pass


async def _redis_del_block(ip: str) -> None:
    """DEL ip:block:{ip} in Redis. Best-effort."""
    r = await _get_redis()
    if r is None:
        return
    try:
        await r.delete(f"ip:block:{ip}")
    except Exception as e:
        logger.warning("Redis DEL ip:block:%s failed (best-effort): %s", ip, e)
    finally:
        try:
            await r.aclose()
        except Exception:
            pass


async def block_ip(
    db: Session,
    ip: str,
    blocked_by: UUID,
    reason: str,
    threat_log_id: int | None,
    ttl_hours: int | None,
    requester_ip: str,
) -> dict[str, Any]:
    """Block an IP: allowlist check → self-IP guard → already-active no-op
    → repeat-offender count → INSERT → Redis SET → audit.

    Returns a dict with ``already_active``, ``is_permanent``, ``expires_at``,
    ``block_count``, and ``repeat_offender``.
    """
    # 1. Allowlist check
    if _is_allowlisted(db, ip):
        raise ValueError("IP is on the never-block allowlist")

    # 2. Self-IP guard
    if ip == requester_ip:
        raise ValueError("Cannot block your own IP address")

    # 3. Already-active no-op
    existing = db.execute(
        text("SELECT 1 FROM wims.ip_blocklist WHERE source_ip = :ip AND is_active = true"),
        {"ip": ip},
    ).fetchone()
    if existing is not None:
        return {"ip": ip, "already_active": True}

    # 4. Repeat-offender count (all rows = all distinct block episodes)
    count = (
        db.execute(
            text("SELECT COUNT(*) FROM wims.ip_blocklist WHERE source_ip = :ip"),
            {"ip": ip},
        ).scalar()
        or 0
    )

    # 5. Threshold
    threshold = _get_repeat_offender_threshold(db)

    # 6. Determine permanence (count+1 includes this new block episode)
    is_permanent = (count + 1 >= threshold) or (ttl_hours is None)
    now = datetime.now(timezone.utc)
    if is_permanent:
        expires_at = None
        ttl_seconds = None
    else:
        hours = ttl_hours if ttl_hours and ttl_hours > 0 else 24
        expires_at = now + timedelta(hours=hours)
        ttl_seconds = hours * 3600

    # 7. INSERT
    result = db.execute(
        text(
            "INSERT INTO wims.ip_blocklist "
            "(source_ip, blocked_at, expires_at, is_permanent, blocked_by, "
            "block_reason, threat_log_id, is_active) "
            "VALUES (:ip, :now, :expires_at, :is_permanent, :blocked_by, "
            ":reason, :threat_log_id, true) "
            "RETURNING block_id"
        ),
        {
            "ip": ip,
            "now": now,
            "expires_at": expires_at,
            "is_permanent": is_permanent,
            "blocked_by": str(blocked_by),
            "reason": reason,
            "threat_log_id": threat_log_id,
        },
    )
    block_id = result.scalar()
    db.commit()

    # 8. Best-effort Redis (after commit)
    await _redis_set_block(ip, ttl_seconds, is_permanent)

    # 9. Audit
    log_system_audit(
        db,
        blocked_by,
        "BLOCK_SOURCE_IP",
        "ip_blocklist",
        block_id,
        new_values={
            "ip": ip,
            "is_permanent": is_permanent,
            "expires_at": expires_at.isoformat() if expires_at else None,
            "reason": reason,
        },
    )
    db.commit()

    return {
        "ip": ip,
        "is_permanent": is_permanent,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "block_count": count + 1,
        "repeat_offender": count + 1 >= threshold,
        "already_active": False,
    }


async def unblock_ip(
    db: Session,
    ip: str,
    unblocked_by: UUID,
) -> dict[str, Any]:
    """Soft-unblock an IP: set is_active=false → Redis DEL → audit."""
    result = db.execute(
        text(
            "UPDATE wims.ip_blocklist "
            "SET is_active = false "
            "WHERE source_ip = :ip AND is_active = true"
        ),
        {"ip": ip},
    )
    rows = result.rowcount
    db.commit()

    await _redis_del_block(ip)

    log_system_audit(
        db,
        unblocked_by,
        "UNBLOCK_IP",
        "ip_blocklist",
        None,
        new_values={"ip": ip, "rows": rows},
    )
    db.commit()

    return {"ip": ip, "unblocked_rows": rows}


async def list_blocked_ips(db: Session) -> list[dict[str, Any]]:
    """List all active (is_active=true) blocked IPs with derived block_count."""
    rows = db.execute(
        text(
            "SELECT source_ip, blocked_at, expires_at, is_permanent, "
            "blocked_by, block_reason "
            "FROM wims.ip_blocklist "
            "WHERE is_active = true "
            "ORDER BY blocked_at DESC"
        )
    ).fetchall()

    out: list[dict[str, Any]] = []
    for r in rows:
        count = (
            db.execute(
                text("SELECT COUNT(*) FROM wims.ip_blocklist WHERE source_ip = :ip"),
                {"ip": r[0]},
            ).scalar()
            or 0
        )
        out.append(
            {
                "source_ip": r[0],
                "blocked_at": r[1].isoformat() if r[1] else None,
                "expires_at": r[2].isoformat() if r[2] else None,
                "is_permanent": r[3],
                "blocked_by": str(r[4]) if r[4] else None,
                "block_reason": r[5],
                "block_count": count,
            }
        )
    return out
