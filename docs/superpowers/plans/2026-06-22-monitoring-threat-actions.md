# Actionable Threat Monitoring + IP Blocklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/admin/monitoring` threat-log rows actionable (Block IP, HITL verdict, Create Incident, Delete Alert) with bulk + filter-scoped actions and a repeat-offender-escalating IP blocklist, so the XAI narrative leads to enforcement.

**Architecture:** Postgres `ip_blocklist` table (durable write-path + repeat-offender count + audit) + Redis native TTL keys (`ip:block:{ip}`, hot-path source of truth, zero Postgres in middleware) + FastAPI `BlockedIPMiddleware` (403, fail-open) + 6 new SYSTEM_ADMIN endpoints + Celery periodic resync. Frontend adds filters + 4 per-row action groups + bulk bar + filter-scoped block + Blocked IPs panel on `/admin/monitoring` only.

**Tech Stack:** FastAPI, SQLAlchemy (raw `text()` queries matching existing pattern), `redis.asyncio`, PostgreSQL 15 + PostGIS, RLS (`wims.current_user_role()`), Next.js 16 App Router, TypeScript, Vitest, pytest, ruff.

**Spec:** `docs/superpowers/specs/2026-06-22-monitoring-threat-actions-design.md` (read fully before starting).

## Global Constraints

- Python 3.10+, 4-space indent, `snake_case`, typed FastAPI signatures, `ruff format` before commit.
- TypeScript/React: `PascalCase` components, `camelCase` fns, colocate tests, ESLint conventions.
- All backend blocklist service functions take `db: Session` from `Depends(get_db_with_rls)` — RLS `WITH CHECK` requires the role GUC. Never create a standalone session.
- Client-IP extraction uses `X-Real-IP` first (nginx-set, not spoofable). **Never** parse `X-Forwarded-For` leftmost.
- Redis is hot-path source of truth (`SET ip:block:{ip} "1" EX {ttl}`); Postgres is write-path. Zero Postgres queries in middleware.
- Fail-open if Redis down (matches `main.py:765-767`).
- Soft-delete only (no hard delete — FK violations on `34_security_incident`, `52_breach_notifications`).
- TDD: failing test → run-fail → implement → run-pass → commit. Every task.
- CI pre-flight (6 gates): `ruff check`, `ruff format --check`, `pytest`, `npm run lint`, `vitest run`, `next build` (with `NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth NEXT_PUBLIC_BASE_URL=http://localhost:3000`).
- Arch Linux: activate `.venv` before pytest (`python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`).

---

## File Structure

**Create:**
- `src/postgres-init/65_ip_blocklist.sql` — table + RLS + system_config rows
- `src/backend/services/ip_blocklist.py` — block/unblock/list/block_by_filter + Redis sync + repeat-offender logic
- `src/backend/api/routes/admin/ip_blocklist.py` — DELETE/GET ip-blocklist endpoints
- `src/backend/tests/test_ip_blocklist_service.py` — service unit tests
- `src/backend/tests/test_ip_blocklist_api.py` — endpoint + middleware tests
- `src/frontend/src/lib/api/securityActions.ts` — new API client fns (block/unblock/list/delete/bulk/blockByFilter)
- `src/frontend/src/app/admin/monitoring/BlockedIpsPanel.tsx` — blocked IPs panel component

**Modify:**
- `src/backend/api/routes/admin/security.py` — add block-source-ip, block-by-filter, bulk-action, DELETE security-log endpoints
- `src/backend/api/routes/admin/__init__.py` — mount new ip_blocklist router
- `src/backend/main.py` — add BlockedIPMiddleware + boot resync call
- `src/backend/celery_config.py` — add periodic resync beat task (5 min)
- `src/frontend/src/types/api.ts` — add BlockedIp, BlockResult, BlockByFilterResult, BulkResult, SecurityLogFilter types
- `src/frontend/src/app/admin/monitoring/page.tsx` — filters + per-row actions + bulk + S3 + panel mount
- `src/frontend/src/app/admin/monitoring/admin-security-monitoring.test.tsx` — new action tests

**Untouched:** `src/frontend/src/app/admin/system/page.tsx`, existing `SecurityLog` interface, existing rate limiter XFF parse (out of scope).

---

## Task 1: Migration — ip_blocklist table + RLS + config

**Files:**
- Create: `src/postgres-init/65_ip_blocklist.sql`
- Test: manual — `docker compose down -v && docker compose up --build -d` applies it; verify with `psql`

**Interfaces:**
- Produces: `wims.ip_blocklist` table (block_id, source_ip, blocked_at, expires_at, is_permanent, blocked_by, block_reason, threat_log_id, is_active), RLS policy `ip_blocklist_admin_all`, `system_config` rows `ip_blocklist.repeat_offender_threshold`=3 and `ip_blocklist.allowlist`='127.0.0.1,::1'.

- [ ] **Step 1: Write the migration**

Create `src/postgres-init/65_ip_blocklist.sql`:
```sql
-- 65_ip_blocklist.sql
-- IP blocklist for admin threat-response actions. Postgres = durable write-path
-- (repeat-offender count + audit trail); Redis ip:block:{ip} = hot-path lookup.
-- Repeat-offender escalation: 3rd block episode → permanent (confirmed attacker/bot).
-- Idempotent: YES

BEGIN;

CREATE TABLE IF NOT EXISTS wims.ip_blocklist (
    block_id        SERIAL PRIMARY KEY,
    source_ip       TEXT NOT NULL,
    blocked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,                      -- NULL = permanent
    is_permanent    BOOLEAN NOT NULL DEFAULT false,
    blocked_by      UUID,                             -- admin user_id
    block_reason    TEXT,                             -- e.g. "HIGH threat filter", "manual row block", "bulk block"
    threat_log_id   INTEGER,                          -- which alert triggered it (nullable for bulk/filter blocks)
    is_active       BOOLEAN NOT NULL DEFAULT true     -- soft unblock (keep history for repeat-offender counting)
);

CREATE INDEX IF NOT EXISTS idx_ip_blocklist_source_ip ON wims.ip_blocklist(source_ip);
CREATE INDEX IF NOT EXISTS idx_ip_blocklist_active ON wims.ip_blocklist(is_active) WHERE is_active = true;

ALTER TABLE wims.ip_blocklist ENABLE ROW LEVEL SECURITY;

-- SYSTEM_ADMIN-only: full access. Mirrors 10_rls_policies.sql pattern.
DROP POLICY IF EXISTS ip_blocklist_admin_all ON wims.ip_blocklist;
CREATE POLICY ip_blocklist_admin_all ON wims.ip_blocklist
    FOR ALL
    USING (wims.current_user_role() IN ('SYSTEM_ADMIN'))
    WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN'));

INSERT INTO wims.system_config (config_key, config_value, description)
VALUES ('ip_blocklist.repeat_offender_threshold', '3', 'Number of distinct block episodes for an IP before it is marked permanent (confirmed attacker/bot).')
ON CONFLICT (config_key) DO NOTHING;

INSERT INTO wims.system_config (config_key, config_value, description)
VALUES ('ip_blocklist.allowlist', '127.0.0.1,::1', 'Comma-separated IPs/CIDRs that must never be blocked (other admins, monitors, VPS egress). Checked by middleware and block endpoints.')
ON CONFLICT (config_key) DO NOTHING;

COMMIT;
```

- [ ] **Step 2: Apply locally and verify**

