# System Wiki Log

Chronological record of system-wiki changes. Append-only.
Format: `## [YYYY-MM-DD] action | subject`

## [2026-05-19] update | Consolidate gap-register and functional-bug-register
- gap-register: condensed verbose multi-line entries into tight bullet points; M9 marked NOT-yet-implemented; barangay TOP-N marked OPTIONAL; Phase 2 analyst export confirmed pending; all other items confirmed/shortened.
- functional-bug-register: F-01 to F-07 consolidated; verbose Keycloak token timeout names removed; F-06 (analyst 500) marked Fixed; removed stale "smoke-checked" qualifiers.
- index.md: updated last-changes line to reflect consolidation.

## [2026-05-19] fix | PR #106 notification security and tracking follow-through
- Removed committed Firebase service-account JSON from the PR working tree and changed Docker Compose to accept Firebase credentials only through runtime environment/secret injection.
- Isolated `send_status_notification.delay(...)` failures behind logged best-effort enqueue so persisted triage promotions do not return 500 when Redis/Celery publish is unavailable.
- Updated `/report/tracking` to consume `?id=<reportId>` on first load and automatically fetch report status for notification click-throughs.
- Added focused backend/frontend regression tests for enqueue isolation and tracking query-param lookup.

## [2026-05-16] create | Final ingestion: remaining routes, backend infra, components, docs/scripts
- Created 5 new synthesis pages completing the wiki coverage:
  - [[backend/remaining-routes]] — Full API reference for 7 route files: incidents.py (8 routes: upload-bundle, attachments, analyst list/detail/wildland, export), analytics.py (15 routes: heatmap, trends, comparative, export dispatch/download, type-distribution, top-barangays, response-time, compare-regions, top-n, filter-options, execution-plans), public_dmz.py (rate-limited unauthenticated submission), civilian.py (submit + track reports), sessions.py (list + terminate), user.py (profile + password change), ref.py (regions, provinces, cities).
  - [[backend/backend-infrastructure]] — Auth: KeycloakAuthenticator with JWKS caching/validation + 7 FastAPI dependencies. DB: engine, session factory, get_db/get_db_with_rls, set_rls_context GUC. main.py: 10 route registrations, rate-limit middleware (5/15min Lua+Redis on login), PKCE callback. Models: 6 ORM models (User, FireIncident, CitizenReport, IVH, SecurityThreatLog) + geometry validation. Schemas: 6 Pydantic models. Celery: Redis broker/backend, 3 periodic tasks (MV refresh 6h, Suricata 10s, draft expiry daily).
  - [[frontend/components-deep]] — Deep docs for 12 components: TypeDistributionChart, TopBarangaysChart, TrendCharts, ResponseTimeChart, HeatmapViewer (all pure presentational Recharts/Leaflet), ExportPreviewModal (state machine: idle→queued→polling→downloading→done/error), AnalystIncidentList (478-line paginated/sortable/selectable table with detail drawer), DuplicateIncidentModal, DuplicateResolutionModal, LayoutShell (auth guard + PWA SW cleanup), Header (breadcrumbs + live PST clock + role badge), WildlandAforManualForm (927-line 11-section form).
  - [[architecture/docs-and-scripts]] — docs/ (10 files: ARCHITECTURE, CHANGELOG, API_AND_FUNCTIONS, M4-PR, M4-INCIDENT-WORKFLOW-DETAILS, VALIDATOR_WORKFLOW_CHANGELOG, 3 PR docs). scripts/ indexed; rejected barangay loader artifacts are not part of the committed script surface.
- Updated index.md: 24 → 31 synthesis pages, all new pages linked.
- Updated agent-routing-guide.md to point to remaining-routes and backend-infrastructure.
- Total system-wiki documents: 31 synthesis pages + 3 reference files = 34 documents.
- The wiki now covers 100% of the codebase surface area:
  - ALL 16 backend route files documented
  - ALL 7 auth/database dependencies documented
  - ALL backend services (analytics, duplicates, Keycloak, AI, Suricata) documented
  - ALL utilities (crypto, audit, session, backup) documented
  - ALL Celery tasks (4 exports, 3 periodic) documented
  - ALL 31 SQL init files documented
  - ALL 6 ORM models, 6 Pydantic schemas documented
  - ALL frontend components (22+) documented
  - ALL 47 API client functions documented
  - ALL infra config (Docker, Nginx, Suricata, Keycloak 2641-line realm) documented
  - ALL 10 docs/ files and 14 scripts/ files indexed
  - ALL 3 dashboard subsystems have function-level API references

