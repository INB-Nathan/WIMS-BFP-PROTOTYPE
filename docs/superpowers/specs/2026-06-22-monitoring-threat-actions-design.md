# Actionable Threat Monitoring + IP Blocklist with Repeat-Offender Escalation

**Date:** 2026-06-22
**Status:** Approved (pending spec review)
**Target branch:** `master` (also runs on `wimsbfp.tech` VPS — prod-safe)
**Motivation:** The `/admin/monitoring` threat-log table is read-only. The XAI narrative tells the System Admin *what happened* and *who did it* (source_ip) but offers no enforcement lever — the admin cannot record a verdict, escalate, dismiss, or deny the attacker access to the application. With **25,229 HIGH threats** detected (1,261 pages at `PAGE_SIZE=20`), per-row actions alone are insufficient; the admin needs bulk and filter-scoped actions to triage at scale.

## Goal

Make `/admin/monitoring` threat-log rows actionable so the XAI narrative leads to an application-level enforcement response, not just awareness. Handle the 25k-scale with bulk + filter-scoped actions, and auto-escalate repeat-offender IPs to permanent blocks.

## Framing (honest scope)

This is an **application-level authorization block**, not a volumetric DoS shield. A blocked IP is denied by the FastAPI middleware (403) after it has already passed through nginx and consumed a worker for the 403 response. It is a threat-response + audit + app-access-denial mechanism — the right layer for "make the XAI narrative actionable." Real volumetric shielding (nginx `deny` / iptables / WAF) is correctly a non-goal here. The motivation language does not claim to "stop the attacker" at the network edge.

> **Detection-noise flag (out of scope, noted):** 25,229 HIGH alerts likely signals noisy Suricata rules or scanner traffic, not 25k distinct human attackers. Mass filter-block amplifies whatever false-positive rate the rules have. The dry-run preview + 500-IP execution cap (see below) bound the blast radius, but investigating the detection-layer noise is a separate concern from this feature.

## Non-goals (explicitly out of scope)

- Analyze (regenerate XAI narrative) and related-audit drill-downs — belong on the detail view (`/admin/system`), not the monitoring dashboard.
- "Unreviewed only" filter — minor convenience, not the core action loop.
- Auto-block on XAI confidence threshold — dangerous automation for a prototype; a wrong narrative auto-blocks a legit IP. Human in the loop only.
- GeoIP-based blocking, SIEM integration, email/SMS alerts — separate systems, large scope.
- Per-SID "block all" — the filter-scoped block (S3) covers the practical case.
- **Volumetric DoS shielding** (nginx `deny` / iptables / WAF) — this is an app-layer block only. A blocked IP still hits nginx and consumes a worker for the 403.
- **Celery background bulk-blocking** (202 + task-poll) — the 500-IP execution cap makes the synchronous path safe; async bulk is a follow-up if the cap proves limiting.
- **Fixing the pre-existing XFF-parsing bug in the rate limiter** (`main.py:771`) — same latent spoofing bug, but out of scope for this feature; noted for a separate fix.

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

### Client IP extraction (**DO NOT reuse** the rate limiter's XFF pattern — spoofable)

The existing rate limiter at `src/backend/main.py:769-773` parses `X-Forwarded-For` leftmost:
```python
client_ip = request.headers.get("x-forwarded-for")
if client_ip:
    client_ip = client_ip.split(",")[0].strip()
else:
    client_ip = request.client.host if request.client else "unknown"
```
**This is the anti-pattern the blocklist must NOT copy.** Verified against the nginx configs:
- **Prod (`nginx.conf:82`):** `proxy_set_header X-Forwarded-For $remote_addr;` — nginx overwrites XFF with the realip-resolved IP. Leftmost XFF == real IP. *Not spoofable in prod.*
- **Local/CI (`nginx.local.conf:71`, `nginx.ci.conf:62`):** `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` — nginx *appends* to the client-sent chain. Leftmost XFF is client-controlled. *Spoofable in local/CI.*
- **All configs** set `proxy_set_header X-Real-IP $remote_addr;` — `X-Real-IP` is nginx-set and not client-appendable. **Trustworthy everywhere.**

