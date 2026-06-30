---
title: Backend Services
created: 2026-05-16
updated: 2026-06-03
type: backend
tags: [wims-bfp, backend, services, analytics, keycloak, duplicate-detection, civilian-triage, ai, xai, email]
sources: [src/backend/services/]
status: draft
---

# Backend Services

Business logic layer between routes and database. All services are in `src/backend/services/`.

---

## Civilian Triage

**Files:** `src/backend/services/civilian_triage/`

Workflow Module for public civilian report triage. `src/backend/api/routes/triage.py` is now the HTTP Adapter for auth dependencies, query/body binding, response models, and disabled legacy promotion endpoints.

### Module Surface

- `models.py` — Pydantic request/response contracts for queue, cluster activity, merge candidates, terminal actions, corrections, split/merge, and workflow results.
- `policies.py` — terminal report statuses, role capability predicates, claim staleness, aging/timeout thresholds, related-report and merge-candidate thresholds, GPS mismatch threshold, and severity rules.
- `repository.py` — cluster fetch, claim validation, claim response, and internal-note helpers.
- `queue_projection.py` — `get_queue`, including durable singleton-cluster materialization before queue reads.
- `workflow.py` — claim, refresh activity, activity projection, merge candidates, terminal action, correction, split, and merge commands.
- `notifications.py` — status notification enqueue seam; enqueue errors are logged and do not roll back committed triage state.

### Compatibility Notes

Civilian reports remain `wims.citizen_reports` public signal rows and the triage workflow does not create `fire_incidents`. Queue projection does not expose `device_id`, `ip_hash`, FCM tokens, or other privacy fields. Public duplicate suggestions remain 500m in the civilian API, while triage related counts/severity remain 100m / 1hr.

---

## Regional Incidents

**Files:** `src/backend/services/regional_incidents/lifecycle.py`, `src/backend/services/regional_incidents/policies.py`

Lifecycle command Module for official `wims.fire_incidents` state transitions. `src/backend/api/routes/regional.py` remains the HTTP Adapter for auth/RLS/request parsing, while this Module owns selected transition rules and side effects.

### Policy Surface

`policies.py` defines:
- `VALIDATOR_ACTION_MAP`: accept/accept_replace -> VERIFIED, pending -> PENDING, reject -> REJECTED.
- `VALIDATOR_DEFAULT_QUEUE_STATUSES`: `("PENDING", "PENDING_VALIDATION")`.
- encoder transition matrix for submit, unpend, force-replace, and delete.
- validator transition matrix for `PENDING` and `PENDING_VALIDATION` inputs.

### Lifecycle Commands

`lifecycle.py` exposes:
- `submit_incident_for_review_command`
- `unpend_incident_command`
- `delete_encoder_incident`
- `force_replace_pending_incident`
- `verify_incident_command`
- `bulk_approve_pending_incidents`
- `archive_finalized_incident`

These commands preserve existing route contracts while centralizing IVH writes, duplicate checks for manual submit/validator/bulk approval, immutable replacement ordering, reference-number assignment, and analytics sync after validator approval.

### Compatibility Notes

Encoder submission still writes `PENDING`. Validator queues and policy tests keep compatibility with both `PENDING` and `PENDING_VALIDATION`. AFOR import duplicate handling remains separate in `services.afor_import`.

---

## Analytics Read Model

**File:** `src/backend/services/analytics_read_model.py` (~1119 lines)

Query and sync service for `NATIONAL_ANALYST` endpoints. Uses `wims.analytics_incident_facts` and `wims.mv_*` materialized views instead of scanning source tables directly.

### Sync Functions

#### `sync_incident_to_analytics(db, incident_id)`

Fetches fire_incidents + incident_nonsensitive_details + ref_barangays. If incident is VERIFIED + not archived: upserts into analytics_incident_facts with all 16 fact columns. Otherwise: DELETEs from analytics_incident_facts. All exceptions caught and logged at WARNING level (never raises).

#### `sync_incidents_batch(db, incident_ids)`

Bulk version for batch operations. Partition results in Python into to_delete + to_upsert. Bulk DELETE + bulk upsert using `jsonb_to_recordset`. All exceptions caught at WARNING level.

#### `backfill_analytics_facts(db) -> int`

Fetches all VERIFIED + non-archived incidents. Bulk-upserts via `jsonb_to_recordset`. Returns count of synced rows (0 on failure). Commits on success, rolls back on failure.

### Query Functions

#### `services.analytics.filters`

Typed query Interface for analytics filters.

