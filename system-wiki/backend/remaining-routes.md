---
title: Remaining Route Files API Reference
created: 2026-05-16
updated: 2026-06-04
type: backend
tags: [wims-bfp, backend, api-reference, incidents, analytics, dmz, civilian, sessions, user, ref]
sources: [src/backend/api/routes/incidents.py, src/backend/api/routes/analytics.py, src/backend/api/routes/public_dmz.py, src/backend/api/routes/civilian.py, src/backend/api/routes/sessions.py, src/backend/api/routes/user.py, src/backend/api/routes/ref.py]
status: draft
---

# Remaining Route Files — Full API Reference

Covering 7 route files: incidents.py, analytics.py, public_dmz.py, civilian.py, sessions.py, user.py, ref.py.

---

## `incidents.py` — `/api` prefix

### `upload_incident_bundle()`

**Route:** `POST /incidents/upload-bundle`  
**Auth:** `get_current_wims_user`  
**DB:** `get_db_with_rls`  
**Purpose:** Legacy batch incident upload from frontend bundle flow.

**Parameters:** Body must contain `incidents` list of dicts with optional `incident_nonsensitive_details`, `incident_sensitive_details`, `longitude`/`latitude`, `region_id`.

**Returns:** `{"status": "ok", "batch_id": int, "incident_ids": [int], "message": str}`

**Errors:** 400 (no incidents), 403 (REGION_MISMATCH for encoder outside assigned region), 500

**Behavior:** Resolves `assigned_region_id` from DB. Creates data_import_batch. Iterates incidents INSERTing fire_incidents (DRAFT) + nonsensitive + sensitive details. Syncs analytics after commit.

### `upload_attachment()`

**Route:** `POST /incidents/{incident_id}/attachments` (status 201)  
**Auth:** `get_current_wims_user`  
**DB:** `get_db_with_rls`  
**Purpose:** Upload a file attachment to an incident.

**Parameters:** `incident_id` (path), `file` (UploadFile, File(...))

**Returns:** `{"status": "ok", "attachment_id": incident_id, "message": str}`

**Errors:** 404 (incident not found), 500

**Behavior:** Async. Verifies incident exists. Saves to storage dir with UUID filename. Computes SHA-256 hash (chunked at 1MB). Records metadata in `incident_attachments`. On DB failure, rolls back and removes file.

### `create_incident()`

**Route:** `POST /incidents` (status 201)  
**Auth:** `get_current_wims_user`  
**DB:** `get_db_with_rls`  
**Purpose:** Create a new incident with minimal fields. Geospatial intake.

**Parameters:** `body` (IncidentCreate with latitude, longitude, description, verification_status)

**Returns:** IncidentResponse with incident_id, lat, lon, encoder_id, status, created_at

**Behavior:** Converts lon/lat to WKT POINT. Picks first ref_regions as fallback region. Syncs analytics after insert.

### `get_incidents()`

**Route:** `GET /incidents`  
**Auth:** `get_incident_viewer`  
**DB:** `get_db_with_rls`  
**Purpose:** List incidents with pagination and filters.

**Query params:** limit (1-200, default 50), offset, category, status

**Returns:** `{"items": [...], "total": int, "limit": int, "offset": int}`

**Behavior:** Scoped to region if user has `assigned_region_id`. Filters `is_archived = FALSE`. Joins nonsensitive/sensitive details + ref_barangays. Orders by created_at DESC.

### `export_analyst_incidents()`

**Route:** `POST /incidents/analyst/export/{export_format}`  
**Auth:** `get_analyst_or_admin`  
**DB:** None  
**Purpose:** Queue an async analyst incident export.

**Parameters:** `export_format` (path: csv/pdf/excel), body (AnalystIncidentExportRequest with filters, columns, incident_ids)

**Returns:** `{"task_id": "uuid-string"}`

**Behavior:** Queues `export_analyst_incidents_task.delay()`. Deduplicates incident_ids. Returns immediately.

### `get_analyst_incident_list()`

