# Actionable Threat Monitoring + IP Blocklist with Repeat-Offender Escalation

**Date:** 2026-06-22
**Status:** Approved (pending spec review)
**Target branch:** `master` (also runs on `wimsbfp.tech` VPS — prod-safe)
**Motivation:** The `/admin/monitoring` threat-log table is read-only. The XAI narrative tells the System Admin *what happened* and *who did it* (source_ip) but offers no enforcement lever — the admin cannot stop the attacker, record a verdict, escalate, or dismiss. With **25,229 HIGH threats** detected (1,261 pages at `PAGE_SIZE=20`), per-row actions alone are insufficient; the admin needs bulk and filter-scoped actions to triage at scale.

## Goal

Make `/admin/monitoring` threat-log rows actionable so the XAI narrative leads to enforcement, not just awareness. Handle the 25k-scale with bulk + filter-scoped actions, and auto-escalate repeat-offender IPs to permanent blocks.

## Non-goals (explicitly out of scope)

- Analyze (regenerate XAI narrative) and related-audit drill-downs — belong on the detail view (`/admin/system`), not the monitoring dashboard.
- "Unreviewed only" filter — minor convenience, not the core action loop.
- Auto-block on XAI confidence threshold — dangerous automation for a prototype; a wrong narrative auto-blocks a legit IP. Human in the loop only.
- GeoIP-based blocking, SIEM integration, email/SMS alerts — separate systems, large scope.
- Per-SID "block all" — the filter-scoped block (S3) covers the practical case.

## Existing surface (verified)

### Backend (`src/backend/api/routes/admin/security.py`)
- `GET /security-logs` (line 54) — paginated, filters: `severity` (comma-joined), `source_ip`, `date_from`, `date_to`, `q`, `classification`. Returns `{items, total, limit, offset}`.
- `GET /security-logs/summary` (line 176) — `by_severity`, `unreviewed_count`, `total`, `recent_narratives`.
- `POST /security-logs/{log_id}/analyze` (line 233) — regenerate XAI narrative.
- `PATCH /security-logs/{log_id}` (line 243) — HITL decision: `action ∈ {CONFIRM_THREAT, FALSE_POSITIVE, REQUEST_MORE_INFO}`, optional `note`. Sets `admin_action_taken`, `hitl_decision` JSONB, `resolved_at` (for CONFIRM/FALSE_POSITIVE), `reviewed_by`.
- `POST /security-logs/{log_id}/create-incident` (line 453) — create DRAFT fire incident from alert; 409 if one already exists (`_security_incident_exists`).
- `GET /security-logs/{log_id}/related-audit` (line 528) — related audit evidence.
- **No DELETE endpoint exists** — needs building.
- **No blocklist exists** — needs building.
- `VALID_HITL_ACTIONS = ("CONFIRM_THREAT", "FALSE_POSITIVE", "REQUEST_MORE_INFO")` (line 25).
- `HITL_ACTION_LABELS` (line 40) maps actions to human-readable labels.
- `log_system_audit()` helper used throughout (lines 311, 358, 498).
- `get_system_admin` dependency for SYSTEM_ADMIN-only routes.

### Client IP extraction (reuse pattern from `src/backend/main.py:769-773`)
```python
client_ip = request.headers.get("x-forwarded-for")
if client_ip:
    client_ip = client_ip.split(",")[0].strip()
else:
    client_ip = request.client.host if request.client else "unknown"
```
`X-Real-IP` should be checked as a fallback before `request.client.host` (nginx-gateway sets it).

### Redis patterns (reuse)
- `REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")` (`services/event_bus.py:23`).
- Async client via `redis.asyncio` with connection pool (`services/event_bus.py:_get_async_pool`).
- Sync client via `redis.ConnectionPool` (`services/event_bus.py`).
- Rate limiter fails open if Redis down (`main.py:765-767`) — blocklist middleware matches this.