- `AnalyticsQueryFilters` normalizes date, region, geography, incident type, alarm, casualty severity, damage range, and selected incident filters.
- `build_analytics_filters(...)` parses comma-separated `region_ids`, deduplicates selected incident ids, and rejects `damage_max < damage_min`.
- `append_common_filters(clauses, params, filters, ...)` compiles shared SQL clauses for analytics facts and analyst-list/export aliases.

The legacy `analytics_read_model._append_common_filters(...)` wrapper delegates to this Module.

#### `_append_common_filters(clauses, params, **filters)`

Mutates SQL WHERE clauses in-place for all common filter parameters: start_date, end_date, region_id, region_ids, province, municipality, incident_type, alarm_level, casualty_severity ("high"/"medium"/"low" derived from death/injury counts), damage_min, damage_max.

#### `get_heatmap_points(db, **filters) -> list[dict]`

Returns `[{incident_id, lon, lat, alarm_level, general_category, notification_dt}]` from analytics_incident_facts with all filters applied.

#### `get_trends(db, *, interval="daily", **filters) -> list[dict]`

Groups by `date_trunc(:trunc_val, notification_dt)`. Interval map: "daily"→"day", "weekly"→"week", "monthly"→"month", "quarterly"→"quarter", "yearly"→"year". Returns `[{bucket, count}]`.

#### `count_in_range(db, range_start, range_end, **filters) -> int`

Comparative range count with hard-coded date clauses.

#### `get_export_rows(db, filters, columns, incident_ids?) -> list[dict]`

Whitelisted 26 columns. Resolves SQL aliases (verification_status→fi., facts→a., others→nd.). Joins analytics_incident_facts + incident_nonsensitive_details + fire_incidents.

#### `get_analyst_export_rows(db, filters, columns, incident_ids?) -> list[dict]`

Wrapper around get_export_rows that deduplicates and sorts incident_ids.

#### `get_incident_export_data(db, incident_id) -> dict[str, Any]`

Fetches all fields needed to fill the AFOR template for a single VERIFIED incident. Used by export tasks — called with RLS context already set. Returns a flat dict with ~70 keys matching `AFOR_CELL_MAP` in `tasks/exports.py`.

**Joins:** fire_incidents + incident_nonsensitive_details + analytics_incident_facts + ref_regions + incident_wildland_afor.

**JSON fields parsed:** `alarm_timeline` (extracts per-status datetimes), `resources_deployed` (counts vehicles via `_count_resource()`), `problems_encountered`.

**Coverage:** Section A (response details, times, distances), Section B (classification, damage, impact counts), Section C (assets/resources), Section D (alarm timeline), Section E (casualties by gender), Section F (personnel), and Prepared/Noted by fields. PII fields (caller_name, owner_name, establishment_name) are left blank.

#### `get_filter_options(db, *, field, region_id, province, start_date, end_date) -> list[str]`

DISTINCT sorted values for cascading filter dropdowns. field must be "province" or "municipality". Raises ValueError otherwise.

#### `get_type_distribution(db, **filters) -> list[dict]`

GROUP BY general_category. Returns `[{type, count}]`.

#### `get_top_barangays(db, *, limit=10, **filters) -> list[dict]`

Top N barangays by incident count. Limit clamped to max 50. Returns `[{barangay, count}]`.

#### `get_response_time_by_region(db, **filters) -> list[dict]`

AVG/MIN/MAX response time GROUP BY region_id. Filters NULL response times. Returns `[{region_id, region_name, avg_response_time, min_response_time, max_response_time}]`.

#### `get_compare_regions(db, region_ids, **filters) -> list[dict]`

Cross-region comparison. Passes region_ids to _append_common_filters. Uses MODE() WITHIN GROUP for top_type. Returns `[{region_id, total_incidents, avg_response_time, top_type}]`.

#### `get_top_n(db, metric, dimension, limit=10, **filters) -> list[dict]`

Configurable top-N. Valid metric: "incidents"/"response_time"/"casualties"/"damage_cost". Valid dimension: "barangay"/"fire_station"/"region"/"municipality". Raises ValueError on invalid. Returns `[{name, value, incident_count, metric_count}]`. For `response_time`, `value` is the average over incidents with non-null `total_response_time_minutes`; zero-sample groups are excluded and `metric_count` shows how many of the dimension's `incident_count` contributed to the average.

#### `verify_indexed_access(db) -> dict[str, str]`

Runs EXPLAIN on heatmap and trends queries to prove index usage.

---

## Duplicate Detection

