---
title: Admin Hub API Reference
created: 2026-05-16
updated: 2026-05-16
type: backend
tags: [wims-bfp, admin, system-admin, api-reference, backend]
sources: [src/backend/api/routes/admin.py]
status: draft
---

# Admin Hub — Full API Reference

Complete function-level documentation for `src/backend/api/routes/admin.py` (~935 lines).

## Helper Functions

### `_ensure_backup_dir`

**Decorators/Route:** N/A (private helper)  
**Purpose:** Create the backup directory lazily once per process.  
**Parameters:** None  
**Returns:** None  
**Behavior Notes:** Uses a module-level `_BACKUP_DIR_READY` flag to ensure `mkdir` runs only once per process lifetime. Reads `BACKUP_DIR` from the `BACKUP_DIR` env var, defaulting to `/app/storage/backups`.

### `_apply_backup_retention`

**Decorators/Route:** N/A (private helper)  
**Purpose:** Delete oldest encrypted backup files when count exceeds `BACKUP_MAX_FILES`.  
**Parameters:** None  
**Returns:** None  
**Behavior Notes:** Reads `BACKUP_MAX_FILES` from env var (default: 100). Uses `os.scandir` for efficiency. Only matches files matching pattern `^wims_\d{8}_\d{6}\.sql\.enc$`. Sorts by mtime (newest first), deletes the oldest exceeding the max count. Gracefully handles `FileNotFoundError` on unlink (race condition with other workers).

---

## Pydantic Schemas

### `UserCreate`

**Fields:**

| Name | Type | Required | Description |
|---|---|---|---|
| email | EmailStr | Yes | User email (validated email format) |
| first_name | str | Yes | First name (validated non-blank) |
| last_name | str | Yes | Last name (validated non-blank) |
| role | str | Yes | One of `VALID_ROLES` |
| contact_number | Optional[str] | No | Contact phone number |
| assigned_region_id | Optional[int] | No | FK to `wims.ref_regions.region_id` |

**Validators:** `@field_validator("role")` — rejects values not in `VALID_ROLES` tuple. `@field_validator("first_name", "last_name")` — strips whitespace and rejects blank strings.

### `UserUpdate`

**Fields:**

| Name | Type | Required | Description |
|---|---|---|---|
| role | Optional[str] | No | One of `VALID_ROLES`; triggers session invalidation on role change |
| assigned_region_id | Optional[int] | No | FK to `wims.ref_regions.region_id` |
| is_active | Optional[bool] | No | Enable/disable user; propagates to Keycloak + session revocation |

### `SecurityLogUpdate`

**Fields:**

| Name | Type | Required | Description |
|---|---|---|---|
| admin_action_taken | Optional[str] | No | Free-text description of admin action taken |
| resolved_at | Optional[str] | No | ISO datetime string marking resolution |

### `ScheduledReportCreate`

**Fields:**

| Name | Type | Required | Description |
|---|---|---|---|
| name | str | Yes | Human-readable report name |
| cron_expr | str | Yes | Valid 5-field cron expression (validated by regex) |
| format | Literal["pdf", "excel", "csv"] | Yes | Output format |
| filters | dict[str, Any] | No | Report filter parameters (default: {}) |
| recipients | list[str] | No | Recipient email addresses (default: []) |
| enabled | bool | No | Whether the report schedule is active (default: True) |

**Validators:** `@field_validator("cron_expr")` — validates against strict 5-field cron regex (`_CRON_RE`). Supports `*`, ranges, lists, and step values.

---

## Route Handlers — Identity Management

### `create_user`

**Route:** `@router.post("/users", status_code=201)`  
**Auth:** `Depends(get_system_admin)`  
**DB Session:** `get_db` (service account — RLS set manually via `wims.exec_as_system_admin`)  
**Purpose:** Onboard a new user — creates in Keycloak, inserts into `wims.users`, returns temporary password in plaintext.

**Parameters:**

| Name | Type | Source | Description |
|---|---|---|---|
| body | UserCreate | Body | User creation payload |
| request | Request | Injected | FastAPI request object for audit logging |
| _admin | dict | Depends(get_system_admin) | Authenticated admin user dict |
| db | Session | Depends(get_db) | DB session (service account — NOT RLS) |