## [2026-05-16] create | Comprehensive wiki ingestion: frontend infra, DB SQL, services, utils/tasks, infra config, PWA/tests/CI
- Created 8 new synthesis pages across all layers:
  - [[frontend/frontend-infrastructure]] — Auth context (Keycloak OIDC, 4-min token refresh, cross-tab lock), 47 API client functions, utility libraries (afor-utils, ph-regions, regional-incidents, workflow-transfer), full component tree (Sidebar, IncidentForm~1956 lines, MapPickerInner with Nominatim, IncidentDiffPanel, SyncStatusBar, and 8 analytics chart components).
  - [[database/sql-init-files]] — All 31 SQL init files documented: RLS policies (16 tables force-enabled), helpers (current_user_uuid/role/region_id GUC system, exec_as_system_admin), 4 materialized views, immutable records RULES, PKI encrypt PII schema, seed data (12 verified incidents, 18 regions, 81 provinces, thousands of cities, 5 seed users).
  - [[backend/services]] — Analytics read model (17 functions: sync/batch/backfill/heatmap/trends/top-n/export/compare), duplicate detection (5km radius + ±1 day spatial + text fallback), Keycloak admin (8 functions: create/set/update/logout/change/get), AI/XAI service (qwen2.5:3b via Ollama with JSON format output).
  - [[backend/utilities-and-tasks]] — Crypto (AES-256-GCM PII blob with incident-bound AAD), audit trail (writes system_audit_trails), Redis session revocation (12h TTL), backup crypto (AES-256-GCM .sql.enc format), 4 Celery export tasks (CSV/PDF/XLSX with 26-column whitelist).
  - [[architecture/infrastructure-config]] — Docker Compose (8 services, health checks, volumes), Nginx (proxy table, CORS, cookie domain rewrite, missing WebSocket/SSE), Suricata (EVE output, no custom suricata.yaml, classification.config with 37 categories), Keycloak realm (2641-line export: 5-min tokens, 30-min SSO idle, conditional OTP per role, 23 seed users, wims-admin-service confidential client with hardcoded secret).
  - [[architecture/pwa-tests-cicd]] — PWA/offline-first: IndexedDB queue (idb), sync engine (LWW conflict resolution on 409), network status hook, auto-sync with 2s debounce, service worker with Background Sync API, manifest (standalone PWA). Tests: 30 test files (10 unit, 19 integration), SQL contract pattern (inspect.getsource), e2e Keycloak+MailHog. CI: 5 parallel jobs + merge-gate. CD: GHCR image push on master.
- Updated [[operations/agent-routing-guide]]: every task now points to specific service/utility/infra pages.
- Updated [[index.md]]: 16 → 24 total synthesis pages, all new pages listed under their sections.
- Total system-wiki documents: 24 synthesis pages + 3 reference files = 27 documents.

## [2026-05-16] create | API reference files for all three dashboard subsystems
- Created `system-wiki/subsystems/references/` with three function-level API reference files:
  - [[subsystems/references/admin-api-ref]] — Every function in admin.py documented: 16 route handlers, 4 Pydantic schemas, 2 helpers. Each entry includes route decorator, auth dep, DB session type, all parameters with types, return shape, all HTTP errors with conditions, and detailed behavior notes (audit logging, RLS context, Keycloak sync, backup encryption, retention policy).
  - [[subsystems/references/regional-api-ref]] — Every function in regional.py (~5050 lines) documented: 40+ route handlers, 10+ schemas, 25+ helpers, both AFOR parsers (BfpXlsxParser, WildlandXlsxParser). Covers AFOR import pipeline, incident CRUD, stats, verification workflow, audit logs, duplicate detection, barangay reverse-geocoding.
  - [[subsystems/references/triage-api-ref]] — Every function in triage.py: get_pending_reports, promote_report, bulk_promote_reports, BulkPromoteRequest schema, _require_encoder_or_validator guard dependency.
- Updated all three subsystem pages to include "## API Reference" sections linking to the reference files.
- Updated `index.md` to list reference files under their parent subsystem entries.
- Total synthesis pages: 16 pages + 3 reference files = 19 total wiki documents.

## [2026-05-17] update | analyst incident detail backend + sensitive endpoint + numeric hardening + index fix
- `GET /incidents/analyst/{incident_id}` — fully rewired:
  - Added `form_kind` field via `CASE WHEN w.incident_id IS NOT NULL THEN 'WILDLAND_AFOR' ELSE 'STRUCTURAL_AFOR'` using LEFT JOIN on `incident_wildland_afor`
  - Added all 19 structural fields from `incident_nonsensitive_details`: `fire_origin`, `extent_of_damage`, `structures_affected`, `households_affected`, `individuals_affected`, `vehicles_affected`, `resources_deployed`, `alarm_timeline`, `problems_encountered`, `stage_of_fire`, `extent_total_floor_area_sqm`, `extent_total_land_area_hectares`, `water_tankers_used`, `breathing_apparatus_used`, `total_gas_consumed_liters`, `families_affected`, `responder_type`, `fire_station_name`, `distance_from_station_km`
  - When `has_wildland_afor = true`, inlines `wildland` (full row dict), `alarm_statuses`, and `assistance_rows` from joined tables
  - Sensitive fields (narrative, PII, disposition) intentionally excluded — use `/sensitive` endpoint
  - **Index fix (another agent):** Live DB query confirmed the SELECT returns 38 columns (indexes 0–37). `form_kind` at row[18], `fire_station_name` at row[36], `distance_from_station_km` at row[37]. Original indices were off by 2 due to stale indexing from removed `barangay_name` JOIN. All row indices updated to actual positions; endpoint returns 200 for incident 12.