The blocklist uses a new `_get_request_client_ip` helper that reads `X-Real-IP` first (see Backend section below). Fixing the rate limiter's latent XFF bug is out of scope (noted in non-goals).
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
    is_active       BOOLEAN NOT NULL DEFAULT true     -- soft unblock (keep history for repeat-offender counting)
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
VALUES ('ip_blocklist.repeat_offender_threshold', '3', 'Number of distinct block episodes for an IP before it is marked permanent (confirmed attacker/bot).')
ON CONFLICT (config_key) DO NOTHING;

-- Critical-IP allowlist: IPs/CIDRs that must never be blocked (other admins, uptime
-- monitors, VPS egress, health-checkers). Comma-separated. Checked by middleware
-- and all block endpoints. Important for NAT/CGNAT-heavy user bases (PH mobile nets).
INSERT INTO wims.system_config (config_key, config_value, description)
VALUES ('ip_blocklist.allowlist', '127.0.0.1,::1', 'Comma-separated IPs/CIDRs that must never be blocked (other admins, monitors, VPS egress). Checked by middleware and block endpoints.')
ON CONFLICT (config_key) DO NOTHING;
```

**Notes:**
- `is_active=false` on unblock (soft, keeps history for repeat-offender counting).
- **Repeat-offender count is DERIVED, not stored:** `SELECT COUNT(*) FROM wims.ip_blocklist WHERE source_ip = :ip` (counts all rows = all distinct block episodes, active + historical). Removed the `block_count` column to avoid two sources of truth. Each block is a separate row (one per episode); an unblock separates episodes.
- Repeat-offender check: `COUNT(*) >= threshold` → `is_permanent=true, expires_at=NULL`.
- The `system_config` rows for threshold + allowlist are read at block time; admin can tune them.
- **Already-active no-op:** if an active block exists for the IP (`is_active=true`), `block_ip` returns `{already_active: true}` and performs NO INSERT, NO count increment, NO audit. Prevents double-clicks and filter-duplicates from falsely escalating toward permanent.

### Redis blocklist — native TTL keys (hot-path source of truth)

**Redis is the absolute source of truth for active block status during a request. Zero Postgres queries in the middleware hot path.** Postgres `ip_blocklist` is the write-path + admin-read-path (repeat-offender count, audit, panel listing).

- Key: `ip:block:{ip}` (one key per blocked IP).
- **On block:** `SET ip:block:{ip} "1" EX {ttl_seconds}` (24h = 86400). If permanent: `SET ip:block:{ip} "1"` (no `EX` — lives until explicit `DEL`).
- **On unblock:** `DEL ip:block:{ip}`.
- **Middleware:** `if await r.exists(f"ip:block:{client_ip}"): return 403`. That's it — no Postgres, no TTL parsing, no SET membership. Redis native expiry handles the 24h timeout automatically.
- **On app boot:** resync from Postgres — `SELECT source_ip, expires_at, is_permanent FROM ip_blocklist WHERE is_active=true AND (expires_at IS NULL OR expires_at > now())`; for each, `SET ip:block:{ip} "1" EX {remaining_seconds}` (or no EX if permanent). Covers Redis data loss / restart.
- **Periodic resync** (Celery beat, reuses existing infra `celery_config.py:55`): every 5 min, same resync. Covers drift if a block write succeeded in Postgres but the Redis `SET` failed (best-effort Redis after Postgres commit; the brief window where a row is in Postgres but not yet Redis is acceptable for a prototype — the next resync closes it).
- **Fail-open if Redis down** (matches rate limiter, `main.py:765-767`): middleware passes the request through. Block writes still go to Postgres; resync restores Redis when it's back.

**Why not a Redis SET + Postgres fallback:** a Postgres `expires_at > now()` check per blocked request is a DDoS vector (connection-pool exhaustion by a blocked attacker flooding requests). Native Redis TTL keys self-expire with zero Postgres load.

### Backend — new service: `src/backend/services/ip_blocklist.py`

```python
# Core functions. ALL take a `db: Session` parameter passed from the route's
# Depends(get_db_with_rls) — the RLS policy WITH CHECK (wims.current_user_role()
# IN ('SYSTEM_ADMIN')) requires the session to have the role GUC set. Never
# create a standalone session for blocklist writes (the INSERT/UPDATE would fail
# the RLS policy). Reuse the same pattern as log_system_audit(db, ...).
# Redis via redis.asyncio pool (services/event_bus.py pattern). Redis writes are
# best-effort AFTER the Postgres commit; periodic resync covers drift.

