---
title: Regional Dashboard API Reference
created: 2026-05-16
updated: 2026-05-16
type: backend
tags: [wims-bfp, regional, encoder, api-reference, backend, afor, incident]
sources: [src/backend/api/routes/regional.py]
status: draft
---

# Regional Dashboard — Full API Reference

Complete function-level documentation for `src/backend/api/routes/regional.py` (~5050 lines). This is the largest route file, covering AFOR import, incident CRUD, statistics, verification workflow, and audit logs.

---

## Helper Functions — Infrastructure

### `_get_security_provider`

**Decorators/Route:** Module-level helper  
**Purpose:** Lazy singleton accessor for `SecurityProvider` (AES-256-GCM encrypt/decrypt).  
**Parameters:** None  
**Returns:** `SecurityProvider` instance  
**Behavior Notes:** Creates instance on first call; caches in module-level `_sp_instance` global. Avoids import-time env checks in test mocks.

### `_reverse_geocode_barangay`

**Purpose:** Look up the barangay containing the given point via `ST_Contains` and backfill `incident_nonsensitive_details.barangay_id`, then sync to analytics.

**Parameters:**

| Name | Type | Description |
|---|---|---|
| db | Session | Database session |
| incident_id | int | Incident to update |
| lon | float | Longitude (SRID 4326) |
| lat | float | Latitude (SRID 4326) |

**Behavior Notes:** Checks `ref_barangays` for non-NULL geometry first; skips with WARNING if geometry not loaded. Uses `ST_Contains(ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography)`. Calls `sync_incident_to_analytics()` after update. Transaction not committed — caller responsible.

### `_wgs84_pair_from_raw`

**Purpose:** Validate and return `(longitude, latitude)` tuple from raw JSON body values.  
**Parameters:** `latitude` (Any), `longitude` (Any)  
**Returns:** `tuple[float, float]` — (longitude, latitude) for PostGIS ST_MakePoint  
**Errors:** 400 `AFOR_WGS84_INVALID` — if None, bool, non-numeric, non-finite, or out of range  
**Behavior Notes:** Returns PostGIS-friendly order (lon, lat), not GeoJSON order.

### `_incident_verification_history_uses_target_columns`

**Purpose:** Check whether `incident_verification_history` has `target_type`/`target_id` columns.  
**Parameters:** `db` (Session)  
**Returns:** `bool` — delegates to `_incident_verification_history_has_column(db, "target_type")`

### `_incident_verification_history_has_column`

**Purpose:** Check whether `incident_verification_history` has a given column name.  
**Parameters:** `db` (Session), `column_name` (str)  
**Returns:** `bool` — queries `information_schema.columns`

### `_insert_incident_verification_history`

**Purpose:** Insert a row into `incident_verification_history` with compatibility for both legacy (incident_id-based) and migrated (target_type/target_id-based) schemas.

**Parameters:**

| Name | Type | Description |
|---|---|---|
| db | Session | Database session |
| incident_id | int (keyword) | Target incident ID |
| actor_user_id | str (keyword) | UUID of acting user |
| previous_status | str (keyword) | Previous verification_status |
| new_status | str (keyword) | New verification_status |
| notes | str (keyword) | Human-readable notes |
| action_label | str\|None (keyword) | Machine-readable action label |

**Behavior Notes:** Supports three schema variants via runtime column detection. Casts `actor_user_id` to `uuid` in SQL. In legacy schema, writes to `comments` column instead of `notes`.

---

## AFOR Parsing Schemas

### `AforParsedRow`

**Fields:** `row_index` (int), `status` (Literal "VALID"|"INVALID"), `errors` (list[str]), `data` (dict[str, Any])

### `AforFormKind`

Type alias: `Literal["STRUCTURAL_AFOR", "WILDLAND_AFOR"]`

### `WildlandRowSource`

Type alias: `Literal["AFOR_IMPORT", "MANUAL"]`

### `AforParseResponse`

**Fields:** `total_rows`, `valid_rows`, `invalid_rows`, `rows` (list[AforParsedRow]), `form_kind` (AforFormKind), `requires_location` (bool, default True)

### `DuplicateAction`

Type alias: `Literal["skip", "merge", "force"]`

### `RowResolution`

**Fields:** `row_index` (int), `action` (DuplicateAction), `existing_incident_id` (int|None, required when action=="merge")

### `AforCommitRequest`