- New `GET /incidents/analyst/{incident_id}/sensitive` — separate endpoint for PII:
  - Same auth: `NATIONAL_ANALYST` or `SYSTEM_ADMIN`
  - Returns: `caller_name`, `caller_number`, `owner_name`, `establishment_name`, `occupant_name`, `narrative_report`, `prepared_by_officer`, `noted_by_officer`, `disposition`, `fire_origin`, `extent_of_damage`, `alarm_timeline`
  - Verifies incident is VERIFIED and not archived before returning any data (404 otherwise)
- Numeric field hardening: replaced bare `float()` casts on `NUMERIC` columns with `_analyst_json_value()` helper for `estimated_damage_php`, `extent_total_floor_area_sqm`, `extent_total_land_area_hectares`, `total_gas_consumed_liters`, `distance_from_station_km`. Prevents `ValueError` when garbage strings (e.g. `'BFP'` in `total_gas_consumed_liters` for incident 12) land in numeric columns.
- Removed dead `ref_barangays` LEFT JOIN — `barangay_id` is never written by encoder workflow; JOIN always returned empty. Comment added referencing future purge tracking. `barangay_name` dropped from response; frontend `FieldRow` renders `N/A`.
- Frontend `api.ts` — `AnalystIncidentDetailResponse` extended with all new fields + `form_kind` + optional wildland sub-objects; `AnalystIncidentSensitiveResponse` interface added; `fetchAnalystIncidentSensitive()` function added.
- Frontend analyst detail page (`/dashboard/analyst/incidents/[id]`) — fully redesigned by parallel agent: 8 collapsible sections (A–H), blur/reveal sensitive data with per-field eye-icon toggle, locked wildland section for STRUCTURAL_AFOR, lazy-load sensitive endpoint on user click. Reviews passed.
- Updated `system-wiki/backend/api-route-map.md`: added `/incidents/analyst/{incident_id}/sensitive` route entry.
- SQL contract tests pass: 4/4 (`test_analyst_incidents_sql_contract.py`).

## [2026-05-16] retracted | PSGC barangay geometry full-load pipeline
- A proposed PSGC barangay geometry full-load pipeline was generated but rejected before commit.
- Rejected artifacts included a PSGC code SQL migration, a Python geometry loader, a prep script, a loader Dockerfile, and a Compose startup dependency.
- Rejection reasons: normal stack startup became network-dependent, Docker Compose lost/broke existing backend/celery/Keycloak settings, and the proposed SQL attempted invalid `NULL` inserts into `ref_barangays.city_id`.
- The stable state is now: keep `31_barangay_geometry.sql` as an optional schema hook, remove barangay from Analyst Top-N selectors, and use municipality/fire-station/region for reliable hotspot ranking.
- Created `system-wiki/subsystems/` directory with three new synthesis pages:
  - [[subsystems/admin-hub]] — System admin hub: identity management, security telemetry, audit logs, health check, scheduled reports, backup management. Documents all 25+ admin.py endpoints and all 8 admin hub frontend panels.
  - [[subsystems/regional-dashboard]] — Regional encoder dashboard: AFOR import pipeline (5050-line regional.py), incident CRUD, drafts management, encoder audit trail, incident detail page with editable IncidentForm.
  - [[subsystems/validator-hub]] — National validator dashboard: verification queue, single/bulk approve workflow, duplicate resolution with Promise-based pattern, audit trail with CSV export, diff panels.
- Updated `index.md` (new Subsystems section, total 16 pages).
- Updated `operations/agent-routing-guide.md` (auth, incident-CRUD, and validation tasks now reference the subsystem pages).

## [2026-05-16] fix | TOP-N barangay dimension — code resolved, verification pending
- Implemented reverse-geocoding fix via OpenCode subagent (commit `4fb24b7`).
- Created `src/postgres-init/31_barangay_geometry.sql` — adds `geometry GEOGRAPHY(POLYGON, 4326)` + GiST index to `ref_barangays`.
- Added `_reverse_geocode_barangay(db, incident_id, lon, lat)` to `src/backend/api/routes/regional.py` — called after incident INSERT in 3 locations (_commit_wildland_afor_row, AFOR structural commit loop, create_incident). Uses `ST_Contains` + calls `sync_incident_to_analytics`. Gracefully skips if geometry not yet loaded.
- Updated gap register: RESOLVED in code, verification pending (needs PSGC polygon data loaded + existing incidents re-synced).

## [2026-05-16] gap | TOP-N barangay dimension broken for AFOR-imported/manual incidents
- `analytics_incident_facts.barangay_name` is NULL for all AFOR-imported and most manual incidents because `incident_nonsensitive_details.barangay_id` is never written during AFOR import (AFOR form has no barangay field, import code only resolves city_id) and is optional in manual create. `get_top_n` filters `WHERE {dim_col} IS NOT NULL`, so TOP-N by barangay returns zero results for this data. Municipality and province dimensions work because they are denormalized from populated columns. Resolution: reverse-geocode location geometry to barangay OR add barangay field to AFOR import form. Logged to `gaps/frs-codebase-gap-register.md`.