**File:** `src/backend/services/duplicate_detection.py`

Spatial + temporal duplicate detection for fire incidents.

### `check_for_duplicate(db, *, incident_id, region_id, alarm_level, incident_date, lat, lon, general_category, incident_type_code, exclude_statuses, verified_window_seconds) -> int | None`

**Primary (spatial) path** — when lat+lon provided:
- Uses `ST_DWithin(fi.location::geography, ST_SetSRID(ST_MakePoint(:lon,:lat),4326)::geography, 5000)` — 5 km radius
- When incident_date: `DATE(nd.notification_dt AT TIME ZONE 'Asia/Manila') BETWEEN :fire_date - 1 day AND :fire_date + 1 day`
- When verified_window_seconds: `fi.verification_status = 'VERIFIED' AND fi.updated_at > NOW() - (:window_seconds || ' seconds')::interval` (bulk-accept guard)
- Orders by fi.updated_at DESC LIMIT 1

**Fallback (text) path** — when primary finds nothing or no coordinates:
- Matches on: region_id + (general_category OR incident_type_code)
- Same date/status/window options as primary

**Thresholds:** 5000 metres radius, ±1 day date window. No module-level constants — values are hard-coded in SQL.

---

## Keycloak Admin

**File:** `src/backend/services/keycloak_admin.py`

Keycloak administrative service for user lifecycle and session governance.

### `_get_admin_client() -> KeycloakAdmin`

Direct access grant against master realm using admin credentials. Returns KeycloakAdmin instance targeting `bfp` realm.

### `generate_temp_password() -> str`

14-char random password from `string.ascii_letters + string.digits + "!@#$%^&*"`.

### `create_keycloak_user(*, email, first_name, last_name, username, role, temp_password, contact_number) -> str`

1. Creates user with `enabled=True, emailVerified=True, requiredActions=["UPDATE_PASSWORD"]`
2. Sets temporary password
3. Assigns realm role
4. Returns Keycloak UUID

### `_assign_realm_role(adm, *, user_id, role_name)`

Fetches realm role by name via `adm.get_realm_role()` then assigns via `adm.assign_realm_roles()`.

### `set_user_enabled(keycloak_id, *, enabled)`

Updates user enabled flag. When disabling, also revokes all sessions via `adm.user_logout()`.

### `logout_user_sessions(keycloak_id)`

Revokes all active sessions via `adm.user_logout()`.

### `get_user_sessions(keycloak_id) -> list[dict]`

Returns sessions via `adm.get_sessions()` or [] on error.

### `update_user_profile(keycloak_id, *, first_name, last_name, email, contact_number)`

Builds payload from non-None fields. On email update, also updates username. Calls `adm.update_user()`.

### `change_user_password(keycloak_id, new_password)`

Sets non-temporary password via `adm.set_user_password()`.

### `get_user_profile(keycloak_id) -> dict`

Returns `{first_name, last_name, full_name, contact_number}` via `adm.get_user()`.

**Environment config:** `KEYCLOAK_REALM_URL` (default `http://keycloak:8080/auth/realms/bfp`), `KEYCLOAK_ADMIN_CLIENT_ID` (default `wims-admin-service`), `KEYCLOAK_ADMIN_CLIENT_SECRET`. Admin credentials: `KEYCLOAK_ADMIN_USER` (default `admin`), `KEYCLOAK_ADMIN_PASSWORD` (default `admin`).

---

## AI/XAI Service

**File:** `src/backend/services/ai_service.py`

IDS-to-SLM AI analysis via Ollama (qwen2.5:3b).

### Retry & Timeout (GH #245)

All three Ollama call sites use `_ollama_post_with_retry()`:
- **3 retries** with exponential backoff (2s / 4s / 8s) on `ConnectError` and 5xx.
- **No retry** on `TimeoutException` — inference is CPU-bound; retrying doubles load.
- **Timeout** from `OLLAMA_TIMEOUT` env var (default 120s), falling back to `system_config.ai_timeout_seconds`.
- **Generation cap** from `OLLAMA_NUM_PREDICT` env var (default 256 generated tokens) is sent as `options.num_predict` on JSON-generation calls to bound CPU-only inference latency.
- **Production concurrency guard:** Docker Compose sets `OLLAMA_NUM_PARALLEL=1` and `OLLAMA_MAX_LOADED_MODELS=1` for the Ollama service to avoid multiple CPU generations/model loads competing on the 4-vCPU limit.
- **Auto-AI default:** `auto_ai_analysis_enabled` is seeded as `false`; background HIGH/CRITICAL alert analysis is opt-in, while manual admin analysis remains available.