**Returns:** `{"status": "created", "keycloak_id": str, "username": str, "role": str, "temporary_password": str, "note": str}`

**Errors:**

| Status | Condition |
|---|---|
| 201 | Success |
| 409 | Keycloak conflict — user with this email already exists |
| 422 | Invalid region ID (FK not found in `wims.ref_regions`) |
| 502 | Keycloak user creation failed |
| 500 | Database constraint violation or DB insert failure after Keycloak creation |

**Behavior Notes:**
- Uses email (lowercased, max 50 chars) as Keycloak username
- Generates temp password via `generate_temp_password()`
- Calls `create_keycloak_user()` first; 409/Conflict raises 409 immediately
- After Keycloak success, validates `assigned_region_id` exists
- Manually sets RLS context via `SELECT wims.exec_as_system_admin(:uid)` because `get_db()` (service account) has no JWT
- INSERT uses `ON CONFLICT (keycloak_id) DO UPDATE` as idempotency safeguard
- On `IntegrityError`, examines error string for `assigned_region_id`/`ref_regions` to return 422 vs generic 500
- Logs audit event `CREATE_USER` on table `users` with record_id=None (known bug F-01)
- Returns temp password **in plaintext** for admin distribution (prototype only)

### `get_users`

**Route:** `@router.get("/users")`  
**Auth:** `Depends(get_system_admin)`  
**DB Session:** `get_db_with_rls`  
**Purpose:** Return all users with Keycloak IDs masked for privacy.

**Returns:** `list[dict]` — each item: `user_id`, `keycloak_id_masked`, `username`, `role`, `assigned_region_id`, `is_active`, `created_at`

**Behavior Notes:** Keycloak IDs masked as first 4 chars + `****` + last 4 chars. Results ordered by `username` ASC.

### `update_user`

**Route:** `@router.patch("/users/{user_id}")`  
**Auth:** `Depends(get_system_admin)`  
**DB Session:** `get_db_with_rls`  
**Purpose:** Update role, `assigned_region_id`, or `is_active`. Disabling user also disables in Keycloak and revokes all sessions. Role changes invalidate sessions.

**Parameters:**

| Name | Type | Source | Description |
|---|---|---|---|
| user_id | str | Path | UUID of the user to update |
| body | UserUpdate | Body | Fields to update |
| request | Request | Injected | FastAPI request for audit logging |
| _admin | dict | Depends | Authenticated admin user dict |
| db | Session | Depends(get_db_with_rls) | DB session with RLS |

**Returns:** `{"status": "ok", "user_id": str}` on full success, or `{"status": "partial", "user_id": str, "warning": str}` if DB updated but Keycloak sync failed.

**Errors:** 400 (no fields), 404 (not found)

**Behavior Notes:**
- Dynamically builds SQL SET clause from non-None fields
- Fetches `keycloak_id` and `current_role` BEFORE update for Keycloak sync
- If `is_active` changed: calls `set_user_enabled()` in Keycloak
- If `is_active=False`: also calls `adm.user_logout()` + `session_manager.revoke_all_sessions()` for instant Redis revocation
- Keycloak sync failure after DB update is non-fatal: returns `status: "partial"` with warning
- Role change + differs from current: calls `logout_user_sessions()` to invalidate all sessions
- Logs audit events: `ROLE_CHANGE_TO_{new_role}`, `DEACTIVATE`, or `ACTIVATE`

### `get_active_sessions`

**Route:** `@router.get("/active-sessions")`  
**Auth:** `Depends(get_system_admin)`  
**DB Session:** `get_db_with_rls`  
**Purpose:** Fetch all active Keycloak sessions for all active users.

**Returns:** `list[dict]` — each item: `session_id`, `user_id`, `username`, `role`, `ip_address`, `start`, `last_access`, `clients`

**Behavior Notes:** Queries only `is_active = TRUE` users. Iterates each user calling `adm.get_sessions()`. Silently skips users with null `keycloak_id`. Sorted by `last_access` DESC.

### `force_logout_user`

**Route:** `@router.post("/users/{user_id}/logout")`  
**Auth:** `Depends(get_system_admin)`  
**DB Session:** `get_db_with_rls`  
**Purpose:** Force logout all sessions for a specific user.

**Returns:** `{"status": "ok"}`