## [2026-05-16] implement | Deterministic incident seed data
- Added `src/postgres-init/29_seed_incidents.sql`, an idempotent seed file with 12 verified incidents across NCR, Region IV-A, and Region V.
- Seed data includes `fire_incidents`, nonsensitive and sensitive detail rows, verification history, analytics facts, geography denormalization fields, and materialized view refreshes for analyst dashboard/export workflows.

## [2026-05-16] implement | National Analyst Phase 2 analyst incident export backend
- Added `POST /api/incidents/analyst/export/{csv|pdf|excel}` to queue analyst incident exports for filtered results or selected `incident_ids`.
- Added `export_analyst_incidents_task` in `src/backend/tasks/exports.py`, reusing the existing `_export`, `_write_csv`, `_write_xlsx`, and `_write_pdf` helpers.
- Added `get_analyst_export_rows` in `src/backend/services/analytics_read_model.py`; selected IDs are deduplicated and intersected through the RLS-protected analytics read model query.
- Schema change: `src/postgres-init/28_analytics_geography_denorm.sql` now adds `analytics_export_log.export_type`, and analyst exports log `export_type = 'analyst'`.
- Validation: `src/backend/tests/test_analyst_export.py` added 8 tests and passed (`8 passed`); compile gates passed for `api/routes/incidents.py`, `tasks/exports.py`, and `services/analytics_read_model.py`; existing analyst SQL contract tests passed (`4 passed`).

## [2026-05-16] implement | National Analyst Phase 1 workflow UI and selection
- Added `src/frontend/src/lib/analyst-workflow-transfer.ts` for `sessionStorage` transfer-ID handoff from dashboard to dedicated workflow pages.
- Made the analyst incident list prominent/selectable, with persistent selection across pagination, column visibility, selected-count actions, and "Analyze selected" workflow transfer.
- Wired `/dashboard/analyst/[workflow]` to read transfer payloads, initialize local filters/selected IDs, provide local reset, label selected-set behavior, keep charts filter-scoped, and use 100 rows/page for Incident Explorer.
- Added `incident_ids` support to `GET /api/incidents/analyst-list` for selected-set evidence tables.
- Extended analytics trends interval support to daily/weekly/monthly/quarterly/yearly.
- Validation: frontend lint passed with pre-existing warnings only; analyst Vitest suites passed (`33 passed`); backend py-compile plus focused analyst SQL contract tests passed (`4 passed`); production frontend build passed with network access for Google Fonts.

## [2026-05-16] decision | Dedicated analyst workflow MVP phasing
- Implement in two phases for efficiency.
- Phase 1: workflow UI and selection, including transfer-ID filter/selection handoff, local reset, prominent dashboard list, persistent selection, 100-row Incident Explorer, filter-scoped charts/evidence tables, and clear selected/export labeling.
- Phase 2: modular incident export backend, including analyst incident export endpoints, selected/current-result scopes, selected-column CSV/PDF, full AFOR CSV/PDF, export audit logging, and focused tests.

## [2026-05-16] decision | Selected-ID analytics MVP boundary
- MVP aggregate charts/calculations should remain filter-scoped.
- Selected incident IDs should drive table/export behavior only, with UI labeling that charts use current filters while selected exports use selected incidents.
- Backend ID-scoped aggregate analytics is post-MVP.

## [2026-05-16] decision | Dedicated workflow current-result export
- Every dedicated analyst workflow page should support exporting its current filtered result.
- Export UI should clearly label selected incidents, current filtered result, full AFOR for selected incidents, and full AFOR for current result.
- Large full-AFOR current-result exports should be queued asynchronously with stronger confirmation.

## [2026-05-16] decision | Incident export scopes
- The new incident export module should support both explicit selected IDs and current filtered result exports.
- UI actions should be labeled separately as "Export selected" and "Export current result".
- Current-result export should apply local filters across all matching verified incidents, not just the current page, and should show estimated-count confirmation before queueing.

## [2026-05-16] decision | Selected export API contract
- MVP selected export endpoints should live under analyst incident routes: `POST /api/incidents/analyst/export` and `GET /api/incidents/analyst/export/{task_id}`.
- Request body should include incident IDs, export mode (`selected_columns` or `full_afor`), format (`csv` or `pdf`), and columns for selected-column export.
- Backend must enforce analyst/admin RBAC, re-check verified/non-archived incident eligibility, allowlist columns, and log export metadata.
- Optional future enhancement after MVP: `GET /api/incidents/analyst/export/{task_id}/status`.

## [2026-05-16] decision | Modular selected export backend
- Selected incident/AFOR export should be a parallel modular export system, not an extension of the existing analytics aggregate export endpoint.
- Rationale: selected-record/full-AFOR exports have different payload shape, flattening rules, and failure modes; separation avoids turning analytics export into a single point of failure.