async def block_ip(db: Session, ip: str, blocked_by: uuid, reason: str,
                   threat_log_id: int | None, ttl_hours: int | None,
                   requester_ip: str) -> dict
    # 1. Allowlist check: read ip_blocklist.allowlist from system_config; if ip
    #    matches any entry (IP or CIDR) → raise 400 "IP is on the never-block allowlist"
    # 2. Self-IP guard: if ip == requester_ip → raise 400 "Cannot block your own IP"
    # 3. Already-active no-op: SELECT 1 FROM ip_blocklist WHERE source_ip=:ip AND
    #    is_active=true → if exists, return {already_active: true} (NO INSERT, NO
    #    count increment, NO audit). Prevents double-click/filter-dup escalation.
    # 4. Query repeat-offender count: SELECT COUNT(*) FROM ip_blocklist WHERE
    #    source_ip = :ip (all rows, active + historical = distinct block episodes)
    # 5. Read threshold from system_config (ip_blocklist.repeat_offender_threshold, default 3)
    # 6. If count >= threshold → is_permanent=true, expires_at=NULL
    #    Else → is_permanent=false, expires_at = now() + interval 'ttl_hours hours'
    #    (24h default; ttl_hours=None means manual permanent → expires_at=NULL, is_permanent=true)
    # 7. INSERT into ip_blocklist (source_ip, blocked_by, block_reason, threat_log_id,
    #    is_permanent, expires_at, is_active=true)
    # 8. db.commit()  (Postgres is durable source of truth)
    # 9. Best-effort Redis: SET ip:block:{ip} "1" EX {ttl_seconds} (or no EX if permanent)
    # 10. log_system_audit(db, blocked_by, "BLOCK_SOURCE_IP", "ip_blocklist", block_id, ...)
    # 11. Return {ip, is_permanent, expires_at, block_count: count+1, repeat_offender: bool, already_active: false}

async def unblock_ip(db: Session, ip: str, unblocked_by: uuid) -> dict
    # 1. UPDATE ip_blocklist SET is_active=false WHERE source_ip=:ip AND is_active=true
    # 2. db.commit()
    # 3. Best-effort Redis: DEL ip:block:{ip}
    # 4. log_system_audit(db, unblocked_by, "UNBLOCK_IP", "ip_blocklist", ...)
    # 5. Return {ip, unblocked_rows}

async def list_blocked_ips(db: Session) -> list[dict]
    # SELECT source_ip, blocked_at, expires_at, is_permanent, blocked_by, block_reason
    # WHERE is_active=true ORDER BY blocked_at DESC
    # (block_count is derived per-row: SELECT COUNT(*) WHERE source_ip = row.source_ip)

async def block_ips_by_filter(db: Session, filters: dict, blocked_by: uuid,
                              dry_run: bool, requester_ip: str) -> dict
    # 1. SELECT DISTINCT source_ip FROM security_threat_logs WHERE <filters>
    # 2. Filter out: requester_ip (self-IP guard), allowlisted IPs, already-active IPs
    # 3. If dry_run: return {total_distinct_ips, would_block: len(after filters),
    #    repeat_offenders: count (those with COUNT(*) >= threshold), capped_at: 500}
    # 4. Else: cap to FIRST 500 IPs after filtering (hard limit — synchronous path;
    #    Celery 202+poll is out of scope). For each, call block_ip (reuse logic).
    # 5. Return {blocked_count, permanent_count, skipped_self, skipped_allowlist,
    #    already_blocked, capped: bool, total_distinct_ips}