**Fields:** `form_kind` (AforFormKind), `rows` (list[dict]), `wildland_row_source` (WildlandRowSource|None), `latitude` (float|None), `longitude` (float|None), `resolutions` (list[RowResolution]|None)

### `AforCommitResponse`

**Fields:** `status` (str), `batch_id` (int), `incident_ids` (list[int]), `total_committed` (int)

### `RegionalStatsResponse`

**Fields:** `total_incidents`, `by_category`, `by_alarm_level`, `by_status`, `wildland_total` (default 0), `by_wildland_type` (default [])

---

## AFOR Parsing Helpers

### `_normalize_general_category`

**Purpose:** Normalize a category string to canonical form via `_CATEGORY_CANONICAL` map.  
**Parameters:** `val` (str)  
**Returns:** Canonical category or original value if not found. Strips, uppercases, replaces `-` and spaces with `_` before lookup.

### `_safe_int`

**Purpose:** Safely convert arbitrary value to int, returning default on failure.  
**Parameters:** `val` (Any), `default` (int, default 0)  
**Returns:** `int` — handles None, empty string, "N/A", float, and int values.

### `_safe_float`

Same pattern as `_safe_int` for floats. Default 0.0.

### `_safe_dt`

**Purpose:** Safe datetime conversion. Handles datetime objects, Excel serial numbers, and multiple date formats.  
**Returns:** `str | None` — ISO format datetime string  
**Behavior Notes:** Supports Excel serial date epoch (1899-12-30), common PH date formats, time-only strings. Tries 14 format patterns in order.

### `_column_letters_to_index`

**Purpose:** Convert Excel column letters to zero-based index.  
**Parameters:** `letters` (str, e.g. "D", "AA")  
**Returns:** `int`

### `CsvWorksheetAdapter`

**Purpose:** Expose CSV cell data through worksheet-like `A1` coordinate access, enabling reuse of BfpXlsxParser on CSV input.  
**Methods:** `__init__(self, rows)`, `__getitem__(self, coord) -> _SheetCell`

### `_looks_like_official_afor_csv`

**Purpose:** Detect whether CSV rows match the official AFOR form-style layout versus flat tabular CSV.  
**Parameters:** `rows` (list[list[str]])  
**Returns:** `bool` — checks for "AFTER FIRE OPERATIONS REPORT" and "A. RESPONSE DETAILS" markers.

### `_cell_str`

**Purpose:** Safely extract string from a worksheet cell.  
**Parameters:** `ws` (Any), `coord` (str)  
**Returns:** `str` — stripped string or `""` on None/exception.

### `_sheet_has_structural_markers`

**Purpose:** Detect structural AFOR markers in a worksheet, tolerant to row shifts.  
**Returns:** `bool` — delegates to `_find_structural_marker_rows()`.

### `_find_structural_marker_rows`

**Purpose:** Scan top-left block (rows 1-160, columns A-F) to find title and section marker rows.  
**Returns:** `tuple[int | None, int | None]` — (title_row, section_row)

### `_sheet_has_wildland_markers`

**Purpose:** Detect wildland AFOR markers (B12="WILDLAND", B13="A. DATES...").  
**Returns:** `bool`

### `detect_afor_template_kind`

**Purpose:** Classify uploaded workbook as structural vs wildland AFOR.  
**Parameters:** `wb` (openpyxl Workbook)  
**Returns:** `AforFormKind | None` — "STRUCTURAL_AFOR", "WILDLAND_AFOR", or None  
**Behavior Notes:** Priority: (1) sheet name contains "WILDLAND FIRE AFOR" + wildland markers, (2) any sheet has structural markers, (3) any sheet has wildland markers, (4) None.

### `_pick_structural_worksheet`

**Purpose:** Select best worksheet for structural AFOR parsing.  
**Returns:** Worksheet object — priority: first sheet with structural markers → first with "AFOR" in name → active sheet.

### `_pick_wildland_worksheet`

**Purpose:** Select best worksheet for wildland AFOR parsing.  
**Returns:** Worksheet object — priority: sheet with both "WILDLAND" and "AFOR" in name → sheet with wildland markers → active sheet.

### `_normalize_wildland_fire_type`

**Purpose:** Validate and normalize a wildland fire type string against known set.  
**Returns:** `str | None` — lowercase known type or None  
**Known types:** fire, agricultural land fire, brush fire, forest fire, grassland fire, grazing land fire, mineral land fire, peatland fire.

### `_parse_ha_from_area_text`