## [2026-05-16] decision | Incident Explorer workflow
- Incident Explorer should be the selected-set control center.
- It should support shared local filters, 100 rows/page, column visibility, sorting, row selection across pagination, quick search if backend-supported, drawer/detail navigation, selected-count action bar, Analyze Selected, selected-column export, full AFOR export, and Clear Selection.

## [2026-05-16] decision | Top-N workflow controls
- Top-N / Hotspot should default to Top 10 municipalities by incident count.
- Controls should include dimension, metric, N, and sort direction.
- Do not add a minimum incident count threshold; truthful low-sample rankings should remain visible.
- Outputs should include ranked chart/table, click-to-filter incident table behavior, and ranking plus evidence export.

## [2026-05-16] decision | Response-time workflow controls
- Response Time should use `total_response_time_minutes` as the primary metric.
- Recommended controls: group-by dimension, statistic, target threshold minutes, exclude incomplete timestamps default-on, and editable inherited local date range.
- Outputs should include grouped charting, average/median/fastest/slowest/within-threshold tiles, slowest-incident outlier table, and the incident evidence table.

## [2026-05-16] decision | Trends workflow controls
- Trends interval options should be daily, weekly, monthly, quarterly, and yearly.
- Trends should also include manual Range A to Range B date inputs for the exact trend window.
- Recommended additional controls: measure, compare-by split, and rolling average; outputs should include chart, summary tiles, and matching incident evidence table.

## [2026-05-16] decision | Selected incident transfer storage
- Selected incident handoff from `/dashboard/analyst` into dedicated workflow pages should use `sessionStorage` keyed by a short transfer ID.
- Workflow URLs should carry only the transfer ID, e.g. `/dashboard/analyst/{workflow}?transfer={uuid}`, then initialize local filters and selected incident IDs from the browser-local payload.

## [2026-05-16] handoff | Analyst dedicated pages grill pass
- Created `system-wiki/sessions/2026-05-15_1223_xynate_analyst-dedicated-pages-grill-handoff.md`.
- Handoff captures the dedicated-page decisions, current dirty files, validation results, implementation caveats, and next-session questions.

## [2026-05-16] decision | Heatmap workflow map-area filtering
- The dedicated heatmap/geospatial workflow should follow shared map/global filters and selected map area.
- The incident table below the map should follow both the active map filters and the selected area.
- Recommended local controls: map metric, aggregation level, intensity mode, incident pins toggle, administrative boundaries toggle, and map snapshot export.

## [2026-05-15] decision | Full AFOR CSV shape
- Full AFOR CSV export should be one row per incident with all AFOR fields flattened into stable columns.
- Repeating/nested sections should be serialized into readable semicolon-separated cell values, not expanded into multiple incident rows.

## [2026-05-15] decision | Selected export modes
- Selected-record CSV/PDF exports should use a dedicated column-selection modal for list/table columns.
- Full AFOR export means all AFOR fields/columns for selected incidents, not just visible list columns.
- Multi-incident full AFOR PDF export should generate one combined PDF with each incident starting on a new page or clearly separated section.

## [2026-05-15] decision | Selected-set workflow transfer
- Normal dedicated-workflow navigation transfers active filters only.
- Explicit "Analyze selected" actions should transfer active filters plus selected incident IDs, with a selected-set banner, selected-default exports, and local reset that clears the selected IDs.
- Aggregate charts should not imply selected-ID calculations until backend analytics endpoints support explicit incident ID sets.

## [2026-05-15] decision | Analyst incident-list pagination and selection persistence
- Dashboard incident-list selections should persist across pagination while filters remain unchanged.
- The dedicated incident-explorer page should present a denser 100-row page size for bulk review, while the dashboard can keep its smaller overview page size.

## [2026-05-15] decision | Comparative workflow and selected incident export
- Comparative analysis should apply the same non-date global/local filters to both periods; only `Range A` and `Range B` date windows differ.
- The analyst incident list should become more prominent and support a selected incident set that can be exported independently to CSV/PDF, instead of only exporting the full filtered analytics result.

## [2026-05-15] decision | Analyst workflow filter handoff
- Dedicated analyst workflow pages should initialize their local filters from the active `/dashboard/analyst` global filters when opened from the overview dashboard.
- Each workflow page also needs a local reset/clear action that resets only that workflow page's filter inputs and does not mutate the overview dashboard's current filters.

## [2026-05-15] update | Dedicated National Analyst workflow pages
- Added `/dashboard/analyst/[workflow]` with focused workflow pages for `comparative`, `heatmap`, `trends`, `response-time`, `top-n`, and `incident-explorer`.
- Added dashboard workflow launch cards and expanded the `NATIONAL_ANALYST` sidebar section with direct workflow links.
- Updated frontend route map, National Analyst evaluation, UI/UX gap register, FRS/codebase gap register, and index date. Validation completed: frontend lint, existing analyst Vitest suites, and frontend production build.