Run:
```bash
cd src && docker compose down -v && docker compose up --build -d
# wait for postgres healthy
docker compose exec -T postgres psql -U postgres -d wims -c "\d wims.ip_blocklist"
docker compose exec -T postgres psql -U postgres -d wims -c "SELECT config_key, config_value FROM wims.system_config WHERE config_key LIKE 'ip_blocklist%';"
```
Expected: table columns match spec; 2 config rows present.

- [ ] **Step 3: Commit**

```bash
git add src/postgres-init/65_ip_blocklist.sql
git commit -m "feat(db): migration 65 — ip_blocklist table + RLS + config rows"
```

---

## Task 2: Backend service — ip_blocklist.py (block/unblock/list)

**Files:**
- Create: `src/backend/services/ip_blocklist.py`
- Test: `src/backend/tests/test_ip_blocklist_service.py`

**Interfaces:**
- Consumes: `get_db_with_rls` session (from `api/deps`), `log_system_audit(db, user_id, action_type, table_affected, record_id, request=, new_values=)`, `redis.asyncio` pool (pattern from `services/event_bus.py:_get_async_pool`), `wims.system_config` reads.
- Produces:
  - `async def block_ip(db, ip, blocked_by, reason, threat_log_id, ttl_hours, requester_ip) -> dict`
  - `async def unblock_ip(db, ip, unblocked_by) -> dict`
  - `async def list_blocked_ips(db) -> list[dict]`
  - `def _get_request_client_ip(request) -> str` (X-Real-IP first)
  - `def _is_allowlisted(db, ip) -> bool`
  - `def _get_repeat_offender_threshold(db) -> int`
  - `async def _redis_set_block(ip, ttl_seconds, is_permanent) -> None`
  - `async def _redis_del_block(ip) -> None`

- [ ] **Step 1: Write failing tests for block_ip + unblock_ip + list + guards**

Create `src/backend/tests/test_ip_blocklist_service.py`:
```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4
from services.ip_blocklist import block_ip, unblock_ip, list_blocked_ips, _get_request_client_ip, _is_allowlisted

@pytest.fixture
def db():
    m = MagicMock()
    m.execute = MagicMock()
    m.commit = MagicMock()
    return m

@pytest.fixture
def admin_id():
    return uuid4()

@pytest.mark.asyncio
async def test_block_ip_inserts_row_and_redis(db, admin_id):
    db.execute.side_effect = [
        MagicMock(fetchone=MagicMock(return_value=None)),       # already-active check
        MagicMock(scalar=MagicMock(return_value=0)),            # repeat-offender count
        MagicMock(scalar=MagicMock(return_value="3")),          # threshold
        MagicMock(),                                             # INSERT
    ]
    with patch("services.ip_blocklist._redis_set_block", new=AsyncMock()) as rset, \
         patch("services.ip_blocklist.log_system_audit"):
        result = await block_ip(db, "1.2.3.4", admin_id, "manual", None, 24, "9.9.9.9")
    assert result["ip"] == "1.2.3.4"
    assert result["is_permanent"] is False
    assert result["already_active"] is False
    rset.assert_awaited_once()

@pytest.mark.asyncio
async def test_block_self_ip_raises(db, admin_id):
    with pytest.raises(ValueError, match="Cannot block your own IP"):
        await block_ip(db, "1.2.3.4", admin_id, "manual", None, 24, "1.2.3.4")

@pytest.mark.asyncio
async def test_block_allowlisted_ip_raises(db, admin_id):
    db.execute.side_effect = [MagicMock(scalar=MagicMock(return_value="127.0.0.1,::1,1.2.3.4"))]
    with pytest.raises(ValueError, match="never-block allowlist"):
        await block_ip(db, "1.2.3.4", admin_id, "manual", None, 24, "9.9.9.9")

@pytest.mark.asyncio
async def test_block_already_active_noop(db, admin_id):
    db.execute.side_effect = [MagicMock(fetchone=MagicMock(return_value=("existing",)))]
    with patch("services.ip_blocklist._redis_set_block", new=AsyncMock()) as rset, \
         patch("services.ip_blocklist.log_system_audit") as audit:
        result = await block_ip(db, "1.2.3.4", admin_id, "manual", None, 24, "9.9.9.9")
    assert result["already_active"] is True
    rset.assert_not_awaited()
    audit.assert_not_called()

@pytest.mark.asyncio
async def test_repeat_offender_escalation(db, admin_id):
    # count=2 (2 prior episodes), threshold=3 → 3rd block is permanent
    db.execute.side_effect = [
        MagicMock(fetchone=MagicMock(return_value=None)),       # not already active
        MagicMock(scalar=MagicMock(return_value=2)),            # count
        MagicMock(scalar=MagicMock(return_value="3")),          # threshold
        MagicMock(),                                             # INSERT
    ]
    with patch("services.ip_blocklist._redis_set_block", new=AsyncMock()) as rset, \
         patch("services.ip_blocklist.log_system_audit"):
        result = await block_ip(db, "1.2.3.4", admin_id, "manual", None, 24, "9.9.9.9")
    assert result["is_permanent"] is True
    assert result["repeat_offender"] is True
    # permanent → no EX
    args = rset.await_args
    assert args.kwargs.get("is_permanent") is True or "EX" not in str(args)

def test_get_request_client_ip_uses_xreal_ip():
    req = MagicMock()
    req.headers = {"x-real-ip": "5.5.5.5", "x-forwarded-for": "9.9.9.9, 5.5.5.5"}
    assert _get_request_client_ip(req) == "5.5.5.5"

def test_get_request_client_ip_falls_back_to_client_host():
    req = MagicMock()
    req.headers = {}
    req.client.host = "7.7.7.7"
    assert _get_request_client_ip(req) == "7.7.7.7"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/backend && source ../../.venv/bin/activate 2>/dev/null; pytest tests/test_ip_blocklist_service.py -v`
Expected: FAIL (ModuleNotFoundError: services.ip_blocklist)

- [ ] **Step 3: Implement the service**