**Purpose:** Parse hectares from text like "5 ha" or "12.5 hectares".  
**Parameters:** `raw` (Any)  
**Returns:** `float | None` — uses regex `r"([\d.]+)\s*ha"` (case-insensitive).

---

## Wildland AFOR Parser

### `WildlandXlsxParser`

Parser class for the BFP wildland AFOR workbook.

**Methods:**

- `__init__(self, ws)` — stores openpyxl Worksheet
- `get(self, coord) -> Any` — get cell value (stripped string or None)
- `parse(self) -> dict[str, Any]` — comprehensive wildland data dict with sections: call_received_at, fire_started_at, fire_arrival_at, fire_controlled_at, caller info, engine, location, actions, buildings, area burned, wildland_fire_type, fire_behavior, problems, recommendations, alarm_statuses, prepared/noted by

**Behavior Notes:** Reads specific cell coordinates from the wildland template. Extracts alarm rows from rows 50-64 (J, K, L columns). Extracts problems from B76-79, recommendations from B83-86. Fire behavior from D51-D55. Narration from B68.

### `parse_wildland_afor_report_data`

**Purpose:** Map wildland workbook dict into commit payload with validation.  
**Parameters:** `data` (dict), `region_id` (int)  
**Returns:** `AforParsedRow` — VALID or INVALID with errors  
**Behavior Notes:** Validates at least one content field present. Returns mapped payload with `_form_kind: "WILDLAND_AFOR"` and nested `wildland` key.

### `_combine_date_and_time`

**Purpose:** Combine a notification datetime (date part) with a separate time value into a single ISO datetime.  
**Parameters:** `notification_dt` (str|None), `time_value` (Any)  
**Returns:** `str | None`

---

## Structural AFOR Parser

### `BfpXlsxParser`

Parser class for the official BFP manual entry form (structural AFOR).

**Methods:**

- `__init__(self, ws)` — stores worksheet, infers row offset from marker positions
- `_infer_row_offset(self) -> int` — infers row offset from canonical template
- `_coord_with_offset(self, coord: str) -> str` — applies inferred row offset
- `get(self, coord: str) -> Any` — tries shifted coordinate, falls back to canonical
- `_is_marked(self, coord: str) -> bool` — detects check marks (X, 1, True, ✓, Excel TRUE, etc.)
- `_first_nonempty(self, *coords) -> Any` — variadic fallback chain
- `_male_female_pair(self, row: int) -> tuple[Any, Any]` — tries candidate column pairs (D/E, C/D, E/F, F/G)
- `_is_marked_on_row(self, row: int, cols: tuple) -> bool`
- `parse(self) -> dict[str, Any]` — comprehensive structural AFOR data dict with sections A-L

**Parse output sections:** responder_type, fire_station_name, notification_date/time, region/province/city/address, caller_info, engine, timestamps, distance, alarm_level, classification, category, owner, description, origin, stage, extent, structures/households/families/individuals/vehicles affected, resources (trucks/medical/special/tools), timeline (alarms 1st-5th, TF Alpha-Delta, General, FUC, FO), ICP, casualties (injured/fatal by civilian/BFP/auxiliary M/F), personnel, narrative, problems, recommendations, disposition, prepared/noted by.

### `parse_afor_report_data`

**Purpose:** Map extracted structural AFOR dictionary into DB schema with three sub-payloads: `incident_nonsensitive_details`, `incident_sensitive_details`, `responding_unit`.  
**Parameters:** `data` (dict), `region_id` (int)  
**Returns:** `AforParsedRow`  
**Behavior Notes:** Requires `notification_dt` and `_city_text`. Splits caller_info on "/". Builds structured casualty_details, alarm_timeline, resources_deployed, personnel_on_duty. Maps alarm_level through ALARM_LEVEL_MAP.

### `parse_csv_content`

**Purpose:** Parse official AFOR form-style CSV or flat tabular CSV (structural only).  
**Returns:** `tuple[list[AforParsedRow], AforFormKind]` — always "STRUCTURAL_AFOR"

### `parse_xlsx_content`

**Purpose:** Parse XLSX workbook. Detect structural vs wildland, dispatch to appropriate parser.  
**Parameters:** `content` (bytes), `region_id` (int)  
**Returns:** `tuple[list[AforParsedRow], AforFormKind]`  
**Errors:** ValueError if template kind undetermined

---

## AFOR Import/Commit Routes

### `import_afor_file`

