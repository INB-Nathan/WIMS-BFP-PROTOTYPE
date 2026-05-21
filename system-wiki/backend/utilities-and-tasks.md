---
title: Backend Utilities & Celery Tasks
created: 2026-05-16
updated: 2026-05-19
type: backend
tags: [wims-bfp, backend, utils, crypto, audit, session, backup, celery, exports]
sources: [src/backend/utils/, src/backend/tasks/]
status: draft
---

# Backend Utilities & Celery Tasks

## Utilities (`src/backend/utils/`)

### `crypto.py` — PII Encryption

AES-256-GCM encrypted PII blob system for `incident_sensitive_details`. PII fields (`caller_name`, `caller_number`, `owner_name`, `occupant_name`) are encrypted as a single JSON blob. PII columns in the DB are set to NULL for new writes; only the encrypted blob is authoritative.

**Configuration:** `WIMS_MASTER_KEY` env var — base64-encoded 32-byte key

**Technical details:**
- Nonce: 12 bytes (RFC 5116), fresh per `encrypt_json` call
- AAD: `"incident_id:{incident_id}"` bound to the specific record
- Deterministic JSON serialization: `json.dumps(..., sort_keys=True, separators=(",", ":"))`
- Ciphertext stored as base64; nonce stored as base64

#### Exception

`SecurityProviderError` — raised on any crypto failure (missing key, decode error, authentication failure)

#### `class SecurityProvider`

| Method | Signature | Returns | Description |
|---|---|---|---|
| `__init__(self)` | — | None | Reads `WIMS_MASTER_KEY` from env, base64-decodes, validates 32 bytes, initializes AESGCM |
| `encrypt_json(self, pii_dict, aad)` | `(dict, bytes)` | `(nonce_b64, ct_b64)` | Serializes PII dict, generates 12-byte nonce, encrypts with GCM, returns base64-encoded nonce+ciphertext |
| `decrypt_json(self, nonce_b64, ct_b64, aad)` | `(str, str, bytes)` | `dict` | Base64-decodes, validates nonce length (12), decrypts with GCM auth check, JSON-deserializes |

### `audit.py` — System Audit Trail

#### `log_system_audit(db, user_id, action_type, table_affected, record_id, request=None)`

**Parameters:**

| Name | Type | Description |
|---|---|---|
| db | Session | SQLAlchemy session |
| user_id | uuid\|str\|None | User who performed the action |
| action_type | str | Action type (CREATE_USER, PROMOTE_REPORT, etc.) |
| table_affected | str | Table name affected |
| record_id | int\|None | Primary key of affected record |
| request | Request\|None | FastAPI Request for IP + User-Agent extraction |