**Errors:** 404 (not found or no keycloak_id), 500 (revocation failure)

**Behavior Notes:** Fetches `keycloak_id` from `wims.users`. Calls `adm.user_logout()` + `session_manager.revoke_all_sessions()`. No separate audit event logged.

---

## Route Handlers — System Health

### `get_system_health`

**Route:** `@router.get("/health")`  
**Auth:** `Depends(get_system_admin)`  
**DB Session:** `get_db` (service account, no RLS)  
**Purpose:** Fetch health status for DB, Redis, and Keycloak with latency.

**Returns:** `{"status": "HEALTHY"|"DEGRADED", "components": {"database": {...}, "redis": {...}, "keycloak": {...}}}`

Each component: `{"status": "HEALTHY"|"UNHEALTHY", "latency_ms": int}` or with `"error"` field on failure.

**Behavior Notes:** DB check: `SELECT 1`. Redis check: `redis.from_url(REDIS_URL)`, `ping()`. Keycloak check: `_get_admin_client()`, `users_count()`. Any unhealthy component sets top-level status to `DEGRADED`. Uses `get_db` (no RLS) so health works even when RLS context unavailable.

---

## Route Handlers — Security Telemetry

### `get_security_logs`

**Route:** `@router.get("/security-logs")`  
**Auth:** `Depends(get_system_admin)`  
**DB Session:** `get_db_with_rls`  
**Purpose:** Fetch all security threat logs ordered by timestamp DESC.

**Returns:** `list[dict]` — each item: `log_id`, `timestamp`, `source_ip`, `destination_ip`, `suricata_sid`, `severity_level`, `raw_payload`, `xai_narrative`, `xai_confidence`, `admin_action_taken`, `resolved_at`, `reviewed_by`

**Behavior Notes:** Queries `wims.security_threat_logs` with no pagination or filter. `xai_confidence` cast to float.

### `analyze_security_log`

**Route:** `@router.post("/security-logs/{log_id}/analyze")`  
**Auth:** `Depends(get_system_admin)`  
**DB Session:** `get_db_with_rls`  
**Purpose:** Run AI analysis via Ollama on a security threat log. Updates `xai_narrative` and `xai_confidence` in place.

**Parameters:** `log_id` (int, path)

**Returns:** Delegates to `analyze_threat_log(log_id, db)` from `services.ai_service`.

**Behavior Notes:** Async endpoint. Does not log a separate audit event.

### `update_security_log`

**Route:** `@router.patch("/security-logs/{log_id}")`  
**Auth:** `Depends(get_system_admin)`  
**DB Session:** `get_db_with_rls`  
**Purpose:** Update a security threat log — structured HITL decision or legacy free-text path.

**Schema — `SecurityLogUpdate`:** `action` (optional, one of `CONFIRM_THREAT | FALSE_POSITIVE | REQUEST_MORE_INFO`), `note` (optional string), `admin_action_taken` (optional, legacy), `resolved_at` (optional ISO datetime, legacy).

**HITL path (when `action` provided):**  
- Maps `action` to human-readable `admin_action_taken` label via `HITL_ACTION_LABELS` dict  
- Writes `hitl_decision` JSONB: `{ "action": <action>, "note": <note|null>, "reviewed_by": <admin user_id>, "reviewed_at": <now ISO8601> }`  
- Sets `resolved_at = now()` for CONFIRM_THREAT and FALSE_POSITIVE only  
- Sets `resolved_at = NULL` for REQUEST_MORE_INFO (not a terminal resolution)  
- Returns 400 for invalid `action` value  

**Legacy path (when `action` is null but `admin_action_taken` provided):**  
- Sets `admin_action_taken` directly  
- `resolved_at` can be set via `resolved_at` ISO string param  

**Returns:** `{"status": "ok", "log_id": int}`

**Errors:** 400 (no fields to update, or invalid action value), 404 (log not found)

---

## Route Handlers — Analytics Read Model

### `backfill_analytics`

**Route:** `@router.post("/analytics/backfill")`  
**Auth:** `Depends(get_system_admin)`  
**DB Session:** `get_db_with_rls`  
**Purpose:** Backfill `wims.analytics_incident_facts` from existing VERIFIED non-archived incidents.