```

### Backend — new endpoints (all SYSTEM_ADMIN-only, audit-logged)

**New route file `src/backend/api/routes/admin/ip_blocklist.py`** (mounted at `/api/admin/ip-blocklist` via `admin/__init__.py`). The block/unblock/list endpoints live here (distinct resource). The `block-source-ip`, `block-by-filter`, `bulk-action`, and `DELETE /security-logs/{log_id}` endpoints live in the existing `src/backend/api/routes/admin/security.py` (they operate on `security_threat_logs` rows).

| Endpoint | Body / Params | Behavior |
|---|---|---|
| `POST /api/admin/security-logs/{log_id}/block-source-ip` | `{ttl_hours?: int\|"permanent"}` (default 24) | Read row's `source_ip`; allowlist check; self-IP guard; already-active no-op; repeat-offender check; block (Postgres + Redis TTL key); audit `BLOCK_SOURCE_IP`; set `admin_action_taken="Blocked IP"` on the threat row. |
| `POST /api/admin/security-logs/block-by-filter` | `{severity?, source_ip?, date_from?, date_to?, q?, classification?}` + `?preview=true` for dry-run | `SELECT DISTINCT source_ip FROM security_threat_logs WHERE <filters>`; filter out self/allowlist/already-active; **dry-run returns full counts including `total_distinct_ips` and `capped_at: 500`**; **execute caps at first 500 IPs** (hard limit, synchronous path); per-IP repeat-offender logic; audit `BLOCK_BY_FILTER` with IP list in `new_values`. |
| `POST /api/admin/security-logs/bulk-action` | `{log_ids: int[], action: "block_ip"\|"dismiss"\|"false_positive", ttl_hours?: int\|"permanent"}` | One transaction: apply action to each `log_id`. For `block_ip`: block each row's IP. For `dismiss`: soft-delete (`resolved_at=now(), admin_action_taken='Dismissed'`). For `false_positive`: `PATCH`-style HITL. One audit row with full `log_ids` in `new_values`. |
| `DELETE /api/admin/security-logs/{log_id}` | — | Soft-delete: `resolved_at=now(), admin_action_taken='Dismissed'`; audit `DELETE_SECURITY_LOG` (action_type despite soft-delete, for audit clarity). 404 if not found. |
| `DELETE /api/admin/ip-blocklist/{ip}` | — | Unblock: `is_active=false`, `DEL ip:block:{ip}`; audit `UNBLOCK_IP`. |
| `GET /api/admin/ip-blocklist` | `?include_inactive=false` (default) | List blocked IPs with derived `block_count` (COUNT per source_ip), `expires_at`, `is_permanent`, `blocked_by`. |

**Client-IP extraction** (shared helper — **X-Real-IP primary, never parse XFF**):
```python
def _get_request_client_ip(request: Request) -> str:
    # nginx sets X-Real-IP to $remote_addr (after realip module) in ALL configs
    # (nginx.conf, nginx.local.conf, nginx.ci.conf). It is NOT client-appendable.
    # X-Forwarded-For is client-spoofable in local/CI (nginx appends with
    # $proxy_add_x_forwarded_for) — never use its leftmost value in app code.
    # Prod (nginx.conf) overwrites XFF with $remote_addr, but relying on that is
    # fragile; X-Real-IP is trustworthy everywhere.
    ip = request.headers.get("x-real-ip")
    if ip:
        return ip.strip()
    # Fallback for direct (no-proxy) access — dev/test only
    return request.client.host if request.client else "unknown"