### Frontend (`src/frontend/src/app/admin/monitoring/page.tsx`)
- `ThreatLogItem` interface (line 35): `{log_id, timestamp, source_ip, severity_level, suricata_sid, admin_action_taken, xai_confidence}`.
- `SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'` (line 19, local type).
- `PAGE_SIZE = 20` (line 79).
- Filters: **severity chips only** (`activeSeverities`, line 66). No source-IP, date, or search filters (the `/admin/system` page has these — port them).
- Threat-log row (lines 485-515): **read-only**. 6 columns: timestamp, source_ip, severity chip, SID, Reviewed/Pending badge, XAI confidence. **Zero action buttons.**
- XAI narrative panel (lines 540-615): renders `parsed.anomalyDescription / parsed.riskAssessment / parsed.recommendedAction` — the narrative is informational only, no action affordance.
- `loadThreats` (line 112) calls `fetchAdminSecurityLogsOfflineAware` with `severity`, `limit`, `offset`.

### Frontend API client (`src/frontend/src/lib/api/legacy.ts`)
- `analyzeSecurityLog(logId)` (line 368) — existing.
- `updateAdminSecurityLog(...)` (line 378) — existing (HITL PATCH).
- `fetchRelatedAuditLogs(logId)` (line 415) — existing.
- **No block/unblock/list-blocked client functions** — needs building.
- **No delete-security-log client function** — needs building.

### Database
- Highest migration: `64_consent_log_ip_hash.sql`. Next: `65_ip_blocklist.sql`.
- `security_threat_logs` has FKs referenced by: `34_security_incident.sql` (incident→log_id) and `52_breach_notifications.sql` (breach→log_id). **Hard delete would FK-violate** → soft-delete only.
- RLS pattern: `ENABLE ROW LEVEL SECURITY` + admin-only policies (`10_rls_policies.sql`).

## Design

### Data model — new migration `src/postgres-init/65_ip_blocklist.sql`

```sql
-- 65_ip_blocklist.sql
-- IP blocklist for admin threat-response actions. Source of truth in Postgres
-- (durable repeat-offender count + audit trail), fast lookup in Redis set.
-- Repeat-offender escalation: 3rd block → permanent (confirmed attacker/bot).

CREATE TABLE IF NOT EXISTS wims.ip_blocklist (
    block_id        SERIAL PRIMARY KEY,
    source_ip       TEXT NOT NULL,
    blocked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,                      -- NULL = permanent
    is_permanent    BOOLEAN NOT NULL DEFAULT false,
    blocked_by      UUID,                             -- admin user_id
    block_reason    TEXT,                             -- e.g. "HIGH threat filter", "manual row block", "bulk block"
    threat_log_id   INTEGER,                          -- which alert triggered it (nullable for bulk/filter blocks)
    is_active       BOOLEAN NOT NULL DEFAULT true,    -- soft unblock (keep history)
    block_count     INTEGER NOT NULL DEFAULT 1        -- incremented on re-block (for repeat-offender escalation)
);

CREATE INDEX IF NOT EXISTS idx_ip_blocklist_source_ip ON wims.ip_blocklist(source_ip);
CREATE INDEX IF NOT EXISTS idx_ip_blocklist_active ON wims.ip_blocklist(is_active) WHERE is_active = true;

ALTER TABLE wims.ip_blocklist ENABLE ROW LEVEL SECURITY;

-- SYSTEM_ADMIN-only: full access. All other roles: no access.
-- Mirrors the existing pattern in 10_rls_policies.sql using wims.current_user_role().
CREATE POLICY ip_blocklist_admin_all ON wims.ip_blocklist
    FOR ALL
    USING (wims.current_user_role() IN ('SYSTEM_ADMIN'))
    WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN'));

-- Repeat-offender threshold is configurable via system_config (default 3).
INSERT INTO wims.system_config (config_key, config_value, description)
VALUES ('ip_blocklist.repeat_offender_threshold', '3', 'Number of times an IP is blocked before being marked permanent (confirmed attacker/bot).')
ON CONFLICT (config_key) DO NOTHING;
```

**Notes:**
- `is_active=false` on unblock (soft, keeps history for the `block_count` repeat-offender logic).
- `block_count` counts all blocks (active + historical) for that `source_ip`.
- Repeat-offender check: `SELECT COUNT(*) FROM wims.ip_blocklist WHERE source_ip = :ip` (all rows, not just active) → if `>= threshold`, `is_permanent=true, expires_at=NULL`.
- The `system_config` row for the threshold is read at block time; admin can tune it.

### Redis blocklist set