**Route:** `@router.post("/afor/import")`  
**Auth:** `Depends(get_regional_encoder)`  
**DB Session:** `get_db_with_rls`  
**Purpose:** Upload and parse AFOR file (.xlsx or .csv). Returns parsed rows with validation status for preview.

**Parameters:** `file` (UploadFile, File(...))

**Returns:** `AforParseResponse` — total_rows, valid_rows, invalid_rows, rows, form_kind, requires_location

**Errors:** 400 (no file, empty file, unsupported extension, parse failure, no data rows)

**Behavior Notes:** Reads content as bytes. CSV decoded as utf-8-sig (handles BOM). Uses `region_id` from user's `assigned_region_id`. Always sets `requires_location=True`.

### `_commit_wildland_afor_row`

**Purpose:** Insert a wildland incident row (`fire_incidents` + `incident_wildland_afor`) with optional alarm statuses and assistance children.

**Parameters:** `db`, `row_data`, `batch_id`, `user_id`, `region_id`, `incident_ids` (mutated in-place), `lon`, `lat`, `source` (keyword, default "AFOR_IMPORT")

**Behavior Notes:** Creates fire_incident with DRAFT status. Calls `_reverse_geocode_barangay()`. Inserts into `incident_wildland_afor` with JSONB fields. Iterates alarm_statuses filtered against allowed set. Iterates assistance_rows. Transaction not committed by this function.

### `_extract_row_match_fields`

**Purpose:** Extract fields for duplicate matching from one parsed row.  
**Returns:** `dict[str, Any]` — alarm_level, general_category, notification_dt (date only), fire_station_name

### `_find_duplicates`

**Purpose:** M4-D multi-factor duplicate detection. Find existing non-archived, non-REJECTED fire_incidents within 1km that match on >= 3 fields.  
**Returns:** `list[dict]` — each entry: row_index, existing_incident_id, distance_m, matched_fields, incoming_values, existing_values  
**Behavior Notes:** Uses `ST_DWithin` with geography cast. Only returns entries where `len(matched_fields) >= 3`.

### `commit_afor_import`

**Route:** `@router.post("/afor/commit")`  
**Auth:** `Depends(get_regional_encoder)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Commit validated AFOR rows. Creates `data_import_batch` and inserts fire_incidents with all detail tables.

**Parameters:** `request` (Request — raw body parsed manually)

**Returns:** On first call with duplicates: `{"status": "DUPLICATE_CHECK_REQUIRED", "duplicates": [...]}`. On success: `AforCommitResponse`

**Behavior Notes (multi-phase flow):**
1. Parses raw body and validates via `AforCommitRequest`
2. Validates WGS84 coordinates
3. Validates `_form_kind` match on every row
4. Wildland: re-validates via `parse_wildland_afor_report_data`
5. M4-D: first call (resolutions=None) runs `_find_duplicates` — returns DUPLICATE_CHECK_REQUIRED if found
6. Second call (resolutions provided): builds resolution_map, skips/merges/forces per row
7. Creates `data_import_batch`
8. For each row: skip / wildland commit / merge (UPDATE COALESCE) / full INSERT
9. Full INSERT: creates fire_incident, reverse-geocodes barangay, resolves city_id, encrypts PII via SecurityProvider into `pii_blob_enc`/`encryption_iv`, inserts responding_unit
10. Commits twice: main data, then analytics sync

---

## Incident CRUD Schemas

### `IncidentCreateRequest`

All fields optional except `latitude`, `longitude`, `region_id`. Key fields: notification_dt, alarm_level, general_category, sub_category, specific_type, occupancy_type, city_id, barangay_id, distance_from_station_km, estimated_damage_php, casualty counts, responder_type, fire_origin, extent_of_damage, fire_station_name, total_response_time_minutes, recommendations, province_district, city_municipality, station_code, incident_type_code, parent_incident_id, street_address, landmark, caller_name, caller_number, narrative_report, owner_name, occupant_name, establishment_name, receiver_name, prepared_by_officer, noted_by_officer, remarks.

### `IncidentUpdateRequest`

Same field set as `IncidentCreateRequest` but all optional, plus: `alarm_timeline` (dict), `resources_deployed` (dict), `problems_encountered` (list), `other_personnel` (list), `personnel_on_duty` (dict), `casualty_details` (dict), `disposition` (str).

---

## Incident CRUD Routes

### `get_regional_incidents`

**Route:** `@router.get("/incidents")`  
**Auth:** `Depends(get_regional_encoder)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Fetch fire incidents scoped to the current encoder. Paginated, filterable.

