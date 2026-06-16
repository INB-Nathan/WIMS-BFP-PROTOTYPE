---
title: System Admin Hub
created: 2026-05-16
updated: 2026-06-16
type: operation
tags: [wims-bfp, admin, system-admin, dashboard, identity, security]
sources: [src/frontend/src/app/admin/system/page.tsx, src/backend/api/routes/admin.py, src/frontend/src/lib/api/legacy.ts]
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
| **System Health & Monitoring** (#344 consolidated) | System metrics (CPU/Memory/Disk/AI/Network), Celery workers, and component health (DB/Redis/Keycloak) | `fetchSystemMetricsOfflineAware()`, `fetchWorkerStatusOfflineAware()`, `fetchSystemHealthOfflineAware()` | Single card with skeleton loading on initial fetch; one refresh button for both sections; auto-refreshes every 60s |
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

### System Health (`admin.py` lines 475–553)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `GET` | `/api/admin/health` | `get_system_health` | Checks DB (`SELECT 1`), Redis (`PING`), Keycloak (admin API connectivity) with latency; returns `HEALTHY`/`DEGRADED` status |

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