# In block endpoints (self-IP guard + allowlist):
requester_ip = _get_request_client_ip(request)
# block_ip() checks: allowlist first, then self-IP, then already-active
```
> **Note:** The existing rate limiter (`main.py:771`) parses XFF leftmost — same latent spoofing bug, but fixing it is out of scope for this feature (noted in non-goals). The blocklist uses the correct `X-Real-IP`-first helper.

### Backend — new middleware: `BlockedIPMiddleware`

In `src/backend/main.py`, registered before route dispatch (after the rate limiter):

```python
@app.middleware("http")
async def blocked_ip_middleware(request: Request, call_next):
    # /health exempt (monitoring). Auth endpoints NOT exempt (blocked attacker
    # can't even log in). Allowlisted IPs always pass (checked here too, defense-in-depth).
    if request.url.path in ("/health", "/api/v1/public/health"):
        return await call_next(request)
    client_ip = _get_request_client_ip(request)  # X-Real-IP first
    r = await _get_redis()
    if r is None:
        return await call_next(request)  # fail open (Redis down ≠ site down)
    # Zero Postgres in the hot path — Redis EXISTS only. Native TTL self-expires.
    if await r.exists(f"ip:block:{client_ip}"):
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
- Lists: IP, blocked_at, expires_at (or "Permanent"), block_count (derived), blocked_by, reason.
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
  skipped_allowlist: number;
  already_blocked: number;
  capped: boolean;
  total_distinct_ips: number;
}
// (BulkResult, SecurityLogFilter similar)
```

> **Soft-delete shared helper:** `DELETE /security-logs/{log_id}` and the bulk `dismiss` action share ONE soft-delete helper (`dismiss_security_log(db, log_id, admin_id)`: sets `resolved_at=now(), admin_action_taken='Dismissed'`, writes audit). The DELETE endpoint delegates to it; bulk calls it per `log_id` in the transaction. One logic, two entry points.

## Error handling

- **Self-IP block attempt** → 400 `{detail: "Cannot block your own IP address"}`. Frontend shows error toast.
- **Allowlisted IP block attempt** → 400 `{detail: "IP is on the never-block allowlist"}`. No Postgres/Redis write.
- **Already-active block** → 200 `{already_active: true, ...}` (no-op, no INSERT, no audit). Frontend shows info toast "IP is already blocked."
- **Block-by-filter dry-run** → 200 with counts (`total_distinct_ips`, `would_block`, `repeat_offenders`, `capped_at: 500`), no side effects.
- **Block-by-filter execute capped at 500** → 200 with `capped: true` if `total_distinct_ips > 500`; frontend toast: "Blocked 500 of N distinct IPs. Run again with a narrower filter for the rest."
- **Redis down** → middleware fails open (site stays up); block writes still go to Postgres (Redis resyncs on next boot, periodic resync, or next successful write).
- **Repeat-offender threshold misconfigured** → falls back to default 3, logs a warning.
- **Soft-delete on a row already dismissed** → idempotent (no error, audit still written).
- **Bulk action with empty `log_ids`** → 400 `{detail: "log_ids must not be empty"}`.
- **Block-by-filter with no matching IPs** → 200 `{blocked_count: 0, ...}` (not an error).

## Testing (TDD — red-green-refactor)

### Backend pytest (`src/backend/tests/`)
- `test_block_source_ip`: block → Redis TTL key (`EXISTS ip:block:{ip}`) + Postgres row; audit row written; `admin_action_taken="Blocked IP"`.
- `test_block_self_ip`: 400, no Redis/Postgres write.
- `test_block_allowlisted_ip`: 400, no Redis/Postgres write.
- `test_block_already_active_noop`: second block of same active IP → `{already_active: true}`, no new row, no count increment, no audit.
- `test_repeat_offender_escalation`: block+unblock, block+unblock, block third time → permanent (`is_permanent=true, expires_at=NULL`). Verify derived `block_count` = 3. (Each block is a separate row; unblock separates episodes.)
- `test_unblock_ip`: `is_active=false`, `DEL ip:block:{ip}`.
- `test_blocked_ip_middleware_403`: blocked IP → 403; unblocked → through; **after Redis TTL expires** → through (mock time or short TTL).
- `test_middleware_fail_open_redis_down`: mock Redis None → request passes.
- `test_middleware_zero_postgres`: mock/verify no Postgres query issued in the middleware path.
- `test_block_by_filter_dry_run`: returns `total_distinct_ips`, `would_block`, `repeat_offenders`, `capped_at: 500`; no Postgres writes.
- `test_block_by_filter_execute_cap_500`: 600 distinct IPs → only 500 blocked, `capped: true`.
- `test_block_by_filter_execute`: blocks N distinct IPs, self-IP + allowlisted skipped, repeat-offenders permanent, audit row with IP list.
- `test_bulk_action_block`: bulk block N rows → all IPs blocked, one audit row.
- `test_bulk_action_dismiss`: bulk dismiss → all rows `resolved_at=now(), admin_action_taken='Dismissed'` (shared helper).
- `test_delete_security_log_soft`: `resolved_at` set, row still exists, audit written (delegates to same helper as bulk dismiss).
- `test_rls_non_admin_blocked`: non-SYSTEM_ADMIN role → 403 on all blocklist endpoints.
- `test_rls_write_requires_rls_session`: blocklist service functions use `get_db_with_rls` session (RLS GUC set); standalone session fails the WITH CHECK policy.
- `test_list_blocked_ips`: returns active blocks with derived `block_count`.
- `test_xrealip_not_xff`: `_get_request_client_ip` reads `X-Real-IP` even when `X-Forwarded-For` is present (verify the helper ignores spoofable XFF).

### Frontend vitest (`src/app/admin/monitoring/`)
Mirror the existing `admin-security-monitoring.test.tsx` mock pattern:
- Row renders 4 action groups.
- HITL buttons call `updateAdminSecurityLog` with correct `action`.
- Block Source IP: confirm dialog → `blockSourceIp` → toast → refetch.
- Delete Alert: confirm → `deleteSecurityLog` → toast → refetch.
- Create Incident: confirm → existing client fn → toast.
- Bulk: select rows → bulk bar → `bulkActionSecurityLogs` with correct `log_ids`.
- Filter-scoped block: set filter → click "Block all IPs" → preview shows `total_distinct_ips` + `capped_at: 500` warning if >500 → confirm → `blockByFilter` execute → result toast (incl. `capped: true` message).
- Blocked IPs panel: renders list → unblock button → `unblockIp` → list refreshes → repeat-offender badge on `block_count >= 3`.
- Self-IP block: backend returns 400 → error toast shown.
- Allowlisted IP block: backend returns 400 → error toast "IP is on the never-block allowlist."
- Already-active block: backend returns `{already_active: true}` → info toast "IP is already blocked."

### CI pre-flight (exact commands, gotcha #12)
1. `cd src/backend && ruff check .` → 0
2. `cd src/backend && ruff format --check .` → 0
3. `cd src/backend && pytest -v` → all pass
4. `cd src/frontend && npm run lint` → 0
5. `cd src/frontend && npx vitest run` → all pass
6. `cd src/frontend && NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth NEXT_PUBLIC_BASE_URL=http://localhost:3000 npm run build` → 0