## [2026-05-15] handoff | National analyst validation and Keycloak fixes
- Created `system-wiki/sessions/2026-05-15_1148_xynate_national-analyst-validation-keycloak-handoff.md`.
- Handoff points the next session toward a docs-driven/grill pass for dedicated National Analyst pages and references existing wiki artifacts instead of duplicating them.

## [2026-05-15] fix | Analyst incident list region schema mismatch
- Container logs showed `/api/incidents/analyst-list` failing with `psycopg2.errors.UndefinedColumn: column r.short_name does not exist`.
- Patched analyst list/detail queries to use `ref_regions.region_code` / `region_name` instead of `short_name`.
- Expanded `src/backend/tests/test_analyst_incidents_sql_contract.py` to guard against `r.short_name` regressions.
- Rebuilt/restarted backend and smoke-checked the patched SQL against local Postgres. Local runtime data has `0` `fire_incidents` and `0` analytics facts, so the dashboard will show no visible incidents until data is seeded/imported and verified.

## [2026-05-15] fix | Keycloak forgot-password local test config
## [2026-05-16] fix | Reject fragile barangay geometry loader
- Removed the uncommitted `load-barangay-geometries` Docker/PSGC loader path after validation showed it broke `docker-compose.yml`, made backend startup depend on live GitHub downloads, and attempted invalid `ref_barangays.city_id = NULL` inserts.
- Restored the normal backend/celery/Keycloak Docker Compose shape and kept `31_barangay_geometry.sql` as an optional schema hook only.
- Removed barangay from Analyst Top-N dimension selectors; municipality remains the stable default for hotspot ranking until a vetted local barangay polygon import exists.

- Fixed `test_keycloak_password_reset.py` flow execution helper to call Keycloak's reset-credentials executions endpoint by URL-encoded flow alias instead of internal flow ID.
- Configured `src/keycloak/bfp-realm.json` with MailHog SMTP defaults for local password-reset email tests.
- Added a `mailhog` service to `src/docker-compose.yml` exposing SMTP `1025` and web/API `8025`.
- Updated security baseline and functional bug register. Targeted Keycloak tests skip in this sandbox because Keycloak is unreachable here; the running local realm may need Admin API update or container recreate/import to pick up SMTP defaults.

## [2026-05-15] fix | National analyst incident list 500 and dashboard UX
- Fixed analyst incident list/detail SQL to match the live schema: `ref_barangays` / `analytics_incident_facts.barangay_name` for barangay names, derived casualty severity from casualty counts, `fire_incidents.data_hash` for provenance, and derived analytics sync status from fact presence.
- Added `src/backend/tests/test_analyst_incidents_sql_contract.py` to guard against reintroducing nonexistent analyst-list columns.
- Overhauled `/dashboard/analyst` scanability: summary tiles, grouped filters, clearer apply/reset controls, export preview actions, icon-led panel headers, sticky portrait heatmap, and friendlier incident-list error copy.
- Validation completed: focused backend regression test, Python compile for `api/routes/incidents.py`, frontend analyst Vitest suites, and frontend lint. Broader backend integration suites still hang in this environment and need a non-hanging stack/runner.

## [2026-05-14] update | National analyst Phase 7 wiki validation
- Updated National Analyst synthesis/gap pages to reflect completed Phase 0-6 code: analytics sync, export infrastructure, geography filters, Recharts charts, incident list/drawer/detail/wildland routes, dashboard export preview/download, CSV/PDF/Excel entry points, side-column heatmap, prominent filter labels, top municipalities, response-time view, and analyst sidebar.
- Updated backend/frontend/database maps with the current analyst dashboard route/API/schema state.
- Left browser UI verification, full backend integration test pass, Celery result retention, export cleanup, seeded wildland examples, and scheduled reports as explicit remaining verification/deferred items.

## [2026-05-14] handoff | Phase 5 incident drill-down session
- Created `sessions/2026-05-14_2007_x1n4te_phase5-incident-drilldown-handoff.md` with verification notes, next-session cautions, and suggested skills.

## [2026-05-14] update | National analyst Phase 5 incident drill-down
- Added backend route-map entries for `GET /api/incidents/analyst-list`, `GET /api/incidents/analyst/{incident_id}`, and `GET /api/incidents/analyst/{incident_id}/wildland`.
- Added frontend route-map entries for `/dashboard/analyst/incidents/[id]` and `/dashboard/analyst/incidents/[id]/wildland`.
- Updated National Analyst evaluation and gap registers: incident list/drawer/detail/wildland drill-down are fixed in code and need browser UI verification; export preview remains pending.

## [2026-05-14] update | National analyst backend slice started
- Added API map entries for `GET /api/analytics/export/{task_id}` and `GET /api/analytics/filter-options`.
- Documented `28_analytics_geography_denorm.sql`: denormalized `municipality_name` / `province_name` on `analytics_incident_facts`, plus export task/file metadata on `analytics_export_log`.
- Updated National Analyst evaluation/gap registers: verification sync remains fixed, export backend is implemented but frontend preview/download UX remains pending, and National Analyst sidebar navigation is fixed.