**Query Parameters:** `limit` (int, 1-200, default 50), `offset` (int, default 0), `category` (Optional[str]), `status` (Optional[str])

**Returns:** `{"items": [...], "total": int, "limit": int, "offset": int}`  
Each item: incident_id, verification_status, created_at, notification_dt, general_category, alarm_level, fire_station_name, structures_affected, households_affected, individuals_affected, responder_type, fire_origin, extent_of_damage, owner_name, establishment_name, caller_name, is_wildland, updated_at, location_display

**Behavior Notes:** Filters by `fi.encoder_id`, `fi.is_archived = FALSE`. Category filter normalizes through `_CATEGORY_DB_VARIANTS`. Joins ref tables for location_display. Orders by `updated_at DESC NULLS LAST, created_at DESC`.

### `list_encoder_drafts`

**Route:** `@router.get("/incidents/drafts")`  
**Auth:** `Depends(get_regional_encoder)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** List the current encoder's DRAFT incidents (most-recently-updated first). M4-E endpoint.

**Query Parameters:** `limit` (int, 1-100, default 20), `offset` (int, default 0)

**Returns:** `{"items": [...], "total": int, "limit": int, "offset": int}`  
Each item: incident_id, region_id, created_at, updated_at, notification_dt, general_category, alarm_level, fire_station_name

**Behavior Notes:** Filters `fi.encoder_id`, `fi.verification_status = 'DRAFT'`, `fi.is_archived = FALSE`.

### `check_incident_duplicate`

**Route:** `@router.get("/incidents/check-duplicate")`  
**Auth:** `Depends(get_regional_encoder)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Return existing non-archived VERIFIED incidents that could be duplicates.

**Query Parameters:** `region_id` (int, required), `fire_date` (str YYYY-MM-DD, required), `incident_type_code` (Optional[str]), `general_category` (Optional[str])

**Returns:** `{"duplicates": [...]}` with items containing incident_id, reference_number, verification_status, incident_type_code, notification_dt, alarm_level, general_category, type_of_involved, fire_station_name, station_code, city_municipality, province_district, region_name, street_address

**Errors:** 422 (invalid fire_date format). Returns `{"duplicates": []}` if no match criteria provided.

**Behavior Notes:** Uses OR logic: (1) same region + type_code + same month+year, (2) same region + type_code + exact date, (3) same region + general_category + exact date.

### `get_regional_incident_detail`

**Route:** `@router.get("/incidents/{incident_id}")`  
**Auth:** `Depends(get_current_wims_user)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Fetch a single incident's full detail. Encoders see only their own; validators/analysts see any.

**Returns:** Full incident object with: incident_id, verification_status, created_at, region_id, latitude, longitude, reference_number, incident_type_code, parent_incident_id, is_duplicate, duplicate_of, updated_at, is_wildland, wildland_fire_type, wildland_area_hectares, wildland_area_display, nonsensitive (full row dict), sensitive (full row dict with decrypted PII), rejection_reason, rejection_at

**Errors:** 404 (not found or access denied)

**Behavior Notes:** Role check: NATIONAL_VALIDATOR, SYSTEM_ADMIN, NATIONAL_ANALYST see authorized records; encoders are scoped to `fi.encoder_id`. Archived records are included so encoder/validator archive views can open details. Decrypts PII blob with `SecurityProvider.decrypt_json()`. Strips `pii_blob_enc` and `encryption_iv` from response. Fetches most recent REJECTION reason from `incident_verification_history` with schema compatibility.

### `create_incident`

**Route:** `@router.post("/incidents", status_code=201)`  
**Auth:** `Depends(get_regional_encoder)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Create a new fire incident in DRAFT status with nonsensitive + optional sensitive details.

**Parameters:** `body` (IncidentCreateRequest)

**Returns:** `{"status": "created", "incident_id": int, "verification_status": "DRAFT", "incident_type_code": str, "parent_incident_id": int | None}`

**Errors:** 400 (region_id required when no assigned region), 403 (region_id != assigned_region_id)

**Behavior Notes:** Falls back to `user["assigned_region_id"]`. Dynamically builds INSERT for nonsensitive_details (only non-None fields). Normalizes alarm_level and general_category. Encrypts PII via SecurityProvider. Writes IVH entry with "CREATED_DRAFT". Calls `_reverse_geocode_barangay()`.