### `analyze_threat_log(log_id, db) -> dict

1. Fetches security log row from `wims.security_threat_logs`
2. Builds prompt with 5-key structured JSON output (anomaly_description, log_evidence, risk_assessment, recommended_action, confidence)
3. POSTs to `{OLLAMA_URL}/api/generate` with `model="qwen2.5:3b"`, `stream=False`, `format="json"`, `options.num_predict` via `_ollama_post_with_retry()`
4. Parses response JSON for 5 keys and `confidence`
5. Updates `wims.security_threat_logs` SET `xai_narrative`, `xai_confidence`
6. Returns full log row with updated XAI fields

### `generate_incident_narrative(incident_id, db) -> dict`

Generates 2-3 sentence plain-English narrative for VERIFIED fire incidents. Stores in `fire_incidents.ai_narrative` / `ai_narrative_confidence`.

### `analyze_audit_logs(audit_ids, db) -> dict`

Sends batched audit trail entries to Ollama for behavioral pattern analysis. Returns structured XAI result.

**Environment config:**

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_URL` | `http://wims-ollama:11434` | Ollama API base URL |
| `OLLAMA_TIMEOUT` | `120` | Inference HTTP timeout (seconds) |

**Errors:** 404 (not found), 409 (non-VERIFIED for narratives), 400 (invalid/missing IDs), 502 (Ollama unavailable/timed out/invalid JSON)

### Notable Edge Cases

**Graceful JSON degradation (2026-06-30, commit 76ade25):**
- `analyze_threat_log` and `analyze_audit_logs` no longer raise 502 when Ollama returns invalid/malformed JSON. Instead they fall back to raw text (threat_log) or empty strings (audit_logs) with 0.5 confidence.

**`xai_confidence_breakdown` can be `None` on graceful fallback:**
- When JSON parsing fails in `analyze_threat_log`, `confidence_breakdown` is set to `None` (Python) instead of `{}`.
- This flows into the return dict as `"xai_confidence_breakdown": None`, which serializes to JSON `null`.
- The frontend `normalizeNarrative` already handles `null`/missing breakdown gracefully.
- **Risk for future callers:** Any code that iterates `result["xai_confidence_breakdown"]` as a dict (e.g. `for k, v in result.items()`) would crash on `None`. All current callers (API route, Celery task) are safe.
- The DB write uses `CAST(:breakdown AS jsonb)` with `None` → SQL `NULL` — handled correctly.

---

## Suricata Ingestion

**File:** `src/backend/services/suricata_ingestion.py`

Ingests Suricata EVE JSON log files into `wims.security_threat_logs`.

**Functions:**

| Function | Purpose |
|---|---|
| `parse_eve_alert_line(line: str) -> dict|None` | Parses a single EVE JSON line into dict of alert fields |
| `eve_to_threat_log_row(eve_dict: dict, log_id) -> dict` | Maps EVE dict to threat log schema (source_ip, dest_ip, suricata_sid, severity, raw_payload truncation to 65535 chars) |
| `_insert_row(db, row: dict)` | INSERT INTO security_threat_logs via raw SQL text(). Rolls back on error, logs WARNING |
| `ingest_eve_file(db, file_path: str) -> tuple[int,int]` | Reads entire EVE file, parses each non-empty line, inserts matching alert events. Returns (parsed_count, inserted_count) |

---

## Email Service (M13b)

**File:** `src/backend/services/email/sender.py`

Jinja2 HTML email rendering and SMTP delivery via aiosmtplib.

**Production transport:** Brevo SMTP relay on port 2525 (`smtp-relay.brevo.com`). Port 2525 is the standard alternative SMTP submission port used when an ISP or hosting provider blocks 587. DigitalOcean Droplets block outbound 25/465/587 by default (`docs.digitalocean.com/support/why-is-smtp-blocked/`, last verified 2026-06-22); port 2525 is not in the block list. The connection is plaintext SMTP that the server requires to be upgraded via STARTTLS (`SMTP_STARTTLS=true`); AUTH PLAIN uses a per-key SMTP key from Brevo (not the account password).

**Local dev transport:** MailHog on the Docker-internal network (host=`mailhog`, port=`1025`, no auth, no TLS). MailHog remains in the stack for local dev convenience and is not removed by the Brevo migration.

**Environment config (11 vars; `sender.py` reads only the 6 marked ★):**