- Key: `ip:blocklist` (Redis SET of active IPs).
- On block: `SADD ip:blocklist {ip}`. If TTL (not permanent): `SETEX ip:blocklist:ttl:{ip} {ttl_seconds} {ip}` (separate key with expiry; middleware checks both).
- On unblock: `SREM ip:blocklist {ip}`, `DEL ip:blocklist:ttl:{ip}`.
- On app boot: resync from Postgres (`SELECT source_ip FROM ip_blocklist WHERE is_active=true AND (expires_at IS NULL OR expires_at > now())`).
- **Simpler TTL approach (chosen):** store `expires_at` in Postgres as source of truth; middleware checks Redis SET for fast path, then falls back to a Postgres `expires_at > now()` check if the IP is in the set. This avoids Redis TTL-key drift. Redis SET is a cache of active IPs; periodic resync keeps it fresh. **Fail-open if Redis down** (matches rate limiter).

### Backend — new service: `src/backend/services/ip_blocklist.py`

```python
# Core functions (async, reuse redis.asyncio pool):
async def block_ip(ip: str, blocked_by: uuid, reason: str, threat_log_id: int | None, ttl_hours: int | None) -> dict
    # 1. Check self-IP guard (caller passes requesting admin IP) → raise if match
    # 2. Query repeat-offender count: SELECT COUNT(*) FROM ip_blocklist WHERE source_ip = :ip
    # 3. Read threshold from system_config (default 3)
    # 4. If count >= threshold → is_permanent=true, expires_at=NULL
    #    Else → is_permanent=false, expires_at = now() + interval 'ttl_hours hours' (24h default; NULL if ttl_hours is None = manual permanent)
    # 5. INSERT into ip_blocklist (block_count = count + 1, or 1 if first)
    # 6. SADD ip:blocklist {ip} (Redis)
    # 7. log_system_audit(action_type="BLOCK_SOURCE_IP", table_affected="ip_blocklist", ...)
    # 8. Return {ip, is_permanent, expires_at, block_count, repeat_offender: bool}

async def unblock_ip(ip: str, unblocked_by: uuid) -> dict
    # 1. UPDATE ip_blocklist SET is_active=false WHERE source_ip=:ip AND is_active=true
    # 2. SREM ip:blocklist {ip}
    # 3. log_system_audit(action_type="UNBLOCK_IP", ...)
    # 4. Return {ip, unblocked_rows}

async def list_blocked_ips() -> list[dict]
    # SELECT source_ip, blocked_at, expires_at, is_permanent, block_count, blocked_by
    # WHERE is_active=true ORDER BY blocked_at DESC

async def is_ip_blocked(ip: str) -> bool
    # Redis SISMEMBER fast path; if Redis down, fail open (return false).
    # (Middleware uses this; periodic resync keeps Redis fresh.)

async def block_ips_by_filter(filters: dict, blocked_by: uuid, dry_run: bool) -> dict
    # 1. SELECT DISTINCT source_ip FROM security_threat_logs WHERE <filters>
    # 2. Filter out requesting admin's own IP (self-IP guard)
    # 3. If dry_run: return {total_ips, repeat_offenders: count, would_be_permanent: count}
    # 4. Else: for each IP, call block_ip (reuse repeat-offender logic per IP)
    # 5. Return {blocked_count, permanent_count, skipped_self, already_blocked}
```

### Backend — new endpoints (all SYSTEM_ADMIN-only, audit-logged)

**New route file `src/backend/api/routes/admin/ip_blocklist.py`** (mounted at `/api/admin/ip-blocklist` via `admin/__init__.py`). The block/unblock/list endpoints live here (distinct resource). The `block-source-ip`, `block-by-filter`, `bulk-action`, and `DELETE /security-logs/{log_id}` endpoints live in the existing `src/backend/api/routes/admin/security.py` (they operate on `security_threat_logs` rows).