### `_apply_incident_field_updates`

**Purpose:** Apply nonsensitive/sensitive/JSONB/coords field updates from `IncidentUpdateRequest`. Caller responsible for status checks and commit.

**Parameters:** `db`, `incident_id`, `body` (IncidentUpdateRequest)

**Behavior Notes:** Ensures child rows exist (INSERT ... WHERE NOT EXISTS). Builds dynamic UPDATE for nonsensitive_details. PII update: decrypts existing blob, merges, re-encrypts. Updates JSONB fields on both nonsensitive and sensitive tables.

### `update_incident`

**Route:** `@router.put("/incidents/{incident_id}")`  
**Auth:** `Depends(get_regional_encoder)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Update a DRAFT or REJECTED incident owned by the current encoder.

**Returns:** `{"status": "updated", "incident_id": int}`

**Errors:** 404 (not found/not owned), 403 (PENDING or not DRAFT/REJECTED), 500 (update failure)

**Behavior Notes:** Verifies ownership + editable status. Delegates to `_apply_incident_field_updates()`. Writes IVH entry with "EDITED".

### `force_replace_incident`

**Route:** `@router.post("/incidents/{incident_id}/force-replace")`  
**Auth:** `Depends(get_regional_encoder)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Replace a PENDING incident without requiring withdraw. For fixing duplicates during review.

**Returns:** `{"status": "replaced", "incident_id": int}`

**Errors:** 404 (not found/not owned), 403 (not PENDING), 500 (replacement failure)

**Behavior Notes:** Delegates to `_apply_incident_field_updates()`. Writes IVH with "EDITED" + force-replace note.

### `update_draft`

**Route:** `@router.patch("/incidents/draft/{incident_id}")`  
**Auth:** `Depends(get_regional_encoder)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Update a DRAFT incident. Enforces `verification_status = 'DRAFT'`.

**Returns:** `{"status": "draft_updated", "incident_id": int}`

**Errors:** 404, 403 (status != DRAFT), 500

### `delete_draft`

**Route:** `@router.delete("/incidents/draft/{incident_id}", status_code=200)`  
**Auth:** `Depends(get_regional_encoder)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Soft-archive a DRAFT incident (sets `is_archived = TRUE`).

**Returns:** `{"status": "deleted", "incident_id": int}`

**Errors:** 404, 403 (status != DRAFT)

### `unpend_incident`

**Route:** `@router.patch("/incidents/{incident_id}/unpend")`  
**Auth:** `Depends(get_regional_encoder)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Withdraw a PENDING submission back to DRAFT for editing.

**Returns:** `{"status": "unpended", "incident_id": int, "new_status": "DRAFT"}`

**Errors:** 404, 400 (not PENDING), 500

**Behavior Notes:** Transitions PENDING → DRAFT. Writes IVH with "WITHDRAWN".

### `delete_incident`

**Route:** `@router.delete("/incidents/{incident_id}")`  
**Auth:** `Depends(get_regional_encoder)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Soft-delete a DRAFT or REJECTED incident (sets `is_archived = TRUE`).

**Returns:** `{"status": "deleted", "incident_id": int}`

**Errors:** 404, 403 (status not DRAFT or REJECTED)

### `encoder_archive_incident`

**Route:** `@router.patch("/incidents/{incident_id}/archive", status_code=200)`
**Auth:** `Depends(get_regional_encoder)`
**DB Session:** `Depends(get_db_with_rls)`
**Purpose:** Soft-archive a VERIFIED incident owned by the encoder.

**Returns:** `{"status": "archived", "incident_id": int}`

**Errors:** 404 (not found/already archived/not owned), 400 (wrong status), 500

### `encoder_unarchive_incident`

**Route:** `@router.patch("/incidents/{incident_id}/unarchive", status_code=200)`
**Auth:** `Depends(get_regional_encoder)`
**DB Session:** `Depends(get_db_with_rls)`
**Purpose:** Restore an archived VERIFIED incident owned by the encoder.

**Returns:** `{"status": "unarchived", "incident_id": int}`

**Errors:** 404 (not found/not archived/not owned), 400 (wrong status), 500

### `submit_incident_for_review`

