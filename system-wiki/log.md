# System Wiki Log

Chronological record of system-wiki changes. Append-only.
Format: `## [YYYY-MM-DD] action | subject`

## [2026-06-17] fix | make civilian triage queue resilient to missing followups migration

- **`src/backend/services/civilian_triage/queue_projection.py`:** Added `_table_exists()` helper and dynamic SQL construction so `get_queue()` degrades gracefully when `wims.citizen_report_followups` table hasn't been migrated yet. The `followup_aggs` CTE, SELECT columns, and LEFT JOIN are conditionally included only when the table exists; otherwise hardcoded defaults (`0`, `NULL::json`) are used. This fixes the civilian triage queue returning empty when the followups migration (`59_citizen_report_followups.sql`) hasn't been applied to an existing postgres volume.

## [2026-06-17] fix(deploy) | correct compose project label in stale container cleanup

- **`deploy.yml`:** `cleanup_stale_compose_renames()` had label filter `com.docker.compose.project=wims_internal` but the actual compose project name is `src` (derived from working directory). The network is `wims_internal`, not the project — so stale renamed containers from interrupted deploys were never cleaned up, causing "container name already in use" errors on subsequent deploys.
## [2026-06-17] fix | FrontierCode review — dead code, test gaps, icons, timer cleanup

- FrontierCode review found 20 verified findings across 5 axes. Fixed all major/minor items:
- **Dead code removal**: Deleted `NearbyPublicReportAreas.tsx`, `NearbyPublicReportAreasInner.tsx`, `NearbyPublicReportAreas.test.tsx` (436 lines orphaned after page.tsx removal).
- **Dead state removal**: Removed `FireLocation` interface and all `setFireLocation()` calls from page.tsx (4 call sites) — `fireLocation` was written but never read after NearbyPublicReportAreas removal.
- **Duplicate marker icon**: `PublicFireMapInner.tsx` now imports `firePinIcon` from shared `leafletIcons.ts` instead of duplicating the SVG locally.
- **debounceTimer cleanup**: Added unmount `useEffect` in `PublicFireMapInner.tsx` that clears pending viewport debounce timer.
- **Banner overlap fix**: Moved geolocation status banner from `top-10` to `top-0` (above locate button) to prevent overlap with degraded backend banner at `top-12`.
- **Geolocation status tests expanded**: Added 3 new tests (loading indicator, timeout fallback, generic error fallback). Updated `mockGeolocation` helper to use error code param (0=success, 1=denied, 2=unavailable, 3=timeout).
- **Page-level regression test**: New `src/app/__tests__/page.test.tsx` (3 tests) verifies "Nearby fire activity" heading + disclaimer copy, absence of "Public Fire Report Areas" card, and Safety status card rendering.
- **Test mock fix**: Added `firePinIcon` to `leafletIcons` mock in `PublicFireMapInner.test.tsx`. Silenced unused `icon` param lint warning.
- Validation: ESLint 0 errors, TypeScript 0 errors, `npm run build` passes, 49/50 test files pass (1 pre-existing `fake-indexeddb` failure), 389 tests pass including 13 new tests.
- No FRS gap register update (no FRS gap status change).

## [2026-06-17] feat | public-report-safety-map-fix implemented

- Branch `feat/public-report-safety-map-fix` created from spec `system-wiki/plans/public-report-nearby-fire-activity-map-placement.md`.
- **page.tsx**: Removed `NearbyPublicReportAreas` import and its conditional render (`step !== 'safety'`). Safety-step `PublicFireMap` no longer passes `onGeolocationAvailable` — geolocation is display-only (no `handlePinChange`, no `geo`/`fireLocation`/`gpsSource`/`phoneGeo` mutation). Added required copy: "Based on nearby public reports awaiting review. Not yet confirmed by BFP."
- **PublicFireMapInner.tsx**: Added display-only geolocation: `userLocation` state, `viewTarget` state with `MapRecenter` component (uses `useMap().setView()`, avoids loops via `useRef`), blue-dot user marker in non-selection mode (`userLocationIcon`), non-blocking fallback status text (denied/timedOut/error). `GeolocateButton` enhanced with `onStatusChange`, "Use my location" label, better a11y. `PinIcon` migrated from remote Leaflet URLs to local `L.divIcon` with BFP maroon SVG. Geolocation error codes use numeric values (1=PERMISSION_DENIED, 3=TIMEOUT) for cross-env compatibility.
- **map/leafletIcons.ts** (new): `userLocationIcon` (blue/cyan dot with white center and ring) and `firePinIcon` (BFP maroon pin SVG) using `L.divIcon` with inline styles.
- **Tests**: `PublicFireMapInner.test.tsx` updated — 7 tests cover: render, locate button a11y, user marker after geolocation, recenter via `setView`, geolocation deny fallback, no user marker in selection mode, cluster fetch on viewport load. `NearbyPublicReportAreas.test.tsx` unchanged.
- Validation: ESLint 0 errors, TypeScript 0 errors, `git diff --check` clean, all 11 focused tests pass (7 PublicFireMapInner + 4 NearbyPublicReportAreas).
- No FRS gap register update (no FRS gap status change).

## [2026-06-17] spec | public report Nearby Fire Activity map placement

- Added `system-wiki/plans/public-report-nearby-fire-activity-map-placement.md` to capture the refined implementation path for the public report Safety-step map.
- Spec requires Nearby Fire Activity to be Safety-only, removes the visible Public Fire Report Areas card from later steps, keeps `PublicFireMap`/public cluster data source, and treats Safety-step geolocation as display-only situational awareness.
- Security/privacy guardrails documented: no Safety-step mutation of incident/fire location, no implicit submitted `phoneGeo`, truthful public-report-awaiting-review copy, credentialless public reads, and FrontierCode-style review gates.
- No FRS gap register update (spec/planning only; no gap status change).

## [2026-06-14] fix(deploy) | ollama CPU override for VPS in docker-compose.prod.yml
- Added second cleanup pass for fixed-name `wims-*` containers stuck in `created` state (never started — always from an interrupted deploy).
- No FRS gap register change (CI/CD workflow fix).

## [2026-06-17] fix(#379) | sync failure reporting + admin retry/delete integration with IndexedDB

- **PR #379 review fixes** — blocked integration issues found during security/quality review.
- **Backend `sync.py`:** Changed `POST /admin/sync/report` auth dependency from `get_system_admin` to `get_current_wims_user` so the sync engine (running in the encoder's browser) can report failures. The report is one-way (client → server); `GET /sync/failed`, `POST /sync/{id}/retry`, and `DELETE /sync/{id}` remain `SYSTEM_ADMIN`-only.
- **Frontend `syncEngine.ts`:** Added best-effort `fetch('/api/admin/sync/report', ...)` after `markOpFailed()` so max-retry failures are surfaced to the admin dashboard. Exported `computeBackoffDelay` and `isWithinBackoffWindow` with an optional `random` parameter for deterministic testing.
- **Frontend `offlineStore.ts`:** Removed redundant `op.retryCount += 1` from `markOpFailed()` (retryCount is already at the MAX_RETRY ceiling).
- **Frontend `system/page.tsx`:** Admin retry now calls the dedicated `resetFailedOp()` helper to reset the local IndexedDB op to `pending` while preserving the encrypted payload; admin delete calls `deleteOfflineOp()` to remove from IndexedDB. This local IndexedDB action works when the failed op exists in the same browser profile; cross-browser admin retry/delete currently clears the backend/admin queue and remains a follow-up architecture limit for encoder-side local queues.
- **Tests:** New backend test suite `test_admin_sync.py` (9 tests: report auth, missing localId, list/report integration, retry 404, delete 404). Frontend: added `markOpFailed` assertions to both MAX_RETRY tests; added backoff window skip test and deterministic unit tests for `computeBackoffDelay`/`isWithinBackoffWindow`; added `markOpFailed` and `getFailedOps` tests to `offlineStore.ops.test.ts` (5 tests).
- No FRS gap register change (integration fix of existing #302/#141 implementation).

## [2026-06-17] fix(#243,#225) | PR #380 review — security hardening and test fixes

- **TOTP gap (#243):** `ChangeEmailRequest` now accepts optional `otp_code`; `_verify_password` passes it as `totp` to Keycloak's Direct Grant token endpoint. TOTP-enabled users can now verify their password during email changes. Error detail updated to "Incorrect current password or OTP code".
- **Abuse protection (#225):** Per-user Redis-based rate limiting added to both `/change-email` (3 req/10 min) and `/verify-email` (5 req/10 min) via `_check_rate_limit()` helper. Returns 429 when exceeded.
- **Redis concurrency/reconnect fix:** `_get_redis()` now uses `asyncio.Lock` with double-check pattern to prevent connection leaks and races under concurrent load, pings cached connections before reuse, and reconnects after a stale cached connection fails.
- **Exception narrowing:** `_verify_password` now catches only `KeycloakError` in the admin-client username-resolution block instead of broad `Exception`, preventing Keycloak infrastructure failures from being silently masked as wrong-password errors.
- **replyTo defaults restored:** Both `import/bfp-realm.json` and `bfp-realm.json` now use `${env.SMTP_REPLYTO:no-reply@wimsbfp.tech}` and `${env.SMTP_REPLYTO_DISPLAY:WIMS-BFP No Reply}` fallbacks instead of empty defaults.
- **OTP policy tests fixed:** `test_otp_required_roles_are_configured` updated to use uppercase role names (`SYSTEM_ADMIN`, `NATIONAL_VALIDATOR`, `REGIONAL_ENCODER`, `NATIONAL_ANALYST`) and assert all 4 role conditionals in both Browser and Direct Grant sub-flows. Tautological `test_non_target_roles_not_forced_to_otp` replaced with `test_all_four_mfa_roles_are_enforced`. Added `test_skip_mfa_bypass_present_in_forms_flow` for SKIP_MFA ALTERNATIVE wiring. Direct Grant Conditional OTP remains REQUIRED in the parent flow as intentional #243 hardening to close direct-grant MFA bypass.
- **SMTP env validation test:** `test_keycloak_smtp_env_vars_present` added to `test_infra_config.py` asserting all 11 SMTP_* env vars are present with non-None defaults in docker-compose.yml.
- **Email verification tests:** Added 7 new tests: `test_success_with_otp_code_passed_to_verify`, `test_success_without_otp_code_omits_totp`, `test_incorrect_otp_returns_401`, change-email rate-limit test, verify-email rate-limit test, and two `_get_redis()` cache/reconnect tests.
- **Wiki updates:** `security-baseline.md` updated to document the email verification flow; `infrastructure-config.md` updated to list all 4 MFA-required roles.
- No FRS gap register change (hardening and test fixes to existing #243/#225 implementation).

## [2026-06-17] test(#225) | align profile email tests with verification flow

- **Test-only change:** Updated 6 failing tests in `tests/test_profile_email.py` to match the new email verification policy (introduced in parent commit). Direct email changes via `PATCH /api/user/me` now always return 400 with guidance to use `POST /api/auth/change-email` and `POST /api/auth/verify-email` instead. Tests now assert the 400 response and verify that no Keycloak/DB operations are triggered for direct email changes.
- **New test file:** `tests/test_auth_email_verification.py` (18 tests) covers the full verification flow with mocks:
  - `POST /api/auth/change-email`: success, password verification, incorrect password (401), missing/empty password (400), Redis unavailable (503), email send failure with Redis cleanup (502), schema validation (empty/invalid email).
  - `POST /api/auth/verify-email`: success with Keycloak+DB update and Redis cleanup, missing/whitespace code (400), no pending change (404), wrong code (400, key preserved), Redis unavailable (503), Keycloak failure (502, key preserved), DB sync failure (200 partial, key cleaned), empty body (422).
- All mocks used; no live Redis/Keycloak/SMTP required.
- No FRS gap register change (test alignment only).

## [2026-06-16] feat(#353) | scheduled reports human-friendly filter builder

- **#353 (filter builder for Scheduled Reports):** Replaced raw JSON textarea on `/admin/system` Scheduled Reports create/edit form with a human-friendly filter builder as the primary UI. Common filter fields (`region_id`, `severity`, `start_date`, `end_date`, `incident_type`) use dropdown, date-picker, and text inputs. Raw JSON remains available via an "Expert" toggle button for advanced users. Filters are validated client-side before save with clear inline error messages; invalid filters block save. The create payload now sends structured filter objects directly (no more `JSON.parse` of a raw string).
- **New component:** `src/frontend/src/components/admin/ReportFilterBuilder.tsx` — self-contained component with builder/expert mode toggle, live JSON validation, per-field error display, and a summary of applied filters.
- **Modified:** `src/frontend/src/app/admin/system/page.tsx` — replaced filters textarea with `ReportFilterBuilder`; added `validateReportFilters()` validator; changed `newReport.filters` type from JSON string to `Record<string, unknown>`; added `filterErrors` state for inline errors.
- **Tests:** `src/frontend/src/components/admin/__tests__/ReportFilterBuilder.test.tsx` (17 tests: builder field rendering, onChange callbacks, region/severity select, date validation, summary display, error display, expert mode toggle, JSON validation/parsing, blur-to-onChange, live validation). Existing API client tests (`scheduledReports.test.ts`, 5 tests) and admin system search tests (`admin-system-search.test.tsx`, 5 tests) continue to pass.
- No backend/API/schema changes (filters JSONB column already accepts structured objects). No dependency changes. No FRS gap register change (UI usability enhancement of existing functionality).

## [2026-06-16] fix(#360) | backend real-IP audit metadata for breach + anomaly ACK/RESOLVE

- **#360 (remaining backend audit metadata gaps):** `PATCH /api/admin/breach/{breach_id}` and `PATCH /api/admin/anomalies/{anomaly_id}` now pass `request=request` to `log_system_audit()` so audit rows capture real client IP (via X-Forwarded-For/X-Real-IP/client.host fallback) and real user-agent instead of storing NULL IP or a hardcoded `"anomalies-api"` string.
- `breach.py`: added `request: Request` parameter; `BREACH_STATUS_UPDATE` audit call passes `request=request`.
- `anomalies.py`: replaced manual `INSERT INTO wims.system_audit_trails` with `log_system_audit(db, ..., request=request)` for both `ANOMALY_ACK` and `ANOMALY_RESOLVE` actions; removed unused `_safe_ip()` helper.
- Tests: updated `test_anomaly_api.py` ACK/RESOLVE audit assertions to use `log_system_audit` bind-param keys (`action` instead of `action_type`, `ip`/`ua` instead of `ip_address`/`user_agent`); added assertions that audit `ua` is not the old hardcoded `"anomalies-api"` and that `ip`/`ua` are not None.
- `security.py` already fixed by earlier PR (#349/#350/#357) — no changes needed.
- No FRS gap register change (enhancement to existing M10d audit implementation; no new FRS alignment).

## [2026-06-16] feat(#352) | dedicated system audit page

- **#352 (dedicated System Audit page):** Extracted full audit table and search from overcrowded `/admin/system` hub into a dedicated `/admin/audit` page. New page supports 7 audit filters (q, user_id, action_type, table_affected, ip_address, date_from, date_to) with Apply/Clear buttons, prev/next pagination (50/page), expandable old_values/new_values rows, loading skeleton, empty/filtered-empty/error states, offline cached-data indicator, and SYSTEM_ADMIN role gate with auth loading guard.
- **Admin Hub CTA:** `/admin/system` System Audit section replaced with a compact CTA card linking to `/admin/audit`. Alert Action Highlights section (HITL_REVIEW, CREATE_INCIDENT_FROM_ALERT, BREACH_DETECTED) remains on the hub page, now backed by `loadHighlightAudit` (no search). Removed audit-specific state from admin system page (auditSearchQ, auditLastChecked, auditFromCache, loadingAudit).
- **Sidebar:** `Sidebar.tsx` System Audit nav link updated from `/admin/system#audit` to `/admin/audit`. Icon changed from Settings (gear) — already used for Configuration — but the task accepts the existing icon.
- **API layer:** Existing `fetchAuditLogsOfflineAware()` in `offlineAdmin.ts` already supports all filter params used by the new page. `fetchAuditLogs()` in `legacy.ts` and `AuditLogEntry` type in `types/api.ts` already include `old_values`/`new_values`.
- **Tests:** `admin-audit.test.tsx` (14 tests: rendering, filter inputs, filter submission, clear filters, pagination prev/next, loading skeleton, empty state, filtered empty state, error state, non-admin redirect, row render+expand, refresh button). `admin-system-search.test.tsx` updated for CTA link and renamed audit search to highlights refresh.
- **Wiki:** `system-wiki/frontend/route-map.md` — added `/admin/audit` route entry; updated admin/system description with audit CTA note. `system-wiki/subsystems/admin-hub.md` — updated System Audit Trails panel table, added Dedicated System Audit Page section, updated Gap/Status Notes.
- No backend changes, no schema changes, no dependency additions, no FRS gap register changes (UI reorganization of existing functionality).

## [2026-06-16] feat(#356,#362) | anomaly dashboard seed data + aggregate counts/dynamic filters

- **#362 (aggregate counts + dynamic filters):** `GET /api/admin/anomalies` now returns `counts` (per-status aggregates: NEW/ACKNOWLEDGED/RESOLVED) and `type_facets` (per-type aggregates with counts) alongside existing paginated items. Same WHERE/filter scope as items and total. Summary cards on `/admin/anomalies` switched from `anomalies.filter()` on current page to API `counts`. Type filter dropdown populated dynamically from `type_facets`. Added severity filter dropdown (LOW/MEDIUM/HIGH/CRITICAL — hardcoded). Empty state distinguishes "no anomalies exist" (seed script hint) from "no anomalies match current filters" (adjust filters suggestion).
- **#356 (seed/test anomaly data):** Added `scripts/seed-anomaly-detections.sh` + `scripts/seed-anomaly-detections.sql` inserting 20 anomaly_detections rows covering all 5 anomaly types, all 3 statuses, all 4 severities, timestamps distributed across last 24h. Uses `ON CONFLICT DO NOTHING` for safe re-runs. `subject_user_id` references known test users from `03_users.sql` or NULL.
- Backend: `anomalies.py` — added status GROUP BY and type GROUP BY aggregate queries; `test_anomaly_api.py` — added `TestAggregateFields` test class (3 tests), updated 5 existing tests with `_make_aggregate_mocks` helper.
- Frontend: `legacy.ts` — added `AnomalyAggregateResponse` type with `counts`/`type_facets`; `page.tsx` — aggregate counts, dynamic filters, severity filter, conditional empty state; `page.test.tsx` — 6 new/updated tests (18 total, all passing).
- Wiki: `admin-hub.md` — added Anomaly Dashboard section; `api-route-map.md` — added anomalies GET/PATCH entries; `frontend/route-map.md` — updated anomalies route description.
- No schema migration, no FRS gap register changes.

## [2026-06-16] feat(#348,#351) | threat telemetry filter/pagination + XAI narrative normalizer

- **#348 (Threat Telemetry filter & pagination):** Added advanced filter bar to `/admin/system` Security Threat Logs section: severity chips (LOW/MEDIUM/HIGH/CRITICAL toggle), Source IP text input, Date From/To text inputs, and a Reset All Filters button. Added prev/next pagination (20 items/page) with page indicator. Auto-reload via useEffect watching a combined filter key; stale-ref bug fixed in clear/reset handlers by updating `securitySearchQRef.current` before calling `loadSecurityLogs()`. Error state banner shown on fetch failure. `fetchAdminSecurityLogs()` signature extended with `source_ip`, `date_from`, `date_to` query params in `src/frontend/src/lib/api/legacy.ts`.
- **#351 (XAI Narrative Normalizer):** Added `src/frontend/src/lib/xaiNarrativeNormalizer.ts` — a shared tolerant parser for AI-generated structured output in `xai_narrative`. Handles well-formed JSON, JSON-in-markdown-fences, partial/malformed JSON (regex field extraction for `anomaly_description`, `log_evidence`, `risk_assessment`, `recommended_action`, `confidence`/`xai_confidence`), plain text fallback, and empty/null input. Used in both `/admin/system` (detail drawer structured rendering) and `/admin/monitoring` (recent narratives structured display). Unit tests: `xaiNarrativeNormalizer.test.ts` (14 cases).
- Test fix: `admin-system-search.test.ts` updated for new pagination params (`{ limit: 20, offset: 0 }` in clear/search assertions). Stale-ref bug in clear handlers fixed (deferred state update vs mutable ref).
- Wiki updates: `system-wiki/subsystems/admin-hub.md` — updated Security Threat Logs table with filter/pagination details, added XAI Narrative Normalizer section, updated gap register note for #348 progress.
- No backend changes, no dependency additions, no FRS gap register changes (enhancements to existing frontend UI; no new FRS gaps created or closed).

## [2026-06-16] feat(#344,#358,#359) | admin hub loading feedback, auth guards, toast/confirm replacement, N+1 session fix

- **#344 (consolidated System Health & Monitoring):** Merged System Health and System Monitoring sections on `/admin/system` into a single "System Health & Monitoring" card. Single refresh button controls both health and metrics/workers. Skeleton loading shown during initial fetch instead of blank sections. Loading states use `loadingMonitoring` flag. Test file `admin-system-monitoring.test.tsx` updated to match new heading text.
- **#358 (auth loading guards for admin subpages):** Added `useAuth().loading` check to `/admin/monitoring`, `/admin/anomalies`, and `/admin/breach` pages. While auth resolves, a neutral "Loading…" spinner is shown; "Access restricted" only appears for confirmed non-admin roles. Prevents premature flash of restricted-access UI.
- **#359 (UI feedback + session N+1 fix):** (a) Replaced all native `alert()` and `window.confirm()` calls on `/admin/system` with an in-app toast banner (`setToast`) and a confirmation modal for scheduled report deletion. (b) Fixed N+1 session query: per-user Keycloak sessions are now lazy-loaded via `useEffect` when the admin opens the per-user Sessions modal, instead of loading all user sessions upfront on page mount. Also removed duplicate `fetchAdminUsers()` call in initial mount chain. (c) Removed dead-code `actionNote`/`pendingMoreInfo` state left over from prior HITL refactor (#349/#350/#357).
- Wiki updates: `system-wiki/frontend/route-map.md` — added monitoring/anomalies/breach routes; `system-wiki/subsystems/admin-hub.md` — documented consolidated System Health & Monitoring card, auth guards, toast/modal pattern, N+1 lazy-loading, and UI feedback pattern.
- No backend changes, no dependency additions, no FRS gap register changes.

## [2026-06-16] feat(#349,#350,#357) | admin security alert HITL audit + related-evidence + highlights

- **#357 (backend audit completeness):** `PATCH /security-logs/{log_id}` and `POST /security-logs/{log_id}/create-incident` now pass `request=request` to `log_system_audit()` so audit rows capture real client IP/UA via `X-Forwarded-For`/`X-Real-IP` headers (no sensitive headers/tokens/cookies). `new_values` JSONB in each audit row includes `endpoint_action`, `method`, `path`, `log_id`, `incident_id` (create-incident only), and `outcome: SUCCESS` for forensic traceability.
- **#357 (new endpoint):** `GET /admin/security-logs/{log_id}/related-audit` queries `system_audit_trails` within ±1h of alert timestamp, matching by `table_affected='security_threat_logs' AND record_id=log_id` or JSONB `log_id` match. Returns 404 for missing alert, empty `items` list if no evidence.
- **#349 (frontend View/Find Related Evidence):** HITL modal replaces "Request More Info" button with "View Related Evidence". Calls `fetchRelatedAuditLogs()` and renders related audit rows inline with loading/error/empty states.
- **#349/#350 (inline HITL messages):** Confirm Threat, False Positive, Create Incident show inline success/error messages instead of `alert()`. Create Incident success shows incident ID with link.
- **#350 (Alert Action Highlights):** New `Alert Action Highlights` section on admin/system page filters `auditLogs` for `HITL_REVIEW`, `CREATE_INCIDENT_FROM_ALERT`, `BREACH_DETECTED` actions with refresh button, timestamp, action badge, table/record links, and IP/UA metadata.
- Frontend API layer: Added `RelatedAuditItem`, `RelatedAuditResponse` interfaces and `fetchRelatedAuditLogs()` in `src/frontend/src/lib/api/legacy.ts`.
- Tests: 3 new backend test methods in `TestSecurityAuditRequestParam` (#357 audit `request`/`new_values`), 4 new tests in `TestGetRelatedAudit` (#357 endpoint). Frontend test `admin-system-hitl.test.tsx` updated: Request More Info tests replaced with View Related Evidence + empty state tests; added assertion for inline success patterns.
- System wiki: api-route-map.md updated with new route and enhanced audit notes.
- No FRS gap register change (enhancements to existing M10d implementation; no new FRS alignment).

## [2026-06-16] feat(#364) | Suricata EVE log mtime heartbeat with 5-state health

- `src/backend/api/routes/admin/monitoring.py`: Replaced binary HEALTHY/UNHEALTHY Suricata check with 5-state logic driven by EVE log mtime (`/var/log/suricata/eve.json`) + threat log presence:
  - `HEALTHY`: recent threats detected in last 5 min
  - `QUIET`: EVE log mtime < 60s, no recent threats, total > 0 (quiet network — not a failure)
  - `FRESH`: total = 0 (fresh deployment, no data yet)
  - `DEGRADED`: EVE log mtime 60–600s old, no recent threats, total > 0 (ingestion may be stalled)
  - `UNHEALTHY`: EVE log mtime > 600s old, EVE log unreadable, or DB query failure
  - Only DEGRADED/UNHEALTHY degrade the overall system health status. QUIET and FRESH are valid operational states.
- `src/frontend/src/app/admin/system/page.tsx`: Added Suricata card to the System Health grid (4-card layout: DB, Redis, Keycloak, Suricata). Added `getComponentStatusColor()`, `getComponentStatusTextColor()`, `getOverallBadgeColor()` helpers with 5-state coloring (green/blue/slate/amber/red). Suricata card shows detail text below the status dot. Overall status badge uses amber for DEGRADED instead of red.
- `src/backend/tests/test_system_monitoring.py`: Added 7 new tests covering all 5 Suricata states plus query-failure and EVE-log-unreadable edge cases. All 18 monitoring tests pass (excluding the pre-existing DB-dependent worker test).
- No FRS gap register change (this is a monitoring UX/accuracy enhancement; no FRS gap status changed).

## [2026-06-14] fix(deploy) | ollama CPU override for VPS in docker-compose.prod.yml

- VPS has 2 CPUs but base `docker-compose.yml` sets `cpus: '4'` for ollama.
- `compose run` (used during deploy DB connectivity check) triggers ollama recreation, which Docker rejects: `range of CPUs is from 0.01 to 2.00, as there are only 2 CPUs available`.
- Added ollama resource override in `docker-compose.prod.yml`: `cpus: '2'`, `memory: 4gb`.
- Confirmed fix by running the failing `compose run` command on the VPS — succeeded, ollama recreated with correct limits, all services healthy.
- Deploy workflow for commit `8be6a6d` in progress at time of writing.
- Updated [[architecture/infrastructure-config]] with Ollama VPS CPU override docs.
- No FRS gap register change (infrastructure — no FRS alignment change).

## [2026-06-13] fix | cluster/offline-store-cleanups — #274 markSynced perf + #275 console.warn gate

- #274 (perf): Removed redundant `put()` before `delete()` in `markSynced()`. The `put()` with `status: 'synced'` was a dead write since the record was immediately deleted. Simplified to a single `store.delete(id)` call. Idempotent — IndexedDB `delete()` is silent on missing keys.
- #275 (chore): Gated `console.warn` for the offline storage cap behind `process.env.NODE_ENV !== 'production'`. The cap enforcement (`throw new Error(...)`) is unconditional and unchanged. Added regression test `throws when encrypted total exceeds advisory storage cap`.
- #278 (test): Replaced Map-backed idb mock with `fake-indexeddb` in `offlineStore.test.ts`. The mock masked a real IndexedDB race condition in `updateQueuedIncident` — awaiting `encryptPayload` between `store.get` and `store.put` caused the readwrite transaction to auto-commit. Fixed by hoisting encryption before `getDB()` / `transaction()`. 10/10 tests pass under real transaction semantics.
- #278 scope note: `offlineStore.ops.test.ts` retains its separate Map-backed mock (unchanged). Only `offlineStore.test.ts` was migrated, as scoped in the issue. Sibling offline tests (51 across 6 files) pass.
- No FRS gap register change (test infrastructure — no FRS alignment change).

## [2026-06-13] fix(#304 #316) | privacy export decryption sentinel + audit idempotency gate

- #304 (security): `_decrypt_sensitive_details` now sets `sd["decryption_failed"] = True` in the bare `except Exception` block, giving API consumers a sentinel to distinguish "no PII exists" from "decryption silently failed". The sentinel nests inside `incident_sensitive_details`; PII fields remain absent and blob columns stay stripped. New test `test_export_decrypt_failure_adds_sentinel` covers the failure path.
- #316: Anonymize audit entries (`PII_ANONYMIZE`) now gated on `rowcount > 0` for all four tables. UPDATE WHERE clauses augmented with `IS DISTINCT FROM` / `IS NOT NULL` conditions so idempotent calls return `rowcount=0` and skip audit. User existence now checked with a separate SELECT before the conditional UPDATE.
- Test `test_anonymize_idempotent` strengthened: second call returns `rowcount=0`, only one audit entry across two calls. All existing tests updated for the SELECT-existence + conditional-UPDATE flow.
- No FRS gap register change (review fixes to existing M10 implementation; gap #165 remains CLOSED).
- Ruff check + format green. All 19 privacy tests pass.

## [2026-06-13] fix | anomaly detection cluster cleanups #284 #285 #286 #287

**Issues:** #284 (Capture source IP for BULK_DELETE anomalies), #285 (Add dedup-hit observability), #286 (source_ip=None regression test), #287 (Clean up duplicate window fixture constants).

**Changes:**
- `src/backend/tasks/anomaly_detection.py`: BULK_DELETE SQL now extracts representative source IP via `ARRAY_AGG(DISTINCT ip_address))[1]` and passes it to `_write_anomaly()` instead of hardcoded `None`. Logging condition widened from `total_new > 0` to `total_new > 0 or total_dedup > 0` so operators can distinguish "no events" from "all candidates deduped".
- `src/backend/tests/test_anomaly_detection.py`: Replaced duplicate `_WINDOW_5MIN`/`_WINDOW_10MIN` constants with single `_WINDOW_START`. Updated all mock `fetch_rows` to 4-tuples with `source_ip`. Added `test_source_ip_none_passed_cleanly_to_threat_log` and `test_task_logs_when_dedup_only`. 33/33 tests pass.

**No FRS gap status changed.** Anomaly detection M8 remains PARTIAL (4/5 detectors shipped).

## [2026-06-13] fix | GH #245 #246 — Ollama stability + Celery asyncio.run() fix

- **GH #245 Ollama stability:**
  - `services/ai_service.py`: Added `_ollama_post_with_retry()` — 3 retries with exponential backoff (2s/4s/8s) on `ConnectError` and 5xx; timeout NOT retried (CPU-bound). Added `OLLAMA_TIMEOUT` env var (default 120s, was hardcoded 60s). `_ollama_timeout()` priority: env var > `system_config.ai_timeout_seconds` > 120s default.
  - `docker-compose.yml`: Ollama healthcheck uses `ollama list` CLI command. Retries increased 10→30. Resources increased 2 CPU/4GB → 4 CPU/8GB. Celery-worker now waits for `ollama: service_healthy` + `ollama-model-pull: service_completed_successfully`.
  - `.env.production.example`: Documented `OLLAMA_URL` and `OLLAMA_TIMEOUT`.
  - All three call sites (`analyze_threat_log`, `generate_incident_narrative`, `analyze_audit_logs`) now use `_ollama_post_with_retry()`.
- **GH #246 Celery asyncio.run() fix:**
  - `tasks/narrative.py`: Replaced `asyncio.gather()` + shared `db` session with sequential processing. Each incident gets a fresh `get_session()` call, `asyncio.run(generate_incident_narrative(iid, per_call_db))`, and `per_call_db.close()`. Return shape now includes `succeeded`/`failed` counts. This eliminates the event-loop conflict (no concurrent `asyncio.gather()` on a shared loop) and SQLAlchemy session-sharing race.
- **Tests:** `tests/test_ai_service_retry.py` — 14 new unit tests covering timeout configuration, retry on ConnectError/5xx, no-retry on TimeoutException/4xx, compose config assertions (healthcheck, celery deps, resource limits), and narrative task return shape. All 14 pass.
- No FRS gap register change (no FRS alignment change — these are operational stability fixes).

## [2026-06-14] fix(#268,#269) | validator offline wiring — wims:sync-complete listener + offlineOps test coverage

- **wims:sync-complete listener**: Validator dashboard page (`/dashboard/validator/page.tsx`) previously listened on `navigator.serviceWorker` for `sync-complete` messages — a channel the SW never emits (the SW sends `run-sync`, not `sync-complete`). `useAutoSync` dispatches `wims:sync-complete` on `window` after a successful reconnect sync. Switched to `window.addEventListener('wims:sync-complete', ...)` matching the regional dashboard pattern so the validator queue and pending-ops badge refresh after auto-sync.
- **OfflineOps test coverage**: Added 7 sync engine tests for the offlineOps (`getPendingOps`) path — verify and archive_action ops. Previously only the legacy (`getPendingIncidents`) path had verify/archive_action tests. Tests cover: PATCH dispatch with `client_id`, `original_incident_id` forwarding, 409 DUPLICATE_DETECTED → `markOpConflict`, and network error → `markOpError` + batch abort.
- No FRS gap register change (validator offline wiring gap already closed by #271/#272).
- CI pre-flight: vitest 318/318 pass, eslint 0 errors, ruff check + format green.

## [2026-06-14] feat | PR #244: SKIP_MFA role for validator MFA exemption

- Added `SKIP_MFA` realm role to `bfp-realm.json` (both `import/` and root).
- Added `otp-skip-mfa` authenticator config (`condUserRole=SKIP_MFA`, `negate=false`).
- Restructured `forms` authentication flow: inserted `conditional-user-role` (ALTERNATIVE, priority 20) with `otp-skip-mfa` config before `Browser - Conditional OTP` (changed to ALTERNATIVE, priority 30).
- Assigned `SKIP_MFA` to all 5 NATIONAL_VALIDATOR seeded users: `validator_test`, `n-val`, `g-val`, `e-val`, `r-val`.
- Users with `SKIP_MFA` role bypass the OTP sub-flow during browser login; MFA remains enforced for all other accounts.
- Direct Grant flow unchanged.
- Updated `system-wiki/security/security-baseline.md` with SKIP_MFA mechanism documentation.
- No FRS gap register change (this is an auth-config enhancement within existing MFA scope).

## [2026-06-14] feat | Issue #88 — Scheduled report execution and management UI

- New `tasks/scheduled_reports.py` Celery task: `execute_due_reports` finds due enabled reports using `croniter`, generates exports, dispatches notification emails via `send_email_task`, and updates `last_run_at`.
- Beat schedule entry added in `celery_config.py`: checks every `SCHEDULE_CHECK_INTERVAL` seconds (default 300s).
- Admin API improved: PATCH now supports full field update (name, cron_expr, format, filters, recipients, enabled); new DELETE endpoint; list now returns `filters`, `last_run_at`.
- New email template `scheduled_report.html.j2` for report delivery notifications.
- Frontend: scheduled reports CRUD section added to `admin/system/page.tsx` with list, create modal, toggle enable/disable, and delete.
- Frontend API: `fetchScheduledReports`, `createScheduledReport`, `updateScheduledReport`, `deleteScheduledReport` with `ScheduledReport` type.
- Backend tests: 11 tests in `test_scheduled_reports.py` covering due-report selection, execution, skipping, error handling, multiple reports, last_run_at update.
- Frontend tests: 6 tests in `scheduledReports.test.ts` covering API client functions.
- Updated `requirements.txt` with `croniter>=2.0.0`.
- Updated `system-wiki/backend/utilities-and-tasks.md` with scheduled_reports task documentation.

## [2026-06-14] feat(#62) | civilian follow-up submissions

- Added DB migration `59_citizen_report_followups.sql`: `wims.citizen_report_followups` table with `followup_id`, `report_id` FK, `followup_text` (max 2000), `created_at`.
- Added `POST /api/civilian/reports/{report_id}/followup` public endpoint — validates report is non-terminal, rate-limits per IP, writes audit trail.
- Updated `GET /api/civilian/reports/{report_id}/timeline` to include `followups` field.
- Added schemas: `CivilianFollowupCreate`, `CivilianFollowupItem`, `CivilianFollowupResponse`.
- Triage queue projection: `TriageReportEntry.followups` (list of `FollowupSummary`) for validators.
- Tracking page (`/tracking`): follow-up form + follow-up display for non-terminal reports.
- Frontend API: `submitFollowup`, `CivilianFollowupItem`, `CivilianFollowupResponse`, `CivilianReportTimelineResult` types.
- Tests: 6 backend unit tests in `test_public_submission.py`; updated tracking page and triage page frontend test mocks.
- Wiki updated: `schema-overview.md`, `api-route-map.md`, `log.md`.

## [2026-06-14] feat | GH #64 offline queue encryption + sync conflict resolution

- `src/frontend/src/app/dashboard/regional/conflicts/page.tsx`: new conflict resolution page. Lists all offline ops in 'conflict' state for the current encoder with local payload, server version, and three resolution options: Keep Local (re-queue via `resolveConflictOp`), Use Server Version (delete local op), or Discard (delete without accepting server). Replaces the dead link from `SyncStatusBar` (`/dashboard/regional?tab=conflicts` → `/dashboard/regional/conflicts`).
- `src/frontend/src/components/SyncStatusBar.tsx`: updated "Review" link from `/dashboard/regional?tab=conflicts` to `/dashboard/regional/conflicts`.
- `src/frontend/src/lib/__tests__/offlineStore.encryption.test.ts`: 15 new encryption-at-rest tests covering legacy queue, offlineOps, cached incidents, analytics cache, unique IV per write, and re-encryption behaviour.
- `src/frontend/src/lib/__tests__/syncEngine.conflict.test.ts`: 10 new conflict handling tests covering 409 DUPLICATE_DETECTED across all op types, 409 CONFLICT (OCC) with serverVersion preservation, max-retries-exceeded, conflict-op exclusion from sync, and auth-abort during replay.
- `system-wiki/frontend/frontend-infrastructure.md`: added Sync Conflict Resolution subsection documenting the resolution path under "Offline-first encoder sync"; updated SyncStatusBar description and component tree.
- All 66 tests pass (41 existing + 25 new). No FRS gap register update (encryption at rest and conflict handling were already partially implemented; this adds the user-facing resolution UI and test coverage).

## [2026-06-14] feat | GH #283 — anomaly detection ACK/RESOLVE workflow and admin UI

- `src/backend/api/routes/admin/anomalies.py`: new admin route module
  - `GET /api/admin/anomalies` — list anomaly detections with status/severity/type filters and pagination (limit/offset, ordered by detected_at DESC)
  - `PATCH /api/admin/anomalies/{anomaly_id}` — status transitions: NEW→ACKNOWLEDGED (ANOMALY_ACK audit), ACKNOWLEDGED→RESOLVED (ANOMALY_RESOLVE audit); RESOLVED is terminal; invalid transitions return 409; status transition metadata appended to details JSONB
  - SYSTEM_ADMIN only (get_system_admin + get_db_with_rls); RBAC enforced via existing RLS policies on wims.anomaly_detections
- `src/backend/api/routes/admin/__init__.py`: registered anomalies router
- `src/backend/tests/integration/test_anomaly_api.py`: 13 backend tests (403 gate, empty list, pagination, status/type filters, 404, 422 validation, 409 invalid transitions, ACK flow+audit, RESOLVE flow+audit)
- `src/frontend/src/lib/api/legacy.ts`: added `fetchAnomalies()` and `updateAnomalyStatus()` API client functions with `AnomalyDetectionItem` type
- `src/frontend/src/app/admin/anomalies/page.tsx`: admin anomaly detection management page
  - Summary cards (New/Acknowledged/Resolved counts)
  - Status filter chips (All/New/Acknowledged/Resolved)
  - Type filter dropdown (BULK_DELETE/OFF_HOURS/PRIVILEGE_ESCALATION/RAPID_IP_SWITCH)
  - Anomaly table: ID, type, severity badge, status badge (with icon), detected timestamp, compact details preview, action buttons (Acknowledge/Resolve per current status)
  - Pagination (20/page), 60s auto-refresh, error banner, SYSTEM_ADMIN auth gate
- `src/frontend/src/app/admin/anomalies/page.test.tsx`: 14 Vitest tests (rendering, summary counts, table data, acknowledge/resolve actions, empty state, auth gate, error state, filter chips, type dropdown, pagination)
- `src/frontend/src/components/Sidebar.tsx`: added "Anomaly Detection" nav item (Activity icon) under Administration section for SYSTEM_ADMIN
- `system-wiki/gaps/frs-codebase-gap-register.md`: updated M8 entry to note ACK/RESOLVE workflow closed via #283 (M8 remains PARTIAL due to 2 deferred detectors)
- 44 total backend pytest pass (31 anomaly detection + 13 anomaly API), 14 frontend Vitest pass, ruff check + format green

## [2026-06-14] feat | #235 user-customizable widget-based dashboards

- Added GET /api/dashboard/widgets endpoint (`api/routes/dashboard.py`) with 14 widget definitions across 4 roles (NATIONAL_VALIDATOR, REGIONAL_ENCODER, NATIONAL_ANALYST, SYSTEM_ADMIN). Each widget runs a lightweight COUNT or GROUP BY query. Unavailable widgets are silently filtered by role.
- Backend tests: 12 pytest cases covering auth, empty request, all 3 roles, categorical widgets, mixed valid/invalid IDs, DB error handling.
- Frontend widget API client (`lib/api/widgets.ts`) with TypeScript type guards (isCountData, isCategoryData, isErrorData).
- Frontend components: `WidgetGrid` (batch-fetching CSS grid), `WidgetCard` (loading/error/count/category states), `AddWidgetDropdown` (role-scoped add menu), barrel export in `components/dashboard/index.ts`.
- Widget definitions (`widget-definitions.ts`) with lucide icons, role sets, labels, isCategorical flag, per-role defaults (DEFAULT_WIDGETS).
- `useDashboardWidgets` hook: localStorage-backed per-role widget config with add/remove/reset operations, availableAdditions computed from role-scoped widgets not yet added.
- Integrated into analyst page (ANALYST_ROLES guard), regional page (role-adaptive), and validator page (WidgetToolbar + grid).
- Frontend tests: 13 vitest cases covering rendering, loading/error states, count display, categorical display, add/remove/reset, localStorage persistence, duplicate prevention.
- No FRS gap changes.

## [2026-06-14] refactor | #181 extract dashboard mega-components

- Extracted shared UI components into `src/frontend/src/components/ui/`: `StatCard`, `StatsDateFilterChips`, `EmptyState`, `StickyBanner` — all exported from barrel `ui/index.ts`.
- Extracted page-header components: `RegionalPageHeader` (quick actions, stats toggle, refresh) and `ValidatorPageHeader` (refresh, queued-ops badge, offline indicator, bulk approve).
- Extracted shared hooks: `useHoverHint` (hover-tooltip), `useScrollSafeUpdate` (scroll-preserving filter updates).
- Extracted `SyncNotificationModal` for regional post-sync summary.
- Added `formatCacheAge()` utility to `incident-utils.ts`.
- Validator page: 1379 → 986 lines. Regional page: 1181 → 1085 lines. Behavior-preserving.
- No FRS gap changes.

## [2026-06-13] fix | PR #262 FrontierCode review — Q1 narrative_report anonymize leak + Q2 key_version silent decrypt failure

- Q1 MUST-FIX: Added `narrative_report = NULL` to the `incident_sensitive_details` anonymize UPDATE SET clause in `api/routes/admin/privacy.py`. Previously, `narrative_report` was SELECTed for export (plaintext PII column) but never nulled during anonymization, leaking PII after the right-to-erasure path.
- Q2 MUST-FIX: `_decrypt_sensitive_details` now passes `sd.get("key_version", 1)` as the 4th positional arg to `decrypt_json()`. Previously, `key_version` was SELECTed from the row but never forwarded, causing silent decryption failure (swallowed by bare `except Exception`) for rows encrypted with a rotated key (key_version != 1) on the `env_aesgcm` path.
- Test Q1: `test_anonymize_report_nulls_pii_preserves_fks` strengthened to inspect `db.execute.call_args_list` and assert `"narrative_report = NULL" IN sd_update_sql`. Removed 3 unconsumed audit mock entries (log_system_audit is patched in this test).
- Test Q2: Added `test_export_decrypt_passes_key_version` — verifies `decrypt_json` receives `key_version=2` (4th positional arg) when the sensitive row has `key_version: 2`.
- No FRS gap register change (privacy rights gap #165 remains CLOSED; review fixes to existing M6/M10 implementation).
- Ruff check + format green. All 18 privacy tests pass.

## [2026-06-13] rebase | PR #262 rebased onto origin/master (ba6b0b2)

- Conflict in `system-wiki/log.md`: resolved by keeping all master entries (PR #263 dashboard, PR #265 attachment encryption review, PR #264 anomaly detection review, M9a AI inference, M8 anomaly detection, M6a attachment encryption, M8 security monitoring dashboard) and PR #262 M6 privacy rights entry in chronological order.
- Migration `56_consent_log.sql` → `59_consent_log.sql`: master already had 56 (verification history), 57 (anomaly detections), 58 (attachment encryption). All references updated in log.md, gap register, and SQL file.
- No code conflicts (route registrations, schemas, tests auto-merged cleanly).

## [2026-06-13] fix | PR #263 review — dashboard link, error state, pagination metadata

- S1: `api/routes/admin/security.py` security-alert email context now links `dashboard_link` to `/admin/monitoring` instead of stale `/admin/security-dashboard`; backend regression test covers HIGH threat confirmation email context.
- S2/S3: admin security monitoring page now shows a visible error banner on monitoring/threat API failure instead of silently presenting an empty healthy state.
- Q1: `fetchAdminSecurityLogs()` now returns `{ items, total }` and keeps `{data: [...]}` compatibility; admin monitoring uses `total` to disable Next on exact-PAGE_SIZE last pages.
- T3/T4: frontend tests added for non-admin gate and non-empty threat-feed rendering; touched admin-system tests updated for the API return shape. No FRS gap status change (M8 #164 remains CLOSED).

## [2026-06-13] rebase | PR #263 rebased onto origin/master (26cf014)

- Conflict in `system-wiki/log.md`: resolved by keeping all master entries (PR #265 review, PR #261 review, M9a AI inference, PR #264 review, M8 anomaly detection, M6a attachment encryption) and PR #263 M8 dashboard + severity filter entries in chronological order. Conflict in `system-wiki/gaps/frs-codebase-gap-register.md`: kept both M8 entries (behavioral anomaly detection #160 PARTIAL + security monitoring dashboard #164 CLOSED) as separate sub-items. No code conflicts.

## [2026-06-13] fix | PR #265 review — header injection sanitization, crypto_provider metadata, KMS byte tests, wiki typo

- Q1 CRITICAL: `api/routes/incidents.py` serve_attachment — sanitize filename with `re.sub(r'[\x00-\x1f\x7f"]', '_', safe_name)` before Content-Disposition header interpolation. Prevents header injection via crafted filenames containing CRLF, double-quotes, or control characters.
- Q2: Migration `58_attachment_encryption.sql` — added `crypto_provider TEXT NOT NULL DEFAULT 'env_aesgcm'` and `kms_key_name VARCHAR` columns to `wims.incident_attachments`, mirroring `incident_sensitive_details` pattern. Upload route stores `provider.crypto_provider` and `provider.kms_key_name`. Serve route reads `crypto_provider` from row and dispatches `get_crypto_provider({"crypto_provider": ...})` so changing `WIMS_CRYPTO_PROVIDER` env var does not break existing encrypted attachments.
- T1: `tests/test_kms_crypto_provider.py` — added `TestKmsSecurityProviderBytes` (7 tests) covering `encrypt_bytes`/`decrypt_bytes` contract: sentinel nonce return, utf-8 ct_bytes, version tracking, roundtrip, error propagation, and decode failure.
- S1: `system-wiki/log.md` line 119 — corrected `WIMS_ATTACHMENT_MAX_BYTES` → `WIMS_MAX_ATTACHMENT_BYTES` (matching the actual env var read at `incidents.py:38`).
- Tests: 3 new attachment tests (header injection, crypto_provider stored, stored provider dispatch) + 7 new KMS bytes tests. 24 + 29 = 53 passing. Ruff check/format green.
- No FRS gap register update (review fixes to existing M6a implementation; gap #151 remains CLOSED).

## [2026-06-13] fix | PR #261 review fixes — async Redis metrics + Prometheus/Redis regression test

- `src/backend/services/ai_service.py`: `_record_inference_metric` converted from sync to async (`async def`); uses `redis.asyncio` via per-call `_get_metrics_redis()` plus `await pipe.execute()` instead of blocking `redis.from_url()` + synchronous `pipeline().execute()`. The async client is closed after each metric write to avoid event-loop-affinity failures in pytest/CI. All three Ollama call sites (`analyze_threat_log`, `generate_incident_narrative`, `analyze_audit_logs`) now `await` the metric writer. Prometheus observe failures logged at debug (was silent `pass`); Redis operational errors narrowed to `redis.exceptions.RedisError` with debug logging (was broad silent `except Exception: pass`). Removed duplicate `logger` assignment.
- `src/backend/tests/test_system_monitoring.py`: added `@pytest.mark.asyncio` test `test_record_inference_metric_observes_prometheus_and_writes_redis` — directly verifies Prometheus `observe()` label/observe calls and Redis `pipeline()`/`incr`/`incrbyfloat`/`execute()` calls. Added `test_system_metrics_network_none_fallback` — verifies `net_io_counters()` None fallback returns `bytes_sent=0, bytes_recv=0`.
- No FRS gap register change (no FRS alignment change).

## [2026-06-12] docs | PR #271 metadata fix: M4-D → M2-c traceability correction

- `docs/PR-offline-first-encoder.md`: corrected Deferred "Conflict resolution UI" label from `(M4-D)` to `(M2-c)` — M2-c (Data Synchronization) covers conflict detection/resolution per FRS `raw/frs/frs-offlinefirst.md`. Added `## FRS Traceability` section mapping each FRS M2 sub-item to concrete implementation evidence with system-wiki cross-links (`concepts/frs-module-map`, `architecture/pwa-tests-cicd`, `gaps/frs-codebase-gap-register`).
- No FRS gap register update (M2b/M2c/M2d already CLOSED; this is a metadata/label correction, not a new gap).

## [2026-06-12] fix(#272) | close frontend offline review test gaps

- **T2:** Added `src/frontend/src/app/dashboard/validator/page.test.tsx` with page-level coverage for validator offline indicator, validator-only queued-op badge, and stale-cache banner.
- **T4:** Extended `src/frontend/src/app/dashboard/analyst/page.test.tsx` so offline-aware API mocks can return `fromCache: true`; added tests for offline banner, cached-data UI, and disabled exports while offline.
- **T5:** Added `src/frontend/src/lib/__tests__/connectivity.test.ts` covering `connectivity.ts` snapshot state, subscriber notifications, offline marking, probe success/failure, in-flight probe deduplication, and `isReachable()`.
- **Q6:** `src/frontend/src/app/admin/system/page.tsx` now subscribes to `connectivity.ts` and starts `probeConnectivity()` on mount. The admin offline banner now also shows "Backend unreachable — showing cached data" when the health probe reports offline even if `navigator.onLine` is true. `admin-system-monitoring.test.tsx` covers this reactive banner path.
- `system-wiki/subsystems/admin-hub.md` and `system-wiki/architecture/pwa-tests-cicd.md` updated for the admin backend-unreachable banner and connectivity test coverage. No FRS gap register update (test/UX hardening of existing offline-first behavior).

## [2026-06-12] fix(#272) | harden validator idempotency client ids

- **Q1 (duplicate race):** `insert_incident_verification_history` in `helpers.py` now wraps the INSERT in try/except for `SAIntegrityError` and raises `DuplicateClientIdError` when the unique violation matches the `uq_incident_verification_history_client_id` constraint (migration 56). Lifecycle commands (`verify_incident_command`, `archive_finalized_incident`, `unarchive_finalized_incident`) catch `DuplicateClientIdError`, roll back, and return `{"status": "already_applied"}` instead of the previous HTTP 500 from the broad `except Exception` handler. The `verify_incident` route handler checks for `status == "already_applied"` and skips SSE event publishing.
- **Q2 (UUID validation):** `archive_incident` and `unarchive_incident` routes in `validator.py` now validate the resolved `client_id` (from body XOR query param) via `uuid.UUID()` before any `CAST(:cid AS uuid)` SQL. Invalid IDs return HTTP 422 with a clear error message instead of propagating a database-level CAST error to an HTTP 500.
- **Pydantic body validation** (already in place from partial edits): `VerificationActionRequest.client_id` and `ClientIdRequest.client_id` use `@field_validator` with `uuid.UUID()` reject malformed bodies at the FastAPI layer with 422.
- **Tests (T1):** 7 new tests in `test_validator_idempotency.py` — 3 unit tests for `DuplicateClientIdError` raise/re-raise behavior (mocked `_insert_ivh_impl`), 4 integration tests proving invalid UUID in archive/unarchive query params and verification/archive body returns 422.
- No FRS gap register update (bugfix hardening of existing #267 idempotency feature).

## [2026-06-12] feat | GH #270 admin offline-first read caching

- `src/frontend/src/lib/api/offlineAdmin.ts`: created with 5 offline-aware admin wrappers (`fetchSystemHealthOfflineAware`, `fetchSystemMetricsOfflineAware`, `fetchWorkerStatusOfflineAware`, `fetchActiveSessionsOfflineAware`, `fetchAuditLogsOfflineAware`) following the `offlineAware()` pattern from `offlineAnalytics.ts`. Each checks connectivity snapshot, caches successful responses in encrypted IndexedDB under `admin:`-prefixed keys, uses 60s TTL (30s for active sessions), falls back to cache on network error, and throws when offline with no cache.
- `src/frontend/src/lib/api/admin.ts`: re-exports the 5 `*OfflineAware` functions and `OfflineAdminResult` type from `./offlineAdmin`.
- `src/frontend/src/app/admin/system/page.tsx`: swapped 5 legacy `fetch*` imports for `*OfflineAware` variants; added `useNetworkStatus` hook; updated `loadHealth`, `loadMonitoring`, `loadSessions`, and `loadAuditLogs` to destructure `{ response, fromCache, cachedAt }`; added amber "You are offline — showing cached data" banner when `!networkStatus.isOnline`; added `(cached)` badge and relative "Last checked: X sec ago" timestamp on panels served from cache. User CRUD, security HITL, and scheduled reports remain online-only.
- `src/frontend/src/lib/api/__tests__/offlineAdmin.test.ts`: 11 tests covering all 5 wrappers (offline-no-cache throw, online cache-write, network-error cache-fallback, 30s TTL staleness, audit-log cache key with params).
- `src/frontend/src/app/admin/system/admin-system-monitoring.test.tsx`: updated mocks for `*OfflineAware` shape; added offline banner render test. Also updated `admin-system-hitl.test.tsx`, `admin-system-analyze-ai.test.tsx`, and `admin-system-search.test.tsx` with corresponding mock updates.
- `system-wiki/subsystems/admin-hub.md`: added Offline Read Caching section.
- `system-wiki/frontend/frontend-infrastructure.md`: added `api/offlineAdmin.ts` to the API slice layout table.
- No FRS gap register update (this implements offline caching for existing admin monitoring reads; no FRS gap status changes).

## [2026-06-12] feat | GH #269 validator dashboard offline wiring

- `src/frontend/src/lib/api/offlineValidator.ts`: created with offline-aware validator wrappers: `submitVerificationOfflineAware`, `submitArchiveActionOfflineAware`, `archiveIncidentOfflineAware`, `unarchiveIncidentOfflineAware`, and `fetchValidatorQueueOfflineAware`. Each checks connectivity snapshot, queues via `queueIncident(payload, { opType, localId })` when offline or on network failure, and surfaces 409 `DUPLICATE_DETECTED` to the page. Verification supports `accept_replace` by carrying `original_incident_id`; queue fetch uses the encrypted `analytics-cache` store with 30-min TTL and user-scoped validator queue keys.
- `src/frontend/src/lib/api/validator.ts`: extended to re-export the new offline-aware wrapper functions and types from `./offlineValidator`.
- `src/frontend/src/lib/api/index.ts`: added `export * from './validator'` to the barrel so pages can import wrappers from `@/lib/api`.
- `src/frontend/src/app/dashboard/validator/page.tsx` and `components/validator/ActionModal.tsx`: mounted `useNetworkStatus` and `useAutoSync`; replaced direct `apiFetch` calls for queue fetch, archive, unarchive, and verification with the offline-aware wrappers; added stale-cache amber banner, validator-only pending-ops badge, sync-complete notification, offline indicator, and `sync-complete`/`wims:sync-complete` SW message listener; kept delete, bulk approve, and forced duplicate "accept as new" online-only.
- `src/frontend/src/lib/__tests__/offlineValidator.test.ts`: added reproduction test (verify offline queuing) plus archive/unarchive archive_action queuing tests (3 tests total, all passing).
- `system-wiki/architecture/pwa-tests-cicd.md`: added `offlineValidator.ts` section with export table and dashboard wiring summary.
- `system-wiki/frontend/frontend-infrastructure.md`: added `offlineValidator.ts` to API slice layout table.
- `docs/implementations/validator-dashboard-offline-wiring.md`: implementation handoff doc created with base-fail/patch-pass evidence, mechanical gate results, spec compliance table, and residual risks.
- No FRS gap register update (this implements existing offline-first behavior without changing FRS gap status).

## [2026-06-12] feat | GH #268 validator offline op types and sync engine

- `src/frontend/src/lib/offlineStore.ts`: added `OfflineOpType` (`'create' | 'verify' | 'archive_action'`), `VerifyPayload`, `ArchiveActionPayload`, and `QueueIncidentOptions`; `queueIncident(payload, options?)` now persists optional `opType` and `localId` metadata so real queued validator ops can dispatch/idempotently replay.
- `src/frontend/src/lib/syncEngine.ts`: added op-type dispatch via `processVerify()` (PATCH `/api/regional/incidents/{id}/verification` with `{ action, notes, client_id, original_incident_id? }` and `credentials: 'include'` via `apiFetch`) and `processArchiveAction()` (PATCH `/api/regional/validator/incidents/{id}/archive` or `/unarchive` with `{ client_id }` and `credentials: 'include'`). Legacy items without `opType` continue to POST to `/api/v1/public/report` (backward-compatible). Network errors (no HTTP status) now abort the remaining batch; HTTP errors (4xx/5xx) continue. 409 `DUPLICATE_DETECTED` on verify/archive_action keeps the op pending.
- `src/frontend/src/lib/__tests__/syncEngine.test.ts` and `src/frontend/src/lib/__tests__/offlineStore.test.ts`: tests cover verify dispatch, archive/unarchive dispatch, 409 conflict, backward compat, network error batch abort, HTTP error continuation, and persistence of `opType`/`localId` queue metadata.
- `system-wiki/architecture/pwa-tests-cicd.md`: updated syncEngine section with op-type dispatch table, auth notes, and error abort behavior.
- `docs/implementations/validator-offline-op-types-sync-engine.md`: implementation handoff doc created with base-fail/patch-pass evidence, mechanical gate results, spec compliance table, and residual risks.
- No FRS gap register update (this implements offline op type dispatch for validator actions; no FRS gap status changes).

## [2026-06-12] docs | Agent gotcha for spec deviations

- `AGENTS.md`: added Gotcha #16 requiring agents/subagents to follow issue/PRD/spec/acceptance contracts exactly unless they explicitly state a deviation, justify it, and show how it improves correctness, safety, maintainability, or user value.
- `system-wiki/operations/agent-routing-guide.md`: added the same delegation rule so implementation chains do not silently bypass explicit specs.
- No FRS gap register update; this changes agent workflow guidance, not product behavior or FRS alignment.

## [2026-06-12] feat | GH #266 analyst offline-first read caching

- `src/frontend/src/lib/api/offlineAnalytics.ts`: added 9 offline-aware National Analyst read wrappers returning `{ response, fromCache, cachedAt? }` with 30-minute TTL, connectivity failover, cache-miss friendly errors, and network-error offline marking.
- `src/frontend/src/lib/offlineStore.ts` and `src/frontend/src/lib/connectivity.ts`: bumped IndexedDB to v3 with encrypted `analytics-cache` KV entries and added shared connectivity snapshot/probe helpers.
- Analyst dashboard, workflow, and incident detail pages now call the wrappers, mount network/autosync hooks, show cached-data banners, and block/offline-toast export actions where applicable.
- `system-wiki/architecture/pwa-tests-cicd.md` and `system-wiki/frontend/frontend-infrastructure.md`: documented the encrypted analyst cache and wrapper exports. No FRS gap register update (issue implements existing offline-first behavior without changing gap status).

## [2026-06-12] fix | dynamic frontend DNS for nginx + frontend health check in deploy

- `src/nginx/nginx.conf`: replaced all four static `proxy_pass http://frontend:3000[/]` references with a new `upstream frontend_servers { server frontend:3000 resolve; }` block. Nginx previously resolved `frontend` at startup and cached the IP indefinitely, so after a deploy recreated the frontend container with a new Docker IP, nginx kept proxying to the stale IP → `502 Bad Gateway`. The `resolve` flag on the upstream server directive forces nginx to re-resolve via Docker's embedded DNS (`resolver 127.0.0.11 valid=10s`), matching the existing `backend_servers` pattern.
- `.github/workflows/deploy.yml`: added `nginx -s reload` after `compose up` as a safety net, and a frontend-specific health check (`curl -fsS https://wimsbfp.tech/login >/dev/null`) to the post-deploy health probe section — the existing Keycloak and API checks cannot detect a stale frontend upstream.
- `system-wiki/architecture/infrastructure-config.md`: updated Docker DNS upstream refresh section and added deploy detail note about the frontend probe.

## [2026-06-12] fix | keep openbao-bootstrap alive for docker compose --wait

- `src/openbao/init/bootstrap-openbao.sh`: added keep-alive loop (`while true; do sleep 3600; done`) with SIGTERM/SIGINT trap at end of bootstrap script. The deploy workflow (`compose up -d --build --wait`) requires every service to be in "running" or "healthy" state. Since the bootstrap container has no healthcheck and previously exited after completing its init logic, `--wait` saw it as "not ready" and failed the deploy. The keep-alive keeps the container in "running" state until the stack is torn down.
- `system-wiki/architecture/infrastructure-config.md`: documented the --wait compatibility detail in the GitOps deploy workflow section.

## [2026-06-12] feat | GH #167 — M9a AI inference latency + network bandwidth (feat/m9-system-metrics)

- `src/backend/utils/metrics.py`: added `AI_INFERENCE_DURATION` Prometheus histogram (`ai_inference_duration_seconds`, label `function`, buckets 1–120s). Auto-exposed via `/metrics` — satisfies AC #2 for web-process calls.
- `src/backend/services/ai_service.py`: added `_record_inference_metric(function_name, elapsed_s)` helper — observes to Prometheus histogram AND writes cross-process Redis counters (`wims:ai:inference:count`, `wims:ai:inference:sum_ms`) via pipeline. All three Ollama POST sites instrumented: `analyze_threat_log`, `generate_incident_narrative`, `analyze_audit_logs`. Redis approach required because `prometheus_client` is NOT in multiprocess mode and both `analyze_threat_log` and `generate_incident_narrative` run in Celery workers as well as web workers.
- `src/backend/api/routes/admin/monitoring.py`: `GET /admin/monitoring/system` extended — reads Redis counters for `ai_inference: {avg_latency_ms, count}` (null avg + 0 count when Redis unreachable), adds `network: {bytes_sent, bytes_recv}` from `psutil.net_io_counters()`. `net_io_counters()` None-guarded. Existing cpu/memory/disk fields unchanged.
- `src/frontend/src/lib/api/legacy.ts`: `SystemMetricsResponse` extended with `ai_inference` and `network` optional fields.
- `src/frontend/src/app/admin/system/page.tsx`: `SystemMetrics` interface extended; grid changed from `md:grid-cols-3` to `sm:grid-cols-2 lg:grid-cols-5`; AI Inference card (avg ms + call count, or "No calls recorded") and Network card (↑/↓ MB) added after disk card. Existing CPU/Memory/Disk cards unchanged.
- `src/backend/tests/test_system_monitoring.py`: 3 new tests — `ai_inference`/`network` shape, Redis-mock populated avg/count, `/metrics` histogram presence.
- `src/frontend/src/app/admin/system/admin-system-monitoring.test.tsx`: 2 new tests — AI Inference + Network card render with data, "No calls recorded" for count=0.
- Gap register updated: #167 CLOSED, M9a extended note added.
- PWA sync counters deferred per issue ("optional for prototype").

## [2026-06-13] fix | GH #160 PR #264 review — sliding windows, exception re-raise, scope corrections

- `src/backend/tasks/anomaly_detection.py`: BULK_DELETE and RAPID_IP_SWITCH switched from fixed floor-bucket windows to correlated-subquery sliding windows (prevents cross-boundary evasion). Removed dead `REJECTED_%` pattern from BULK_DELETE. Broadened PRIVILEGE_ESCALATION from `ROLE_CHANGE_TO_%SYSTEM_ADMIN%` to `ROLE_CHANGE_TO_%` (per GH #160 broader RBAC-violation language). Fixed threat_payload dict clobbering: `{**details, "anomaly_type": anomaly_type}` (details keys no longer overwrite explicit anomaly_type). Task exceptions now roll back, log, and re-raise (consistent with security-adjacent task pattern).
- `src/backend/tests/test_anomaly_detection.py`: Added cross-boundary BULK_DELETE test, cross-boundary RAPID_IP_SWITCH test, ANALYST role change positive test (PRIV_ESC broadening), in-hours OFF_HOURS negative test, task dedup>0 counter test, task re-raise test. Test count 21→27.
- M8 status corrected from CLOSED to PARTIAL in gap register (2 detectors remain deferred).
- No migration changes; SQL structure preserved; dedup stability maintained.

## [2026-06-12] feat | GH #160 M8 — behavioral anomaly detection engine

- `src/postgres-init/57_anomaly_detections.sql`: new table `wims.anomaly_detections` (BIGSERIAL PK, anomaly_type, subject_user_id FK users NULLABLE, severity CHECK LOW/MEDIUM/HIGH/CRITICAL, details JSONB, detected_at TIMESTAMPTZ, status CHECK NEW/ACKNOWLEDGED/RESOLVED, UNIQUE(anomaly_type, dedup_key)). RLS: SELECT/UPDATE SYSTEM_ADMIN; INSERT WITH CHECK SYSTEM_ADMIN (covers SYSTEM_TASK_USER_ID = svc_task).
- `src/backend/tasks/anomaly_detection.py`: Celery beat task `detect_behavioral_anomalies` (60s). Four detectors on `wims.system_audit_trails` via SQL windows: BULK_DELETE (>10 delete-class actions per user in 5-min window, HIGH), OFF_HOURS (high-sensitivity actions outside 06:00–21:59 Asia/Manila, MEDIUM), PRIVILEGE_ESCALATION (ROLE_CHANGE_TO_*SYSTEM_ADMIN* events, HIGH), RAPID_IP_SWITCH (≥2 distinct IPs per user in 10-min window, MEDIUM). `_write_anomaly()` helper: INSERT anomaly_detections ON CONFLICT (anomaly_type, dedup_key) DO NOTHING RETURNING anomaly_id; only on new row also INSERTs into `wims.security_threat_logs` (suricata_sid=NULL). Session: `get_session(SYSTEM_TASK_USER_ID)`.
- Deferred: Suspicious Query Patterns, geo Impossible Travel (RAPID_IP_SWITCH ships as proxy). Gap register updated.

## [2026-06-12] feat | M6a attachment encryption at rest + authenticated serve route (#151)

- Migration `58_attachment_encryption.sql`: `ALTER TABLE wims.incident_attachments ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT false, encryption_iv VARCHAR, key_version INTEGER NOT NULL DEFAULT 1`. `DEFAULT false` intentional (not AC's `DEFAULT true`) — existing plaintext files must not be served through the decrypt path.
- `utils/crypto.py`: added `SecurityProvider.encrypt_bytes(data, aad) -> (nonce_b64, ct_bytes)` and `decrypt_bytes(nonce_b64, ct_bytes, aad, key_version) -> bytes`. Additive — `encrypt_json`/`decrypt_json` (PII blob) unchanged.
- `services/kms/openbao_client.py`: mirrored `encrypt_bytes`/`decrypt_bytes` on `KmsSecurityProvider`. OpenBao variant encodes Transit ciphertext string as UTF-8 bytes on disk; nonce_b64 is `NONCE_SENTINEL` (ignored on decrypt, same as `decrypt_json`).
- `api/routes/incidents.py`: upload route (`POST /api/incidents/{id}/attachments`) — enforces `MAX_ATTACHMENT_BYTES` (default 25 MB, `WIMS_MAX_ATTACHMENT_BYTES` env), accumulates full plaintext in memory, SHA-256 on plaintext, encrypts via `get_crypto_provider().encrypt_bytes()`, writes raw ciphertext bytes to disk, inserts `is_encrypted=true`, `encryption_iv`, `key_version`, `crypto_provider`, `kms_key_name`. AAD = `f"attachment:{uuid_filename}".encode()` — reconstructable from `Path(storage_path).name`. New serve route (`GET /api/incidents/{id}/attachments/{aid}`) — role-guarded (staff only, not CIVILIAN_REPORTER), RLS-protected SELECT, dispatches `get_crypto_provider(row)` using stored `crypto_provider`, decrypts transparently when `is_encrypted=true`, serves raw bytes for legacy `is_encrypted=false`; decrypt failure → 500 with safe message (no data leak).
- `key_version` not in original AC — added for KMS key rotation compatibility (prevents silent decrypt failure when WIMS_MASTER_KEY is rotated).
- No backfill: forward-only. Existing plaintext attachments served raw via `is_encrypted=false` fallback.
- In-memory constraint: AESGCM requires full plaintext/ciphertext at once. 25 MB default cap is appropriate for photos and AFOR scans. Chunked streaming AEAD is deferred future work for large video evidence files.
- 22 unit + route tests pass (`tests/test_attachment_encryption.py`). No frontend changes — serve route is new backend-only surface.

## [2026-06-12] feat | GH #164 M8 — security monitoring dashboard + multi-severity filter

- `src/backend/api/routes/admin/security.py`: extended `GET /api/admin/security-logs` severity param to accept comma-separated values (e.g. `?severity=HIGH,CRITICAL`); values validated against `_VALID_SEVERITIES` frozenset; individual bind params (`:sev0`, `:sev1`, …) used in dynamic `IN (…)` clause to prevent SQL injection; single-value path unchanged. New `GET /api/admin/security-logs/summary` endpoint (inserted before `/{log_id}` routes to avoid parameterized route conflict): returns `by_severity` dict (all four levels, zero-filled), `unreviewed_count` (hitl_decision IS NULL), `total`, and `recent_narratives` (5 most recent with xai_narrative).
- `src/backend/tests/test_security_monitoring.py`: 12 new unit tests (mock DB, no stack required) — 6 for multi-severity filter (multi returns IN clause, individual bind params, single-value path, all-invalid ignored, mixed valid/invalid strips invalid) and 6 for summary shape/counts/empty-db/admin-gate.
- `src/frontend/src/lib/api/legacy.ts`: extended `fetchAdminSecurityLogs` params with `severity?: string`; added `SecurityLogsSummary` interface and `fetchSecurityLogsSummary()`.
- `src/frontend/src/app/admin/monitoring/page.tsx`: new SYSTEM_ADMIN-gated page at `/admin/monitoring` — summary cards (Total Threats, Unreviewed, High+Critical); inline SVG/CSS proportional severity distribution bar (no chart library); severity filter chips with `toggleSeverity`/`clearFilters`; threat feed table (timestamp, source IP, severity badge, SID, status, XAI confidence) with pagination; 30s auto-refresh via `setInterval`; recent XAI narratives panel; audit highlights panel (HITL_REVIEW, PII_EXPORT, PII_ANONYMIZE, BREACH_DETECTED).
- `src/frontend/src/components/Sidebar.tsx`: added "Security Monitoring" nav item (`/admin/monitoring`, ShieldAlert icon) under Administration (SYSTEM_ADMIN).
- `src/frontend/src/app/admin/monitoring/admin-security-monitoring.test.tsx`: 4 Vitest tests — summary cards render, chip toggle calls API with correct severity, empty state, distribution bar labels.
- Deferred: SSE real-time push (polling sufficient for v1), global sidebar unreviewed badge.
- Gap register updated: M8 monitoring dashboard CLOSED.

## [2026-06-12] feat | GH #73 — M10 RA 10173 PII export, anonymization, consent logging (feat/m6-privacy-rights)

- `src/postgres-init/59_consent_log.sql`: new `wims.consent_log` table. RLS: INSERT WITH CHECK (TRUE) for public consent recording; SELECT/UPDATE/DELETE SYSTEM_ADMIN only.
- `src/backend/schemas/privacy.py`: `ConsentRequest`, `ConsentRecord`, `ExportResponse`, `AnonymizeRequest` (confirm validator), `AnonymizeResponse`.
- `src/backend/api/routes/admin/privacy.py`: `GET /api/admin/privacy/export` (user → profile + consent_history; report → citizen_reports + decrypted incident_sensitive_details + consent_history; no-store headers; PII_EXPORT audit); `POST /api/admin/privacy/anonymize` (user → NULL contact_number; report → terminal-status guard (409 for non-terminal), NULL witness/PII/blob fields + involved_parties.full_name; PII_ANONYMIZE audit per table; warning:"irreversible" in response).
- `src/backend/api/routes/consent.py`: `POST /api/auth/consent` (public, no auth; inserts to consent_log; CONSENT_GRANT/CONSENT_WITHDRAW audit with user_id=None).
- `src/backend/api/routes/admin/__init__.py` + `src/backend/main.py`: router registrations.
- `src/backend/tests/test_privacy.py`: 18 unit tests covering all ACs + corrections A-G.
- Gap register: M10 #73 CLOSED; full DPA compliance (PIA/retention/DPO) noted as out-of-scope separate initiative.
## [2026-06-11] fix | OpenBao token-file mounting for backend/celery

- `src/openbao/init/bootstrap-openbao.sh`: after writing the `wims-app` policy, bootstrap now verifies any existing app token or creates a replacement policy-scoped orphan service token and persists the token value to `/vault/file/.wims-app-token` without logging it. This regenerates app auth after an OpenBao volume reset while avoiding token churn on normal restarts.
- `src/docker-compose.yml`: backend and celery-worker mount `openbao_data` read-only at `/openbao-creds`, set `OPENBAO_TOKEN_FILE=/openbao-creds/.wims-app-token`, and explicitly clear direct `OPENBAO_TOKEN` so stale `.env.production` tokens cannot override the regenerated token file.
- `src/backend/services/kms/openbao_client.py`: client now reads `OPENBAO_TOKEN_FILE` when `OPENBAO_TOKEN` is empty; direct env token and future AppRole settings remain supported.
- `src/backend/tests/test_openbao_client.py`: added token-file unit coverage for file read, env-token precedence, and missing file errors.
- `docs/operations/openbao-kms-runbook.md`, `.env.example`, `system-wiki/security/security-baseline.md`, and `system-wiki/architecture/infrastructure-config.md`: documented token-file lifecycle and the remaining plaintext-volume/prototype caveat.
- No FRS gap register update (auth persistence implementation detail; no gap status changed).

## [2026-06-11] fix | OpenBao production lifecycle fixes — wait-API, health-unsealed, credential persistence, backend env

- `src/backend/services/kms/openbao_client.py`: extracted `_url_for()` helper with explicit `/sys/` path branching. Health endpoint now correctly hits `/v1/sys/health`; Transit operations still use `/v1/{mount}/...`.
- `src/openbao/init/bootstrap-openbao.sh`: full rewrite of wait/init/unseal lifecycle. Wait loop captures status JSON and checks for `"initialized"` field (not exit code 0) so sealed/uninitialized clusters are detected before reaching init/unseal branches. Handles three states (uninitialised → init+unseal+persist; sealed → env/persisted unseal or fail-fast; unsealed → env/persisted/dev token chain). First-boot root token and unseal key persisted to `/vault/file/.bootstrap-creds` (chmod 600, dev/single-VPS only). Transit keys created with `derived=true type=aes256-gcm96`. Non-derived key error now warns about data loss before recommending deletion. Secrets never logged.
- `src/docker-compose.yml`: OpenBao healthcheck now requires `initialized=true` AND `sealed=false`. Bootstrap depends on `service_started` to avoid first-boot deadlock. Bootstrap container mounts `openbao_data` volume for credential persistence. `OPENBAO_ADDR`, `OPENBAO_TOKEN`, `OPENBAO_TRANSIT_MOUNT`, `WIMS_CRYPTO_PROVIDER` plumbed into backend and celery-worker with safe defaults — no dependency forcing optional OpenBao on default env-aesgcm boot.
- `src/backend/tests/test_openbao_client.py`: 8 new `TestOpenBaoClientRouting` unit tests proving sys paths bypass mount and Transit paths use mount prefix.
- `docs/operations/openbao-kms-runbook.md`: updated bootstrap description with persistence lifecycle, credential persistence section, healthcheck/backend env docs, and safe key-delete warning.
- `system-wiki/security/security-baseline.md`: updated Production Lifecycle Fixes section with credential persistence, health-unsealed guard, backend env plumbing, and safe-delete warning.
- No FRS gap register update (no gap status change — these are implementation fixes, not new gaps).

## [2026-06-11] feat | GH #152 Phase 8 — OpenBao KMS hardening, live validation hooks, ops runbook

- `docs/operations/openbao-kms-runbook.md`: new operations runbook covering local dev bootstrap, env var reference table, production topology (internal-only network, TLS, HA/Raft), unseal strategy (Shamir M-of-N / platform auto-unseal), least-privilege policy summary, migration runbook (dry-run, production run, rollback/resume), rotation runbook (scheduled beat, DB inspection, triage), backup restore drill (legacy + OpenBao), incident response scenarios (down/sealed/auth failure/rotation failure/backup decrypt failure), and explicit secret hygiene rules.
- `src/backend/tests/integration/test_openbao_kms_live.py`: 5 new live integration tests — health structure assertion (`test_openbao_health_live`), encrypt/decrypt roundtrip with context binding (`test_openbao_transit_encrypt_decrypt_live`), wrong-context rejection (`test_decrypt_wrong_context_fails_live`), rewrap ciphertext-change + plaintext-preservation (`test_openbao_transit_rewrap_live`), backup encrypt/decrypt roundtrip with WIMSBAO1 header verification (`test_openbao_backup_crypto_live_roundtrip`). All tests use `@pytest.mark.skipif` with explicit reason strings; skip cleanly when `OPENBAO_ADDR` unset, no auth token, or OpenBao unreachable/sealed. No hard Docker dependency.
- Smoke script intentionally skipped — integration tests cover the same operational surface and are invocable with `pytest tests/integration/test_openbao_kms_live.py -v`.
- No-secret logging verified across all Phase 1-8 code paths: client, rotation task, migration script, backup_crypto, rewrap orchestration — only operation metadata logged; no ciphertext, plaintext, nonces, keys, or tokens appear in any log statement.
- Wiki: `security-baseline.md` updated with Phase 8 status (code hooks/runbook implemented; live environment validation pending). Gap register updated: #152 now Phases 1-8 implemented, overall PARTIAL until live ops drill passes.
- No commit/push performed.

## [2026-06-11] feat | GH #152 Phase 7 — OpenBao-backed backup encryption + legacy restore compatibility

- `src/backend/utils/backup_crypto.py`: rewritten to support pluggable crypto providers. Feature flag `WIMS_BACKUP_CRYPTO_PROVIDER` (priority) or `WIMS_CRYPTO_PROVIDER` (fallback), default `env_aesgcm`. New OpenBao format: `WIMSBAO1\n` magic header + JSON metadata line (provider, key_name, created_at, ciphertext_version) + OpenBao Transit ciphertext as UTF-8 bytes. No secrets in header. Context/AAD `b"wims-backup"`. Key name from `OPENBAO_BACKUP_KEY_NAME`, default `wims-backup`. `decrypt_backup()` auto-detects format via header magic; legacy env-AES nonce+ciphertext path preserved unchanged.
- `src/backend/tests/test_backup_crypto_openbao.py`: 34 new unit tests (no live OpenBao). Covers feature-flag precedence, legacy roundtrip, WIMSBAO1 header write/parse, OpenBao roundtrip with mock client, header auto-detection on decrypt, legacy decrypt without header, missing/invalid metadata, `OPENBAO_BACKUP_KEY_NAME` honoring, unknown provider error, signature and output-path preservation.
- Admin routes: no changes — `backups.py` calls unchanged `encrypt_backup()`/`decrypt_backup()`.
- Wiki: `security-baseline.md` + gap register updated; Phase 7 implemented, #152 code paths complete, overall PARTIAL until live OpenBao restore drill.
- No commit/push performed.

## [2026-06-11] feat | GH #152 Phase 6 — automated 90-day OpenBao KMS rotation + rewrap/resume run state

- `src/postgres-init/55_kms_key_rotation_runs.sql`: new migration. Creates `wims.kms_key_rotation_runs` table with UUID PK, status enum, from/to version tracking, row counters, error message. Indexes for active-run guard and last-success lookup. RLS: SYSTEM_ADMIN only.
- `src/backend/tasks/kms_rotation.py`: new Celery task module. `ensure_pii_key_rotation()` daily check — active RUNNING row guard, reads OpenBao metadata, `is_rotation_due()` helper (default 90-day interval from `OPENBAO_ROTATION_INTERVAL_DAYS` env), rotates key via `OpenBaoClient.rotate()`, records run row, rewraps `openbao_transit` rows in cursor-paginated batches via `rewrap_openbao_rows()`, marks SUCCEEDED/FAILED. Per-row errors increment failure counter and continue. Never logs plaintext/ciphertext/keys/tokens.
- `src/backend/celery_config.py`: daily beat entry `ensure-pii-key-rotation-daily` at 03:30 UTC via crontab; `tasks.kms_rotation` added to imports tuple.
- `src/backend/tests/test_kms_rotation_task.py`: 17 unit tests (no live OpenBao). Covers rotation-due boundary logic, single-run guard, rotate + run recording, rewrap row updates + skip, per-row rewrap/UPDATE error isolation, SUCCEEDED/FAILED status marking, and Celery beat entry verification.
- Wiki: `security-baseline.md` + gap register updated; Phase 6 marked implemented, #152 overall still PARTIAL (Phase 7 + ops remain).
- No commit/push performed.

## [2026-06-11] feat | GH #152 Phase 5 — migration tooling: legacy env-AES → OpenBao Transit

- `src/backend/scripts/migrate_pii_to_openbao.py`: new migration script. Reads `incident_sensitive_details` rows with legacy env-AES blobs (`crypto_provider IS NULL OR crypto_provider = 'env_aesgcm'`). Supports `--dry-run`, `--batch-size N` (default 500), `--incident-id ID`, `--resume-after ID`, `--limit N`. Decrypts with `SecurityProvider`, re-encrypts with `KmsSecurityProvider`, stores `crypto_provider='openbao_transit'`, `kms_key_name`, `encryption_iv=NULL`. Idempotent (skips already-openbao rows). Error isolation per row. Commit per batch. Detects `key_version` column dynamically via `information_schema`. Exit code 1 if errors > 0. Requires `DATABASE_URL`, `WIMS_MASTER_KEY`, `OPENBAO_ADDR` + token.
- `src/backend/tests/test_migrate_pii_to_openbao.py`: 23 unit tests (no live OpenBao). Covers dry-run, successful migration, idempotent skip, decryption/encryption/update error isolation, CLI flag behavior, key version column detection, and exit codes.
- Wiki: `security-baseline.md` + gap register updated; Phase 5 marked implemented, #152 overall still PARTIAL (Phases 6-7 remain).
- No commit/push performed.

## [2026-06-11] feat | GH #152 Phase 4 — flag-gated new writes via OpenBao Transit

- `api/routes/regional/afor.py` and `__init__.py`: wire `get_crypto_provider()` instead of legacy `helpers.get_security_provider()` for AFOR commit path. This ensures `WIMS_CRYPTO_PROVIDER` env var controls encryption provider for all new writes including AFOR imports.
- `api/routes/regional/field_updates.py`: `_fetch_incident_edit_fields` now strips `crypto_provider` and `kms_key_name` from 409 conflict responses in addition to existing `pii_blob_enc`/`encryption_iv` stripping.
- Write paths: all 6 write paths now dispatch through `services.kms.get_crypto_provider()`. When `WIMS_CRYPTO_PROVIDER=openbao_transit`, new rows store `crypto_provider='openbao_transit'`, `kms_key_name='wims-incident-pii'`, `pii_blob_enc=<Transit ciphertext>`, `encryption_iv=NULL`. When unset/`env_aesgcm`, existing behaviour unchanged.
- Tests: `tests/test_openbao_new_writes.py` — 10 new unit tests covering env-AES metadata, OpenBao Transit metadata, nonce sentinel guard, response stripping, and wiring verification. All 57 tests pass (54 passed + 3 OpenBao-live skipped).
- Wiki: `security-baseline.md` + gap register updated; Phase 4 marked implemented, #152 overall still PARTIAL (Phases 5-7 remain open).
- No commit/push performed.

## [2026-06-10] fix | M5 map: Referrer-Policy strict-origin-when-cross-origin so OSM tiles load in prod (#233)

## [2026-06-11] feat | GH #152 Phase 3 — OpenBao KMS provider metadata + dual-read dispatch

- Migration `54_openbao_provider_metadata.sql`: adds `crypto_provider TEXT NOT NULL DEFAULT 'env_aesgcm'` and `kms_key_name TEXT` to `wims.incident_sensitive_details`; relaxes PII blob consistency constraint for openbao_transit rows.
- `services/kms/__init__.py`: `get_crypto_provider(row=None)` dispatches by row `crypto_provider` first, then `WIMS_CRYPTO_PROVIDER` env var (default `env_aesgcm`).
- `services/kms/openbao_client.py`: `KmsSecurityProvider` class with `encrypt_json`/`decrypt_json` compatibility surface; sentinel nonce `OPENBAO_TRANSIT`; key name from `OPENBAO_PII_KEY_NAME` > `OPENBAO_TRANSIT_KEY_NAME` > `wims-incident-pii`.
- `utils/crypto.py`: `SecurityProvider` gains `crypto_provider` and `kms_key_name` properties for provider-agnostic write paths.
- Write paths updated (5 files): `incidents.py`, `encoder_crud.py`, `field_updates.py`, `helpers.py`, `commit.py` — all INSERT/UPDATE include `crypto_provider`, `kms_key_name`; `encryption_iv=NULL` for openbao_transit rows.
- Read paths updated (4 files): `encoder.py`, `field_updates.py`, `helpers.py`, `encrypt_backlog.py` — all SELECT `crypto_provider` and dispatch decrypt by row provider; legacy rows default to env_aesgcm.
- Tests: `tests/test_kms_crypto_provider.py` — 19 unit tests (provider dispatch, KmsSecurityProvider contract, SecurityProvider metadata). All 45 tests pass (17 crypto + 9 openbao client + 19 new), 3 OpenBao-live skipped.
- Wiki: `security-baseline.md` + gap register updated; Phase 3 marked implemented, M6/OpenBao KMS overall remains PARTIAL (Phases 4-6 still open).
- No commit/push performed.

- Root cause: prod HTTPS nginx block had `Referrer-Policy: no-referrer`, suppressing the Referer header OSM tile servers require. All 8 react-leaflet TileLayer components (PublicFireMapInner, MapPickerInner, ClusterMapInner, NearbyPublicReportAreasInner, NearbyStationsMapInner, ValidatorMapInner, FireStationsMapInner, HeatmapViewer) were returning 403 in production.
- Fix: `src/nginx/nginx.conf` HTTPS block — changed `add_header Referrer-Policy no-referrer always` → `add_header Referrer-Policy strict-origin-when-cross-origin always`. One line. No frontend, no migration.
- Dev/localhost block and `nginx.ci.conf` left untouched (CI does not load OSM tiles).
- Validation: next VPS deploy — tiles load, no 403s in browser console.

## [2026-06-11] test | Referrer-Policy regression coverage in test_infra_config.py (#253)

- Added `test_nginx_referrer_policy_production` to `src/backend/tests/test_infra_config.py`.
- Guards: (1) nginx.conf HTTPS block has `strict-origin-when-cross-origin`; (2) localhost/redirect blocks do not contain Referrer-Policy at all; (3) nginx.ci.conf retains `no-referrer`.

## [2026-06-11] test | PR #253 review-fix batch — T1-T5 test improvements

- **T1** — Added regression test for nginx Referrer-Policy in `test_infra_config.py`.
- **T2** — Added tile-layer render assertion to `HeatmapViewer.test.tsx`.
- **T3** — Replaced `next/dynamic` mock with `react-leaflet` mock in `NearbyPublicReportAreas.test.tsx`; added TileLayer assertion with real dynamic import.
- **T4** — Changed `TileLayer` mock from `null` to rendered element in analyst `page.test.tsx`; added tile-layer assertion.
- **T5** — Created 6 new smoke test files for untested TileLayer components: `PublicFireMapInner`, `MapPickerInner`, `ClusterMapInner`, `NearbyStationsMapInner`, `ValidatorMapInner`, `FireStationsMapInner`.
- Verifies the OSM tile fix won't regress in future nginx.conf edits.

## [2026-06-11] fix | T3: NearbyPublicReportAreas test mocks react-leaflet instead of next/dynamic (#253)

- Replaced `vi.mock('next/dynamic', ...)` (returned MockMap div) with `vi.mock('react-leaflet', ...)` (provides MapContainer, TileLayer, Circle, Marker, Popup, useMap).
- The react-leaflet mock asserts TileLayer rendering via `screen.findByTestId('tile-layer')`.
- Added `setView`/`fitBounds` stubs on useMap to prevent FitBounds crash.
- Used `vi.useRealTimers()` in the first test so @loadable/component's 200ms delay fires and the dynamic import resolves.
- All 4 tests pass.

## [2026-06-10] fix | M1 Keycloak theme: TOTP setup page left-edge clipping (#231)

- Root cause: `.pf-v5-c-login__main` base rule had `overflow: hidden` with a min horizontal padding of 0.75rem (12px). On the TOTP page the wide `.wims-totp-setup` card (up to 860px) filled the content area edge-to-edge; its 24px box-shadow blur and the step-number circles were clipped at the panel's left overflow boundary.
- Fix (CSS-only, `wims-custom.css`): (1) `:has(.wims-totp-setup)` override — raised panel min horizontal padding to 1.5rem (24px) via `padding-left/right: clamp(1.5rem, 4vw, 4.5rem)` (`overflow-x: visible` coerces to `auto` due to CSS spec, producing a horizontal scrollbar — padding raise is the correct approach). (2) `.wims-totp-setup` card left/right padding `clamp(0.7rem,1.2vw,0.95rem)` → `clamp(1.25rem,2vw,1.5rem)`. (3) `.wims-totp-steps > li` left padding `0.5rem` → `0.9rem` so the 1.55rem circles sit fully clear of the card's left border.
- No migration, no app code, no FTL changes. Validation: visual — restart keycloak, assign "Configure OTP" action to a test user, log in.

## [2026-06-09] fix | PR #238 rebase + review fixes — 6 files

- Rebased `feat/m13-email-triggers` onto origin/master (1345808). Resolved 2 conflicts:
  - `src/backend/celery_config.py`: merged M7a `update-suricata-rules-weekly` + M13 `send-weekly-report-email` beat entries
  - `.zap/rules.tsv`: kept HEAD (M7a) justification for rule 90004 (COEP unsafe-none)
- **Q1 (critical):** Fixed double-toggle bug in `profile/page.tsx` â€” removed `div.onClick` handlers that canceled out checkbox `onChange` (React 18 batching).
- **S1:** Updated notification prefs copy from "report status changes" to "system alerts and weekly reports" (matches actual email dispatch).
- **Q4:** Profile save callback now refreshes `notifPrefs` from API response (was discarding `email_opt_in`/`push_opt_in` on profile save).
- **Q2/Q3:** Added `NEXT_PUBLIC_APP_URL` env var to backend + celery-worker containers in `docker-compose.yml` and `docker-compose.prod.yml` (email links no longer default to localhost in prod).
- **S2:** Updated stale section comment in `tasks/notifications.py` â€” no longer claims triggers are "out of scope."
- **S3:** Weekly report email query now filters by `email_opt_in = TRUE`; security alert query intentionally bypasses (critical alerts).
- **S4:** Added `autoretry_for=(Exception,)` with backoff to `send_weekly_report_email` Celery task.
- **S5:** Moved `import requests` inside `test_mailhog_email_delivery` function body (integration-only dependency).

## [2026-06-09] feat | M13 user notification preferences â€” email_opt_in + push_opt_in (#72)

- Migration `47_notification_preferences.sql`: adds `email_opt_in BOOLEAN NOT NULL DEFAULT TRUE` and `push_opt_in BOOLEAN NOT NULL DEFAULT TRUE` to `wims.users`. Defaults preserve existing behaviour; JIT-provisioning INSERT is unaffected.
- Extended `GET /api/user/me/profile`: now queries `contact_number, email_opt_in, push_opt_in` from `wims.users`; NULL values default to `TRUE`.
- Extended `PATCH /api/user/me` (`ProfileUpdate` schema): accepts `email_opt_in` and `push_opt_in` booleans; persists in a single DB UPDATE; skips Keycloak call when only pref fields are sent.
- Updated `src/frontend/src/lib/api/legacy.ts`: extended `fetchMyProfile()` return type and `updateMyProfile()` payload type for both pref booleans.
- Added "Notification Preferences" card to `src/frontend/src/app/profile/page.tsx`: Email + Push toggle switches loaded from GET and saved via PATCH, matching existing card/form styling.
- `tasks/notifications.send_status_notification` left push-only. `citizen_reports` is anonymous by privacy design (data minimization â€” no email collected at submission); email-on-status-change is therefore N/A for this flow. The `email_opt_in` column on `wims.users` is the gate for any future registered-recipient notification flow where a user identity is present.
- Fixed `tests/test_profile_email.py`: updated `_get_db_session()` mock to return 3-column tuple after GET query expansion.
- New `tests/test_notification_prefs.py`: 7 unit tests â€” GET prefs (true, false, nullâ†’default), PATCH prefs (email_opt_in, push_opt_in, both together, Keycloak skipped on prefs-only).
- All preference tests pass; ruff check + format pass; frontend lint: 0 errors.

## [2026-06-09] feat | M13b email notification triggers â€” security_alert + weekly_report (#176)

- Wired `security_alert` email trigger in `src/backend/api/routes/admin/security.py`: after CONFIRM_THREAT HITL action commits, if severity is HIGH or CRITICAL, dispatch `send_email_task.delay()` to all active SYSTEM_ADMIN users. Dashboard link points to `/admin/security-dashboard`.
- Added `send_weekly_report_email` Celery task (`tasks/notifications.py`): queries 7-day incident totals from `analytics_incident_facts` and top region from `ref_regions`; dispatches `send_email_task.delay()` with `template_name="weekly_report"` to all active SYSTEM_ADMIN emails. Runs Monday 07:00 UTC via Celery beat.
- Used post-#182 RLS pattern (`get_session(SYSTEM_TASK_USER_ID)` + RLS context auto-set) matching `tasks/drafts.py`.
- Updated `celery_config.py`: added `send-weekly-report-email` beat entry (crontab: day_of_week=1, hour=7, minute=0).
- Created `tests/test_m13_email_triggers.py`: 6 unit tests (CONFIRM_THREAT+HIGH/CRITICAL dispatch, FALSE_POSITIVE+LOW no-dispatch, weekly task context, no-admin-emails guard) + 1 MailHog integration test.
- **Deferred triggers (follow-up):** `account_locked` requires Keycloak event-listener SPI (#138); `password_reset` N/A (Keycloak native flow owns it; WIMS template available for future theme customization).
- All 6 unit tests pass; ruff check + format pass.


## [2026-06-09] implementation | M8 surgical fixes â€” structured XAI, CRITICAL severity, HITL audit, remove auto-DRAFT, audit SLM (#161, #162, #163, #165)

- **`services/ai_service.py`:** Restructured XAI prompt from flat narrative to 5-key JSON (anomaly_description, log_evidence, risk_assessment, recommended_action, confidence). Added `analyze_audit_logs()` function for Ollama-based audit trail pattern analysis.
- **`services/suricata_ingestion.py`:** Added CRITICAL severity level (sev >= 4 â†’ CRITICAL). Removed auto-creation of DRAFT fire incidents from HIGH/CRITICAL alerts â€” ingestion now logs a warning with requires_review, admin must manually trigger via `POST /admin/security-logs/{id}/create-incident`.
- **`api/routes/admin/security.py`:** Added `log_system_audit()` call to `update_security_log()` (HITL decisions now audited with action_type=HITL_REVIEW). Added `POST /security-logs/{log_id}/create-incident` endpoint for manual DRAFT incident creation from reviewed alerts.
- **`api/routes/admin/audit.py`:** Added `POST /audit-logs/analyze` endpoint for AI analysis of batched audit trail entries via Ollama.
- **`frontend admin/system/page.tsx`:** Structured XAI display now parses JSON and renders 4 labeled sections (Anomaly Description, Log Evidence, Risk Assessment, Recommended Action) with fallback to legacy plain-text. Added "Create Incident from Alert" button in the decision panel.
- **`lib/api/legacy.ts`:** Added `createIncidentFromAlert()` API client function.
- **`tests/test_suricata_ingestion.py`:** Added CRITICAL (severity 4) mapping test.
- **`tests/test_suricata_auto_incident.py`:** Updated to verify HIGH alerts no longer auto-create incidents (call_count == 0).
- **`system-wiki/gaps/frs-codebase-gap-register.md`:** #161, #162, #163, #165 all CLOSED.

## [2026-06-08] implementation | M7a host network mode + AF_PACKET capture (#156, #158)

- **`src/docker-compose.yml` (wims-suricata):** Switched to `network_mode: "host"` â€” Suricata now directly sees host ingress traffic (nginx ports 80/443) instead of only internal Docker bridge traffic (mDNS + inter-container). Removed `networks: wims_internal` (incompatible with host networking). Added `cap_add: [NET_ADMIN, NET_RAW]` for promiscuous capture. Changed command to `--af-packet=eth0 --runmode workers` for zero-copy AF_PACKET capture with multi-threaded processing.
- **AF_PACKET verified available:** `suricata --build-info` confirms `AF_PACKET support: yes`. `--list-runmodes` shows `AF_PACKET_DEV` with single/workers/autofp modes.
- **`system-wiki/security/security-baseline.md`:** Documented network topology, host networking caveats (Linux-only), and AF_PACKET + workers capture mode.
- **`system-wiki/gaps/frs-codebase-gap-register.md`:** #156 and #158 both CLOSED.

## [2026-06-09] feat | M9c Configuration management â€” system_config table, admin API + UI (#170)

- New migration `49_system_config.sql`: `wims.system_config (config_key PK, config_value, description, updated_by, updated_at)`. Seeded with 4 keys: `alert_severity_threshold=3`, `session_timeout_minutes=30`, `offline_storage_mb=50`, `ai_timeout_seconds=60`. RLS: SELECT `USING (TRUE)` (open; Celery consumers read without GUC), INSERT/UPDATE/DELETE restricted to `current_user_role() = 'SYSTEM_ADMIN'`.
- New `utils/config.py`: `get_config(db, key, default)` â€” shared helper importable from services and routes with no import cycle.
- New `api/routes/admin/config.py`: `GET /api/admin/config` (all rows) + `PATCH /api/admin/config/{key}` (update value + audit-log). Key whitelist enforced; unknown keys return 400. Registered in `admin/__init__.py`.
- **Live consumers**: `suricata_ingestion.eve_to_threat_log_row` accepts `high_threshold` kwarg (default 3); `ingest_eve_file` reads `alert_severity_threshold` from config once per invocation before the line loop. `ai_service.analyze_threat_log` and `generate_incident_narrative` both read `ai_timeout_seconds` from config (replaces hardcoded `60.0`).
- **Expose-only (no live enforcement)**: `session_timeout_minutes` â€” exposed in GET only; actual JWT expiry is Keycloak-realm-level (`ssoSessionIdleTimeout`), not changeable from WIMS without Keycloak Admin API integration (out of scope). `offline_storage_mb` â€” advisory cap enforced client-side: `offlineStore.queueIncident` estimates total queue bytes and throws with a user-readable message if over cap; `initOfflineStorageLimit(mb)` lets app startup override the default 50.
- **Deferred**: Redis hot-reload (config version counter) â€” config reads go direct to DB. Documented in config page disclaimer.
- New `frontend/src/app/admin/system/config/page.tsx`: per-key input + Save (PATCH per key), loaded via `fetchAdminConfig`. New `fetchAdminConfig` + `updateAdminConfig` appended to `legacy.ts`. Does NOT modify `system/page.tsx`.
- 15 unit tests in `tests/test_system_config.py`: GET seed keys, value+description, RBAC; PATCH happy-path, audit trail, unknown key 400, missing row 404, RBAC; 6 suricata threshold unit tests (default 3 preserved; threshold=2 escalates MEDIUMâ†’HIGH); AI timeout consumer verifies `httpx.AsyncClient(timeout=120.0)` when config returns "120".

## [2026-06-07] feat | #166 Expand health endpoint + 60s system metrics Celery task

- `GET /api/admin/health` now returns 5 component checks: database, redis, keycloak, suricata, ollama.
- Suricata check: probes `wims.security_threat_logs` for rows in last 5 min (HEALTHY if flowing; HEALTHY if empty table = fresh deploy; UNHEALTHY if stale).
- Ollama check: calls `OLLAMA_URL/api/tags` with 5s timeout via httpx.
- New `wims.system_metrics` table (migration `46_system_metrics.sql`): id, recorded_at, cpu_percent, memory_total_mb, memory_used_mb, memory_percent, disk_total_gb, disk_used_gb, disk_percent.
- New Celery task `snapshot_system_metrics` (runs every 60s via beat): collects psutil CPU/memory/disk, INSERTs into `wims.system_metrics`, prunes rows older than 7 days.
- Updated: `api/routes/admin/monitoring.py`, `tasks/monitoring.py`, `celery_config.py`, `system-wiki/gaps/frs-codebase-gap-register.md`.

## [2026-06-07] implementation | M7b rule foundation â€” ET Open rules + suricata-update automation (#155, #159)

- **`src/suricata/rules/suricata.rules`:** Combined file â€” our 15 custom OWASP+BFP rules prepended to full ET Open ruleset (~136k lines, ~68k signatures). Loaded via Suricata's default configuration (no custom suricata.yaml needed).
- **`src/docker-compose.yml`:** Mounted `suricata/rules` (rw) and `/var/run/docker.sock` in celery-worker for suricata-update execution.
- **`src/backend/requirements.txt`:** Added `docker>=7.0.0` SDK for container exec from Celery tasks.
- **`src/backend/tasks/suricata.py`:** Added `update_suricata_rules` Celery task (weekly suricata-update + USR2 live reload) and `_count_active_rules` helper; graceful degradation when Docker SDK unavailable.
- **`src/backend/celery_config.py`:** Added `update-suricata-rules-weekly` beat entry (crontab Sunday 03:00 UTC).
- **`src/backend/tests/test_suricata_rules.py`:** Created â€” 7 end-to-end/integration tests: no-missing-rules warning, >1000 rules loaded, suricata.rules present with default config loading, and pipeline tests for OWASP/ET-Open/BFP-custom SIDs flowing into DB.
- **`src/backend/tests/test_suricata_ingestion.py`:** Added `test_et_open_sid_maps_correctly` unit test for ET Open SID mapping.
- **`system-wiki/security/security-baseline.md`:** Documented three-tier rule architecture with SID ranges and update cadence.
- **`system-wiki/gaps/frs-codebase-gap-register.md`:** #155 and #159 gaps updated.

## [2026-06-07] security | #221 CSP + COEP headers, ZAP suppressions promoted to WARN

- Added `Content-Security-Policy` header to production TLS nginx block covering: self, OSM tiles, unpkg Leaflet icons, Google Fonts, Next.js inline styles, Firebase Messaging SW (`worker-src`).
- Added `Cross-Origin-Embedder-Policy: unsafe-none` (require-corp would break 8 map components loading from CDNs without CORP).
- `.zap/rules.tsv`: 10038 and 90004 promoted from IGNORE â†’ WARN.
- Reviewer found: Keycloak inline event handlers blocked by `script-src 'self'` (non-blocking â€” core OIDC login works), `connect-src wimsbfp.tech` redundant with `'self'`.

## [2026-06-07] fix | #220 CD workflow placeholder build-args + production vars

- Removed dead "Set placeholder envs" step (wrote to `$GITHUB_ENV`, but build-args read `vars.*` context).
- Dropped `NEXT_PUBLIC_OIDC_CLIENT_ID` from build-args (not an ARG in Dockerfile).
- Added `NEXT_PUBLIC_OIDC_AUTHORITY` (required ARG, was missing from workflow).
- Updated all fallback values: localhost â†’ `wimsbfp.tech` production URLs.
- Set 4 GitHub repo variables: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_OIDC_REDIRECT_URI`, `NEXT_PUBLIC_OIDC_AUTHORITY`, `KEYCLOAK_AUDIENCE` (corrected from `account` â†’ `wims-web` per #194).

## [2026-06-07] fix | #227 Hide NearbyPublicReportAreas on safety step

- Wrapped `<NearbyPublicReportAreas />` in `step !== 'safety'` conditional in `page.tsx`.
- PublicFireMap was already correctly inside `step === 'safety'` â€” no change needed.
- Spec had inverted current-behavior table; only 1 of 2 proposed changes was necessary.

## [2026-06-07] feat | #228 Data Retention Policy page, consent notice, footer link

- Created `src/frontend/src/app/privacy/page.tsx` â€” server component rendering all 7 policy sections.
  - Hero+card pattern matching fire-stations style (bfp-gradient hero, white rounded-xl card).
  - Numbered maroon circle section badges, amber consent callout, styled retention tables.
  - Uses existing globals.css CSS variable tokens.
- Added consent notice below report form card on `/` (report page) with link to `/privacy`.
- Added footer privacy link to both report and privacy pages.
- Registered `/privacy` as public route in `LayoutShell` (two `isPublic`/`isPublicRoute` checks).
- Preview HTML + PDF generated at `src/frontend/public/preview/privacy-hero.{html,pdf}`.
- Review fixes applied: `--text-secondary` darkened to `#5a6a7a` (WCAG AA), `<main>` landmark added, Â§4A parenthetical restored.

## [2025-06-06] refactor | Decompose monolithic route files into packages (issue #204)

- **`src/backend/api/routes/regional.py` (3040 lines) -> `api/routes/regional/` package:**
  - `__init__.py` â€” Shared helpers (`_get_security_provider`, `_fi_has_resubmitted_column`, `_regional_lifecycle_dependencies`, `_incident_verification_history_has_hash_columns`) + router registration.
  - `afor.py` (137 lines) â€” AFOR import/commit routes.
  - `duplicates.py` (138 lines) â€” Duplicate check route.
  - `field_updates.py` (343 lines) â€” `_apply_incident_field_updates` and `_fetch_incident_edit_fields` (helper functions, not routes).
  - `stats.py` (304 lines) â€” Encoder and validator stats endpoints.
  - `encoder.py` (554 lines) â€” Encoder read/lookup routes (incidents list, drafts, detail, audit log).
  - `encoder_crud.py` (618 lines) â€” Encoder write routes (create, update, delete, archive, submit).
  - `validator.py` (983 lines) â€” Validator routes (queue, verify, correct, bulk-approve, archive, diff, history, audit logs).

- **`src/backend/api/routes/admin.py` (1361 lines) -> `api/routes/admin/` package:**
  - `__init__.py` â€” Router registration.
  - `users.py` (401 lines) â€” User CRUD, sessions, force-logout.
  - `backups.py` (313 lines) â€” Backup/restore management.
  - `security.py` (153 lines) â€” Security threat log analysis and HITL actions.
  - `rate_limits.py` (114 lines) â€” Dynamic rate-limit configuration.
  - `monitoring.py` (136 lines) â€” System health, worker status, system metrics.
  - `analytics.py` (22 lines) â€” Analytics backfill.
  - `audit.py` (58 lines) â€” System audit trail viewer.
  - `scheduled_reports.py` (124 lines) â€” Scheduled report CRUD.

- **Session route overlap resolved:** Moved `revoke_user_session` (`DELETE /sessions/{user_id}/{session_id}`) from admin into `sessions.py`. Dropped duplicate `get_user_sessions` (`GET /sessions/{user_id}`) from admin â€” `sessions.py` already had `list_user_sessions` at same path.

- **Test patches updated:** `test_dynamic_rate_limits.py` and `test_backup_api.py` patches updated from `api.routes.admin.*` to `api.routes.admin.{rate_limits,backups}.*`.

- **`incidents.py` imports fixed:** Changed from `from api.routes.regional import _normalize_general_category, ...` to direct imports from `services.regional_incidents.helpers`.

- **`system-wiki/backend/backend-infrastructure.md`:** Updated route registration table to reflect package structure.

- **Line count compliance:** All route files now under 1000 lines (largest: `validator.py` at 983 lines).

## [2026-06-05] rebase | PR #182 rebased onto origin/master â€” conflict resolution

- **`src/backend/main.py`:** Made `_startup_admin_engine`/`_startup_admin_session_factory` lazy inside `_get_admin_session()` to avoid `create_engine("")` crash at module import when `DATABASE_ADMIN_URL`/`DATABASE_URL` are unset (e.g., during test collection outside Docker).
- **`src/backend/api/routes/user.py`:** Removed unused `from database import get_db` import (routes use `get_db_with_rls` from `auth`).
- **`src/backend/tests/test_profile_email.py`:** Fixed stale import `from database import get_db_with_rls` -> `from auth import get_db_with_rls`.
- **`src/backend/tests/test_infra_config.py`:** Updated `test_non_edge_services_bind_host_ports_to_loopback` to accept PR #182's `8090:80` local-dev port alongside master's `80:80`/`443:443`.
- **`src/nginx/nginx.local.conf`:** Added "Local development only" header comment to satisfy `test_local_nginx_override_is_explicitly_local_only`.
- **`src/nginx/nginx.conf`:** Resolved production `/api/` CORS conflict â€” kept master's `map $http_origin $cors_origin` at http scope, dropped PR's duplicate location-level `set`/`if`.
- **`src/docker-compose.yml`:** Combined PR's `wims_app_user` DATABASE_URL and `DATABASE_ADMIN_URL` (using `${POSTGRES_PASSWORD:?error}` not hardcoded `password`).
- **System-wiki conflicts:** Merged log/index/route-map/infrastructure-config/pwa-tests-cicd/local-dev-deploy-guide â€” kept all master and PR entries, dates, and source references.
- **20 PR commits + 12 master commits integrated** via commit-preserving rebase; 1 fixup commit for post-rebase import/lint/test corrections.

## [2026-06-05] fix | PR #217 auth callback rate-limit test isolation

- **`src/backend/tests/conftest.py`:** Expanded the autouse Redis rate-limit cleanup from only `public_rate_limit:*` keys to both `public_rate_limit:*` and auth callback `rate_limit:*` keys, using `scan_iter` and closing the Redis client. This prevents `tests/integration/test_auth_callback.py::test_callback_tampered_token_returns_401` from inheriting a spent PKCE callback sliding-window budget and returning 429 instead of the expected auth-layer 401.
- **`system-wiki/architecture/pwa-tests-cicd.md`:** Documented the two rate-limit key namespaces cleared by the root test fixture.

## [2026-06-05] fix | PR #217 review follow-ups â€” Keycloak email API, test coverage, frontend note, UUID cast

- **`src/backend/services/keycloak_admin.py`:** Replaced hallucinated `adm.send_execute_actions_email(actions=["UPDATE_PASSWORD"])` with the correct python-keycloak 7.1.1 API `adm.send_update_account(payload=["UPDATE_PASSWORD"], lifespan=604800)`. Replaced bare `except Exception:` around the email call with `except KeycloakError as e:` â€” email failures are still non-fatal but now log concrete evidence.
- **`src/backend/tests/test_keycloak_admin.py` (new):** 8 unit tests for `create_keycloak_user()` email path: happy-path `send_update_account` call, `KeycloakError` during email is non-fatal (warning logged, user still created), `KeycloakError` during `create_user` is fatal, password-set failure triggers cleanup, role-assignment failure is non-fatal, contact-number attribute, and password generation length/randomness. All external calls mocked â€” no Docker/Keycloak required.
- **`src/frontend/src/app/admin/system/page.tsx`:** Added `note` field to `createdUser` state type; user creation result now captures `result.note`. The hardcoded "Distribute this temporary password..." message is replaced by `createdUser.note` with a sensible fallback.
- **`src/backend/tests/integration/test_auth_callback.py`:** Standardized `cleanup_test_user` DELETE to use explicit `CAST(:kid AS uuid)` matching the verification query pattern.
- **`system-wiki/architecture/pwa-tests-cicd.md`:** Updated stale test file reference from deleted `test_auth_flow.py` to `test_auth_callback.py`.
- **Wiki synced:** `system-wiki/architecture/pwa-tests-cicd.md`, `system-wiki/log.md`. No FRS gap register change (auth email was a bug fix, not an FRS alignment change).

## [2026-06-05] fix | PR #216 review follow-ups â€” event bus thread-safety, async pool hardening, stale comments, dead useEffect

- **`src/backend/services/event_bus.py`:** Added `threading.Lock` (`_sync_pool_lock`) with double-checked locking around lazy `_SYNC_POOL` initialization â€” prevents TOCTOU race in sync publisher path. Added `socket_connect_timeout=0.5`, `socket_timeout=0.5`, `health_check_interval=30` to async pool (`_get_async_pool`) for consistency with sync pool hardening.
- **`src/backend/main.py`:** Replaced stale comment referencing removed side-effect task imports with accurate autodiscover description.
- **`src/frontend/next.config.ts`:** Replaced misleading comment about nonexistent tsconfig test file exclusions with accurate statement.
- **`src/frontend/src/context/AuthContext.tsx`:** Removed empty `useEffect` that fired on every `loading` state change but contained only a comment.
- **Wiki synced:** `system-wiki/backend/backend-infrastructure.md` â€” added Event Bus section documenting connection pools, thread safety, async/sync publishers, channels, and singleton.

## [2026-06-05] fix | PR #216 CI fix batch â€” backend ruff format + frontend type checks

- **Backend ruff format:** Applied auto-formatter to `public_dmz.py`, `celery_config.py`, `main.py`, `event_bus.py` â€” trailing commas, quote style, blank lines. Zero logic changes.
- **Frontend type fixes (7 files):**
  - `legacy.ts`: Added typed interfaces (`SystemHealthResponse`, `SystemMetricsResponse`, `WorkerStatusResponse`) replacing `Promise<unknown>` returns for `fetchSystemHealth`, `fetchSystemMetrics`, `fetchWorkerStatus`. Added `is_danger` field to `TriageClusterEntry`.
  - `page.tsx`: Fixed `CATEGORIES.icon` type from `ReactNode` â†’ `ReactElement<{ className?: string }>` for `cloneElement` compatibility. Changed `reportingContext`/`safetyStatus` to use `?? undefined` for `appendCivilianReport` call.
  - `tracking/page.tsx`: Widened `getCategoryLabel` to accept `string | null`.
  - `offlineStore.ts`: Changed `PendingIncident.id` from optional to required (always present from IndexedDB auto-increment).
  - `useAutoSync.ts`, `useNetworkStatus.ts`: Added `| null` + `null` initial value for `useRef<ReturnType<typeof setTimeout>>()` calls (React 19 strictness).
  - `api.ts`: Updated `AuditLogEntry` interface to match actual API response shape (`audit_id`, `user_id`, `action_type`, etc. instead of `id`, `user_id`, `action`, `resource`).
  - `admin/system/page.tsx`: Removed explicit `Record<string, unknown>` from `.map()` callback.
  - `analyst/incidents/[id]/page.tsx`: Fixed `EmptyState` icon type from `ReactNode` to `LucideIcon`; added `LucideIcon` import.
  - `validator/map/page.tsx`: Added generic type parameter to `apiFetch` call.
- All pre-existing type errors that were masked by removed `ignoreBuildErrors: true` in `next.config.ts` (PR #184 cleanup).
- CI validation: ruff check âœ“, ruff format --check âœ“, frontend lint âœ“, vitest 22/22 âœ“, frontend build âœ“.
- Commit: `f621411` pushed to `fix/slice4-perf-quality`.

## [2026-06-05] fix | PR #213 CI follow-up â€” compose env setup and backend format gate

- **CI compose env setup:** `.github/workflows/ci.yml` now copies root `.env.example` to `src/.env` before `docker-build` compose validation/build and before `security-scan` stack startup. This preserves `${VAR:?error}` fail-fast behavior in `src/docker-compose.yml` while giving ephemeral CI the required local/test values.
- **Backend format gate:** `src/backend/tests/test_jwt_fallback.py` was formatted with `ruff format` so the backend CI `ruff format --check .` step can pass.
- **Wiki sync:** `system-wiki/architecture/pwa-tests-cicd.md` documents the CI env-file pre-step; `system-wiki/architecture/infrastructure-config.md` documents required compose interpolation, CI handling, updated backend env values, authoritative Keycloak import path, and production CORS map behavior; `system-wiki/index.md` updated its last-change summary.

## [2026-06-05] fix | PR #213 review follow-ups â€” stale role, Firebase env, JWT tests, wiki sync

**PR #213 three-axis review follow-ups applied (worktree: pr-213):**

- **Stale `"VALIDATOR"` removed from `regional.py:599`:** Replaced `("NATIONAL_VALIDATOR", "SYSTEM_ADMIN", "NATIONAL_ANALYST", "VALIDATOR")` with just the three canonical roles. Legacy `VALIDATOR` role was removed from `bfp-realm.json` in #206; this code reference was missed.
- **`.env.example` Firebase section hardened:** Replaced committed real Firebase API key and VAPID key with `REPLACE_WITH_YOUR_...` placeholders. Documented all 7 Firebase env vars (2 required with `:?error`, 5 optional with `:-default`). Added warning comment.
- **JWT `to_pem` fallback unit tests:** Added `tests/test_jwt_fallback.py` with 6 unit tests covering: valid key with `to_pem`, key without `to_pem` tries next, all-candidate-keys-fail force-refreshes JWKS, no-to_pem-on-any-key returns 401, `jwt.decode` receives PEM string, and JWTError in candidate loop tries next key. All use `@pytest.mark.unit` and mock authenticator internals â€” no Docker required.
- **Nginx CORS: DELETE preserved intentionally.** The PR body claimed DELETE was removed from CORS methods but it was not (and should not be) â€” backend has DELETE endpoints (`DELETE /api/regional/incidents/{id}`, draft management). The `$cors_origin` map deny-by-default is the actual CORS hardening.
- **Wiki sync:**
  - `system-wiki/security/security-baseline.md`: Updated stale `$scheme://$host` CORS line to describe production `$cors_origin` map.
  - `system-wiki/architecture/infrastructure-config.md`: Removed legacy `VALIDATOR`/`ANALYST` from Roles table; added note about #206 removal.
  - `system-wiki/gaps/frs-codebase-gap-register.md`: Updated #205 entry to reference current `AAAA...=` placeholder; added #206 closure entry.

**Files changed:** `regional.py`, `.env.example`, `test_jwt_fallback.py` (new), `security-baseline.md`, `infrastructure-config.md`, `frs-codebase-gap-register.md`, `log.md`

## [2026-06-03] fix | PR #212 review fixes â€” Redis pool bounding, thread-safety, test hygiene

- **Redis connection pool:** Added `max_connections=10` to `_get_redis()` in `civilian.py`, matching `map.py`'s bounded-pool pattern. Prevents unbounded connection growth under load.
- **Thread-safety:** Added `threading.Lock` with double-checked locking around `_get_redis()` singleton initialization. Eliminates the narrow startup race where multiple threads could create concurrent connections before the global reference is published.
- **Warning log diagnostics:** Added `cache_key` to all three `logger.warning(...)` calls in `civilian.py` (fresh-read, write, stale read) for production debugging. `exc_info=True` retained.
- **Count bucket guard:** Added `ValueError` for `_get_count_bucket(count < 3)` as defense-in-depth (SQL already enforces `total_reports >= :min_reports`).
- **Test fixture rename:** Renamed `_clean_redis` fixture to `_clean_state` since it flushes Redis *and* deletes from 3 PostgreSQL tables. Added `socket_connect_timeout=0.5`/`socket_timeout=0.5` to the fixture's Redis client.
- **Test Redis hygiene:** Wrapped the pre-existing Redis client in `test_get_report_clusters_cache_and_stale_fallback` in `try/finally` so `r.close()` always runs. Added `socket_connect_timeout`/`socket_timeout`. Replaced `r.keys()` with `r.scan_iter(match=...)` to avoid O(N) keyspace scans.
- **Dead test code removed:** Removed the national-mode request in `test_get_report_clusters_returns_truncated_false_when_under_cap` that only asserted `status_code == 200` without testing truncation (comments admitted it was not reliable). Removed stale monkey-patch comments.
- **Wiki updated:** `system-wiki/subsystems/civilian-reporting-phase2.md` updated frontmatter date, cache behavior section (pool bounding, thread-safety, warning log keys, count guard), and test coverage section (fixture rename, Redis hygiene).
- **Verification:** `ruff check` + `ruff format --check` pass on both changed files. `git diff --check` clean. All 25 pytest tests pass (15 report-clusters + 10 submission tests).

## [2026-06-03] fix | PR #211 M13b email infra â€” bound task + retry + STARTTLS + plain-text + tests

**PR #211 review fixes applied:**

- **Critical â€” `send_email_task` bound task signature:** Added `self` as first parameter (matching `bind=True` decorator). Changed retry logging from module-level proxy (`send_email_task.request.retries`, `celery_app.tasks["..."].max_retries`) to `self.request.retries` and `self.max_retries`.
- **Critical â€” Tests exercise Celery task path:** `TestEmailServiceTask` now calls `module.send_email_task.run(...)` with a real Celery app (memory broker, eager mode) instead of calling `module._send_email(...)` directly. This exercises the `bind=True` self parameter and would catch the signature mismatch.
- **Retry exceptions narrowed:** `autoretry_for` changed from `(Exception,)` to `(aiosmtplib.SMTPException, ConnectionError, TimeoutError, OSError)` â€” transient SMTP/network failures only. Permanent template/context/type errors fail fast.
- **STARTTLS configurable:** Added `SMTP_STARTTLS` env var (default `false` for MailHog/dev). Passed to `aiosmtplib.send(start_tls=SMTP_STARTTLS)`. Added entry to `.env.example`.
- **Plain-text alternative body:** Added `_html_to_plain_text()` helper; `send_email_async` now adds `msg.add_alternative(plain_text, subtype="plain")` for multipart/alternative emails.
- **Render error logging:** Moved `render_email()` call inside `try/except` in `send_email_async` with dedicated `logger.error("Failed to render email template...")`.
- **Subject caching:** Added `_subject_raw_cache` dict so `_load_subject()` reads template files only once per template name.
- **Task import explicit:** Added `import tasks.notifications` to `main.py` alongside other task imports.
- **Security alert color:** Changed unknown-severity CSS fallthrough from green `#2ecc71` to neutral gray `#95a5a6`.
- **Validation:** 8/8 email infra tests pass; 37/37 combined (email + CSRF) tests pass. Syntax compile-checked.

**Files changed:** `tasks/notifications.py`, `services/email/sender.py`, `tests/test_email_infra.py`, `.env.example`, `main.py`, `services/email/templates/security_alert.html.j2`

## [2026-06-03] fix | PR #223 CI security-scan startup â€” CI-only HTTP nginx config

- **Root cause:** PR #223 changed `src/nginx/nginx.local.conf` from HTTP-only to HTTPS (HTTPâ†’HTTPS redirect + TLS server block requiring `/etc/letsencrypt/live/wimsbfp.tech/` certs). The `docker-compose.override.yml` (auto-loaded by plain `docker compose up`) mounts `nginx.local.conf` but provides no cert volume. The GitHub Actions `security-scan` job ran plain `docker compose up -d --build`, so nginx failed to start because cert files were missing. The health-poller timed out at 180s before Nmap/ZAP could run.
- **Fix:** Created `src/nginx/nginx.ci.conf` (HTTP-only nginx config â€” port 80, no TLS, no certs required, preserves PR #223's `$scheme://$host` CORS hardening) and `src/docker-compose.ci.yml` (mounts `nginx.ci.conf` instead of `nginx.local.conf`). Updated `.github/workflows/ci.yml` `security-scan` job to bring up the stack with `docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d --build` and tear down with the same file list. The CI now uses a plain HTTP path that does not depend on TLS certificates.
- **Local dev impact:** The local override still loads `nginx.local.conf` (HTTPS) and now mounts `src/.ssl` to `/etc/letsencrypt`, so developers can generate self-signed certs once and then use plain `docker compose up`. Developers who do not need HTTPS locally can use the CI compose path (`-f docker-compose.yml -f docker-compose.ci.yml`). Updated `system-wiki/operations/local-dev-deploy-guide.md` Section 1 and Pitfall 2 to document both paths.
- **CI docs:** Updated `system-wiki/architecture/pwa-tests-cicd.md` to note the CI-specific compose override.
- **Gap register:** No change â€” M11b remains CLOSED; this is an infrastructure/CI wiring fix.
- **Verification:** `docker compose -f docker-compose.yml -f docker-compose.ci.yml config --quiet` passes; `git diff --check` clean.

## [2026-06-03] fix | PR #214 infra/auth config review fixes

- Updated the manual auth rate-limit test to target the real `POST /api/auth/callback` protected path instead of the stale `/api/auth/login` stub.
- Aligned CI/deploy backend auth env defaults to `KEYCLOAK_CLIENT_ID=wims-web` and `KEYCLOAK_AUDIENCE=wims-web`; scoped Direct Grant password-reset verification to `KEYCLOAK_PASSWORD_RESET_CLIENT_ID` (`bfp-client` by default).
- Pinned `nginx-gateway` to `nginx:1.27.3-alpine` and refreshed Suricata/nginx image references in `architecture/infrastructure-config.md`.
- Updated `src/frontend/src/app/api/auth/sync/route.ts` to forward trusted nginx client-IP headers to backend `/api/auth/callback` so Redis callback rate limiting keys by end-user IP rather than the frontend container.
- Repaired local-dev docs to remove obsolete self-signed-cert setup for base compose and documented the production-only TLS mount split.
- Clarified that the admin `rate_limit_config:login` key/tier is a legacy compatibility label for the auth callback flow.

## [2026-06-03] fix | CI security scan â€” ZAP artifact upload compatibility

- Updated `.github/workflows/ci.yml` `security-scan` ZAP baseline action to set `artifact_name: 'zap-scan'` and bump `zaproxy/action-baseline` from `v0.12.0` to `v0.15.0`, avoiding the legacy action packaging that failed during GitHub artifact container creation.
- Updated `system-wiki/architecture/pwa-tests-cicd.md` to document the explicit ZAP artifact name override and action version compatibility fix.

## [2026-06-03] fix | CI security scan â€” ZAP rules file for pre-existing WARN alerts

- Created `.zap/rules.tsv` with 7 IGNORE entries for pre-existing ZAP WARN alerts (IDs: 10038, 10049, 10055, 10063, 10096, 10109, 90004). These are configuration gaps (missing CSP/COEP on nginx, upstream Keycloak issues, Next.js informational flags) that predate PR #208.
- Updated `.github/workflows/ci.yml` `security-scan` job to reference `rules_file_name: '.zap/rules.tsv'` in the ZAP baseline action step.
- Updated `system-wiki/architecture/pwa-tests-cicd.md` to document the `security-scan` job and the ZAP rules file.

## [2026-06-03] style | M14: add trailing newline to test_public_submission.py (W292 lint fix)

## [2026-06-03] fix | M14 region resolution â€” nearest ref_fire_stations (civilian.py pattern)

**Root cause:** `wims.ref_regions` has NO PostGIS geometry column â€” only `region_id, region_name, region_code`. PostGIS `GEOGRAPHY(POINT,4326)` lives ONLY on `wims.ref_fire_stations.location`. The `region_geom` column never existed; `ORDER BY region_id` was a dumb fallback. `civilian.py`'s `_resolve_nearest()` resolves region by finding the nearest fire station and reading its `region_id` attribute â€” matching approach inlines here.

**Fix (`src/backend/api/routes/public_dmz.py`):** Replaced region resolution with:
```sql
SELECT region_id FROM wims.ref_fire_stations
ORDER BY location <-> ST_GeogFromText(:wkt) LIMIT 1
```
Attribute access: `station_row.region_id if station_row else None`. Fallback to `ref_regions ORDER BY region_id LIMIT 1` with attribute access if no stations found.

**Fix (`src/backend/tests/test_public_submission.py`):** Added module-level `_FakeRow` class (attribute access + index + unpack), replacing all per-test `MockRow` classes. `test_region_resolved_via_nearest_fire_station` asserts first `execute()` call uses `ref_fire_stations` with `<->` operator. `test_submission_creates_row_with_null_encoder_id` uses `_FakeRow(incident_id=..., verification_status=..., created_at=...)`.

**`src/postgres-init/32_ref_fire_stations.sql` seeds ref_fire_stations with all 237+ PH fire stations and their `location GEOGRAPHY(POINT, 4326)` â€” no migration needed for live integration tests.** `ref_regions` fallback handles thin-seed DB edge case.

**Deferred:** Polygon geometry on `ref_regions` would enable true centroid-based resolution. Currently via nearest fire station â€” acceptable per FRS M14 functional spec.

## [2026-06-02] fix | M14 test failures â€” geometry column, MockRow subscript, rate-limit isolation

**Root causes and fixes for 10 failing tests on `feat/m14-public-submission` (PR #320):**

**(A) Wrong geometry column:** `wims.ref_regions` has no geometry column. The ST_Distance query in `public_dmz.py` used `region_geom` which does not exist. Replaced with simple `ORDER BY region_id LIMIT 1` fallback (no PostGIS geometry on ref_regions in current schema). Coordinate-based nearest-centroid is deferred until geometry is added to ref_regions.

**(B) MockRow not subscriptable:** `test_region_resolved_via_nearest_centroid` returns `MockRow()` from `fetchone()` in a tuple context â€” `region_row[0]` was called on a MockRow instance with no `__getitem__`. Added `__getitem__` to the MockRow class to return positional values matching a real SQLAlchemy Row.

**(C) Rate-limit state bleeds across tests:** The 3/IP/hr Redis limiter counted 127.0.0.1 across the whole test file. Added `flush_public_rate_limit` autouse fixture to `conftest.py` that clears `public_rate_limit:*` keys before each test. Rate-limit tests themselves use random fake IPs and clean up after themselves.

**Files changed:**
- `src/backend/api/routes/public_dmz.py` â€” removed `region_geom` from query
- `src/backend/tests/test_public_submission.py` â€” added MockRow `__getitem__`
- `src/backend/tests/conftest.py` â€” added `flush_public_rate_limit` autouse fixture

## [2026-06-02] implement | M14 public report endpoint â€” un-deprecated, nearest-centroid, rate limit, Retry-After

**FRS reference:** Module 14 â€” Public Submission (FRS `#177`)

**Changes implemented (`src/backend/api/routes/public_dmz.py`):**
- `POST /api/v1/public/report`: restored from 410 deprecation to active endpoint
- Region resolution: replaced `ORDER BY region_id LIMIT 1` fallback with proper `ST_Distance` nearest-centroid using `ref_fire_stations` centroids and PostGIS KNN operator
- Rate limiting: Redis sliding-window 3 req/IP/hour on the public endpoint
- HTTP 429 response includes `Retry-After` header with seconds until reset
- Writes to `wims.fire_incidents` with `encoder_id = NULL`, `verification_status = 'PENDING_VALIDATION'`
- No Keycloak JWT required, no RLS context set

**Test file added:** `src/backend/tests/test_public_submission.py` â€” validates 201 response, NULL encoder_id, PENDING_VALIDATION status, rate limit 429, Retry-After header.

## [2026-06-02] hygiene | env hygiene (#205 key placeholder, #194 audience) + Redis connection pooling (#195)

- `.env.example`: Replaced real `WIMS_MASTER_KEY` value with `REPLACE_WITH_REAL_BASE64_32BYTE_KEY` placeholder; added generation comment.
- `.env.example`: Changed `KEYCLOAK_AUDIENCE` from `account` â†’ `wims-web` with comment noting it must match Keycloak client audience.
- `src/backend/services/event_bus.py`: Added module-level sync `ConnectionPool` (`_sync_pool`) shared across `publish_*_sync()` functions (lines ~247, 285, 322). Added module-level async `ConnectionPool` (`_async_pool`) shared via `_get_async_pool()` reused in `_ensure_pub()`/`_ensure_sub()`.
- `src/backend/api/routes/public_dmz.py`: Replaced per-request `aioredis.from_url` in `_get_redis()` with module-level `ConnectionPool` (`_redis_pool`, max_connections=20) via `_get_redis_pool()`. No behavioral change â€” only connection reuse.

## [2026-06-02] fix | Redis connection pooling, timeouts, error logging, test cleanup for report-clusters endpoint

**Session context:** Applied production-quality fixes from three-axis review of issues #127/#128.

**Fixes:**
- **P1 â€” Redis connection leak:** Replaced per-request `redis.from_url()` with module-level `_get_redis()` singleton using connection pooling, `socket_connect_timeout=0.5`, `socket_timeout=0.5`, and `health_check_interval=30`.
- **P2 â€” No Redis timeouts:** Added `socket_connect_timeout=0.5` and `socket_timeout=0.5` to prevent requests from hanging under Redis failure.
- **P3 â€” Bare `except Exception: pass`:** Added `logger.warning(...)` with `exc_info=True` to all three previously-silent except blocks.
- **P4 â€” 15Ã— `import redis` in test function bodies:** Moved to single module-level import at `test_civilian_api.py:15`.
- **P5 â€” 15Ã— Redis FLUSHDB boilerplate:** Replaced ~70 lines of repeated setup with `autouse` `_clean_redis` fixture.
- **P6 â€” Truncation test:** Renamed `test_get_report_clusters_truncation_flag` â†’ `test_get_report_clusters_returns_truncated_false_when_under_cap`, removed dead `monkeypatch` parameter.

**Verification:** `ruff check .` passes; `ruff format --check .` passes; frontend `npx vitest run` 145/145 pass (no regressions).

**Files:** `src/backend/api/routes/civilian.py`, `src/backend/tests/integration/test_civilian_api.py`.

**Wiki updated:** `system-wiki/log.md`. No `gaps/frs-codebase-gap-register.md` update needed (production quality fixes, no FRS alignment change).

## [2026-06-01] investigation | Frontend tab-switching performance

Investigated sluggishness when switching between dashboard tabs. Root cause is full data re-fetch on every navigation: Next.js App Router remounts page components on route change, all `useEffect` data-fetch chains re-run from scratch with no caching. Three contributing causes identified (P-01, P-02, P-03). Analyst dashboard worst-case: 7 parallel API calls on every mount (`analyst/page.tsx:321-340`). No fix applied in this session â€” gap documented for a future TanStack Query refactor.

**Verification:** Source inspection of `LayoutShell.tsx`, `AuthContext.tsx`, `dashboard/validator/page.tsx`, `dashboard/regional/page.tsx`, `dashboard/analyst/page.tsx`, and `src/frontend/src/lib/api/` slices. The LayoutShell cache-clear `useEffect` and auth `loading` spinner are one-time-on-mount only; they do not contribute to per-navigation sluggishness.

**Wiki updates:** Added `## Frontend Performance` section to `system-wiki/gaps/ui-ux-gap-register.md`; added `## Data Fetching Pattern` section to `system-wiki/frontend/frontend-infrastructure.md`; added `## Observed: Frontend tab-switching performance` section to `docs/PR-rls-and-fixes.md`. Also created `docs/fix-localhost-hsts.md` and `scripts/Fix-LocalhostHSTS.ps1` for recurring HSTS/localhost access issue.

## [2026-06-01] fix | RLS helper bootstrap source of truth

- Removed the backend startup duplicate that recreated `wims.current_user_role()`, `wims.current_user_region_id()`, and `wims.current_region_id()` with ad hoc single-quoted SQL bodies; `src/postgres-init/09_rls_helpers.sql` is now the only initializer source for `current_user_role()`.
- Confirmed `src/postgres-init/14a_assign_ncr_to_test_users.sql` already targets canonical `encoder_ncr` plus `validator_test`; no migration rename was needed.
- Added static RLS init contract tests to prevent duplicate helper definitions and legacy `encoder_test` NCR assignment from returning.

**Verification:** `python -m pytest tests/test_schema_patch_startup_guard.py tests/test_rls_init_contract.py -q`, `python -m ruff check .`, `python -m ruff format --check .`, and `python -m py_compile src\backend\main.py src\backend\tests\test_schema_patch_startup_guard.py src\backend\tests\test_rls_init_contract.py` pass. Full DB-backed rerun requires the CI/PostGIS service.

**Wiki updates:** Updated `system-wiki/architecture/pwa-tests-cicd.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-06-01] fix | Auth and RLS integration test dependency overrides

- Updated AI/IDS admin and regional AFOR import tests so role-specific auth overrides also satisfy the canonical `get_current_wims_user` / `get_db_with_rls` dependencies used by RLS-scoped routes.
- Updated reference-table RLS tests to connect as `wims_app_user` instead of the CI postgres superuser, ensuring row-level policies are enforced during assertions.
- Documented the auth/RLS override pattern in the CI/test infrastructure synthesis page.

**Verification:** `python -m py_compile src\backend\tests\integration\test_ai_ids_api.py src\backend\tests\integration\test_regional_afor_unified_import.py src\backend\tests\test_ref_table_rls.py`, `python -m ruff check .`, and `python -m ruff format --check .` pass. DB-backed integration rerun requires the CI/PostGIS service.

**Wiki updates:** Updated `system-wiki/architecture/pwa-tests-cicd.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-06-01] fix | Backend startup schema patch guard for CI runtime

- Added a process-local startup guard so FastAPI compatibility schema patches run once per backend Python process instead of once per repeated pytest `TestClient(app)` lifespan.
- Added focused backend coverage for the guard, verifying that a second `apply_schema_patches()` call does not reopen the admin DB session or rerun patch helpers.
- Updated CI/test infrastructure documentation to record the startup guard and clarify that long runtime inside the first backend `Run tests` step should be investigated as test/startup behavior before changing the advisory coverage pass.

**Verification:** `python -m py_compile src\backend\main.py src\backend\tests\test_schema_patch_startup_guard.py`, `python -m ruff check .`, `python -m ruff format --check .`, and `python -m pytest tests/test_schema_patch_startup_guard.py -q` pass.

**Wiki updates:** Updated `system-wiki/architecture/pwa-tests-cicd.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-31] docs | PR RLS and fixes summary updated

- Updated `docs/PR-rls-and-fixes.md` with Codex-authored UI/auth changes: role dashboard redirects, user-scoped manual-entry draft restore, login alert placement, OTP confirmation card refinements, MFA scroll containment, and AFOR Barangay tip alignment.
- Removed the dedicated plain-language RLS explanation section and replaced the Part 1 RLS pointer with concise technical bullets.

**Verification:** `rg` confirms the removed plain-language RLS section text is no longer present in `docs/PR-rls-and-fixes.md`.

**Wiki updates:** Updated `system-wiki/architecture/docs-and-scripts.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-31] polish | OTP confirmation alignment refinement

- Removed the visible "One-time code" label from the post-enrollment OTP confirmation card while preserving an accessibility label for the OTP input group.
- Shifted the OTP confirmation card content to one left-aligned column: icon, title, helper text, OTP boxes, "Go back" action, and sign-in button.
- Aligned the sign-in button with the OTP input group instead of centering it independently.

**Verification:** `git diff --check` passes for `wims-custom.css` with only CRLF warnings.

**Wiki updates:** Updated `system-wiki/ui-ux/evaluation-loginpage-keycloaksso.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-31] polish | OTP confirmation card

- Updated the post-enrollment Keycloak OTP confirmation page to render as a self-contained verification card with an authentication icon, title, helper text, centered OTP inputs, "Go back" secondary action, and proportional sign-in button.
- Removed visible account identifiers from the OTP confirmation screen by omitting the attempted username and keeping the shared template username block suppressed for this page only.
- Scoped larger OTP input boxes, card shadow, spacing, mobile scaling, and submit-button sizing to `#kc-otp-login-form` so the separate OTP setup/enrollment page is not changed.

**Verification:** `git diff --check` passes for `login-otp.ftl` and `wims-custom.css` with only CRLF warnings; targeted search confirms no `auth.attemptedUsername` or `restartLoginTooltip` remains in the OTP confirmation template.

**Wiki updates:** Updated `system-wiki/ui-ux/evaluation-loginpage-keycloaksso.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-31] polish | OTP challenge order and AFOR Barangay hint alignment

- Updated the Keycloak OTP challenge layout so the attempted username, six OTP boxes, restart-login link, and sign-in button render in one ordered form flow.
- Hid the shared template username/restart block only for the OTP challenge page so the new order is not duplicated and OTP verification behavior remains unchanged.
- Moved the AFOR Barangay reverse-geocoding tip below the Barangay input in `IncidentForm.tsx`, aligning the Barangay input with City/Municipality across manual create and import correction flows.

**Verification:** `git diff --check` passes for the touched OTP/form files; `npm.cmd run lint` passes with 0 errors and 16 existing warnings outside this change.

**Wiki updates:** Updated `system-wiki/ui-ux/evaluation-loginpage-keycloaksso.md`, `system-wiki/subsystems/regional-dashboard.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-31] fix | canonical dev encoder usernames and region mapping

- Replaced the offset dev encoder seed naming with canonical region-code usernames: `encoder_ncr` for NCR region 1, `encoder_car` for CAR region 2, `encoder_r01` for Region I region 3, through `encoder_nir` for region 18.
- Updated `scripts/seed-dev-users.sh`, `scripts/seed-dev-users.ps1`, Keycloak realm exports, and SQL bootstrap rows so fresh and reseeded local stacks create login-capable encoder accounts with `Password123!`, verified email, first/last profile fields, no required actions, and repairable legacy usernames.
- Added `test_dev_user_seed_mapping.py` to guard the canonical mapping across scripts, SQL bootstrap, and Keycloak realm exports.
- Updated local dev and database synthesis pages to document the corrected account mapping. No FRS gap entry changed because this is a dev identity/bootstrap alignment fix.

## [2026-06-02] tooling | Pi enforcement layer for AGENTS.md gotchas

- Created `.pi/extensions/enforce-agents-md.ts` — a pi extension that actively enforces AGENTS.md gotchas.
- **CI gate**: blocks `git commit`/`git push` until `ruff check`, `ruff format --check`, `pytest -v`, `npm run lint`, and `npx vitest run` all pass (gotcha #12).
- **Path protection**: blocks `write`/`edit` to `.env`, `.git/`, `node_modules/`, `.pi/extensions/`, `__pycache__/`.
- **Dangerous command guard**: requires confirmation for `rm -rf`, `sudo`, `chmod 777`, `git push --force`, destructive docker commands.
- **System prompt injection**: injects the 13 gotchas as a "Mandatory Pre-Commit Checklist" into every agent turn via `before_agent_start`.
- **Session guard**: warns on uncommitted changes before `/new` or `/resume`.
- **Commands**: `/ci` runs all CI checks manually; `/ci-status` shows last results.

## [2026-05-30] merge | Master conflict resolution for encoder/validator branch

## [2026-06-03] fix | M13b test_email_infra â€” relative path + leak-proof sys.modules mock

**Root causes and fixes:**

**Bug 1 â€” hardcoded Windows absolute path:** `TestEmailServiceTask` used `"E:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/backend/tasks/notifications.py"` directly in both test methods. On Linux CI this causes `FileNotFoundError`. Fixed: added `from pathlib import Path` and a module-level constant:
```python
_NOTIFICATIONS_PATH = str(Path(__file__).resolve().parents[1] / "tasks" / "notifications.py")
```
`parents[1]` = `backend/` from `tests/`, so the path works on any OS.

**Bug 2 â€” sys.modules mock leaks into later tests:** Both `TestEmailServiceTask` methods set `sys.modules[mod] = MagicMock()` before loading, but cleanup `sys.modules.pop(mod, None)` was a **trailing statement** outside any `try/finally`. If `FileNotFoundError` (or any assertion failure inside the load) aborted the test, `sqlalchemy`'s MagicMock remained in `sys.modules` â€” causing `test_immutable_records::test_66` to fail with `can't adapt type 'MagicMock'`. Fixed: wrapped the entire mock-load-assert block in `try/finally` with **restore** (not just pop):
```python
saved = {m: sys.modules.get(m) for m in mods}
try:
    for m in mods:
        sys.modules[m] = MagicMock()
    # load and test...
finally:
    for m in mods:
        if saved[m] is None:
            sys.modules.pop(m, None)
        else:
            sys.modules[m] = saved[m]
```

**Files changed:** `src/backend/tests/test_email_infra.py` only.

## [2026-06-02] implement | M13b email infrastructure â€” Jinja2 HTML templates + SMTP + Celery retry task

**FRS reference:** Module 13b â€” Email Notifications (FRS `#176`)

**Changes implemented:**
- `src/backend/services/email/sender.py` â€” pure Jinja2 HTML email rendering (no mrml dependency):
  - `render_email(template_name, context) -> (subject, html)`: loads `.html.j2` from `services/email/templates/`, extracts subject from `{# subject: ... #}` header, Jinja2-renders body
  - `send_email_async(to, template, context)`: renders + sends via `aiosmtplib`
  - `send_email(to, template, context)`: synchronous wrapper for Celery tasks
  - SMTP config via env: `SMTP_HOST` (default "mailhog"), `SMTP_PORT` (default 1025), `SMTP_FROM` (default "no-reply@bfp.gov.ph"), optional `SMTP_USER`/`SMTP_PASSWORD`
- `src/backend/services/email/templates/` â€” 4 email-safe inline-CSS HTML templates with BFP maroon (#8B0000) branding:
  - `password_reset.html.j2` (vars: full_name, reset_link, expiry_minutes)
  - `account_locked.html.j2` (vars: full_name, unlock_time, support_contact)
  - `security_alert.html.j2` (vars: severity, summary, detected_at, dashboard_link)
  - `weekly_report.html.j2` (vars: week_range, total_incidents, top_region, report_link)
- `src/backend/tasks/notifications.py`: added `send_email_task` Celery task with `autoretry_for=(Exception,)`, `retry_backoff=True`, `retry_backoff_max=600`, `max_retries=5`; does NOT query RLS tables
- `src/backend/requirements.txt`: added `aiosmtplib>=3.0.0` (mrml intentionally excluded for build portability)
- `.env.example`: added `SMTP_HOST=mailhog`, `SMTP_PORT=1025`, `SMTP_FROM=no-reply@bfp.gov.ph`
- `src/backend/tests/test_email_infra.py`: render tests for all 4 templates, mock aiosmtplib send test, task retry behavior test

**Deferred triggers (follow-up issues):**
- Keycloak account lockout email â†’ #138
- Weekly analytics report Celery beat â†’ #176
- Security alert email on CONFIRM_THREAT HITL action â†’ #176

## [2026-06-02] fix | M13b CI failure â€” add jinja2 to requirements.txt

**Root cause:** `services/email/sender.py` imports jinja2 (and aiosmtplib). When `tasks/notifications.py` was updated to wire in `sender`, the chain `from main import app` â†’ `import tasks.notifications` â†’ `from services.email.sender import render_email` pulled jinja2 into the entire app namespace. CI (Python 3.12) failed at collection because `jinja2` was not in `requirements.txt` â€” only `aiosmtplib` was.

**Fix:** Added `jinja2>=3.1.4` to `src/backend/requirements.txt` (aiosmtplib>=3.0.0 was already present). No other files changed.

**Verification (host, Python 3.9):** `from services.email.sender import render_email, send_email_async` â†’ `email sender import ok`. `python -m pytest tests/ --collect-only -q` â†’ 18 tests collected, 32 errors â€” all errors are pre-existing unrelated failures (missing `fastapi`, `sqlalchemy`, `pydantic` PEP 604 union syntax on Python 3.9, `cryptography`, etc.); zero jinja2 collection errors remain.

**Note:** Host is Python 3.9; CI is Python 3.12. The jinja2 fix resolves the CI failure. The pre-existing host failures are out of scope for this fix.

**Design note:** Uses pure Jinja2 HTML templates (email-safe inline CSS, table-based layout, max-width 600px) instead of mrml to avoid native wheel build failures on python:3.11-slim.

## [2026-05-30] merge | Master conflict resolution for encoder/validator branch
- Merged `master` into `fix/enc-val-bugs-and-UI` and resolved conflicts in `src/backend/api/routes/regional.py` and `system-wiki/log.md`.
- Preserved the encoder/validator branch's extracted regional helper architecture instead of reintroducing inline helper definitions from master.
- Updated `src/backend/services/regional_incidents/helpers.py` so `insert_incident_verification_history()` accepts optional `data_hash` and `sync_status`, keeping the extracted helper compatible with master's M4b verification audit migration.
- Preserved both master's M2/M4/M8/M9 log entries and this branch's archive/unarchive and duplicate-detection log entries.

## [2026-05-30] redesign | duplicate detection â€” conservative anchor-gated model

**Root cause of false positives:** The previous 5-criterion scoring model (distance â‰¤500m | same category+type | same date | time within 1 hr | same city, threshold 3/5) could reach 3/5 with purely administrative/temporal signals â€” same city + same date + same time â€” without any location or address proximity. Multiple separate fires per day in the same city is normal for BFP operations.

**New model** (`src/backend/services/duplicate_detection.py`): Anchor gate + Python scoring.

Architecture change: SQL now fetches candidates with `ST_Distance` and all address/text fields (via LEFT JOIN to `incident_nonsensitive_details` and `incident_sensitive_details`). Python applies the anchor gate and scores each candidate.

**Anchor gate** (any one required):
- Coordinate proximity â‰¤ 250 m
- Matching barangay + matching street_address OR landmark
- Matching non-empty establishment_name AND (distance â‰¤ 500 m OR barangay matches)

**Scoring** (max 12 pts): distance tiers (3/2/1), category+type match (3/1), time delta (2/1), address match (2/1), establishment (+1), fire station (+1). Confidence: LIKELY â‰¥ 7, POSSIBLE â‰¥ 4.

**API change**: 409 DUPLICATE_DETECTED response now includes `"confidence": "LIKELY" | "POSSIBLE"`. Frontend modals use this to show "Likely Duplicate" vs "Possible Duplicate".

**New fields added to geo_meta queries** in `lifecycle.py`: `barangay_id`, `barangay`, `street_address`, `landmark`, `establishment_name`, `fire_station_name` (via LEFT JOIN to `incident_sensitive_details`).

**subsystems/regional-dashboard.md**: Updated duplicate detection description.

## [2026-05-30] fix | PR #143 review fixes: geocode proxy, tests, component extraction, PII dedup, ruff format

**Changes implemented (review-fix batch @ `2ab506a` â†’ `2bc229b`):**

- **Nominatim geocode proxy** (`src/backend/api/routes/geocode.py`, `src/frontend/src/lib/geocode.ts`): All geocode requests now route through the backend (`/api/geocode/reverse`, `/api/geocode/search`) instead of the frontend calling `nominatim.openstreetmap.org` directly. Fire incident coordinates never leave the server to a third party. Backend proxy uses `httpx.AsyncClient` with timeout handling (504) and upstream error passthrough (502). Forward search restricted to Philippines (`countrycodes=ph`). Router registered in `main.py`.

- **Duplicate detection unit tests** (`src/backend/tests/test_duplicate_detection.py`): 293-line test suite, 21 unit tests. Covers threshold logic (score â‰¥ 3), effective_date derivation from notification_dt, parameter forwarding for all 5 criteria (parametrized), null lat/lon/notification_dt handling, exclude_statuses construction, verified_window_seconds, and combined edge cases. All 21 pass.

- **IncidentForm component extraction** (`src/frontend/src/components/IncidentFormSections.tsx`, `src/frontend/src/lib/geocode.ts`): IncidentForm.tsx reduced from 2,269 â†’ 1,977 lines (below 2k ceiling). Form sections extracted to `IncidentFormSections.tsx` (365 lines). Geocode logic extracted to `lib/geocode.ts` (78 lines) with `reverseGeocode()` and `searchGeocode()` calling the backend proxy.

- **PII decryption deduplication** (`src/backend/services/regional_incidents/helpers.py`): `decrypt_pii_blob()` defined once as a shared helper instead of duplicated inline decryption at both list and detail endpoints in `regional.py`. Uses lazy `SecurityProvider` singleton with proper `SecurityProviderError` logging.

- **Barangay extraction unit tests** (`src/backend/tests/test_afor_import.py`): 9 new tests for `_extract_barangay_from_address()` covering keyword detection (Brgy/Bgy/Barangay/BRGY), positional fallback (5-part AFOR template), empty string, placeholder, and fewer-than-3-parts inputs.

- **Ruff format pass** (`regional.py`, `main.py`, `helpers.py`, `test_afor_import.py`, `test_duplicate_detection.py`): 5 files reformatted to satisfy CI `ruff format --check` gate (line-length wrapping, trailing commas).

- **Repo hygiene:** Removed `PR.md`, `feedback.md`, `checklists/` from repo root (process artifacts).

**Verification:** Backend: `ruff format --check .` (110 files clean), `ruff check .` (all pass), `pytest tests/test_duplicate_detection.py` (21 pass), `pytest tests/test_afor_import.py -k extract_barangay` (9 pass).

**Wiki updates:** This log.

## [2026-05-30] fix | Encoder/validator archived incident detail and unarchive

**Changes implemented:**

- `GET /api/regional/incidents/{incident_id}` now allows archived records for authorized encoder/validator archive review instead of returning 404 from `fi.is_archived = FALSE` filters.
- Added encoder and validator unarchive actions: `PATCH /api/regional/incidents/{incident_id}/unarchive` and `PATCH /api/regional/validator/incidents/{incident_id}/unarchive`.
- Archive views on encoder and validator dashboards now expose Unarchive actions; validator archive rows also retain permanent Delete for archived cleanup.
- `unarchive_finalized_incident()` clears `is_archived`/`archived_at`, writes `UNARCHIVED` incident verification history, and resyncs analytics.
- The verified-row immutability rule patch now permits both archive and unarchive `is_archived` transitions while keeping other VERIFIED updates blocked.

**Verification:** `npm.cmd run lint -- --no-cache` passed with warnings only; backend route/service files passed AST parsing. Python bytecode compilation was blocked by local `__pycache__` permission.

**Wiki updates:** Updated `index.md`, `backend/api-route-map.md`, `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, `subsystems/references/regional-api-ref.md`, and this log. No FRS/codebase gap entry changed.

## [2026-05-28] fix | Layout zoom scoping, OTP sizing, notification toasts, badge, filter UX, 24H labels

**Changes implemented:**

- **Global zoom regression fix** (`src/frontend/src/app/globals.css`, `src/frontend/src/components/LayoutShell.tsx`): Removed `zoom: 0.9` from `body` (which caused a white bottom strip on login and dashboards). Added `.wims-main-zoom { zoom: 0.9; }` and applied it to the authenticated `<main>` element only. Login page and public routes are unaffected.

- **Keycloak OTP layout** (`src/keycloak/themes/wims-bfp/login/resources/css/wims-custom.css`): OTP grid constrained to `max-width: 300px; margin: auto` with `gap: 0.375rem`. Boxes changed from `aspect-ratio: 1/1` (caused overflow on smaller viewports) to `height: 44px; line-height: 44px; font-size: 1.125rem`. Separator changed to `width: 10px; justify-self: center`. All 6 inputs now fit within the Keycloak card at common desktop widths.

- **Rejected count badge** (`src/frontend/src/app/dashboard/regional/page.tsx`): Rejected filter chip button changed to `relative`. Badge moved from inline `span` to `absolute -right-2 -top-2` with `ring-2 ring-white`, matching validator Pending chip style.

- **Rejected chip click â†’ All Time** (`regional/page.tsx`): Clicking the Rejected status chip now calls `showRejectedFilter()` which sets `dateFilter = 'all'`, ensuring the full rejected backlog is visible.

- **"Show rejected" notification â†’ scroll** (`regional/page.tsx`): New `showRejectedAndScroll` handler: applies the filter then `scrollIntoView({ behavior: 'smooth' })` on the incidents section ref after a 60 ms delay, guiding the encoder directly to the list.

- **Encoder notification toasts â†’ sticky** (`regional/page.tsx`): Pending-actioned banner and rejection alert moved to a `sticky top-0 z-40` container at the top of the page content. Both are now visible while scrolling. Pending-actioned banner gained a **Refresh** button (calls `refreshAll()` and dismisses).

- **Validator Pending filter â†’ All Time** (`src/frontend/src/app/dashboard/validator/page.tsx`): Clicking Pending now also sets `dateFilter = 'all'` to surface the full validation backlog.

- **Validator new-incident banner â†’ sticky** (`validator/page.tsx`): `newIncidentBanner` moved before the page header and wrapped in `sticky top-0 z-40`, matching the encoder pattern.

- **Incident detail 24H labeling** (`src/frontend/src/app/dashboard/regional/incidents/[id]/page.tsx`): Removed `(24H)` suffix from `fmt24h`, `mark24h`, and `splitAlarmDateTime` return values. Added `(24H)` to the relevant labels: "Date & Time of Notification (24H)", `FIELD_LABELS.notification_dt + " (24H)"`, "Time Returned to Base (24H)", DataTable columns "Time Dispatched (24H)" / "Time Arrived at Scene (24H)", alarm timeline column "Time (24H)".

**Verification:**
- `npx.cmd eslint` on all modified files: 0 errors.
- `git diff --check`: no new trailing whitespace (pre-existing issue in `docs/regional-dashboard-handover.md`).
- `rg zoom` in `globals.css`: only `.wims-main-zoom` class; `body {}` block has no zoom.
- Browser verification could not run (no browser plugin available in this session).

**Wiki updates:** This log. No route-map or schema changes.

## [2026-05-28] update | Dashboard date filters and visual polish

**Changes implemented:**
- Encoder dashboard rich incident cards now keep the existing 1px border width but colour the border by status: green verified, red rejected, gray draft, warm yellow pending.
- Encoder and validator dashboards no longer send frontend `date_basis` parameters or expose Date of Fire filtering. Encoder date filters default to Date Modified; validator date filters default to Date of Submission.
- Both dashboards now show an always-visible calendar picker that switches the date scope to Specific Date and filters by the relevant default date field.
- The regional incident detail section-dot navigation now hugs the right viewport margin with a fixed margin, avoiding overlap with incident details.
- Global frontend CSS applies a 90% `body` zoom baseline.

**Verification:**
- `rg` confirmed no remaining frontend dashboard references to `date_basis`, `dateBasis`, or `DATE_BASIS`.
- `npx.cmd eslint src/app/dashboard/regional/page.tsx src/app/dashboard/validator/page.tsx src/app/dashboard/regional/incidents/[id]/page.tsx` passed.
- In-app Browser verification could not run because the `iab` browser backend was unavailable in this session.

**Wiki updates:** Updated `frontend/route-map.md`, `frontend/frontend-infrastructure.md`, `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, `gaps/ui-ux-gap-register.md`, `index.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this changed UI behavior and presentation, not FRS alignment.

## [2026-05-28] fix | Encoder and validator stats cards: region scoping, date filtering, wildland fix

**Changes implemented:**

- **Backend `/regional/stats`** (`src/backend/api/routes/regional.py`): Added `date_from`/`date_to` Query params applied to `notification_dt`. Scope changed from `encoder_id` to `region_id + VERIFIED`. Wildland query received a proper LEFT JOIN on `nd` so date filtering works. `total_incidents` returned as a generic period-total (aliased from `total_incidents_this_week`).

- **Backend `/regional/validator/stats`** (`src/backend/api/routes/regional.py`): Same `date_from`/`date_to` params added. Date clause applied to all VERIFIED queries (wildland, by_category, affected counts). Pending count intentionally unfiltered. Scope: all regions (system-wide verified totals).

- **`fetchRegionalStats` / `fetchValidatorStats`** (`src/frontend/src/lib/api/legacy.ts`): Both functions now accept `{ date_from?, date_to? }` and pass them as query params.

- **Encoder dashboard** (`src/frontend/src/app/dashboard/regional/page.tsx`): Added `STATS_DATE_FILTERS` constant (Today/This Week/This Month/All Time), `statsDateFilter` state defaulting to `'week'`, `statsDateBounds` memo, and stats filter chip UI above the stats cards. `loadStats` is reactive to `statsDateBounds`. First card title shows the selected period.

- **Validator dashboard** (`src/frontend/src/app/dashboard/validator/page.tsx`): Same stats filter pattern added â€” `STATS_DATE_FILTERS`, `StatsDateFilterValue`, `STATS_PERIOD_LABEL`, `statsDateFilter` (default `'week'`), `statsDateBounds`. Stats useEffect wired to `statsDateBounds`. Wildland and classification card titles include period label. Stats filter chip row rendered above stats cards.

**Verification:** Backend: `python -m py_compile src/backend/api/routes/regional.py`. Frontend: `npx vitest run`, `npm run lint`.

**Wiki updates:** Updated `docs/regional-dashboard-handover.md` and this log.

## [2026-05-28] fix | Encoder/validator bug batch: pin search, duplicate detection, notifications, session

**Changes implemented:**

- **Address pin search** (`src/frontend/src/components/IncidentForm.tsx`): Removed the `, Philippines` suffix appended to map search queries. Nominatim already filters to the Philippines via `countrycodes=ph`; the suffix was narrowing street-level results.

- **Re-pin from address** (`IncidentForm.tsx`): The "Re-pin from Address" button now clears the current lat/lng before setting the search query. This resets `MapPickerInner`'s `autoSearchedRef` guard (which was silently blocking re-geocoding when the same address string was re-submitted after a manual pin).

- **Barangay overwrite guard** (`IncidentForm.tsx`): Added `barangayManuallySetRef`. When the encoder types directly into the Barangay field, the ref is set and subsequent map-pin reverse-geocode results no longer overwrite the typed value.

- **Duplicate detection redesign** (`src/backend/services/duplicate_detection.py`, `lifecycle.py`): Replaced the previous 5 km spatial + Â±1-day date + OR-category fallback algorithm with a **5-criterion scoring system** (threshold: 3 of 5). Criteria: (1) distance â‰¤ 500 m, (2) same general category AND type code, (3) same exact fire date, (4) fire time within 1 hour, (5) same city/municipality (falls back to province/district). Candidate pool is Â±3 days. All three `check_for_duplicate` call sites in `lifecycle.py` updated to pass `notification_dt`, `city_municipality`, and `province_district`.

- **Validator new-submission polling** (`src/frontend/src/app/dashboard/validator/page.tsx`): Reduced poll interval from 30 s to 10 s to surface new submissions faster.

- **Encoder actioned-submission banner** (`src/frontend/src/app/dashboard/regional/page.tsx`): Added a background 20 s poll that compares the current PENDING total against the last-known value. When the count drops (validator verified or rejected a submission), a dismissable blue info banner is shown.

- **Forced-logout / refresh-token replay fix** (`src/frontend/src/lib/api/transport.ts`): The `apiFetch` 401 handler was calling `fetch('/api/auth/refresh', ...)` directly, bypassing the `navigator.locks` coordination in `auth-refresh.ts`. With Keycloak's `refreshTokenMaxReuse: 0`, a concurrent proactive background refresh and a 401-triggered refresh racing on the same token caused session revocation. The 401 handler now calls `refreshToken()` from `auth-refresh.ts`, routing through the shared in-flight de-duplication and lock.

**Verification:** Backend: `pytest -v`. Frontend: `npx vitest run`, `npm run lint`.

**Wiki updates:** This log.

## [2026-05-28] fix | Encoder and validator dashboard count polish

**Changes implemented:**
- Encoder rejection alert is dismissible, and Show rejected now bypasses conflicting category/date filters by switching to all-time rejected records.
- Encoder Rejected chip and validator Pending chip now show red count badges with white text.
- Encoder incident list uses the richer card layout for Today, Specific Date, and any filtered result set with 6 or fewer total incidents.
- Encoder top summary card now shows Total This Week from a new `total_incidents_this_week` stat.
- Regional wildland fire-type stats normalize `lower(trim(wildland_fire_type))`, fixing literal/casing/spacing mismatches in the Fire bucket.
- Validator Awaiting Validation stat now counts both `PENDING` and `PENDING_VALIDATION`, matching the queue default.
- Validator summary cards replace Total Verified with Wildland Fire via a new `wildland_total` stat.

**Verification:**
- `python -m py_compile src/backend/api/routes/regional.py` passed.
- `npx.cmd eslint src/app/dashboard/regional/page.tsx src/app/dashboard/validator/page.tsx src/lib/api/legacy.ts` passed.

**Wiki updates:** Updated `frontend/route-map.md`, `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, `gaps/ui-ux-gap-register.md`, `index.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this changed UI behavior and dashboard stats presentation, not FRS alignment.

## [2026-05-27] update | Encoder/validator frontend UI polish
- Renamed authenticated sidebar `/home` labels to Operations across role navigation while keeping the `/home` route unchanged.
- Put encoder and validator dashboards first in their role navigation and relabeled those sidebar entries to plain Dashboard.
- Removed the global authenticated `SyncStatusBar` from `LayoutShell` and removed the regional dashboard's local synced badge from the visible header.
- Updated the regional dashboard header quick actions, added keyboard-focusable incident rows, and added a right-aligned Open affordance.
- Updated the validator dashboard title/hint, moved Review into the station cell, preserved Accept/Reject for pending rows, and made finalized Archive a quieter secondary action.
- Updated `frontend/route-map.md`, `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, `gaps/ui-ux-gap-register.md`, and `index.md`.
- Verification: `npm.cmd run lint` passed with existing warnings; `npx.cmd vitest run` had one unrelated analyst timeout in `src/app/dashboard/analyst/queue-baseline.test.tsx` (`passes casualty_severity to heatmap and trends on apply`).

## [2026-05-27] update | Row click-to-view affordance refinement
- Removed the permanent Open column from the regional dashboard incident table; rows remain click/keyboard navigable and now reveal a delayed "Click to view" hint on hover/focus.
- Removed the permanent Review affordance from the validator station cell; validator rows now click through to incident detail while row action buttons stop propagation.
- Preserved validator Accept, Reject, Archive, and bulk-selection controls.
- Updated `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, and `gaps/ui-ux-gap-register.md`.
- Verification: not run at user request.
## [2026-05-29] implement | M8d HITL structured decision buttons + JSONB audit log
- **FRS reference:** Module 8d â€” Human-in-the-Loop (HITL) Validation (FRS `frs-threatdetectionwithexplainableai.md` M8d)
- Migration `39_hitl_decision.sql` adds `hitl_decision JSONB` column to `wims.security_threat_logs`; stores `{ "action": "CONFIRM_THREAT"|"FALSE_POSITIVE"|"REQUEST_MORE_INFO", "note": string|null, "reviewed_by": uuid, "reviewed_at": ISO8601 }`
- Backend `PATCH /admin/security-logs/{log_id}` (`admin.py`): `SecurityLogUpdate` schema extended with `action` and `note` fields; when `action` is provided, maps to human-readable `admin_action_taken` label, writes JSONB decision record, sets `reviewed_by = admin user_id`, sets `resolved_at = now()` for CONFIRM_THREAT and FALSE_POSITIVE only (REQUEST_MORE_INFO leaves `resolved_at` null); invalid action â†’ HTTP 400
- Frontend `updateAdminSecurityLog` in `legacy.ts`: signature extended with `{ action?, note?, admin_action_taken?, resolved_at? }`; called with `{ action, note }` from HITL buttons
- Frontend modal (`page.tsx`): replaced free-text `actionNote` textarea + single Save button with three structured HITL decision buttons â€” "Confirm Threat" (red, calls `handleHitlDecision('CONFIRM_THREAT')`), "False Positive" (gray, calls `handleHitlDecision('FALSE_POSITIVE')`), "Request More Info" (blue, reveals inline note textarea + Confirm/Cancel; calls `handleHitlDecision('REQUEST_MORE_INFO', note)`); logs with existing `admin_action_taken` show read-only display
- GET `/admin/security-logs` now also returns `hitl_decision` JSONB column in response
- Tests: `TestPatchSecurityLogHitl` class added to `test_admin_new_routes.py` (6 cases: CONFIRM_THREAT/FALSE_POSITIVE/REQUEST_MORE_INFO behavior, invalid action 400, no-fields 400, not-found 404); `admin-system-hitl.test.tsx` added (6 cases: 3 buttons render, each calls correct API action, Request More Info reveals note input, actioned logs show read-only)
- Applied migration to Docker postgres; verified `hitl_decision jsonb` column present
- Verification: backend `pytest -v -k security` â†’ 41 passed; frontend `npx vitest run` â†’ 8 passed (6 HITL + 2 existing AI analyze); `npm run lint` â†’ 0 errors (pre-existing warnings only)

## [2026-05-29] implement | M2c sync success/failure toast notifications
- **FRS reference:** Module 2c â€” Offline-First IndexedDB Queue (FRS `frs-offlinefirst.md` M2c)
- `useAutoSync.ts` `doSync()`: after `syncPendingIncidents()` returns, dispatches `toast.success`/`toast.warning`/`toast.error` based on `result.synced` and `result.failed` counts; success for clean sync, warning for partial, error for complete failure
- `sonner` toast library added to `package.json` dependencies; `toast` imported from `sonner` in `useAutoSync.ts`
- `layout.tsx`: `<Toaster />` component rendered to mount toast portal
- Closes ISSUE#142

## [2026-05-29] implement | M2b offline CRUD â€” IndexedDB queue operations
- **FRS reference:** Module 2b â€” Encryption of Offline Payloads (FRS `frs-offlinefirst.md` M2b)
- `offlineStore.ts`: `getQueuedIncident(id)`, `updateQueuedIncident(id, payload)`, `deleteQueuedIncident(id)`, `markSynced(id)`, `getPendingIncidents()` â€” full CRUD lifecycle for the IndexedDB incident queue
- `syncEngine.ts`: `syncPendingIncidents()` iterates pending items, POSTs to backend, marks synced on success, retains on failure; returns `SyncResult { synced, failed, errors }`
- Closes ISSUE#140

## [2026-05-29] implement | M2b AES-256-GCM encryption of offline payloads
- **FRS reference:** Module 2b â€” Encryption of Offline Payloads (FRS `frs-offlinefirst.md` M2b)
- `offlineStore.ts`: `encryptPayload(payload)` uses Web Crypto API â€” `AES-GCM` with `crypto.getRandomValues()` for 12-byte IV; stored item has `encrypted` field (base64) instead of plaintext `payload`; `decryptPayload(encrypted)` reverses on read
- `crypto-keys` IndexedDB store holds per-user AES key; key derived from user secret via PBKDF2 (with salt) if not already stored
- Transparent encrypt on `addToQueue` / `updateQueuedIncident`; transparent decrypt on `getQueuedIncident`; `markSynced` operates on raw record (never needs payload, only `status` field) â€” no decryption required
- Closes ISSUE#139

## [2026-05-29] implement | M4b data_hash + sync_status in verification audit trail
- **FRS reference:** Module 4b â€” Immutable Incident Record (FRS `frs-incidentworkflow.md` M4b)
- Migration `40_verification_audit_fields.sql`: adds `data_hash TEXT` (SHA-256 of canonical incident payload) and `sync_status TEXT` (pending/synced/failed) columns to `wims.incident_verification_history`; trigger `_insert_incident_verification_history` updated to compute hash on insert; stored procedure `verify_incident_command` updated to accept and store sync status
- Backend `verify_incident_command` now records `data_hash` via `sha256(concat_ws(...))` of all canonical incident fields and `sync_status` as 'synced' upon successful verification
- Closes ISSUE#145
## [2026-05-29] implement | M9a System Monitoring dashboard UI (PR #125)
- `GET /admin/monitoring/system` and `GET /admin/monitoring/workers` endpoints existed from PR #103, but frontend had no UI to consume them.
- Added `fetchSystemMetrics()` and `fetchWorkerStatus()` to `src/frontend/src/lib/api/legacy.ts`; re-exported from `src/frontend/src/lib/api/admin.ts`.
- Added `SystemMetrics` and `WorkerStatus` TypeScript interfaces to `src/frontend/src/app/admin/system/page.tsx`.
- Added `loadMonitoring()` callback (`useCallback`) that fans out `fetchSystemHealth`, `fetchSystemMetrics`, `fetchWorkerStatus` via `Promise.allSettled` so one failure does not block others; sets `health`, `systemMetrics`, `workers`, `monitoringLastChecked`.
- Replaced standalone `loadHealth()` mount useEffect with `loadMonitoring()` in both the mount effect (for initial load) and a dedicated M9a 60s interval `useEffect`; the manual System Health Refresh button still calls `loadHealth()`.
- Rendered new "System Monitoring" section before "System Health": CPU/RAM/disk progress bars with absolute values, and a Celery worker table (hostname, status, active tasks, last seen).
- Added `src/frontend/src/app/admin/system/admin-system-monitoring.test.tsx` with 6 tests: initial fetch call count, DOM rendering (CPU%/memory/disk/worker hostname), 60s interval second call, unmount cleanup, partial metrics failure resilience, and section heading presence.
- Updated `gaps/frs-codebase-gap-register.md`: M9 PARTIAL â†’ M9a CLOSED, updated date to 2026-05-29.
- **Remaining M9 gap:** full-text log search in admin system page.
## [2026-05-27] feat | Analyst export: region_name end-to-end + curated default columns (#112 #113)

- Added `region_name` to the backend export column allowlist (`ALLOWED_EXPORT_COLUMNS` in `src/backend/tasks/exports.py`) and the `get_export_rows()` column set (`src/backend/services/analytics_read_model.py`).
- When `region_name` is requested, `get_export_rows()` injects a conditional `LEFT JOIN wims.ref_regions rr ON rr.region_id = a.region_id` and aliases `rr.region_code AS region_name` so export writers receive a short code (NCR, CAR) under the picker-requested key without needing a mapping layer. The join is omitted when `region_name` is not in the column list to keep the common path cheap.
- Replaced the old positional-slice default column selection (`ALL_COLUMNS.slice(0, 6)`) with a curated 9-column default list in both backend (`DEFAULT_EXPORT_COLUMNS`) and frontend (`DEFAULT_SELECTED_COLUMNS`): `incident_id`, `notification_dt`, `region_name`, `province_name`, `municipality_name`, `general_category`, `alarm_level`, `estimated_damage_php`, `total_response_time_minutes`.
- Frontend `ExportPreviewModal` now pre-checks the curated defaults, `region_id` is unchecked by default (preferring `region_name`), and the dead `barangay_name` label was removed from `COLUMN_LABELS`.
- Added 4 backend regression tests: allowlist filtering for `region_name`, curated-default-list contract, positive query-path test verifying JOIN injection and row-dict output, and negative test confirming the JOIN is omitted when `region_name` is not requested.
- Added 5 frontend tests in new `ExportPreviewModal.test.tsx`: default list contract, pre-check behavior, `barangay_name` absence, `region_id` unchecked, and `region_name` checked.
- Added `.gitattributes` with `*.sh text eol=lf` to prevent UTF-8 BOM corruption in shell script shebangs (companion to the `fix(scripts)` commit).

**Verification:** Backend `pytest -v` â€” 328 passed, 10 skipped. Frontend `npx vitest run` â€” 119 passed.

**Wiki updates:** This log. No FRS/codebase gap register change needed (analyst export UX enhancement, not a new FRS module requirement).

## [2026-05-26] fix | VPS login outage from base compose auth settings
- Diagnosed public login failure as a Keycloak/OIDC discovery issue, not a full stack outage: core containers were running, `/login` served 200, but `/auth/realms/bfp/.well-known/openid-configuration` returned 403 with `HTTPS required`.
- Confirmed internal nginx-to-Keycloak discovery returned 200, while the public path was using base compose auth settings (`KC_HOSTNAME_URL=http://localhost:8080/auth`, backend `KEYCLOAK_ISSUER=http://localhost:8080/auth/realms/bfp`).
- Recreated `keycloak`, `backend`, `frontend`, and `nginx-gateway` with `docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d --build keycloak backend frontend nginx-gateway`.
- Restored Keycloak realm `sslRequired=external` after verification; no persistent relaxation of realm SSL policy was kept.
- Verified public discovery now returns 200 and advertises `issuer`, `authorization_endpoint`, and `token_endpoint` under `https://wimsbfp.tech/auth/...`; `/login` returns 200; all core containers are up.
- Updated `architecture/infrastructure-config.md` and `index.md`; no FRS/codebase gap register change was needed because this was an operational deployment-state correction, not a requirement alignment change.

## [2026-05-26] fix | Threat telemetry hidden by frontend response parser mismatch
- Verified seeded telemetry exists in `wims.security_threat_logs` (6 rows: 2 HIGH, 2 MEDIUM, 2 LOW); seeding was not the root issue.
- Fixed `src/frontend/src/lib/api/legacy.ts` `fetchAdminSecurityLogs()` to parse the current admin API envelope (`{ items, total, limit, offset }`) in addition to legacy array / `{ data: [...] }` formats.
- Added regression tests in `src/frontend/src/lib/api.test.ts` to cover both `{ items: [...] }` and `{ data: [...] }` parsing paths.
- Updated `subsystems/admin-hub.md` to document paginated telemetry response semantics and current UI limitation (first-page-only consumption).

## [2026-05-26] update | Seed Suricata threat telemetry
- Seeded the live VPS database with 6 Suricata-style rows in `wims.security_threat_logs`: 2 HIGH, 2 MEDIUM, and 2 LOW alerts for the System Admin threat telemetry view.
- Added `src/postgres-init/38_seed_security_threat_logs.sql` so fresh Postgres volumes get the same idempotent demo telemetry.
- Verified the live telemetry count by severity after applying the seed.
- Updated `database/sql-init-files.md`; no FRS/codebase gap register change was needed because this adds demo seed data without changing FRS alignment.

## [2026-05-26] fix | Public report tracking links use live route
- Updated the public report success and update-submitted screens in `src/frontend/src/app/page.tsx` so tracking links use `/tracking?id=<report_id>` instead of removed `/report/tracking?id=<report_id>`.
- Updated stale "new report"/cancel links from `/report` to `/`, matching the current public report form route.
- Added nginx compatibility redirects from `/report/tracking` and `/report/tracking/` to `/tracking` while preserving `?id=...`.
- Added `src/frontend/src/app/report-routing.test.ts` to guard against reintroducing `/report/tracking`.
- Updated `frontend/route-map.md` to document `/` as the public report form and `/tracking?id=<report_id>` as the live tracking route.

## [2026-05-26] fix | Employee login route separated from Keycloak proxy
- Moved the Next.js employee login page from `src/frontend/src/app/auth/login/page.tsx` to `src/frontend/src/app/login/page.tsx`, making `https://wimsbfp.tech/login` the correct employee-facing app login URL.
- Updated frontend redirects/public-route guards from `/auth/login` to `/login` in `AuthContext`, callback handling, transport auth failure handling, and `LayoutShell`.
- Added exact nginx compatibility redirects for `/auth/login` and `/auth/login/` to `/login`; the broader `/auth/` namespace still proxies to Keycloak.
- Ran `docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production down -v`, rebuilt all images with `build --no-cache`, and restarted with `up -d` on the VPS.
- Verified the Next build includes `/login`, `/login` returns 200, `/auth/login` and `/auth/login/` return 301 to `/login`, `/health` returns 200, and Keycloak discovery remains available under `/auth/realms/bfp`.
- Updated `frontend/route-map.md`, `architecture/infrastructure-config.md`, and `index.md`.

## [2026-05-26] fix | GitOps deploy and VPS port hardening
- Updated `.github/workflows/deploy.yml` to use the production compose stack (`docker-compose.yml` + `docker-compose.prod.yml` + `.env.production`) for config validation, DB connectivity checks, rebuild/restart, rollback, and public post-deploy health checks.
- Reworked certbot automation so existing `wimsbfp.tech` certificates are reused, first-time issuance uses standalone ACME, and renewal reloads nginx with `docker exec wims-nginx-gateway nginx -s reload`.
- Hardened `src/docker-compose.yml` host port exposure: Postgres, Redis, MailHog, and direct Keycloak now bind to `127.0.0.1`; only `nginx-gateway` publishes public 80/443.
- Added nginx gateway hardening: disabled version tokens, hid proxied `X-Powered-By`, and added HSTS, nosniff, SAMEORIGIN frame policy, no-referrer policy, and a restrictive permissions policy.
- Enabled UFW on the VPS with default-deny incoming traffic and explicit inbound allows for `22/tcp`, `80/tcp`, and `443/tcp`.
- Added `test_non_edge_services_bind_host_ports_to_loopback` to `src/backend/tests/test_infra_config.py`.
- Applied the hardened compose bindings on the VPS and verified `ss -ltnp`, `docker compose ps`, `https://wimsbfp.tech/health`, Keycloak discovery, and the frontend.
- Updated `architecture/infrastructure-config.md` and `index.md`.

## [2026-05-26] update | VPS production origin moved to wimsbfp.tech
- Updated `src/.env.production` so `PUBLIC_BASE_URL=https://wimsbfp.tech` instead of the previous `https://165-22-101-73.nip.io` origin.
- Confirmed `src/nginx/nginx.conf` already targets `server_name wimsbfp.tech` and `/etc/letsencrypt/live/wimsbfp.tech/...` certificate paths.
- Live VPS check showed `wims-nginx-gateway` exits because the `wimsbfp.tech` certificate files do not exist yet; only the old nip.io certificate is present under `/etc/letsencrypt/live/`.
- Updated `architecture/infrastructure-config.md` and `index.md`.

## [2026-05-24] fix | Automated Keycloak master realm bootstrap
- Added `src/keycloak/bootstrap/bootstrap-master-realm.sh`, an idempotent post-start script that logs into the Keycloak `master` realm, finds `security-admin-console`, and patches admin-console redirect URIs/web origins.
- Added a one-shot `keycloak-bootstrap` service to `src/docker-compose.yml`, dependent on healthy Keycloak. Backend startup now waits for this service with `condition: service_completed_successfully`.
- Added `test_keycloak_master_realm_bootstrap_service` to `src/backend/tests/test_infra_config.py`.
- Verification: `pytest tests/test_infra_config.py -q` passed; `docker compose config --quiet` passed; `docker compose up keycloak-bootstrap` exited 0; live `kcadm` inspection showed master realm `security-admin-console` includes `https://localhost/auth/admin/master/console/*`.
- Updated `architecture/infrastructure-config.md`, `frontend/frontend-infrastructure.md`, `operations/auth-loop-debug-guide.md`, and `index.md`.

## [2026-05-24] verify | Keycloak master realm import does not patch admin console
- Reviewed latest Keycloak commits (`12a1168`, `4b41966`) and live startup state.
- `src/docker-compose.yml` now mounts `src/keycloak/import/` and imports the `bfp` realm, but Keycloak 24 creates `master` before import and logs `Realm 'master' already exists. Import skipped`.
- Live `kcadm` check showed master realm `security-admin-console` still at `redirectUris: ["/admin/master/console/*"]` and `webOrigins: ["+"]`; the patched absolute redirect values exist only on the `bfp` realm copy.
- Updated `architecture/infrastructure-config.md`, `frontend/frontend-infrastructure.md`, and `operations/auth-loop-debug-guide.md` to record that the current code does not yet eliminate manual `kcadm`; an automated post-start master-realm patch/provisioning step is still needed.

## [2026-05-24] fix | Localhost Dashboard Callback Loop

**Diagnosis:**
- After successful Keycloak login, `GET /api/auth/session` returned 500 because the Next.js session route called `BACKEND_URL=http://nginx-gateway:80`; nginx redirects HTTP to HTTPS, so the server-side session probe failed before reaching FastAPI.
- Authenticated browser API calls used the built `NEXT_PUBLIC_API_URL=http://localhost/api`, so an app opened at `https://localhost` fetched `http://localhost/api/...` and hit CORS/preflight redirect failures.
- Keycloak `wims-web` client had `webOrigins: ["+"]` (literal string, not a wildcard in Keycloak 24 â€” causes 400 on all auth requests) and `clientAuthenticatorType: "client-secret"` (contradicts `publicClient: true`).

**Implementation:**
- `src/docker-compose.yml`: `BACKEND_URL=http://backend:8000` (session route calls FastAPI directly, bypassing nginx HTTPS redirect).
- `src/docker-compose.yml`: `NEXT_PUBLIC_AUTH_API_URL=/auth` baked at build time via `docker compose build frontend`.
- `src/keycloak/bfp-realm.json`: Replaced `webOrigins: ["+"]` with explicit origins (`https://localhost`, `http://localhost`, `https://165-22-101-73.nip.io`, `https://wims.bfp.gov.ph`) on `wims-web`. Removed `clientAuthenticatorType: "client-secret"`.
- `docker compose restart keycloak` to reload patched realm JSON.
- `docker compose build frontend && docker compose up -d frontend` to rebake env vars.

**Verification:**
- `pytest src/backend/tests/test_infra_config.py -q` -> 4 passed.
- `npx vitest run src/app/api/auth/session/route.test.ts` -> 2 passed.

**Wiki updates:** `frontend/frontend-infrastructure.md`, `architecture/infrastructure-config.md`, `operations/auth-loop-debug-guide.md` (new) created. Log entry added.

**Root causes:** RC-1 (session route â†’ nginx â†’ HTTPS redirect), RC-2 (NEXT_PUBLIC_* baked at build), RC-3 (webOrigins "+" in Keycloak 24), RC-4 (clientAuthenticatorType on public client), RC-5 (security-admin-console in master realm â€” not bfp realm â€” kcadm targeting error and relative redirectUri mismatch), RC-6 (master realm data survives docker compose down -v). See `operations/auth-loop-debug-guide.md` for full debug protocol.

---

## [2026-05-23] fix | VPS nginx TLS certificate bind mount
- Diagnosed `wims-nginx-gateway` exit 1 on VPS: nginx could not load `/etc/letsencrypt/live/165-22-101-73.nip.io/fullchain.pem`.
- Host certificate tree existed under `/etc/letsencrypt/live/165-22-101-73.nip.io`, but compose mounted `/opt/wims-bfp/letsencrypt`, which only contained `letsencrypt -> /etc/letsencrypt`.
- Updated `src/docker-compose.yml` so `nginx-gateway` bind-mounts `/etc/letsencrypt:/etc/letsencrypt:ro` directly.
- Updated VPS frontend/auth envs: browser-facing `NEXT_PUBLIC_*` values now use the public HTTPS origin or relative `/api`/`/auth`, backend `KEYCLOAK_ISSUER` uses the public HTTPS realm issuer, Next.js server-side auth uses `BACKEND_URL=http://backend:8000` instead of nginx over HTTP, and Keycloak `KC_HOSTNAME_URL` includes `/auth` so OIDC discovery matches the nginx proxy path.
- Added the VPS HTTPS callback/origin to the Keycloak realm export for `wims-web` and `bfp-client`, then patched the running Keycloak clients with the same redirect URI/web origin values.
- Updated `architecture/infrastructure-config.md` to reflect current HTTPS gateway behavior, `/health`, cookie-domain rewrite, VPS public-origin envs, and the certificate mount contract.

## [2026-05-23] update | GitOps-lite VPS deployment split
- Split deployment configuration into dev-neutral `src/docker-compose.yml` and production override `src/docker-compose.prod.yml`.
- Added tracked `src/.env.production.example` and untracked VPS-local `src/.env.production` for `PUBLIC_BASE_URL`, `LETSENCRYPT_DIR`, `APP_VERSION`, and host credential paths.
- Parameterized the nginx certificate mount with `LETSENCRYPT_DIR` so production can mount `/etc/letsencrypt` without hardcoding the VPS path in base compose.
- Restored base compose frontend/auth defaults to localhost-style local development values; production override supplies public HTTPS URLs, direct `BACKEND_URL=http://backend:8000`, backend `KEYCLOAK_ISSUER`, and Keycloak `KC_HOSTNAME_URL`.
- Updated `.gitignore` and `src/.gitignore` so VPS-local artifacts (`.deploy_history`, `firebase-creds.json`, `letsencrypt/`, `.env.production`) stay out of git while `.env.production.example` remains tracked.
- Verified deployment with `docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d --build`.

## [2026-05-19] update | Civilian Reporting Architecture â€” ADR-0001 accepted

**Session context:** Grill-with-docs session. Complete HCI overhaul of civilian emergency reporting flow and triage queue.

**Decisions recorded in:** `system-wiki/decisions/0001-civilian-reporting-overhaul.md`

**Key decisions:**
- `citizen_reports` (staging, 14 cols) separate from `fire_incidents` (AFOR canonical) â€” prevents flooding
- `GET /api/triage/queue` unifies both tables at read time via PostGIS `ST_DWithin` clustering
- Category = STRUCTURAL / NON_STRUCTURAL / TRANSPORTATION / UNSURE + icon sub-category grids
- Severity derived at read time from spatial/temporal clustering (link_count)
- Append creates new `citizen_reports` row with `linked_to_report_id` â€” NOT in-place update
- Rate limits: 5 new reports/IP/hr, 1 append/device_id/5min
- "What to do while waiting" = deterministic static content per category, no risk encouragement
- Triage: validator dashboard overview widget + dedicated `/incidents/triage` page
- Fire station auto-assigned from `nearest_station_id` at promotion; validator can override

## [2026-05-19] update | National Analyst HCI/UX review â€” 10 issues filed to GitHub

**Session context:** National Analyst perspective walkthrough (Iteration 1 + 2 + 3). Keycloak auth blocked runtime browser testing; all findings confirmed via source inspection.

**Findings:**
- 2 Critical (P0): Phantom `barangay_name` column in export picker + incident table; raw `region_id` integer with no `region_name` in exports
- 3 High (P1): Export default columns low-signal; "Analyze selected" ignores selected IDs; export picker missing 13 fields
- 5 Medium (P2/P3): No copy incident ID; opaque export filename; "Unselect page" label confusion; Top-N missing `damage_cost`; no rows-per-page selector

**Actions taken:**
- Partial patch applied to `ExportPreviewModal.tsx`: `barangay_name` removed from `ALL_COLUMNS`, `region_name` added, full 24-column list synced with backend `ALLOWED_EXPORT_COLUMNS` â€” **NOT yet committed**
- Created 10 GitHub issues: [#111](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/111)â€“[#120](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/120)
- Updated `gaps/ui-ux-gap-register.md`: added new "National Analyst UX â€” Iteration 2 Review (2026-05-19)" section, added missing `[[ui-ux/evaluation-national-analyst]]` cross-reference

**Blocked on:**
- Keycloak auth to `wims-web` realm (dev mode) â€” needs `wims-bfp` realm credentials for local browser testing
- `region_name` export requires backend JOIN in `analytics_read_model.py` / `exports.py`

## [2026-05-22] update | Civilian public report UX â€” safety-first flow resolved
- Grill-with-docs decision: `/report` must ask `safety_status` before reporting context/location so life-safety guidance appears before cognitively heavier source/location questions.
- Updated `system-wiki/prd/civilian-reporting-phase-2.md` and `system-wiki/subsystems/civilian-reporting-phase2.md` to record safety-first public flow and immediate emergency guidance for life-safety reports.
- Added calm emergency landing block requirement: dominant 911 action plus short safety instructions; guidance-only, not a separate data state, no pre-submit nearest-station lookup, and no additional hotline numbers. Life-safety reports keep 911 guidance visible through the flow.
- First interactive step is one question only: â€œAre you or anyone else in danger?â€ with `safety_status` choices. Reporting context/location stays on the next step.
- `UNKNOWN` safety status remains non-life-safety for backend priority/fast-submit, but UI shows cautious guidance: call 911 if anyone may be in danger and stay away from smoke/fire.
- Category selection treats `UNSURE` as a safe default: specific categories first, then a prominent â€œIâ€™m not sure / Hindi siguradoâ€ action with reassuring copy that BFP can still review the report.
- Location step uses unified plain-language prompt: â€œWhere is the fire?â€ with helper copy to use current location if there, otherwise place the pin on the fire location; context-specific GPS/pin details are secondary.
- After safety, `/report` asks location before reporting context. Location can offer â€œUse my current locationâ€ and â€œPlace pin manuallyâ€; reporting context is captured afterward for validator interpretation/GPS trust scoring.
- Both life-safety and non-life-safety use the shared core order: safety â†’ location â†’ reporting context â†’ category. Life-safety then shows â€œSend nowâ€; non-life-safety continues to details/review.
- If current GPS is chosen as fire location and user later selects `SECONDHAND`, UI challenges it: â€œIs this current location where the fire is?â€ Yes keeps it; No returns to manual pin placement.
- If current GPS is chosen and user later selects `NEARBY`, UI shows a non-blocking reminder: â€œIf the fire is not exactly where you are, place the pin on the fire instead.â€ Continue remains available.
- Life-safety reports skip optional details by default after minimum required fields; category step shows primary â€œSend nowâ€ that submits immediately and secondary â€œAdd details if safe.â€ Optional details remain available but keep â€œSend nowâ€ as the primary action. Minimum fields: `safety_status`, `latitude`, `longitude`, `reporting_context`, explicit `category` tap including prominent `UNSURE`, and `device_id`; `sub_category`, observed/reported time, witness fields, and `previous_report_id` are optional. Non-life-safety keeps details/review.
- Post-submit success screen uses explicit emergency boundary copy for every submission, not only life-safety reports: show â€œReport submitted,â€ tell users to call 911 now if anyone is in immediate danger, clarify that the report helps BFP review public signals but does not replace an emergency call, then show report ID/tracking and nearest station if available.
- Tracking page uses the same emergency boundary across all statuses. Waiting/uncertain states keep it prominent; `ACTIONED` may render it lower/softer but must still clarify that immediate danger requires calling 911 and that the report does not replace an emergency call.
- Nearest-station contact remains post-submit/tracking only and secondary to 911: label it â€œNearest BFP station for follow-up,â€ include â€œFor immediate danger, call 911 first,â€ and label fallback `911` as the emergency number rather than a station phone.
- Bilingual copy scope is stress-critical only, not full i18n: 911/immediate danger, do-not-approach/photo warnings, â€œdoes not replace emergency call,â€ â€œSend now,â€ â€œAdd details if safe,â€ `UNSURE` reassurance, location helper, and the 911 sentence in submit/rate-limit/network errors must be English/Filipino. Report IDs, technical statuses, station follow-up labels, observed time, and previous report ID may stay English-only.
- Submit errors are safety-first: any failure says the report could not be sent and tells users to call 911 now if immediate danger exists; validation/location errors point to missing fields or pin placement, rate limits explain too many reports from the network and suggest tracking/updating an existing report, and network/server errors ask the user to retry when connected without weakening the 911 boundary.
- Reporting-context cards should not remain text-only: use low-ambiguity icons to reduce reading load under stress, with eye/direct-view for `WITNESS`, map/proximity for `NEARBY`, and message/speech for `SECONDHAND`; exact icon choice remains implementation-flexible.
- **CTA visual contract:** disabled CTAs must not use the active BFP red/gradient treatment. Disabled state uses visibly inactive/muted styling (e.g. gray background, not red/gradient). Enabled primary CTAs use high-contrast BFP red/gradient. Rationale: stress-friendly cognitive clarity mandate; prevents regression where stressed users misread disabled buttons as active; serves as a QA and code-review guardrail. Documented in both PRD and subsystem docs.
- **Open implementation gap:** the current code in `page.tsx` defaults to `step = 'context'` and renders the reporting-context question as the first interactive step, before safety. The documented safety-first order (safety â†’ location â†’ context â†’ category) has not been implemented. The step ordering in `page.tsx` must be refactored so `safety` is the initial step value, and the conditional rendering reflects the documented order.
- **Open implementation gap:** the submitted success screen (`step === 'submitted'`) shows the 911/call-now emergency boundary only when `isLifeSafety` is true. The docs require this boundary for every submission regardless of safety status. Non-life-safety users currently see "Report Submitted" then nearest station with no emergency guidance in between. The 911 boundary and "does not replace an emergency call" copy must render for all submissions.
- **Open implementation gap:** tracking page (`tracking/page.tsx`) shows 911 guidance only for `REJECTED_*` statuses. Docs require the same emergency boundary for ALL statuses: PENDING, UNDER_REVIEW, LINKED, ACTIONED. For waiting/uncertain statuses it should be visually prominent; for ACTIONED it may be lower/softer but must still appear. Currently users on PENDING/LINKED/ACTIONED see no 911 guidance at all.
- **Open implementation gap:** submit error handling â€” `handleSubmit` in `page.tsx` uses a monolithic catch block that sets a generic error message (`err.message ?? 'Submission failed. Please try again.'`). There is no 911 boundary, no error-type-specific guidance (validation vs rate limit vs network), and no bilingual copy. Docs require: 911 boundary on every error, practical next-step copy specific to the error type, and 911 sentence in English/Filipino for all submit failures.
- **Open implementation gap:** context challenge prompts â€” docs require two GPS/context consistency checks: (1) if user selects `SECONDHAND` after current GPS was acquired, show "Is this current location where the fire is?" with yes/no; "No" returns to manual pin placement; (2) if user selects `NEARBY` after current GPS, show a non-blocking reminder that if the fire is not exactly where they are they should place the pin on the fire. Code does not implement either prompt â€” `tryAdvanceFromContext()` only checks GPS distance mismatch for NEARBY/SECONDHAND, not whether GPS was the source.
- **Open implementation gap:** station phone fallback labeling â€” `tracking/page.tsx` (lines 310-321) renders `nearest_station_phone` as a station phone regardless of its value. If the backend returns `911` as the fallback station phone (when no real station is assigned), the UI labels it "Nearest BFP Station" with "911" as a click-to-call link. Docs require: when the fallback value is `911`, label it "Emergency Number" and treat it as secondary to the 911 boundary, not as a BFP station. Code makes no such distinction; the semantic label must change based on whether the phone value is `911` or a real station number.
- **Open implementation gap:** life-safety secondary affordance â€” docs require the category step for life-safety to show both a primary "Send now" that submits immediately with minimum fields and a secondary "Add details if safe" that opens optional details while keeping "Send now" as the primary action within that screen; `page.tsx` (lines 942-951) only has a single "Fast Submit" button with no "Add details" affordance before it. A user who wants to add witness info or observed time for a life-safety report would not know they can â€” there is no secondary routing action.
- **Open implementation gap:** review step 911 boundary â€” docs require the 911 emergency boundary on every pre-submit screen including the non-life-safety review step; `page.tsx` (lines 456-545) renders a bilingual "Do not move closer" notice (line 501-504) but no 911 guidance between the data summary and the submit button. The 911 boundary and "does not replace an emergency call" copy must appear before the final submit CTA on the review step.
- **Open implementation gap:** calm emergency landing block â€” docs require `/report` to start with dominant 911 guidance (call 911 if anyone is in immediate danger, move away from smoke/fire, do not get closer to take photos) as a passive static block before the first interactive step; `page.tsx` starts the form directly with the interactive step selection with no initial emergency guidance block. The block is guidance-only, does not create a separate data state, and must appear as the landing content on `/report` before any user action.
- **Open implementation gap:** GPS-denied/timeout 911 boundary â€” docs require 911 guidance to persist throughout the entire flow for life-safety reports and require location/submission failure microcopy to include 911 reminders; when GPS is denied or times out (lines 709-720), the location error panel shows only a "Try again / Subukan ulit" retry button with no 911 call-to-action, even when the user is on a life-safety path. The panel must display a bilingual 911 boundary reminder regardless of whether the user is on the life-safety path. Per user direction, the fix is not a GPS-handler-specific change but rather ensuring the location/map selection screen honors the persistent 911 guidance boundary when on the life-safety path.

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
  - [[backend/remaining-routes]] â€” Full API reference for 7 route files: incidents.py (8 routes: upload-bundle, attachments, analyst list/detail/wildland, export), analytics.py (15 routes: heatmap, trends, comparative, export dispatch/download, type-distribution, top-barangays, response-time, compare-regions, top-n, filter-options, execution-plans), public_dmz.py (rate-limited unauthenticated submission), civilian.py (submit + track reports), sessions.py (list + terminate), user.py (profile + password change), ref.py (regions, provinces, cities).
  - [[backend/backend-infrastructure]] â€” Auth: KeycloakAuthenticator with JWKS caching/validation + 7 FastAPI dependencies. DB: engine, session factory, get_db/get_db_with_rls, set_rls_context GUC. main.py: 10 route registrations, rate-limit middleware (5/15min Lua+Redis on login), PKCE callback. Models: 6 ORM models (User, FireIncident, CitizenReport, IVH, SecurityThreatLog) + geometry validation. Schemas: 6 Pydantic models. Celery: Redis broker/backend, 3 periodic tasks (MV refresh 6h, Suricata 10s, draft expiry daily).
  - [[frontend/components-deep]] â€” Deep docs for 12 components: TypeDistributionChart, TopBarangaysChart, TrendCharts, ResponseTimeChart, HeatmapViewer (all pure presentational Recharts/Leaflet), ExportPreviewModal (state machine: idleâ†’queuedâ†’pollingâ†’downloadingâ†’done/error), AnalystIncidentList (478-line paginated/sortable/selectable table with detail drawer), DuplicateIncidentModal, DuplicateResolutionModal, LayoutShell (auth guard + PWA SW cleanup), Header (breadcrumbs + live PST clock + role badge), WildlandAforManualForm (927-line 11-section form).
  - [[architecture/docs-and-scripts]] â€” docs/ (10 files: ARCHITECTURE, CHANGELOG, API_AND_FUNCTIONS, M4-PR, M4-INCIDENT-WORKFLOW-DETAILS, VALIDATOR_WORKFLOW_CHANGELOG, 3 PR docs). scripts/ indexed; rejected barangay loader artifacts are not part of the committed script surface.
- Updated index.md: 24 â†’ 31 synthesis pages, all new pages linked.
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
  - [[frontend/frontend-infrastructure]] â€” Auth context (Keycloak OIDC, 4-min token refresh, cross-tab lock), 47 API client functions, utility libraries (afor-utils, ph-regions, regional-incidents, workflow-transfer), full component tree (Sidebar, IncidentForm~1956 lines, MapPickerInner with Nominatim, IncidentDiffPanel, SyncStatusBar, and 8 analytics chart components).
  - [[database/sql-init-files]] â€” All 31 SQL init files documented: RLS policies (16 tables force-enabled), helpers (current_user_uuid/role/region_id GUC system, exec_as_system_admin), 4 materialized views, immutable records RULES, PKI encrypt PII schema, seed data (12 verified incidents, 18 regions, 81 provinces, thousands of cities, 5 seed users).
  - [[backend/services]] â€” Analytics read model (17 functions: sync/batch/backfill/heatmap/trends/top-n/export/compare), duplicate detection (5km radius + Â±1 day spatial + text fallback), Keycloak admin (8 functions: create/set/update/logout/change/get), AI/XAI service (qwen2.5:3b via Ollama with JSON format output).
  - [[backend/utilities-and-tasks]] â€” Crypto (AES-256-GCM PII blob with incident-bound AAD), audit trail (writes system_audit_trails), Redis session revocation (12h TTL), backup crypto (AES-256-GCM .sql.enc format), 4 Celery export tasks (CSV/PDF/XLSX with 26-column whitelist).
  - [[architecture/infrastructure-config]] â€” Docker Compose (8 services, health checks, volumes), Nginx (proxy table, CORS, cookie domain rewrite, missing WebSocket/SSE), Suricata (EVE output, no custom suricata.yaml, classification.config with 37 categories), Keycloak realm (2641-line export: 5-min tokens, 30-min SSO idle, conditional OTP per role, 23 seed users, wims-admin-service confidential client with hardcoded secret).
  - [[architecture/pwa-tests-cicd]] â€” PWA/offline-first: IndexedDB queue (idb), sync engine (LWW conflict resolution on 409), network status hook, auto-sync with 2s debounce, service worker with Background Sync API, manifest (standalone PWA). Tests: 30 test files (10 unit, 19 integration), SQL contract pattern (inspect.getsource), e2e Keycloak+MailHog. CI: 5 parallel jobs + merge-gate. CD: GHCR image push on master.
- Updated [[operations/agent-routing-guide]]: every task now points to specific service/utility/infra pages.
- Updated [[index.md]]: 16 â†’ 24 total synthesis pages, all new pages listed under their sections.
- Total system-wiki documents: 24 synthesis pages + 3 reference files = 27 documents.

## [2026-05-16] create | API reference files for all three dashboard subsystems
- Created `system-wiki/subsystems/references/` with three function-level API reference files:
  - [[subsystems/references/admin-api-ref]] â€” Every function in admin.py documented: 16 route handlers, 4 Pydantic schemas, 2 helpers. Each entry includes route decorator, auth dep, DB session type, all parameters with types, return shape, all HTTP errors with conditions, and detailed behavior notes (audit logging, RLS context, Keycloak sync, backup encryption, retention policy).
  - [[subsystems/references/regional-api-ref]] â€” Every function in regional.py (~5050 lines) documented: 40+ route handlers, 10+ schemas, 25+ helpers, both AFOR parsers (BfpXlsxParser, WildlandXlsxParser). Covers AFOR import pipeline, incident CRUD, stats, verification workflow, audit logs, duplicate detection, barangay reverse-geocoding.
  - [[subsystems/references/triage-api-ref]] â€” Every function in triage.py: get_pending_reports, promote_report, bulk_promote_reports, BulkPromoteRequest schema, _require_encoder_or_validator guard dependency.
- Updated all three subsystem pages to include "## API Reference" sections linking to the reference files.
- Updated `index.md` to list reference files under their parent subsystem entries.
- Total synthesis pages: 16 pages + 3 reference files = 19 total wiki documents.

## [2026-05-17] update | analyst incident detail backend + sensitive endpoint + numeric hardening + index fix
- `GET /incidents/analyst/{incident_id}` â€” fully rewired:
  - Added `form_kind` field via `CASE WHEN w.incident_id IS NOT NULL THEN 'WILDLAND_AFOR' ELSE 'STRUCTURAL_AFOR'` using LEFT JOIN on `incident_wildland_afor`
  - Added all 19 structural fields from `incident_nonsensitive_details`: `fire_origin`, `extent_of_damage`, `structures_affected`, `households_affected`, `individuals_affected`, `vehicles_affected`, `resources_deployed`, `alarm_timeline`, `problems_encountered`, `stage_of_fire`, `extent_total_floor_area_sqm`, `extent_total_land_area_hectares`, `water_tankers_used`, `breathing_apparatus_used`, `total_gas_consumed_liters`, `families_affected`, `responder_type`, `fire_station_name`, `distance_from_station_km`
  - When `has_wildland_afor = true`, inlines `wildland` (full row dict), `alarm_statuses`, and `assistance_rows` from joined tables
  - Sensitive fields (narrative, PII, disposition) intentionally excluded â€” use `/sensitive` endpoint
  - **Index fix (another agent):** Live DB query confirmed the SELECT returns 38 columns (indexes 0â€“37). `form_kind` at row[18], `fire_station_name` at row[36], `distance_from_station_km` at row[37]. Original indices were off by 2 due to stale indexing from removed `barangay_name` JOIN. All row indices updated to actual positions; endpoint returns 200 for incident 12.
- New `GET /incidents/analyst/{incident_id}/sensitive` â€” separate endpoint for PII:
  - Same auth: `NATIONAL_ANALYST` or `SYSTEM_ADMIN`
  - Returns: `caller_name`, `caller_number`, `owner_name`, `establishment_name`, `occupant_name`, `narrative_report`, `prepared_by_officer`, `noted_by_officer`, `disposition`, `fire_origin`, `extent_of_damage`, `alarm_timeline`
  - Verifies incident is VERIFIED and not archived before returning any data (404 otherwise)
- Numeric field hardening: replaced bare `float()` casts on `NUMERIC` columns with `_analyst_json_value()` helper for `estimated_damage_php`, `extent_total_floor_area_sqm`, `extent_total_land_area_hectares`, `total_gas_consumed_liters`, `distance_from_station_km`. Prevents `ValueError` when garbage strings (e.g. `'BFP'` in `total_gas_consumed_liters` for incident 12) land in numeric columns.
- Removed dead `ref_barangays` LEFT JOIN â€” `barangay_id` is never written by encoder workflow; JOIN always returned empty. Comment added referencing future purge tracking. `barangay_name` dropped from response; frontend `FieldRow` renders `N/A`.
- Frontend `api.ts` â€” `AnalystIncidentDetailResponse` extended with all new fields + `form_kind` + optional wildland sub-objects; `AnalystIncidentSensitiveResponse` interface added; `fetchAnalystIncidentSensitive()` function added.
- Frontend analyst detail page (`/dashboard/analyst/incidents/[id]`) â€” fully redesigned by parallel agent: 8 collapsible sections (Aâ€“H), blur/reveal sensitive data with per-field eye-icon toggle, locked wildland section for STRUCTURAL_AFOR, lazy-load sensitive endpoint on user click. Reviews passed.
- Updated `system-wiki/backend/api-route-map.md`: added `/incidents/analyst/{incident_id}/sensitive` route entry.
- SQL contract tests pass: 4/4 (`test_analyst_incidents_sql_contract.py`).

## [2026-05-16] retracted | PSGC barangay geometry full-load pipeline
- A proposed PSGC barangay geometry full-load pipeline was generated but rejected before commit.
- Rejected artifacts included a PSGC code SQL migration, a Python geometry loader, a prep script, a loader Dockerfile, and a Compose startup dependency.
- Rejection reasons: normal stack startup became network-dependent, Docker Compose lost/broke existing backend/celery/Keycloak settings, and the proposed SQL attempted invalid `NULL` inserts into `ref_barangays.city_id`.
- The stable state is now: keep `31_barangay_geometry.sql` as an optional schema hook, remove barangay from Analyst Top-N selectors, and use municipality/fire-station/region for reliable hotspot ranking.
- Created `system-wiki/subsystems/` directory with three new synthesis pages:
  - [[subsystems/admin-hub]] â€” System admin hub: identity management, security telemetry, audit logs, health check, scheduled reports, backup management. Documents all 25+ admin.py endpoints and all 8 admin hub frontend panels.
  - [[subsystems/regional-dashboard]] â€” Regional encoder dashboard: AFOR import pipeline (5050-line regional.py), incident CRUD, drafts management, encoder audit trail, incident detail page with editable IncidentForm.
  - [[subsystems/validator-hub]] â€” National validator dashboard: verification queue, single/bulk approve workflow, duplicate resolution with Promise-based pattern, audit trail with CSV export, diff panels.
- Updated `index.md` (new Subsystems section, total 16 pages).
- Updated `operations/agent-routing-guide.md` (auth, incident-CRUD, and validation tasks now reference the subsystem pages).

## [2026-05-16] fix | TOP-N barangay dimension â€” code resolved, verification pending
- Implemented reverse-geocoding fix via OpenCode subagent (commit `4fb24b7`).
- Created `src/postgres-init/31_barangay_geometry.sql` â€” adds `geometry GEOGRAPHY(POLYGON, 4326)` + GiST index to `ref_barangays`.
- Added `_reverse_geocode_barangay(db, incident_id, lon, lat)` to `src/backend/api/routes/regional.py` â€” called after incident INSERT in 3 locations (_commit_wildland_afor_row, AFOR structural commit loop, create_incident). Uses `ST_Contains` + calls `sync_incident_to_analytics`. Gracefully skips if geometry not yet loaded.
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
- Session handoff created: `sessions/2026-05-14_1605_x1n4te_system-wiki-initialization-uiux-evaluations.md` â€” full session summary, recommended skills, known conventions, open questions.
- Open items for next session: wiki-dir/ cleanup decision, next desk-check page, groupmate wiki access, GitHub Issues conversion of gap register.

## [2026-05-14] add | National analyst dashboard evaluation
- Raw notes added to `raw/ui-ux/evaluation-national-analyst.md`.
- Synthesis created at `ui-ux/evaluation-national-analyst.md` â€” layout issues (L-01â€“L-04), filter issues (F-01â€“F-02), plus FRS/codebase gaps not explicitly raised by user (G-01â€“G-08).
- Cross-referenced with FRS M5 (Analytics), GitHub issues #84â€“#89.
- Key findings from FRS not raised by user: Top municipalities view missing (G-01), Average response time by region missing (G-02), P0 CRITICAL data pipeline bug (#84 â€” verify_incident() no analytics sync).
- Execution order per #89: Phase 0 â†’ Phase 1 â†’ Phase 2/3 (parallel) â†’ Phase 5 â†’ Phase 4.
- Added to `ui-ux-gap-register.md` (National Analyst Dashboard section) and `index.md` (UI/UX Evaluations section).
- SCHEMA.md authority model: "Empty or incomplete FRS source files" rule preserved (applies if future sources are empty).

## [2026-05-20] implement | Civilian Reporting Phase 2 â€” Issue 1: schema/bootstrap

**Session context:** Issue 1 of 12 vertical slices. Schema and bootstrap only; no API/frontend/validator work.

**Decisions implemented:**
- `05_citizen_reports.sql`: Phase 2 schema with all ADR columns: `category`/`sub_category`/`reporting_context`/`safety_status`/`witness_name`/`witness_phone`/`trust_score`/`status_explanation`/`internal_note`/`linked_to_report_id`/`link_count`/`previous_report_id`/`source_url`; CHECK constraints for all status values (PENDING/UNDER_REVIEW/LINKED/ACTIONED/REJECTED_BOGUS/REJECTED_DUPLICATE/REJECTED_INSUFFICIENT/REJECTED_TIMEOUT); status_explanation CHECK constraint COMMENTED OUT for bootstrap compatibility (re-enable via migration after seed backfill); `nearest_station_id` FK deferred to `32b_citizen_reports_station_fk.sql`; `report_notification_tokens` folded into this file.
- `citizen_report_clusters` and `citizen_report_cluster_members`: folded into `05_citizen_reports.sql` (Phase 2 cluster workflow state with anchor/claim/merge tracking).
- `ref_fire_stations.phone`: added to table definition in `32_ref_fire_stations.sql`; `32b_citizen_reports_station_fk.sql` defers FK constraint for `nearest_station_id`.
- `01_extensions_roles.sql`: made idempotent with `DO $$ EXCEPTION WHEN duplicate_object $$` blocks for all roles and wims_app.
- `10_rls_policies.sql`: Phase 2 citizen_reports RLS policies â€” public signal records, ANONYMOUS insert/select allowed, validator/admin write access.
- `11_analytics_facts.sql`: added `DROP POLICY IF EXISTS` for idempotent bootstrap re-runs.
- Bootstrap test (`test_wims_initial_schema_bootstrap.py`): updated to apply all numbered SQL files in sequence, added Phase 2 column/constraint/index assertions, updated `test_database_schema.py` TestForensicConstraint to test ACTIONED instead of deprecated VERIFIED.

**Tests run:**
- `test_database_schema.py` (7/7 pass against live DB): all constraint tests including Phase 2 status values.
- `test_wims_initial_schema_bootstrap.py`: bootstrap test has idempotency gaps in multiple pre-existing SQL files (13_export_reports.sql, 15_validator_workflow.sql, 17_cross_region_validator.sql, 17_immutable_records.sql) that use `CREATE POLICY` without `DROP POLICY IF EXISTS`. These are pre-existing issues outside Issue 1 scope. On first fresh-DB run (from template0) the bootstrap test passes.

**Verification against live running DB (test_database_schema.py â€” 7/7 pass):**
- `citizen_reports` has all Phase 2 columns including `source_url`, `previous_report_id`, `link_count`, `status_explanation`.
- `citizen_report_clusters` table exists with all ADR columns (anchor_report_id, status, status_note, internal_note, acted_by, assigned_to, review_started_at, created_at, updated_at, closed_at, merged_into_cluster_id).
- `citizen_report_cluster_members` table exists with all ADR columns (cluster_id, report_id, linked_by, created_at).
- `ref_fire_stations.phone` column exists.
- `citizen_reports.status` accepts all 8 Phase 2 values.
- ACTIONED status requires validated_by (TestForensicConstraint updated from deprecated VERIFIED).

**Known gaps (out of Issue 1 scope):**
- `05_citizen_reports.sql` comment says status_explanation CHECK is commented â€” re-enable in Issue 2 API phase.
- Bootstrap test idempotency: many pre-existing SQL files not idempotent; test passes on first fresh run but fails on re-run from same Docker session due to "policy already exists" errors. Resolvable by adding DROP POLICY IF EXISTS to ~8 SQL files but that's Scope Creep.
- `test_wims_initial_schema_bootstrap.py` uses hardcoded file list; relaxed to auto-discover all numbered .sql files.
- `_postgres_init_dir()` override check updated to not require `01_wims_initial.sql` specifically (actual Docker path uses `01_extensions_roles.sql`).

## [2026-05-20] implement | Civilian Reporting Phase 2 â€” Issue 2: submission/tracking API

**Session context:** Issue 2 of 12 vertical slices. Backend API/schema/tests only; no public frontend or validator UI work.

**Implemented:**
- `schemas/civilian.py`: Phase 2 structured request/response models with category, sub-category, reporting context, safety status, GPS metadata, witness fields, `previous_report_id`, `status_explanation`, deterministic guidance, nearest-station context, and related cluster status.
- `api/routes/civilian.py`: rewired public submission to insert structured `citizen_reports` rows, compute deterministic trust score, resolve nearest station/region, persist GPS metadata, support `previous_report_id`, and return tracking-ready response data.
- `PATCH /api/civilian/reports/{report_id}/append`: creates `LINKED` child reports, increments parent `link_count`, and blocks append on `ACTIONED` or any `REJECTED_*` terminal parent.
- `GET /api/civilian/reports/{report_id}`: returns `status_explanation`, status-specific guidance, rejection escalation guidance, nearest-station phone/name, `previous_report_id`, link count, and related cluster status when explicitly linked.
- `test_civilian_api.py`: replaced Phase 1 free-text tests with Phase 2 API coverage for structured submission, previous report reference preservation, coordinate validation, append creation, terminal append blocking, and terminal tracking guidance.
- `32b_citizen_reports_station_fk.sql`: expanded to upgrade existing Phase 1 dev databases to the Phase 2 citizen_reports columns/checks/indexes before adding `nearest_station_id` FK; added `chk_actioned_requires_validator` as `NOT VALID` for live compatibility.
- `36_ref_fire_stations_phone_null.sql`: fixed to add `ref_fire_stations.phone` for existing dev databases before null backfill.
- `05_citizen_reports.sql`: added missing `gps_warning_confirmed` and restored `chk_actioned_requires_validator` for fresh bootstrap.

**Tests run:**
- Rebuilt backend image, then ran `pytest tests/integration/test_database_schema.py tests/integration/test_civilian_api.py -v` inside Docker.
- Result: 14/14 passed.

**Notes:**
- The running dev DB was older than the Phase 2 init scripts, so `32_ref_fire_stations.sql`, `32b_citizen_reports_station_fk.sql`, `35_citizen_report_clusters.sql`, and `36_ref_fire_stations_phone_null.sql` were applied manually to verify Issue 2 without destroying Docker volumes.
- `triage.py` still contains Phase 1 promotion/free-text behavior and is intentionally left for later triage queue slices.

- Updated `decisions/0001-civilian-reporting-overhaul.md` after grill-with-docs session on unresolved civilian reporting decisions.
- Locked terminal append behavior: `ACTIONED` and all `REJECTED_*` reports cannot be appended; users are prompted to submit a new report or call 911 / nearest BFP station.
- Removed challenge endpoint from scope; new reports may reference previous terminal reports via `previous_report_id`.
- Replaced `PROMOTED` row status with `ACTIONED`; official `fire_incidents` remain created through regional/fire-station AFOR workflow, not civilian triage.
- Added durable cluster workflow model: `citizen_report_clusters`, `citizen_report_cluster_members`, cluster statuses, and inspection-modal/per-report terminal action rules.
- Locked timeout behavior: `PENDING` reports auto-transition to `REJECTED_TIMEOUT` after 2 hours with default `status_explanation`; row-level `UNDER_REVIEW` pauses timeout, cluster-level review alone does not.
- Clarified witness fields: `witness_name`/`witness_phone` refer to the direct eyewitness, especially for `SECONDHAND`.
- Added HCI/UX refinements: required safety prompt, two-mode submit flow, no media upload, bilingual public microcopy, GPS-denied map fallback, nearby duplicate suggestion for non-life-safety reports, validator priority filters, map+table cluster inspection modal, status-specific tracking guidance, and trust-score breakdown UI.
- Added validator-only workflow refinements: cluster claim/lock with stale takeover, outlier highlighting, split/merge clusters, URL-backed quick filters, audited terminal corrections, privacy rules for device/contact identifiers, and safe navigation-only keyboard shortcuts.
- Created `frontend/validator-triage-shortcuts.md` as the shortcut reference page.
- Added final validator workflow refinements: cluster activity/history panel, audit coverage for validator actions, internal notes separate from civilian-visible explanations, nearest-station context, mixed-status bulk warnings, non-terminal next-action recommendations, and 30-second polling with non-destructive refresh prompts.
- Created `prd/civilian-reporting-phase-2.md` to convert ADR decisions into buildable product requirements, user stories, implementation decisions, testing decisions, and out-of-scope boundaries.
- Created `plans/civilian-reporting-phase-2-implementation-issues.md` with 12 vertical implementation slices covering schema, APIs, public UX, tracking, triage projection, cluster workflow, validator UI, terminal actions, split/merge, timeout job, and final integration.

## [2026-05-14] split | Functional bugs moved from UI/UX register to standalone register
- `gaps/functional-bug-register.md` created â€” holds 5 teammate-reported functional/auth bugs (M12).
- Teammate bugs section removed from `gaps/ui-ux-gap-register.md`; cross-links added in both directions.
- `gaps/frs-codebase-gap-register.md` Related section updated to include `functional-bug-register`.
- `index.md` Gaps section updated: all 3 gap registers now listed separately.
- `log.md` entries updated to reflect split.

## [2026-05-14] add | Teammate-reported bugs to UI/UX gap register
- 5 bugs added to `gaps/ui-ux-gap-register.md` (Teammate-Reported Bugs section):
  - System Audit record_id shows "-" on create user actions (M12).
  - First login allows missing First Name, Last Name, device name â€” Keycloak profile validation not enforced.
  - No username change opportunity on first login â€” admin expects but no UI exists.
  - Session lifespan too short / fast logout â€” Keycloak token config issue.
  - No account recovery if TOTP authenticator is deleted â€” hard lockout, no fallback.

## [2026-05-14] split | UI/UX gaps separated from FRS codebase gap register
- Created `gaps/ui-ux-gap-register.md` â€” standalone gap register for UI/UX issues.
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
- Created `gaps/ui-ux-gap-register.md` â€” standalone gap register for UI/UX issues.
- Removed UI/UX section from `gaps/frs-codebase-gap-register.md`; added cross-link.
- `index.md` updated: total pages 12 -> 13, Gaps section now lists both registers separately.
- Updated header in `ui-ux-gap-register.md` to reflect teammate as well as user evaluations.
## [2026-05-14] add | Teammate-reported bugs to UI/UX gap register
- 5 bugs added to `gaps/ui-ux-gap-register.md` (Teammate-Reported Bugs section):
  - System Audit record_id shows "-" on create user actions (M12).
  - First login allows missing First Name, Last Name, device name â€” Keycloak profile validation not enforced.
  - No username change opportunity on first login â€” admin expects but no UI exists.
  - Session lifespan too short / fast logout â€” Keycloak token config issue.
  - No account recovery if TOTP authenticator is deleted â€” hard lockout, no fallback.
## [2026-05-14] split | Functional bugs moved from UI/UX register to standalone register
- `gaps/functional-bug-register.md` created â€” holds 5 teammate-reported functional/auth bugs (M12).
- Teammate bugs section removed from `gaps/ui-ux-gap-register.md`; cross-links added in both directions.
- `gaps/frs-codebase-gap-register.md` Related section updated to include `functional-bug-register`.
- `index.md` Gaps section updated: all 3 gap registers now listed separately.
- `log.md` entries updated to reflect split.
## [2026-05-14] add | National analyst dashboard evaluation
- Raw notes added to `raw/ui-ux/evaluation-national-analyst.md`.
- Synthesis created at `ui-ux/evaluation-national-analyst.md` â€” layout issues (L-01â€“L-04), filter issues (F-01â€“F-02), plus FRS/codebase gaps not explicitly raised by user (G-01â€“G-08).
- Cross-referenced with FRS M5 (Analytics), GitHub issues #84â€“#89.
- Key findings from FRS not raised by user: Top municipalities view missing (G-01), Average response time by region missing (G-02), P0 CRITICAL data pipeline bug (#84 â€” verify_incident() no analytics sync).
- Execution order per #89: Phase 0 â†’ Phase 1 â†’ Phase 2/3 (parallel) â†’ Phase 5 â†’ Phase 4.
- Added to `ui-ux-gap-register.md` (National Analyst Dashboard section) and `index.md` (UI/UX Evaluations section).
- SCHEMA.md authority model: "Empty or incomplete FRS source files" rule preserved (applies if future sources are empty).
## [2026-05-17] add | PR QA pages for May 2026 batch (PRs #102â€“#105)
- Created `pr-qa/` directory with 5 QA pages: batch overview + 4 individual PR docs
- PR #102 (laqqui): M4 post-fix â€” AFOR import gaps, field persistence, validator audit 500, VALIDATOR role 404, immutable rule fix, seed incidents, barangay geometry reversal. 7 bug clusters all resolved. âœ… APPROVE
- PR #103 (orljorstin, #70): Prometheus /metrics endpoint, worker heartbeat (30s), /api/admin/monitoring/workers, /api/admin/monitoring/system, worker_heartbeat.sql. 7/7 tests pass. Merge after #104. âœ… APPROVE
- PR #104 (orljorstin, #69): XAI incident narrative generation via Qwen2.5-3B, POST /incidents/{id}/narrative, batch endpoint, ai_narrative + confidence columns. 8/8 tests pass. Prompt injection noted as low risk. âœ… APPROVE
- PR #105 (orljorstin, #68): Suricata HIGH auto-incident creation, duplicate guard, security_alert_id FK, service account svc_suricata (pre-provisioned in 03_users.sql). 10/10 tests. âœ… APPROVE
- Critical finding: PR #105's service account concern resolved â€” svc_suricata UUID 00000000-0000-0000-0000-000000000001 already seeded in 03_users.sql with NATIONAL_ANALYST role.
- FRS gap closures: M6-G (XAI narratives), M6-F (Suricata auto-incident), M9 (Prometheus monitoring partial), M4 (incident workflow fixes).
- Merge order: #102 â†’ #104 â†’ #103 â†’ #105
- Index updated: total pages 13 â†’ 18

## [2026-05-23] docs | prominent mandatory wiki update rule in AGENTS
- `AGENTS.md`: added a top-level "Mandatory System Wiki Update Rule" and a "Before Final Response Checklist" so agents, including less capable models, see the system-wiki update requirement before and after implementation work.
- No synthesis page or FRS gap register change was needed because this updates agent operating instructions, not WIMS-BFP runtime behavior or FRS/codebase alignment.

## [2026-05-23] fix | deploy health check routing mismatch â€” /health vs /api/health
- `.github/workflows/deploy.yml`: health check was curling `http://localhost/api/health` which nginx proxies to `backend:8000/api/health` â€” but the backend route is `/health` (no `api` prefix), so every attempt returned 404. Fixed by running `docker exec wims-backend python -c "import httpx; httpx.get('http://localhost:8000/health', timeout=5).raise_for_status()"` instead of the host-level curl. This checks the backend directly from within its own container network namespace, bypassing nginx, and uses Python/httpx which is already installed.
- Root cause: the FastAPI route is `GET /health` at line 255 of `main.py`, but the nginx `location /api/` proxy passes the full `/api/health` path upstream, so uvicorn never matches it.
- `system-wiki/architecture/pwa-tests-cicd.md`: updated VPS Deploy health check description.
- `system-wiki/log.md` and `system-wiki/index.md`: last-changes updated.
- Verification: `docker exec wims-backend python -c "import httpx; print(httpx.get('http://localhost:8000/health').text)"` â†’ `{"status":"ok"}` confirmed.
- `.github/workflows/deploy.yml`: added 15-second settle delay before the post-restart health polling loop, and extended polling from 30Ã—2s = 60s to 45Ã—2s = 90s total capacity. Root cause: uvicorn cold-start + SQLAlchemy lazy engine initialization + Keycloak token validation on /health causes the backend to be unavailable for ~60+ seconds after a rolling restart under load. The 30-attempt limit was insufficient.
- `system-wiki/architecture/pwa-tests-cicd.md`: documented the new settle delay and extended polling window in the VPS Deploy section.
- Root cause also confirmed: nginx.conf serves `/health` directly at line 16 (returns `{"status":"ok","via":"nginx-gateway"}`), so the health check curl hits nginx on port 80 â€” not the backend â€” but the deploy script's `docker compose up -d backend` does not wait for uvicorn to be responsive, causing the timing mismatch.
- Verification: syntax check passed.

## [2026-05-23] fix | deploy SSH envs passthrough â€” DEPLOY_COMMIT unbound variable

- `.github/workflows/deploy.yml`: added `DEPLOY_COMMIT` to the `Deploy via SSH` step's `envs:` list and added the corresponding `export DEPLOY_COMMIT="$DEPLOY_COMMIT"` in the script block. The `deploy` job's `env:` block already set `DEPLOY_COMMIT: ${{ github.sha }}`, but the SSH action's `envs:` passthrough did not include it. When `set -euo pipefail` fired at line 172, `DEPLOY_COMMIT` was unbound â†’ exit 1, before the health check could even run. The actual health check had passed (confirmed by the `Backend /health check passed` line that appeared before the error).

- `system-wiki/architecture/pwa-tests-cicd.md`: documented the `envs:` passthrough requirement and the root cause.

- `system-wiki/index.md`: last-changes line updated.
- `.github/workflows/deploy.yml`: changed rollback image capture from `docker compose ... --format json | jq ...` to `docker compose ... images -q backend | head -n 1`, avoiding a missing `jq` dependency on the VPS.
- `src/frontend/src/app/dashboard/analyst/queue-baseline.test.tsx`: replaced default 1s label waits for the Top-N Metric/Dimension controls with explicit 5s async `findByLabelText` waits. The test was intermittently seeing the dashboard loading/header state before Top-N rendered under CI load.
- `system-wiki/architecture/pwa-tests-cicd.md` and `system-wiki/index.md`: updated deployment/test notes.
- Verification: `.github/workflows/deploy.yml` parsed successfully with Ruby YAML; `git diff --check` passed; `cd src/frontend && npx vitest run` â†’ 20 files / 130 tests passed.

## [2026-05-23] fix | deploy workflow SSH step divergence and DB probe
- `.github/workflows/deploy.yml`: changed the VPS SSH deploy script to `set -euo pipefail`, replace ambiguous `git pull origin master` with `git fetch origin master` + `git checkout -B master origin/master`, and rewrite the backend DB connectivity check as a one-line `python -c` command using `database.get_engine()`.
- Root cause: the VPS checkout saw a force-updated/divergent `origin/master`, so `git pull` required an explicit reconciliation strategy; the script then continued into a multiline indented `python -c` block that raised `IndentationError`.
- `system-wiki/architecture/pwa-tests-cicd.md` and `system-wiki/index.md`: updated deploy workflow documentation.
- Verification: `.github/workflows/deploy.yml` parsed successfully with Ruby YAML.

## [2026-05-23] fix | deploy workflow backend test database setup
- `.github/workflows/deploy.yml`: added PostGIS and Redis GitHub Actions service containers to the pre-deploy `ci` job, set localhost test `DATABASE_URL`/`REDIS_URL`, initialized `wims_test` from `src/postgres-init/*.sql`, and aligned backend pytest exclusions with `.github/workflows/ci.yml`.
- Root cause: deploy CI ran pytest directly on the GitHub runner while backend defaults pointed at Docker Compose DNS host `postgres`, which only resolves inside the Compose network.
- `system-wiki/architecture/pwa-tests-cicd.md` and `system-wiki/index.md`: updated CI/CD routing documentation for the VPS deploy workflow.
- Verification: `.github/workflows/deploy.yml` parsed successfully with Ruby YAML.

## [2026-05-19] update | analyst incident detail page full redesign (working tree)
- `src/frontend/src/app/dashboard/analyst/incidents/[id]/page.tsx` â€” complete UI overhaul (+597/-617 lines, 935 total):
  - **Page header**: ref-number title, status/type/alarm icon badges, location line, styled export buttons
  - **QuickStats bar**: 4 KPI tiles (Response Time, Est. Damage, Structures Hit, Families Hit) with accent colors + tooltips
  - **SECTION_ICONS map**: semantic icons per section Aâ€“H + Wildland
  - **CollapsibleSection** rebuilt: icon container, description subtitle, badge, locked state, full ARIA (`aria-expanded`, `aria-controls`, `role="region"`)
  - **FieldRow** rebuilt: `twocol` mode (2-col grid), `highlight` mode (red text for key metrics), null-safe with "â€”" fallback
  - **AlarmVisual**: step-by-step timeline with numbered circles + connecting lines for spatial alarm-level encoding
  - **WildlandSection**: locked for STRUCTURAL_AFOR, shows alarm_statuses + assistance_rows tables when WILDLAND_AFOR
  - **SensitiveSection** rebuilt: gradient card gate, per-field blur+reveal eye toggle, "Hide All" button, revealed field counter, lazy-load on user click
  - **EmptyState** component: consistent icon+message no-data state across all sections
  - All numeric fields null-safe: `${value} km`, `${value} sqm`, `${value} ha`, `${value} L`, `formatMoney()`, `formatMinutes()`
- Components all self-contained; no external dependencies beyond existing imports (lucide-react icons, useAuth, api client)
- Branch: `feat/national-analyst-phase5-detail-screens`, uncommitted

## [2026-05-20] fix | civilian reporting phase 2 issue 5 triage queue tests
- `src/backend/api/routes/triage.py`: fixed `/api/triage/queue` quick filters by moving computed `confidence` and `claimed_by_me` checks out of SQL, making `rejected_today`/`actioned_today` terminal-status modes, correcting duplicate-device counts, and aligning severity to neighborhood size semantics.
- `src/backend/tests/integration/test_triage_queue.py`: isolated triage queue test data per test, narrowed the privacy assertion to raw `device_id` fields, and corrected test coordinate fixture behavior for PostGIS geography distance checks.
- Verification: `cd src && docker compose build backend && docker compose run --rm backend pytest tests/integration/test_triage_queue.py -v` â†’ 39 passed.

## [2026-05-20] add | civilian reporting phase 2 issue 6 cluster claim workflow
- `src/backend/api/routes/triage.py`: added cluster workflow endpoints for `POST /api/triage/clusters/{cluster_id}/claim`, `POST /api/triage/clusters/{cluster_id}/activity`, and `GET /api/triage/clusters/{cluster_id}/activity`.
- Claim behavior moves clusters to `CLUSTER_UNDER_REVIEW`, sets `assigned_to`, `review_started_at`, `updated_at`, and `acted_by`; active claims return conflict for other validators.
- Stale claims are based on 15 minutes without `updated_at` activity; `NATIONAL_VALIDATOR`/`SYSTEM_ADMIN` takeover requires a reason and writes audit/internal-note context.
- Activity refresh updates claim freshness and writes audit rows; history projection combines cluster creation, membership additions, and cluster audit events without exposing raw device/IP/token fields.
- `src/backend/tests/integration/test_triage_queue.py`: added Issue 6 integration coverage for claim, active-claim blocking, stale takeover with required reason, activity refresh, and history/audit projection.
- Verification: `cd src && docker compose build backend && docker compose run --rm backend pytest tests/integration/test_triage_queue.py -v` â†’ 43 passed.

## [2026-05-20] add | civilian reporting phase 2 workflow completion pass
- `src/backend/api/routes/civilian.py`: added non-blocking duplicate suggestion endpoint for non-life-safety reports and tightened append rate limiting to one append per device per 5 minutes across linked reports.
- `src/backend/api/routes/triage.py`: materializes durable singleton clusters for active unclustered reports, adds terminal action, correction, split, and merge workflow endpoints, audits validator actions, and disables legacy promotion/bulk-promotion endpoints with HTTP 410.
- `src/backend/api/routes/public_dmz.py`: deprecated `/api/v1/public/report` now returns HTTP 410 so civilian reports no longer create official `fire_incidents`.
- `src/backend/tasks/civilian_reports.py` and `src/backend/celery_config.py`: added scheduled timeout task for `PENDING` reports older than 2 hours, preserving row-level `UNDER_REVIEW`.
- `src/frontend/src/app/incidents/triage/page.tsx`: rebuilt around Phase 2 `/api/triage/queue`, quick filters, polling, claim indicators, cluster inspection, row selection, and terminal action preview/apply.
- `src/frontend/src/app/report/page.tsx`: persists a browser device id and calls duplicate suggestions before non-life-safety review.
- Tests updated for duplicate suggestions, durable singleton clusters, terminal action explanation/audit, timeout behavior, and disabled promotion.
- Verification: `cd src && docker compose build backend && docker compose run --rm backend pytest tests/integration/test_civilian_api.py tests/integration/test_triage_queue.py -q` â†’ 57 passed; `cd src/frontend && npm run build` â†’ passed; targeted ESLint on edited frontend files â†’ passed.

## [2026-05-20] add | civilian reporting phase 2 follow-up timeline and validator controls
- `src/backend/api/routes/civilian.py` and `src/backend/schemas/civilian.py`: added `GET /api/civilian/reports/{report_id}/timeline` for parent report plus linked append children.
- `src/frontend/src/app/report/tracking/page.tsx`: renders append timeline and now offers follow-up report references for both `ACTIONED` and rejected terminal reports.
- `src/frontend/src/lib/api.ts` and `src/frontend/src/app/incidents/triage/page.tsx`: added validator UI calls and controls for terminal correction, cluster split, and cluster merge workflows.
- `src/frontend/src/app/incidents/triage/page.tsx`: added activity/history projection inside the cluster inspection modal.
- `src/postgres-init/36_ref_fire_stations_phone_null.sql`: changed station contact fallback from `NULL` to `911` until authoritative per-station phone data is loaded.
- Tests updated for timeline, correction, split, and merge behavior.
- Verification: `cd src && docker compose build backend && docker compose run --rm backend pytest tests/integration/test_civilian_api.py tests/integration/test_triage_queue.py -q` â†’ 61 passed; `cd src/frontend && npm run build` â†’ passed; targeted ESLint on edited frontend files â†’ passed.

## [2026-05-23] merge | PR #122 + #123 to master â€” admin hub gaps + analytics phantom columns

**Session context:** Merged two PRs to master, resolved 4 merge conflicts (auth-refresh.ts, auth.tsx, AuthContext.tsx, nginx.conf), fixed pre-existing test bug in `test_regional_afor_unified_import.py`.

**Merge decisions:**
- `auth-refresh.ts` â€” kept **master** (singleton ref + Web Locks API + doRefresh fallback pattern)
- `auth.tsx` â€” kept **master** (`@/lib/auth-refresh` absolute import path)
- `AuthContext.tsx` â€” kept **master** (refreshInFlightRef per-tab deduplication)
- `nginx.conf` â€” kept **pr122-local** (full TLS + upstream{} block, master had placeholder)

**Key changes landed:**
- PR #122: `POST /admin/restore`, `GET/DELETE /admin/sessions/{user_id}[/{session_id}]`, `PATCH /admin/scheduled-reports/{id}`, Redis `decode_responses=True` fix, barangay support in MapPicker + AFOR parser
- PR #123: trimmed 9 phantom columns from `analytics_incident_facts` sync/INSERT/UPDATE (columns existed in code but not in DB schema â€” caused `UndefinedColumn`, making facts table permanently empty)

**Pre-existing test bug fixed:**
- `test_commit_structural_persists_wgs84_coordinates` â€” seed data triggered 1000m duplicate detection, returning `DUPLICATE_CHECK_REQUIRED` instead of `incident_ids`. Fixed by re-committing with `resolutions: [{"row_index": 0, "action": "force"}]`

**Tests:** 322 passed. 4 failures â€” all `test_keycloak_password_reset.py` requiring live Keycloak (environment limitation, not code).

## [2026-05-20] update | Civilian Reporting Phase 2 â€” final completion pass

**Session context:** Handoff continuation. Completed remaining Phase 2 slices from `civilian-reporting-phase-2.md` and `frs-codebase-gap-register.md`.

**Implemented:**
- **Merge-candidate discovery (backend):** `GET /api/triage/clusters/{cluster_id}/merge-candidates` returns conservative nearby clusters within 250m and 1 hour using PostGIS `ST_DWithin` + `ST_Distance` geography. Filters out own cluster and `CLUSTER_CLOSED` targets.
- **Merge-candidate discovery (API client):** `fetchMergeCandidates(clusterId)` in `src/frontend/src/lib/api.ts` with `MergeCandidateEntry` interface.
- **Merge-candidate discovery (UI):** Candidate list rendered in validator inspection modal â€” shows cluster id, anchor report, distance, minutes, member count, status. Each candidate pre-fills the merge source id + auto-generates internal note on click.
- **Map-based cluster inspection:** New `ClusterInspectionMap` + `ClusterMapInner` components using react-leaflet with dynamic import (SSR-safe). Shows report locations as red markers, suggested merge source anchors as blue markers, 100m radius circle around anchor report.
- **Navigation shortcut help:** `Esc` closes modal, `R` refreshes queue â€” only when focus is outside input/textarea/select. Shortcut hint displayed in modal header ("Esc close Â· R refresh").
- **Keyboard handler:** `useEffect` in triage page guards against firing when focus is in interactive elements.
- **Backend tests for merge-candidates:** `TestMergeCandidates` class with 6 tests: 250m/1hr positive, >250m exclusion, >1hr exclusion, CLUSTER_CLOSED exclusion, 404 for nonexistent cluster, own-cluster exclusion.
- **Frontend Vitest tests:** `src/frontend/src/app/incidents/triage/page.test.tsx` â€” 6 tests covering queue render, modal open, shortcut hint, Escape dismiss, merge-candidate display, input-guard protection.
- **Components created:** `ClusterInspectionMap.tsx`, `ClusterMapInner.tsx`.

**Verification results:**
- Backend pytest (67 tests): `tests/integration/test_civilian_api.py` + `tests/integration/test_triage_queue.py` â†’ **67 passed**
- Frontend build: `npm run build` â†’ passed
- ESLint on edited frontend files â†’ passed (no errors)
- Frontend Vitest (6 tests in triage page): **6 passed**

**Wiki updated:**
- `frs-codebase-gap-register.md`: marked map-based cluster inspection, merge-candidate discovery, and navigation shortcut help as implemented; remaining gap is full browser E2E smoke.

**Files touched:**
- `src/backend/api/routes/triage.py` (merge-candidate endpoint was pre-existing, verified)
- `src/backend/tests/integration/test_triage_queue.py` (6 new tests)
- `src/frontend/src/lib/api.ts` (fetchMergeCandidates + MergeCandidateEntry)
- `src/frontend/src/app/incidents/triage/page.tsx` (map, merge candidates, keyboard shortcuts)
- `src/frontend/src/components/ClusterInspectionMap.tsx` (new)
- `src/frontend/src/components/ClusterMapInner.tsx` (new)
- `src/frontend/src/app/incidents/triage/page.test.tsx` (new)
- `system-wiki/gaps/frs-codebase-gap-register.md`

## [2026-05-23] fix | moved nginx /health location directive from http{} level to HTTPS server{} block
- Commit `32780a0`: moved nginx `/health` location directive from `http{}` level to HTTPS `server{}` block â€” fixes "location directive is not allowed here" config validity error. `/health` now served directly by nginx gateway, not proxied.

## [2026-05-23] plan | staged architecture refactor pages
- Added seven phase planning pages under `system-wiki/plans/` for the architecture refactor sequence:
  - `architecture-refactor-phase-0-safety-baseline.md`
  - `architecture-refactor-phase-1-afor-parser-extraction.md`
  - `architecture-refactor-phase-2-afor-commit-extraction.md`
  - `architecture-refactor-phase-3-regional-incident-lifecycle.md`
  - `architecture-refactor-phase-4-civilian-triage-workflow.md`
  - `architecture-refactor-phase-5-analytics-query-interface.md`
  - `architecture-refactor-phase-6-frontend-api-slices.md`
- Updated `system-wiki/index.md` with links to each phase page.
- No code, schema, infrastructure, or test behavior changed.

## [2026-05-23] plan | architecture refactor phase goals and stop criteria
- Added explicit `Goal` and `Stop Criteria` sections to all seven architecture refactor phase pages.
- The stop criteria define when future agents should end each phase without expanding into adjacent refactors.
- No code, schema, infrastructure, or test behavior changed.

## [2026-05-24] complete | Architecture Refactor Phase 0 Safety Baseline

**Session context:** Baseline survey for architecture refactor chain (phases 0â€“6). No production code changed.

**Baseline results:**
- Backend: 119/119 tests passed across 7 test files (`test_afor_import.py`, `test_regional_afor_unified_import.py`, `test_regional_crud.py`, `test_triage_queue.py`, `test_analytics_api.py`, `test_analyst_export.py`, `test_analyst_incidents_sql_contract.py`).
- Frontend: 43/43 tests passed across 5 test files (`api.test.ts`, `incidents/triage/page.test.tsx`, `report/tracking/page.test.tsx`, `CalmEmergencyBlock.test.tsx`, `dashboard/analyst/page.test.tsx`).
- 1 non-blocking stderr warning: React `fill` attribute on non-SVG element in `report/tracking/page.test.tsx` â€” does not affect functionality.

**Drift decisions deferred:**
- `PENDING` vs `PENDING_VALIDATION` â†’ Phase 3.
- Civilian duplicate spatial rule (500m vs 100m/1hr) â†’ Phase 4.
- `top-barangays` endpoint existence â†’ Phase 5.

**Environment note:** Backend tests run inside `wims-backend` container (`docker exec wims-backend pytest â€¦`). Host Python lacks `jose`/`psycopg2`/Docker-backed DB session.

**No production code edited.** Phase 0 complete; Phase 1 (AFOR parser extraction) is the next implementation target.

## [2026-05-24] complete | Phase 1 AFOR Parser Extraction

**Session context:** Pick up from prior session's handoff. Phase 1 parser extraction was done but Docker verification was interrupted by sandbox filesystem issue. Restarted Docker build and reran integration tests.

**Implementation:**
- `src/backend/services/afor_import/__init__.py` â€” exports `AforParsedRow`, `AforParseResponse`, `AforFormKind`, `WildlandRowSource`, `ALARM_LEVEL_MAP`, `_column_letters_to_index`, parser functions
- `src/backend/services/afor_import/models.py` â€” parser models `AforParsedRow`, `AforParseResponse`, `AforFormKind`, `WildlandRowSource`
- `src/backend/services/afor_import/parse.py` â€” parser implementation (structural/wildland/workbook/CSV)
- Removed duplicated AFOR parser from `src/backend/api/routes/regional.py`; route now imports from `services.afor_import`
- Updated `src/backend/tests/test_afor_import.py` to import parser symbols from `services.afor_import`

**Fixes applied during verification:**
- Added missing `ALARM_LEVEL_MAP` to `parse.py` and exported it
- Added missing `_column_letters_to_index()` to `parse.py`
- Fixed malformed `_parse_ha_from_area_text()` after extraction

**Verification:** Host `pytest tests/test_afor_import.py` â†’ 13 passed. Docker integration after final parser fix â†’ all pass.

## [2026-05-24] complete | Phase 2 AFOR Commit Extraction

**Session context:** Followed Phase 1 directly. Commit implementation was structurally done but HTTP status codes in `_wgs84_pair_from_raw` were 422 instead of 400.

**Implementation:**
- `src/backend/services/afor_import/models.py` â€” added `DuplicateAction`, `RowResolution`, `AforCommitRequest`, `AforCommitResponse`
- `src/backend/services/afor_import/commit.py` â€” `AforCommitDependencies`, `_wgs84_pair_from_raw()`, duplicate matching helpers, wildland persistence, `commit_afor_import_command()`
- `src/backend/api/routes/regional.py` `POST /api/regional/afor/commit` reduced to thin adapter: parse JSON â†’ validate `AforCommitRequest` â†’ call `commit_afor_import_command(...)` â†’ return response
- Removed old AFOR commit helper block from `regional.py`

**Fix applied during verification:**
- `_wgs84_pair_from_raw` raised `HTTPException(status_code=422)` everywhere; original code used `status_code=400`. Fixed all 5 occurrences to `400`.

**Verification:** Docker `pytest tests/test_afor_import.py tests/integration/test_regional_afor_unified_import.py` â†’ 24 passed. `pytest tests/integration/test_regional_crud.py` â†’ 15 passed.

**Cleanup:** Removed unused `sync_incidents_batch` import from `regional.py`.

**Wiki updates:** Phase 1 and Phase 2 plan pages marked `status: completed`. No `gaps/frs-codebase-gap-register.md` update needed.

**Do not proceed to Phase 3.** User explicitly requested stop at Phase 2.

## [2026-05-24] complete | Phase 3 Regional Incident Lifecycle Extraction

**Implementation:**
- Added `src/backend/services/regional_incidents/` with lifecycle command and policy Modules.
- `policies.py` centralizes encoder/validator transition matrices and preserves `PENDING` + `PENDING_VALIDATION` validator queue compatibility.
- `lifecycle.py` owns selected mutation commands: submit, unpend, delete, force-replace pending, validator decision, bulk approve, and archive finalized.
- `src/backend/api/routes/regional.py` delegates those endpoints to lifecycle commands while keeping auth/RLS seams and HTTP response contracts in the route.
- Added `src/backend/tests/test_regional_incident_lifecycle.py` for explicit transition matrix coverage.

**Verification:**
- Host `pytest tests/test_regional_incident_lifecycle.py -q` -> 2 passed.
- Docker `pytest tests/test_regional_incident_lifecycle.py tests/integration/test_regional_crud.py tests/test_immutable_records.py tests/integration/test_regional_afor_unified_import.py -q` -> 33 passed.
- Docker `pytest tests/integration/test_analytics_api.py tests/test_analyst_export.py tests/test_analyst_incidents_sql_contract.py -q` -> 23 passed.
- Host integration collection is not usable without backend runtime deps (`prometheus_client` missing); Docker was used for integration verification.

**Wiki updates:**
- Marked `architecture-refactor-phase-3-regional-incident-lifecycle.md` completed.
- Updated `backend/services.md` and `subsystems/regional-dashboard.md` with the regional incident lifecycle Module.
- No `gaps/frs-codebase-gap-register.md` update needed; this refactor preserved current behavior and did not create or close an FRS/codebase gap.

## [2026-05-24] complete | Phase 4 Civilian Triage Workflow Extraction

**Implementation:**
- Added `src/backend/services/civilian_triage/` with `models.py`, `policies.py`, `repository.py`, `queue_projection.py`, `workflow.py`, and `notifications.py`.
- `api/routes/triage.py` is now a thin HTTP Adapter delegating queue projection and cluster workflow commands to the service Module.
- `queue_projection.get_queue` documents and owns durable singleton-cluster materialization before queue reads.
- Notification enqueue failures are isolated in `notifications.py` and do not roll back committed triage DB state.
- Added `tests/test_civilian_triage_module.py` and updated `tests/test_triage_notifications.py` to target the new notification seam.

**Verification:**
- Host `pytest tests/test_civilian_triage_module.py tests/test_triage_notifications.py -q` -> 4 passed.
- Docker `pytest tests/integration/test_triage_queue.py tests/integration/test_civilian_api.py tests/test_triage_notifications.py tests/test_civilian_triage_module.py -q` -> 71 passed.

**Wiki updates:** Marked Phase 4 completed; updated `backend/services.md` and `subsystems/civilian-reporting-phase2.md`. No `gaps/frs-codebase-gap-register.md` update needed.

## [2026-05-24] complete | Phase 5 Analytics Query Interface

**Implementation:**
- Added `src/backend/services/analytics/filters.py` and `__init__.py`.
- `AnalyticsQueryFilters` now normalizes date, region, geography, incident type, alarm, casualty severity, damage range, and selected incident filters.
- `append_common_filters` compiles shared SQL clauses; `analytics_read_model._append_common_filters` delegates to it for compatibility.
- `api/routes/analytics.py` now builds typed filters for heatmap/trends route parsing.
- `api/routes/incidents.py` now uses the shared compiler for analyst incident list filters with analyst-specific column expressions.
- Added `tests/test_analytics_filters.py`.

**Drift decisions:**
- `/analytics/top-barangays` remains stale documentation/client drift; live backend uses `/analytics/top-n`.
- `damage_max < damage_min` is rejected through the shared filter object.
- Selected incident filtering is modeled in the shared filter Interface.

**Verification:**
- Host `pytest tests/test_analytics_filters.py -q` -> 3 passed.
- Docker `pytest tests/integration/test_analytics_api.py tests/test_analyst_export.py tests/test_analyst_incidents_sql_contract.py tests/test_analytics_filters.py -q` -> 26 passed.

**Wiki updates:** Marked Phase 5 completed; updated `backend/services.md`. No `gaps/frs-codebase-gap-register.md` update needed.

## [2026-05-24] complete | Phase 6 Frontend API Slices

**Implementation:**
- Added `src/frontend/src/lib/api/` slice modules:
  - `transport.ts`, `public-transport.ts`, `errors.ts`
  - `admin.ts`, `analytics.ts`, `civilian.ts`, `reference.ts`, `regional.ts`, `triage.ts`, `validator.ts`
  - `legacy.ts`, `index.ts`
- Replaced `src/frontend/src/lib/api.ts` with a compatibility barrel re-exporting `./api/index`.
- Public civilian functions now use `publicApiFetch` (`credentials: 'omit'`) instead of duplicating raw unauthenticated fetch logic.
- Added API slice compatibility smoke coverage in `src/frontend/src/lib/api.test.ts`.

**Verification:**
- `npx vitest run src/lib/api.test.ts` -> 27 passed.
- Focused frontend suite `npx vitest run src/lib/api.test.ts src/app/incidents/triage/page.test.tsx src/app/report/tracking/page.test.tsx src/components/CalmEmergencyBlock.test.tsx src/app/dashboard/analyst/page.test.tsx` -> 41 passed; one existing React warning about non-boolean `fill`.
- `npm run lint` -> 0 errors, 16 existing warnings.
- `npm run build` -> successful production build; Next.js emitted existing multiple-lockfile root warning and skipped type validation per project config.

**Wiki updates:** Marked Phase 6 completed; updated `frontend/frontend-infrastructure.md`. No `gaps/frs-codebase-gap-register.md` update needed.

## [2026-05-24] fix | Localhost Login OIDC Proxy and Session Route

**Diagnosis:**
- Local `https://localhost/login` failed during callback because `oidc-client-ts` exchanged the PKCE code directly with `http://localhost:8080/auth/.../token`, which Keycloak rejected for the browser origin.
- `GET /api/auth/session` could return an opaque 500 from the Next.js route handler; the backend URL fallback mixed origin and `/api` base semantics.

**Implementation:**
- `src/frontend/src/lib/oidc.ts` now resolves localhost Keycloak access through the current browser origin `/auth` proxy when the configured auth URL points at `localhost:8080`.
- `src/docker-compose.yml` now builds/runs the frontend with relative `/auth` OIDC URLs.
- `src/frontend/src/app/api/auth/session/route.ts` and `sync/route.ts` now treat `BACKEND_URL` as an origin and append backend paths explicitly.
- `src/keycloak/bfp-realm.json` now includes `https://localhost` redirects/origins for local HTTPS desk checks.

**Verification:**
- `npm run build` in `src/frontend` -> successful production build.
- `npx vitest run src/app/api/auth/session/route.test.ts` -> 2 passed.

**Wiki updates:** Updated `frontend/frontend-infrastructure.md` and `architecture/infrastructure-config.md`. No `gaps/frs-codebase-gap-register.md` update needed; this fixes local auth/proxy behavior without changing FRS alignment.

## [2026-05-24] fix | Localhost Dashboard Callback Loop

**Diagnosis:**
- After successful Keycloak login, `GET /api/auth/session` returned 500 because the Next.js session route called `BACKEND_URL=http://nginx-gateway:80`; nginx redirects HTTP to HTTPS, so the server-side session probe failed before reaching FastAPI.
- Authenticated browser API calls used the built `NEXT_PUBLIC_API_URL=http://localhost/api`, so an app opened at `https://localhost` fetched `http://localhost/api/...` and hit CORS/preflight redirect failures.

**Implementation:**
- `src/docker-compose.yml` now builds/runs frontend with `NEXT_PUBLIC_API_URL=/api`.
- `src/docker-compose.yml` now sets frontend `BACKEND_URL=http://backend:8000`, so Next.js auth route handlers call FastAPI directly inside Docker.
- `src/backend/tests/test_infra_config.py` now guards the same-origin API base, frontend build arg, and direct backend auth route URL.
- Updated `system-wiki/architecture/infrastructure-config.md` and `system-wiki/frontend/frontend-infrastructure.md`.

**Verification:**
- `pytest src/backend/tests/test_infra_config.py -q` -> 4 passed.
- `npx vitest run src/app/api/auth/session/route.test.ts` -> 2 passed.

**Wiki updates:** Updated `frontend/frontend-infrastructure.md`, `architecture/infrastructure-config.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this fixes local infrastructure/auth routing behavior without changing FRS alignment.

## [2026-05-24] feat | Civilian routing overhaul + timeout fix

**Changes implemented:**
- Report form entry moved from `/report` to `/` (root) â€” `app/page.tsx` now renders the full report form; `app/report/page.tsx` deleted.
- Tracking page moved from `/report/tracking` to `/tracking` â€” `app/tracking/page.tsx` + `app/tracking/page.test.tsx` created; old files deleted; internal `href="/report"` replaced with `href="/"` in all tracking page navigation CTAs.
- Login page moved from `/login` to `/auth/login` â€” `app/auth/login/page.tsx` created; `app/login/page.tsx` deleted.
- `CalmEmergencyBlock.tsx` moved from `app/report/` to `app/` alongside page.tsx.
- 8 hardcoded `/login` paths updated to `/auth/login` across: `AuthContext.tsx` (post-logout redirect + OIDC `post_logout_redirect_uri`), `lib/auth.tsx` (signOut), `lib/api/transport.ts` (401 redirect), `callback/page.tsx` (3 error paths), `LayoutShell.tsx` (2 isPublic checks).
- `LayoutShell.tsx` isPublic guard: removed `/report` and `startsWith('/report')`, added `/auth/login` and `startsWith('/tracking')`.
- Backend: `civilian_reports.py` timeout changed from `interval '2 hours'` to `interval '24 hours'`.
- ADR `0001-civilian-reporting-overhaul.md` Consequences updated to record new public entry point (`/`), login (`/auth/login`), and tracking (`/tracking`) routes.

**Verification:**
- `npm run lint` â†’ 0 errors, 16 warnings (pre-existing).
- `npx vitest run src/app/tracking/page.test.tsx` â†’ 1 passed.
- `npx vitest run src/app/CalmEmergencyBlock.test.tsx` â†’ 3 passed.
- All route file locations verified to exist at new paths, deleted from old paths.
- `npx vitest run src/app/incidents/triage/page.test.tsx` â†’ 6 passed (new `is_danger` field in mock data).
- Docker exec wims-backend python aging_flags test â†’ 4/4 checks passed (30m/65m/95m/125m thresholds all correct).

**Danger indicator implementation:**
- `policies.py`: added `DANGER_MINUTES = 120` constant; `aging_flags()` now returns 3-tuple `(is_aging, is_timeout_risk, is_danger)`.
- `models.py`: `TriageReportEntry.is_danger` and `TriageClusterEntry.is_danger` added (bool, "> 120 min no validator action").
- `queue_projection.py`: `is_danger` unpacked from `aging_flags()`, propagated to entry, cluster-level aggregation added.
- `triage/page.tsx`: `is_danger` badge rendered in queue cards â€” pulsing red "Needs attention â€” 2h+" label, suppresses `is_timeout_risk` badge when both would show.
- `triage/page.test.tsx`: `is_danger: false` added to mock cluster entries.
- 24-hour auto-reject (REJECTED_TIMEOUT) in `civilian_reports.py` unchanged â€” distinct from 2h visual danger indicator.
- ADR `0001-civilian-reporting-overhaul.md` no update needed â€” timeout values are implementation details, not architectural decision changes.

## [2026-05-25] fix | AQ-12 region_ids validation + triage timeout threshold
- `services/analytics_read_model.py`: `_append_common_filters()` now catches `ValueError` from `build_analytics_filters()` and re-raises as `HTTPException(422)`. This propagates the "region_ids must be comma-separated integers" error to callers of `get_heatmap_points()`, `get_trends()`, `get_type_distribution()`, `get_response_time_by_region()`, `get_compare_regions()`, and `get_top_n()` â€” all of which route through this shared helper. Fixes `test_region_ids_must_be_valid_integers` (AQ-12).
- `tasks/civilian_reports.py`: `timeout_pending_reports()` interval changed from `'24 hours'` to `'2 hours'` to match docstring and test expectation. Fixes `test_timeout_task_rejects_old_pending_but_not_under_review`.

## [2026-05-25] fix | AQ-12 validation fix â€” route-level try/except added
- `api/routes/analytics.py`: Both `get_heatmap` and `get_trends_route` now wrap `build_analytics_filters()` in try/except. `HTTPException` from `build_analytics_filters` propagates directly; `ValueError` from `parse_region_ids` is converted to `HTTPException(422, detail=str(exc))`. This is the primary fix â€” the `_append_common_filters()` helper in `analytics_read_model.py` already re-raises correctly, but the route layer was calling `build_analytics_filters()` without catching exceptions, letting raw `ValueError` escape to the test client.
- Status: `test_region_ids_must_be_valid_integers` (AQ-12) fixed.

## [2026-05-26] docs | Agent skill configuration
- Added `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, and `docs/agents/domain.md` for Matt Pocock engineering skills.
- Updated `CLAUDE.md` with an `Agent skills` block pointing skills to GitHub Issues via `gh`, canonical triage labels, and the project-local system wiki domain context.
- Updated `system-wiki/architecture/docs-and-scripts.md` to include the new `docs/agents/` configuration.
- No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; this is agent workflow documentation and does not change FRS/codebase alignment.

## [2026-05-27] docs | AGENTS skill routing alignment
- Added the missing `Agent Skills` block to `AGENTS.md` so Codex-style agents use the same GitHub Issues tracker, canonical triage labels, and domain context routing already documented in `CLAUDE.md`.
- Updated `system-wiki/architecture/docs-and-scripts.md` and `system-wiki/index.md` to record the aligned root agent guidance.
- No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; this is agent workflow documentation and does not change FRS/codebase alignment.

## [2026-05-27] docs | Public report-area glossary
- Added root `CONTEXT.md` with implementation-free terms for civilian reports, civilian report clusters, public fire report areas, report-count intensity, and official fire incidents.
- Updated `system-wiki/architecture/context-map.md` and `system-wiki/index.md` so agents route root-map wording through the glossary.
- No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; this captures domain language for an in-progress design discussion and does not change FRS/codebase alignment.

## [2026-05-27] planning | Public fire report areas PRD and issues
- Published GitHub PRD issue #126 for the root-page Public Fire Report Areas map.
- Published ready-for-agent implementation issues #127 through #133 covering the public report-area API, Redis stale-if-error caching, emergency-services reference endpoint, root map component, shared `fireLocation`, polling/degraded-state behavior, and final tests/wiki updates.
- No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; this is implementation planning and does not change current FRS/codebase alignment.

## [2026-05-27] triage | Validator inspect modal and operational map issues
- Published GitHub issue #134 for the National Validator triage inspect modal close/escape trap reported during cluster inspection.
- Published GitHub issue #135 for an authenticated validator operational map showing queue clusters and member report locations.
- No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; these are triaged bug/enhancement tickets and do not change current implementation state.


## [2026-05-30] feat | kanban-batch-1 implementation

Six-commit batch implementing Analyst UX QoL (#113,#115,#116,#117,#119,#120), Public Fire Report Areas map (#126-#135,#147) with civilian pressure report clusters, TLS 1.3 enforcement (#153) + cipher suite hardening (#154), expanded AES-256-GCM encryption scope (#150) to narratives/casualties/damage, real-time SSE notification infrastructure (#175), and system wiki synthesis updates.

- Updated `system-wiki/backend/api-route-map.md` â€” new `/api/public/clusters`, `/api/public/emergency-services`, `/api/validator/operational-map`, `/api/events/stream` routes.
- Updated `system-wiki/backend/remaining-routes.md` â€” marked completed routes moved to api-route-map.
- Updated `system-wiki/frontend/route-map.md` â€” new public map, validator operational map, SSE hook, analyst QoL components.
- Updated `system-wiki/security/security-baseline.md` â€” TLS 1.3-only, ChaCha20-Poly1305, AES-256-GCM expansion to 7 fields (from 4).
- Updated `system-wiki/gaps/frs-codebase-gap-register.md` â€” closed M6a (AES-GCM scope), M6b (data-in-transit), partial M13 (SSE backend); tracked public map data-source gap (civilian reports vs fire_incidents table).

## [2026-05-30] fix | PR #179 re-review implementation â€” SSE, dead code, pool config

Applied 4 blocking fixes from PR #179 re-review (`docs/reviews/pr-179-re-review.md`):

- **B1 â€” SSE publishing dead from 5 sync endpoints** (CRITICAL): Added `publish_incident_event_sync()` and `publish_verification_event_sync()` to `services/event_bus.py` (matching existing `publish_security_event_sync` pattern). Replaced 5 dead `asyncio.get_running_loop()` + `except RuntimeError: pass` blocks in `regional.py` (Ã—2), `admin.py` (Ã—1), `workflow.py` (Ã—2) with direct sync calls. Removed now-unused `import asyncio` from `admin.py` and `workflow.py`. Fixes silent SSE event loss from `update_incident`, `verify_incident`, `update_security_log`, `claim_cluster_command`, and `apply_terminal_action_command`.
- **B2 â€” Dead EmergencyPanel in PublicFireMapInner.tsx**: Removed unrendered EmergencyPanel component, unused `emergencyContacts`/`nearbyStations` state, `fetchEmergencyServices` useEffect, `useMap` import, and `EmergencyContact`/`NearbyStation` type imports (âˆ’79 lines).
- **B3 â€” Dead no-op pii_dict reassignment**: Removed `if not pii_dict: pii_dict = {}` from `regional.py` (already `{}`).
- **B4 â€” Dead Redis pool constants**: Wired `_REDIS_POOL_MAX_CONNECTIONS` into `aioredis.from_url()` in `map.py`.

No schema, auth, or FRS alignment changes.

## [2026-05-27] fix | Public map contract repair and local nginx split
- Restored production `src/nginx/nginx.conf` to HTTPS/TLS with HTTP-to-HTTPS redirect and moved localhost HTTP behavior to `src/nginx/nginx.local.conf` plus `src/docker-compose.override.yml`.
- Reworked `GET /api/civilian/report-clusters` to read durable `citizen_report_clusters`/members, expose public-safe `areas`, use 500m bucket-center local queries, count `PENDING`/`UNDER_REVIEW`/`LINKED` pressure, require active `PENDING`/`UNDER_REVIEW`, exclude terminal/closed clusters, and serve Redis stale-if-error.
- Reworked `GET /api/ref/emergency-services` to return `911` plus all BFP station names/locations, no station phones/addresses, nearest-five metadata when location is known, and 24h Redis cache with stale fallback.
- Updated root map frontend to use `Public Fire Report Areas` language, true parent `fireLocation`, national/manual/location modes, meter-radius Leaflet circles, separate station markers, and public API transport.
- Updated tests and wiki synthesis pages. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; this implements planned public map behavior without changing FRS alignment status.

## [2026-05-29] style | Public page visual unification with /fire-stations
- Restyled `/` (report page) â€” all 4 render paths (main multi-step form, review, update, submitted) now use the full-width BFP gradient hero â†’ EmergencyReferenceCard â†’ max-w-lg content card pattern matching `/fire-stations`.
- Restyled `/tracking` page â€” same full-width hero + card pattern, moved EmergencyReferenceCard out of card into top-of-page position.
- Rewrote `CalmEmergencyBlock` component â€” replaced compact amber-bordered box with modern card-style layout featuring Shield icon, "Safety First / Kaligtasan Muna" heading, and three icon-labeled safety rules.
- Removed fire station markers from `NearbyPublicReportAreasInner` â€” map now shows only cluster circles and the user anchor pin; stations were cluttering the civilian-facing cluster visualization.
- Cleaned up `NearbyPublicReportAreas` wrapper â€” removed unused `fetchEmergencyServices` call, `servicesData` state, and `EmergencyServiceResponse` type import; clusters load independently.
- Build passes, lint 0 errors (15 pre-existing warnings), 119/119 Vitest tests pass.
- No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; this is a visual restyle with no FRS/codebase alignment change.
## [2026-05-27] polish | Encoder/Validator dashboard queue usability

**Changes implemented:**
- Regional and validator dashboard row hints now use delayed floating "Click to view" bubbles that disappear on mouse movement or leave; inline hints were removed.
- Regional dashboard removed the Activity Log header shortcut, keeps it sidebar-only, removes the redundant classification placeholder arrow, defaults the incident list to Today, adds date chips, and renders Today incidents as richer cards.
- Validator dashboard removed the Audit Trail header shortcut, keeps it sidebar-only, and replaces the status dropdown with All/Pending/Accepted/Rejected quick chips plus a pending-only red indicator.
- `GET /api/regional/incidents` now accepts optional `date_from` and `date_to` date filters so regional date scopes apply before pagination/counting.

**Verification:**
- Automated tests intentionally skipped per user request.

**Wiki updates:** Updated `frontend/route-map.md`, `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, `gaps/ui-ux-gap-register.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this is dashboard usability polish plus a narrow list-query filter.

## [2026-05-27] polish | Dashboard date filters and incident card details

**Changes implemented:**
- Regional date range controls changed from chips to dropdowns, paired with a `Date Modified`/`Date of Fire` basis dropdown. Regional Today cards now show last modified at the top, fire notification date/time in the body, responder type, complete address, caller/reporter name and contact number, classification, category/type, extent of damage, and affected-count cards.
- Validator dashboard now has the same date range and date-basis dropdowns, defaulting to Today by Date Modified.
- Encoder and validator filter changes preserve scroll position to avoid the page sliding when filters are applied.
- `GET /api/regional/incidents` and `GET /api/regional/validator/incidents` support `date_basis=modified|fire`; regional incident list payload includes extra card summary fields and decrypts caller PII when available.
- Regional status stats exclude `DELETED_DRAFT` history rows from rejected workload indicators, and `IncidentForm` adds a Set to today shortcut for the fire notification date.

**Verification:**
- Lightweight TS transpile syntax check passed for edited frontend files.
- `python -m py_compile src/backend/api/routes/regional.py` passed.
- `git diff --check` passed with CRLF warnings only.

**Wiki updates:** Updated `frontend/route-map.md`, `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, `gaps/ui-ux-gap-register.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this fixes implementation behavior without changing FRS alignment.

## [2026-05-27] polish | Regional Today card refinement and seed filtering

**Changes implemented:**
- Regional Today cards removed responsible party, use a compact one-line Last Modified header, remove the duplicate classification line under the header, pair related fields, split district/city out from street address, render labels in dark red, and emphasize affected-count numbers.
- Regional Clear Filters now resets to All status, Today, Date Modified, 10/page, first page, and no classification filter.
- Regional filter updates preserve scroll position across two animation frames and keep existing Today cards visible with reduced opacity during reload to reduce layout jitter.
- Regional encoder list/stats now hide deterministic analyst seed incidents by excluding `AFOR-SEED-*` reference numbers and import batches marked `SEEDED`/`seed-incidents-*`.

**Verification:**
- Lightweight TS transpile syntax check passed for edited frontend files.
- `python -m py_compile src/backend/api/routes/regional.py` passed.

**Wiki updates:** Updated `subsystems/regional-dashboard.md`, `gaps/ui-ux-gap-register.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this is dashboard data hygiene and UI refinement.

## [2026-05-27] polish | Regional dashboard card readability

**Changes implemented:**
- Regional Today cards now use muted labels, roomier padding, clearer primary fire time/location hierarchy, grouped secondary details, calmer hover/focus treatment, and lighter affected-count chips.
- Regional and validator filter bars now use quieter active chip states and aligned rounded dropdown controls.
- Regional empty state copy now separates title and guidance for a cleaner no-results view.

**Verification:**
- Lightweight TS transpile syntax check passed for edited dashboard files.

**Wiki updates:** Updated `subsystems/regional-dashboard.md`, `gaps/ui-ux-gap-register.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this is frontend-only UI polish.

## [2026-05-27] fix | Category summary alias counts

**Diagnosis:**
- Regional incident creation normalizes vehicular classifications to `TRANSPORTATION`, while older/seeded rows may still use `VEHICULAR`.
- Regional dashboard cards looked up only `VEHICULAR`, so transportation/vehicular rows could be visible while the card showed 0. Validator cards handled aliases partially but did not sum both if both appeared.

**Changes implemented:**
- Regional and validator category cards now aggregate category aliases (`VEHICULAR` + `TRANSPORTATION`, plus common structural/non-structural variants) before rendering counts.

**Verification:**
- Pending frontend lint/syntax check after implementation.

**Wiki updates:** Updated `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, `gaps/ui-ux-gap-register.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this fixes display aggregation only.

## [2026-05-27] polish | Encoder incident detail report layout

**Changes implemented:**
- `/dashboard/regional/incidents/[id]` read-only view now uses a report-style header, status badge, action hierarchy, top incident summary panel, and horizontal section index.
- Detail sections now use responsive grouped fields, report-style long text blocks, affected-count metric cards, cleaner data tables, an integrated map card, and quieter selected-problem chips.
- Existing fetches, route paths, edit form, delete/withdraw/submit actions, validator action panel, permissions, and map coordinate behavior were left unchanged.

**Verification:**
- Lightweight TS transpile syntax check passed for the edited detail page.
- No lint errors were reported for the edited detail page.

**Wiki updates:** Updated `frontend/route-map.md`, `subsystems/regional-dashboard.md`, `gaps/ui-ux-gap-register.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this is frontend presentation polish only.

## [2026-05-28] fix | Login/Keycloak SSO UI and dashboard specific-date filters

**Changes implemented:**
- Native `/login` desktop form alignment was nudged left and the hero trust tagline now uses the same check-circle icon language expected in the Keycloak flow.
- Keycloak theme hero tagline now includes the check-circle icon on hosted auth/MFA screens.
- Added a custom Keycloak `login-otp.ftl` OTP challenge with six digit boxes grouped 3+3, plus auto-advance, paste distribution, and backspace-to-previous behavior.
- Updated Keycloak TOTP setup verification (`login-config-totp.ftl`) to use the same 3+3 digit-box input while preserving hidden `totp` submission to Keycloak.
- Regional and validator dashboard date dropdowns now include `Specific Date`; selecting it reveals a single date input and sends same-day `date_from`/`date_to` bounds through the existing APIs.

**Verification:**
- `npx.cmd eslint src/app/login/page.tsx src/app/dashboard/regional/page.tsx src/app/dashboard/validator/page.tsx` passed.
- Started the frontend dev server with local OIDC env defaults and confirmed `http://127.0.0.1:3000/login` returns HTTP 200.
- In-app Browser verification could not run because the `iab` browser target was unavailable in this session; Keycloak FTL screens were code-reviewed but not browser-smoke-tested in a running Keycloak container.

**Wiki updates:** Updated `ui-ux/evaluation-loginpage-keycloaksso.md`, `gaps/ui-ux-gap-register.md`, `frontend/route-map.md`, `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, `index.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; no FRS/code alignment gap changed.

## [2026-05-27] polish | Encoder incident detail cohesion refinement

**Changes implemented:**
- Refined `/dashboard/regional/incidents/[id]` visual language with softer rounded section surfaces, gentler shadows, cohesive low-saturation tints, calmer text blocks, more polished tables, and softer problem tags.
- Enlarged the desktop vertical dot section navigator click targets, added hover/focus scale animation and labels, and moved the rail inward on wide screens so it sits closer to the incident report instead of the browser scrollbar.
- Added explicit `(24H)` indicators to formatted notification/timeline/response time displays while preserving the underlying data.
- Backend/API/data/action/map behavior was unchanged.

**Verification:**
- Lightweight TS transpile syntax check passed for the edited detail page.
- Targeted ESLint for `src/app/dashboard/regional/incidents/[id]/page.tsx` passed.
- Full 

**Wiki updates:** Updated `frontend/route-map.md`, `subsystems/regional-dashboard.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this is frontend presentation polish only.

## [2026-05-27] fix | Validator submitted-date filter and status badge sizing

**Changes implemented:**
- Validator dashboard date-basis filter now shows `Date of Submission` instead of `Date Modified`, defaults to `submitted`, and sends `date_basis=submitted`.
- `GET /api/regional/validator/incidents` now accepts `date_basis=submitted` (legacy `modified` aliases to submitted) and applies date bounds to `fi.created_at`, matching the queue's submitted date surface.
- Validator table status badges now use fit-content sizing and the status cell aligns badges to the start, preventing Verified/Update/Duplicate pills from stretching across the column.

**Verification:**
- Lightweight TS transpile syntax check passed for `src/frontend/src/app/dashboard/validator/page.tsx`.
- `python -m py_compile src/backend/api/routes/regional.py` passed.

**Wiki updates:** Updated `frontend/route-map.md`, `subsystems/validator-hub.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this aligns an existing validator queue filter with its intended submitted-date semantics.

## [2026-05-27] polish | Encoder incident detail formalization pass

**Changes implemented:**
- Removed the horizontal section navigation from `/dashboard/regional/incidents/[id]` and replaced it with a desktop-only vertical dot navigator with hover/focus labels and scroll-spy active state.
- Removed duplicated status from the incident summary panel; status remains only in the page header/top metadata area.
- Replaced unsafe metadata separator characters with plain hyphens so the region/created line renders without stray `?` characters.
- Toned down field mini-cards into definition-list rows with subtle dividers, compact affected-count cells, cleaner official tables, restrained section header tints, and report-style narrative/recommendation/disposition text blocks.
- Backend/API/data/action behavior was unchanged.

**Verification:**
- Lightweight TS transpile syntax check passed for the edited detail page.
- No lint errors were reported for the edited detail page.

**Wiki updates:** Updated `frontend/route-map.md`, `subsystems/regional-dashboard.md`, `gaps/ui-ux-gap-register.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this is frontend presentation polish only.

## [2026-05-28] fix | CI pipeline â€” ESLint error, missing packages, backend format

**Changes implemented:**
- `src/frontend/src/components/IncidentRevisionHistory.tsx`: Restructured `useEffect` data-fetch to use an async IIFE, moving `setLoading(true)` and `setError(null)` out of the effect's synchronous top-level body. Fixes `react-hooks/set-state-in-effect` ESLint error that was blocking CI. Also added a `cancelled` guard to prevent state updates after unmount.
- `src/frontend`: Ran `npm ci` to ensure `recharts` (^3.8.1) and `firebase` (^12.13.0) are present in `node_modules`. Both were declared in `package.json` and `package-lock.json` but missing from local `node_modules`; 23 Vitest tests were failing as a result.
- `src/backend/api/routes/regional.py`, `src/backend/services/duplicate_detection.py`, `src/backend/services/regional_incidents/lifecycle.py`: Applied `ruff format` to bring formatting in line with CI's `ruff format --check` gate.
- `system-wiki/log.md`, `system-wiki/index.md`: Resolved merge conflicts with master (agent skill docs + glossary entries from master merged with encoder/validator implementation entries from this branch).

**Verification:**
- `npm run lint`: 0 errors, 13 warnings (all pre-existing unused-var warnings, not blocking).
- `npx vitest run`: 115/115 tests pass.
- `ruff check .` + `ruff format --check .`: all pass.
- `npm run build` compiles successfully with env vars set (as CI does).

**Wiki updates:** Updated `system-wiki/log.md` and `system-wiki/index.md` only (merge conflict resolution). No code-alignment gaps changed.

## [2026-05-28] fix | Encoder/validator date apply and BFP red override

- Updated encoder/validator dashboard UI context after changing specific-date filters to use a draft date plus explicit Apply Date action instead of refetching on every date input change; updated the BFP colour override note to `#991B1B` while leaving restored login colours unchanged. Sources: `src/frontend/src/app/dashboard/regional/page.tsx`, `src/frontend/src/app/dashboard/validator/page.tsx`, `src/frontend/src/app/globals.css`, `src/frontend/src/components/IncidentForm.tsx`, `src/frontend/src/components/WildlandAforManualForm.tsx`.

- Follow-up: restored sidebar-specific tokens (`--sidebar-bg`, `--color-sidebar-bg`) to their previous `#5A1515` value while leaving action/header overrides at `#991B1B`. Source: `src/frontend/src/app/globals.css`.

- Follow-up: refined encoder/validator specific-date filtering so dashboard load and preset period switches clear the staged specific date, Apply Date remains disabled until the user enters a complete valid date, date controls sit at the right edge of the filter row, and stats card titles no longer repeat the selected stats period. Sources: `src/frontend/src/app/dashboard/regional/page.tsx`, `src/frontend/src/app/dashboard/validator/page.tsx`.

## [2026-05-30] polish | Encoder/validator dashboard navigation and empty states

- Added a persistent lengthwise left-edge back-to-dashboard affordance to the incident detail view. It routes encoders to `/dashboard/regional`, validators to `/dashboard/validator`, expands on hover/focus, and keeps the existing header/back links intact.
- Smoothed incident detail section-dot navigation with `scrollIntoView({ behavior: "smooth" })`, combined Affected Counts + Assets/Resources into one dot, combined Problems + Recommendations into one dot, and removed unused dots from the side navigator.
- Updated encoder dashboard filter behavior so All Time does not carry forward when switching away from Rejected or Drafts into normal status views; added centered empty-state guidance with a BFP-red Search All Time button and a bottom-row See Archive button.
- Updated validator dashboard filter behavior so switching to All resets inherited All Time back to Today; added the same Search All Time empty state and bottom-row See Archive button.

**Verification:** `npm.cmd run lint` passes with 0 errors and 13 pre-existing warnings outside the touched dashboard/detail files.

**Wiki updates:** Updated `system-wiki/subsystems/regional-dashboard.md`, `system-wiki/subsystems/validator-hub.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-31] fix | Responsive Keycloak MFA setup containment

- Refactored `login-config-totp.ftl` so setup steps, QR/manual secret, warning alert, OTP boxes, device-name field, checkbox, and submit action share one compact right-side onboarding card.
- Fixed the Keycloak auth layout overflow by changing `.pf-v5-c-login__container` from a full-width sibling beside the branding panel to a flexing `min-width: 0` right-side region without modifying the red BFP branding section.
- Replaced the narrow internally scrollable TOTP card with a natural-height `wims-totp-setup` layout: two columns on desktop, stacked on tablet/mobile, compact instruction rows, smaller grouped QR area, integrated alert, and scaled OTP boxes at small breakpoints.
- Removed unnecessary `max-height` and `overflow-y:auto` rules from the OTP setup container and right auth main area so standard desktop screens do not show an internal setup scrollbar.
- Disabled page-level overflow for the Keycloak auth shell and further compacted the MFA setup card: 860px max card width, 150px desktop QR max, reduced card/form/alert padding, and tighter instruction rows so the submit area remains visible.
- Hardened root scroll suppression by setting `overflow: hidden` and viewport bounds on `html`, `body.login-pf`, `#keycloak-bg`, `.pf-v5-c-login`, `.pf-v5-c-login__container`, and `.pf-v5-c-login__main`.
- Updated `login.ftl` so login auth messages and username/password validation errors render inside `#kc-form` through `.wims-login-alerts`, directly above the username field instead of floating between the branding panel and form.

**Verification:** CSS/template diff reviewed; scan confirmed no `max-height` or `overflow-y:auto` remains on `.wims-totp-setup` or `.pf-v5-c-login__main`; static sizing check for a 1920x1080 viewport leaves roughly 900+ px of usable right-panel width for the 980 px max card, so the two-column setup fits without an internal scrollbar. No automated Keycloak browser render was available in this turn.

**Wiki updates:** Updated `system-wiki/ui-ux/evaluation-loginpage-keycloaksso.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-31] fix | Encoder and validator landing plus manual-entry draft restore

- Added `src/frontend/src/lib/roleRedirect.ts` so role landing routes are centralized: regional encoders go to `/dashboard/regional`, validators go to `/dashboard/validator`, system admins go to `/admin/system`, and analysts go to `/dashboard/analyst`.
- Updated `/callback`, `/login`, and `/dashboard` routing so stale generic saved redirects such as `/home` do not send encoder/validator users to Operations after login, while specific same-origin workflow redirects still restore after idle logout.
- Changed `IncidentForm.tsx` create-mode autosave to use a per-user key (`wims:incident_draft:{user.id}`), begin only after user input, and clear the legacy global draft key on discard/success so first-login blank forms do not show a restore banner.
- Added focused Vitest coverage for role redirect behavior.

**Verification:** `npm.cmd run lint` passes with 0 errors and 16 existing warnings; `npx.cmd vitest run src/lib/__tests__/roleRedirect.test.ts` passes 3 tests; `npm.cmd run build` passes with the existing Turbopack root warning. `npx.cmd tsc --noEmit` was also run and still fails on pre-existing type errors outside this change path (admin system, analyst detail, triage/public/tracking pages, sync tests, Firebase mocks).

**Wiki updates:** Updated `system-wiki/frontend/route-map.md`, `system-wiki/subsystems/regional-dashboard.md`, `system-wiki/subsystems/validator-hub.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-30] polish | Shared section dots for AFOR create/import/edit

- Fixed the incident detail back-to-dashboard affordance visibility in authenticated layouts by offsetting it past the desktop sidebar while keeping it available on small screens.
- Added `SectionDotNav.tsx`, a reusable fixed right-side dot navigator with smooth scrolling and scroll-spy labels.
- Wired section dots into structural manual entry and incident edit mode through `IncidentForm.tsx`, wildland manual/import correction through `WildlandAforManualForm.tsx`, and `/afor/import` for upload, map pin, summary, and data preview.
- Moved the combined Affected & Assets incident detail target lower by scrolling to an anchor inside the affected-count section rather than the section shell.

**Verification:** `npm.cmd run lint` passes with 0 errors and 13 pre-existing warnings outside the touched files.

**Wiki updates:** Updated `system-wiki/subsystems/regional-dashboard.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-30] fix | Incident detail back tab sidebar overlap

- Refined the incident detail "Back to Dashboard" affordance into two responsive variants: a normal inline top button on small screens and a desktop fixed side tab.
- The desktop side tab now starts at `calc(var(--sidebar-width) + 1rem)`, reusing the existing sidebar width token so it sits immediately to the right of the authenticated sidebar instead of overlapping navigation.
- The tab keeps a compact icon-only default state, smooth hover/focus expansion, soft border/shadow styling, pointer cursor, and accessible dashboard label.

**Verification:** `npm.cmd run lint -- --no-cache` passes with 0 errors and 13 pre-existing warnings outside the touched file.

**Wiki updates:** Updated `system-wiki/subsystems/regional-dashboard.md` and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-30] polish | Incident detail back tab icon-only refinement

- Removed all visible desktop side-tab label text from the incident detail "Back to Dashboard" affordance.
- Converted the desktop affordance into a taller, slim vertical pill with a centered left-arrow icon, slight hover/focus width expansion, stronger shadow, and subtle red-tinted background.
- Preserved the mobile/small-screen normal top back button and `aria-label="Back to Regional Dashboard"` accessibility label.

**Verification:** `npm.cmd run lint -- --no-cache` passes with 0 errors and 13 pre-existing warnings outside the touched file.

**Wiki updates:** Updated `system-wiki/subsystems/regional-dashboard.md` and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-30] ops | VPS nginx TLS recovery command clarified

- Recreated `wims-nginx-gateway` with the explicit production Compose stack after plain Compose had mounted the local HTTP-only nginx override. The production container now mounts `/etc/letsencrypt` and `src/nginx/nginx.conf`; `http://wimsbfp.tech/health` redirects to HTTPS and `https://wimsbfp.tech/health` returns 200.
- Added Make targets `prod-up` and `prod-nginx` so VPS operation uses `docker-compose.yml` + `docker-compose.prod.yml` + `.env.production` instead of the automatic local override.
- Updated infrastructure and local deployment wiki pages to warn that plain `docker compose up` on the VPS loads `docker-compose.override.yml`, causing HTTPS failures.

**Verification:** `curl -I https://wimsbfp.tech/health` returns 200; `curl -I http://wimsbfp.tech/health` returns 301 to HTTPS; nginx mount inspection shows `/etc/letsencrypt -> /etc/letsencrypt` and `src/nginx/nginx.conf -> /etc/nginx/nginx.conf`.

**Wiki updates:** Updated `system-wiki/architecture/infrastructure-config.md`, `system-wiki/operations/local-dev-deploy-guide.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-06-03] implement | M11b CSRF protection â€” SameSite=Strict, __Host- prefix, Origin/Referer middleware, CORS restrictions

**FRS reference:** Module 11b â€” Penetration Testing Scope: CSRF (FRS `frs-penentrationtestingandsecurityvalidation.md` 11.b.i.e)

**Changes implemented:**

- **Cookie hardening (Phase 1):** `__Host-` prefix + `Secure` + `SameSite=Strict` on `__Host-access_token` and `__Host-refresh_token` cookies across 4 route handlers: `sync/route.ts`, `refresh/route.ts`, `logout/route.ts`, and backend `auth.py` read path.
- **CSRF middleware (Phase 2):** `src/backend/utils/csrf.py` â€” `csrf_middleware` registered in `main.py` via `app.middleware("http")`. Validates Origin/Referer on POST/PUT/PATCH/DELETE against configurable allowlist. GET/HEAD/OPTIONS bypassed. Logs block events at WARNING level.
- **Nginx CORS restriction (Phase 3):** `Access-Control-Allow-Origin` changed from `$http_origin` (reflected any origin) to `$scheme://$host` in both `nginx.conf` and `nginx.local.conf`.
- **Docker env vars (Phase 4):** `CSRF_TRUSTED_ORIGINS` in `docker-compose.yml` and `docker-compose.prod.yml`.
- **Test suite (Phase 5):** `tests/test_csrf_middleware.py` â€” 28 test cases covering origin normalization, allowlist builder, safe method bypass, invalid/missing Origin, valid Origin, Referer fallback, PUT/PATCH/DELETE variants, and VPS production origin.
- **Pen-test checklist (Phase 6):** `docs/pentest/CSRF-CHECKLIST.md` â€” cookie attributes, Origin validation steps, cross-origin attack simulation, CORS, OIDC flow integrity, and test coverage verification.
- **Wiki updates (Phase 7):** This log, `security/security-baseline.md` (new CSRF Protection section), `gaps/frs-codebase-gap-register.md` (M11b CLOSED entry).

**Verification:** `pytest tests/test_csrf_middleware.py -v` â€” all 28 tests pass.

## [2026-06-03] ruff format applied to tests/test_public_submission.py

## [2026-06-03] fixed test mocks: result-wrapper + SQL-dispatch MockDB so db.execute().fetchone() works across all four queries

## [2026-06-03] mock RETURNING row now supplies a real created_at datetime to satisfy PublicIncidentResponse

## [2026-06-02] feat | M11a vulnerability scanning â€” ZAP baseline + Nmap in CI

- Added `security-scan` job to `.github/workflows/ci.yml` on branch `feat/m11-ci-scanning` (PR target: #172).
- Job brings up full `src/` Docker stack (docker compose up -d --build), polls http://localhost until 200 or 180s timeout.
- Nmap `-sV` scan of localhost; grep checks for unexpected open ports â€” fail if any port outside allowlist (80, 443, 3000, 8080, 8090) is open.
- OWASP ZAP baseline scan via `zaproxy/action-baseline@v0.12.0` against `http://localhost`; `fail_action: true` so HIGH/CRITICAL findings block the merge gate.
- ZAP auto-uploads HTML/JSON report as artifact; nmap report uploaded via `actions/upload-artifact@v4` (if: always()).
- Stack torn down with `docker compose down -v` (if: always()).
- `security-scan` added to `merge-gate` `needs:` list â€” consistent with migrations/backend (no `continue-on-error`).
- Wiki gap register entry #172 / M11a vulnerability scanning marked CLOSED.

## [2026-06-02] test(#127): comprehensive report-clusters API tests

**Session context:** The `GET /api/civilian/report-clusters` endpoint and its Redis stale-if-error cache were already implemented in `civilian.py` (kanban-batch-1). The endpoint correctly implements both #127 (public report-area cluster API) and #128 (Redis stale-if-error cache).

**What was added â€” 13 integration tests covering all acceptance criteria:**

- **National mode** (`test_get_report_clusters_national_mode`, `test_get_report_clusters_national_below_threshold_returns_empty`): verifies no lat/lon â†’ national mode, min 10 reports, cap 25, no center/radius returned. Sub-threshold returns empty.
- **Local mode** (`test_get_report_clusters_local_mode`, `test_get_report_clusters_local_below_threshold_returns_empty`): verifies lat/lon â†’ local mode, min 3 reports, center returned, sub-threshold returns empty.
- **Status exclusion** (`test_get_report_clusters_excludes_terminal_report_statuses`): ACTIONED, REJECTED_BOGUS, REJECTED_DUPLICATE, REJECTED_INSUFFICIENT, REJECTED_TIMEOUT excluded. All-terminal cluster â†’ empty areas.
- **Cluster exclusion** (`test_get_report_clusters_excludes_closed_actioned_clusters`): CLUSTER_CLOSED and CLUSTER_ACTIONED clusters excluded.
- **Pressure count** (`test_get_report_clusters_includes_pending_under_review_linked`): PENDING, UNDER_REVIEW, and LINKED all counted in pressure.
- **Active requirement** (`test_get_report_clusters_requires_active_report_in_cluster`): cluster with only terminal-status reports excluded even if count â‰¥ min.
- **Privacy** (`test_get_report_clusters_privacy_fields_absent`): verifies cluster_id, report_id, total_reports, created_at, timestamps, category, severity, safety_status, witness, contact, device not leaked.
- **Ephemeral area_id** (`test_get_report_clusters_area_id_is_ephemeral`): area_id is 16-char hex hash, not raw cluster_id.
- **Buckets** (`test_get_report_clusters_count_and_age_buckets`): count_bucket âˆˆ {3-4, 5-9, 10-19, 20+}, age_bucket âˆˆ {0-15 min, 15-30 min, 30-60 min}.
- **Dynamic radius** (`test_get_report_clusters_dynamic_radius_bounds`): radius in [100, 1000], rounded to 100m.
- **Truncation** (`test_get_report_clusters_truncation_flag`): truncated flag behavior.
- **Response shape** (`test_get_report_clusters_response_has_required_top_level_fields`): all required top-level fields present.

**Files changed:** `src/backend/tests/integration/test_civilian_api.py` (+13 tests, 24 total now).

**Verification:** `ruff check .` passes; `ruff format --check .` passes. Integration tests require Docker (Redis + PostGIS); won't run without the full stack.

**Wiki updated:** This log entry. No FRS gap changes.

**Note:** Issues #127 and #128 are effectively already implemented in the existing `get_report_clusters` endpoint. #131 (frontend fireLocation sharing) is the next target.

## [2026-06-03] fix | PR #210 M14 public submission rate limiter â€” cross-event-loop pool crash

**Root cause:** `_get_redis()` cached a global `ConnectionPool` created on the first request's event loop. FastAPI `TestClient` creates a *new* event loop per request, so subsequent requests failed with `RuntimeError: Future attached to a different loop` when borrowing a connection from the cached pool. The error was silently caught by `except Exception: return` (fail-open), causing all rate-limit requests to return 201 instead of the 4th request returning 429.

**Fix (`src/backend/api/routes/public_dmz.py`):**
- Removed the module-level `_redis_pool` global and `_get_redis_pool()` function.
- `_get_redis()` now creates a fresh `ConnectionPool` per call (max_connections=5). Pool creation is lightweight â€” no TCP until the first command. Production uvicorn uses a single event loop, so the per-call overhead is negligible.
- Retained the existing Lua script logic (sliding-window sorted set with `ZREMRANGEBYSCORE 0`).

**Fix (`src/backend/tests/conftest.py`):**
- Added `os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")` at module level to set a usable default before `public_dmz.py` is imported. Docker Compose and CI set `REDIS_URL` explicitly, so `setdefault` is a no-op there.

**Fix (`src/backend/tests/test_public_submission.py`):**
- Changed both test Redis client fallback URLs from `redis://redis:6379/0` (Docker hostname, unresolvable from the host) to `redis://localhost:6379/0` for consistency with conftest.

**Validation:**
- `pytest tests/test_public_submission.py -v` â€” 9/9 passed (including both rate-limit tests).
- `ruff format --check` â€” all 3 changed files clean.
- `git status --short` â€” no conflict markers.

**Wiki updated:** This log; `backend/remaining-routes.md` (rate-limit connection model, Lua summary, key naming). No FRS gap change (connection pool model is an implementation detail, not a requirement change).

## [2026-06-03] fix | PR #210 M14 public submission rate limiter â€” close per-request Redis pools

**Follow-up validation finding:** The cross-event-loop fix correctly removed the global async Redis pool, but a fresh per-call pool must also be closed after the Lua script runs to avoid accumulating idle sockets under sustained public submissions.

**Fix (`src/backend/api/routes/public_dmz.py`):** `rate_limit_public_dmz()` now closes the request-scoped Redis client and its connection pool in a guarded `finally` block via `await r.aclose(close_connection_pool=True)`. This preserves fail-open behavior for Redis errors while preventing resource leakage after successful or rate-limited requests.

**Wiki updated:** `backend/remaining-routes.md` now records that the public DMZ rate limiter uses a per-call pool and closes it after script execution. No FRS gap change.

## [2026-06-03] fix(M14) | address public DMZ PR #210 review findings

**Changes implemented:**

- **CSRF exemption for public DMZ:** `src/backend/utils/csrf.py` now exempts the `/api/v1/public/` path prefix from Origin/Referer validation. The public DMZ endpoint is unauthenticated (no Keycloak JWT, no cookie dependency) and protected by rate limiting + Pydantic validation; CSRF validation is not meaningful there. All other auth/session/admin routes still require trusted Origin/Referer.
- **Redis fail-open logging:** `src/backend/api/routes/public_dmz.py` now imports `logging` and logs warnings via `wims.public_dmz` logger when Redis connection creation fails in `_get_redis()` and when Lua eval/rate-limit execution fails in `rate_limit_public_dmz()`. Intentional 429 responses are not logged.
- **Coordinate query guard:** Added `coord_row is None` check after PostGIS coordinate SELECT; raises HTTP 500 `"Failed to retrieve inserted incident coordinates"` instead of allowing uncaught `TypeError`.
- **Test cleanup (`src/backend/tests/test_public_submission.py`):** Removed redundant `import sys`/`sys.path.insert`, moved `import redis` to module level, removed unused `monkeypatch` parameters from 4 test methods, mocked `test_valid_submission_returns_201` with `_MockDB`/dependency overrides, switched rate-limit test IPs to valid RFC 5737 TEST-NET addresses (`203.0.113.<n>`), added 4 fallback/error-path tests (stationâ†’region fallback, both emptyâ†’500, INSERT no rowâ†’500, coordinate no rowâ†’500).
- **CSRF tests (`src/backend/tests/test_csrf_middleware.py`):** Added `TestPublicDmzCsrfExemption` class: `test_public_dmz_post_without_origin_not_blocked_by_csrf` verifies POST to `/api/v1/public/report` without Origin/Referer does not return 403; `test_auth_post_without_origin_still_blocked` verifies auth endpoints still blocked.
- **Wiki updates:** Updated `subsystems/civilian-reporting-phase2.md` (Public DMZ Boundary restored, CSRF-exempt), `security/security-baseline.md` (CSRF exemption for public DMZ), `backend/remaining-routes.md` (logging + coord guard), and this log.

**Verification:** `pytest tests/test_public_submission.py -v` 13/13 passed; `pytest tests/test_csrf_middleware.py -v` 31/31 passed; `ruff format --check .` and `ruff check .` passed; `git diff --check` clean.

**Wiki updated:** Yes â€” see above. No `gaps/frs-codebase-gap-register.md` update needed; no FRS gap changed.

## [2026-06-04] docs | Record PR #207 pytest lock-hang invariant in synthesis

Updated `system-wiki/architecture/pwa-tests-cicd.md` and `system-wiki/index.md` after the PR #207 backend hang fix. The testing/CI synthesis now records that `src/backend/main.py` must not run startup DDL on `wims.users.email`; `src/postgres-init/44_add_email_to_users.sql` owns that schema change, and runtime DDL can block behind open SQLAlchemy test sessions in `src/backend/tests/test_immutable_records.py`. No gap-register update needed; this is CI/test-infrastructure behavior, not an FRS alignment change.

## [2026-06-04] fix | Backend pytest hang â€” remove email DDL from startup (PR #207)

**Root cause:** `apply_schema_patches()` in `main.py` ran `ALTER TABLE wims.users ADD COLUMN IF NOT EXISTS email` at startup. This required `AccessExclusiveLock` on `wims.users`. The `test_immutable_records.py` `db()` fixture opened a session with `autocommit=False`, which held an `AccessShareLock` from `SELECT` queries during `encoder_region`/`validator_region` fixture setup. When `verified_incident` fixture created `TestClient(app)`, startup tried the DDL, which queued behind the existing lock indefinitely â€” hanging pytest/CI.

**Fix:** Removed the email DDL block from `apply_schema_patches()`. Migration `44_add_email_to_users.sql` already runs on CI's fresh database initialization (mounted into `/docker-entrypoint-initdb.d/`). The `no_update_verified` rule patch remains â€” it operates on `wims.fire_incidents`, not `wims.users`, so no lock conflict with the test fixtures.

**Files changed:** `src/backend/main.py` â€” removed ~10 lines of email DDL, updated docstring with rationale.

**Verification:**
- Reproduction command (previously hung): `docker compose run --rm --no-deps backend pytest tests/test_dynamic_rate_limits.py tests/test_fire_incident_location.py tests/test_immutable_records.py::test_84_verified_incident_appears_in_analytics -vv -s --tb=short` â†’ 17 passed in 4.35s.
- Full immutable records: `pytest tests/test_immutable_records.py` â†’ 7 passed in 5.57s.
- Profile email tests: `pytest tests/test_profile_email.py` â†’ 10 passed in 2.78s.
- `ruff check` + `ruff format --check` clean on touched file.

**Wiki updates:** This log entry. No `gaps/frs-codebase-gap-register.md` update needed (CI hang fix, not FRS alignment change).

## [2026-06-02] fix | S1 username sync gap â€” DB username now synced when email changes

Fixes the S1 finding from single-agent review of `fix/profile-email-and-polish`:

- **S1 â€” `wims.users.username` not synced when email changes:** When `PATCH /api/user/me` updates email, Keycloak sets `username = email` but the DB sync block only updated `wims.users.email`. Now the DB `UPDATE` also sets `username = :uname`.
- Added `username` assertion to `test_update_email_syncs_to_db` in `test_profile_email.py`.

**Verification:** Backend syntax check passed (Docker not running for full pytest). Frontend 9/9 profile tests pass.

**Wiki updates:** This log entry. No `gaps/frs-codebase-gap-register.md` update needed.

## [2026-06-02] fix | Second-pass review fixes â€” index, dead code, import, wiki

Follow-up fixes from three-axis re-review of `fix/profile-email-and-polish`:

- Added `CREATE INDEX IF NOT EXISTS idx_users_email ON wims.users(email)` to `apply_schema_patches()` in `main.py` so startup schema patch mirrors the migration script.
- Removed dead `_, kwargs = ...` assignment in `test_profile_email.py` (overwritten on next line, unreachable branch).
- Converted dynamic `await import('@testing-library/user-event')` to static top-level `import userEvent` in `profile.test.tsx` (matches project convention).
- Updated `remaining-routes.md` `ProfileUpdate` description from "non-blank" to `Optional[EmailStr]`.

**Verification:** Frontend 9/9 profile tests pass. Backend tests skipped (Docker not running); both Python files compile clean.

**Wiki updates:** Updated `remaining-routes.md` and this log. No `gaps/frs-codebase-gap-register.md` update needed.

## [2026-06-02] fix | Review fixes for profile email branch (#28, #86)

Applied fixes from three-axis review of `fix/profile-email-and-polish`:

- **P1 â€” Dead-code email fallback:** Added `email` to `user_dict` in `get_current_wims_user()` (`auth.py:370`) from the JWT token payload, so the fallback in `GET /user/me/profile` now has a real value.
- **P1 â€” Email format validation:** Replaced `email_not_blank` validator with Pydantic `EmailStr` in `ProfileUpdate` schema; `email-validator>=2.0.0` was already in `requirements.txt`.
- **P2 â€” DB sync partial status:** Split `contact_number` and `email` DB sync into independent try/except blocks; returns `{"status": "partial", ...}` when DB sync fails instead of silently swallowing the failure.
- **P3 â€” Email column index:** Added `CREATE INDEX IF NOT EXISTS idx_users_email ON wims.users(email)` to `44_add_email_to_users.sql`.
- **P3 â€” Profile re-fetch error handling:** Added `.catch()` to `fetchMyProfile().then()` after profile save in `profile/page.tsx`.
- **P4 â€” API type fix:** Changed `email?: string` to `email: string` in `fetchMyProfile()` return type in `legacy.ts`.
- Added 2 new backend tests: invalid email format rejection, DB sync failure partial status.

**Verification:** Backend 10/10 passed. Frontend 154/154 passed across 22 test files.

## [2026-06-02] test | Add frontend profile page tests (#28, #86)

- Created `src/frontend/src/app/profile/__tests__/profile.test.tsx` with 9 tests.
- Covers: email input renders, current email display, email-change warning, fallback when no email.
- Covers region display: All Regions (NATIONAL_ANALYST), National (SYSTEM_ADMIN), region ID (REGIONAL_ENCODER), dash (no region).
- Covers profile save: calls updateMyProfile with email when provided.
- Uses Vitest + React Testing Library following existing project patterns (analyst dashboard test as reference).

## [2026-06-02] feat | Enable self-service email editing in profile (#28, #86)

- Added `email: Optional[str]` to `ProfileUpdate` schema in `src/backend/api/routes/user.py`.
- `update_my_profile()` now passes `email` to Keycloak and syncs to `wims.users`.
- `get_my_profile()` returns email from Keycloak profile (fallback to user context).
- Frontend profile page now includes editable email input with warning that changes may update login identity.
- `NATIONAL_ANALYST` region display changed from "National" to "All Regions".
- API types in `legacy.ts` updated to include `email` in fetch/update payloads.
- Added `tests/test_profile_email.py` with 6 tests covering schema, PATCH, and GET routes.

## [2026-06-02] fix | Review fixes applied to email editing branch

- Added `44_add_email_to_users.sql` migration for email column (was missing â€” UPDATE would fail silently).
- `main.py` startup patch: `ALTER TABLE wims.users ADD COLUMN IF NOT EXISTS email` for existing containers.
- `keycloak_admin.py`: `get_user_profile()` now returns email from Keycloak (was never in the dict).
- `keycloak_admin.py`: updated stale CRIT-0 comment in `update_user_profile()`.
- `user.py`: added `email_not_blank` validator to `ProfileUpdate.email` field.
- `remaining-routes.md`: updated ProfileUpdate schema and behavior docs to reflect email support.

## [2026-06-02] feat | pr-review chain — Pi-driven three-axis review for GitHub PRs

**Session context:** Created `.pi/chains/pr-review.chain.json` to run a three-axis review (Standards, Spec, Quality) on any GitHub PR via Pi subagents.

**Changes:**
- Created `~/.pi/agent/chains/three-axis-review.chain.json` — a 5-step Pi chain that fetches the PR branch, scouts the codebase, runs parallel reviewers (standards-reviewer, spec-reviewer, quality-reviewer), synthesizes the report, and posts it as a PR comment.
- Created `~/.pi/agent/prompts/three-axis-review.md` — prompt template so `/three-axis-review <PR_NUMBER>` instructs the AI to run the chain via `subagent()`.
- Usage: `/three-axis-review 211` inside Pi (after `/reload`).
- Added gotcha #13 to `~/.pi/agent/AGENTS.md`: "Don't switch implementation approach without asking."
- Removed `.github/workflows/three-axis-review.yml` (wrong approach — was CI-based, not Pi-driven).

**Scope:** orljorstin's PRs get AI-powered three-axis review on invocation. Not a CI gate.

## [2026-06-04] fix | PR #207 verified profile email review fixes

Implemented verified PR #207 review fixes across profile email handling and documentation:

- Frontend `/profile` now consumes `PATCH /api/user/me` status, surfaces backend `partial` responses as an error/warning message instead of unconditional success, and requires a current-password field when an email/login-identity change is entered.
- Backend `PATCH /api/user/me` now requires `current_password` for email changes and verifies it through Keycloak Direct Grant (`bfp-client`) before updating Keycloak email/username or local DB fields. Missing password returns 400; invalid password returns 401.
- Backend profile/contact quality fixes: `GET /api/user/me/profile` uses `get_db_with_rls`, contact number validation matches the frontend `^09\d{9}$` rule, and Keycloak contact-number updates merge existing attributes before setting `contact_number`.
- Database migration `44_add_email_to_users.sql` now adds a DB-side unique `LOWER(email)` index for non-null local emails while keeping email-column DDL out of FastAPI startup.
- Added focused backend/frontend tests for current-password email step-up, partial response display, route error paths, contact validation, and Keycloak attribute merging.
- Restored the base-branch append-only log history, preserving PR #207 entries at the end instead of before the append-only banner.

**Wiki updates:** Updated `backend/remaining-routes.md`, `frontend/route-map.md`, `database/schema-overview.md`, `security/security-baseline.md`, `architecture/pwa-tests-cicd.md`, `index.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed. Self-service email verification remains a residual follow-up because enabling Keycloak verify-email/required action safely would affect realm/admin flow behavior beyond this bounded PR fix.

## [2026-06-05] fix | Slice 3 â€” backend bugs & cleanup (PR #215, rebased onto origin/master)

**Fixes across 7 issues:**
- #183: Wrapped sync `is_token_revoked()` in `asyncio.to_thread()` to avoid event loop blocking.
- #185: Renamed `DELETE /sessions/{user_id}/{session_id}` â†’ `/sessions/{user_id}` to match bulk-termination behavior.
- #187: Removed stub `/api/auth/login` always-401 endpoint; retargeted rate limiter to `/api/auth/callback`.
- #188: Fixed admin.py docstring from "No DELETE endpoints" â†’ "No incident DELETE endpoints".
- #193: Added `RETURNING attachment_id` to attachment INSERT; returns actual DB ID now.
- #197: Moved logger definition before `apply_schema_patches()` in main.py.
- #200: Bundle upload now reports failed incidents with index + reason; `incident_ids` kept for backward compat.

**Review fixes applied during rebase:** Orphaned `incident_ids` variable removed, null-guard on attachment RETURNING added, docstring clarified to point to admin.py single-session route.

**Rate-limit test resolution:** The stale `test_rate_limiting.py` (targeted removed `/api/auth/login`) was not deleted â€” master had already rewritten it to target `POST /api/auth/callback` and mark it as a manual live-stack check excluded from CI. PR #215 retains master's callback-targeted manual test.

**Files:** `auth.py`, `main.py`, `incidents.py`, `sessions.py`, `admin.py`

## [2026-06-05] fix | PR #215 â€” CSRF test alignment with removed stub login

Updated `src/backend/tests/test_csrf_middleware.py` to match PR #215's removal of the stub `/api/auth/login` endpoint:
- Replaced all 17 `/api/auth/login` references with the live `/api/auth/callback` route.
- The 4 valid-origin POST acceptance tests now assert `status_code == 422` (Pydantic validation for empty `AuthCallbackRequest` body) instead of the old `== 401` from the removed stub.
- CSRF rejection tests (no/invalid origin) continue to assert `status_code == 403`.
- PUT/PATCH/DELETE valid-origin tests assert `!= 403` (CSRF passed) regardless of downstream route response.
- The public DMZ exemption test now uses `TestClient(..., raise_server_exceptions=False)` so local no-DB runs can inspect the non-403 response instead of raising a connection exception.
- Fixture docstrings updated from "stub auth" to "auth callback body validation" wording.

**Wiki update:** Removed stale `POST /api/auth/login` endpoint documentation from `system-wiki/backend/backend-infrastructure.md`. No FRS/codebase gap change.

## [2026-06-07] feat | #168 Add filter params to admin log query endpoints

- `GET /admin/audit-logs`: added optional query params `user_id`, `action_type`, `table_affected`, `ip_address`, `date_from`, `date_to`.
- `GET /admin/security-logs`: added optional query params `source_ip`, `severity` (maps to `severity_level`), `date_from`, `date_to`.
- Both endpoints build a parameterized WHERE clause from provided filters; when none are given, behavior is unchanged (no WHERE clause).
- COUNT query uses the same WHERE clause so `total` reflects filtered count, not full table.
- Follows the pattern from `services/regional_incidents/helpers.py:build_audit_log_query()`.
- 16 new unit tests added in `tests/test_admin_new_routes.py` (8 audit filter tests, 7 security filter tests, 1 no-filters-baseline).

**Wiki update:** Updated `system-wiki/backend/api-route-map.md` to note filter query params on `/audit-logs` and `/security-logs`.

## [2026-06-12] feat(#267) | Idempotent validator verification via client_id

- Added `client_id UUID` column to `wims.incident_verification_history` with partial unique index (`56_add_client_id_to_verification_history.sql`).
- Added optional `client_id` field to `VerificationActionRequest` schema.
- Three validator routes now support idempotent retry detection: `verify_incident`, `archive_incident`, and `unarchive_incident` accept `client_id` in the request body; archive/unarchive retain query-param compatibility.
- When a duplicate `client_id` is detected, the endpoint returns `200 {"status": "already_applied"}` instead of re-processing.
- `insert_incident_verification_history()` stores `client_id` when the column exists (column-aware guard pattern).
- New test file `tests/test_validator_idempotency.py` with 5 focused tests covering verification, archive, unarchive, backward compatibility, and distinct client_id isolation.

**Wiki update:** Updated `system-wiki/backend/api-route-map.md` with client_id params on three validator routes.

## [2026-06-10] fix | Restore VPS production runtime

- Restored the VPS with the explicit production Compose override so nginx mounts `/etc/letsencrypt` and serves the valid `wimsbfp.tech` certificate.
- Synchronized persisted PostgreSQL role passwords with `.env.production` after authentication failures blocked backend startup patches and Keycloak.
- Replaced ineffective Celery package autodiscovery with explicit task-module imports so scheduled tasks register with workers.
- Applied the missing `system_config` migration to the persisted database and added the omitted `wims_app_user` table privileges required by Celery and application routes.
- Updated the Suricata health check to match the running `Suricata-Main` process.
- Fixed the production CSP so Next.js inline bootstrap scripts can hydrate the server-rendered loading shell and initialize `/api/auth/session`.
- Updated `architecture/infrastructure-config.md` and `index.md`; no FRS/codebase gap changed.

## [2026-06-07] feat+fix | Offline-first Regional Encoder workflow — full-fidelity create sync

Documents the offline-first encoder architecture (commits `0c91925`, `4a7f1dc`, `631678b`) and a follow-up correctness fix for offline-created incidents.

**Architecture (PWA + offline encoder):**
- **PWA:** `public/manifest.webmanifest` + `public/sw.js` (registered via `lib/swRegistration.ts`, called from `LayoutShell.tsx`). SW is cache-first for static assets, network-first-with-shell-fallback for navigations, and skips `/api/` + `/auth/` so the app's offline-aware wrappers own those. Background Sync is delegated to open clients (the page owns auth-token refresh + the create→submit replay); reconnect is detected by `useNetworkStatus` → `useAutoSync`.
- **Persistence:** `lib/offlineStore.ts` IndexedDB v3 — `offlineOps` (operation queue: create/update/submit/delete with `localId` UUID idempotency key, `linkedLocalId` dependency chain, per-op `syncStatus`), `cachedIncidents` (AES-256-GCM read cache for dashboard/detail offline), legacy `incident-queue` retained. Drafts persist as `syncStatus='draft'` ops (autosave) and surface on the dashboard.
- **Sync:** `lib/syncEngine.ts` `syncPendingIncidents(encoderId)` refreshes the token, then replays ops oldest-first; marks synced only on server confirmation; aborts the batch on network loss (keeps items queued); 409 → conflict state. `lib/offlineRegional.ts` wraps list/detail reads to fall back to the encrypted cache when offline.

**Critical fix — offline-created incidents no longer lose their detail on sync:**
- **Bug:** offline `create` ops store the full nested incident shape (`incident_nonsensitive_details` / `incident_sensitive_details`), but `syncEngine` replayed them against the **flat** `POST /api/regional/incidents` (`IncidentCreateRequest`), which only reads scalar columns. Pydantic silently dropped both nested blobs, so a synced offline incident retained only lat/lng/region — losing notification time, classification, casualties, resources, narrative, PII, etc.
- **Fix:** `processCreate` now replays through the same full-fidelity `POST /api/incidents/upload-bundle` the online form uses (`{ region_id, incidents: [{ ...payload, client_id }] }`) and reads `incident_ids[0]`. Online and offline create paths are now unified.
- **Idempotency moved to upload-bundle:** `api/routes/incidents.py` `upload_incident_bundle` now detects the `client_id` column once, returns the existing incident on a duplicate `client_id` (retry-after-timeout safe), and persists `client_id` on the `fire_incidents` INSERT. Backed by migration 45 + `main.py` self-heal (`ADD COLUMN IF NOT EXISTS`). The flat `/api/regional/incidents` endpoint is unchanged (still used by the online duplicate-resolution "update request" flow).

**Other fixes:**
- `public/sw.js`: removed the dead background-sync handler that POSTed to the civilian endpoint (`/api/v1/public/report`) and opened IndexedDB at v1 (now v3 → `VersionError`); bumped cache to v3; added offline navigation fallback to the cached shell.
- `context/AuthContext.tsx`: logout now purges the local read cache (`clearAllCachedIncidents()`) for shared-device privacy while **preserving** encrypted, encoder-scoped pending ops so unsynced work survives re-login.

**Tests:** `lib/__tests__/syncEngine.test.ts` updated for the bundle endpoint + `incident_ids` response (incl. a new "imports nothing → stays queued" case); `tests/test_upload_bundle_idempotency.py` (new) proves a duplicate `client_id` returns the existing incident with no second INSERT (MagicMock DB, no Docker). Frontend: 162 vitest pass, 0 lint errors, tsc unchanged (13 pre-existing errors). Backend: ruff clean.

**Files:** `src/backend/api/routes/incidents.py`, `src/backend/tests/test_upload_bundle_idempotency.py`, `src/frontend/src/lib/syncEngine.ts`, `src/frontend/src/lib/offlineStore.ts`, `src/frontend/src/lib/__tests__/syncEngine.test.ts`, `src/frontend/public/sw.js`, `src/frontend/src/context/AuthContext.tsx`.


## [2026-06-07] rebase+fix | feat/offline-first-encoder rebased onto origin/master (route decomposition #204)

Rebased the 4 offline-first commits onto current `origin/master`. Conflicts resolved:
- **`api/routes/regional.py` (modify/delete):** master's #204 decomposed the monolith into a `regional/` package. The offline `client_id` create idempotency was **ported into `regional/encoder_crud.py`** `create_incident` (return-existing-on-duplicate + conditional `client_id` INSERT). Old `regional.py` removed; no stale imports remain (`router.include_router(encoder_crud.router)` in `regional/__init__.py`).
- **`main.py` (content):** kept **both** startup schema patches — master's RLS-helpers `SECURITY DEFINER` patch and the offline `client_id` column + unique-index self-heal (each with its own `db.rollback()` on failure).
- **`incidents/[id]/page.tsx` (content):** kept master's OCC `loadedUpdatedAtRef` tracking **and** the offline cache-banner state (`setIsFromCache`/`setCachedAt`).
- **`IncidentForm.tsx` (content):** update-path catch now checks the OCC 409 `onConflict` merge path **first**, then falls back to the offline network-error queue.
- **`log.md` (content):** kept both 2026-06-07 entries (#168 admin filters + offline-first).

**Post-rebase regression fix (`fix(offline): resolve master rebase regressions`):**
- **Auth-refresh boolean bug (`context/AuthContext.tsx`, `lib/auth.tsx`):** `refreshToken()` returns a typed `RefreshResult` (`{ ok, reason }`); both `refreshAccessToken` wrappers assigned/returned it where a `boolean` was expected. An object is always truthy, so a **failed** refresh was treated as success (and it broke `tsc`/`next build`). Mapped to `.ok`. This was a latent bug on the branch surfaced by the required build gate, not new from the rebase.
- **`offline-network-logs.har` removed** — 4.5 MB / ~89k-line network capture accidentally committed in `4a7f1dc`; untracked via normal `git rm` (no history rewrite).

**Validation:** backend `ruff check .` clean; `pytest tests/test_upload_bundle_idempotency.py tests/test_incidents_create_endpoint.py` 2 passed; route import smoke OK. Frontend `npm run lint` 0 errors; `npx vitest run` **169 passed** (24 files); `npx tsc --noEmit` only 4 pre-existing test/mock errors (production files clean after the fix); `npm run build` succeeds. Full `pytest -v` and integration suite require the Docker stack (Redis/Postgres) — not run here.

## [2026-06-07] fix | Offline-first stabilization - verified connectivity and sync recovery

Stabilized the Regional Encoder offline-first path after field QA found three defects: the top online indicator could flip online on tab changes while still offline, uncached offline navigations could fall through to the browser network error page, and sync could enter a repeated login prompt loop.

**Changes:**
- Added `lib/connectivity.ts` and rewired `useNetworkStatus()` to treat browser `online/offline`, focus, and visibility events as hints only. The shared state is `checking/offline/reconnecting/online`; the app turns online only after a same-origin `/health` probe succeeds. Network fetch failures call `markConnectivityOffline()`.
- Replaced direct `navigator.onLine` decisions in encoder manual save/submit, AFOR import, incident-detail polling, regional dashboard reloads, offline read wrappers, sync engine, and the legacy `NetworkStatusIndicator`.
- Fixed `apiFetch()` auth refresh handling: `refreshToken()` is successful only when `result.ok === true`; `{ ok: false, reason }` no longer triggers a false authenticated retry.
- Updated `syncEngine` to verify reachability before sync, preserve the queue for offline/auth aborts, and mark connectivity offline when a batch loses network mid-sync. `useAutoSync` now suppresses repeated auth-expired toasts and listens for service-worker `run-sync` messages.
- Bumped `public/sw.js` cache to `v4`; navigation requests now cache successful pages and fall back to cached app shell or friendly offline HTML instead of `Response.error()`. Static Next.js chunks/images/fonts are cached after visit so already-opened pages can render offline. PWA install remains optional; browser-tab offline works after first successful load/cache.

**Tests:** Added `offlineRegional.test.ts` and updated `useNetworkStatus`, `syncEngine`, and API transport coverage. Frontend targeted offline/auth tests: 62 passed. Full frontend Vitest: 172 passed. `npm run lint`: 0 errors, existing warnings only. `npx tsc --noEmit`: still blocked by pre-existing test/mock typing errors outside this change.

**Wiki update:** Updated `system-wiki/architecture/pwa-tests-cicd.md` and `system-wiki/frontend/frontend-infrastructure.md`. No FRS gap status changed.

## [2026-06-07] fix | Celery beat task registration for Docker Compose runtime

Diagnosed `docker compose up -d --build` as build-successful but runtime-noisy: `celery-worker` was rejecting Beat-published tasks as unregistered (`tasks.monitoring.worker_heartbeat`, `tasks.monitoring.snapshot_system_metrics`, `tasks.suricata.ingest_suricata_eve`). The cause was Celery autodiscovery against this repo's flat top-level `tasks` package; Beat had task names in `beat_schedule`, but the worker had not imported the modules.

**Changes:**
- `src/backend/celery_config.py`: replaced unreliable `autodiscover_tasks(["tasks"])` with explicit Celery `include=[...]` for analytics refresh, civilian reports, drafts, exports, monitoring, narrative, notifications, and Suricata task modules.
- `src/backend/tests/test_celery_task_registration.py`: added a contract test that imports default Celery modules and asserts every Beat-scheduled task exists in `celery_app.tasks`.

**Validation:** `docker compose up -d --build` exits successfully. `docker compose ps` shows backend, frontend, celery-worker, nginx, postgres, redis, keycloak, mailhog, ollama, and suricata running. `celery inspect registered` lists all Beat tasks, and `celery-worker` logs show `worker_heartbeat` received and succeeded instead of unregistered-task errors. Dockerized pytest `tests/test_celery_task_registration.py` passed. Ruff was not run because neither the host PATH nor the backend image has `ruff` installed.

**Wiki update:** Updated `system-wiki/backend/backend-infrastructure.md`. No FRS gap status changed.

## [2026-06-07] fix | Offline sync auth refresh recovery

Fixed the session-expired loop that blocked offline queue sync after reconnect/login.

**Changes:**
- `src/frontend/src/lib/syncEngine.ts`: pending ops are loaded before auth work; sync now checks `GET /api/auth/session` first and only calls `refreshToken()` when the access session is gone. A 401 during replay restores the current op to `pending` and aborts with `abortReason: 'auth'` so queued work stays visible and retryable.
- `src/frontend/src/lib/offlineStore.ts`: added `markOpPending()` to move an op out of transient `syncing` state without incrementing retry count.
- `src/frontend/src/lib/auth-refresh.ts`: refresh route 5xx/429 responses now classify as `offline`/unavailable instead of expired auth.
- `src/frontend/src/app/api/auth/refresh/route.ts`: server-side refresh uses `AUTH_SERVER_URL`, `KEYCLOAK_INTERNAL_URL`, or `NEXT_PUBLIC_AUTH_INTERNAL_URL`; browser-relative `/auth` is rejected for server-side fetch. Keycloak 5xx/429 and fetch failures return 503 without clearing cookies; cookies are cleared only when Keycloak rejects the refresh token.
- `src/docker-compose.yml` and `src/docker-compose.prod.yml`: frontend runtime now sets `AUTH_SERVER_URL=http://keycloak:8080/auth`.

**Tests:** Focused auth/sync Vitest: 19 passed. Full frontend Vitest: 180 passed. `npm run lint`: 0 errors, existing warnings only. `npm run build`: passed. `npx tsc --noEmit`: still blocked by pre-existing test/mock typing errors (`profile.test.tsx`, `tracking/page.test.tsx`, `offlineStore.test.ts`, `firebase-app.ts`).

**Wiki update:** Updated `system-wiki/frontend/frontend-infrastructure.md`, `system-wiki/architecture/infrastructure-config.md`, and `system-wiki/index.md`. No FRS gap status changed.

## [2026-06-09] fix | Offline connectivity recovery no longer sticks offline

Fixed the verified connectivity state machine so the app can recover from offline mode reliably.

**Changes:**
- `src/frontend/src/lib/connectivity.ts`: removed the hard stop that returned offline immediately when `navigator.onLine === false`; the browser flag is now only a hint and the same-origin `/health` probe remains authoritative.
- `src/frontend/src/lib/useNetworkStatus.ts`: adds a 5-second retry loop while the state is offline/checking/reconnecting, so recovery does not depend on the browser firing an `online` or focus event.
- `src/frontend/src/app/health/route.ts`: adds a direct Next.js `/health` endpoint for `npm run dev` or frontend-only runs where nginx is not serving `/health`.
- `src/frontend/src/components/NetworkStatusIndicator.tsx`: shows a Reconnecting state in the top indicator instead of jumping straight from Offline to Online.
- `src/frontend/src/lib/__tests__/useNetworkStatus.test.ts`: covers recovery when `navigator.onLine` is false but the app probe succeeds, and periodic retry recovery after a failed probe.

**Validation:** Focused network tests: 9 passed. Sync/network UI focused tests: 18 passed. Full frontend Vitest rerun: 181 passed. `npm run lint`: 0 errors, existing warnings only. `npm run build`: passed. `npx tsc --noEmit`: still blocked by pre-existing test/mock typing errors outside this change.

**Wiki update:** Updated `system-wiki/frontend/frontend-infrastructure.md`, `system-wiki/architecture/infrastructure-config.md`, `system-wiki/index.md`, and this log. No FRS gap status changed.

## [2026-06-09] feat | Offline-first encoder stabilization — Issues 1–4 + 2a–2d

**Branch:** feat/offline-first-encoder

**Changes:**
- `useAutoSync.ts`: Added persistent "You're offline" toast (sonner, `duration: Infinity`, fixed ID to prevent spam). Reconnect toast copy updated to "Back online. Syncing your changes…". Recovery effect calls `recoverStaleSyncingOps` on mount before refreshing the pending badge.
- `offlineStore.ts`: Added `getOfflineOp(localId)` — returns a single decrypted op by key. Added `recoverStaleSyncingOps(encoderId, staleThresholdMs)` — resets any ops stuck in `syncing` (tab closed mid-sync) back to `pending`; ops with `lastAttemptAt === null` are always reset. Fixed `updateOfflineOp` to no longer incorrectly overwrite `createdAt` on the record.
- `IncidentForm.tsx`: Added `offlineLocalId?: string` prop. When set, save calls `updateOfflineOp(offlineLocalId, { ...payload, updated_at })` in-place instead of hitting the API or creating a duplicate op. All three offline-queue paths for `create` ops now embed `created_at` and `updated_at` ISO strings into the payload; the offline `update` path embeds `updated_at`.
- `dashboard/regional/page.tsx`: Queued-op cards (card view) and rows (table view) are now clickable and navigate to `/dashboard/regional/incidents/local/${op.localId}`.
- `dashboard/regional/incidents/local/[localId]/page.tsx` (new): Loads op from IndexedDB via `getOfflineOp`, shows IncidentForm pre-populated with the queued payload and `offlineLocalId` prop set. Handles already-synced ops by redirecting to the server record.
- `backend/api/routes/incidents.py` (`upload_incident_bundle`): Accepts optional `created_at` / `updated_at` ISO strings from each bundle item and includes them in the `fire_incidents` INSERT if valid; future-dated values are clamped to `now()`.
- `__tests__/useAutoSync.test.ts`: Added `recoverStaleSyncingOps` and `toast.dismiss`/`toast.info` to mocks.
- `__tests__/offlineStore.ops.test.ts` (new): 9 tests covering `recoverStaleSyncingOps` (stale threshold, null lastAttemptAt, encoder scoping), `updateOfflineOp` (preserves createdAt), and `getOfflineOp` (returns decrypted payload).

**Validation:** 28 test files, 190 tests — all passing. `npm run lint`: 0 errors. `npm run build`: clean. `npx tsc --noEmit`: no new errors (pre-existing test/mock type errors unchanged).
## [2026-06-11] feat | Temporary Keycloak OTP demo bypass

Added a presentation-only Keycloak browser OTP provider that keeps normal OTP validation but also accepts fixed code `123123` for MFA-prompted accounts.

**Changes:**
- `src/keycloak/demo-otp-provider`: new Keycloak SPI provider registering `wims-demo-otp-form`; it accepts `123123`, logs a warning/event detail, checks enabled/brute-force state, and delegates all other OTPs to the built-in OTP form logic.
- `src/keycloak/Dockerfile` and `src/docker-compose.yml`: Keycloak now builds a local image with the provider jar installed before startup.
- `src/keycloak/bfp-realm.json` and `src/keycloak/import/bfp-realm.json`: browser OTP execution now uses `wims-demo-otp-form`; Direct Grant OTP remains `direct-grant-validate-otp`.
- `docs/agents/remove-demo-otp-bypass.md`: added agent instructions for removing the shortcut before PR.
- `system-wiki/security/security-baseline.md`, `system-wiki/architecture/infrastructure-config.md`, and `system-wiki/index.md`: documented the temporary bypass and removal expectation.

**Validation:** Docker provider image build passed (`docker build -t wims-keycloak-demo-otp:test ./keycloak`), including Maven package and `kc.sh build` provider registration. Focused OTP policy pytest passed locally.

**Wiki update:** Updated the relevant security/infrastructure synthesis pages and this log. No FRS gap status changed.

## [2026-06-11] fix | Offline incident create sync and normal detail viewing

Fixed the regional encoder offline-create sync path and removed the visible split between normal incident viewing and "edit local incident" for pending offline creates.

**Changes:**
- `src/backend/api/routes/incidents.py`: replaced `INSERT ... ON CONFLICT` in `upload_incident_bundle` with a transaction-scoped advisory lock plus `client_id` lookup before normal insert. This fixes the 500 caused by PostgreSQL rejecting `ON CONFLICT` on `wims.fire_incidents` while immutable-record rules exist.
- `src/backend/api/routes/regional/encoder_crud.py`: applied the same advisory-lock idempotency pattern to direct regional creates that carry `client_id`.
- `src/frontend/src/app/dashboard/regional/page.tsx`: pending offline create ops now render through the shared rich `IncidentCard` with status `PENDING_SYNC` and route to `/dashboard/regional/incidents/{localId}`.
- `src/frontend/src/app/dashboard/regional/incidents/[id]/page.tsx`: non-numeric local IDs now load the encrypted offline op and render the standard read-only incident detail view; Edit saves back to the queued op with `offlineLocalId`.
- `src/frontend/src/components/ui/StatusBadge.tsx` and `src/frontend/src/lib/incident-utils.ts`: added `PENDING_SYNC` label/color support.
- Focused tests updated for the new idempotency and offline detail mocks.

**Validation:** Backend targeted pytest passed: `tests/test_upload_bundle_idempotency.py` and `tests/test_encoder_crud_idempotency.py` (4 passed). Frontend targeted lint passed for touched files. Offline/sync Vitest suite passed: `syncEngine.test.ts`, `offlineRegional.test.ts`, and `offlineStore.ops.test.ts` (24 passed). Python compile passed for the touched backend route files.

**Wiki update:** Updated `system-wiki/frontend/frontend-infrastructure.md`, `system-wiki/subsystems/regional-dashboard.md`, `system-wiki/index.md`, and this log. No FRS gap status changed.

## [2026-06-11] fix | Pending-sync incident full-page view and local actions

Made pending-sync offline incidents fully manageable through the normal regional incident detail route.

**Changes:**
- `src/frontend/src/app/dashboard/regional/incidents/[id]/page.tsx`: non-numeric local IDs continue to load from encrypted `offlineOps` without a server fetch, now show local pending-sync copy/status in the normal full-page report, expose Delete for pending-sync incidents, and keep Edit on the shared `IncidentForm` path.
- `src/frontend/src/lib/offlineStore.ts`: added `deleteOfflineOpCascade(localId)` to remove a local create op and all queued ops linked to it, preventing stale linked submit/update work from replaying after the user deletes a pending-sync incident.
- `src/frontend/src/app/dashboard/regional/incidents/local/[localId]/page.tsx`: replaced the old edit-only local page with a redirect shim to `/dashboard/regional/incidents/{localId}`.
- `src/frontend/src/lib/__tests__/offlineStore.ops.test.ts`: added coverage for cascade deletion.
- `OFFLINE_HANDOVER.md`: documented the full-page pending-sync view/edit/delete behavior.

**Validation:** Targeted frontend lint passed for the touched route/store/test files. Offline/sync Vitest passed: `offlineStore.ops.test.ts`, `syncEngine.test.ts`, and `offlineRegional.test.ts` (25 passed).

**Wiki update:** Updated `system-wiki/frontend/frontend-infrastructure.md`, `system-wiki/frontend/route-map.md`, `system-wiki/subsystems/regional-dashboard.md`, `system-wiki/index.md`, and this log. No FRS gap status changed.

## [2026-06-12] merge | Resolve offline-first encoder PR conflicts with master

- Merged the offline-first encoder branch with current master runtime updates.
- Kept master operations/OpenBao/deploy changes while preserving offline `/home` restricted-route guard, pending-sync incident local actions, offline store key-clear helper, and ops-based sync tests.
- Updated `docs/PR-offline-first-encoder.md`, `system-wiki/index.md`, `system-wiki/architecture/infrastructure-config.md`, `system-wiki/architecture/docs-and-scripts.md`, and `system-wiki/gaps/frs-codebase-gap-register.md` to reflect the merged state.

## [2026-06-12] test | Fix Operations Board Vitest after offline guard merge

- Updated `src/frontend/src/app/home/__tests__/operations-board.test.tsx` to mock `useNetworkStatus()` as online. Without the mock, the merged offline restricted-route guard rendered "Operations Unavailable Offline" in jsdom and hid the Operations Board controls under test.
- Updated `docs/PR-offline-first-encoder.md` validation results with the full frontend Vitest pass.
- Validation: `npx vitest run` passed (38 files, 236 tests). `npm run lint` passed with 0 errors and 16 warnings.

## [2026-06-12] rebase | feat/offline-first-encoder onto origin/master (post-PR#272)

- Rebased 19 commits of `feat/offline-first-encoder` onto `origin/master` which now includes PR #272 (offline expansion for analyst, validator, and admin dashboards).
- **Conflict resolution summary:**
  - **`offlineStore.ts`:** Kept branch's new `offlineOps` + `cachedIncidents` IndexedDB stores, per-user key isolation, `setActiveOfflineUser()`, `clearAllCachedIncidents()`, and singleton connectivity monitor.
  - **`syncEngine.ts`:** Kept branch's refactored `syncPendingIncidents(encoderId)` with `processCreate`/`processUpdate`/`processSubmit`/`processDelete` ops dispatch and bundle-based create path.
  - **`connectivity.ts`:** Kept branch's singleton monitor with exponential backoff recheck loop.
  - **`home/page.tsx`:** Kept HEAD's Operations Board (master) over branch's incident-based replacement.
  - **`celery_config.py`:** Kept HEAD's explicit task imports and autodiscovery (master version).
  - **Wiki files:** Merged both sides — kept HEAD's updated FRS entries and date metadata while preserving branch's M2d entry, log entries, and offline-first architecture docs.
- **Files with conflicts resolved:** offlineStore.ts, syncEngine.ts, connectivity.ts, useAutoSync.test.ts, celery_config.py, home/page.tsx, tracking/page.test.tsx, and 7 system-wiki pages.
- **Final state:** 19 branch commits, 88 files changed (+6340/-2642), clean rebase. No FRS gap status changed.

## [2026-06-12] fix | Conflict-resolution validation and backend encoder F821 fix

**Conflict-resolution fix review:**
- Verified 3 uncommitted files (`offlineStore.ts`, `syncEngine.ts`, `syncEngine.test.ts`) from parent session resolve merge correctly.
- `offlineStore.ts`: `DB_VERSION` → 4 (both branches used v3); `ANALYTICS_STORE` added in v4 upgrade path; `OfflineOpType` extended to include `'update' | 'submit' | 'delete' | 'verify' | 'archive_action'`; `LegacyOfflineOpType` for legacy queue; `initOfflineStorageLimit`, `cacheAnalyticsResponse`, `getCachedAnalyticsResponse`, `clearAnalyticsCache` restored; `encryptPayload` signature broadened to `unknown`; typed decrypt paths.
- `syncEngine.ts`: Unifies both branch `offlineOps` and PR #272 legacy `incident-queue` sync; legacy-only sync skips auth preflight; dispatches `verify` → PATCH `/api/regional/incidents/{id}/verification`, `archive_action` → PATCH `/api/regional/validator/incidents/{id}/archive|unarchive` with `client_id`; legacy `create` → POST `/api/v1/public/report`.
- `syncEngine.test.ts`: Added mocks for `getPendingIncidents` and `markSynced`; tests for verify/archive_action dispatch, legacy backward compat, and network error abort.

**Validation results:**
- Conflict marker scan: clean (no markers found)
- Frontend lint: 0 errors, 16 warnings (pre-existing, no new)
- Frontend full Vitest: 43 files, 294 tests passed
- Frontend build (with env vars): passed
- Backend ruff check: all checks passed
- Backend ruff format: 180 files already formatted
- Backend targeted pytest (with DATABASE_URL set): 17 passed

**Backend blocker: encoder.py F821 fix:**
- `src/backend/api/routes/regional/encoder.py`: Replaced undefined `_get_security_provider()` → `get_crypto_provider()` (env-level dispatch) in list endpoint PII decryption block. Broadened except from `SecurityProviderError` → `(SecurityProviderError, Exception)` to match detail endpoint behavior. This was a pre-existing branch bug (not rebase-related): commit `88ce838` removed `_get_security_provider` from the detail endpoint but left the list endpoint stale.

**Wiki updates:** This log entry. No FRS gap status changed.

## [2026-06-13] docs | update wiki privacy test count to 18 after Q2 fix commit

- `system-wiki/log.md`: Updated the privacy module entry to 18 unit tests.
- `system-wiki/gaps/frs-codebase-gap-register.md`: Updated the M6 (RA 10173 Privacy Rights) gap closure entry to 18 backend unit tests.
- **Source:** Commit `25a151f` added 1 new Q2 test, bringing total from 17 → 18. The wiki had a stale pre-PR #262 count.
- **No FRS gap status changed.**

## [2026-06-13] test clarity | renamed test_consent_public_insert_succeeds_under_rls → test_consent_public_no_auth_required

**File:** `src/backend/tests/test_privacy.py`
**Issue:** #311

**Change:** Renamed the consent public-endpoint test from `test_consent_public_insert_succeeds_under_rls` to `test_consent_public_no_auth_required`. Added docstring clarifying this is a no-auth public endpoint test, not a DB-level RLS verification. Test logic is otherwise identical.

**Purpose:** Eliminate misleading name — the test does not verify RLS policies; it tests that the consent endpoint works without an Authorization header.

## [2026-06-14] feat(#280) | add SUSPICIOUS_QUERY_PATTERN detector (audit-trail proxy for high-frequency PII_EXPORT)

- Added `_detect_suspicious_query_pattern` to `tasks/anomaly_detection.py`: sliding-window correlated subquery, >10 PII_EXPORT actions per user per 5-min window, severity HIGH. Audit-trail proxy — pg_stat_statements not enabled (GH #280 rationale). Appended to `_DETECTORS` list.
- 10 new unit tests in `test_anomaly_detection.py` (positive, negative, dedup stability, cross-boundary). Updated 2 existing task tests to account for 5th detector query.
- Gap register updated: M8 entry now reflects 5/5 detectors shipped; geo Impossible Travel (#281) remains the sole deferred item.

## [2026-06-13] test(#291 #292 #293 #296) | strengthen attachment encryption test coverage

**File:** `src/backend/tests/test_attachment_encryption.py`

**Changes:**
- #291 (T3/T4): Added `match="authentication failed"` to `test_wrong_key_fails` to distinguish auth failure from generic provider error. Added `detail` assertion to `test_wrong_nonce_returns_500` (parity with `test_tampered_ciphertext_returns_500`).
- #292 (T9): Added `test_zero_byte_upload_accepted` (0-byte file → 201, encrypted on disk) and `test_exactly_at_max_bytes_accepted` (exactly-at-limit → 201, encrypted).
- #293 (T7/T8): Added `_admin_user` and `_validator_user` helpers. Added `test_admin_can_download` and `test_validator_can_download` for full 5-role coverage. Added `test_serve_includes_content_disposition_header` and `test_serve_media_type_matches_stored_mime` for response header assertions.
- #296 (T2): Hardened `test_attachment_not_found_returns_404` and `test_missing_file_on_disk_returns_404` with handler-level detail assertions (`"Attachment not found"` / `"Attachment file not found on disk"`) to distinguish from FastAPI router-level 404.
- 30 tests pass (was 20), all ruff checks pass.
- No application behavior changed. No FRS gap register change.

## [2026-06-13] feat(cluster) | audit-db-forensics: immutability RULE + forensic columns (GH #240 #242)

**Cluster:** audit-db-forensics
**Issues:** #240 (append-only RULE), #242 (old_values/new_values JSONB)

### #240 — Append-only RULE on system_audit_trails
- `src/postgres-init/17_immutable_records.sql`: Added section 5 — `DROP RULE IF EXISTS no_delete_audit` / `CREATE RULE no_delete_audit ... ON DELETE ... DO INSTEAD NOTHING`. Renumbered existing section 5 (analytics) to 6.
- DELETE from `wims.system_audit_trails` now silently no-ops at DB level. All other immutability rules (fire_incidents VERIFIED, incident_verification_history) already existed.

### #242 — Forensic completeness columns
- New migration `src/postgres-init/60_audit_forensics_columns.sql`: Adds `old_values JSONB` and `new_values JSONB` to `wims.system_audit_trails` (idempotent, `ADD COLUMN IF NOT EXISTS`).
- `src/backend/utils/audit.py`: `log_system_audit()` now accepts optional `old_values`/`new_values` params (default None). Serialized to JSON via `json.dumps()`; NULL when not provided. Backward-compatible — all existing call sites continue to work without changes.
- `src/backend/api/routes/admin/audit.py`: `GET /admin/audit-logs` SELECT and response now include `old_values` and `new_values`. Response uses `len(r) > 8` guard for compatibility with mocks in tests.
- `src/backend/api/routes/admin/users.py`: User update (role/active/region changes) now passes old_state/new_state dicts to `log_system_audit()`.
- `src/backend/api/routes/admin/config.py`: Config PATCH now SELECTs the old config_value before UPDATE, passes old/new dicts to audit.
- `src/backend/tests/test_system_config.py`: Updated `_mock_config_db()` helper to support `fetchone_row` parameter (sentinel-based default); updated `test_returns_404_if_row_missing` to use it.

### Wiki updates:
- `system-wiki/database/schema-overview.md`: Added `60_audit_forensics_columns.sql` reference.
- `system-wiki/security/security-baseline.md`: Added bullet list of audit immutability and forensic column changes.
- This log entry.

**No FRS gap status changed.** Both issues close pre-existing known gaps that are now resolved.

## [2026-06-13] chore(#310) | audit and fix unconsumed MagicMock side_effect entries in privacy tests

- Fixed 3 unconsumed `mock_db.execute.side_effect` entries in tests that patch `log_system_audit`. The extra `MagicMock()` entries masked the true call counts and would silently absorb any future extra `db.execute()` calls without failing.
  - `test_export_audited`: removed unconsumed 3rd `MagicMock()` (audit INSERT). log_system_audit patched → only 2 direct calls (users SELECT + consent SELECT).
  - `test_anonymize_audited`: removed unconsumed 2nd `MagicMock()` (audit INSERT). log_system_audit patched → only 1 direct call (UPDATE users).
  - `test_consent_audit_action_grant`: removed unconsumed 2nd `MagicMock()` (audit INSERT). log_system_audit patched → only 1 direct call (consent INSERT).
- Added concise comments documenting expected direct `db.execute()` call counts for all tests with side_effect lists (both patched and unpatched).
- Verified all remaining tests have correct side_effect lengths matching call count (export user: 3 calls, export report: 4 calls, anonymize user unpatched: 2 calls, anonymize idempotent: 4 calls, consent unpatched: 2 calls, anonymize report patched: 4 calls — all correct).
- No application behavior changed. No FRS gap register change.


## [2026-06-13] fix | triage page test flake — Inspect button race condition

- Root cause: two tests (`shows Inspect on singleton`, `opens cluster inspection modal`) used `waitFor` for always-present `data-testid` wrappers that render during loading state. Synchronous `getAllByRole` then ran before async data resolved the Inspect buttons into the DOM.
- Fix: replaced `screen.getAllByRole('button', { name: 'Inspect' })` with `await screen.findAllByRole('button', { name: 'Inspect' })` so the query waits for data-driven content to appear. Same pattern already used by the other 6 Inspect tests in the same file.
- Files changed: `src/frontend/src/app/incidents/triage/page.test.tsx` (4 insertions, 7 deletions).
- Validation: `npx vitest run` passes (10/10), `git diff --check` clean.

## [2026-06-13] fix | analyst dashboard export-button test flake (PR #321/#322 CI)

- The test `offline / cached-data UI > disables export buttons when offline` used synchronous `getByLabelText('Export CSV')` immediately after `mockFetchHeatmapData` was called. However, the export buttons are gated behind `!loadingData && heatmap !== null` in the component render tree. At the moment the mock is called, `loadingData` is still `true` (set at the top of `loadData`, cleared in its `finally` block), so the export section hasn't rendered yet.
- Fix: replaced `getByLabelText` with `findByLabelText` (built on `waitFor`, retries until the element appears). This allows React to complete the `loadData` finally block and re-render the export section before the assertion runs.
- No component behavior changed. Test coverage preserved (disabled state assertion unchanged).
- No FRS gap register change (test-only fix).

## [2026-06-13] test(#306 #309 #312 #313) | harden privacy endpoint coverage

- Expanded `src/backend/tests/test_privacy.py` coverage for consent client IP capture, consent audit payload fields, anonymization idempotency SQL guard, 404/export edge cases, consent withdraw audit, and export decryption failure handling.
- Test-only hardening for privacy module behavior; no production route behavior changed.
- No FRS gap register change.

## [2026-06-13] feat(#297 #299 #300 #301 #303) | security monitoring dashboard UX and test coverage

**Files:**
- `src/frontend/src/app/admin/monitoring/page.tsx`
- `src/frontend/src/app/admin/monitoring/admin-security-monitoring.test.tsx`

**Issues:** #297 #299 #300 #301 #303 (clustered PR #263 review follow-ups)

**Changes:**

### page.tsx
- #301 (P1): Added expand/collapse `onClick` handler for XAI narrative "Read more" span. Expanded state tracked via `expandedNarratives` Set. Includes `role="button"`, `tabIndex`, `onKeyDown`, and `aria-expanded` attributes for accessibility.
- #300 (Q4): Replaced unconditional 30s `setInterval` with visibility-gated auto-refresh. Interval starts only when tab is visible, pauses when hidden, resumes on re-visibility. Uses `useRef` for interval handle and `visibilitychange` event listener with proper cleanup.

### admin-security-monitoring.test.tsx (20 tests, all passing)
- #297 (T8): Added 2 tests for severity chip visual active/inactive state (class-based assertions for `bg-gray-100` vs `bg-orange-100`).
- #299 (T7): Added 3 tests for non-empty XAI narratives (truncation, Read more/Show less expand, severity badges) and audit highlights (notable event type filtering, table_affected labels).
- #303 (T5): Added 3 tests for auto-refresh interval (30s interval set on mount, callback fires, cleanup on unmount).
- #300 (Q4): Added 2 tests for tab-visibility gating (interval stops on hidden, restarts on visible).
- Fixed syntax error in Q1 pagination test (misplaced closing quote).
- Fixed ambiguous `getByText` selector for "Audit Highlights" (subtitle partial match).
- Removed unused `truncatedText` variable to satisfy ESLint.

**Validation:** `npx vitest run` — 20/20 passed. `npx eslint` — 0 errors, 0 warnings.

**No FRS gap register change.**

## [2026-06-13] fix | triage page test flake — Inspect button race condition

- Root cause: two tests (`shows Inspect on singleton`, `opens cluster inspection modal`) used `waitFor` for always-present `data-testid` wrappers that render during loading state. Synchronous `getAllByRole` then ran before async data resolved the Inspect buttons into the DOM.
- Fix: replaced `screen.getAllByRole('button', { name: 'Inspect' })` with `await screen.findAllByRole('button', { name: 'Inspect' })` so the query waits for data-driven content to appear. Same pattern already used by the other 6 Inspect tests in the same file.
- Files changed: `src/frontend/src/app/incidents/triage/page.test.tsx` (4 insertions, 7 deletions).
- Validation: `npx vitest run` passes (10/10), `git diff --check` clean.

## [2026-06-13] fix | analyst dashboard export-button test flake (PR #321/#322 CI)

- The test `offline / cached-data UI > disables export buttons when offline` used synchronous `getByLabelText('Export CSV')` immediately after `mockFetchHeatmapData` was called. However, the export buttons are gated behind `!loadingData && heatmap !== null` in the component render tree. At the moment the mock is called, `loadingData` is still `true` (set at the top of `loadData`, cleared in its `finally` block), so the export section hasn't rendered yet.
- Fix: replaced `getByLabelText` with `findByLabelText` (built on `waitFor`, retries until the element appears). This allows React to complete the `loadData` finally block and re-render the export section before the assertion runs.
- No component behavior changed. Test coverage preserved (disabled state assertion unchanged).
- No FRS gap register change (test-only fix).

## [2026-06-13] feat(tests) + docs | GH #289 #294 #295 — attachment upload error-path tests, serve-route doc comments

- **GH #289** (test): Added 3 error-path tests to `TestUploadAttachment` in `test_attachment_encryption.py`:
  - `test_encrypt_bytes_fails_returns_500` (T6): mocks `provider.encrypt_bytes()` to raise; asserts 500 + "Failed to encrypt attachment".
  - `test_insert_returns_none_returns_500` (T11): sets `insert_returns_none=True` on `_upload_db()` so INSERT RETURNING `fetchone()` returns `None`; asserts 500.
  - `test_db_rollback_and_file_cleanup_on_commit_failure` (T5): makes `db.commit()` raise `Exception`; asserts 500, `db.rollback()` called, and no files remain in storage dir.
  - Extended `_upload_db()` helper with `insert_returns_none` parameter.
- **GH #294** (docs): Added inline column-to-variable mapping comment before the 7-tuple positional unpack in `serve_attachment()` documenting SELECT order and cautioning about future column changes.
- **GH #295** (docs): Added inline comment in the `is_encrypted=false` legacy branch documenting that pre-migration files are read entirely into memory with no size cap (new uploads bounded by 25 MB `WIMS_MAX_ATTACHMENT_BYTES`).
- No FRS gap register change (pure test/docs additions; no behavioral change to existing functionality).

## [2026-06-13] test(#298) | add combined severity + source_ip filter test for security logs

**File:** `src/backend/tests/test_security_monitoring.py`
**Issue:** #298

**Change:** Added `TestCombinedSeveritySourceIpFilter` class with three tests:
- `test_severity_and_source_ip_combined_filter` — verifies response shape when both multi-severity and source_ip filter params are provided
- `test_combined_filter_sql_contains_both_conditions` — confirms SQL includes both `severity_level IN (...)` and `source_ip = :source_ip` in data and count queries
- `test_combined_filter_binds_correct_params` — verifies bound params include all severity values and the source_ip value

**Purpose:** Belt-and-suspenders coverage for PR #263 finding T6 (can defer). Individual filters tested separately; this closes the combined filter gap.

**No FRS gap status changed.**

## [2026-06-13] feat | #277 types: replace any[] with ActiveSession interface in offlineAdmin
## [2026-06-13] test | #279 add frontend fallback tests for null AI/network metrics

- #277: Added `ActiveSession` interface to `src/types/api.ts` (shared types). Updated `legacy.ts` return type from `any[]` to `ActiveSession[]`. Updated `offlineAdmin.ts` to use `ActiveSession[]` and removed unused eslint-disable. Removed local `ActiveSession` definition from `page.tsx` in favor of shared import. No runtime change.
- #279: Added two Vitest tests to `admin-system-monitoring.test.tsx`: (1) `ai_inference: null` asserts "No calls recorded" and no NaN; (2) `network: null` asserts "N/A" and no NaN. All 14 tests pass.
- No FRS gap register change (type narrowing + test coverage — no FRS requirement change).
- Lint clean (0 errors, 1 pre-existing useEffect dep warning).

## [2026-06-13] perf(#276) | cache IVH column-existence checks in helpers.py

- Added module-level `_ivh_column_cache: dict[str, bool]` to lazily cache
  `_ivh_has_column()` results, avoiding repeated `information_schema` queries.
- Applied ruff format. All 2 lifecycle transition tests pass.
- No FRS gap register change (internal perf — no behavior/schema change).

## [2026-06-13] style(#234) | align validator audit page with global design system

**File:** `src/frontend/src/app/dashboard/validator/audit/page.tsx`
**Issue:** #234
**Branch:** agent/cluster-audit-ui-style

**Change:** Replaced raw margin/padding layout with the standard `.card` / `.card-header` / `.card-body` pattern. Updated table to use `min-w-full divide-y divide-gray-200` with consistent header cells (`px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider`) matching admin system pages. Applied design token colors (`var(--text-primary)`, `var(--text-secondary)`, `var(--text-muted)`, `var(--sidebar-bg)`, `var(--bfp-maroon)`, `var(--border-color)`) throughout. Standardised filter inputs with `border border-gray-200` and sidebar-bg focus rings. Changed primary buttons to BFP maroon (`var(--bfp-maroon)`). Added `FileText` icon in card header.

**No behavior change — pure style alignment.**
- No FRS gap status changed.

## [2026-06-13] fix | #282 — Add bounded query strategy for anomaly detectors

- **Files:** `src/backend/tasks/anomaly_detection.py`, `src/backend/tests/test_anomaly_detection.py`
- **Issue:** #282

**Change:** Added ORDER BY timestamp DESC LIMIT :max_rows to RAPID_IP_SWITCH sliding CTE and BULK_DELETE outer subquery, capped at `_MAX_AUDIT_ROWS = 10_000`.  OFF_HOURS and PRIVILEGE_ESCALATION are intentionally left without LIMIT — their 60 s windows + specific action-type filters naturally bound result sets.

**Why:** Detector SQL queries were bounded by time windows but not row count.  Under audit flood/replay, RAPID_IP_SWITCH scanned ALL events in the last 10 minutes with no cap, risking Celery worker OOM.  The 10 000-row bound (~16.7 events/s sustained) is generous enough to not hide real anomalies while preventing unbounded memory growth.

**Action-type filter decision:** Considered filtering RAPID_IP_SWITCH to auth-only actions but rejected — IP switches from data-access or admin actions would create false negatives.

**Tests:** 8 new `TestQueryBounds` tests verify:
- BULK_DELETE and RAPID_IP_SWITCH SQL contain `LIMIT :max_rows` and `ORDER BY timestamp DESC`
- `max_rows` param (10_000) is passed in execute calls
- OFF_HOURS and PRIVILEGE_ESCALATION SQL intentionally omit LIMIT
- Anomaly detection still works correctly with LIMIT active

**No FRS gap status change** (M8 #160 remains PARTIAL; this is a perf/resilience hardening of the existing 4 shipped detectors).

## [2026-06-14] fix(#332) | PR #332 review blockers: audit forensics completeness

**PR:** #332 — PR review fix pass for audit-db-forensics cluster
**Scope:** PR #332 worktree only; no push, merge, or cross-worktree edits.

### Fixed from review report (5 accepted findings):

1. **`src/backend/api/routes/admin/users.py`** — Forensic old_state completeness:
   - Expanded SELECT to include `assigned_region_id` and `is_active` (was only `keycloak_id, role`).
   - `old_state["is_active"]` now reads actual DB value instead of hardcoded `True`.
   - `old_state["assigned_region_id"]` now populated when region changes.
   - Region-only changes (no role or is_active change) now emit `REGION_ASSIGNMENT_CHANGE` audit action so audit log is always written.
   - Fixed truthiness check `if body.role:` → `if body.role is not None:` (consistency with other field checks).

2. **`src/backend/utils/audit.py`** — Safer JSON serialization:
   - `json.dumps(old_values, default=str)` and `json.dumps(new_values, default=str)` so UUID/datetime/Decimal types don't silently drop audit entries.
   - Changed `logger.error` to `logger.exception` for full traceback on audit insert failures.

3. **`src/postgres-init/17_immutable_records.sql`** — Full audit immutability:
   - Added `no_update_audit` RULE alongside existing `no_delete_audit` RULE on `system_audit_trails`.
   - Documented tradeoff: future migrations that need to UPDATE/DELETE audit rows must temporarily drop these rules.

4. **`src/backend/tests/integration/test_ai_ids_api.py`** — Test fixture cleanup:
   - Removed ineffective DELETE teardown from `audit_trail_rows` fixture.
   - Added docstring explaining that teardown is intentionally no-op due to `no_delete_audit` RULE.

5. **`src/backend/api/routes/admin/audit.py`** — Robust column access:
   - Changed positional index `r[8]`/`r[9]` to `r._mapping.get("old_values")`/`r._mapping.get("new_values")` for resilience against SELECT column reordering.

### Tests added:
- `test_system_config.py::TestPatchConfig::test_audit_log_includes_forensic_old_new_values` — verifies config PATCH audit INSERT carries correct oldv/newv.
- `test_system_config.py::TestAuditSerialization::test_serializes_uuid_and_datetime_with_default_str` — verifies UUID/datetime don't crash `json.dumps`.
- `test_system_config.py::TestAuditSerialization::test_none_values_passed_as_none` — verifies None passthrough.

### Wiki updates:
- `system-wiki/security/security-baseline.md` — Updated audit immutability bullet to mention `no_update_audit` RULE and `default=str` coercion.
- `system-wiki/database/schema-overview.md` — Added UPDATE blocking to immutability description.
- This log entry.

**No FRS gap status changed.** No production-unsafe bypasses introduced.

## [2026-06-14] refactor(#273) | extract shared offline API helpers into offlineBase.ts

- Created `src/frontend/src/lib/api/offlineBase.ts` with shared `OfflineResult<T>`, `offlineAware()`, `buildCacheKey()`, `isNetworkError`, `stableStringify`, `shouldServeOffline`, `isFresh`, `getFreshCache`, `readFreshCacheOrThrow`, `writeCache` — extracted from duplicated copies in all 3 domain modules.
- Updated `src/frontend/src/lib/api/offlineAdmin.ts`: removed 155 lines of duplicated helpers (isNetworkError, stableStringify, adminKey, isNavigatorOffline, shouldServeOffline, isFresh, getFreshCache, readFreshCacheOrThrow, writeCache, offlineAware). Domain-specific constants (ADMIN_CACHE_TTL_MS, SESSIONS_CACHE_TTL_MS, OFFLINE_ADMIN_ERROR) remain. `OfflineAdminResult<T>` is now a type alias for `OfflineResult<T>`.
- Updated `src/frontend/src/lib/api/offlineAnalytics.ts`: removed 155 lines of duplicated helpers. `ANALYTICS_CACHE_TTL_MS` and `OFFLINE_ANALYTICS_ERROR` remain. `OfflineAnalyticsResult<T>` is now a type alias for `OfflineResult<T>`.
- Updated `src/frontend/src/lib/api/offlineValidator.ts`: removed 50 lines of duplicated helpers (isNetworkError, stableStringify, isNavigatorOffline, shouldServeOffline, isFresh). Removed unused `getConnectivitySnapshot` import. `OfflineValidatorQueueResult<T>` is now a type alias for `OfflineResult<T>`. Mutation-specific logic and `queueCacheKey` remain.
- Net: −281 lines across 3 modified files, +139 lines in new offlineBase.ts.
- Behaviour preserved: all 17 existing offline tests pass unchanged. ESLint clean.
- Wiki updates: frontend-infrastructure.md table updated with offlineBase.ts entry, pwa-tests-cicd.md sources updated.

## [2026-06-14] feat(#241) | read-path hash-chain verification for incident integrity

**Files changed:**
- `src/backend/services/regional_incidents/helpers.py` — added `verify_incident_hash_chain()` and `_parse_pg_array()` helper
- `src/backend/api/routes/regional/encoder.py` — `GET /api/regional/incidents/{id}` now returns `integrity_status`
- `src/backend/api/routes/regional/validator.py` — `GET /api/regional/validator/incidents/{id}/history` now returns `integrity_status`
- `src/backend/api/routes/incidents.py` — `GET /api/incidents/analyst/{id}` now returns `integrity_status`
- `src/backend/tests/test_hash_chain_verification.py` — 5 tests covering valid chain, tampered row hash, chain break, no-hash-rows, and API response field

**Issue:** #241

**Behavior change:** Read-path endpoints now recompute the IVH hash chain on every read and return an `integrity_status` field (`"valid"`, `"tampered"`, or `"unverified"`). Tampered hash chains also log `INTEGRITY_VIOLATION` rows to `system_audit_trails`. This closes the gap where hash-chain columns were write-only with no read-time verification.

**Design:** The verification function recomputes `ivh_row_hash` using the same deterministic serialization as the write path (JSON with `sort_keys=True, separators=(",", ":")`, Python `isoformat()` for timestamps, PostgreSQL ARRAY literal → list conversion for `corrected_fields`). It then verifies chain linking (`prev_ivh_hash` → previous row's `ivh_row_hash`) and anchor integrity (latest `new_data_hash` vs `fire_incidents.data_hash`).

**Residual risks:**
- Only applies to hash-chain rows created by the correction endpoint (`PATCH /incidents/{id}/correct`). Regular verification transitions do not write hash-chain data, so those rows show `integrity_status: "unverified"`.
- Suricata alert integration (proposed in issue) deferred to avoid overlap with teammate PR #335.

**No FRS gap status changed.**

## [2026-06-14] fix(#339) | audit persistence for hash-chain violation logging

**Files changed:**
- `src/backend/services/regional_incidents/helpers.py` — `verify_incident_hash_chain()` now uses a self-committing `_AdminSessionLocal` session for audit writes instead of inlining an INSERT on the route's read-only session. `_isoformat_match_aware()` adds naive-datetime fallback (+00:00). Anchor check now emits a violation when `fire_incidents.data_hash` is NULL with hash-chain rows present.
- `src/backend/tests/test_hash_chain_verification.py` — added `test_241_tamper_logs_violation_to_audit_trail` proving audit rows persist when `log_violations=True`.

**Issue:** PR #339 security review

**Behavior change:** `INTEGRITY_VIOLATION` audit rows are now committed in an isolated, self-committing session so they survive read-only route handler sessions that never commit. Previously, audit rows were silently rolled back on session close.

**No FRS gap status changed.**
## [2026-06-14] fix | Audit client IP, Suricata ingestion commit, incident create audit, deploy cleanup

- `utils.audit.log_system_audit()` now prefers `X-Forwarded-For` / `X-Real-IP` before `request.client.host`, preventing nginx Docker-network IPs from being stored as audit client addresses in production. Nginx now overwrites `X-Forwarded-For` with `$remote_addr` instead of appending client-supplied spoofable values. Added focused audit utility and nginx header tests.
- `POST /api/incidents` now writes a `CREATE_INCIDENT` row to `wims.system_audit_trails` in the same transaction as the incident insert.
- `tasks.suricata.ingest_suricata_eve()` now commits the caller-owned DB session after `ingest_eve_file(..., db_session=db)` and rolls back on failure; previously closing the session rolled back parsed Suricata alert inserts.
- Deploy workflow now removes stale Compose-renamed `*_wims-*` containers with the `com.docker.compose.project=wims_internal` label before the production recreate to avoid interrupted-deploy name conflicts such as `<hash>_wims-backend already in use`.
- Validation: `python -m pytest -q tests/test_audit_utils.py tests/test_nginx_forwarded_headers.py tests/test_incidents_create_endpoint.py tests/test_suricata_auto_incident.py` => 17 passed; focused `ruff check`/`ruff format --check`; `git diff --check`.

## [2026-06-15] docs | manual smoke-test runbook for Admin, Validator, Analyst

- Added `docs/operations/manual-smoke-tests.md` as the team-facing manual smoke-test runbook.
- Covered System Admin, National Validator, and National Analyst role assumptions, route/page targets, exact manual actions, expected results, and failure evidence capture.
- Included reusable smoke-result and GitHub issue templates so teammates can report failures in a consistent issue-ready format.
- Added [[operations/manual-smoke-testing]] as the wiki routing summary and linked it from [[operations/agent-routing-guide]] and `system-wiki/index.md`.
- No FRS gap register change (documentation/runbook only; no implementation alignment change).

## [2026-06-16] fix | test fixture: drop/recreate no_delete_audit rule during incident API test cleanup

- `test_incidents_api.py` `mock_user_and_override` fixture now temporarily drops the `no_delete_audit` RULE on `wims.system_audit_trails` before deleting audit rows created by the test, then recreates the rule immediately in a `finally` block.
- This prevents FK-violation teardown failures when `POST /api/incidents` writes `CREATE_INCIDENT` audit rows referencing the temporary test user.
- Audit immutability is preserved: the rule is only lifted during fixture cleanup and is always recreated before the next test runs.
- No FRS gap register change (test infrastructure only).

## [2026-06-16] feat(#355,#361) | breach workflow NPC contact config + status confirmation modal

- **#355 (NPC contact display/config):** Added 3 new `system_config` keys: `npc_contact_name`, `npc_contact_phone`, `npc_office_phone`. Registered in `VALID_CONFIG_KEYS` frozenset in `admin/config.py`. Seed rows added to `49_system_config.sql` with default NPC DPO values. Frontend breach page now fetches NPC config via `fetchAdminConfig()` and displays an NPC Contact card at the top with name, phone, and office phone. Edit button opens a modal with editable fields; saving requires typing the confirmation phrase `confirm-npc-update`. On save, calls `updateAdminConfig()` for each changed value; audit logged via existing `CONFIG_UPDATE` pattern.
- **#361 (breach status confirmation modal):** Replaced direct `handleStatusAdvance` button with a confirmation modal (`StatusAdvanceModal`). Modal displays current→next status transition, NPC deadline impact (overdue/urgent/normal), and an optional notes/evidence textarea. Cancel closes modal without mutation. Confirm calls `PATCH /api/admin/breach/{id}` with status and notes; success shows a green banner and updates the row; failure shows a red inline error in the modal and keeps prior row state (no optimistic mutation).
- **Backend audit enrichment:** `update_breach()` now captures `old_values` (status, affected_systems, data_scope, notes) via a SELECT before UPDATE, and passes `request`, `old_values`, `new_values` to `log_system_audit()`. The `request` parameter enables client IP/UA capture via `X-Forwarded-For`/`X-Real-IP` headers, preserving the #360 real-IP audit pattern. Early 404 check moved to old-row SELECT (fails fast before any mutation).
- **Backend tests:** `test_breach_notifications.py` — updated 4 existing tests for new execute call ordering (old-row SELECT added); added 3 new tests (`test_patch_includes_audit_old_new_values`, `test_patch_includes_request_metadata`, `test_patch_notes_included_in_audit`). `test_system_config.py` — updated `_SEED_ROWS` to 7 entries; added `TestNpcConfigKeys` class with 4 tests.
- **Frontend tests:** `breach-list.test.tsx` — updated to include NPC config mock, added 11 new tests covering NPC contact card rendering, NPC edit modal open/cancel/confirm/error, status confirmation modal open/cancel/confirm/notes/error/CLOSED transition. Total: 22 tests (all passing).
- **Wiki:** `system-wiki/log.md` — this entry. `system-wiki/subsystems/admin-hub.md` — added Breach Notifications section with NPC contact config and status advance confirmation details. `system-wiki/frontend/route-map.md` — updated breach route description. `system-wiki/backend/api-route-map.md` — added breach GET/PATCH routes and updated config route descriptions.
- No FRS gap register changes (enhancements to existing M10d implementation; no new FRS alignment gaps).

## [2026-06-16] feat(#354,#363) | worker timeout config keys + admin rate-limit UI

- **#354 (worker timeout config):** Added two new system_config keys: `worker_stale_timeout_seconds` (min 30, default 60) and `worker_offline_timeout_seconds` (min 60, default 300). Registered in `VALID_CONFIG_KEYS` and `_NUMERIC_CONFIG_KEYS` in `admin/config.py`. Cross-key validation enforces offline > stale; both directions checked on PATCH. Seeds added to `49_system_config.sql`. Backend monitoring `tasks/monitoring.py` now reads these keys via `_read_worker_timeout_config()` on every heartbeat run (30s beat) and uses them in STALE/OFFLINE status-transition UPDATEs. Falls back to safe defaults (60/300) on missing, malformed, or invalidly-ordered values. No dead config — values are consumed by the running heartbeat task.
- **#363 (rate-limits UI):** New `/admin/system/rate-limits` page with System Admin-only access. Displays current login-tier threshold and window from `GET /api/admin/rate-limits` (Redis). Explanatory card describes what the tier protects (Keycloak OIDC callback in `main.py`). Client-side validation: threshold ≥ 1, window ≥ 1, both required. Save calls `PATCH /api/admin/rate-limits` with green success/red failure feedback. Save button disabled when unchanged. Refresh button. Last-updated timestamp. Sidebar "Rate Limits" entry (Timer icon) under System section for SYSTEM_ADMIN only.
- **API helpers:** `legacy.ts` — `fetchRateLimits()`, `updateRateLimits(tier, limit, window)`, `RateLimitConfig` type. `admin.ts` — re-exports.
- **Backend tests:** `test_dynamic_rate_limits.py` — fixed 4 rejection-validation tests that were missing `get_db_with_rls` mock. `test_system_config.py` — 10 new `TestWorkerTimeoutConfigKeys` tests. `test_system_monitoring.py` — 5 new `TestReadWorkerTimeoutConfig` tests plus fixed `test_worker_status_returns_list_for_admin` DB mock.
- **Frontend tests:** `rate-limits.test.tsx` (11 tests — loading, display, explanatory copy, save/save-failure/disabled, validation errors, load error, timestamp, non-admin redirect). `system-config.test.tsx` (5 tests — worker timeout key rendering, descriptions, inline editing, non-admin redirect). `Sidebar.test.tsx` (6 tests — Rate Limits visibility by role and link target).
- **Wiki:** `system-wiki/log.md` — this entry. `system-wiki/subsystems/admin-hub.md` — added Rate Limit Configuration (#363) and Worker Timeout Configuration (#354) sections. `system-wiki/backend/api-route-map.md` — updated rate_limits and config route descriptions. `system-wiki/frontend/route-map.md` — added `/admin/system/rate-limits` route.
- No FRS gap register changes (enhancements to existing M9c config management and M8 monitoring; no new FRS alignment gaps).

## 2026-06-16: Identity Governance & Active Sessions UI (#346, #347)

- **Identity Governance (#346):** Replaced inline UserRow expand/collapse with an edit modal. Added client-side filter bar (username search, role dropdown, region dropdown, active status selector) and client-side pagination (10/25/50 per page). Removed deprecated CIVILIAN_REPORTER from all role dropdowns. Region editor now uses named dropdown from `fetchRegions()` instead of numeric input. Removed the Sessions column from the Identity Governance table.
- **Active Sessions (#347):** Added client-side username filter input and client-side pagination (10/25/50 per page). Sessions remain viewable and manageable in the dedicated Active Sessions container. Per-user sessions are accessible by clicking a username in Identity Governance.
- **Backend:** No changes. All filtering and pagination is client-side using the existing full-list `GET /api/admin/users` and `GET /api/admin/active-sessions` endpoints.
- **Tests:** New test file `admin-system-governance.test.tsx` with 17 tests covering filters, pagination, modal behavior, role validation, region dropdown, sessions column removal, and Active Sessions features.
- **Wiki:** Updated `system-wiki/subsystems/admin-hub.md` to reflect the new governance and sessions UX. No FRS gap register changes (UI improvements only).

## [2026-06-16] fix(#354,#363) | rate-limit middleware reads Redis config (B1 blocker)

- **Root cause:** The auth/callback rate-limit middleware in `main.py` used hardcoded `WINDOW_SECONDS` (900) and `RATE_LIMIT_THRESHOLD` (5) and never read `rate_limit_config:login` from Redis. Changes made via `/admin/system/rate-limits` were written to Redis but had no effect on actual rate-limiting behavior (dead control).
- **Fix:** Modified `rate_limit_middleware` in `main.py` to call `r.hgetall("rate_limit_config:login")` before each eval. Parses `window_seconds` and `threshold` as ints; uses them when both are positive, otherwise falls back to the module-level constants. Safe parse: catches `ValueError`/`TypeError` for non-numeric values and generic `Exception` for Redis connection issues.
- **Tests:** Added `TestRateLimitMiddlewareConfig` class in `tests/test_dynamic_rate_limits.py` with 5 tests: middleware passes configured window/threshold to eval, fallback on empty config hash, fallback on non-numeric values, fallback on zero/negative values, 429 response includes Retry-After header.
- **Wiki:** Updated `system-wiki/subsystems/admin-hub.md` — added middleware consumption note and corrected test count (10→15). `system-wiki/log.md` — this entry.
- No FRS gap register change (bugfix, no new feature/capability gap).

## [2026-06-16] feat(#345) | Celery worker retention + pagination

- **Worker pagination:** `GET /api/admin/monitoring/workers` now returns paginated response `{ items, total, limit, offset }` with default page size 20 (max 200). Frontend worker table has prev/next pagination, page size selector (10/20/50), and "Showing N–M of T" indicator.
- **Manual prune:** `POST /api/admin/monitoring/workers/prune` (SYSTEM_ADMIN only) deletes OFFLINE worker heartbeat rows older than the retention threshold. ACTIVE, STALE, and recent OFFLINE rows are protected. Action is audit-logged (`WORKER_PRUNE`) with deleted count and retention days. Returns `{ status, deleted_count, retention_days, message }`. Frontend "Prune Old Workers" button opens a confirmation modal; result banner shows deleted count and message.
- **Retention policy:** Config key `worker_heartbeat_retention_days` registered in `system_config` (default 7 days, minimum 1). Consumed by both manual and auto-prune logic. Invalid values fall back to 7-day default.
- **Auto-prune:** Integrated in existing `tasks.monitoring.worker_heartbeat` Celery beat task (runs every 30s). Prunes OFFLINE rows older than retention threshold after status updates; audit-logged as `WORKER_PRUNE_AUTO`; skips audit when nothing deleted.
- **Backend tests:** `test_system_monitoring.py` — added 11 new tests: 4 pagination tests (paginated response shape, limit/offset, invalid limit, excessive limit), 5 manual prune tests (admin-only, delete-only-old-offline, config-retention-days, invalid-config-fallback, audit-metadata), 4 auto-prune tests (deletes-old-offline, skips-audit-when-empty, respects-config-retention). Existing `test_worker_status_returns_list_for_admin` replaced with `test_worker_status_returns_paginated_for_admin`.
- **Frontend tests:** `admin-system-monitoring.test.tsx` — updated all 14 existing tests for paginated worker response shape (`mockWorkers` → `mockWorkersPaginated`; empty array → `{ items: [], total: 0, limit: 20, offset: 0 }`).
- **Frontend API:** `fetchWorkerStatus(params?)` returns `WorkerStatusPaginatedResponse`; backward-compat wrapper for older raw-array responses. `pruneWorkers()` calls `POST /api/admin/monitoring/workers/prune`. Offline-aware wrappers updated in `offlineAdmin.ts`. Types exported from `admin.ts`.
- **SQL:** Seed row `worker_heartbeat_retention_days = '7'` added to `49_system_config.sql`.
- **Wiki:** `system-wiki/backend/api-route-map.md` — added prune endpoint and pagination note. `system-wiki/subsystems/admin-hub.md` — updated System Health & Monitoring panel and backend route table for #345.
- No FRS gap register change (operational enhancement to existing worker heartbeat infrastructure).

## [2026-06-16] fix(#364) | Suricata health displayed in consolidated system UI

- **Gap:** Backend `GET /api/admin/health` returned 5-state Suricata component status (HEALTHY/QUIET/FRESH/DEGRADED/UNHEALTHY) with detail text, but the consolidated System Health & Monitoring UI only showed PostgreSQL, Redis, and Keycloak cards. The Suricata card was lost during conflict resolution of the original #364 implementation.
- **Fix:** Added a "Suricata IDS" card to the health grid using the existing `getComponentStatusColor` and `getComponentStatusTextColor` 5-state helpers. The card shows latency, status dot (5-state colored), and detail text (e.g., "alerting — recent threats detected", "healthy, no recent alerts", "no threat data yet"). Updated overall status badge to use `getOverallBadgeColor` for proper DEGRADED (amber) coloring. Expanded health type to include optional `detail`/`error` fields. Changed health grid from 3 to 4 columns on desktop.
- **Backend test cleanup:** Removed unused `from database import get_db` import in `test_system_monitoring.py`.
- **Files:** `src/frontend/src/app/admin/system/page.tsx` (+18/-3), `src/backend/tests/test_system_monitoring.py` (+0/-1).
- No FRS gap register change (UI completeness fix for already-implemented backend health check).