| Endpoint | Body / Params | Behavior |
|---|---|---|
| `POST /api/admin/security-logs/{log_id}/block-source-ip` | `{ttl_hours?: int\|"permanent"}` (default 24) | Read row's `source_ip`; self-IP guard; repeat-offender check; block; audit `BLOCK_SOURCE_IP`; set `admin_action_taken="Blocked IP"` on the threat row. |
| `POST /api/admin/security-logs/block-by-filter` | `{severity?, source_ip?, date_from?, date_to?, q?, classification?}` + `?preview=true` for dry-run | `SELECT DISTINCT source_ip FROM security_threat_logs WHERE <filters>`; self-IP guard per IP; repeat-offender logic per IP; audit `BLOCK_BY_FILTER` with full IP list in `new_values`. Preview returns counts only. |
| `POST /api/admin/security-logs/bulk-action` | `{log_ids: int[], action: "block_ip"\|"dismiss"\|"false_positive", ttl_hours?: int\|"permanent"}` | One transaction: apply action to each `log_id`. For `block_ip`: block each row's IP. For `dismiss`: soft-delete (`resolved_at=now(), admin_action_taken='Dismissed'`). For `false_positive`: `PATCH`-style HITL. One audit row with full `log_ids` in `new_values`. |
| `DELETE /api/admin/security-logs/{log_id}` | — | Soft-delete: `resolved_at=now(), admin_action_taken='Dismissed'`; audit `DELETE_SECURITY_LOG` (action_type despite soft-delete, for audit clarity). 404 if not found. |
| `DELETE /api/admin/ip-blocklist/{ip}` | — | Unblock: `is_active=false`, `SREM`; audit `UNBLOCK_IP`. |
| `GET /api/admin/ip-blocklist` | `?include_inactive=false` (default) | List blocked IPs with `block_count`, `expires_at`, `is_permanent`, `blocked_by`. |

**Self-IP guard** (shared helper):
```python
def _get_request_client_ip(request: Request) -> str:
    ip = request.headers.get("x-forwarded-for")
    if ip:
        return ip.split(",")[0].strip()
    ip = request.headers.get("x-real-ip")
    if ip:
        return ip.strip()
    return request.client.host if request.client else "unknown"

# In block endpoints:
if source_ip == _get_request_client_ip(request):
    raise HTTPException(400, "Cannot block your own IP address")
```

### Backend — new middleware: `BlockedIPMiddleware`

In `src/backend/main.py`, registered before route dispatch (after the rate limiter):

```python
@app.middleware("http")
async def blocked_ip_middleware(request: Request, call_next):
    # Skip health checks and auth endpoints (so a blocked IP can still... actually no.
    # A blocked IP should be blocked from everything except /health for monitoring.)
    if request.url.path in ("/health", "/api/v1/public/health"):
        return await call_next(request)
    client_ip = _get_request_client_ip(request)  # reuse the helper
    r = await _get_redis()
    if r is None:
        return await call_next(request)  # fail open (Redis down ≠ site down)
    if await r.sismember("ip:blocklist", client_ip):
        return JSONResponse(status_code=403, content={"detail": "IP blocked by admin action"})
    return await call_next(request)
```