**Route:** `@router.patch("/incidents/{incident_id}/submit", status_code=200)`  
**Auth:** `Depends(get_regional_encoder)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Submit a DRAFT or REJECTED incident for validator review (→ PENDING). Includes duplicate detection.

**Query Parameters:** `ack_duplicate` (bool, default False), `force` (bool, default False)

**Returns:** `{"status": "submitted", "incident_id": int, "verification_status": "PENDING", "is_duplicate": bool, "duplicate_of": int | None}`

**Errors:** 404, 403, 409 (wrong status), 422 (missing required fields), 409 DUPLICATE_DETECTED

**Behavior Notes:** Required-field gate: notification_dt, general_category, province_district, city_municipality must be set. M4-G: Snapshots nonsensitive_details to `submitted_snapshot` on first PENDING transition only.

---

## Verification Schemas

### `VerificationActionRequest`

**Fields:** `action` (str — "accept"|"accept_replace"|"pending"|"reject"), `notes` (str|None), `original_incident_id` (int|None)

### `BulkApproveRequest`

**Fields:** `incident_ids` (list[int]), `notes` (str|None)

---

## Stats Routes

### `get_validator_stats`

**Route:** `@router.get("/validator/stats")`  
**Auth:** `Depends(get_national_validator)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Counts of VERIFIED incidents by category visible to the validator, plus pending count.

**Returns:** `{"total_verified": int, "pending_validation": int, "by_category": [{"category": str, "count": int}]}`

**Behavior Notes:** Cross-region query (no region gate for NATIONAL_VALIDATOR).

### `get_regional_stats`

**Route:** `@router.get("/stats")`  
**Auth:** `Depends(get_regional_encoder)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Quick summary stats scoped to the current encoder.

**Returns:** `RegionalStatsResponse` — total_incidents, by_category, by_alarm_level, by_status, wildland_total, by_wildland_type

---

## Verification Workflow Routes

### `get_validator_incident_queue`

**Route:** `@router.get("/validator/incidents")`  
**Auth:** `Depends(get_national_validator)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Validator incident queue — encoder-submitted incidents across all regions.

**Query Parameters:** `status` (Optional[str]), `show_all` (bool, default False), `encoder_id` (Optional[str]), `archived` (bool, default False), `limit` (int, 1-200, default 50), `offset` (int, default 0)

**Returns:** Paginated list with items including: incident_id, verification_status, encoder_id, region_id, created_at, submitted_at, notification_dt, general_category, alarm_level, fire_station_name, structures_affected, households_affected, responder_type, fire_origin, extent_of_damage, parent_incident_id, is_duplicate, duplicate_of, updated_at, reference_number

**Behavior Notes:** Always excludes `fi.encoder_id IS NULL` (public DMZ rows) and DRAFT. Default: shows PENDING + PENDING_VALIDATION. No region gate. Orders by `fi.created_at DESC`.

### `verify_incident`

**Route:** `@router.patch("/incidents/{incident_id}/verification")`  
**Auth:** `Depends(get_national_validator)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Apply a validator decision to one encoder-submitted incident.

**Parameters:** `incident_id` (int, path), `body` (VerificationActionRequest), `request` (Request), `force` (bool, Query, default False)

**Returns:** `{"incident_id": int, "previous_status": str, "new_status": str, "action": str, "encoder_id": str, "region_id": int, "reference_number": str | None, "parent_archived": int | None}`

**Errors:** 400 (unknown action), 403 (no encoder or invalid transition), 404, 409 (already in target status or DUPLICATE_DETECTED), 500

**Behavior Notes (complex flow):**
1. Validates action against `_VALIDATOR_ACTION_MAP`
2. Fetches incident with user join
3. Encoder linkage check (rejects NULL encoder)
4. Idempotency guard (same status → 409)
5. State transition guard (reject VERIFIED blocked, accept REJECTED blocked)
6. Duplicate check on accept (unless force or parent_incident_id exists)
7. On VERIFIED: computes SHA-256 `data_hash`; generates or inherits `reference_number`
8. accept_replace + original_incident_id: inherits original ref_num, archives original
9. Archives parent: sets `is_archived=TRUE, verification_status='REPLACED', reference_number=NULL`
10. Writes IVH with action_label (APPROVED/ACCEPTED_AS_NEW/REJECTED/RETURNED_TO_PENDING)
11. Primary transaction commit
12. Analytics sync (two-phase: primary data + analytics)
13. System audit log via `log_system_audit()`

### `bulk_approve_incidents`

**Route:** `@router.post("/validator/incidents/bulk-approve")`  
**Auth:** `Depends(get_national_validator)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Atomically approve multiple PENDING incidents. All-or-nothing.