Create `src/backend/services/ip_blocklist.py`:
```python
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

logger = logging.getLogger("wims.ip_blocklist")

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
_async_pool: aioredis.ConnectionPool | None = None


async def _get_async_pool() -> aioredis.ConnectionPool:
    global _async_pool
    if _async_pool is None:
        _async_pool = aioredis.ConnectionPool.from_url(REDIS_URL, decode_responses=True, max_connections=20)
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
    row = db.execute(
        text("SELECT config_value FROM wims.system_config WHERE config_key = 'ip_blocklist.allowlist'")
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
    val = db.execute(
        text("SELECT config_value FROM wims.system_config WHERE config_key = 'ip_blocklist.repeat_offender_threshold'")
    ).scalar()
    try:
        n = int(val)
        return n if n > 0 else 3
    except (TypeError, ValueError):
        return 3


async def _redis_set_block(ip: str, ttl_seconds: int | None, is_permanent: bool) -> None:
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
    # 1. Allowlist
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
    count = db.execute(
        text("SELECT COUNT(*) FROM wims.ip_blocklist WHERE source_ip = :ip"),
        {"ip": ip},
    ).scalar() or 0
    # 5. Threshold
    threshold = _get_repeat_offender_threshold(db)
    # 6. Determine permanence
    is_permanent = (count >= threshold) or (ttl_hours is None)
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
        text("""
            INSERT INTO wims.ip_blocklist (source_ip, blocked_at, expires_at, is_permanent, blocked_by, block_reason, threat_log_id, is_active)
            VALUES (:ip, :now, :expires_at, :is_permanent, :blocked_by, :reason, :threat_log_id, true)
            RETURNING block_id
        """),
        {"ip": ip, "now": now, "expires_at": expires_at, "is_permanent": is_permanent,
         "blocked_by": str(blocked_by), "reason": reason, "threat_log_id": threat_log_id},
    )
    block_id = result.scalar()
    db.commit()
    # 8. Best-effort Redis (after commit)
    await _redis_set_block(ip, ttl_seconds, is_permanent)
    # 9. Audit (caller passes request; here we skip request for service-level testability)
    from services.audit import log_system_audit
    log_system_audit(
        db, blocked_by, "BLOCK_SOURCE_IP", "ip_blocklist", block_id,
        new_values={"ip": ip, "is_permanent": is_permanent, "expires_at": expires_at.isoformat() if expires_at else None, "reason": reason},
    )
    db.commit()
    return {
        "ip": ip, "is_permanent": is_permanent, "expires_at": expires_at.isoformat() if expires_at else None,
        "block_count": count + 1, "repeat_offender": count >= threshold, "already_active": False,
    }


async def unblock_ip(db: Session, ip: str, unblocked_by: UUID) -> dict[str, Any]:
    result = db.execute(
        text("UPDATE wims.ip_blocklist SET is_active = false WHERE source_ip = :ip AND is_active = true"),
        {"ip": ip},
    )
    rows = result.rowcount
    db.commit()
    await _redis_del_block(ip)
    from services.audit import log_system_audit
    log_system_audit(db, unblocked_by, "UNBLOCK_IP", "ip_blocklist", None, new_values={"ip": ip, "rows": rows})
    db.commit()
    return {"ip": ip, "unblocked_rows": rows}


async def list_blocked_ips(db: Session) -> list[dict[str, Any]]:
    rows = db.execute(
        text("""
            SELECT source_ip, blocked_at, expires_at, is_permanent, blocked_by, block_reason
            FROM wims.ip_blocklist WHERE is_active = true ORDER BY blocked_at DESC
        """)
    ).fetchall()
    out = []
    for r in rows:
        count = db.execute(
            text("SELECT COUNT(*) FROM wims.ip_blocklist WHERE source_ip = :ip"),
            {"ip": r[0]},
        ).scalar() or 0
        out.append({
            "source_ip": r[0], "blocked_at": r[1].isoformat() if r[1] else None,
            "expires_at": r[2].isoformat() if r[2] else None, "is_permanent": r[3],
            "blocked_by": str(r[4]) if r[4] else None, "block_reason": r[5],
            "block_count": count,
        })
    return out
```

> **Note:** The `log_system_audit` import path — verify the actual location before finalizing. The existing `security.py` uses it directly (imported at top). Check `src/backend/services/` for the module, or if it's imported from `api/routes/admin/security.py` directly. Adjust the import to match the codebase.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/backend && pytest tests/test_ip_blocklist_service.py -v`
Expected: PASS (all 7 tests)

- [ ] **Step 5: ruff format + commit**

```bash
cd src/backend && ruff format services/ip_blocklist.py tests/test_ip_blocklist_service.py
ruff check services/ip_blocklist.py tests/test_ip_blocklist_service.py
git add src/backend/services/ip_blocklist.py src/backend/tests/test_ip_blocklist_service.py
git commit -m "feat(backend): ip_blocklist service — block/unblock/list + repeat-offender escalation"
```

---

## Task 3: Backend service — block_by_filter + resync

**Files:**
- Modify: `src/backend/services/ip_blocklist.py` (add block_by_filter, resync_blocklist)
- Test: `src/backend/tests/test_ip_blocklist_service.py` (append)

**Interfaces:**
- Produces:
  - `async def block_ips_by_filter(db, filters, blocked_by, dry_run, requester_ip) -> dict`
  - `async def resync_blocklist_to_redis() -> int` (boot + periodic)

- [ ] **Step 1: Write failing tests**

Append to `test_ip_blocklist_service.py`:
```python
@pytest.mark.asyncio
async def test_block_by_filter_dry_run_returns_counts(db, admin_id):
    db.execute.side_effect = [
        MagicMock(fetchall=MagicMock(return_value=[("1.1.1.1",), ("2.2.2.2",), ("3.3.3.3",)])),  # distinct IPs
        MagicMock(scalar=MagicMock(return_value="127.0.0.1,::1")),  # allowlist
    ]
    with patch("services.ip_blocklist.block_ip", new=AsyncMock()) as blk:
        result = await block_ips_by_filter(db, {"severity": "HIGH"}, admin_id, dry_run=True, requester_ip="9.9.9.9")
    assert result["total_distinct_ips"] == 3
    assert result["dry_run"] is True
    blk.assert_not_awaited()

@pytest.mark.asyncio
async def test_block_by_filter_execute_caps_at_500(db, admin_id):
    ips = [(f"10.0.0.{i}",) for i in range(600)]
    db.execute.side_effect = [
        MagicMock(fetchall=MagicMock(return_value=ips)),
        MagicMock(scalar=MagicMock(return_value="127.0.0.1,::1")),
    ]
    with patch("services.ip_blocklist.block_ip", new=AsyncMock(return_value={"already_active": False})) as blk:
        result = await block_ips_by_filter(db, {"severity": "HIGH"}, admin_id, dry_run=False, requester_ip="9.9.9.9")
    assert result["capped"] is True
    assert result["blocked_count"] == 500
    assert result["total_distinct_ips"] == 600

@pytest.mark.asyncio
async def test_block_by_filter_skips_self_and_allowlisted(db, admin_id):
    db.execute.side_effect = [
        MagicMock(fetchall=MagicMock(return_value=[("9.9.9.9",), ("1.2.3.4",), ("127.0.0.1",)])),
        MagicMock(scalar=MagicMock(return_value="127.0.0.1,::1")),
    ]
    with patch("services.ip_blocklist.block_ip", new=AsyncMock(return_value={"already_active": False})) as blk:
        result = await block_ips_by_filter(db, {}, admin_id, dry_run=False, requester_ip="9.9.9.9")
    assert result["skipped_self"] == 1
    assert result["skipped_allowlist"] == 1
    assert result["blocked_count"] == 1  # only 1.2.3.4
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_ip_blocklist_service.py::test_block_by_filter_dry_run_returns_counts -v`
Expected: FAIL (ImportError: block_ips_by_filter)

- [ ] **Step 3: Implement block_by_filter + resync**

