---
title: System Admin Hub
created: 2026-05-16
updated: 2026-06-16
type: operation
tags: [wims-bfp, admin, system-admin, dashboard, identity, security, rate-limits, config]
sources: [src/frontend/src/app/admin/system/page.tsx, src/backend/api/routes/admin.py, src/frontend/src/lib/api/legacy.ts, src/frontend/src/app/admin/system/rate-limits/page.tsx]
status: draft
---

# System Admin Hub

The admin hub (`/admin/system`) is the `SYSTEM_ADMIN`-only management console for identity, security telemetry, audit oversight, scheduled reports, and backup management.

## Role Gates

- `/admin` redirects to `/admin/system`
- `/admin/system` renders only when `role === 'SYSTEM_ADMIN'`; unauthorised users are redirected to `/dashboard`

## Frontend UI Surface

**Route:** `/admin/system` (`src/frontend/src/app/admin/system/page.tsx`, ~2160 lines)

**Panels (all loaded on mount, server-side tab-less layout):**

| Panel | Data | API Call | Notes |
|---|---|---|---|
| **System Health & Monitoring** (#344 consolidated, #345) | System metrics (CPU/Memory/Disk/AI/Network), Celery workers (paginated, 20/page), and component health (DB/Redis/Keycloak) | `fetchSystemMetricsOfflineAware()`, `fetchWorkerStatusOfflineAware(limit, offset)`, `fetchSystemHealthOfflineAware()`, `pruneWorkers()` | Single card with skeleton loading on initial fetch; one refresh button for both sections; auto-refreshes every 60s. **Worker pagination (#345):** prev/next buttons, page size selector (10/20/50), "Showing N–M of T" indicator. **Manual prune (#345):** "Prune Old Workers" button with confirmation modal; deletes only OFFLINE rows older than retention threshold (default 7 days); ACTIVE/STALE protected; audit-logged; result banner with deleted count. |
| **System Analytics / Flow** | Total Users, Active Sessions (from aggregate endpoint), Celery Workers count | `fetchAdminUsers()`, `fetchActiveSessionsOfflineAware()`, `fetchWorkerStatusOfflineAware()` | Three-stat dashboard cards. "Total API Requests" placeholder replaced with live Celery Workers count (#359) |
| **Identity Governance** (#346) | All users with client-side filters (username, role, region, active status) and pagination (10/25/50 per page) | `fetchAdminUsers()`, `updateAdminUser()` | Edit button opens modal with role dropdown (excludes deprecated CIVILIAN_REPORTER), region dropdown from `fetchRegions()`, and active checkbox. Create User modal for onboarding; region dropdown populated from `fetchRegions()`. Sessions column removed — per-user sessions are accessible by clicking the username or via the dedicated Active Sessions section. |
| **Create User Modal** | First name, last name, email, role, region, contact | `createAdminUser()` → `POST /api/admin/users` | Returns temp password in plaintext (prototype); copy-to-clipboard with show/hide toggle; region filter list from `fetchRegions()`; CIVILIAN_REPORTER excluded from role dropdown (#346) |
| **Active Sessions** (#347) | All active Keycloak sessions across all users with client-side username filter and pagination (10/25/50 per page) | `fetchActiveSessionsOfflineAware()` → `GET /api/admin/active-sessions` | Table with username, role, IP address, last access; Force Logout button calls `revokeUserSessions()`. Per-user sessions loaded lazily on username click (#359 N+1 fix) |
| **Per-User Sessions Modal** | Per-user Keycloak sessions (lazy-loaded) | `fetchUserSessions(user_id)` on demand | Lazy-loads sessions when user clicks username in Identity Governance; shows loading/error/no-sessions states; Terminate All button |
| **Security Threat Logs** | Suricata/XAI threat telemetry with advanced filters & pagination (#348) | `fetchAdminSecurityLogs()` → `GET /api/admin/security-logs` | Table with source/dest IP, severity, Suricata SID, raw payload, XAI narrative/confidence; Analyze button runs `analyzeSecurityLog()`; HITL modal: 3 decision buttons (Confirm Threat / False Positive / Request More Info) replacing free-text admin_action_taken form. Request More Info reveals optional note textarea + Confirm. Already-actioned logs show read-only display. Backend response is paginated (`items`, `total`, `limit`, `offset`) and includes `hitl_decision` JSONB. **Advanced filter bar (#348):** severity chips (LOW/MEDIUM/HIGH/CRITICAL), Source IP input, Date From/To inputs; Reset All Filters button. **Pagination controls (#348):** prev/next with page indicator; 20 items/page. **Auto-reload:** triggered by filter/pagination state changes via useEffect comparison of telemetry filter key. **Error state:** inline alert shown on fetch failure. |
| **System Audit Trails** | Dedicated page `/admin/audit` with full filters, pagination, offline caching (#352) | `fetchAuditLogsOfflineAware()` → `GET /api/admin/audit-logs` | The admin hub now shows a CTA card linking to `/admin/audit`; full audit table, advanced filters (q, user_id, action_type, table_affected, ip_address, date_from, date_to), expandable old/new values, and prev/next pagination live on the dedicated page |
| **Scheduled Reports** | Create/manage scheduled analytics reports | `POST /api/admin/scheduled-reports`, `GET /api/admin/scheduled-reports` | Create form: name, format (pdf/excel/csv), cron expression, filters JSON, recipients; list with toggle/delete; delete uses confirmation modal (no native `confirm()`) |
| **Backup Management** | Trigger pg_dump + AES encrypt, list backups, download | `triggerBackup()`, `listBackups()`, `downloadBackup()` | Backup filenames: `wims_YYYYMMDD_HHMMSS.sql.enc`; retention policy deletes oldest when >100 files; download via FileResponse |

## Backend API Routes

All in `src/backend/api/routes/admin.py` (~935 lines). Every endpoint is gated by `Depends(get_system_admin)`.

### Identity Management (`admin.py` lines 141–472)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `POST` | `/api/admin/users` | `create_user` | Creates user in Keycloak (temp password, role assignment) + `wims.users` INSERT; validates region FK; audits `CREATE_USER`; returns temp password in plaintext |
| `GET` | `/api/admin/users` | `get_users` | Lists all users from `wims.users`; masks Keycloak IDs (`abcd****efgh`); returns user_id, username, role, assigned_region_id, is_active, created_at |
| `PATCH` | `/api/admin/users/{user_id}` | `update_user` | Updates role/region/is_active; syncs is_active to Keycloak via `set_user_enabled()`; revokes sessions on deactivation or role change; audits each action |
| `GET` | `/api/admin/active-sessions` | `get_active_sessions` | Fetches Keycloak sessions for all active users via admin API; sorted by last_access desc; includes session_id, IP, start, last_access, clients |
| `POST` | `/api/admin/users/{user_id}/logout` | `force_logout_user` | Revokes all Keycloak sessions + Redis session manager for a specific user |

### System Health & Monitoring (`admin/monitoring.py`)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `GET` | `/api/admin/health` | `get_system_health` | Checks DB (`SELECT 1`), Redis (`PING`), Keycloak (admin API connectivity), Suricata (recent threat log flow), Ollama (`/api/tags`); returns `HEALTHY`/`DEGRADED` status per component |
| `GET` | `/api/admin/monitoring/workers` | `get_worker_status` | Lists Celery worker heartbeats (paginated: `limit` default 20, max 200; `offset` default 0); returns `{ items, total, limit, offset }` sorted by `last_seen DESC` |
| `POST` | `/api/admin/monitoring/workers/prune` | `prune_offline_workers` | Deletes OFFLINE workers older than retention threshold (default 7d, configurable via `worker_heartbeat_retention_days`); ACTIVE/STALE/recent OFFLINE protected; audit-logged; returns `{ status, deleted_count, retention_days, message }` (#345) |
| `GET` | `/api/admin/monitoring/system` | `get_system_metrics` | Returns CPU/Memory/Disk/AI-Inference/Network metrics via psutil + Redis |

### Security Telemetry (`admin.py` lines 555–626)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `GET` | `/api/admin/security-logs` | `get_security_logs` | Lists `wims.security_threat_logs` ordered by timestamp DESC; includes XAI fields (narrative, confidence); supports `limit`/`offset` query params and returns paginated envelope (`items`, `total`, `limit`, `offset`) |
| `POST` | `/api/admin/security-logs/{log_id}/analyze` | `analyze_security_log` | Runs `analyze_threat_log()` via Ollama AI service; updates xai_narrative and xai_confidence |
| `PATCH` | `/api/admin/security-logs/{log_id}` | `update_security_log` | Updates threat log — structured HITL path (when `action` provided: maps to `admin_action_taken` label, writes `hitl_decision` JSONB with `action`, `note`, `reviewed_by`, `reviewed_at`; sets `resolved_at=now()` for CONFIRM_THREAT and FALSE_POSITIVE; leaves `resolved_at` null for REQUEST_MORE_INFO; invalid action → 400) or legacy free-text path (sets `admin_action_taken` and/or `resolved_at` directly) |

### Analytics Read Model (`admin.py` lines 633–641)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `POST` | `/api/admin/analytics/backfill` | `backfill_analytics` | Backfills `wims.analytics_incident_facts` from existing VERIFIED non-archived incidents; returns synced count |

### Audit Oversight (`admin.py` lines 648–691)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `GET` | `/api/admin/audit-logs` | `get_audit_logs` | Paginated `wims.system_audit_trails`; accepts `limit` (1–500) and `offset`; returns total count for pagination UI |

### Scheduled Reports (`admin.py` lines 723–778)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `POST` | `/api/admin/scheduled-reports` | `create_scheduled_report` | Creates row in `wims.scheduled_reports` with name, cron (validated against regex), format, filters JSON, recipients |
| `GET` | `/api/admin/scheduled-reports` | `list_scheduled_reports` | Lists all scheduled reports ordered by ID DESC |

**Frontend Filter Builder (#353):** The create/edit form on `/admin/system` uses a human-friendly `ReportFilterBuilder` component (region dropdown, severity select, date pickers, incident type input) as the primary UI. An "Expert" toggle exposes a raw JSON textarea for advanced filter editing. Filters are validated client-side before save and sent as structured JSON objects.

### Backup Management (`admin.py` lines 785–935)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `POST` | `/api/admin/backup` | `trigger_backup` | Runs `pg_dump` piped through `openssl enc -aes-256-cbc`; saves to `BACKUP_DIR`; enforces retention cap; audits |
| `GET` | `/api/admin/backups` | `list_backups` | Lists all `wims_*.sql.enc` files in `BACKUP_DIR` sorted newest-first with size and creation time |
| `GET` | `/api/admin/backup/{filename}` | `download_backup` | Validates filename format; serves via `FileResponse` with `application/octet-stream` |

## Key Implementation Details

- **No DELETE endpoints** — enforced by docstring ("Immutability Law") and missing delete routes
- **`exec_as_system_admin` helper** — user CREATE uses a SECURITY DEFINER helper to bypass RLS when the postgres service account has no JWT
- **Partial sync failure tolerance** — user deactivation updates DB first, logs Keycloak sync failure as warning rather than rolling back
- **Backup format** — `pg_dump` encrypted with AES-256-CBC; `_apply_backup_retention()` deletes oldest when count exceeds 100
- **Backup dir** — lazy-created at `/app/storage/backups` (configurable via `BACKUP_DIR` env var)

## UI Feedback Pattern (#359)

Native `alert()` and `confirm()` calls have been replaced with page-level in-app feedback:
- **Toast banner**: A dismissible inline banner at the top of the page shows success/error messages for all CRUD operations (create/update/delete user, report, session, AI analysis).
- **Confirmation modal**: The scheduled report delete action uses a confirmation modal instead of `window.confirm()`, with Cancel/Delete buttons.
- **Error messages**: Backend error messages are preserved safely through the toast with no extra dependencies.

## N+1 Session Fix (#359)

- Initial page load uses the aggregate `GET /admin/active-sessions` endpoint (via `fetchActiveSessionsOfflineAware()`) for the Active Sessions table.
- Per-user Keycloak sessions (`fetchUserSessions(user_id)`) are lazy-loaded only when the admin opens the per-user Sessions modal.
- The duplicate `fetchAdminUsers()` call in the initial mount chain has been removed.

## Auth Loading Guards (#358)

Monitoring (`/admin/monitoring`), anomalies (`/admin/anomalies`), and breach (`/admin/breach`) pages now consume `loading` from `useAuth()`. While auth is resolving:
- A neutral "Loading…" state is shown (not "Access restricted")
- No admin API calls are triggered
- The "Access restricted" message only appears after auth resolves to a non-SYSTEM_ADMIN role

## Breach Notifications (#355, #361)

The breach notifications page (`/admin/breach`) tracks RA 10173 NPC 72-hour breach reporting workflow (DETECTED → DPO_NOTIFIED → NPC_SUBMITTED → CLOSED).

### NPC Contact Configuration (#355)

- **NPC Contact Card:** Displays at the top of the breach page, showing configurable contact person name, contact phone, and NPC office phone fetched from `GET /api/admin/config` keys `npc_contact_name`, `npc_contact_phone`, `npc_office_phone`.
- **Edit Flow:** "Edit" button opens a modal with editable fields and a confirmation phrase (`confirm-npc-update`) requirement. On confirm, calls `PATCH /api/admin/config` for each changed value. Audit trail captures old/new values per the existing `CONFIG_UPDATE` audit pattern.
- **Confirmation:** Uses explicit confirmation phrase (not password re-entry). True MFA step-up (Keycloak TOTP re-challenge) is a non-goal for this iteration.

### Status Advance Confirmation (#361)

- **Status Advance Button:** Replaced direct `updateBreach` call with a confirmation modal showing current → next status transition, NPC deadline impact (overdue warning or <24h urgent), and optional notes/evidence textarea.
- **Modal Behavior:** Cancel closes modal without mutation. Confirm calls `PATCH /api/admin/breach/{id}` with status (and optional notes). Success updates the row and shows a green success banner; failure displays a red error inline in the modal and keeps the prior row state intact (no optimistic mutation).
- **Audit Enrichment:** `PATCH /breach/{id}` now captures old_values (status, affected_systems, data_scope, notes) before UPDATE and passes request metadata (client IP/UA via `X-Forwarded-For`/`X-Real-IP` headers) preserving #360 real-IP pattern. `log_system_audit` writes both `old_values` and `new_values` JSONB for forensic traceability.

## Anomaly Dashboard (#356, #362)

The anomaly detection page (`/admin/anomalies`) manages behavioral anomaly detections (NEW → ACKNOWLEDGED → RESOLVED lifecycle).

### Aggregate Counts & Dynamic Filters (#362)

- **API contract:** `GET /api/admin/anomalies` returns `counts` (per-status aggregate: `{NEW, ACKNOWLEDGED, RESOLVED}`) and `type_facets` (per-type aggregate: `[{type, count}]`) alongside the existing `items`/`total`/`limit`/`offset` envelope.
- **Filter scope:** `counts`, `type_facets`, and `total` all use the same WHERE clause as the paginated items query — filters applied by the user (status, type, severity) narrow all aggregates.
- **Summary cards:** New / Acknowledged / Resolved cards render aggregate counts from API `counts`, not from `anomalies.filter(...)` on the current page.
- **Dynamic type filter:** The type dropdown is populated from `type_facets` (with count labels), replacing the previous hardcoded 4-type list.
- **Severity filter:** A new dropdown (Low/Medium/High/Critical) filters anomalies by severity — hardcoded options matching the DB CHECK constraint.
- **Empty state:** Distinguishes "no anomalies exist yet" (shows seed script hint) from "no anomalies match current filters" (suggests adjusting filter selection).

### Seed Data (#356)

- **`scripts/seed-anomaly-detections.sh`** + **`scripts/seed-anomaly-detections.sql`**: Manual seed script inserting 20 anomaly_detections rows covering all 5 anomaly types (BULK_DELETE, OFF_HOURS, PRIVILEGE_ESCALATION, RAPID_IP_SWITCH, SUSPICIOUS_QUERY_PATTERN), all 3 statuses, all 4 severities, and timestamps distributed across the last 24 hours.
- `subject_user_id` references known test users from `03_users.sql` or is NULL for appliance-origin detections.
- Uses `ON CONFLICT (anomaly_type, dedup_key) DO NOTHING` — safe to re-run.

## Rate Limit Configuration (#363)

The rate limits page (`/admin/system/rate-limits`) provides SYSTEM_ADMIN-only auth-flow rate-limit controls.

### Frontend

- **Route:** `/admin/system/rate-limits` (`src/frontend/src/app/admin/system/rate-limits/page.tsx`)
- **Explanatory card:** Describes what the `login` tier protects (Keycloak OIDC callback endpoint in `main.py`), how threshold and window work, and that changes are hot-reloaded from Redis.
- **Input fields:** Threshold (≥1, whole number) and Window seconds (≥1, whole number) with client-side validation.
- **Save:** Calls `PATCH /api/admin/rate-limits`, shows green success or red error message inline. Save button is disabled when no changes.
- **Refresh:** Reloads current config from API.
- **Last-updated timestamp:** Displayed when available from Redis.
- **Sidebar:** "Rate Limits" nav item with Timer icon under System section for SYSTEM_ADMIN only.

### Backend

- **`GET /api/admin/rate-limits`** — Returns current Redis config for tier `login` (window_seconds, threshold, updated_at). Returns defaults (900s window, 5 threshold) when Redis key is empty.
- **`PATCH /api/admin/rate-limits`** — Updates Redis hash `rate_limit_config:login` with Pydantic-validated `limit` (≥1) and `window` (≥1). Audit-logged as `RATE_LIMIT_UPDATED`. Only `login` tier is accepted.
- **Redis key:** `rate_limit_config:login` (hash with fields `window_seconds`, `threshold`, `updated_at`).
- **Middleware consumption:** The auth/callback rate-limit middleware in `main.py` reads `rate_limit_config:login` via `hgetall` on every callback request and uses the configured `window_seconds` / `threshold` in the Lua sliding-window eval. Falls back to hardcoded defaults (900/5) when Redis is unavailable, the hash is empty, or values are non-numeric/non-positive.

### API Helpers

- `src/frontend/src/lib/api/legacy.ts` — `fetchRateLimits()` and `updateRateLimits(tier, limit, window)`, plus `RateLimitConfig` type.
- `src/frontend/src/lib/api/admin.ts` — re-exports rate-limit functions and type.

### Tests

- **Backend:** `tests/test_dynamic_rate_limits.py` — 15 tests covering GET returns config/defaults, PATCH updates/validation/rejection, audit logging, admin-only access, and 5 middleware config-consumption tests (configured values passed to eval, fallback on empty/non-numeric/non-positive config, 429 with Retry-After).
- **Frontend:** `src/app/admin/system/rate-limits/rate-limits.test.tsx` — 11 tests covering loading, display, explanatory copy, save/save-failure/disabled-state, validation errors, load error, timestamp, and non-admin redirect.
- **Sidebar:** `src/components/Sidebar.test.tsx` — 6 tests covering Rate Limits visibility by role and link target.

## Worker Timeout Configuration (#354)

Two new system config keys allow the SYSTEM_ADMIN to tune Celery worker liveness thresholds without a restart.

### Config Keys

| Key | Type | Min | Default | Description |
|---|---|---|---|---|
| `worker_stale_timeout_seconds` | int | 30 | 60 | Seconds of inactivity before worker status transitions ACTIVE → STALE |
| `worker_offline_timeout_seconds` | int | 60 | 300 | Seconds of inactivity before worker status transitions to OFFLINE; must be strictly greater than stale timeout |

### Backend Validation

- **Per-key numeric validation:** Both keys require integer values; `worker_stale_timeout_seconds` ≥ 30, `worker_offline_timeout_seconds` ≥ 60.
- **Cross-key constraint:** `worker_offline_timeout_seconds` must be strictly greater than `worker_stale_timeout_seconds`. Updating either key checks the other's current DB value and rejects with 400 if the ordering would be violated.
- **Audit:** All updates write `CONFIG_UPDATE` audit trails with old/new values.

### Monitoring Consumer

- `tasks/monitoring.py` — `_read_worker_timeout_config()` reads both keys from `wims.system_config` on every worker heartbeat run (every 30s by Celery beat).
- Fallback to defaults (60/300) on missing keys, malformed values, DB errors, or invalid ordering (offline ≤ stale).
- The heartbeat task uses the configured values in `INTERVAL` clauses of the STALE and OFFLINE status-transition UPDATEs.

### Frontend Discovery

- The existing `/admin/system/config` page (`system-config.page.tsx`) renders all 9 config keys including the two worker timeout keys with descriptions, inline editing, and per-key save.
- No dedicated worker timeout page — these are managed through the unified System Configuration page.

### Seed Data

- `src/postgres-init/49_system_config.sql` — two new INSERT rows with defaults (60, 300) and descriptive comments.

### Tests

- **Backend config:** `tests/test_system_config.py` — 10 new tests in `TestWorkerTimeoutConfigKeys` covering min-value rejection/acceptance, cross-key constraint enforcement, valid updates, and audit logging.
- **Backend monitoring:** `tests/test_system_monitoring.py` — 5 new tests in `TestReadWorkerTimeoutConfig` covering defaults, configured values, fallback on bad ordering/equality, malformed values, and DB exceptions.
- **Frontend config:** `src/app/admin/system/config/system-config.test.tsx` — 5 tests covering worker timeout key rendering, multiple "60" display values, descriptions, inline editing, and non-admin redirect.

## XAI Narrative Normalizer (#351)

`src/frontend/src/lib/xaiNarrativeNormalizer.ts` provides a shared tolerant parser for AI-generated structured output stored in `xai_narrative`. It handles:
- Well-formed JSON objects with known fields (`anomaly_description`, `log_evidence`, `risk_assessment`, `recommended_action`, `confidence`/`xai_confidence`)
- JSON inside markdown fenced code blocks (```` ```json ... ``` ````)
- Partial/malformed JSON via regex fallback for individual field extraction
- Plain text (falls back to raw)
- Empty/null input

Used by:
- `/admin/system` — Threat Telemetry detail drawer: renders structured fields with labeled sections (Anomaly, Risk, Recommendation) + confidence badge
- `/admin/monitoring` — Recent Narratives list: renders structured narratives inline with Anomaly/Risk/Recommendation fields and confidence badge, preserving expand/collapse for long content

Unit tests: `src/frontend/src/lib/xaiNarrativeNormalizer.test.ts` (14 test cases covering valid JSON, fences, partial extraction, edge cases).

## Dedicated System Audit Page (#352)

`src/frontend/src/app/admin/audit/page.tsx` provides a dedicated full-featured System Audit page for SYSTEM_ADMIN users, extracted from the overcrowded `/admin/system` hub.

**Features:**
- All 7 audit filters: full-text search (`q`), `user_id`, `action_type`, `table_affected`, `ip_address`, `date_from`, `date_to`
- Suggestive datalist for action types and tables; plain text inputs for UUID/IP/date fields
- Apply Filters / Clear Filters buttons; Clear only appears when at least one filter is active
- Previous/Next pagination with page indicator (50 items/page)
- Expandable rows showing old_values/new_values JSONB diffs on click
- Action type color-coded badges (HITL_REVIEW=blue, CREATE_INCIDENT=orange, BREACH=red, ANOMALY=purple)
- Loading skeleton (5 pulse rows), empty state, filtered-empty state, error state (role="alert")
- Offline banner with cached-data indicator and "Last checked: X sec ago" timestamps
- Refresh button
- SYSTEM_ADMIN role gate with redirect for non-admins; auth loading guard

**API:** Uses `fetchAuditLogsOfflineAware()` from `offlineAdmin.ts` → `GET /api/admin/audit-logs` with all filter query params supported by the backend.

**Sidebar:** `Sidebar.tsx` "System Audit" link points to `/admin/audit` instead of the old `/admin/system#audit` anchor.

**Admin Hub CTA:** `/admin/system` no longer embeds the full audit table/search section. The old System Audit panel is replaced with a compact CTA card linking to `/admin/audit` with a descriptive summary. The Alert Action Highlights section remains on the hub page.

Tests: `src/frontend/src/app/admin/audit/admin-audit.test.tsx` (14 tests covering rendering, filters, pagination, loading/empty/error/offline states, row expansion, role redirect, and auth loading guard).

## Offline Read Caching (GH #270)

The admin hub monitoring reads (system health, system metrics, worker status, active sessions, audit logs) are wrapped in offline-aware functions in `src/frontend/src/lib/api/offlineAdmin.ts`. Each wrapper:
- Checks connectivity via `getConnectivitySnapshot()` before dispatching
- Caches successful online responses in the encrypted IndexedDB analytics-cache store under `admin:`-prefixed keys
- Uses 60s TTL for health/metrics/workers/audit; 30s TTL for active sessions
- Falls back to fresh cache on network error (sets offline state + serves cached `{ response, fromCache: true, cachedAt }`)
- Throws a descriptive error when offline with no cache (no silent fallback)

The page shows an amber "You are offline — showing cached data" banner when `useNetworkStatus().isOnline` is false, and now also subscribes to `connectivity.ts` health-probe state to show "Backend unreachable — showing cached data" when the browser reports online but the backend probe is offline. It displays `(cached)` indicators plus relative "Last checked: X sec ago" timestamps only on panels served from cache.

User CRUD, security HITL ops, and scheduled reports remain online-only.

## Gap / Status Notes

- The page shows all panels in a **single vertical scroll layout** — no tabbed Activity & Governance section (logged in [[gaps/ui-ux-gap-register]] as issue #A-02 and #A-04)
- **🔧 Security threat logs filter & pagination (GH #348):** Frontend now has severity chips (LOW/MEDIUM/HIGH/CRITICAL), Source IP filter, Date From/To range filters, a Reset All Filters button, and prev/next pagination (20 items/page). Backend API was already paginated; frontend now passes `limit`, `offset`, `severity`, `source_ip`, `date_from`, `date_to` query params. Remaining gaps: background polling (issue #A-37), sub-100ms key-by-key response for clustered threats (FRS M10a filtering perf).
- **M9 System Monitoring metrics** (VPS usage, container status, PWA sync, AI model latency, DB query latency cards) are **not implemented** beyond the basic DB/Redis/Keycloak health check; the FRS-required 60s refresh and configuration management UI are missing (logged in [[gaps/frs-codebase-gap-register]])
- **✅ Identity Governance (GH #346):** Client-side username search, role filter (excludes CIVILIAN_REPORTER), region filter (dropdown from `fetchRegions()`), active status filter, and pagination (10/25/50 per page). Inline UserRow edit replaced with a modal. Sessions column removed from Identity Governance table; per-user sessions accessible via username click or dedicated Active Sessions section.
- **✅ Active Sessions (GH #347):** Client-side username filter and pagination (10/25/50 per page). Sessions remain viewable/manageable in the dedicated Active Sessions container.
- Backup download is not rate-limited or logged beyond the system audit trail
- Admin hub uses `get_db()` (not `get_db_with_rls()`) for health check, `get_db_with_rls()` for all other queries

## Related

- [[backend/api-route-map]] — route ownership
- [[database/schema-overview]] — `wims.users`, `wims.security_threat_logs`, `wims.system_audit_trails`, `wims.scheduled_reports`, backup files
- [[security/security-baseline]] — auth, RLS, audit baseline
- [[gaps/ui-ux-gap-register]] — admin hub layout gaps (linear vertical flow, missing tabbed sections, missing M9 cards)
- [[gaps/frs-codebase-gap-register]] — M9 monitoring implementation gaps
- [[gaps/functional-bug-register]] — user management bugs (F-01 audit record_id, F-02 first-login validation, F-04 session timeout)

## API Reference

Every function in `src/backend/api/routes/admin.py` is documented in detail at:
- [[subsystems/references/admin-api-ref]] — complete function-level docs for all 16 route handlers, 4 Pydantic schemas, and 2 helper functions