## Safety (prod-safe for `wimsbfp.tech`)

- **Self-IP guard** on all block endpoints (no self-lockout) — uses `X-Real-IP` (nginx-set, not client-appendable), never spoofable `X-Forwarded-For` leftmost.
- **Critical-IP allowlist** (`ip_blocklist.allowlist` in `system_config`) — never blocks other admins, uptime monitors, VPS egress, health-checkers. Important for NAT/CGNAT-heavy PH mobile user bases where one public IP represents many users.
- **Already-active no-op** — double-clicks/filter-duplicates don't falsely escalate toward permanent.
- **24h TTL default** via Redis native `EX` (self-expires, zero Postgres load); permanent only via repeat-offender escalation at threshold 3 or manual "permanent" toggle.
- **Unblock always available** from the Blocked IPs panel.
- **S3 confirm dialog shows exact count** (`total_distinct_ips`, repeat-offender breakdown, 500-cap warning) before execution; dry-run preview is mandatory before execute; 500-IP hard cap prevents 504 on 25k-scale.
- **Soft-delete** preserves the forensic audit trail (no hard delete, avoids FK violations on `34_security_incident` and `52_breach_notifications`); DELETE + bulk-dismiss share one helper.
- **Fail-open middleware** (Redis down ≠ site down); **zero Postgres in the hot path** (Redis `EXISTS` only — no DDoS connection-pool vector).
- **RLS** on `ip_blocklist` (SYSTEM_ADMIN-only); service functions use `get_db_with_rls` session (RLS GUC set for WITH CHECK policy).
- **Audit-logged** end-to-end (every block/unblock/delete/bulk/filter action writes a `system_audit_trails` row).
- **Prod migration step** — `postgres-init/` only runs on first DB boot (`CLAUDE.md:33`); `wimsbfp.tech` is already up, so `65_ip_blocklist.sql` must be applied manually to the running prod DB (see build order step 1b).

## Wiki updates (per AGENTS.md mandatory rule)

1. `system-wiki/log.md` — new feature entry (this spec implemented).
2. `system-wiki/backend/api-route-map.md` — 6 new routes (block-source-ip, block-by-filter, bulk-action, DELETE security-log, DELETE/GET ip-blocklist).
3. `system-wiki/database/schema-overview.md` — new `ip_blocklist` table + migration `65`.
4. `system-wiki/security/security-baseline.md` — IP blocklist + repeat-offender escalation + BlockedIPMiddleware.
5. `system-wiki/gaps/frs-codebase-gap-register.md` — closes "XAI narrative not actionable" gap; note FRS doesn't specify IP blocking (genuine product gap, not a missed FRS requirement).

