---
title: System Admin Hub
created: 2026-05-16
updated: 2026-06-12
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

**Route:** `/admin/system` (`src/frontend/src/app/admin/system/page.tsx`, ~973 lines)

**Panels (all loaded on mount, server-side tab-less layout):**

| Panel | Data | API Call | Notes |
|---|---|---|---|
| **System Health** | Component-wise health (DB/Redis/Keycloak) with latency | `fetchSystemHealth()` → `GET /api/admin/health` | Single-card per component with status + latency |
| **User Management** | All users (masked Keycloak IDs), edit role/region/active state | `fetchAdminUsers()`, `updateAdminUser()` | Inline edit for role/region/active; Create User modal for onboarding; region dropdown populated from `fetchRegions()` |
| **Create User Modal** | First name, last name, email, role, region, contact | `createAdminUser()` → `POST /api/admin/users` | Returns temp password in plaintext (prototype); copy-to-clipboard with show/hide toggle; region filter list from `fetchRegions()` |
| **Active Sessions** | All active Keycloak sessions across all users | `fetchActiveSessions()` → `GET /api/admin/active-sessions` | Table with session ID, username, role, IP, start, last access; Revoke button calls `revokeUserSessions()` |
| **Security Threat Logs** | Suricata/XAI threat telemetry | `fetchAdminSecurityLogs()` → `GET /api/admin/security-logs` | Table with source/dest IP, severity, Suricata SID, raw payload, XAI narrative/confidence; Analyze button runs `analyzeSecurityLog()`; HITL modal: 3 decision buttons (Confirm Threat / False Positive / Request More Info) replacing free-text admin_action_taken form. Request More Info reveals optional note textarea + Confirm. Already-actioned logs show read-only display. Backend response is paginated (`items`, `total`, `limit`, `offset`) and includes `hitl_decision` JSONB. |
| **System Audit Trails** | Paginated audit log of all admin actions | `fetchAuditLogs(limit, offset)` → `GET /api/admin/audit-logs` | Table with user_id, action_type, table_affected, record_id, IP, UA, timestamp; paginated with limit/offset |
| **Scheduled Reports** | Create/manage scheduled analytics reports | `POST /api/admin/scheduled-reports`, `GET /api/admin/scheduled-reports` | Create form: name, format (pdf/excel/csv), cron expression, filters JSON, recipients; list with delete capability |
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
- Security threat logs still have **no frontend pagination/search/filter**. Backend API is paginated, but the admin UI currently consumes only the initial page.
- **M9 System Monitoring metrics** (VPS usage, container status, PWA sync, AI model latency, DB query latency cards) are **not implemented** beyond the basic DB/Redis/Keycloak health check; the FRS-required 60s refresh and configuration management UI are missing (logged in [[gaps/frs-codebase-gap-register]])
- **No pagination, full-text search, or filter** on user list or incident lists in admin hub (logged in [[gaps/ui-ux-gap-register]])
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