**Returns:** `{"approved": int, "incident_ids": list[int], "held_for_review": list[{"id": int, "matching_incident_id": int}]}`

**Errors:** 400 (empty/missing IDs), 422 (non-PENDING or no-encoder), 500

**Behavior Notes:** Validates all IDs exist, are PENDING with encoder. Sorts by created_at ASC (FIFO). Per-incident duplicate check with 60s window. Duplicates held for review (not failed). Non-duplicates: UPDATE to VERIFIED, write IVH with "BULK_APPROVED". Single transaction.

### `archive_incident`

**Route:** `@router.patch("/validator/incidents/{incident_id}/archive")`  
**Auth:** `Depends(get_national_validator)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Archive a finalized (VERIFIED, REJECTED, or REPLACED) incident. Sets `is_archived=TRUE` without changing the current verification status.

**Returns:** `{"status": "archived", "incident_id": int}`

**Errors:** 404 (not found/already archived), 400 (wrong status), 500

**Behavior Notes:** Writes IVH with "ARCHIVED".

### `unarchive_incident`

**Route:** `@router.patch("/validator/incidents/{incident_id}/unarchive")`
**Auth:** `Depends(get_national_validator)`
**DB Session:** `Depends(get_db_with_rls)`
**Purpose:** Restore an archived finalized incident to the active validator queue. Sets `is_archived=FALSE`, clears `archived_at`, preserves the verification status, writes IVH with "UNARCHIVED", and resyncs analytics.

**Returns:** `{"status": "unarchived", "incident_id": int}`

**Errors:** 404 (not found/not archived), 400 (wrong status), 500

### `get_incident_diff`

**Route:** `@router.get("/validator/incidents/{incident_id}/diff")`  
**Auth:** `Depends(get_national_validator)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Return original-vs-current diff for incident's nonsensitive fields (M4-G).

**Returns:** `{"original": dict | None, "current": dict, "changed_fields": list[str]}`

**Behavior Notes:** Original = `submitted_snapshot` JSONB. Current = live `incident_nonsensitive_details`. PII fields excluded. Only `_DIFF_FIELDS` tuple compared (31 operational fields).

---

## Audit Log Routes

### `get_encoder_audit_log`

**Route:** `@router.get("/audit-log")`  
**Auth:** `Depends(get_regional_encoder)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Return current encoder's own action history.

**Query Parameters:** `date_from` (Optional[str]), `date_to` (Optional[str]), `limit` (int, 1-200, default 50), `offset` (int, default 0)

**Returns:** Paginated list: history_id, incident_id, action_label, previous_status, new_status, notes, action_timestamp

**Behavior Notes:** Filters by `target_type = 'OFFICIAL'` and `action_by_user_id`. Uses migrated schema. Orders by `action_timestamp DESC`.

### `_build_audit_log_query`

**Purpose:** Compose a parameterized WHERE clause for audit log queries.  
**Parameters:** `date_from`, `date_to`, `region_id`, `validator_id`, `action`  
**Returns:** `tuple[str, dict]` — (where_sql, params)

### `get_validator_audit_logs`

**Route:** `@router.get("/validator/audit-logs")`  
**Auth:** `Depends(get_national_validator)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Paginated audit-log query over `incident_verification_history` for validators.

**Query Parameters:** `date_from`, `date_to`, `region_id` (int), `validator_id` (str), `action` (str — APPROVED, REJECTED, etc.), `limit` (1-200, default 50), `offset` (default 0)

**Returns:** Paginated list: history_id, incident_id, region_id, action_by_user_id, previous_status, new_status, notes, action_timestamp, actor_username, region_display, action_label

**Behavior Notes:** Joins `fire_incidents`, `users`, `ref_regions`. Orders by `action_timestamp DESC`.

### `export_validator_audit_logs`

**Route:** `@router.get("/validator/audit-logs/export")`  
**Auth:** `Depends(get_national_validator)`  
**DB Session:** `Depends(get_db_with_rls)`  
**Purpose:** Return an audit-log CSV. Same filters as list endpoint.

**Returns:** `Response` — CSV file with Content-Disposition attachment

**Behavior Notes:** CSV columns: history_id, incident_id, region_id, region_display, action_by_user_id, actor_username, previous_status, new_status, action_label, notes, action_timestamp. Notes newlines replaced with spaces. Filename: `audit-log-YYYYMMDD.csv`.