Append to `services/ip_blocklist.py`:
```python
async def block_ips_by_filter(
    db: Session,
    filters: dict[str, Any],
    blocked_by: UUID,
    dry_run: bool,
    requester_ip: str,
) -> dict[str, Any]:
    where = []
    params: dict[str, Any] = {}
    if filters.get("severity"):
        sevs = filters["severity"].split(",") if isinstance(filters["severity"], str) else filters["severity"]
        if len(sevs) == 1:
            where.append("severity_level = :sev0")
            params["sev0"] = sevs[0].strip()
        else:
            placeholders = ",".join(f":sev{i}" for i in range(len(sevs)))
            where.append(f"severity_level IN ({placeholders})")
            for i, s in enumerate(sevs):
                params[f"sev{i}"] = s.strip()
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
    if filters.get("classification"):
        where.append("classification = :classification")
        params["classification"] = filters["classification"]
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    rows = db.execute(
        text(f"SELECT DISTINCT source_ip FROM wims.security_threat_logs{where_sql}"),
        params,
    ).fetchall()
    distinct_ips = [r[0] for r in rows if r[0]]
    allowlisted = [ip for ip in distinct_ips if _is_allowlisted(db, ip)]
    candidates = [ip for ip in distinct_ips if ip != requester_ip and ip not in allowlisted]
    if dry_run:
        repeat_offenders = 0
        threshold = _get_repeat_offender_threshold(db)
        for ip in candidates:
            c = db.execute(text("SELECT COUNT(*) FROM wims.ip_blocklist WHERE source_ip = :ip"), {"ip": ip}).scalar() or 0
            if c >= threshold:
                repeat_offenders += 1
        return {
            "dry_run": True, "total_distinct_ips": len(distinct_ips),
            "would_block": len(candidates), "repeat_offenders": repeat_offenders,
            "skipped_self": len([ip for ip in distinct_ips if ip == requester_ip]),
            "skipped_allowlist": len(allowlisted), "capped_at": 500,
        }
    capped = len(candidates) > 500
    to_block = candidates[:500]
    blocked_count = 0
    permanent_count = 0
    already_blocked = 0
    for ip in to_block:
        res = await block_ip(db, ip, blocked_by, f"filter block: {filters}", None, 24, requester_ip)
        if res.get("already_active"):
            already_blocked += 1
        else:
            blocked_count += 1
            if res["is_permanent"]:
                permanent_count += 1
    return {
        "dry_run": False, "total_distinct_ips": len(distinct_ips),
        "blocked_count": blocked_count, "permanent_count": permanent_count,
        "skipped_self": len([ip for ip in distinct_ips if ip == requester_ip]),
        "skipped_allowlist": len(allowlisted), "already_blocked": already_blocked,
        "capped": capped,
    }


async def resync_blocklist_to_redis() -> int:
    """Boot + periodic. Read active blocks from Postgres, restore Redis TTL keys."""
    from database import get_session_for_resync  # see Task 6; or use a plain session
    r = await _get_redis()
    if r is None:
        logger.warning("Redis unavailable — skip blocklist resync")
        return 0
    # Use a non-RLS session for resync (SYSTEM_ADMIN context not available at boot)
    from sqlalchemy import create_engine
    engine = create_engine(os.environ.get("DATABASE_URL", "postgresql://postgres:password@localhost:5432/wims"))
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT source_ip, expires_at, is_permanent FROM wims.ip_blocklist
            WHERE is_active = true AND (expires_at IS NULL OR expires_at > now())
        """)).fetchall()
    count = 0
    now = datetime.now(timezone.utc)
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
            logger.warning("Resync failed for %s: %s", ip, e)
    try:
        await r.aclose()
    except Exception:
        pass
    return count
```

> **Note:** The resync session handling — verify `database.py` for the right session factory. The resync runs at boot (no RLS context) so it needs a session that bypasses RLS (superuser/postgres role) or the table needs `BYPASSRLS`. Check how `services/event_bus.py` or celery tasks get their sessions and match that pattern. Adjust the import accordingly.

- [ ] **Step 4: Run tests + ruff + commit**

```bash
cd src/backend && pytest tests/test_ip_blocklist_service.py -v
ruff format services/ip_blocklist.py tests/test_ip_blocklist_service.py
ruff check services/ip_blocklist.py
git add -A && git commit -m "feat(backend): block_by_filter (500-IP cap) + blocklist resync"
```

---

## Task 4: Backend endpoints — block-source-ip, DELETE security-log, block-by-filter, bulk-action

**Files:**
- Modify: `src/backend/api/routes/admin/security.py`
- Test: `src/backend/tests/test_ip_blocklist_api.py`

**Interfaces:**
- Consumes: `services.ip_blocklist.block_ip`, `block_ips_by_filter`, `log_system_audit`, existing `get_system_admin`, `get_db_with_rls`, `VALID_HITL_ACTIONS`, `HITL_ACTION_LABELS`.
- Produces:
  - `POST /api/admin/security-logs/{log_id}/block-source-ip`
  - `POST /api/admin/security-logs/block-by-filter`
  - `POST /api/admin/security-logs/bulk-action`
  - `DELETE /api/admin/security-logs/{log_id}`
  - `def dismiss_security_log(db, log_id, admin_id)` (shared soft-delete helper)

- [ ] **Step 1: Write failing endpoint tests**

Create `src/backend/tests/test_ip_blocklist_api.py`:
```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
# Use the existing test client pattern from other admin tests in the repo.
# Check tests/test_admin_new_routes.py for the fixture pattern (TestClient + auth override).

@pytest.mark.asyncio
async def test_block_source_ip_endpoint_success():
    # Mock get_system_admin, get_db_with_rls, block_ip
    # POST /api/admin/security-logs/1/block-source-ip {"ttl_hours": 24}
    # Assert 200, response has ip/is_permanent/expires_at
    pass  # fill in using existing TestClient fixture pattern

@pytest.mark.asyncio
async def test_delete_security_log_soft_deletes():
    # DELETE /api/admin/security-logs/1
    # Assert row resolved_at set, admin_action_taken='Dismissed', audit written
    pass

@pytest.mark.asyncio
async def test_bulk_action_dismiss():
    # POST /api/admin/security-logs/bulk-action {"log_ids":[1,2,3], "action":"dismiss"}
    # Assert all 3 rows soft-deleted, one audit row
    pass

@pytest.mark.asyncio
async def test_block_by_filter_endpoint_preview():
    # POST /api/admin/security-logs/block-by-filter?preview=true {"severity":"HIGH"}
    # Assert 200, dry_run=True, total_distinct_ips present, no block_ip calls
    pass

def test_bulk_action_empty_log_ids_400():
    # POST with empty log_ids → 400
    pass
```

> **Note:** Fill in the test bodies using the existing TestClient + auth-override fixture pattern from `tests/test_admin_new_routes.py` (read that file for the exact fixture: `client` fixture, `override_get_system_admin`, etc.). The pass placeholders above must be replaced with real assertions before running.

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_ip_blocklist_api.py -v`
Expected: FAIL (endpoints don't exist)

- [ ] **Step 3: Implement endpoints**

Add to `src/backend/api/routes/admin/security.py` (after the existing `create-incident` endpoint, before `related-audit`):
```python
from services.ip_blocklist import block_ip, block_ips_by_filter, _get_request_client_ip
from pydantic import BaseModel

class BlockSourceIpBody(BaseModel):
    ttl_hours: int | str | None = 24  # "permanent" or hours

class BlockByFilterBody(BaseModel):
    severity: str | None = None
    source_ip: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    q: str | None = None
    classification: str | None = None

class BulkActionBody(BaseModel):
    log_ids: list[int]
    action: str  # "block_ip" | "dismiss" | "false_positive"
    ttl_hours: int | str | None = 24