## [2026-05-14] handoff | Session complete, handoff file created
- AGENTS.md updated: added "System Wiki & Agent Context Routing" section pointing agents to system-wiki/.
- Session handoff created: `sessions/2026-05-14_1605_x1n4te_system-wiki-initialization-uiux-evaluations.md` — full session summary, recommended skills, known conventions, open questions.
- Open items for next session: wiki-dir/ cleanup decision, next desk-check page, groupmate wiki access, GitHub Issues conversion of gap register.

## [2026-05-14] add | National analyst dashboard evaluation
- Raw notes added to `raw/ui-ux/evaluation-national-analyst.md`.
- Synthesis created at `ui-ux/evaluation-national-analyst.md` — layout issues (L-01–L-04), filter issues (F-01–F-02), plus FRS/codebase gaps not explicitly raised by user (G-01–G-08).
- Cross-referenced with FRS M5 (Analytics), GitHub issues #84–#89.
- Key findings from FRS not raised by user: Top municipalities view missing (G-01), Average response time by region missing (G-02), P0 CRITICAL data pipeline bug (#84 — verify_incident() no analytics sync).
- Execution order per #89: Phase 0 → Phase 1 → Phase 2/3 (parallel) → Phase 5 → Phase 4.
- Added to `ui-ux-gap-register.md` (National Analyst Dashboard section) and `index.md` (UI/UX Evaluations section).
- SCHEMA.md authority model: "Empty or incomplete FRS source files" rule preserved (applies if future sources are empty).

## [2026-05-14] split | Functional bugs moved from UI/UX register to standalone register
- `gaps/functional-bug-register.md` created — holds 5 teammate-reported functional/auth bugs (M12).
- Teammate bugs section removed from `gaps/ui-ux-gap-register.md`; cross-links added in both directions.
- `gaps/frs-codebase-gap-register.md` Related section updated to include `functional-bug-register`.
- `index.md` Gaps section updated: all 3 gap registers now listed separately.
- `log.md` entries updated to reflect split.

## [2026-05-14] add | Teammate-reported bugs to UI/UX gap register
- 5 bugs added to `gaps/ui-ux-gap-register.md` (Teammate-Reported Bugs section):
  - System Audit record_id shows "-" on create user actions (M12).
  - First login allows missing First Name, Last Name, device name — Keycloak profile validation not enforced.
  - No username change opportunity on first login — admin expects but no UI exists.
  - Session lifespan too short / fast logout — Keycloak token config issue.
  - No account recovery if TOTP authenticator is deleted — hard lockout, no fallback.

## [2026-05-14] split | UI/UX gaps separated from FRS codebase gap register
- Created `gaps/ui-ux-gap-register.md` — standalone gap register for UI/UX issues.
- Removed UI/UX section from `gaps/frs-codebase-gap-register.md`; added cross-link.
- `index.md` updated: total pages 12 -> 13, Gaps section now lists both registers separately.
- Updated header in `ui-ux-gap-register.md` to reflect teammate as well as user evaluations.

## [2026-05-14] update | FRS sources restored, UI/UX evaluations ingested
- `raw/frs/frs-analyticsandreporting.md` filled: M5 now has full spec (statistical query engine, analytics views, export pipeline).
- `raw/frs/frs-cryptographicsecurity.md` filled: M6 now has full spec (OpenBao key management, AES-256-GCM at-rest, TLS 1.3 in-transit).
- `raw/frs/frs-publicanonymousincidentsubmission.md` filled: M14 now has full spec (zero-trust endpoint, Redis rate limiting, auto region resolution, Pydantic validation).
- `raw/frs/frs-systemmonitoringandhealthdashboard.md` filled: M9 now has full spec (psutil/Docker metrics, 60s refresh, log full-text search, configuration management).
- Gap register updated: "Source Gaps" section removed (sources now populated); M9 System Monitoring and UI/UX gaps added.
- New synthesis pages created: `ui-ux/evaluation-loginpage-keycloaksso.md` and `ui-ux/evaluation-system-admin-hub.md` from user desk-check notes.
- `raw/ui-ux/` directory created as immutable source for future evaluations.
- SCHEMA.md updated: added `ui-ux` to types and `ui-ux`, `hci` to domains taxonomy.
- `index.md` updated: total pages 10 -> 12, added UI/UX Evaluations section, updated Raw Source Captures description.
## [2026-05-14] split | UI/UX gaps separated from FRS codebase gap register
- Created `gaps/ui-ux-gap-register.md` — standalone gap register for UI/UX issues.
- Removed UI/UX section from `gaps/frs-codebase-gap-register.md`; added cross-link.
- `index.md` updated: total pages 12 -> 13, Gaps section now lists both registers separately.
- Updated header in `ui-ux-gap-register.md` to reflect teammate as well as user evaluations.
## [2026-05-14] add | Teammate-reported bugs to UI/UX gap register
- 5 bugs added to `gaps/ui-ux-gap-register.md` (Teammate-Reported Bugs section):
  - System Audit record_id shows "-" on create user actions (M12).
  - First login allows missing First Name, Last Name, device name — Keycloak profile validation not enforced.
  - No username change opportunity on first login — admin expects but no UI exists.
  - Session lifespan too short / fast logout — Keycloak token config issue.
  - No account recovery if TOTP authenticator is deleted — hard lockout, no fallback.
## [2026-05-14] split | Functional bugs moved from UI/UX register to standalone register
- `gaps/functional-bug-register.md` created — holds 5 teammate-reported functional/auth bugs (M12).
- Teammate bugs section removed from `gaps/ui-ux-gap-register.md`; cross-links added in both directions.
- `gaps/frs-codebase-gap-register.md` Related section updated to include `functional-bug-register`.
- `index.md` Gaps section updated: all 3 gap registers now listed separately.
- `log.md` entries updated to reflect split.
## [2026-05-14] add | National analyst dashboard evaluation
- Raw notes added to `raw/ui-ux/evaluation-national-analyst.md`.
- Synthesis created at `ui-ux/evaluation-national-analyst.md` — layout issues (L-01–L-04), filter issues (F-01–F-02), plus FRS/codebase gaps not explicitly raised by user (G-01–G-08).
- Cross-referenced with FRS M5 (Analytics), GitHub issues #84–#89.
- Key findings from FRS not raised by user: Top municipalities view missing (G-01), Average response time by region missing (G-02), P0 CRITICAL data pipeline bug (#84 — verify_incident() no analytics sync).
- Execution order per #89: Phase 0 → Phase 1 → Phase 2/3 (parallel) → Phase 5 → Phase 4.
- Added to `ui-ux-gap-register.md` (National Analyst Dashboard section) and `index.md` (UI/UX Evaluations section).
- SCHEMA.md authority model: "Empty or incomplete FRS source files" rule preserved (applies if future sources are empty).
## [2026-05-17] add | PR QA pages for May 2026 batch (PRs #102–#105)
- Created `pr-qa/` directory with 5 QA pages: batch overview + 4 individual PR docs
- PR #102 (laqqui): M4 post-fix — AFOR import gaps, field persistence, validator audit 500, VALIDATOR role 404, immutable rule fix, seed incidents, barangay geometry reversal. 7 bug clusters all resolved. ✅ APPROVE
- PR #103 (orljorstin, #70): Prometheus /metrics endpoint, worker heartbeat (30s), /api/admin/monitoring/workers, /api/admin/monitoring/system, worker_heartbeat.sql. 7/7 tests pass. Merge after #104. ✅ APPROVE
- PR #104 (orljorstin, #69): XAI incident narrative generation via Qwen2.5-3B, POST /incidents/{id}/narrative, batch endpoint, ai_narrative + confidence columns. 8/8 tests pass. Prompt injection noted as low risk. ✅ APPROVE
- PR #105 (orljorstin, #68): Suricata HIGH auto-incident creation, duplicate guard, security_alert_id FK, service account svc_suricata (pre-provisioned in 03_users.sql). 10/10 tests. ✅ APPROVE
- Critical finding: PR #105's service account concern resolved — svc_suricata UUID 00000000-0000-0000-0000-000000000001 already seeded in 03_users.sql with NATIONAL_ANALYST role.
- FRS gap closures: M6-G (XAI narratives), M6-F (Suricata auto-incident), M9 (Prometheus monitoring partial), M4 (incident workflow fixes).
- Merge order: #102 → #104 → #103 → #105
- Index updated: total pages 13 → 18

## [2026-05-19] update | analyst incident detail page full redesign (working tree)
- `src/frontend/src/app/dashboard/analyst/incidents/[id]/page.tsx` — complete UI overhaul (+597/-617 lines, 935 total):
  - **Page header**: ref-number title, status/type/alarm icon badges, location line, styled export buttons
  - **QuickStats bar**: 4 KPI tiles (Response Time, Est. Damage, Structures Hit, Families Hit) with accent colors + tooltips
  - **SECTION_ICONS map**: semantic icons per section A–H + Wildland
  - **CollapsibleSection** rebuilt: icon container, description subtitle, badge, locked state, full ARIA (`aria-expanded`, `aria-controls`, `role="region"`)
  - **FieldRow** rebuilt: `twocol` mode (2-col grid), `highlight` mode (red text for key metrics), null-safe with "—" fallback
  - **AlarmVisual**: step-by-step timeline with numbered circles + connecting lines for spatial alarm-level encoding
  - **WildlandSection**: locked for STRUCTURAL_AFOR, shows alarm_statuses + assistance_rows tables when WILDLAND_AFOR
  - **SensitiveSection** rebuilt: gradient card gate, per-field blur+reveal eye toggle, "Hide All" button, revealed field counter, lazy-load on user click
  - **EmptyState** component: consistent icon+message no-data state across all sections
  - All numeric fields null-safe: `${value} km`, `${value} sqm`, `${value} ha`, `${value} L`, `formatMoney()`, `formatMinutes()`
- Components all self-contained; no external dependencies beyond existing imports (lucide-react icons, useAuth, api client)
- Branch: `feat/national-analyst-phase5-detail-screens`, uncommitted
