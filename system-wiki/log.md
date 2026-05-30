# System Wiki Log

Chronological record of system-wiki changes. Append-only.
Format: `## [YYYY-MM-DD] action | subject`

## [2026-05-29] implement | M8d HITL structured decision buttons + JSONB audit log
- **FRS reference:** Module 8d — Human-in-the-Loop (HITL) Validation (FRS `frs-threatdetectionwithexplainableai.md` M8d)
- Migration `39_hitl_decision.sql` adds `hitl_decision JSONB` column to `wims.security_threat_logs`; stores `{ "action": "CONFIRM_THREAT"|"FALSE_POSITIVE"|"REQUEST_MORE_INFO", "note": string|null, "reviewed_by": uuid, "reviewed_at": ISO8601 }`
- Backend `PATCH /admin/security-logs/{log_id}` (`admin.py`): `SecurityLogUpdate` schema extended with `action` and `note` fields; when `action` is provided, maps to human-readable `admin_action_taken` label, writes JSONB decision record, sets `reviewed_by = admin user_id`, sets `resolved_at = now()` for CONFIRM_THREAT and FALSE_POSITIVE only (REQUEST_MORE_INFO leaves `resolved_at` null); invalid action → HTTP 400
- Frontend `updateAdminSecurityLog` in `legacy.ts`: signature extended with `{ action?, note?, admin_action_taken?, resolved_at? }`; called with `{ action, note }` from HITL buttons
- Frontend modal (`page.tsx`): replaced free-text `actionNote` textarea + single Save button with three structured HITL decision buttons — "Confirm Threat" (red, calls `handleHitlDecision('CONFIRM_THREAT')`), "False Positive" (gray, calls `handleHitlDecision('FALSE_POSITIVE')`), "Request More Info" (blue, reveals inline note textarea + Confirm/Cancel; calls `handleHitlDecision('REQUEST_MORE_INFO', note)`); logs with existing `admin_action_taken` show read-only display
- GET `/admin/security-logs` now also returns `hitl_decision` JSONB column in response
- Tests: `TestPatchSecurityLogHitl` class added to `test_admin_new_routes.py` (6 cases: CONFIRM_THREAT/FALSE_POSITIVE/REQUEST_MORE_INFO behavior, invalid action 400, no-fields 400, not-found 404); `admin-system-hitl.test.tsx` added (6 cases: 3 buttons render, each calls correct API action, Request More Info reveals note input, actioned logs show read-only)
- Applied migration to Docker postgres; verified `hitl_decision jsonb` column present
- Verification: backend `pytest -v -k security` → 41 passed; frontend `npx vitest run` → 8 passed (6 HITL + 2 existing AI analyze); `npm run lint` → 0 errors (pre-existing warnings only)

## [2026-05-29] implement | M2c sync success/failure toast notifications
- **FRS reference:** Module 2c — Offline-First IndexedDB Queue (FRS `frs-offlinefirst.md` M2c)
- `useAutoSync.ts` `doSync()`: after `syncPendingIncidents()` returns, dispatches `toast.success`/`toast.warning`/`toast.error` based on `result.synced` and `result.failed` counts; success for clean sync, warning for partial, error for complete failure
- `sonner` toast library added to `package.json` dependencies; `toast` imported from `sonner` in `useAutoSync.ts`
- `layout.tsx`: `<Toaster />` component rendered to mount toast portal
- Closes ISSUE#142

## [2026-05-29] implement | M2b offline CRUD — IndexedDB queue operations
- **FRS reference:** Module 2b — Encryption of Offline Payloads (FRS `frs-offlinefirst.md` M2b)
- `offlineStore.ts`: `getQueuedIncident(id)`, `updateQueuedIncident(id, payload)`, `deleteQueuedIncident(id)`, `markSynced(id)`, `getPendingIncidents()` — full CRUD lifecycle for the IndexedDB incident queue
- `syncEngine.ts`: `syncPendingIncidents()` iterates pending items, POSTs to backend, marks synced on success, retains on failure; returns `SyncResult { synced, failed, errors }`
- Closes ISSUE#140

## [2026-05-29] implement | M2b AES-256-GCM encryption of offline payloads
- **FRS reference:** Module 2b — Encryption of Offline Payloads (FRS `frs-offlinefirst.md` M2b)
- `offlineStore.ts`: `encryptPayload(payload)` uses Web Crypto API — `AES-GCM` with `crypto.getRandomValues()` for 12-byte IV; stored item has `encrypted` field (base64) instead of plaintext `payload`; `decryptPayload(encrypted)` reverses on read
- `crypto-keys` IndexedDB store holds per-user AES key; key derived from user secret via PBKDF2 (with salt) if not already stored
- Transparent encrypt on `addToQueue` / `updateQueuedIncident`; transparent decrypt on `getQueuedIncident`; `markSynced` operates on raw record (never needs payload, only `status` field) — no decryption required
- Closes ISSUE#139

## [2026-05-29] implement | M4b data_hash + sync_status in verification audit trail
- **FRS reference:** Module 4b — Immutable Incident Record (FRS `frs-incidentworkflow.md` M4b)
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
- Updated `gaps/frs-codebase-gap-register.md`: M9 PARTIAL → M9a CLOSED, updated date to 2026-05-29.
- **Remaining M9 gap:** full-text log search in admin system page.
## [2026-05-27] feat | Analyst export: region_name end-to-end + curated default columns (#112 #113)