| Variable | Default | Read by | Description |
|---|---|---|---|
| ★ `SMTP_HOST` | `smtp-relay.brevo.com` (prod) / `mailhog` (dev) | `sender.py`, Keycloak | SMTP server hostname |
| ★ `SMTP_PORT` | `2525` (prod) / `1025` (dev) | `sender.py`, Keycloak | SMTP server port (Brevo on 2525; MailHog on 1025) |
| ★ `SMTP_FROM` | `noreply@wimsbfp.tech` (prod) / `no-reply@bfp.gov.ph` (dev) | `sender.py`, Keycloak | From address |
| ★ `SMTP_USER` | (empty) | `sender.py`, Keycloak | Brevo SMTP key (or empty for MailHog) |
| ★ `SMTP_PASSWORD` | (empty) | `sender.py`, Keycloak | Brevo SMTP key (or empty for MailHog) |
| ★ `SMTP_STARTTLS` | `true` (prod) / `false` (dev) | `sender.py`, Keycloak | Enable STARTTLS upgrade (true for Brevo on 2525; false for MailHog) |
| `SMTP_FROM_DISPLAY` | `WIMS-BFP` | Keycloak only | From display name |
| `SMTP_REPLYTO` | `no-reply@wimsbfp.tech` | Keycloak only | Reply-to address |
| `SMTP_REPLYTO_DISPLAY` | `WIMS-BFP No Reply` | Keycloak only | Reply-to display name |
| `SMTP_SSL` | `false` | Keycloak only | Implicit SSL (false for port 2525; true only for port 465) |
| `SMTP_AUTH` | `true` (prod) / `false` (dev) | Keycloak only | Whether Keycloak attempts SMTP AUTH (Brevo on 2525 requires true; `sender.py` does not read this — its auth is implicit from non-empty USER/PASSWORD) |

**Functions:**

| Function | Signature | Returns | Description |
|---|---|---|---|
| `render_email(template_name, context)` | `(str, dict)` | `tuple[str, str]` | Loads `.html.j2` template, extracts subject from `{# subject: ... #}` header, renders body. Returns `(subject, html)`. |
| `send_email_async(to, template_name, context)` | `(str\|list[str], str, dict)` | `None` | Renders template (with error logging), creates multipart/alternative message (HTML + plain-text), sends via aiosmtplib. Called directly from `api/routes/auth.py:222` (email-verification flow) and from `tasks/notifications.py:194` (via the sync wrapper). |
| `send_email(to, template_name, context)` | `(str\|list[str], str, dict)` | `None` | Synchronous wrapper for Celery tasks via `asyncio.run()`. |
| `_load_subject(template_name, context)` | `(str, dict)` | `str` | Extracts and renders subject line from template header. Caches raw subject string per template name. |
| `_html_to_plain_text(html)` | `str` | `str` | Converts HTML body to plain text for multipart/alternative emails. |

**Templates:** 7 `.html.j2` files in `services/email/templates/`:

| Template | Context Variables | Subject |
|---|---|---|
| `password_reset` | `full_name`, `reset_link`, `expiry_minutes` | "Reset your WIMS-BFP password" |
| `account_locked` | `full_name`, `unlock_time`, `support_contact` | "WIMS-BFP Account Locked — Action Required" |
| `security_alert` | `severity`, `summary`, `detected_at`, `dashboard_link` | "[{{ severity\|upper }}] WIMS-BFP Security Alert — Action Required" |
| `breach_alert` | (template-specific) | (template-specific) |
| `email_verification` | `username`, `pending_email`, `code` | (template-specific) |
| `scheduled_report` | `report_name`, `format`, `generated_at`, `filters_summary`, `dashboard_link` | (template-specific) |
| `weekly_report` | `week_range`, `total_incidents`, `top_region`, `report_link` | "WIMS-BFP Weekly Report: {{ week_range }}" |

All templates use table-based layout, inline CSS, 600px max width, and BFP maroon `#8B0000` branding. The security alert template uses severity-aware CSS: critical→dark red, high→red, medium→orange, else→neutral gray `#95a5a6`.

**Retry semantics:** `tasks/notifications.py:168` uses `autoretry_for=(aiosmtplib.SMTPException, ConnectionError, TimeoutError, OSError)` with `retry_backoff=True, retry_backoff_max=600, max_retries=5` for the Celery task path. The direct async call from `auth.py:222` does NOT retry (returns 502 to the client). The asymmetry is intentional: real-time user-facing actions fail fast; background notifications retry silently.

**Associated Celery task:** `tasks.notifications.send_email_task` (see [[utilities-and-tasks]]).
