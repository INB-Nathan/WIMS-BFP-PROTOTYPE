---
title: Regional Dashboard
created: 2026-05-16
updated: 2026-05-31
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

**Source:** `src/frontend/src/app/dashboard/regional/page.tsx`

The page title now displays "Dashboard" in the role workspace, while the sidebar places this dashboard before the shared `/home` Operations tab. The global sync banner and the former local synced badge are not shown above this dashboard.

**Summary Cards** — 5-card grid with icon and count label. The selected stats period is controlled by the Stats chip row, not repeated in individual card titles:

| Card | Border | Data Source |
|---|---|---|
| Total This Week | Red (#dc2626) | `stats.total_incidents_this_week` |
| Structural | Orange (#f97316) | `stats.by_category` filtered to STRUCTURAL |
| Non-Structural | Green (#22c55e) | `stats.by_category` filtered to NON_STRUCTURAL |
| Vehicular | Blue (#3b82f6) | `stats.by_category` filtered to VEHICULAR |
| Wildland Fire | Brown (#92400e) | `stats.wildland_total` |

**Incident Table** — paginated list with filters:

- Columns: Date, Classification (with wildland badge), Station, Location, Last Modified, Status
- Filters: Classification dropdown (from `REGIONAL_INCIDENT_GENERAL_CATEGORIES`), Verification Status chips, Per-page size selector, and right-aligned date controls. The date controls include Today/This Week/This Month/This Year/Specific Date/All Time, an always-visible calendar date picker for a specific modified date, and an explicit Apply Date action that stays disabled until a complete valid date is entered. Specific-date state starts empty on dashboard load and is cleared whenever a preset date period is selected. The frontend no longer exposes the Date of Fire date-basis toggle; regional filtering defaults to Date Modified and the calendar draft no longer refetches until applied.
- Default list scope is Today by Date Modified; Today, Specific Date, and any result set with 6 or fewer total incidents render incident cards with status-coloured 1px borders (green verified, red rejected, gray draft, warm yellow pending), softened metadata, primary fire time/location hierarchy, grouped secondary fields, separate district/city fields, combined caller/reporter/contact, paired classification/category, extent of damage, and compact affected-count chips. Wider result sets keep the compact table layout.
- Pagination: Prev/Next buttons, page X of Y display, configurable page sizes, and a bottom-row "See Archive" button that switches the workload list to archived incidents.
- Status badges: green (`VERIFIED`), red (`REJECTED`), yellow (everything else)
- Summary category cards aggregate legacy/current category aliases, including `VEHICULAR` + `TRANSPORTATION`, so counts match incident rows after backend category normalization.
- Empty state: centered "No incidents found" guidance with a BFP-red "Search All Time" button that switches the list date filter to All Time.
- Rows/cards are keyboard-focusable/clickable; a delayed floating "Click to view" bubble appears after hover and disappears on mouse movement or leave instead of using permanent Open text/actions. Archive-view rows/cards now open the same incident detail route instead of 404ing, because archived records are allowed through the role-scoped detail query.
- Pending offline create ops render as the same rich incident cards with `PENDING_SYNC` status and open the standard `/dashboard/regional/incidents/{localId}` detail route. The detail page reconstructs a normal read-only incident view from the encrypted offline op without fetching the server, only switches into the shared `IncidentForm` when the encoder clicks Edit, and deletes local pending creates with `deleteOfflineOpCascade(localId)` so linked queued work is removed with the create.
- Rejected workload UX: the alert is dismissible, its "Show rejected" action clears classification/date filters and switches date scope to All Time, and the Rejected status chip carries a red count badge. When switching away from Rejected or Drafts, an inherited All Time date scope is reset to Today so broad date ranges do not leak into normal workload views.

**Wildland Fire Classifications** — conditionally rendered when `stats.wildland_total > 0`:

- 8 wildland fire types (fire, agricultural, forest, grassland, brush, peatland, grazing land, mineral land) each with a colour-coded count badge. Backend stats normalize `lower(trim(wildland_fire_type))` before grouping so the generic `fire` bucket increments despite casing/spacing differences.

**Header quick actions:**

- Manual Entry -> `/afor/create`
- Import AFOR -> `/afor/import`
- Refresh (with spinning icon during load)

### Manual Entry / Import Review Navigation

`src/frontend/src/components/SectionDotNav.tsx` provides reusable fixed right-side dot navigation with scroll-spy labels and smooth-scroll click behavior. It is used by `IncidentForm.tsx` for structural manual entry and edit mode, `WildlandAforManualForm.tsx` for wildland manual entry and import correction handoff, and `/afor/import` for upload, map pin, summary, and data-preview workflow sections.

### Manual Entry Draft Restore

`IncidentForm.tsx` autosaves create-mode manual-entry drafts only after actual user input is observed by the form. Draft storage is scoped to the authenticated user ID (`wims:incident_draft:{user.id}`), while discard and successful submit also remove the legacy global `wims:incident_draft` key. This preserves intentional idle-logout restoration for `/afor/create` without showing a restore banner for a first-login blank form or another user's old browser draft.

### Manual Entry / Import Field Guidance

`IncidentForm.tsx` renders the Barangay reverse-geocoding tip below the Barangay input so the Barangay field aligns with City/Municipality in AFOR create and import correction flows while preserving the map-pin guidance text.

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

### Incident Detail - `/dashboard/regional/incidents/[id]`

**Source:** `src/frontend/src/app/dashboard/regional/incidents/[id]/page.tsx` (~1265 lines)

- Full incident detail view with formal report-style read-only presentation plus editable `IncidentForm`.
- For pending-sync offline creates, non-numeric local IDs load directly from encrypted `offlineOps` and render the same full-page report. Encoder actions support View, Edit, and Delete locally; server-only submit/withdraw/review actions remain unavailable until sync creates the server incident. The legacy `/dashboard/regional/incidents/local/[localId]` route redirects to this page.
- Read-only layout:
  - Compact header with back link, incident/reference title, status badge, created metadata, and encoder actions (Edit, Withdraw, Delete, Submit/Resubmit) using clearer button hierarchy. A desktop-only fixed left-edge back tab uses `calc(var(--sidebar-width) + 1rem)` so it sits immediately to the right of the authenticated sidebar; it is an icon-only vertical pill with smooth width/shadow/tint hover states and is replaced by a normal top button on smaller screens.
  - Top incident summary panel for notification date/time, fire station, classification, category/type, alarm level, location, and complete address. Status is intentionally only shown in the page header.
  - Desktop-only vertical dot section navigation for Response, Classification, Affected & Assets, Timeline, Casualties, Personnel, Location, Narrative, and Problems & Recommendations. Dots use larger click targets, smooth-scroll click behavior, hover/focus animation, labels, and sit against the right viewport margin with enough offset to avoid overlapping the report body.
  - Section cards use softened rounded surfaces, cohesive low-saturation header tints, muted labels, dark values, responsive definition-list grids, report-style long-text blocks, compact affected-count stat cells, and cleaner tables for engines/units, alarm timeline, casualties, and other personnel.
  - Formatted operational date/time values show explicit `(24H)` indicators where the detail page formats times.
  - **Incident Location Map** via `MapPickerInner` with detail zoom (320px height), now wrapped in the detail card with latitude/longitude still visible.
  - **Problems Encountered** renders selected problems as quieter chips and preserves custom/other entries.
- Edit mode: loads `IncidentForm` component (same form used for new incidents).
- Actions: Submit for review, Unpend/Withdraw (if pending), Delete draft, Edit; validator review controls remain available to validators at the bottom of the same route.
- Create/edit form includes a "Set to today" shortcut beside the fire notification date field; it writes the current Asia/Manila calendar day.
- Supports legacy and migrated `incident_verification_history` schemas (checks for `target_type` and `action_label` columns at runtime)

## Backend API Routes

All in `src/backend/api/routes/regional.py` (~5050 lines). This is the largest route file in the codebase.

### AFOR Import (`regional.py` lines 334–1066 approximately)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `POST` | `/api/afor/import` | `import_afor_file` | Parses structural/wildland AFOR XLSX/CSV; validates rows; returns parse result with VALID/INVALID per row; handles Excel serial date conversion |
| `POST` | `/api/afor/commit` | `commit_afor_import` | Commits pre-validated rows as fire_incidents; optional per-row duplicate resolution on second call; requires valid WGS84 coordinates as a fallback pin; for multi-row imports, resolves row-specific coordinates from `wims.ref_fire_stations` by exact `fire_station_name` so operational-map markers do not collapse to one fallback location when authoritative station data exists; city text alone does not override the explicit commit pin; creates nonsensitive/sensitive details; writes audit; syncs analytics |

### Incident CRUD (`regional.py` lines ~1066–2800)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `GET` | `/api/regional/incidents` | `get_regional_incidents` | Paginated; filters by category, status, `date_from`, `date_to`, and `date_basis` (`modified` or `fire`); returns region-scoped via RLS; includes wildland type flag and card summary fields; hides deterministic `AFOR-SEED-*` demo incidents from encoder workload views |
| `GET` | `/api/regional/incidents/drafts` | `list_encoder_drafts` | Returns DRAFT incidents owned by the current encoder |
| `GET` | `/api/regional/incidents/check-duplicate` | `check_incident_duplicate` | Runs duplicate detection within 1km radius + 3 matching fields threshold |
| `GET` | `/api/regional/incidents/{incident_id}` | `get_regional_incident_detail` | Full incident detail with all related tables (nonsensitive, sensitive, wildland, responding units, involved parties, operational challenges); includes archived records for authorized encoder/validator archive review |
| `POST` | `/api/regional/incidents` | `create_incident` | Creates incident + nonsensitive/sensitive details + writes hash + syncs analytics |
| `PUT` | `/api/regional/incidents/{incident_id}` | `update_incident` | Updates incident details; checks verification status before edit; re-hashes |
| `PATCH` | `/api/regional/incidents/{incident_id}/archive` | `encoder_archive_incident` | Soft-archives a VERIFIED incident owned by the encoder |
| `PATCH` | `/api/regional/incidents/{incident_id}/unarchive` | `encoder_unarchive_incident` | Restores an archived VERIFIED incident owned by the encoder |
| `DELETE` | `/api/regional/incidents/draft/{incident_id}` | `delete_draft` | Soft-deletes a DRAFT incident |
| `PATCH` | `/api/regional/incidents/draft/{incident_id}` | `update_draft` | Updates only DRAFT-status incident |
| `PATCH` | `/api/regional/incidents/{incident_id}/submit` | `submit_incident_for_review` | Changes status to `PENDING_VALIDATION`; audits |
| `PATCH` | `/api/regional/incidents/{incident_id}/unpend` | `unpend_incident` | Returns a PENDING incident back to encoder for editing |

### Statistics (`regional.py` lines ~2800–3200)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `GET` | `/api/regional/stats` | `get_regional_stats` | Aggregated counts by category, alarm level, status, wildland type, and Asia/Manila current-week incident total; region-scoped |
| `GET` | `/api/regional/validator/stats` | `get_validator_stats` | Validator-scoped stats (pending validation, wildland, category, total verified retained in API) |

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
- `lifecycle.py` owns submit, unpend, delete, force-replace pending, validator decision, bulk approve, archive finalized, and unarchive finalized commands.
- The PostgreSQL verified-row immutability rule is patched in both `src/postgres-init/41_fix_immutable_rule_for_archive.sql` and backend startup schema repair so `is_archived` may move `FALSE -> TRUE` and `TRUE -> FALSE` while other VERIFIED updates remain blocked.
- `regional.py` still owns FastAPI auth dependencies, RLS session dependency injection, request models, response plumbing, and read/query endpoints.

Compatibility decision: encoder submit still writes `PENDING`; validator queue defaults include both `PENDING` and `PENDING_VALIDATION`.

### Offline Create Idempotency

Offline create sync replays through `POST /api/incidents/upload-bundle` with `client_id = offlineOps.localId`. The endpoint no longer uses `INSERT ... ON CONFLICT` because PostgreSQL rejects that clause on `wims.fire_incidents` while immutable-record rules are present. The upload-bundle endpoint and direct regional create endpoint now acquire a transaction-scoped advisory lock keyed by `client_id`, check for an existing row, and perform a normal insert only when no row exists.

### Audit Logs (`regional.py` lines ~4000–4500)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `GET` | `/api/regional/audit-log` | `get_encoder_audit_log` | Encoder's own audit trail; supports date_from/date_to filter; paginated |
| `GET` | `/api/regional/validator/audit-logs` | `get_validator_audit_logs` | Cross-region validator audit logs with filters: date range, region_id, validator_id, action type; paginated |
| `GET` | `/api/regional/validator/audit-logs/export` | `export_validator_audit_logs` | CSV export of validator audit logs with same filter support |

## Key Implementation Details

- **Duplicate detection** (`src/backend/services/duplicate_detection.py`): Conservative anchor-gated model. A candidate is only evaluated after passing an anchor gate (coordinate proximity ≤ 250 m, OR matching barangay+street/landmark, OR matching establishment name + compatible location). After the anchor, candidates are scored across six dimensions: location (0–3 pts), category+type (0–3 pts), time delta (0–2 pts), address match (0–2 pts), establishment (0–1 pt), fire station (0–1 pt). Confidence bands: LIKELY ≥ 7, POSSIBLE ≥ 4. Returns `(matched_id, confidence)` or None. Temporal/administrative signals alone (same day, same city, same category) cannot trigger a duplicate.
- **AFOR import** handles Excel serial date conversion (`datetime(1899, 12, 30) + timedelta(days=serial)`) for 14 date/time format patterns
- **Barangay reverse-geocoding** (`_reverse_geocode_barangay`): newly added; uses `ST_Contains` against `ref_barangays.geometry` when polygon data is loaded; gracefully skips if geometry not available
- **`_insert_incident_verification_history`** handles both legacy (incident_id, comments) and new (target_type, target_id, action_label) schemas via runtime column detection; the extracted helper also accepts optional `data_hash` and `sync_status` fields for the M4b verification audit migration.
- **SecurityProvider** lazy singleton via `_get_security_provider()` avoids import-time env check issues in test mocks
- **`_wgs84_pair_from_raw`** validates latitude/longitude types, ranges, and finiteness before `ST_MakePoint`
- **Deleted draft guard:** regional status summary excludes incidents with `DELETED_DRAFT` history so deleted drafts do not inflate rejected workload indicators if legacy rows have inconsistent archived/status state.
- **Seeded incident guard:** regional encoder list/stats exclude deterministic analyst demo incidents (`AFOR-SEED-*` or import batch `SEEDED`) so the encoder dashboard reflects operational workload only.

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