- Fail-open if Redis down (matches rate limiter, `main.py:765-767`).
- Returns 403 JSON `{detail: "IP blocked by admin action"}`.
- `/health` exempt (monitoring).
- Auth endpoints NOT exempt (a blocked attacker can't even log in).

### Frontend — `/admin/monitoring` changes only (`system/page.tsx` untouched)

#### New filters (ported from `/admin/system`)
- Source-IP text input
- Date-from, date-to date inputs
- Search box (`q`)
- These feed into `loadThreats` via the existing `fetchAdminSecurityLogsOfflineAware` params (`severity`, `source_ip`, `date_from`, `date_to`, `q`).

#### Per-row actions (4 groups)
| Group | UI | Calls |
|---|---|---|
| HITL verdict (3-button group) | Confirm Threat / False Positive / Request More Info buttons | existing `updateAdminSecurityLog({action, note?})` |
| Block Source IP | button + confirm dialog (shows repeat-offender status if known) | new `blockSourceIp(logId, {ttl_hours})` |
| Create Incident | button + confirm | existing `createSecurityIncident(logId)` (or the existing client fn name) |
| Delete Alert (soft) | button + confirm ("Dismiss this alert? It will be marked dismissed and kept for audit.") | new `deleteSecurityLog(logId)` |

On success: toast, row badge updates (Reviewed → Confirmed/False Positive/Blocked/Dismissed), `loadThreats()` refetch.

#### Bulk actions (S2)
- Per-row checkboxes + "Select all on page" checkbox in table header.
- When ≥1 selected, a **Bulk action bar** appears: **Block Selected IPs** / **Dismiss Selected** / **Mark False Positive**.
- Calls new `bulkActionSecurityLogs({log_ids, action, ttl_hours?})`.
- Confirm dialog shows count.

#### Filter-scoped action (S3)
- Above the table: **"Block all IPs in current filter"** button (visible when any filter is active).
- Two-step: first calls `blockByFilter(filters, {preview: true})` → confirm dialog shows "This will block **N** IPs. **M** are repeat offenders and will be blocked permanently." → on confirm, calls `blockByFilter(filters, {preview: false})`.
- Shows result toast: "Blocked N IPs (M permanent, K skipped as your own IP)."

#### Blocked IPs panel (below the table)
- Fetches `GET /api/admin/ip-blocklist`.
- Lists: IP, blocked_at, expires_at (or "Permanent"), block_count, blocked_by, reason.
- **Unblock** button per row.
- Repeat-offenders (`block_count >= 3`) flagged with a red "Confirmed Attacker" badge.
- Not offline-aware (writes only; list is a plain fetch).

### New frontend API client functions (`src/frontend/src/lib/api/legacy.ts` or new `src/frontend/src/lib/api/securityActions.ts`)
```typescript
blockSourceIp(logId: number, opts?: { ttl_hours?: number | "permanent" }): Promise<BlockResult>
deleteSecurityLog(logId: number): Promise<{ status: "ok" }>
bulkActionSecurityLogs(body: { log_ids: number[]; action: "block_ip" | "dismiss" | "false_positive"; ttl_hours?: number | "permanent" }): Promise<BulkResult>
blockByFilter(filters: SecurityLogFilter, opts: { preview: boolean }): Promise<BlockByFilterResult>
listBlockedIps(): Promise<BlockedIp[]>
unblockIp(ip: string): Promise<{ status: "ok" }>
```
Types added to `src/frontend/src/types/api.ts`:
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
}
export interface BlockByFilterResult {
  blocked_count: number;
  permanent_count: number;
  skipped_self: number;
  already_blocked: number;
}
// (BulkResult, SecurityLogFilter similar)
```

## Error handling

- **Self-IP block attempt** → 400 `{detail: "Cannot block your own IP address"}`. Frontend shows error toast.
- **Block-by-filter dry-run** → 200 with counts, no side effects.
- **Redis down** → middleware fails open (site stays up); block writes still go to Postgres (Redis resyncs on next boot or next successful write).
- **Repeat-offender threshold misconfigured** → falls back to default 3, logs a warning.
- **Soft-delete on a row already dismissed** → idempotent (no error, audit still written).
- **Bulk action with empty `log_ids`** → 400 `{detail: "log_ids must not be empty"}`.
- **Block-by-filter with no matching IPs** → 200 `{blocked_count: 0, ...}` (not an error).

## Testing (TDD — red-green-refactor)

### Backend pytest (`src/backend/tests/`)
- `test_block_source_ip`: block → IP in Redis + Postgres; audit row written; `admin_action_taken="Blocked IP"`.
- `test_block_self_ip`: 400, no Redis/Postgres write.
- `test_repeat_offender_escalation`: block IP twice → 24h TTL; block third time → permanent (`is_permanent=true, expires_at=NULL`). Verify `block_count` increments.
- `test_unblock_ip`: `is_active=false`, removed from Redis.
- `test_blocked_ip_middleware_403`: blocked IP → 403; unblocked → through.
- `test_middleware_fail_open_redis_down`: mock Redis None → request passes.
- `test_block_by_filter_dry_run`: returns counts, no Postgres writes.
- `test_block_by_filter_execute`: blocks N distinct IPs, self-IP skipped, repeat-offenders permanent, audit row with IP list.
- `test_bulk_action_block`: bulk block N rows → all IPs blocked, one audit row.
- `test_bulk_action_dismiss`: bulk dismiss → all rows `resolved_at=now(), admin_action_taken='Dismissed'`.
- `test_delete_security_log_soft`: `resolved_at` set, row still exists, audit written.
- `test_rls_non_admin_blocked`: non-SYSTEM_ADMIN role → 403 on all blocklist endpoints.
- `test_list_blocked_ips`: returns active blocks with `block_count`.

### Frontend vitest (`src/app/admin/monitoring/`)
Mirror the existing `admin-security-monitoring.test.tsx` mock pattern:
- Row renders 4 action groups.
- HITL buttons call `updateAdminSecurityLog` with correct `action`.
- Block Source IP: confirm dialog → `blockSourceIp` → toast → refetch.
- Delete Alert: confirm → `deleteSecurityLog` → toast → refetch.
- Create Incident: confirm → existing client fn → toast.
- Bulk: select rows → bulk bar → `bulkActionSecurityLogs` with correct `log_ids`.
- Filter-scoped block: set filter → click "Block all IPs" → preview count shown → confirm → `blockByFilter` execute → result toast.
- Blocked IPs panel: renders list → unblock button → `unblockIp` → list refreshes → repeat-offender badge on `block_count >= 3`.
- Self-IP block: backend returns 400 → error toast shown.

### CI pre-flight (exact commands, gotcha #12)
1. `cd src/backend && ruff check .` → 0
2. `cd src/backend && ruff format --check .` → 0
3. `cd src/backend && pytest -v` → all pass
4. `cd src/frontend && npm run lint` → 0
5. `cd src/frontend && npx vitest run` → all pass
6. `cd src/frontend && NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth NEXT_PUBLIC_BASE_URL=http://localhost:3000 npm run build` → 0