**Returns:** `{"status": "ok", "synced_count": int}`

**Behavior Notes:** Delegates to `backfill_analytics_facts()` from `services.analytics_read_model`. Designed as one-shot seed/migration tool, not incremental sync.

---

## Route Handlers — Audit Oversight

### `get_audit_logs`

**Route:** `@router.get("/audit-logs")`  
**Auth:** `Depends(get_system_admin)`  
**DB Session:** `get_db_with_rls`  
**Purpose:** Fetch system audit trails with pagination.

**Query Parameters:** `limit` (int, default 50, 1-500), `offset` (int, default 0)

**Returns:** `{"items": list[dict], "total": int, "limit": int, "offset": int}`
Each item: `audit_id`, `user_id`, `action_type`, `table_affected`, `record_id`, `ip_address`, `user_agent`, `timestamp`

**Behavior Notes:** Paginated with LIMIT/OFFSET. Returns total count of all rows for UI pagination. Ordered by `timestamp` DESC.

---

## Route Handlers — Scheduled Reports

### `create_scheduled_report`

**Route:** `@router.post("/scheduled-reports", status_code=201)`  
**Auth:** `Depends(get_system_admin)`  
**DB Session:** `get_db_with_rls`  
**Purpose:** Create a scheduled analytics report configuration.

**Returns:** `{"id": int, "name": str, "cron_expr": str, "format": str, "enabled": bool, "created_at": str}`

**Behavior Notes:** INSERT with RETURNING. `filters` and `recipients` stored as JSON/array columns. Does not schedule the cron job directly — relies on external scheduler polling the DB. No audit event logged.

### `list_scheduled_reports`

**Route:** `@router.get("/scheduled-reports")`  
**Auth:** `Depends(get_system_admin)`  
**DB Session:** `get_db_with_rls`  
**Purpose:** List all scheduled analytics reports ordered by ID DESC.

**Returns:** `list[dict]` — each item: `id`, `name`, `cron_expr`, `format`, `enabled`, `created_at`

**Behavior Notes:** No pagination or filtering.

---

## Route Handlers — Backup Management

### `trigger_backup`

**Route:** `@router.post("/backup", status_code=202)`  
**Auth:** `Depends(get_system_admin)`  
**DB Session:** `get_db_with_rls`  
**Purpose:** Run `pg_dump` of the wims database, encrypt with AES-256-GCM, apply retention, log audit.

**Returns:** `{"filename": str, "size_bytes": int, "created_at": str}`

**Errors:** 500 (invalid DATABASE_URL, pg_dump not found, pg_dump failed, encryption failed), 504 (pg_dump timeout after 120s)

**Behavior Notes:** Calls `_ensure_backup_dir()`. Parses `DATABASE_URL` with `urllib.parse.urlparse`. Sets `PGPASSWORD` env var. Runs `pg_dump` with `--no-password`. Encrypts `.sql` to `.sql.enc` via `utils.backup_crypto.encrypt_backup()` (AES-256-GCM). Calls `_apply_backup_retention()`. Logs `BACKUP_TRIGGERED` audit. Filename format: `wims_{YYYYMMDD}_{HHMMSS}.sql.enc`.

### `list_backups`

**Route:** `@router.get("/backups")`  
**Auth:** `Depends(get_system_admin)`  
**DB Session:** N/A (filesystem only)  
**Purpose:** List all available encrypted backup files sorted newest-first.

**Returns:** `list[dict]` — each item: `filename`, `size_bytes`, `created_at` (ISO format)

**Behavior Notes:** Globs `BACKUP_DIR / "wims_*.sql.enc"`. Uses `stat().st_mtime`. No DB or Keycloak interaction.

### `download_backup`

**Route:** `@router.get("/backup/{filename}")`  
**Auth:** `Depends(get_system_admin)`  
**DB Session:** N/A (filesystem only)  
**Purpose:** Download a specific encrypted backup file.

**Returns:** `FileResponse` with `media_type="application/octet-stream"`

**Errors:** 400 (path traversal or invalid filename format), 404 (file not found)

**Behavior Notes:** Strict filename validation against regex `^wims_\d{8}_\d{6}\.sql\.enc$`. Uses FastAPI `FileResponse`. Caller must handle AES-256-GCM decryption client-side.