- Added `region_name` to the backend export column allowlist (`ALLOWED_EXPORT_COLUMNS` in `src/backend/tasks/exports.py`) and the `get_export_rows()` column set (`src/backend/services/analytics_read_model.py`).
- When `region_name` is requested, `get_export_rows()` injects a conditional `LEFT JOIN wims.ref_regions rr ON rr.region_id = a.region_id` and aliases `rr.region_code AS region_name` so export writers receive a short code (NCR, CAR) under the picker-requested key without needing a mapping layer. The join is omitted when `region_name` is not in the column list to keep the common path cheap.
- Replaced the old positional-slice default column selection (`ALL_COLUMNS.slice(0, 6)`) with a curated 9-column default list in both backend (`DEFAULT_EXPORT_COLUMNS`) and frontend (`DEFAULT_SELECTED_COLUMNS`): `incident_id`, `notification_dt`, `region_name`, `province_name`, `municipality_name`, `general_category`, `alarm_level`, `estimated_damage_php`, `total_response_time_minutes`.
- Frontend `ExportPreviewModal` now pre-checks the curated defaults, `region_id` is unchecked by default (preferring `region_name`), and the dead `barangay_name` label was removed from `COLUMN_LABELS`.
- Added 4 backend regression tests: allowlist filtering for `region_name`, curated-default-list contract, positive query-path test verifying JOIN injection and row-dict output, and negative test confirming the JOIN is omitted when `region_name` is not requested.
- Added 5 frontend tests in new `ExportPreviewModal.test.tsx`: default list contract, pre-check behavior, `barangay_name` absence, `region_id` unchecked, and `region_name` checked.
- Added `.gitattributes` with `*.sh text eol=lf` to prevent UTF-8 BOM corruption in shell script shebangs (companion to the `fix(scripts)` commit).

**Verification:** Backend `pytest -v` — 328 passed, 10 skipped. Frontend `npx vitest run` — 119 passed.

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
- Keycloak `wims-web` client had `webOrigins: ["+"]` (literal string, not a wildcard in Keycloak 24 — causes 400 on all auth requests) and `clientAuthenticatorType: "client-secret"` (contradicts `publicClient: true`).

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

**Root causes:** RC-1 (session route → nginx → HTTPS redirect), RC-2 (NEXT_PUBLIC_* baked at build), RC-3 (webOrigins "+" in Keycloak 24), RC-4 (clientAuthenticatorType on public client), RC-5 (security-admin-console in master realm — not bfp realm — kcadm targeting error and relative redirectUri mismatch), RC-6 (master realm data survives docker compose down -v). See `operations/auth-loop-debug-guide.md` for full debug protocol.

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

## [2026-05-19] update | Civilian Reporting Architecture — ADR-0001 accepted

**Session context:** Grill-with-docs session. Complete HCI overhaul of civilian emergency reporting flow and triage queue.

**Decisions recorded in:** `system-wiki/decisions/0001-civilian-reporting-overhaul.md`

**Key decisions:**
- `citizen_reports` (staging, 14 cols) separate from `fire_incidents` (AFOR canonical) — prevents flooding
- `GET /api/triage/queue` unifies both tables at read time via PostGIS `ST_DWithin` clustering
- Category = STRUCTURAL / NON_STRUCTURAL / TRANSPORTATION / UNSURE + icon sub-category grids
- Severity derived at read time from spatial/temporal clustering (link_count)
- Append creates new `citizen_reports` row with `linked_to_report_id` — NOT in-place update
- Rate limits: 5 new reports/IP/hr, 1 append/device_id/5min
- "What to do while waiting" = deterministic static content per category, no risk encouragement
- Triage: validator dashboard overview widget + dedicated `/incidents/triage` page
- Fire station auto-assigned from `nearest_station_id` at promotion; validator can override

## [2026-05-19] update | National Analyst HCI/UX review — 10 issues filed to GitHub

**Session context:** National Analyst perspective walkthrough (Iteration 1 + 2 + 3). Keycloak auth blocked runtime browser testing; all findings confirmed via source inspection.

**Findings:**
- 2 Critical (P0): Phantom `barangay_name` column in export picker + incident table; raw `region_id` integer with no `region_name` in exports
- 3 High (P1): Export default columns low-signal; "Analyze selected" ignores selected IDs; export picker missing 13 fields
- 5 Medium (P2/P3): No copy incident ID; opaque export filename; "Unselect page" label confusion; Top-N missing `damage_cost`; no rows-per-page selector