@router.post("/security-logs/{log_id}/block-source-ip")
async def block_source_ip(
    log_id: int,
    body: BlockSourceIpBody,
    request: Request,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    row = db.execute(
        text("SELECT source_ip FROM wims.security_threat_logs WHERE log_id = :log_id"),
        {"log_id": log_id},
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Security log not found")
    source_ip = row[0]
    if not source_ip:
        raise HTTPException(status_code=400, detail="Alert has no source_ip")
    ttl = None if body.ttl_hours == "permanent" else (int(body.ttl_hours) if body.ttl_hours else 24)
    requester_ip = _get_request_client_ip(request)
    try:
        result = await block_ip(db, source_ip, _admin["user_id"], f"manual row block (log {log_id})", log_id, ttl, requester_ip)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Mark the threat row
    db.execute(
        text("UPDATE wims.security_threat_logs SET admin_action_taken = 'Blocked IP' WHERE log_id = :log_id"),
        {"log_id": log_id},
    )
    db.commit()
    return result

@router.post("/security-logs/block-by-filter")
async def block_by_filter(
    body: BlockByFilterBody,
    request: Request,
    preview: bool = False,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    filters = body.model_dump()
    requester_ip = _get_request_client_ip(request)
    result = await block_ips_by_filter(db, filters, _admin["user_id"], dry_run=preview, requester_ip=requester_ip)
    if not preview:
        log_system_audit(db, _admin["user_id"], "BLOCK_BY_FILTER", "ip_blocklist", None,
                         request=request, new_values={"filters": filters, "result": result})
        db.commit()
    return result

@router.post("/security-logs/bulk-action")
async def bulk_action(
    body: BulkActionBody,
    request: Request,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    if not body.log_ids:
        raise HTTPException(status_code=400, detail="log_ids must not be empty")
    requester_ip = _get_request_client_ip(request)
    results = []
    for lid in body.log_ids:
        if body.action == "block_ip":
            row = db.execute(text("SELECT source_ip FROM wims.security_threat_logs WHERE log_id = :lid"), {"lid": lid}).fetchone()
            if row and row[0]:
                ttl = None if body.ttl_hours == "permanent" else (int(body.ttl_hours) if body.ttl_hours else 24)
                try:
                    r = await block_ip(db, row[0], _admin["user_id"], f"bulk block (log {lid})", lid, ttl, requester_ip)
                    results.append({"log_id": lid, **r})
                except ValueError as e:
                    results.append({"log_id": lid, "error": str(e)})
        elif body.action == "dismiss":
            dismiss_security_log(db, lid, _admin["user_id"])
            results.append({"log_id": lid, "status": "dismissed"})
        elif body.action == "false_positive":
            db.execute(
                text("UPDATE wims.security_threat_logs SET admin_action_taken = 'False Positive (Dismissed)', resolved_at = now() WHERE log_id = :lid"),
                {"lid": lid},
            )
            results.append({"log_id": lid, "status": "false_positive"})
    log_system_audit(db, _admin["user_id"], "BULK_SECURITY_ACTION", "security_threat_logs", None,
                     request=request, new_values={"log_ids": body.log_ids, "action": body.action})
    db.commit()
    return {"results": results}

@router.delete("/security-logs/{log_id}")
def delete_security_log(
    log_id: int,
    request: Request,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    row = db.execute(text("SELECT 1 FROM wims.security_threat_logs WHERE log_id = :lid"), {"lid": log_id}).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Security log not found")
    dismiss_security_log(db, log_id, _admin["user_id"])
    log_system_audit(db, _admin["user_id"], "DELETE_SECURITY_LOG", "security_threat_logs", log_id, request=request,
                     new_values={"action": "soft_delete", "admin_action_taken": "Dismissed"})
    db.commit()
    return {"status": "ok", "log_id": log_id}

def dismiss_security_log(db: Session, log_id: int, admin_id) -> None:
    """Shared soft-delete helper — DELETE endpoint + bulk dismiss both call this."""
    db.execute(
        text("UPDATE wims.security_threat_logs SET resolved_at = now(), admin_action_taken = 'Dismissed' WHERE log_id = :lid"),
        {"lid": log_id},
    )
```

- [ ] **Step 4: Run tests + ruff + commit**

```bash
cd src/backend && pytest tests/test_ip_blocklist_api.py -v
ruff format api/routes/admin/security.py tests/test_ip_blocklist_api.py
ruff check api/routes/admin/security.py
git add -A && git commit -m "feat(backend): block-source-ip, block-by-filter, bulk-action, DELETE security-log endpoints"
```

---

## Task 5: Backend — ip_blocklist router (unblock + list)

**Files:**
- Create: `src/backend/api/routes/admin/ip_blocklist.py`
- Modify: `src/backend/api/routes/admin/__init__.py`
- Test: `src/backend/tests/test_ip_blocklist_api.py` (append)

**Interfaces:**
- Produces: `DELETE /api/admin/ip-blocklist/{ip}`, `GET /api/admin/ip-blocklist`

- [ ] **Step 1: Write failing tests**

Append:
```python
def test_unblock_endpoint():
    # DELETE /api/admin/ip-blocklist/1.2.3.4 → 200, is_active=false
    pass

def test_list_blocked_ips_endpoint():
    # GET /api/admin/ip-blocklist → 200, list with block_count
    pass

def test_ip_blocklist_rls_non_admin_403():
    # override auth to NATIONAL_VALIDATOR → 403
    pass
```

- [ ] **Step 2: Run to verify fail**

- [ ] **Step 3: Implement router + mount**

Create `src/backend/api/routes/admin/ip_blocklist.py`:
```python
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session
from services.ip_blocklist import unblock_ip, list_blocked_ips
# Reuse the same deps as security.py
from api.deps import get_system_admin, get_db_with_rls  # verify actual import path

router = APIRouter()

@router.delete("/{ip}")
async def unblock(
    ip: str,
    request: Request,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    result = await unblock_ip(db, ip, _admin["user_id"])
    if result["unblocked_rows"] == 0:
        raise HTTPException(status_code=404, detail="IP not actively blocked")
    return {"status": "ok", "ip": ip}

@router.get("")
def list_blocks(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    import asyncio
    return asyncio.run(list_blocked_ips(db))
```

> **Note:** `list_blocked_ips` is async but the endpoint can be sync using `asyncio.run` OR made async. Match the existing pattern in `security.py` (most endpoints there are sync `def`). If the router needs async, make the endpoint `async def` and `await list_blocked_ips(db)`. Verify and adjust.

Add to `src/backend/api/routes/admin/__init__.py`:
```python
from . import ip_blocklist
router.include_router(ip_blocklist.router, prefix="/ip-blocklist", tags=["admin-ip-blocklist"])
```

- [ ] **Step 4: Run + ruff + commit**

```bash
cd src/backend && pytest tests/test_ip_blocklist_api.py -v
ruff format api/routes/admin/ip_blocklist.py api/routes/admin/__init__.py
ruff check api/routes/admin/
git add -A && git commit -m "feat(backend): ip-blocklist router — unblock + list"
```

---

## Task 6: Backend — BlockedIPMiddleware + boot resync

**Files:**
- Modify: `src/backend/main.py`
- Test: `src/backend/tests/test_ip_blocklist_api.py` (append middleware tests)

**Interfaces:**
- Produces: `blocked_ip_middleware` in `main.py`, boot resync call.

- [ ] **Step 1: Write failing middleware tests**

Append:
```python
def test_blocked_ip_middleware_403():
    # mock Redis EXISTS returns 1 → 403
    pass

def test_middleware_fail_open_redis_down():
    # mock _get_redis returns None → request passes
    pass

def test_middleware_zero_postgres():
    # verify no db.execute called in middleware path
    pass

def test_middleware_health_exempt():
    # GET /health → passes even if blocked
    pass
```

- [ ] **Step 2: Run to verify fail**

- [ ] **Step 3: Implement middleware + boot resync**

Add to `src/backend/main.py` (after the rate limiter middleware, before route registration):
```python
from services.ip_blocklist import _get_request_client_ip, resync_blocklist_to_redis
from fastapi.responses import JSONResponse

@app.middleware("http")
async def blocked_ip_middleware(request: Request, call_next):
    if request.url.path in ("/health", "/api/v1/public/health"):
        return await call_next(request)
    client_ip = _get_request_client_ip(request)
    from services.ip_blocklist import _get_redis
    r = await _get_redis()
    if r is None:
        return await call_next(request)  # fail open
    try:
        if await r.exists(f"ip:block:{client_ip}"):
            return JSONResponse(status_code=403, content={"detail": "IP blocked by admin action"})
    except Exception:
        logger.warning("BlockedIPMiddleware Redis check failed — fail open")
    finally:
        try:
            await r.aclose()
        except Exception:
            pass
    return await call_next(request)

# Boot resync (add near the app startup, after Redis init)
@app.on_event("startup")
async def _resync_blocklist_on_boot():
    try:
        count = await resync_blocklist_to_redis()
        logger.info("Blocklist resync: %d IPs restored to Redis", count)
    except Exception as e:
        logger.warning("Boot blocklist resync failed: %s", e)
```

- [ ] **Step 4: Run + ruff + commit**

```bash
cd src/backend && pytest tests/test_ip_blocklist_api.py -v
ruff format main.py
ruff check main.py
git add -A && git commit -m "feat(backend): BlockedIPMiddleware (Redis EXISTS, fail-open) + boot resync"
```

---

## Task 7: Backend — Celery periodic resync (5 min)

**Files:**
- Modify: `src/backend/celery_config.py` (or `tasks/` — verify where beat tasks live)
- Test: verify beat schedule entry exists

- [ ] **Step 1: Add the beat task**

In `src/backend/celery_config.py` (or the tasks module), add:
```python
# In beat_schedule:
"resync-ip-blocklist": {
    "task": "tasks.resync_ip_blocklist",
    "schedule": 300.0,  # 5 minutes
},
```
And create the task wrapper in `src/backend/tasks/` (or inline):
```python
@celery_app.task(name="tasks.resync_ip_blocklist")
def resync_ip_blocklist_task():
    import asyncio
    from services.ip_blocklist import resync_blocklist_to_redis
    return asyncio.run(resync_blocklist_to_redis())
```

- [ ] **Step 2: Verify + ruff + commit**

```bash
cd src/backend && python -c "from celery_config import beat_schedule; assert 'resync-ip-blocklist' in beat_schedule"
ruff format celery_config.py tasks/
ruff check celery_config.py tasks/
git add -A && git commit -m "feat(backend): Celery beat — periodic blocklist resync (5min)"
```

---

## Task 8: Backend — full pytest gate

- [ ] **Step 1: Run full backend CI gates**

```bash
cd src/backend && source ../../.venv/bin/activate 2>/dev/null
ruff check .
ruff format --check .
pytest -v
```
Expected: all pass. Fix any failures before proceeding to frontend.

---

## Task 9: Frontend types + API client functions

**Files:**
- Modify: `src/frontend/src/types/api.ts`
- Create: `src/frontend/src/lib/api/securityActions.ts`
- Test: `src/frontend/src/lib/__tests__/securityActions.test.ts`

**Interfaces:**
- Produces types: `BlockedIp`, `BlockResult`, `BlockByFilterResult`, `BulkResult`, `SecurityLogFilter`
- Produces fns: `blockSourceIp`, `deleteSecurityLog`, `bulkActionSecurityLogs`, `blockByFilter`, `listBlockedIps`, `unblockIp`

- [ ] **Step 1: Write failing tests**

Create `src/frontend/src/lib/__tests__/securityActions.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { blockSourceIp, deleteSecurityLog, blockByFilter, listBlockedIps, unblockIp, bulkActionSecurityLogs } from '../securityActions';

vi.mock('../apiFetch', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../apiFetch';

beforeEach(() => vi.clearAllMocks());

describe('securityActions', () => {
  it('blockSourceIp POSTs to block endpoint', async () => {
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ip: '1.2.3.4', is_permanent: false });
    const result = await blockSourceIp(1, { ttl_hours: 24 });
    expect(apiFetch).toHaveBeenCalledWith('/admin/security-logs/1/block-source-ip', expect.objectContaining({ method: 'POST' }));
    expect(result.ip).toBe('1.2.3.4');
  });
  it('deleteSecurityLog DELETEs', async () => {
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' });
    await deleteSecurityLog(1);
    expect(apiFetch).toHaveBeenCalledWith('/admin/security-logs/1', expect.objectContaining({ method: 'DELETE' }));
  });
  it('blockByFilter with preview', async () => {
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue({ dry_run: true, total_distinct_ips: 5 });
    await blockByFilter({ severity: 'HIGH' }, { preview: true });
    expect(apiFetch).toHaveBeenCalledWith('/admin/security-logs/block-by-filter?preview=true', expect.objectContaining({ method: 'POST' }));
  });
  it('listBlockedIps GETs', async () => {
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue([{ source_ip: '1.2.3.4' }]);
    const result = await listBlockedIps();
    expect(result).toHaveLength(1);
  });
  it('unblockIp DELETEs', async () => {
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' });
    await unblockIp('1.2.3.4');
    expect(apiFetch).toHaveBeenCalledWith('/admin/ip-blocklist/1.2.3.4', expect.objectContaining({ method: 'DELETE' }));
  });
  it('bulkActionSecurityLogs POSTs', async () => {
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue({ results: [] });
    await bulkActionSecurityLogs({ log_ids: [1, 2], action: 'dismiss' });
    expect(apiFetch).toHaveBeenCalledWith('/admin/security-logs/bulk-action', expect.objectContaining({ method: 'POST', body: expect.any(String) }));
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd src/frontend && npx vitest run src/lib/__tests__/securityActions.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Add types + implement client fns**

Add to `src/frontend/src/types/api.ts`:
```typescript
export interface BlockedIp {
  source_ip: string;
  blocked_at: string | null;
  expires_at: string | null;
  is_permanent: boolean;
  block_count: number;
  blocked_by: string | null;
  block_reason: string | null;
}
export interface BlockResult {
  ip: string;
  is_permanent: boolean;
  expires_at: string | null;
  block_count: number;
  repeat_offender: boolean;
  already_active: boolean;
}
export interface BlockByFilterResult {
  dry_run: boolean;
  total_distinct_ips: number;
  blocked_count?: number;
  permanent_count?: number;
  skipped_self: number;
  skipped_allowlist: number;
  already_blocked?: number;
  capped?: boolean;
  would_block?: number;
  repeat_offenders?: number;
  capped_at?: number;
}
export interface BulkResult {
  results: Array<{ log_id: number; status?: string; error?: string; [k: string]: unknown }>;
}
export interface SecurityLogFilter {
  severity?: string;
  source_ip?: string;
  date_from?: string;
  date_to?: string;
  q?: string;
  classification?: string;
}
```

Create `src/frontend/src/lib/api/securityActions.ts`:
```typescript
import { apiFetch } from './apiFetch'; // verify actual path — check legacy.ts for the import
import type { BlockedIp, BlockResult, BlockByFilterResult, BulkResult, SecurityLogFilter } from '@/types/api';

export async function blockSourceIp(logId: number, opts?: { ttl_hours?: number | 'permanent' }): Promise<BlockResult> {
  return apiFetch(`/admin/security-logs/${logId}/block-source-ip`, {
    method: 'POST',
    body: JSON.stringify({ ttl_hours: opts?.ttl_hours ?? 24 }),
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function deleteSecurityLog(logId: number): Promise<{ status: 'ok'; log_id: number }> {
  return apiFetch(`/admin/security-logs/${logId}`, { method: 'DELETE' });
}

export async function blockByFilter(filters: SecurityLogFilter, opts: { preview: boolean }): Promise<BlockByFilterResult> {
  const qs = opts.preview ? '?preview=true' : '';
  return apiFetch(`/admin/security-logs/block-by-filter${qs}`, {
    method: 'POST',
    body: JSON.stringify(filters),
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function bulkActionSecurityLogs(body: { log_ids: number[]; action: 'block_ip' | 'dismiss' | 'false_positive'; ttl_hours?: number | 'permanent' }): Promise<BulkResult> {
  return apiFetch('/admin/security-logs/bulk-action', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function listBlockedIps(): Promise<BlockedIp[]> {
  return apiFetch('/admin/ip-blocklist');
}

export async function unblockIp(ip: string): Promise<{ status: 'ok'; ip: string }> {
  return apiFetch(`/admin/ip-blocklist/${encodeURIComponent(ip)}`, { method: 'DELETE' });
}
```

> **Note:** Verify `apiFetch` import path — check `src/frontend/src/lib/api/legacy.ts` line 1 for how it imports `apiFetch` (could be `./apiFetch` or `../apiFetch` or from an index). Match it.

- [ ] **Step 4: Run + lint + commit**

```bash
cd src/frontend && npx vitest run src/lib/__tests__/securityActions.test.ts
npm run lint
git add -A && git commit -m "feat(frontend): securityActions API client + BlockedIp types"
```

---

## Task 10: Frontend — BlockedIpsPanel component

**Files:**
- Create: `src/frontend/src/app/admin/monitoring/BlockedIpsPanel.tsx`
- Test: `src/frontend/src/app/admin/monitoring/BlockedIpsPanel.test.tsx`

- [ ] **Step 1: Write failing test**

Create `BlockedIpsPanel.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BlockedIpsPanel } from './BlockedIpsPanel';

vi.mock('@/lib/api/securityActions', () => ({
  listBlockedIps: vi.fn().mockResolvedValue([
    { source_ip: '1.2.3.4', blocked_at: '2026-01-01T00:00:00Z', expires_at: null, is_permanent: true, block_count: 3, blocked_by: 'admin', block_reason: 'repeat offender' },
    { source_ip: '5.5.5.5', blocked_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-02T00:00:00Z', is_permanent: false, block_count: 1, blocked_by: 'admin', block_reason: 'manual' },
  ]),
  unblockIp: vi.fn().mockResolvedValue({ status: 'ok', ip: '1.2.3.4' }),
}));

describe('BlockedIpsPanel', () => {
  it('renders blocked IPs with repeat-offender badge', async () => {
    render(<BlockedIpsPanel onUnblocked={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('1.2.3.4')).toBeInTheDocument());
    expect(screen.getByText('Confirmed Attacker')).toBeInTheDocument();
    expect(screen.getByText('5.5.5.5')).toBeInTheDocument();
  });
  it('unblock button calls unblockIp', async () => {
    const onUnblocked = vi.fn();
    render(<BlockedIpsPanel onUnblocked={onUnblocked} />);
    await waitFor(() => screen.getByText('1.2.3.4'));
    fireEvent.click(screen.getAllByRole('button', { name: /unblock/i })[0]);
    await waitFor(() => expect(onUnblocked).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run to verify fail**

- [ ] **Step 3: Implement the panel**

Create `BlockedIpsPanel.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { listBlockedIps, unblockIp } from '@/lib/api/securityActions';
import type { BlockedIp } from '@/types/api';

export function BlockedIpsPanel({ onUnblocked }: { onUnblocked?: () => void }) {
  const [blocks, setBlocks] = useState<BlockedIp[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setBlocks(await listBlockedIps());
    } catch {
      setBlocks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleUnblock = async (ip: string) => {
    if (!confirm(`Unblock ${ip}?`)) return;
    await unblockIp(ip);
    await load();
    onUnblocked?.();
  };

  if (loading) return <div className="card-body text-sm">Loading blocked IPs…</div>;
  if (blocks.length === 0) return <div className="card-body text-sm">No IPs currently blocked.</div>;

  return (
    <div className="card">
      <div className="card-body">
        <div className="text-sm font-semibold mb-3">Blocked IPs ({blocks.length})</div>
        <div className="space-y-2">
          {blocks.map((b) => (
            <div key={b.source_ip} className="flex items-center justify-between p-2 rounded" style={{ backgroundColor: 'var(--table-header-bg)' }}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">{b.source_ip}</span>
                {b.block_count >= 3 && <span className="text-xs font-semibold text-red-600">Confirmed Attacker</span>}
                <span className="text-xs text-gray-500">{b.is_permanent ? 'Permanent' : `Expires ${b.expires_at ? new Date(b.expires_at).toLocaleString() : ''}`}</span>
              </div>
              <button onClick={() => handleUnblock(b.source_ip)} className="px-2 py-1 text-xs rounded" style={{ backgroundColor: 'var(--bfp-maroon)', color: '#fff' }}>Unblock</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run + lint + commit**

```bash
cd src/frontend && npx vitest run src/app/admin/monitoring/BlockedIpsPanel.test.tsx
npm run lint
git add -A && git commit -m "feat(frontend): BlockedIpsPanel — list + unblock + repeat-offender badge"
```

---

## Task 11: Frontend — monitoring page filters + per-row actions

**Files:**
- Modify: `src/frontend/src/app/admin/monitoring/page.tsx`
- Test: `src/frontend/src/app/admin/monitoring/admin-security-monitoring.test.tsx` (extend)

**Interfaces:**
- Consumes: `securityActions` fns, existing `updateAdminSecurityLog`, existing create-incident client fn, `BlockedIpsPanel`.

- [ ] **Step 1: Write failing tests for new actions**

Extend `admin-security-monitoring.test.tsx` — add mocks for `securityActions` and tests:
- Row renders Block Source IP / Confirm Threat / False Positive / Request More Info / Create Incident / Delete buttons
- Block Source IP click → confirm → `blockSourceIp` called → toast → refetch
- Delete Alert click → confirm → `deleteSecurityLog` called → toast → refetch
- HITL Confirm Threat click → `updateAdminSecurityLog({ action: 'CONFIRM_THREAT' })`
- Self-IP block (backend 400) → error toast

> Follow the existing mock pattern in that file (lines 40-75): `vi.mock('@/lib/api/securityActions', () => ({...}))`. Read the existing test file fully before writing.

- [ ] **Step 2: Run to verify fail**

- [ ] **Step 3: Add filters + per-row actions to page.tsx**

Add new filter state (source_ip, date_from, date_to, q) mirroring `/admin/system` lines 219-227. Feed into `loadThreats` params. Add a 7th column "Actions" to the threat-log table (`page.tsx:485-515`) with 4 button groups:
- HITL 3-button group: Confirm Threat / False Positive / Request More Info → `updateAdminSecurityLog({ action, note? })`
- Block Source IP → `blockSourceIp(log.log_id, { ttl_hours: 24 })` + confirm dialog
- Create Incident → existing client fn + confirm
- Delete Alert → `deleteSecurityLog(log.log_id)` + confirm

Add handlers (`handleBlock`, `handleHitl`, `handleCreateIncident`, `handleDelete`) with toast + `loadThreats()` refetch on success. On 400 (self-IP/allowlist) → error toast with `detail`.

- [ ] **Step 4: Run + lint + commit**

```bash
cd src/frontend && npx vitest run src/app/admin/monitoring/admin-security-monitoring.test.tsx
npm run lint
git add -A && git commit -m "feat(frontend): monitoring filters + per-row actions (block/HITL/incident/delete)"
```

---

## Task 12: Frontend — bulk actions + filter-scoped block

**Files:**
- Modify: `src/frontend/src/app/admin/monitoring/page.tsx`
- Test: `src/frontend/src/app/admin/monitoring/admin-security-monitoring.test.tsx` (extend)

- [ ] **Step 1: Write failing tests**

- Bulk: select rows via checkboxes → bulk bar appears → "Block Selected" calls `bulkActionSecurityLogs` with selected `log_ids`
- Filter-scoped: set severity filter → "Block all IPs in current filter" → preview shows `total_distinct_ips` + cap warning → confirm → `blockByFilter(filters, {preview:false})` → result toast with `capped` message

- [ ] **Step 2: Run to verify fail**

- [ ] **Step 3: Implement bulk + S3**

Add per-row checkboxes + "Select all on page" + `selectedLogIds: Set<number>` state. Bulk bar (visible when `selectedLogIds.size > 0`) with 3 buttons calling `bulkActionSecurityLogs`.

Add "Block all IPs in current filter" button above table (visible when any filter active). Two-step: `blockByFilter(filters, {preview:true})` → confirm dialog showing counts + cap warning → `blockByFilter(filters, {preview:false})` → result toast.

- [ ] **Step 4: Run + lint + commit**

```bash
cd src/frontend && npx vitest run src/app/admin/monitoring/admin-security-monitoring.test.tsx
npm run lint
git add -A && git commit -m "feat(frontend): bulk actions + filter-scoped block (S3, 500-cap preview)"
```

---

## Task 13: Frontend — mount BlockedIpsPanel + final page wiring

**Files:**
- Modify: `src/frontend/src/app/admin/monitoring/page.tsx`

- [ ] **Step 1: Mount the panel**

Add `<BlockedIpsPanel onUnblocked={loadThreats} />` below the threat logs table (after the pagination div, before the XAI narratives section).

- [ ] **Step 2: Run all frontend tests + lint + commit**

```bash
cd src/frontend && npx vitest run
npm run lint
git add -A && git commit -m "feat(frontend): mount BlockedIpsPanel on monitoring page"
```

---

## Task 14: CI pre-flight — all 6 gates

- [ ] **Step 1: Run all backend gates**

```bash
cd src/backend && source ../../.venv/bin/activate 2>/dev/null
ruff check .
ruff format --check .
pytest -v
```
Expected: all pass.

- [ ] **Step 2: Run all frontend gates**

```bash
cd src/frontend
npm run lint
npx vitest run
NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth NEXT_PUBLIC_BASE_URL=http://localhost:3000 npm run build
```
Expected: all pass, build exit 0.

- [ ] **Step 3: Fix any failures, re-run until green**

---

## Task 15: Wiki + gap-register updates + final commit

**Files:**
- Modify: `system-wiki/log.md`
- Modify: `system-wiki/backend/api-route-map.md`
- Modify: `system-wiki/database/schema-overview.md`
- Modify: `system-wiki/security/security-baseline.md`
- Modify: `system-wiki/gaps/frs-codebase-gap-register.md`

- [ ] **Step 1: Update wiki pages**

Append `system-wiki/log.md` entry (newest at top):
```markdown
## [2026-06-22] feat(admin/monitoring): actionable threat rows + IP blocklist with repeat-offender escalation

- **Scope:** Make /admin/monitoring threat-log rows actionable so the XAI narrative leads to enforcement. 4 per-row actions (Block Source IP, HITL 3-button verdict, Create Incident, Delete Alert soft-delete), bulk actions, filter-scoped block (500-IP cap), Blocked IPs panel. New ip_blocklist table + Redis TTL keys + BlockedIPMiddleware (fail-open) + repeat-offender escalation (3rd block → permanent) + critical-IP allowlist + self-IP guard (X-Real-IP).
- **Backend:** 6 new endpoints, services/ip_blocklist.py, migration 65, Celery periodic resync (5min).
- **Frontend:** /admin/monitoring only (system/page.tsx untouched). New filters (source_ip, date, q). securityActions.ts client.
- **Security:** X-Real-IP not XFF (spoofable), Redis hot-path (zero Postgres in middleware), already-active no-op, allowlist, RLS via get_db_with_rls.
- **Validation:** ruff/pytest/vitest/lint/build all green.
- **Prod migration:** apply 65_ip_blocklist.sql manually to wimsbfp.tech (postgres-init is first-boot only).
```

Update `api-route-map.md` (6 new routes), `schema-overview.md` (ip_blocklist + migration 65), `security-baseline.md` (blocklist + middleware + repeat-offender + allowlist), `frs-codebase-gap-register.md` (closes "XAI narrative not actionable"; note FRS doesn't specify IP blocking — product gap).

- [ ] **Step 2: Commit**

```bash
git add system-wiki/
git commit -m "docs(wiki): actionable threat monitoring + IP blocklist (log + api-map + schema + security + gaps)"
```

---

## Self-Review (run after writing — done)

**Spec coverage:** ✅ Migration (Task 1), service block/unblock/list (T2), block_by_filter + resync (T3), 4 endpoints in security.py (T4), ip_blocklist router (T5), middleware + boot resync (T6), Celery resync (T7), backend gate (T8), frontend types+client (T9), panel (T10), filters+per-row (T11), bulk+S3 (T12), panel mount (T13), CI gates (T14), wiki (T15). All 15 build-order steps covered.

**Placeholder scan:** Tests in T4/T5/T6 have `pass` bodies with notes to fill from existing fixture patterns — these are flagged with `> **Note:**` instructions to read the referenced test files. This is acceptable because the worker must read `tests/test_admin_new_routes.py` for the exact TestClient + auth-override fixture (cannot be invented). All implementation code blocks are complete.

**Type consistency:** `BlockResult.already_active` (T9 type) matches `block_ip` return (T3). `BlockByFilterResult` fields match across T9 type + T3 return + T11/T12 usage. `BlockedIp.block_count` (derived) consistent across T9 type + T3 list + T10 panel. `securityActions` fn names (T9) match T11/T12 imports. `_get_request_client_ip` (T2) reused in T4/T6.

**Open implementation notes (worker must verify, not block on):**
1. `log_system_audit` import path — check `services/` or wherever `security.py` imports it.
2. `apiFetch` import path in `securityActions.ts` — check `legacy.ts` line 1.
3. `get_system_admin` / `get_db_with_rls` import path for `ip_blocklist.py` router — check `security.py` imports.
4. Resync session (RLS bypass at boot) — check how `celery_config.py` / `event_bus.py` get sessions.
5. `list_blocked_ips` async/sync endpoint style — match `security.py` convention.
6. Test fixture pattern — read `tests/test_admin_new_routes.py` before writing T4/T5/T6 tests.