## Build order (for the implementation plan)

1. **Migration `65_ip_blocklist.sql`** + RLS + `system_config` rows (threshold + allowlist).
   **1b. Prod migration apply** — `postgres-init/` only runs on first DB boot (`CLAUDE.md:33`); `wimsbfp.tech` is already up. Apply to the running prod DB: `docker compose exec -T postgres psql -U postgres -d wims -f /postgres-init/65_ip_blocklist.sql` (documented in the PR; tested locally with `down -v` + `up --build`).
2. **Backend service `services/ip_blocklist.py`** (block/unblock/list/block_by_filter; repeat-offender logic; allowlist check; already-active no-op; derived count; Redis TTL-key sync). All functions take `db: Session` from `get_db_with_rls`.
3. **Backend endpoints** (6 new): `block-source-ip`, `block-by-filter`, `bulk-action`, `DELETE /security-logs/{log_id}` in `api/routes/admin/security.py`; `DELETE /ip-blocklist/{ip}`, `GET /ip-blocklist` in new `api/routes/admin/ip_blocklist.py` (mounted via `admin/__init__.py`).
4. **Backend middleware** `BlockedIPMiddleware` in `main.py` (Redis `EXISTS` only, fail-open, X-Real-IP helper).
5. **Backend boot resync** + **Celery beat periodic resync** (every 5 min) in `celery_config.py`.
6. **Backend pytest** — all test cases above; run `ruff check`, `ruff format`, `pytest`.
7. **Frontend types** in `types/api.ts` + API client functions in `legacy.ts`/`securityActions.ts`.
8. **Frontend filters** ported to `/admin/monitoring`.
9. **Frontend per-row actions** (HITL group + Block + Create Incident + Delete).
10. **Frontend bulk actions** (checkboxes + bulk bar).
11. **Frontend filter-scoped block** (S3 preview with cap warning + execute).
12. **Frontend Blocked IPs panel**.
13. **Frontend vitest** — all test cases above.
14. **CI pre-flight** — all 6 gates.
15. **Wiki + gap-register updates** + commit.

## Open questions

None — all decisions locked:
- Layer: A (app-layer; Redis native TTL keys = hot-path source of truth, Postgres = write-path/audit/read).
- Scope: per-row + bulk + filter-scoped.
- TTL: 24h default (Redis `EX`, self-expires, zero Postgres load), permanent via repeat-offender (threshold 3) or manual toggle.
- Delete: soft-delete (DELETE + bulk-dismiss share one helper).
- HITL verdict: 3-button group on row.
- Self-IP guard: yes (X-Real-IP, not spoofable XFF).
- Allowlist: yes (`ip_blocklist.allowlist` in `system_config`, checked by middleware + block endpoints).
- Already-active no-op: yes (prevents false escalation).
- block-by-filter cap: 500 IPs per execute (synchronous path; Celery 202+poll out of scope).
- Target: local + prod (`wimsbfp.tech`), prod-safe (incl. manual prod migration step 1b).
- Button label: "Block Source IP".
- Repeat-offender threshold: 3 (configurable via `system_config`).
- RLS session: service functions use `get_db_with_rls` (RLS GUC set for WITH CHECK).
- Framing: app-layer authorization block, not volumetric DoS shield.

## Revision history

- **2026-06-22 (post external review):** 12 revisions after two SOTA-model security reviews (verified against codebase): (1) X-Real-IP primary, never parse XFF (spoofing fix); (2) Redis native TTL keys, zero Postgres in hot path (DDoS + TTL fix); (3) 500-IP cap on block-by-filter (504 fix); (4) prod migration apply step 1b; (5) RLS session param on all service functions; (6) already-active no-op guard; (7) critical-IP allowlist; (8) derived block_count (removed stored column); (9) shared soft-delete helper; (10) Redis best-effort + resync drift note; (11) honest framing (app-layer, not DoS shield) + detection-noise flag; (12) Celery periodic resync.