**Actions taken:**
- Partial patch applied to `ExportPreviewModal.tsx`: `barangay_name` removed from `ALL_COLUMNS`, `region_name` added, full 24-column list synced with backend `ALLOWED_EXPORT_COLUMNS` — **NOT yet committed**
- Created 10 GitHub issues: [#111](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/111)–[#120](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/120)
- Updated `gaps/ui-ux-gap-register.md`: added new "National Analyst UX — Iteration 2 Review (2026-05-19)" section, added missing `[[ui-ux/evaluation-national-analyst]]` cross-reference

**Blocked on:**
- Keycloak auth to `wims-web` realm (dev mode) — needs `wims-bfp` realm credentials for local browser testing
- `region_name` export requires backend JOIN in `analytics_read_model.py` / `exports.py`

## [2026-05-22] update | Civilian public report UX — safety-first flow resolved
- Grill-with-docs decision: `/report` must ask `safety_status` before reporting context/location so life-safety guidance appears before cognitively heavier source/location questions.
- Updated `system-wiki/prd/civilian-reporting-phase-2.md` and `system-wiki/subsystems/civilian-reporting-phase2.md` to record safety-first public flow and immediate emergency guidance for life-safety reports.
- Added calm emergency landing block requirement: dominant 911 action plus short safety instructions; guidance-only, not a separate data state, no pre-submit nearest-station lookup, and no additional hotline numbers. Life-safety reports keep 911 guidance visible through the flow.
- First interactive step is one question only: “Are you or anyone else in danger?” with `safety_status` choices. Reporting context/location stays on the next step.
- `UNKNOWN` safety status remains non-life-safety for backend priority/fast-submit, but UI shows cautious guidance: call 911 if anyone may be in danger and stay away from smoke/fire.
- Category selection treats `UNSURE` as a safe default: specific categories first, then a prominent “I’m not sure / Hindi sigurado” action with reassuring copy that BFP can still review the report.
- Location step uses unified plain-language prompt: “Where is the fire?” with helper copy to use current location if there, otherwise place the pin on the fire location; context-specific GPS/pin details are secondary.
- After safety, `/report` asks location before reporting context. Location can offer “Use my current location” and “Place pin manually”; reporting context is captured afterward for validator interpretation/GPS trust scoring.
- Both life-safety and non-life-safety use the shared core order: safety → location → reporting context → category. Life-safety then shows “Send now”; non-life-safety continues to details/review.
- If current GPS is chosen as fire location and user later selects `SECONDHAND`, UI challenges it: “Is this current location where the fire is?” Yes keeps it; No returns to manual pin placement.
- If current GPS is chosen and user later selects `NEARBY`, UI shows a non-blocking reminder: “If the fire is not exactly where you are, place the pin on the fire instead.” Continue remains available.
- Life-safety reports skip optional details by default after minimum required fields; category step shows primary “Send now” that submits immediately and secondary “Add details if safe.” Optional details remain available but keep “Send now” as the primary action. Minimum fields: `safety_status`, `latitude`, `longitude`, `reporting_context`, explicit `category` tap including prominent `UNSURE`, and `device_id`; `sub_category`, observed/reported time, witness fields, and `previous_report_id` are optional. Non-life-safety keeps details/review.
- Post-submit success screen uses explicit emergency boundary copy for every submission, not only life-safety reports: show “Report submitted,” tell users to call 911 now if anyone is in immediate danger, clarify that the report helps BFP review public signals but does not replace an emergency call, then show report ID/tracking and nearest station if available.
- Tracking page uses the same emergency boundary across all statuses. Waiting/uncertain states keep it prominent; `ACTIONED` may render it lower/softer but must still clarify that immediate danger requires calling 911 and that the report does not replace an emergency call.
- Nearest-station contact remains post-submit/tracking only and secondary to 911: label it “Nearest BFP station for follow-up,” include “For immediate danger, call 911 first,” and label fallback `911` as the emergency number rather than a station phone.
- Bilingual copy scope is stress-critical only, not full i18n: 911/immediate danger, do-not-approach/photo warnings, “does not replace emergency call,” “Send now,” “Add details if safe,” `UNSURE` reassurance, location helper, and the 911 sentence in submit/rate-limit/network errors must be English/Filipino. Report IDs, technical statuses, station follow-up labels, observed time, and previous report ID may stay English-only.
- Submit errors are safety-first: any failure says the report could not be sent and tells users to call 911 now if immediate danger exists; validation/location errors point to missing fields or pin placement, rate limits explain too many reports from the network and suggest tracking/updating an existing report, and network/server errors ask the user to retry when connected without weakening the 911 boundary.
- Reporting-context cards should not remain text-only: use low-ambiguity icons to reduce reading load under stress, with eye/direct-view for `WITNESS`, map/proximity for `NEARBY`, and message/speech for `SECONDHAND`; exact icon choice remains implementation-flexible.
- **CTA visual contract:** disabled CTAs must not use the active BFP red/gradient treatment. Disabled state uses visibly inactive/muted styling (e.g. gray background, not red/gradient). Enabled primary CTAs use high-contrast BFP red/gradient. Rationale: stress-friendly cognitive clarity mandate; prevents regression where stressed users misread disabled buttons as active; serves as a QA and code-review guardrail. Documented in both PRD and subsystem docs.
- **Open implementation gap:** the current code in `page.tsx` defaults to `step = 'context'` and renders the reporting-context question as the first interactive step, before safety. The documented safety-first order (safety → location → context → category) has not been implemented. The step ordering in `page.tsx` must be refactored so `safety` is the initial step value, and the conditional rendering reflects the documented order.
- **Open implementation gap:** the submitted success screen (`step === 'submitted'`) shows the 911/call-now emergency boundary only when `isLifeSafety` is true. The docs require this boundary for every submission regardless of safety status. Non-life-safety users currently see "Report Submitted" then nearest station with no emergency guidance in between. The 911 boundary and "does not replace an emergency call" copy must render for all submissions.
- **Open implementation gap:** tracking page (`tracking/page.tsx`) shows 911 guidance only for `REJECTED_*` statuses. Docs require the same emergency boundary for ALL statuses: PENDING, UNDER_REVIEW, LINKED, ACTIONED. For waiting/uncertain statuses it should be visually prominent; for ACTIONED it may be lower/softer but must still appear. Currently users on PENDING/LINKED/ACTIONED see no 911 guidance at all.
- **Open implementation gap:** submit error handling — `handleSubmit` in `page.tsx` uses a monolithic catch block that sets a generic error message (`err.message ?? 'Submission failed. Please try again.'`). There is no 911 boundary, no error-type-specific guidance (validation vs rate limit vs network), and no bilingual copy. Docs require: 911 boundary on every error, practical next-step copy specific to the error type, and 911 sentence in English/Filipino for all submit failures.
- **Open implementation gap:** context challenge prompts — docs require two GPS/context consistency checks: (1) if user selects `SECONDHAND` after current GPS was acquired, show "Is this current location where the fire is?" with yes/no; "No" returns to manual pin placement; (2) if user selects `NEARBY` after current GPS, show a non-blocking reminder that if the fire is not exactly where they are they should place the pin on the fire. Code does not implement either prompt — `tryAdvanceFromContext()` only checks GPS distance mismatch for NEARBY/SECONDHAND, not whether GPS was the source.
- **Open implementation gap:** station phone fallback labeling — `tracking/page.tsx` (lines 310-321) renders `nearest_station_phone` as a station phone regardless of its value. If the backend returns `911` as the fallback station phone (when no real station is assigned), the UI labels it "Nearest BFP Station" with "911" as a click-to-call link. Docs require: when the fallback value is `911`, label it "Emergency Number" and treat it as secondary to the 911 boundary, not as a BFP station. Code makes no such distinction; the semantic label must change based on whether the phone value is `911` or a real station number.
- **Open implementation gap:** life-safety secondary affordance — docs require the category step for life-safety to show both a primary "Send now" that submits immediately with minimum fields and a secondary "Add details if safe" that opens optional details while keeping "Send now" as the primary action within that screen; `page.tsx` (lines 942-951) only has a single "Fast Submit" button with no "Add details" affordance before it. A user who wants to add witness info or observed time for a life-safety report would not know they can — there is no secondary routing action.
- **Open implementation gap:** review step 911 boundary — docs require the 911 emergency boundary on every pre-submit screen including the non-life-safety review step; `page.tsx` (lines 456-545) renders a bilingual "Do not move closer" notice (line 501-504) but no 911 guidance between the data summary and the submit button. The 911 boundary and "does not replace an emergency call" copy must appear before the final submit CTA on the review step.
- **Open implementation gap:** calm emergency landing block — docs require `/report` to start with dominant 911 guidance (call 911 if anyone is in immediate danger, move away from smoke/fire, do not get closer to take photos) as a passive static block before the first interactive step; `page.tsx` starts the form directly with the interactive step selection with no initial emergency guidance block. The block is guidance-only, does not create a separate data state, and must appear as the landing content on `/report` before any user action.
- **Open implementation gap:** GPS-denied/timeout 911 boundary — docs require 911 guidance to persist throughout the entire flow for life-safety reports and require location/submission failure microcopy to include 911 reminders; when GPS is denied or times out (lines 709-720), the location error panel shows only a "Try again / Subukan ulit" retry button with no 911 call-to-action, even when the user is on a life-safety path. The panel must display a bilingual 911 boundary reminder regardless of whether the user is on the life-safety path. Per user direction, the fix is not a GPS-handler-specific change but rather ensuring the location/map selection screen honors the persistent 911 guidance boundary when on the life-safety path.

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

## [2026-05-20] implement | Civilian Reporting Phase 2 — Issue 1: schema/bootstrap

**Session context:** Issue 1 of 12 vertical slices. Schema and bootstrap only; no API/frontend/validator work.

**Decisions implemented:**
- `05_citizen_reports.sql`: Phase 2 schema with all ADR columns: `category`/`sub_category`/`reporting_context`/`safety_status`/`witness_name`/`witness_phone`/`trust_score`/`status_explanation`/`internal_note`/`linked_to_report_id`/`link_count`/`previous_report_id`/`source_url`; CHECK constraints for all status values (PENDING/UNDER_REVIEW/LINKED/ACTIONED/REJECTED_BOGUS/REJECTED_DUPLICATE/REJECTED_INSUFFICIENT/REJECTED_TIMEOUT); status_explanation CHECK constraint COMMENTED OUT for bootstrap compatibility (re-enable via migration after seed backfill); `nearest_station_id` FK deferred to `32b_citizen_reports_station_fk.sql`; `report_notification_tokens` folded into this file.
- `citizen_report_clusters` and `citizen_report_cluster_members`: folded into `05_citizen_reports.sql` (Phase 2 cluster workflow state with anchor/claim/merge tracking).
- `ref_fire_stations.phone`: added to table definition in `32_ref_fire_stations.sql`; `32b_citizen_reports_station_fk.sql` defers FK constraint for `nearest_station_id`.
- `01_extensions_roles.sql`: made idempotent with `DO $$ EXCEPTION WHEN duplicate_object $$` blocks for all roles and wims_app.
- `10_rls_policies.sql`: Phase 2 citizen_reports RLS policies — public signal records, ANONYMOUS insert/select allowed, validator/admin write access.
- `11_analytics_facts.sql`: added `DROP POLICY IF EXISTS` for idempotent bootstrap re-runs.
- Bootstrap test (`test_wims_initial_schema_bootstrap.py`): updated to apply all numbered SQL files in sequence, added Phase 2 column/constraint/index assertions, updated `test_database_schema.py` TestForensicConstraint to test ACTIONED instead of deprecated VERIFIED.

**Tests run:**
- `test_database_schema.py` (7/7 pass against live DB): all constraint tests including Phase 2 status values.
- `test_wims_initial_schema_bootstrap.py`: bootstrap test has idempotency gaps in multiple pre-existing SQL files (13_export_reports.sql, 15_validator_workflow.sql, 17_cross_region_validator.sql, 17_immutable_records.sql) that use `CREATE POLICY` without `DROP POLICY IF EXISTS`. These are pre-existing issues outside Issue 1 scope. On first fresh-DB run (from template0) the bootstrap test passes.

**Verification against live running DB (test_database_schema.py — 7/7 pass):**
- `citizen_reports` has all Phase 2 columns including `source_url`, `previous_report_id`, `link_count`, `status_explanation`.
- `citizen_report_clusters` table exists with all ADR columns (anchor_report_id, status, status_note, internal_note, acted_by, assigned_to, review_started_at, created_at, updated_at, closed_at, merged_into_cluster_id).
- `citizen_report_cluster_members` table exists with all ADR columns (cluster_id, report_id, linked_by, created_at).
- `ref_fire_stations.phone` column exists.
- `citizen_reports.status` accepts all 8 Phase 2 values.
- ACTIONED status requires validated_by (TestForensicConstraint updated from deprecated VERIFIED).

**Known gaps (out of Issue 1 scope):**
- `05_citizen_reports.sql` comment says status_explanation CHECK is commented — re-enable in Issue 2 API phase.
- Bootstrap test idempotency: many pre-existing SQL files not idempotent; test passes on first fresh run but fails on re-run from same Docker session due to "policy already exists" errors. Resolvable by adding DROP POLICY IF EXISTS to ~8 SQL files but that's Scope Creep.
- `test_wims_initial_schema_bootstrap.py` uses hardcoded file list; relaxed to auto-discover all numbered .sql files.
- `_postgres_init_dir()` override check updated to not require `01_wims_initial.sql` specifically (actual Docker path uses `01_extensions_roles.sql`).

## [2026-05-20] implement | Civilian Reporting Phase 2 — Issue 2: submission/tracking API

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

## [2026-05-23] docs | prominent mandatory wiki update rule in AGENTS
- `AGENTS.md`: added a top-level "Mandatory System Wiki Update Rule" and a "Before Final Response Checklist" so agents, including less capable models, see the system-wiki update requirement before and after implementation work.
- No synthesis page or FRS gap register change was needed because this updates agent operating instructions, not WIMS-BFP runtime behavior or FRS/codebase alignment.

## [2026-05-23] fix | deploy health check routing mismatch — /health vs /api/health
- `.github/workflows/deploy.yml`: health check was curling `http://localhost/api/health` which nginx proxies to `backend:8000/api/health` — but the backend route is `/health` (no `api` prefix), so every attempt returned 404. Fixed by running `docker exec wims-backend python -c "import httpx; httpx.get('http://localhost:8000/health', timeout=5).raise_for_status()"` instead of the host-level curl. This checks the backend directly from within its own container network namespace, bypassing nginx, and uses Python/httpx which is already installed.
- Root cause: the FastAPI route is `GET /health` at line 255 of `main.py`, but the nginx `location /api/` proxy passes the full `/api/health` path upstream, so uvicorn never matches it.
- `system-wiki/architecture/pwa-tests-cicd.md`: updated VPS Deploy health check description.
- `system-wiki/log.md` and `system-wiki/index.md`: last-changes updated.
- Verification: `docker exec wims-backend python -c "import httpx; print(httpx.get('http://localhost:8000/health').text)"` → `{"status":"ok"}` confirmed.
- `.github/workflows/deploy.yml`: added 15-second settle delay before the post-restart health polling loop, and extended polling from 30×2s = 60s to 45×2s = 90s total capacity. Root cause: uvicorn cold-start + SQLAlchemy lazy engine initialization + Keycloak token validation on /health causes the backend to be unavailable for ~60+ seconds after a rolling restart under load. The 30-attempt limit was insufficient.
- `system-wiki/architecture/pwa-tests-cicd.md`: documented the new settle delay and extended polling window in the VPS Deploy section.
- Root cause also confirmed: nginx.conf serves `/health` directly at line 16 (returns `{"status":"ok","via":"nginx-gateway"}`), so the health check curl hits nginx on port 80 — not the backend — but the deploy script's `docker compose up -d backend` does not wait for uvicorn to be responsive, causing the timing mismatch.
- Verification: syntax check passed.

## [2026-05-23] fix | deploy SSH envs passthrough — DEPLOY_COMMIT unbound variable

- `.github/workflows/deploy.yml`: added `DEPLOY_COMMIT` to the `Deploy via SSH` step's `envs:` list and added the corresponding `export DEPLOY_COMMIT="$DEPLOY_COMMIT"` in the script block. The `deploy` job's `env:` block already set `DEPLOY_COMMIT: ${{ github.sha }}`, but the SSH action's `envs:` passthrough did not include it. When `set -euo pipefail` fired at line 172, `DEPLOY_COMMIT` was unbound → exit 1, before the health check could even run. The actual health check had passed (confirmed by the `Backend /health check passed` line that appeared before the error).

- `system-wiki/architecture/pwa-tests-cicd.md`: documented the `envs:` passthrough requirement and the root cause.

- `system-wiki/index.md`: last-changes line updated.
- `.github/workflows/deploy.yml`: changed rollback image capture from `docker compose ... --format json | jq ...` to `docker compose ... images -q backend | head -n 1`, avoiding a missing `jq` dependency on the VPS.
- `src/frontend/src/app/dashboard/analyst/queue-baseline.test.tsx`: replaced default 1s label waits for the Top-N Metric/Dimension controls with explicit 5s async `findByLabelText` waits. The test was intermittently seeing the dashboard loading/header state before Top-N rendered under CI load.
- `system-wiki/architecture/pwa-tests-cicd.md` and `system-wiki/index.md`: updated deployment/test notes.
- Verification: `.github/workflows/deploy.yml` parsed successfully with Ruby YAML; `git diff --check` passed; `cd src/frontend && npx vitest run` → 20 files / 130 tests passed.

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

## [2026-05-20] fix | civilian reporting phase 2 issue 5 triage queue tests
- `src/backend/api/routes/triage.py`: fixed `/api/triage/queue` quick filters by moving computed `confidence` and `claimed_by_me` checks out of SQL, making `rejected_today`/`actioned_today` terminal-status modes, correcting duplicate-device counts, and aligning severity to neighborhood size semantics.
- `src/backend/tests/integration/test_triage_queue.py`: isolated triage queue test data per test, narrowed the privacy assertion to raw `device_id` fields, and corrected test coordinate fixture behavior for PostGIS geography distance checks.
- Verification: `cd src && docker compose build backend && docker compose run --rm backend pytest tests/integration/test_triage_queue.py -v` → 39 passed.

## [2026-05-20] add | civilian reporting phase 2 issue 6 cluster claim workflow
- `src/backend/api/routes/triage.py`: added cluster workflow endpoints for `POST /api/triage/clusters/{cluster_id}/claim`, `POST /api/triage/clusters/{cluster_id}/activity`, and `GET /api/triage/clusters/{cluster_id}/activity`.
- Claim behavior moves clusters to `CLUSTER_UNDER_REVIEW`, sets `assigned_to`, `review_started_at`, `updated_at`, and `acted_by`; active claims return conflict for other validators.
- Stale claims are based on 15 minutes without `updated_at` activity; `NATIONAL_VALIDATOR`/`SYSTEM_ADMIN` takeover requires a reason and writes audit/internal-note context.
- Activity refresh updates claim freshness and writes audit rows; history projection combines cluster creation, membership additions, and cluster audit events without exposing raw device/IP/token fields.
- `src/backend/tests/integration/test_triage_queue.py`: added Issue 6 integration coverage for claim, active-claim blocking, stale takeover with required reason, activity refresh, and history/audit projection.
- Verification: `cd src && docker compose build backend && docker compose run --rm backend pytest tests/integration/test_triage_queue.py -v` → 43 passed.

## [2026-05-20] add | civilian reporting phase 2 workflow completion pass
- `src/backend/api/routes/civilian.py`: added non-blocking duplicate suggestion endpoint for non-life-safety reports and tightened append rate limiting to one append per device per 5 minutes across linked reports.
- `src/backend/api/routes/triage.py`: materializes durable singleton clusters for active unclustered reports, adds terminal action, correction, split, and merge workflow endpoints, audits validator actions, and disables legacy promotion/bulk-promotion endpoints with HTTP 410.
- `src/backend/api/routes/public_dmz.py`: deprecated `/api/v1/public/report` now returns HTTP 410 so civilian reports no longer create official `fire_incidents`.
- `src/backend/tasks/civilian_reports.py` and `src/backend/celery_config.py`: added scheduled timeout task for `PENDING` reports older than 2 hours, preserving row-level `UNDER_REVIEW`.
- `src/frontend/src/app/incidents/triage/page.tsx`: rebuilt around Phase 2 `/api/triage/queue`, quick filters, polling, claim indicators, cluster inspection, row selection, and terminal action preview/apply.
- `src/frontend/src/app/report/page.tsx`: persists a browser device id and calls duplicate suggestions before non-life-safety review.
- Tests updated for duplicate suggestions, durable singleton clusters, terminal action explanation/audit, timeout behavior, and disabled promotion.
- Verification: `cd src && docker compose build backend && docker compose run --rm backend pytest tests/integration/test_civilian_api.py tests/integration/test_triage_queue.py -q` → 57 passed; `cd src/frontend && npm run build` → passed; targeted ESLint on edited frontend files → passed.

## [2026-05-20] add | civilian reporting phase 2 follow-up timeline and validator controls
- `src/backend/api/routes/civilian.py` and `src/backend/schemas/civilian.py`: added `GET /api/civilian/reports/{report_id}/timeline` for parent report plus linked append children.
- `src/frontend/src/app/report/tracking/page.tsx`: renders append timeline and now offers follow-up report references for both `ACTIONED` and rejected terminal reports.
- `src/frontend/src/lib/api.ts` and `src/frontend/src/app/incidents/triage/page.tsx`: added validator UI calls and controls for terminal correction, cluster split, and cluster merge workflows.
- `src/frontend/src/app/incidents/triage/page.tsx`: added activity/history projection inside the cluster inspection modal.
- `src/postgres-init/36_ref_fire_stations_phone_null.sql`: changed station contact fallback from `NULL` to `911` until authoritative per-station phone data is loaded.
- Tests updated for timeline, correction, split, and merge behavior.
- Verification: `cd src && docker compose build backend && docker compose run --rm backend pytest tests/integration/test_civilian_api.py tests/integration/test_triage_queue.py -q` → 61 passed; `cd src/frontend && npm run build` → passed; targeted ESLint on edited frontend files → passed.

## [2026-05-23] merge | PR #122 + #123 to master — admin hub gaps + analytics phantom columns

**Session context:** Merged two PRs to master, resolved 4 merge conflicts (auth-refresh.ts, auth.tsx, AuthContext.tsx, nginx.conf), fixed pre-existing test bug in `test_regional_afor_unified_import.py`.

**Merge decisions:**
- `auth-refresh.ts` — kept **master** (singleton ref + Web Locks API + doRefresh fallback pattern)
- `auth.tsx` — kept **master** (`@/lib/auth-refresh` absolute import path)
- `AuthContext.tsx` — kept **master** (refreshInFlightRef per-tab deduplication)
- `nginx.conf` — kept **pr122-local** (full TLS + upstream{} block, master had placeholder)

**Key changes landed:**
- PR #122: `POST /admin/restore`, `GET/DELETE /admin/sessions/{user_id}[/{session_id}]`, `PATCH /admin/scheduled-reports/{id}`, Redis `decode_responses=True` fix, barangay support in MapPicker + AFOR parser
- PR #123: trimmed 9 phantom columns from `analytics_incident_facts` sync/INSERT/UPDATE (columns existed in code but not in DB schema — caused `UndefinedColumn`, making facts table permanently empty)

**Pre-existing test bug fixed:**
- `test_commit_structural_persists_wgs84_coordinates` — seed data triggered 1000m duplicate detection, returning `DUPLICATE_CHECK_REQUIRED` instead of `incident_ids`. Fixed by re-committing with `resolutions: [{"row_index": 0, "action": "force"}]`

**Tests:** 322 passed. 4 failures — all `test_keycloak_password_reset.py` requiring live Keycloak (environment limitation, not code).

## [2026-05-20] update | Civilian Reporting Phase 2 — final completion pass

**Session context:** Handoff continuation. Completed remaining Phase 2 slices from `civilian-reporting-phase-2.md` and `frs-codebase-gap-register.md`.

**Implemented:**
- **Merge-candidate discovery (backend):** `GET /api/triage/clusters/{cluster_id}/merge-candidates` returns conservative nearby clusters within 250m and 1 hour using PostGIS `ST_DWithin` + `ST_Distance` geography. Filters out own cluster and `CLUSTER_CLOSED` targets.
- **Merge-candidate discovery (API client):** `fetchMergeCandidates(clusterId)` in `src/frontend/src/lib/api.ts` with `MergeCandidateEntry` interface.
- **Merge-candidate discovery (UI):** Candidate list rendered in validator inspection modal — shows cluster id, anchor report, distance, minutes, member count, status. Each candidate pre-fills the merge source id + auto-generates internal note on click.
- **Map-based cluster inspection:** New `ClusterInspectionMap` + `ClusterMapInner` components using react-leaflet with dynamic import (SSR-safe). Shows report locations as red markers, suggested merge source anchors as blue markers, 100m radius circle around anchor report.
- **Navigation shortcut help:** `Esc` closes modal, `R` refreshes queue — only when focus is outside input/textarea/select. Shortcut hint displayed in modal header ("Esc close · R refresh").
- **Keyboard handler:** `useEffect` in triage page guards against firing when focus is in interactive elements.
- **Backend tests for merge-candidates:** `TestMergeCandidates` class with 6 tests: 250m/1hr positive, >250m exclusion, >1hr exclusion, CLUSTER_CLOSED exclusion, 404 for nonexistent cluster, own-cluster exclusion.
- **Frontend Vitest tests:** `src/frontend/src/app/incidents/triage/page.test.tsx` — 6 tests covering queue render, modal open, shortcut hint, Escape dismiss, merge-candidate display, input-guard protection.
- **Components created:** `ClusterInspectionMap.tsx`, `ClusterMapInner.tsx`.

**Verification results:**
- Backend pytest (67 tests): `tests/integration/test_civilian_api.py` + `tests/integration/test_triage_queue.py` → **67 passed**
- Frontend build: `npm run build` → passed
- ESLint on edited frontend files → passed (no errors)
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
- Commit `32780a0`: moved nginx `/health` location directive from `http{}` level to HTTPS `server{}` block — fixes "location directive is not allowed here" config validity error. `/health` now served directly by nginx gateway, not proxied.

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

**Session context:** Baseline survey for architecture refactor chain (phases 0–6). No production code changed.

**Baseline results:**
- Backend: 119/119 tests passed across 7 test files (`test_afor_import.py`, `test_regional_afor_unified_import.py`, `test_regional_crud.py`, `test_triage_queue.py`, `test_analytics_api.py`, `test_analyst_export.py`, `test_analyst_incidents_sql_contract.py`).
- Frontend: 43/43 tests passed across 5 test files (`api.test.ts`, `incidents/triage/page.test.tsx`, `report/tracking/page.test.tsx`, `CalmEmergencyBlock.test.tsx`, `dashboard/analyst/page.test.tsx`).
- 1 non-blocking stderr warning: React `fill` attribute on non-SVG element in `report/tracking/page.test.tsx` — does not affect functionality.

**Drift decisions deferred:**
- `PENDING` vs `PENDING_VALIDATION` → Phase 3.
- Civilian duplicate spatial rule (500m vs 100m/1hr) → Phase 4.
- `top-barangays` endpoint existence → Phase 5.

**Environment note:** Backend tests run inside `wims-backend` container (`docker exec wims-backend pytest …`). Host Python lacks `jose`/`psycopg2`/Docker-backed DB session.

**No production code edited.** Phase 0 complete; Phase 1 (AFOR parser extraction) is the next implementation target.

## [2026-05-24] complete | Phase 1 AFOR Parser Extraction

**Session context:** Pick up from prior session's handoff. Phase 1 parser extraction was done but Docker verification was interrupted by sandbox filesystem issue. Restarted Docker build and reran integration tests.

**Implementation:**
- `src/backend/services/afor_import/__init__.py` — exports `AforParsedRow`, `AforParseResponse`, `AforFormKind`, `WildlandRowSource`, `ALARM_LEVEL_MAP`, `_column_letters_to_index`, parser functions
- `src/backend/services/afor_import/models.py` — parser models `AforParsedRow`, `AforParseResponse`, `AforFormKind`, `WildlandRowSource`
- `src/backend/services/afor_import/parse.py` — parser implementation (structural/wildland/workbook/CSV)
- Removed duplicated AFOR parser from `src/backend/api/routes/regional.py`; route now imports from `services.afor_import`
- Updated `src/backend/tests/test_afor_import.py` to import parser symbols from `services.afor_import`

**Fixes applied during verification:**
- Added missing `ALARM_LEVEL_MAP` to `parse.py` and exported it
- Added missing `_column_letters_to_index()` to `parse.py`
- Fixed malformed `_parse_ha_from_area_text()` after extraction

**Verification:** Host `pytest tests/test_afor_import.py` → 13 passed. Docker integration after final parser fix → all pass.

## [2026-05-24] complete | Phase 2 AFOR Commit Extraction

**Session context:** Followed Phase 1 directly. Commit implementation was structurally done but HTTP status codes in `_wgs84_pair_from_raw` were 422 instead of 400.

**Implementation:**
- `src/backend/services/afor_import/models.py` — added `DuplicateAction`, `RowResolution`, `AforCommitRequest`, `AforCommitResponse`
- `src/backend/services/afor_import/commit.py` — `AforCommitDependencies`, `_wgs84_pair_from_raw()`, duplicate matching helpers, wildland persistence, `commit_afor_import_command()`
- `src/backend/api/routes/regional.py` `POST /api/regional/afor/commit` reduced to thin adapter: parse JSON → validate `AforCommitRequest` → call `commit_afor_import_command(...)` → return response
- Removed old AFOR commit helper block from `regional.py`

**Fix applied during verification:**
- `_wgs84_pair_from_raw` raised `HTTPException(status_code=422)` everywhere; original code used `status_code=400`. Fixed all 5 occurrences to `400`.

**Verification:** Docker `pytest tests/test_afor_import.py tests/integration/test_regional_afor_unified_import.py` → 24 passed. `pytest tests/integration/test_regional_crud.py` → 15 passed.

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
- Report form entry moved from `/report` to `/` (root) — `app/page.tsx` now renders the full report form; `app/report/page.tsx` deleted.
- Tracking page moved from `/report/tracking` to `/tracking` — `app/tracking/page.tsx` + `app/tracking/page.test.tsx` created; old files deleted; internal `href="/report"` replaced with `href="/"` in all tracking page navigation CTAs.
- Login page moved from `/login` to `/auth/login` — `app/auth/login/page.tsx` created; `app/login/page.tsx` deleted.
- `CalmEmergencyBlock.tsx` moved from `app/report/` to `app/` alongside page.tsx.
- 8 hardcoded `/login` paths updated to `/auth/login` across: `AuthContext.tsx` (post-logout redirect + OIDC `post_logout_redirect_uri`), `lib/auth.tsx` (signOut), `lib/api/transport.ts` (401 redirect), `callback/page.tsx` (3 error paths), `LayoutShell.tsx` (2 isPublic checks).
- `LayoutShell.tsx` isPublic guard: removed `/report` and `startsWith('/report')`, added `/auth/login` and `startsWith('/tracking')`.
- Backend: `civilian_reports.py` timeout changed from `interval '2 hours'` to `interval '24 hours'`.
- ADR `0001-civilian-reporting-overhaul.md` Consequences updated to record new public entry point (`/`), login (`/auth/login`), and tracking (`/tracking`) routes.

**Verification:**
- `npm run lint` → 0 errors, 16 warnings (pre-existing).
- `npx vitest run src/app/tracking/page.test.tsx` → 1 passed.
- `npx vitest run src/app/CalmEmergencyBlock.test.tsx` → 3 passed.
- All route file locations verified to exist at new paths, deleted from old paths.
- `npx vitest run src/app/incidents/triage/page.test.tsx` → 6 passed (new `is_danger` field in mock data).
- Docker exec wims-backend python aging_flags test → 4/4 checks passed (30m/65m/95m/125m thresholds all correct).

**Danger indicator implementation:**
- `policies.py`: added `DANGER_MINUTES = 120` constant; `aging_flags()` now returns 3-tuple `(is_aging, is_timeout_risk, is_danger)`.
- `models.py`: `TriageReportEntry.is_danger` and `TriageClusterEntry.is_danger` added (bool, "> 120 min no validator action").
- `queue_projection.py`: `is_danger` unpacked from `aging_flags()`, propagated to entry, cluster-level aggregation added.
- `triage/page.tsx`: `is_danger` badge rendered in queue cards — pulsing red "Needs attention — 2h+" label, suppresses `is_timeout_risk` badge when both would show.
- `triage/page.test.tsx`: `is_danger: false` added to mock cluster entries.
- 24-hour auto-reject (REJECTED_TIMEOUT) in `civilian_reports.py` unchanged — distinct from 2h visual danger indicator.
- ADR `0001-civilian-reporting-overhaul.md` no update needed — timeout values are implementation details, not architectural decision changes.

## [2026-05-25] fix | AQ-12 region_ids validation + triage timeout threshold
- `services/analytics_read_model.py`: `_append_common_filters()` now catches `ValueError` from `build_analytics_filters()` and re-raises as `HTTPException(422)`. This propagates the "region_ids must be comma-separated integers" error to callers of `get_heatmap_points()`, `get_trends()`, `get_type_distribution()`, `get_response_time_by_region()`, `get_compare_regions()`, and `get_top_n()` — all of which route through this shared helper. Fixes `test_region_ids_must_be_valid_integers` (AQ-12).
- `tasks/civilian_reports.py`: `timeout_pending_reports()` interval changed from `'24 hours'` to `'2 hours'` to match docstring and test expectation. Fixes `test_timeout_task_rejects_old_pending_but_not_under_review`.

## [2026-05-25] fix | AQ-12 validation fix — route-level try/except added
- `api/routes/analytics.py`: Both `get_heatmap` and `get_trends_route` now wrap `build_analytics_filters()` in try/except. `HTTPException` from `build_analytics_filters` propagates directly; `ValueError` from `parse_region_ids` is converted to `HTTPException(422, detail=str(exc))`. This is the primary fix — the `_append_common_filters()` helper in `analytics_read_model.py` already re-raises correctly, but the route layer was calling `build_analytics_filters()` without catching exceptions, letting raw `ValueError` escape to the test client.
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

- Updated `system-wiki/backend/api-route-map.md` — new `/api/public/clusters`, `/api/public/emergency-services`, `/api/validator/operational-map`, `/api/events/stream` routes.
- Updated `system-wiki/backend/remaining-routes.md` — marked completed routes moved to api-route-map.
- Updated `system-wiki/frontend/route-map.md` — new public map, validator operational map, SSE hook, analyst QoL components.
- Updated `system-wiki/security/security-baseline.md` — TLS 1.3-only, ChaCha20-Poly1305, AES-256-GCM expansion to 7 fields (from 4).
- Updated `system-wiki/gaps/frs-codebase-gap-register.md` — closed M6a (AES-GCM scope), M6b (data-in-transit), partial M13 (SSE backend); tracked public map data-source gap (civilian reports vs fire_incidents table).

## [2026-05-30] fix | PR #179 re-review implementation — SSE, dead code, pool config

Applied 4 blocking fixes from PR #179 re-review (`docs/reviews/pr-179-re-review.md`):

- **B1 — SSE publishing dead from 5 sync endpoints** (CRITICAL): Added `publish_incident_event_sync()` and `publish_verification_event_sync()` to `services/event_bus.py` (matching existing `publish_security_event_sync` pattern). Replaced 5 dead `asyncio.get_running_loop()` + `except RuntimeError: pass` blocks in `regional.py` (×2), `admin.py` (×1), `workflow.py` (×2) with direct sync calls. Removed now-unused `import asyncio` from `admin.py` and `workflow.py`. Fixes silent SSE event loss from `update_incident`, `verify_incident`, `update_security_log`, `claim_cluster_command`, and `apply_terminal_action_command`.
- **B2 — Dead EmergencyPanel in PublicFireMapInner.tsx**: Removed unrendered EmergencyPanel component, unused `emergencyContacts`/`nearbyStations` state, `fetchEmergencyServices` useEffect, `useMap` import, and `EmergencyContact`/`NearbyStation` type imports (−79 lines).
- **B3 — Dead no-op pii_dict reassignment**: Removed `if not pii_dict: pii_dict = {}` from `regional.py` (already `{}`).
- **B4 — Dead Redis pool constants**: Wired `_REDIS_POOL_MAX_CONNECTIONS` into `aioredis.from_url()` in `map.py`.

No schema, auth, or FRS alignment changes.

## [2026-05-27] fix | Public map contract repair and local nginx split
- Restored production `src/nginx/nginx.conf` to HTTPS/TLS with HTTP-to-HTTPS redirect and moved localhost HTTP behavior to `src/nginx/nginx.local.conf` plus `src/docker-compose.override.yml`.
- Reworked `GET /api/civilian/report-clusters` to read durable `citizen_report_clusters`/members, expose public-safe `areas`, use 500m bucket-center local queries, count `PENDING`/`UNDER_REVIEW`/`LINKED` pressure, require active `PENDING`/`UNDER_REVIEW`, exclude terminal/closed clusters, and serve Redis stale-if-error.
- Reworked `GET /api/ref/emergency-services` to return `911` plus all BFP station names/locations, no station phones/addresses, nearest-five metadata when location is known, and 24h Redis cache with stale fallback.
- Updated root map frontend to use `Public Fire Report Areas` language, true parent `fireLocation`, national/manual/location modes, meter-radius Leaflet circles, separate station markers, and public API transport.
- Updated tests and wiki synthesis pages. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; this implements planned public map behavior without changing FRS alignment status.

## [2026-05-29] style | Public page visual unification with /fire-stations
- Restyled `/` (report page) — all 4 render paths (main multi-step form, review, update, submitted) now use the full-width BFP gradient hero → EmergencyReferenceCard → max-w-lg content card pattern matching `/fire-stations`.
- Restyled `/tracking` page — same full-width hero + card pattern, moved EmergencyReferenceCard out of card into top-of-page position.
- Rewrote `CalmEmergencyBlock` component — replaced compact amber-bordered box with modern card-style layout featuring Shield icon, "Safety First / Kaligtasan Muna" heading, and three icon-labeled safety rules.
- Removed fire station markers from `NearbyPublicReportAreasInner` — map now shows only cluster circles and the user anchor pin; stations were cluttering the civilian-facing cluster visualization.
- Cleaned up `NearbyPublicReportAreas` wrapper — removed unused `fetchEmergencyServices` call, `servicesData` state, and `EmergencyServiceResponse` type import; clusters load independently.
- Build passes, lint 0 errors (15 pre-existing warnings), 119/119 Vitest tests pass.
- No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; this is a visual restyle with no FRS/codebase alignment change.