**Route:** `GET /incidents/analyst-list`  
**Auth:** `get_analyst_or_admin`  
**DB:** `get_db_with_rls`  
**Purpose:** Paginated analyst incident list with filters and sorting.

**Query params:** start_date, end_date, region_id, province, municipality, incident_type, alarm_level, casualty_severity, damage_min, damage_max, incident_ids (comma-separated), page (default 1), page_size (default 25, 1-100), sort_by, sort_dir

**Returns:** `{"incidents": [...], "total": int, "page": int, "page_size": int}`

**Behavior:** Always filters VERIFIED + not archived. Uses analytics_incident_facts + fallback to nonsensitive_details. Allowed sort columns: notification_dt, region, municipality_name, barangay_name, general_category, sub_category, alarm_level, estimated_damage_php, total_response_time_minutes. Casualty filter: high=deaths>0, medium=injuries>0 deaths=0, low=0. incident_ids for bulk lookup.

### `get_analyst_incident_detail()`

**Route:** `GET /incidents/analyst/{incident_id}`  
**Auth:** `get_analyst_or_admin`  
**DB:** `get_db_with_rls`  
**Purpose:** Single incident detail for analyst view.

**Returns:** Full detail: incident_id, reference_number, encoder_id, encoder_username, verification_status, region, province/municipality/barangay_name, general_category, sub_category, alarm_level, estimated_damage_php, total_response_time_minutes, casualty_severity, data_hash, sync_status, has_wildland_afor

**Errors:** 404 (not VERIFIED, archived, or not found)

**Behavior:** Only VERIFIED + not archived. Casuality severity derived from counts. sync_status indicates analytics_incident_facts presence.

### `get_analyst_incident_wildland_detail()`

**Route:** `GET /incidents/analyst/{incident_id}/wildland`  
**Auth:** `get_analyst_or_admin`  
**DB:** `get_db_with_rls`  
**Purpose:** Wildland AFOR detail for analyst view.

**Returns:** `{incident_id, reference_number, wildland: {...}, alarm_statuses: [...], assistance_rows: [...]}`

**Errors:** 404 (not found, not VERIFIED, archived, or no wildland AFOR)

**Behavior:** Verifies parent is VERIFIED + not archived. Fetches incident_wildland_afor + alarm_statuses + assistance_rows (both ordered by sort_order).

---

## `analytics.py` — `/api/analytics` prefix

All endpoints require `get_analyst_or_admin` and use `get_db_with_rls`. They delegate to `services/analytics_read_model.py`.

| # | Route | Function | Purpose |
|---|---|---|---|
| 1 | `POST /refresh-views` | `trigger_materialized_view_refresh()` | Queues Celery task to refresh MVs CONCURRENTLY. Returns `{task_id, status: "queued"}`. No DB session. |
| 2 | `GET /heatmap` | `get_heatmap()` | Returns GeoJSON FeatureCollection of incident points. Validates damage_min≤damage_max. Parses region_ids from comma-separated. |
| 3 | `GET /trends` | `get_trends_route()` | Time-series incident counts. Interval param: daily/weekly/monthly/quarterly/yearly. |
| 4 | `GET /comparative` | `get_comparative()` | Two-range comparison. Required: range_a_start, range_a_end, range_b_start, range_b_end. Returns counts + variance_percent. |
| 5 | `GET /execution-plans` | `get_execution_plans()` | Performance audit — runs EXPLAIN on sample queries to prove index usage. No user-supplied params. |
| 6 | `POST /export/csv` | `export_csv()` | Queue async CSV export. Body: {filters, columns}. Returns task_id. |
| 7 | `POST /export/pdf` | `export_pdf()` | Queue async PDF export. Same pattern. |
| 8 | `POST /export/excel` | `export_excel()` | Queue async XLSX export. Same pattern. |
| 9 | `GET /export/{task_id}` | `download_export()` | Download completed export file. Checks Celery AsyncResult state. Returns FileResponse. Errors: 409 (PENDING/FAILED), 404 (not found). |
| 10 | `GET /filter-options` | `filter_options_route()` | Cascading filter dropdown values for province/municipality. |
| 11 | `GET /type-distribution` | `get_type_distribution_route()` | Incident counts by general_category (pie chart data). |
| 12 | `GET /top-barangays` | `get_top_barangays_route()` | Top N barangays by incident count. limit: 1-50, default 10. |
| 13 | `GET /response-time-by-region` | `get_response_time_by_region_route()` | AVG/MIN/MAX response time grouped by region. |
| 14 | `GET /compare-regions` | `compare_regions_route()` | Cross-region comparison. Required: region_ids (comma-separated, min 2). |
| 15 | `GET /top-n` | `top_n_route()` | Configurable top-N. Required: metric (incidents/response_time/casualties/damage_cost), dimension (barangay/fire_station/region/municipality). |

