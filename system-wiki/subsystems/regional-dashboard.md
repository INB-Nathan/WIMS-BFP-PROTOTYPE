---
title: Regional Dashboard
created: 2026-05-16
updated: 2026-05-24
type: operation
tags: [wims-bfp, regional, encoder, dashboard, incident-workflow, afor]
sources: [src/frontend/src/app/dashboard/regional/page.tsx, src/frontend/src/app/dashboard/regional/audit/page.tsx, src/frontend/src/app/dashboard/regional/drafts/page.tsx, src/frontend/src/app/dashboard/regional/incidents/[id]/page.tsx, src/backend/api/routes/regional.py]
status: draft
---

# Regional Dashboard

The regional dashboard (`/dashboard/regional`) serves the `REGIONAL_ENCODER` role (and `NATIONAL_VALIDATOR` for cross-region visibility). It is the primary incident management workspace for encoding AFOR imports, creating manual incidents, managing drafts, submitting for validation, and viewing incident status.

## Role Gates

- Accessible to: `REGIONAL_ENCODER`, `NATIONAL_VALIDATOR`, (legacy `ENCODER`, `VALIDATOR`)
- Unauthorised users are redirected to `/dashboard`
- All backend routes in `regional.py` use `Depends(get_regional_encoder)` or `Depends(get_national_validator)` with region-scoped RLS via `get_db_with_rls()`.
- Selected mutation endpoints delegate lifecycle rules to `src/backend/services/regional_incidents/lifecycle.py`; `regional.py` remains the HTTP Adapter.

## Frontend UI Surface

### Main Dashboard — `/dashboard/regional`

**Source:** `src/frontend/src/app/dashboard/regional/page.tsx` (~485 lines)

**Summary Cards** — 5-card grid with icon, count label, and left-colour border:

| Card | Border | Data Source |
|---|---|---|
| Total Incidents | Red (#dc2626) | `stats.total_incidents` |
| Structural | Orange (#f97316) | `stats.by_category` filtered to STRUCTURAL |
| Non-Structural | Green (#22c55e) | `stats.by_category` filtered to NON_STRUCTURAL |
| Vehicular | Blue (#3b82f6) | `stats.by_category` filtered to VEHICULAR |
| Wildland Fire | Brown (#92400e) | `stats.wildland_total` |

**Incident Table** — paginated list with filters:

- Columns: Date, Classification (with wildland badge), Station, Location, Last Modified, Status, Actions (View link)
- Filters: Classification dropdown (from `REGIONAL_INCIDENT_GENERAL_CATEGORIES`), Verification Status dropdown (from `REGIONAL_VERIFICATION_STATUSES`), Per-page size selector
- Pagination: Prev/Next buttons, page X of Y display, configurable page sizes
- Status badges: green (`VERIFIED`), red (`REJECTED`), yellow (everything else)
- Empty state: "No incidents match the current filters" or error banner
- **Rejected banner** — when `rejectedCount > 0`, shows a prominent red alert with "Show rejected" quick-filter button

**Wildland Fire Classifications** — conditionally rendered when `stats.wildland_total > 0`:

- 8 wildland fire types (fire, agricultural, forest, grassland, brush, peatland, grazing land, mineral land) each with a colour-coded count badge

**Header buttons:**

- Refresh (with spinning icon during load)
- Activity Log → `/dashboard/regional/audit`
- Import AFOR → `/afor/import`

### Activity Log — `/dashboard/regional/audit`

**Source:** `src/frontend/src/app/dashboard/regional/audit/page.tsx` (~193 lines)

- Purpose: Encoder's personal audit trail showing every action on their incidents
- Filters: From/To date pickers
- Columns: Date & Time, Incident (linked to detail page), Action (mapped from action_label to human-readable), Notes
- Pagination: 50 rows/page, Prev/Next navigation
- Empty state: "No activity recorded yet."
- Data source: `GET /api/regional/audit-log`

### Drafts — `/dashboard/regional/drafts`

**Source:** `src/frontend/src/app/dashboard/regional/drafts/page.tsx` (~143 lines)

- Lists encoder's DRAFT incidents with Resume and Discard actions
- Columns: ID, Station, Category, Alarm, Notification, Last Edited
- "Resume" opens the incident detail page (which loads `IncidentForm` for editing)
- "Discard" soft-archives via DELETE endpoint with confirm dialog
- Link to `/incidents/create` for new incidents
- Empty state: "You have no drafts." with link to start one

### Incident Detail — `/dashboard/regional/incidents/[id]`

**Source:** `src/frontend/src/app/dashboard/regional/incidents/[id]/page.tsx` (~1265 lines)

- Full incident detail view with read-only summary + editable `IncidentForm`
- Read-only sections:
  - **Incident Location Map** via `MapPickerInner` with detail zoom (320px height)
  - **Narrative Report** as ordered bullet list
  - **Problems Grid** — all 50+ problem options shown as checked/unchecked with emoji
  - **Personnel Section** — engine commander, shift-in-charge, nozzleman, lineman, engine crew, driver, safety officer, fire/arson investigator, other personnel
- Edit mode: loads `IncidentForm` component (same form used for new incidents)
- Actions: Submit for review, Unpend (if pending), Delete draft, Force replace
- Supports legacy and migrated `incident_verification_history` schemas (checks for `target_type` and `action_label` columns at runtime)

## Backend API Routes

All in `src/backend/api/routes/regional.py` (~5050 lines). This is the largest route file in the codebase.

### AFOR Import (`regional.py` lines 334–1066 approximately)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `POST` | `/api/afor/import` | `import_afor_file` | Parses structural/wildland AFOR XLSX/CSV; validates rows; returns parse result with VALID/INVALID per row; handles Excel serial date conversion |
| `POST` | `/api/afor/commit` | `commit_afor_import` | Commits pre-validated rows as fire_incidents; optional per-row duplicate resolution on second call; requires valid WGS84 coordinates; creates nonsensitive/sensitive details; writes audit; syncs analytics |

### Incident CRUD (`regional.py` lines ~1066–2800)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `GET` | `/api/regional/incidents` | `get_regional_incidents` | Paginated; filters by category, status; returns region-scoped via RLS; includes wildland type flag |
| `GET` | `/api/regional/incidents/drafts` | `list_encoder_drafts` | Returns DRAFT incidents owned by the current encoder |
| `GET` | `/api/regional/incidents/check-duplicate` | `check_incident_duplicate` | Runs duplicate detection within 1km radius + 3 matching fields threshold |
| `GET` | `/api/regional/incidents/{incident_id}` | `get_regional_incident_detail` | Full incident detail with all related tables (nonsensitive, sensitive, wildland, responding units, involved parties, operational challenges) |
| `POST` | `/api/regional/incidents` | `create_incident` | Creates incident + nonsensitive/sensitive details + writes hash + syncs analytics |
| `PUT` | `/api/regional/incidents/{incident_id}` | `update_incident` | Updates incident details; checks verification status before edit; re-hashes |
| `DELETE` | `/api/regional/incidents/draft/{incident_id}` | `delete_draft` | Soft-deletes a DRAFT incident |
| `PATCH` | `/api/regional/incidents/draft/{incident_id}` | `update_draft` | Updates only DRAFT-status incident |
| `PATCH` | `/api/regional/incidents/{incident_id}/submit` | `submit_incident_for_review` | Changes status to `PENDING_VALIDATION`; audits |
| `PATCH` | `/api/regional/incidents/{incident_id}/unpend` | `unpend_incident` | Returns a PENDING incident back to encoder for editing |

### Statistics (`regional.py` lines ~2800–3200)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `GET` | `/api/regional/stats` | `get_regional_stats` | Aggregated counts by category, alarm level, status, wildland type; region-scoped |
| `GET` | `/api/regional/validator/stats` | `get_validator_stats` | Validator-scoped stats (total verified, pending validation, by category) |

### Verification Workflow (`regional.py` lines ~3200–4000)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `GET` | `/api/regional/validator/incidents` | `get_validator_incident_queue` | Paginated validator queue with acceptance state for duplicate awareness |
| `PATCH` | `/api/regional/incidents/{incident_id}/verification` | `verify_incident` | Single-incident verify (accept/reject); handles duplicate detection edge cases |
| `POST` | `/api/regional/validator/incidents/bulk-approve` | `bulk_approve_incidents` | Bulk approval with in-memory batch duplicate check; returns per-ID accept/replace/skip decisions |
| `PATCH` | `/api/regional/validator/incidents/{incident_id}/archive` | `archive_incident` | Changes status to `ARCHIVED` |
| `GET` | `/api/regional/validator/incidents/{incident_id}/diff` | `get_incident_diff` | Returns before/after diff for verification review |
| `POST` | `/api/regional/incidents/{incident_id}/force-replace` | `force_replace_incident` | Replaces a verified incident with a corrected version (M4 correction flow) |

### Regional Incident Lifecycle Module

**Source:** `src/backend/services/regional_incidents/`

The Phase 3 architecture refactor moved selected official incident transition behavior out of `regional.py` and into a backend service Module:

- `policies.py` defines encoder and validator transition matrices.
- `lifecycle.py` owns submit, unpend, delete, force-replace pending, validator decision, bulk approve, and archive finalized commands.
- `regional.py` still owns FastAPI auth dependencies, RLS session dependency injection, request models, response plumbing, and read/query endpoints.

Compatibility decision: encoder submit still writes `PENDING`; validator queue defaults include both `PENDING` and `PENDING_VALIDATION`.

### Audit Logs (`regional.py` lines ~4000–4500)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `GET` | `/api/regional/audit-log` | `get_encoder_audit_log` | Encoder's own audit trail; supports date_from/date_to filter; paginated |
| `GET` | `/api/regional/validator/audit-logs` | `get_validator_audit_logs` | Cross-region validator audit logs with filters: date range, region_id, validator_id, action type; paginated |
| `GET` | `/api/regional/validator/audit-logs/export` | `export_validator_audit_logs` | CSV export of validator audit logs with same filter support |

## Key Implementation Details

- **Duplicate detection** (M4-D): `DUPLICATE_RADIUS_METERS = 1000`, `DUPLICATE_MIN_MATCHING_FIELDS = 3`; uses `wims.check_incident_duplicate()` SQL function
- **AFOR import** handles Excel serial date conversion (`datetime(1899, 12, 30) + timedelta(days=serial)`) for 14 date/time format patterns
- **Barangay reverse-geocoding** (`_reverse_geocode_barangay`): newly added; uses `ST_Contains` against `ref_barangays.geometry` when polygon data is loaded; gracefully skips if geometry not available
- **`_insert_incident_verification_history`** handles both legacy (incident_id, comments) and new (target_type, target_id, action_label) schemas via runtime column detection
- **SecurityProvider** lazy singleton via `_get_security_provider()` avoids import-time env check issues in test mocks
- **`_wgs84_pair_from_raw`** validates latitude/longitude types, ranges, and finiteness before `ST_MakePoint`

## Related

- [[backend/api-route-map]] — route ownership
- [[frontend/route-map]] — regional dashboard routes
- [[database/schema-overview]] — `wims.fire_incidents`, `wims.incident_nonsensitive_details`, `wims.incident_verification_history`, `wims.incident_wildland_afor`
- [[security/security-baseline]] — RBAC, RLS scoping
- [[subsystems/validator-hub]] — validator's view of the same incident queue
- [[concepts/frs-module-map]] — M2 (Offline-First), M3 (Conflict Detection), M4 (Immutable Storage)

## API Reference

Every function in `src/backend/api/routes/regional.py` (~5050 lines) is documented at:
- [[subsystems/references/regional-api-ref]] — complete function-level docs for all 40+ route handlers, 10+ Pydantic schemas, 25+ helper functions, and both AFOR parsers (BfpXlsxParser, WildlandXlsxParser)

Every function in `src/backend/api/routes/triage.py` (~222 lines) is documented at:
- [[subsystems/references/triage-api-ref]] — complete function-level docs for 3 route handlers, 1 Pydantic schema, and 1 auth guard dependency
