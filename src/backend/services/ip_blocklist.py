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
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from utils.audit import log_system_audit

logger = logging.getLogger("wims.ip_blocklist")

_resync_engine: Engine | None = None  # noqa: F811

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


async def block_ips_by_filter(
    db: Session,
    filters: dict[str, Any],
    blocked_by: UUID,
    dry_run: bool,
    requester_ip: str,
) -> dict[str, Any]:
    """Block all distinct source_ips matching threat-log filters.

    Filters on columns that exist in security_threat_logs:
    severity_level, source_ip, timestamp (date_from/date_to), q.
    ``classification`` is accepted in the dict but IGNORED (column does not
    exist on the running DB — migration 62 was never applied).

    Dry-run returns aggregate counts without side effects.
    Execute caps at 500 IPs (synchronous path safety). Per-IP logic
    delegates to ``block_ip`` (allowlist, self-IP, repeat-offender, audit).
    """
    where: list[str] = []
    params: dict[str, Any] = {}

    if filters.get("severity"):
        sevs = [
            s.strip()
            for s in (
                filters["severity"].split(",")
                if isinstance(filters["severity"], str)
                else filters["severity"]
            )
            if s.strip()
        ]
        if len(sevs) == 1:
            where.append("severity_level = :sev0")
            params["sev0"] = sevs[0]
        else:
            placeholders = ",".join(f"sev{i}" for i in range(len(sevs)))
            where.append(f"severity_level IN ({placeholders})")
            for i, s in enumerate(sevs):
                params[f"sev{i}"] = s

    if filters.get("source_ip"):
        where.append("source_ip = :source_ip")
        params["source_ip"] = filters["source_ip"]

    if filters.get("date_from"):
        where.append("timestamp >= :date_from")
        params["date_from"] = filters["date_from"]

    if filters.get("date_to"):
        where.append("timestamp <= :date_to")
        params["date_to"] = filters["date_to"]

    if filters.get("q"):
        where.append("(raw_payload ILIKE :q OR xai_narrative ILIKE :q)")
        params["q"] = f"%{filters['q']}%"

    # NOTE: ``classification`` column does NOT exist on the running DB
    # (migration 62 never applied).  Intentionally omitted.  If a future
    # migration adds it, restore::
    #
    #   if filters.get("classification"):
    #       where.append("classification = :classification")
    #       params["classification"] = filters["classification"]

    where_sql = (" WHERE " + " AND ".join(where)) if where else ""

    rows = db.execute(
        text(f"SELECT DISTINCT source_ip FROM wims.security_threat_logs{where_sql}"),
        params,
    ).fetchall()

    distinct_ips = [r[0] for r in rows if r[0]]

    # Partition: self-IP and allowlisted are excluded
    skipped_self = 0
    skipped_allowlist = 0
    candidates: list[str] = []

    for ip in distinct_ips:
        if ip == requester_ip:
            skipped_self += 1
            continue
        if _is_allowlisted(db, ip):
            skipped_allowlist += 1
            continue
        candidates.append(ip)

    if dry_run:
        threshold = _get_repeat_offender_threshold(db)
        repeat_offenders = 0
        for ip in candidates:
            c = (
                db.execute(
                    text("SELECT COUNT(*) FROM wims.ip_blocklist WHERE source_ip = :ip"),
                    {"ip": ip},
                ).scalar()
                or 0
            )
            if c >= threshold:
                repeat_offenders += 1

        return {
            "dry_run": True,
            "total_distinct_ips": len(distinct_ips),
            "would_block": len(candidates),
            "repeat_offenders": repeat_offenders,
            "skipped_self": skipped_self,
            "skipped_allowlist": skipped_allowlist,
            "capped_at": 500,
        }

    # Execute: cap at first 500
    capped = len(candidates) > 500
    to_block = candidates[:500]

    blocked_count = 0
    permanent_count = 0
    already_blocked = 0

    for ip in to_block:
        res = await block_ip(
            db,
            ip,
            blocked_by,
            f"filter block: {filters}",
            None,
            24,
            requester_ip,
        )
        if res.get("already_active"):
            already_blocked += 1
        else:
            blocked_count += 1
            if res.get("is_permanent"):
                permanent_count += 1

    return {
        "dry_run": False,
        "total_distinct_ips": len(distinct_ips),
        "blocked_count": blocked_count,
        "permanent_count": permanent_count,
        "skipped_self": skipped_self,
        "skipped_allowlist": skipped_allowlist,
        "already_blocked": already_blocked,
        "capped": capped,
    }


async def resync_blocklist_to_redis() -> int:
    """Boot + periodic resync of active blocks from Postgres to Redis TTL keys.

    Uses a non-RLS engine connection (no role GUC available at boot / Celery).
    Reads ``DATABASE_ADMIN_URL`` first for RLS bypass, falls back to
    ``DATABASE_URL``.

    Returns the number of IPs restored to Redis.
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
        logger.warning("Redis unavailable — skip blocklist resync")
        return 0

    count = 0
    now = datetime.now(timezone.utc)
    try:
        with _resync_engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT source_ip, expires_at, is_permanent "
                    "FROM wims.ip_blocklist "
                    "WHERE is_active = true "
                    "AND (expires_at IS NULL OR expires_at > now())"
                )
            ).fetchall()

        for row in rows:
            ip, expires_at, is_permanent = row[0], row[1], row[2]
            try:
                if is_permanent or expires_at is None:
                    await r.set(f"ip:block:{ip}", "1")
                else:
                    remaining = int((expires_at - now).total_seconds())
                    if remaining > 0:
                        await r.set(f"ip:block:{ip}", "1", ex=remaining)
                count += 1
            except Exception as e:
                logger.warning("Resync Redis SET failed for %s: %s", ip, e)
    except Exception as e:
        logger.warning("Blocklist resync query failed: %s", e)
    finally:
        try:
            await r.aclose()
        except Exception:
            pass

    return count


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