---

## `public_dmz.py` — `/api/v1/public` prefix

### `rate_limit_public_dmz()` (dependency)

Async Redis-based rate limiter. **3 requests per IP per hour**. Key: `public_rate_limit:{ip}`. **Fail-open** on Redis unreachable (allows through). Errors: 429 (exceeded) with `Retry-After` header.

**Connection model:** Creates a fresh `ConnectionPool` per call (no global pool caching) and closes the Redis client/pool after the Lua script runs, so the dependency works safely across asyncio event loops without accumulating idle sockets. This is important for FastAPI `TestClient`, which creates a new loop per request.

**Lua script:** Sliding-window sorted set. Prunes entries older than the window via `ZREMRANGEBYSCORE`, counts via `ZCARD`, returns `{1, retry_after}` when count >= threshold, else records the request via `ZADD` with TTL.

**Logging:** Redis connection failures and Lua eval exceptions are logged at WARNING level (`wims.public_dmz` logger) before fail-open return. Intentional 429 rate-limit responses (raised as `HTTPException`) are not logged by the rate limiter.

**Coordinate guard:** After the PostGIS coordinate SELECT, a `coord_row is None` check raises HTTP 500 `"Failed to retrieve inserted incident coordinates"` instead of allowing an uncaught `TypeError`.

### `submit_public_incident()`

**Route:** `POST /report` (status 201)  
**Auth:** **None** — fully unauthenticated  
**DB:** `get_db` (no RLS)  
**Rate limit:** `Depends(rate_limit_public_dmz)`  
**Purpose:** The only completely public incident submission endpoint. Designed for civilian DMZ reporters.

**Body:** `PublicIncidentCreate` (latitude, longitude, description)

**Returns:** `PublicIncidentResponse` with incident_id, lat, lon, status="PENDING_VALIDATION", created_at

**Behavior:** Zero-trust: encoder_id=NULL, import_batch_id=NULL, status=PENDING_VALIDATION. Region resolved from coordinates (stub — picks first ref_regions row). No `wims.current_user_id` set (no RLS context). Uses `_normalf()` for coordinate WKT formatting.

---

## `civilian.py` — `/api/civilian` prefix

### `submit_civilian_report()`

**Route:** `POST /reports` (status 201)  
**Auth:** **None** — fully unauthenticated  
**DB:** `get_db` (no RLS)  
**Purpose:** Zero-trust civilian report submission. trust_score always 0.

**Body:** `CivilianReportCreate` (latitude, longitude, description)

**Returns:** `CivilianReportResponse` with report_id, lat, lon, description, trust_score=0, status="PENDING", created_at

### `get_civilian_report()`

**Route:** `GET /reports/{report_id}`  
**Auth:** **None** — fully unauthenticated  
**DB:** `get_db` (no RLS)  
**Purpose:** Public report status check. Anyone can check their report status.

**Returns:** `CivilianReportResponse` with current status and trust_score

**Errors:** 404 (report not found)

---

## `sessions.py` — `/api/admin` prefix

### `list_user_sessions()`

**Route:** `GET /sessions/{user_id}`  
**Auth:** `get_system_admin`  
**DB:** `get_db_with_rls`  
**Purpose:** List active Keycloak sessions for a WIMS user.