## Safety (prod-safe for `wimsbfp.tech`)

- **Self-IP guard** on all block endpoints (no self-lockout).
- **24h TTL default** (permanent only via repeat-offender escalation at threshold 3, or manual "permanent" toggle).
- **Unblock always available** from the Blocked IPs panel.
- **S3 confirm dialog shows exact count** before execution (no surprise mass-blocks); dry-run preview is mandatory before execute.
- **Soft-delete** preserves the forensic audit trail (no hard delete, avoids FK violations on `34_security_incident` and `52_breach_notifications`).
- **Fail-open middleware** (Redis down ≠ site down).
- **RLS** on `ip_blocklist` (SYSTEM_ADMIN-only).
- **Audit-logged** end-to-end (every block/unblock/delete/bulk/filter action writes a `system_audit_trails` row).

## Wiki updates (per AGENTS.md mandatory rule)

1. `system-wiki/log.md` — new feature entry (this spec implemented).
2. `system-wiki/backend/api-route-map.md` — 6 new routes (block-source-ip, block-by-filter, bulk-action, DELETE security-log, DELETE/GET ip-blocklist).
3. `system-wiki/database/schema-overview.md` — new `ip_blocklist` table + migration `65`.
4. `system-wiki/security/security-baseline.md` — IP blocklist + repeat-offender escalation + BlockedIPMiddleware.
5. `system-wiki/gaps/frs-codebase-gap-register.md` — closes "XAI narrative not actionable" gap; note FRS doesn't specify IP blocking (genuine product gap, not a missed FRS requirement).

## Build order (for the implementation plan)

1. **Migration `65_ip_blocklist.sql`** + RLS + `system_config` row.
2. **Backend service `services/ip_blocklist.py`** (block/unblock/list/is_blocked/block_by_filter, repeat-offender logic, Redis sync).
3. **Backend endpoints** (6 new): `block-source-ip`, `block-by-filter`, `bulk-action`, `DELETE /security-logs/{log_id}` in `api/routes/admin/security.py`; `DELETE /ip-blocklist/{ip}`, `GET /ip-blocklist` in new `api/routes/admin/ip_blocklist.py` (mounted via `admin/__init__.py`).
4. **Backend middleware** `BlockedIPMiddleware` in `main.py`.
5. **Backend pytest** — all test cases above; run `ruff check`, `ruff format`, `pytest`.
6. **Frontend types** in `types/api.ts` + API client functions in `legacy.ts`/`securityActions.ts`.
7. **Frontend filters** ported to `/admin/monitoring`.
8. **Frontend per-row actions** (HITL group + Block + Create Incident + Delete).
9. **Frontend bulk actions** (checkboxes + bulk bar).
10. **Frontend filter-scoped block** (S3 preview + execute).
11. **Frontend Blocked IPs panel**.
12. **Frontend vitest** — all test cases above.
13. **CI pre-flight** — all 6 gates.
14. **Wiki + gap-register updates** + commit.

## Open questions

None — all decisions locked:
- Layer: A (app/Redis + Postgres source of truth).
- Scope: per-row + bulk + filter-scoped.
- TTL: 24h default, permanent via repeat-offender (threshold 3) or manual toggle.
- Delete: soft-delete.
- HITL verdict: 3-button group on row.
- Self-IP guard: yes.
- Target: local + prod (`wimsbfp.tech`), prod-safe.
- Button label: "Block Source IP".
- Repeat-offender threshold: 3 (configurable via `system_config`).