**Behavior:** INSERT into `wims.system_audit_trails` with `(user_id, action_type, table_affected, record_id, ip_address, user_agent, timestamp=now())`. Errors are swallowed (audit failures don't block main action). Caller must commit.

### `session.py` — Redis Session Revocation

Manages revocation timestamps per Keycloak user. Any JWT issued before the revocation timestamp is considered invalid.

**Redis config:** `REDIS_URL` env var (default `redis://redis:6379/0`)

#### `class SessionManager`

| Method | Signature | Description |
|---|---|---|
| `__init__(self)` | — | Connects to Redis, pings for connectivity. Sets `_redis=None` on failure (graceful degradation) |
| `revoke_all_sessions(self, keycloak_id)` | `str` | Writes `revoked_user:{keycloak_id}` → `int(time.time())` with TTL 43200s (12h) |
| `is_token_revoked(self, keycloak_id, iat)` | `(str, int)` → bool | Reads `revoked_user:{keycloak_id}`; returns True if `iat < revocation_time` |

**Global instance:** `session_manager = SessionManager()` — imported by admin routes.

### `backup_crypto.py` — Backup File Encryption

AES-256-GCM backup encryption using the same `WIMS_MASTER_KEY` as PII encryption. Raw binary format: `[12-byte nonce][ciphertext+tag]`. No base64 encoding on disk. File extension: `.sql.enc`

| Function | Signature | Returns | Description |
|---|---|---|---|
| `encrypt_backup(input_path, output_path=None)` | `(Path, Path\|None)` | Path | Reads SQL file, generates 12-byte nonce, encrypts with AES-256-GCM (no AAD), writes nonce+ciphertext to .sql.enc, unlinks input |
| `decrypt_backup(encrypted_path, output_path=None)` | `(Path, Path\|None)` | Path | Reads .sql.enc, splits nonce (12 bytes) + ciphertext, decrypts, writes .sql, unlinks .enc. Atomic replace via temp file |

**Errors:** `RuntimeError` on missing/too-short file or decryption failure.

---

## Celery Tasks (`src/backend/tasks/`)

### `exports.py` — Analytics Export Pipeline

Celery tasks for CSV, XLSX, and PDF exports — both bulk (tabular) and single-incident AFOR-formatted output. All use the analytics read model (`analytics_read_model.py`).

**Constants:**

| Constant | Value |
|---|---|
| `ALLOWED_EXPORT_COLUMNS` | Set of 26 whitelisted column names (no PII) |
| `DEFAULT_EXPORT_COLUMNS` | 11 default columns if whitelist result is empty |
| `EXPORT_DIR` | `/tmp/wims-exports` (overridable via `EXPORT_DIR` env); in Docker, set to `/app/storage/exports` |
| `AFOR_TEMPLATE_PATH` | `/app/AFOR-FORMATTED.xlsx` (AFOR XLSX template for single-incident exports) |

**Helper Functions:**

| Function | Signature | Description |
|---|---|---|
| `_serialize_value(v)` | Any → str | None→"", datetime→isoformat(), else str(v) |
| `_valid_columns(columns)` | list[str] → list[str] | Filters against ALLOWED_EXPORT_COLUMNS; falls back to DEFAULT if empty |
| `_write_csv(path, rows, columns)` | (str, list[dict], list[str]) → None | CSV with header row, utf-8 encoding |
| `_write_xlsx(path, rows, columns)` | (str, list[dict], list[str]) → None | openpyxl Workbook, sheet "Incidents" |
| `_write_pdf(path, rows, columns)` | (str, list[dict], list[str]) → None | reportlab SimpleDocTemplate, letter landscape, dark red header (#7f1d1d), 7pt font |
| `_write_afor_excel(path, data)` | (str, dict[str, Any]) → None | Fills AFOR-FORMATTED.xlsx template cells via AFOR_CELL_MAP; saves .xlsx |
| `_write_afor_pdf(path, data)` | (str, dict[str, Any]) → None | Reportlab-rendered AFOR layout with 6 sections (A–F), maroon headers, 4-column tables |
| `_write_afor_csv(path, data)` | (str, dict[str, Any]) → None | Section-based key-value CSV (A. Response, B. Classification, C. Assets, D. Alarm, E. Casualties, F. Personnel) |
| `_write_csv_bulk / _write_xlsx_bulk / _write_pdf_bulk` | adapters | Thin adapters accepting `(path, rows, columns)` for bulk exports |
| `_insert_export_log(db, **kwargs)` | (Session, keyword args) → None | INSERT into `analytics_export_log` with all metadata |
| `_count_resource(resources, keyword)` | (list, str) → str | Counts resources matching keyword from `resources_deployed` JSON |

**AFOR Cell Map (`AFOR_CELL_MAP`):**
`tasks/exports.py:108-220`. Maps ~70 field keys to `(row, col_letter)` tuples in `AFOR-FORMATTED.xlsx`. Covers all AFOR sections: A (Response Details), B (Classification), C (Assets), D (Alarm Levels + ICP), E (Casualties), F (Personnel), and Prepared/Noted by fields.

**Core Export Functions:**

`_export(*, task_id, user_id, filters, columns, export_format, extension, content_type, writer, incident_ids=None, export_type="analytics")` → `str`

**Behavior:** Validates/whitelists columns → opens DB session with RLS → fetches rows (get_export_rows or get_analyst_export_rows) → creates EXPORT_DIR → generates unique filename → calls writer → logs to analytics_export_log → returns file path.

`_export_single_incident(*, task_id, user_id, incident_id, export_format, extension, content_type, writer)` → `str`

**Behavior:** Opens DB session with RLS → calls `get_incident_export_data(db, incident_id)` → generates unique filename → calls AFOR writer → logs to analytics_export_log → returns file path. Used for single-incident AFOR-formatted exports (CSV/PDF/Excel).

**Celery Tasks (4 total):**

| Task | Name | Writer | Format | Content Type | Purpose |
|---|---|---|---|---|---|
| `export_incidents_csv_task` | `tasks.exports.export_incidents_csv` | `_write_csv_bulk` | csv | text/csv | Analytics aggregate CSV export |
| `export_incidents_pdf_task` | `tasks.exports.export_incidents_pdf` | `_write_pdf_bulk` | pdf | application/pdf | Analytics aggregate PDF export |
| `export_incidents_excel_task` | `tasks.exports.export_incidents_excel` | `_write_xlsx_bulk` | xlsx | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet | Analytics aggregate XLSX export |
| `export_analyst_incidents_task` | `tasks.exports.export_analyst_incidents` | Dispatches by `export_mode` + `format` | csv/pdf/xlsx | Dynamic | Analyst selected/filtered export; supports `export_mode="afor"` (AFOR layout) or `"bulk"` (tabular); deduplicates IDs |

**`export_analyst_incidents_task` routing:**

```
if export_mode == "afor" and incident_id in filters:
    → _write_afor_csv / _write_afor_pdf / _write_afor_excel
    → _export_single_incident()
else:
    → _write_csv / _write_pdf / _write_xlsx
    → _export(export_type="analyst")
```

All tasks use `@celery_app.task(bind=True)` — `self.request.id` provides the Celery task UUID.

**File handling:**
- Bulk exports: `analytics_export_{uuid4_hex_12ch}.{extension}`
- AFOR exports: `afor_{incident_id}_{uuid4_hex_12ch}.{extension}`
- No cleanup mechanism — files accumulate in EXPORT_DIR. Path persisted in `analytics_export_log`.

**Docker note:** `EXPORT_DIR` is set to `/app/storage/exports` in docker-compose. The directory is created in the Dockerfile image layers before the volume is mounted, so it retains `appuser:appuser` ownership and is writable by the Celery worker at runtime.