**Returns:** `{"sessions": [...]}`

**Behavior:** Translates internal WIMS UUID to Keycloak UUID via `_resolve_keycloak_id()`. Delegates to `keycloak_admin.get_user_sessions()`.

### `terminate_user_session()`

**Route:** `DELETE /sessions/{user_id}/{session_id}`  
**Auth:** `get_system_admin`  
**DB:** `get_db_with_rls`  
**Purpose:** Terminate all sessions for a user. Despite accepting session_id, python-keycloak doesn't support single-session revoke, so terminates ALL.

**Returns:** `{"status": "ok", "user_id": "uuid"}`

**Errors:** 404 (user not found)

---

## `user.py` — `/api/user` prefix

### Pydantic Schemas

**`ProfileUpdate`:** first_name, last_name (both non-blank), email (`Optional[EmailStr]` — omit or provide valid email format), current_password (`Optional[str]`, required only when email is present because email is the login identity), contact_number (`^09\\d{9}$`). Email is self-service editable only with current-password step-up (#28, #86).

**`PasswordChange`:** current_password, new_password (min 8, 1 upper, 1 digit, 1 special), otp_code (optional, for 2FA).

### `get_my_profile()`

**Route:** `GET /me/profile`  
**Auth:** `get_current_wims_user`  
**DB:** `get_db_with_rls`
**Purpose:** Fetch own profile from Keycloak + WIMS DB.

**Returns:** Keycloak profile fields + contact_number from wims.users.

**Behavior:** Fetches from Keycloak via `keycloak_admin.get_user_profile()`. Syncs contact_number from local DB.

### `update_my_profile()`

**Route:** `PATCH /me`  
**Auth:** `get_current_wims_user`  
**DB:** `get_db_with_rls`  
**Purpose:** Update own profile. JWT authentication is enough for name/contact updates; email/login-identity changes additionally require `current_password` verification through Keycloak Direct Grant (`bfp-client`).

**Returns:** `{"status": "ok", "message": "Profile updated successfully"}` or `{"status": "partial", "message": "...database sync failed..."}` when Keycloak succeeds but local DB sync fails.

**Errors:** 400 (no fields, missing current_password for email), 401 (invalid current_password), 422 (schema validation, including invalid/empty email or contact number), 502 (Keycloak failure)

**Behavior:** Verifies current password before email updates, then updates Keycloak first (first_name, last_name, email/username, contact_number). After Keycloak success, syncs email and contact_number to `wims.users`. On DB sync failure, rolls back the failed local update and returns `partial` without rolling back Keycloak (Keycloak remains source of truth).

### `change_my_password()`

**Route:** `PATCH /me/password`  
**Auth:** `get_current_wims_user`  
**DB:** None  
**Purpose:** Change own password. Verifies current password against Keycloak first.

**Returns:** `{"status": "ok", "message": "Password changed successfully"}`

**Errors:** 401 (incorrect password or OTP), 502

**Behavior:** Verifies current password via Keycloak Direct Grant (uses `bfp-client`). If user has 2FA, requires otp_code as `totp` parameter. After verification, calls `change_user_password()`. On success, terminates ALL sessions forcing re-login with new password.

---

## `ref.py` — `/api/ref` prefix

All routes use `get_current_wims_user` + `get_db_with_rls`.

### `get_regions()`

**Route:** `GET /regions`  
**Query param:** `region_id` (Optional[int])  
**Returns:** `[{region_id, region_name, region_code}]` ordered by region_id

### `get_provinces()`

**Route:** `GET /provinces`  
**Query param:** `region_id` (Optional[int])  
**Returns:** `[{province_id, province_name, region_id}]` filtered by region_id

### `get_cities()`

**Route:** `GET /cities`  
**Query params:** `province_id` (Optional[int]), `province_ids` (Optional[str], comma-separated)  
**Returns:** `[{city_id, city_name, province_id}]` filtered by province(s)  
**Behavior:** Input sanitization via `isdigit()` before int conversion. Uses string interpolation for IN clause with sanitized integers (safe).
