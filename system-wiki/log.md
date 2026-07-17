## [2026-07-18] feat(tracking): public-surface capability receipt (#657)

- **Scope:** The capability-token tracking page now uses the shared public-surface receipt layout that `LayoutShell` already supplies for `/tracking` routes; it does not add a page-local `PublicThemeProvider`. The receipt presents the secure token with copy control and QR code, then preserves the existing route workspace, text-only no-geometry fallback, timeline, and emergency guidance.
- **Privacy:** The QR code encodes the already-issued capability URL only. No report/station coordinates, PII, or actor identities are added to the public projection.
- **Tests:** Tracking page tests cover null/malformed geometry, map rendering, QR/token receipt controls, timeline metadata, errors, and clipboard fallback (7/7 passed). Lint reported 0 errors and 36 pre-existing warnings.
- **Wiki:** Updated [[frontend/route-map]] and [[index]]. No FRS/code gap changed.

## [2026-07-18] feat(profile): civilian public-surface profile (#656)

- **Scope:** `/profile` now enters `PublicThemeProvider` only for authenticated `CIVILIAN_REPORTER` sessions. The existing shared route retains its sidebar/header staff shell for Regional Encoder, National Validator, National Analyst, and System Administrator sessions; no API, authorization, or profile-update contract changed.
- **Presentation:** The civilian route reuses existing public-surface tokens for its account cards and forms, adds a decorative initial avatar, and exposes the existing `logout` action as Sign out. The shared public header supplies the persisted `landing-theme` toggle.
- **Tests:** `LayoutShell.test.tsx` covers the role-aware shell split; profile tests cover civilian shell markup and sign-out while retaining profile update coverage (30/30 targeted tests passed). `npm run lint` reported 0 errors and 36 pre-existing warnings.
- **Wiki:** Updated [[frontend/route-map]] and [[index]]. No FRS/code gap changed.

## [2026-07-17] feat(auth-ui): session-aware public navigation and Keycloak parity

- **Navigation:** `PublicHeader` now consumes the existing `AuthContext` session state across `/`, `/information`, and the shared public shell. Anonymous users receive Home, Information, Fire Stations, Register, and Sign In only; authenticated users receive their role dashboard, avatar, and Report a Fire action.
- **Login/SSO:** `/login` has no application navbar/footer and adds a return-to-WIMS control. The Keycloak `wims-bfp` theme mirrors the formal split-panel tokens, exposes the same return control, and reads `landing-theme` from same-origin local storage without changing OIDC, cookie, or offline-session behavior.
- **Tests:** Targeted Vitest coverage verifies anonymous/authenticated navigation, root composition, `/information` shell composition, login chrome removal/return control, and the Keycloak theme contract (83/83 passed).
- **Gaps:** No FRS/codebase gap changed; this is presentation and navigation behavior over the existing authentication contract. See [[frontend/route-map]] and [[security/security-baseline]].

## [2026-07-17] feat(tracking): public status timeline and light route workspace (#638)

- **Scope:** The capability-token tracking endpoint now returns an ordered `status_updates` projection alongside its existing route/station summary. `services/civilian_triage/status_update.py::get_public_status_updates` explicitly allowlists only citizen-facing metadata by lifecycle stage; validator identities and arbitrary JSONB keys remain absent. The tracking-v2 UI uses the shared typed client, displays the timeline in a light map/inspector workspace, renders valid GeoJSON road routes through the existing SSR-safe Leaflet path, and puts the zoom control top-right.
- **Privacy deviation:** #638 requested a straight-line fallback for null geometry, but the capability tracking contract intentionally withholds report and station coordinates. The implementation therefore renders text-only route feedback rather than disclose those endpoints or fabricate a line. This also satisfies the issue's null-geometry text-only test acceptance.
- **Public-surface fold:** The current public changes are included: first-time public theme is light (saved preferences remain honored), landing overlays/maps consume the shared theme, report Location cannot advance without coordinates or a landmark, and public-shell/header/auth presentation refinements remain in the same worktree.
- **Tests:** Tracking page tests cover valid route rendering, null geometry text fallback, and Help Dispatched / On Scene / Resolved metadata. Backend unit privacy tests pass; the Postgres/Redis integration suite requires the Compose network and could not run locally (`postgres` hostname unavailable). Frontend targeted tests passed (79/79), lint reported 0 errors, and the production build passed.
- **Wiki:** Updated [[frontend/route-map]], [[backend/api-route-map]], and [[subsystems/civilian-reporting-phase2]]. No FRS/code gap changed.

## [2026-07-16] fix(public-landing): seven accessibility and UX refinements

- **Scope:** `app/page.tsx`, `components/LandingSidebar.tsx`, `components/IntentModal.tsx`, plus their tests.
- **1. One mobile emergency CTA:** Removed the duplicate Report a Fire FAB; the header "Report a Fire" link remains visible on all viewports. Desktop Register/Sign In behavior unchanged.
- **2. Intent modal clarity:** Added descriptive hint text explaining what each choice does. Renamed "Browse" → "View Active Fires" for explicit user-facing labeling. Added `role="dialog"`, `aria-modal`, `aria-labelledby`/`aria-describedby`, and initial focus on the Report a Fire button.
- **3. Accessible mobile sidebar:** Sidebar now uses `role="dialog"` with `aria-modal="true"` when open. Escape key closes it. Focus moves to the close button on open and restores to the launcher on close. Desktop sidebar is unchanged.
- **4. Tabler icons:** Replaced all emoji controls (📋, 🔥, 📍, ✕, 🚒) with `@tabler/icons-react` equivalents (`IconLayoutSidebar`, `IconFlameFilled`, `IconMapPin`, `IconX`, `IconFiretruck`, `IconClipboardList`) with `aria-hidden` and preserved accessible text labels.
- **5. Focus-visible states:** Added high-contrast `:focus-visible` outlines (`2px solid #3b82f6` / `#fbbf24` for emergency actions) on all interactive landing controls.
- **6. Map trust panel:** Compact non-blocking overlay near map controls explaining "Verified BFP incidents · colour shows severity · refresh every minute", matching the `POLL_INTERVAL_MS` in `PublicFireMapInner.tsx`.
- **7. Actionable empty/error states:** Empty sidebar now shows links to `/fire-stations` and `/report`. Error state includes a keyboard-accessible Retry button that re-fetches from the same `publicApiFetch` path.
- **Tests:** landing.test.tsx (16 tests), IntentModal.test.tsx (12 tests) — all pass. Full suite: 137 files, 1485 tests passed. `npm run lint`: 0 errors, 36 warnings (all in untouched files). `npm run build`: passes.
- **Wiki:** No route map changes — the landing page route structure is unchanged. Log entry only.

- **Scope:** `app/tracking/v2/[report_id]/[tracking_token]/page.tsx` (the real token-gated tracking page — `app/tracking/page.tsx` is a legacy compatibility redirect shim, untouched) still used the pre-#609 light theme (`var(--content-bg)`, `var(--bfp-gradient)`, `var(--bfp-maroon)`) and rendered its own gradient hero, which now visually doubled with the shared `PublicHeader` (#609) already rendered above it via `LayoutShell` for `/tracking`-prefixed routes (`routeUtils.ts` `PUBLIC_ROUTE_PREFIXES`). Its local `TrackingData` type also didn't expose `routing_geometry`, even though the backend (`schemas/civilian.py` `CivilianTrackingResponse.routing_geometry`) and the actual route already returned it — the page rendered `routing_distance_m`/`routing_duration_s` as plain text only, no map.
- **Fix (restyle):** Removed the page's internal gradient hero (kept a compact text-only title, since `PublicHeader` now supplies the single brand block) and re-themed the status card, badges, and body text to the locked black/red/blue dark tokens from `PublicHeader.tsx`/`prototypes/public-surface/index.html` (`#111116` base, `#18181d`/`#202026` elevated surfaces, `#3b82f6` blue chrome, `#dc2626`/`#ef4444` red reserved for emergency accents, plus green/yellow/purple status accents) via a local `T` token object — a value swap, not a structural rewrite; the loading → error → status card → detail sections → footer link tree is unchanged. `EmergencyReferenceCard` gained an additive, backward-compatible `dark?: boolean` prop (default `false`) so the legacy `/tracking` shim keeps its current light look while this page opts in.
- **Fix (route geometry):** Added `src/components/map/RoutePolyline.tsx` — a new, reusable, tracking-agnostic react-leaflet component (`parseLineStringToLatLng` + `<RoutePolyline geometry={...} />`) that converts a GeoJSON `LineString` (`ST_AsGeoJSON()` shape, `[lng, lat]` pairs) into the `[lat, lng]` tuples `<Polyline positions={...}>` expects, rendering `null` on missing/malformed geometry. Built specifically so **#616 (fire-stations) can import it instead of re-implementing GeoJSON→Leaflet parsing** — it has no knowledge of incidents, tokens, or stations. Wired into tracking-v2 via new `TrackingRouteMap`/`TrackingRouteMapInner` (the standard `next/dynamic({ ssr: false })` wrapper pattern used by `NearbyStationsMap.tsx`/`PublicFireMap.tsx`), rendered only when `routing_geometry` is present, alongside the existing (unremoved) `formatDistance`/`formatTravelTime` text summary.
- **Tests:** New `components/map/__tests__/RoutePolyline.test.tsx` (11 tests: valid parse, null/undefined, wrong `type`, too few points, non-numeric/malformed coordinates, render vs. no-render). New `app/tracking/v2/[report_id]/[tracking_token]/page.test.tsx` (4 tests: dark status card renders without crashing when `routing_geometry` is null, route map renders when present, exactly one page-title block — no duplicate hero, 404 error state). Full suite: `npx vitest run` — 137 files / 1447 tests passed. `npm run lint` — 0 errors (36 pre-existing warnings, none in touched files). Full (unfiltered) `npx tsc --noEmit` — 111 pre-existing errors confirmed identical before/after this change via `git stash`; zero errors in any new/modified file (no duplicate-export risk per the #613 `fetchStations` postmortem, since `RoutePolyline`/`TrackingRouteMap*` are new files, not additions to a shared module another slice owns).
- **Security fold (#552):** Frontend-only change; consumes the already-controlled `OSRM_BASE_URL`-derived `routing_geometry` field read-only. No incident coordinates are logged — the map renders client-side from the API response only.

## [2026-07-15] fix(security): stop unmitigated public OSRM dependency, make routing configurable + fail-safe (#552)

- **Scope:** `services/routing.py` read `OSRM_BASE_URL` from env but defaulted to the public `https://router.project-osrm.org` instance when unset — every civilian report's coordinates were sent to an uncontrolled third party for nearest-station routing, with no way to disable it short of code changes. The `_try_osrm()` failure path also logged the raw exception (`logger.warning("OSRM lookup failed: %s", exc)`), which can embed the request URL — and therefore the report's lat/lon — since httpx exceptions frequently stringify the failing request.
- **Fix:** `OSRM_BASE_URL` no longer has a public-instance default (`os.environ.get("OSRM_BASE_URL", "").strip()`). When unset/empty, `_try_osrm()` skips the external call entirely and `compute_routing()` degrades straight to the existing PostGIS straight-line × 1.5 sinuosity estimate — the same fallback callers already handle today, since `compute_routing()` never returned `None` even before this change. Setting `OSRM_BASE_URL` to a self-hosted instance is a pure env-var change with no code changes required — this ships the code half of #552; standing up the self-hosted OSRM service is a follow-on ops task.
- **Log leak fix:** the failure log now emits `type(exc).__name__` and the configured OSRM host, never the exception's string form or the request URL/coordinates. A new `logger.info` line observably announces when routing is skipped because no OSRM host is configured (previously silent).
- **Callers unaffected:** confirmed both call sites (`tasks/routing.py::compute_routing_task`, fire-and-forget `civilian.py:721` Celery enqueue) already tolerate the fallback estimate — neither hard-requires an OSRM-sourced route — so no caller-side changes were needed.
- **Config:** `.env.example` documents `OSRM_BASE_URL` as commented-out/unset by default with an explicit warning against pointing it at the public instance in production.
- **Tests:** new `tests/test_routing.py` (6 tests) — unset/empty `OSRM_BASE_URL` skips the HTTP client entirely (assert `AsyncClient` never constructed) and falls back correctly; a configured URL is used verbatim (asserts the public host string never appears); failure and skip-notice logs are asserted to never contain the test's lat/lon values or the request path.
- **Scope-out note:** soft file-level overlap with open PR #598 (device-token abuse controls) — both touch `api/routes/civilian.py`, but in different regions (device-token/CAPTCHA gating vs. this fix's read-only confirmation that the routing enqueue site needed no changes). Whichever merges second rebases.
- **Validation:** `ruff check .` clean repo-wide; `ruff format --check` clean; `pytest tests/test_routing.py -v` 6/6 passed. Broader `test_civilian_api.py`/`test_public_submission.py` runs in this environment fail on pre-existing local infra gaps (no Docker Postgres/Redis reachable — `could not translate host name "postgres"`, `rate limiter unreachable`), unrelated to this change.

## [2026-07-15] fix(observability): stop audit-log flood from idle expiry beat + add sweep metrics

- **Scope:** `tasks.expire_content.expire_published_content` (Celery beat, every 300s) archived expired PUBLISHED `community_content` rows and emitted a `CMS_EXPIRY_SYSTEM` audit row on **every** run, including no-op runs (`archived_count: 0`). With no community content yet, this flooded `wims.system_audit_trails` with an empty audit row every 5 minutes.
- **Fix (audit hygiene):** the `CMS_EXPIRY_SYSTEM` audit is now gated on `if count:` — no-op runs write no audit row. The audit trail (immutable forensic record) is no longer polluted by idle sweeps; the run stays observable via the existing `logger.info` line.
- **Observability (Redis mirror):** added 3 Prometheus counters mirrored at `/metrics` — `community_content_expiry_archived_total`, `community_content_expiry_skipped_total`, `community_content_expiry_last_success_timestamp_seconds`. Because the celery worker and the API process have separate Prometheus registries and no pushgateway, the worker writes cumulative values to Redis (`metrics:community_content_expiry:*`) and `main.py`'s `metrics_endpoint` mirrors them at scrape time, both fail-open. Metrics emit **after** a successful `db.commit()` so a rolled-back run increments nothing (keeps the dead-man-switch `last_success_ts` truthful). A monitor can now alert on "ran but 0 rows for N consecutive runs".
- **Beat-singleton guard (docs):** `docker-compose.yml` celery-worker command and `src/AGENTS.md` now document that the embedded `--beat` is a de-facto singleton; scaling `celery-worker` replicas (or running multiple instances) without moving `--beat` to a dedicated single-instance service / adding leader election would spawn duplicate schedulers and double-fire periodic tasks. Task idempotency is a safety net, not a license to duplicate schedulers.
- **Tests:** `tests/test_expire_content.py` — kept the existing archive/commit test, added a no-op-audit test (`audits == []`), and a Redis-emission test asserting `archived_total`/`skipped_total`/`last_success_ts` for both count>0 and count==0. `ruff` clean; `pytest` 3/3; `docker compose config --quiet` OK.
- **Wiki:** `backend/api-route-map.md` (Slice F line) and `security/security-baseline.md` updated for the audit-on-archive-only behavior and the Redis-mirrored metrics; this entry appended.
- **Validation:** `cd src/backend && ruff check . && ruff format --check . && python -m pytest tests/test_expire_content.py -q` (3 passed); `cd src && docker compose config --quiet` (COMPOSE_OK).

## [2026-07-13] feat(agents): add WIMS Wayfinder decision-mapping workflow

- **Scope:** Added the manual-only `.pi/skills/wims-wayfinder/` profile over the user-global Wayfinder method, with GitHub-native child/dependency operations, batch-confirmed chart creation, append-only ticket claims, serialized conflict-checked map updates, and one non-research decision per session.
- **Prototype and handoff:** Prototype tickets optionally reuse the user-local keyed brainstorming server with loopback/synthetic-data defaults; decision tickets remain separate from `ready-for-agent` implementation issues, which require a later confirmed creation batch.
- **Documentation:** Updated `.pi/README.md`, `.pi/skills/wims-route/`, `docs/agents/issue-tracker.md`, [[operations/agent-routing-guide]], and the wiki index. No FRS/codebase gap changed.
- **Validation:** Parsed both changed eval JSON files, verified referenced paths and current GitHub CLI parent/dependency fields, and ran scoped diff checks; no application tests were required for agent-workflow documentation.

## [2026-07-12] fix(security): stop exposing admin-created users' passwords, rely on Keycloak's set-password link (#526)

- **Scope:** `POST /api/admin/users` (`api/routes/admin/users.py`) unconditionally returned `temporary_password` plus a misleading `note` claiming credentials were emailed — the admin UI (`admin/system/page.tsx`) always rendered it in a reveal/copy modal. Keycloak already sends a secure one-time set-password link on user creation (`create_keycloak_user` → `send_update_account`, `UPDATE_PASSWORD` required action, 7-day lifespan), but that send's success/failure was swallowed to a log line with no signal returned to the caller — the route had no way to know if the email actually went out, which is why it always fell back to exposing the password.
- **Fix:** `services/keycloak_admin.py::create_keycloak_user` now returns `(keycloak_id, email_sent)` via a new shared `_send_update_account_email()` helper (still non-fatal — email failure never fails user creation). The `create_user` route response drops the password entirely: `{ status, keycloak_id, username, role, email, email_sent }`. New `POST /api/admin/users/{keycloak_id}/resend-credentials` (admin-gated, reuses the same helper via `resend_update_account_email()`) lets an admin retry the Keycloak email if the initial send failed — no plaintext-password fallback anywhere.
- **Frontend:** `admin/system/page.tsx` — removed `temporary_password`/`showTempPassword`/`copySuccess`/`handleCopyPassword` and the reveal/copy modal entirely. On success it shows either an "emailed to `<email>`" confirmation or, on `email_sent: false`, a "Resend set-password email" action. `lib/api/legacy.ts::createAdminUser()` response type updated; new `resendAdminUserCredentials()` client added.
- **Tests:** `tests/test_keycloak_admin.py` updated for the new tuple return (existing 8 tests still green, plus explicit `email_sent` assertions on the success/failure paths). New `tests/test_admin_user_credentials.py` (6 tests) asserts the create-user response never contains `temporary_password`/`note`, does contain `email_sent` (both `True`/`False` paths), and the resend endpoint is admin-gated and returns `email_sent`. No existing frontend test asserted the old password modal, so none broke; `admin-system-governance.test.tsx` (17 tests) still passes unmodified.
- **Scope-out note:** the stale remote branch `fix/admin-onboarding-rls-and-schema` (86+ commits behind master, pre-dates the `admin.py` → `admin/` package split) touches an unrelated part of `keycloak_admin.py` (the `_get_admin_client()` auth-connection mechanism) — no overlap with this fix, not merged.

## [2026-07-11] fix(security): scope validator audit-log queries to the calling actor (RP-25, #525)

- **Scope:** `build_audit_log_query()` (`services/regional_incidents/helpers.py`) had no forced current-actor scope — `actor_username` was an optional free-text ILIKE, so any `NATIONAL_VALIDATOR` leaving it blank saw every user's audit actions via both the list endpoint (`validator.py:get_validator_audit_logs`) and the CSV export (`validator.py:export_validator_audit_logs` — same leak, unfixed by the RP-23 export-audit patch since that only added logging of the export action itself, not scoping of its contents).
- **Fix:** Added a required `actor_user_id` param that forces `ivh.action_by_user_id = CAST(:actor_user_id AS uuid)` into the WHERE clause — not bypassable by omitting any optional filter. Mirrors the proven `encoder.py:559-564` self-scope pattern. `actor_username` remains valid only as additional narrowing on top of the forced scope, never a substitute for it.
- **NATIONAL_ANALYST gap:** The issue implied an analyst audit endpoint should exist; none did. Added `GET /api/analytics/audit-logs` (`get_national_analyst` dependency in `auth.py`) as a self-scoped own-actions view, mirroring the encoder/validator pattern rather than a broader oversight view — kept single-role so `SYSTEM_ADMIN` doesn't pick up a redundant view on top of the existing unfiltered `/api/admin/audit-logs`.
- **Tests:** New `tests/test_validator_audit_log_query.py` — asserts `actor_user_id` can't be omitted (`TypeError`), both the list and CSV export queries always include the actor scope, and `actor_username` narrows but cannot widen past the caller's own rows (regression test for the exact leak).
- **Frontend:** `dashboard/validator/audit/page.test.tsx` mocks the offline-aware fetch wrapper entirely — unaffected by the smaller scoped result set, no changes needed.
- **Validation:** `pytest` (6/6 new + existing encoder audit query test) and `ruff check` both pass.
## [2026-07-12] fix(ux): triage Investigation Board — table instead of cards (#521)

- **Scope:** `TriageInvestigationBoard.tsx`'s selected-item evidence list (`selectedItem.reports.map(...)`,
  previously `TriageEvidenceCard` per report) is now a 15-column table matching the issue's exact spec:
  Report ID, Category/Sub, Context, Safety Status, Location, Trust Score, Signals Found, Missing Signals,
  GPS Mismatch, Dup Device Count, Station, Distance, Status, Reported At, Aging/Timeout. Pure frontend
  change — the `/api/triage/queue` response already carried every field the table needed; no backend/type
  changes.
- **Reuse, not reinvention:** extracted `hasLifeSafetySignal()`/`statusTone()` out of `TriageEvidenceCard.tsx`
  into `triageGeometry.ts` (single source of truth, now shared by the card and the new table rows) rather
  than duplicating the severity/trust-tone thresholds. Trust-score coloring reuses `src/lib/trustColors.ts`
  unchanged; terminal-status styling reuses `isTerminalStatus()` from `useTriageModalState.ts`; the
  "Reported At" column reuses `formatIncidentDate()` from `lib/incident-utils.ts` (previously only used by
  the Encoder/Validator dashboards).
- **Parity preserved:** row click still only calls `onSelectReport(report_id)` (selection, no navigation);
  selected row gets `aria-selected` + a red ring (was the card's ring/border); life-safety badge and
  no-usable-location text preserved; `data-testid` pattern changed `triage-evidence-card-{id}` →
  `triage-evidence-row-{id}`.
- **Untouched, per issue scope:** the "Ranked queue" sidebar (still the pre-existing button-list, not
  converted), the "Inspect / Act" modal flow, `TriageActionTabs.tsx`, the parent page's fetch/poll/filter
  logic, and all backend routes.
- **Dead code not reproduced:** `TriageEvidenceCard`'s `suggested` prop and `onStartCorrection`/"Correct
  terminal status" button were never passed at the board's call site (confirmed via full-codebase grep) —
  not carried into the table; real correction lives in the separate Inspect/Act modal.
- **Sequencing:** open PR #533 (`feat/auto-refresh-sse-518`) also edits the parent `triage/page.tsx` (SSE
  hook + toast) but does not touch `TriageInvestigationBoard.tsx`/`TriageEvidenceCard.tsx` — no component
  conflict; whichever PR merges second does a trivial rebase.
- **Tests:** `TriageInvestigationBoard.test.tsx` updated (row testid, same visible-text assertions) plus
  2 new tests (comma-separated signals + trust-tone class; row click calls `onSelectReport`) — 3/3 passing.
  `triageGeometry.test.ts` (4/4) and `TriageCanvasMapInner.test.tsx` (2/2) unaffected.
- **Validation:** ESLint and `tsc --noEmit` clean on all 5 touched files (pre-existing unrelated errors in
  `ClusterMapInner.test.tsx` confirmed present on master too).
## [2026-07-12] feat(backend): enable registered contributor pending photo upload

- **Scope:** Registered `CIVILIAN_REPORTER` requests now use `POST /api/civilian/photos/upload` and the existing encrypted validation/EXIF/hash/storage pipeline to create owner-bound pending rows with NULL report and attachment state. The route accepts no report or device ID, enforces a locked owner-scoped pending cap, client-photo idempotency, append-only pre-upload audit, and artifact cleanup on database failure.
- **Anonymous boundary:** Requests without a registered identity, including requests carrying a validated anonymous capability, return explicit 501 feature-unavailable. A dedicated capability-bound anonymous pending INSERT helper remains the next dependency; no BYPASSRLS, device ownership, or broad helper was introduced.
- **Validation:** Focused civilian/photo tests passed along with Ruff check and format checks; live PostgreSQL RLS/helper execution remains environment-dependent.

## [2026-07-12] feat(backend): wire anonymous capability boundary for pre-upload

- **Scope:** Added `services/anonymous_sessions.py` as the narrow SQL-helper adapter and `auth.get_anonymous_session_id` as an Authorization-header-only dependency returning only a derived session UUID. Issuance is one-time raw-token output; validation/revocation do not persist or log bearer values.
- **Ownership:** Added pending-owner resolution tests for registered versus anonymous sessions and neutral cross-session denial coverage. Added a pending response schema and explicit route TODO; `/api/civilian/photos/upload` remains unregistered because bootstrap/Alembic 0008 denies anonymous pending INSERT and no BYPASSRLS/caller GUC workaround is safe.
- **Validation:** Targeted capability/auth tests and backend Ruff checks are the intended gates; live PostgreSQL RLS/helper execution remains an environment-dependent residual risk.

## [2026-07-12] fix(database): bind anonymous report ownership for photo attach

- **Scope:** Corrected Alembic `0009` and clean-bootstrap `88` so `wims.citizen_reports.anonymous_session_id` has the requested anonymous-session FK, partial index, and NULL-preserving ownership comment before the attach helper runs.
- **Service residual:** The report submission service must set this column from the validated session before calling `attach_anonymous_photos`; RLS policies remain unchanged.
- **Validation:** Updated the 0009 static contract and passed focused pytest plus backend Ruff check/format gates.

## [2026-07-12] feat(database): harden anonymous pre-upload ownership contract

- **Scope:** Added Alembic `0009` and clean-bootstrap `88` with hash-only high-entropy anonymous session issuance, token format validation, idle/absolute expiry, bearer revocation, and removal of direct application session-table DML.
- **Photo ownership:** Added the `report_photos.anonymous_session_id` FK/index and a three-branch owner constraint that preserves legacy `uploader_device_id` attached rows while making device IDs analytics-only for new session-bound rows.
- **Helpers:** Added fixed-search-path `SECURITY DEFINER` issuance, validation, revocation, pending-photo authorization, and locked all-or-nothing same-session attach helpers. Report creation and append-only audit remain application-service responsibilities; upload route/UI work is out of scope.
- **Validation:** Added static migration/bootstrap contract tests for token format, expiry/revocation, no PUBLIC execute, fixed search paths, FK/index, no permissive pending RLS or BYPASSRLS, and row-lock intent. Targeted pytest and Ruff checks passed; live disposable PostgreSQL execution remains to be run in Compose CI.

## [2026-07-10] docs(agents): rebuild scoped agent instruction hierarchy

- **Scope:** Rewrote the six existing first-party `AGENTS.md` files and added `.pi/AGENTS.md` plus `src/AGENTS.md`, yielding eight maintained instruction scopes. The root now owns durable evidence/security rules; nested files own Pi, source/infrastructure, backend, frontend, docs, and wiki procedures.
- **Corrections:** Removed volatile SQL/service/test counts and stale RLS dependency-order guidance; distinguished target architecture from legacy exceptions; made `.github/workflows/ci.yml` the merge-gate source; documented Alembic versus clean bootstrap, effective pytest ignores, and `make ci-local` as a smoke target. Final-schema review also found that migration 72 drops the audit immutability rules created by migration 17.
- **Pi resources:** Documented trust and executable-extension risk, aligned the Pi README/prompts/routing skill/eval, corrected the `master` handoff base, and unignored maintained `.pi` source while retaining cache/session ignores.
- **Wiki:** Added `architecture/agent-instruction-hierarchy.md`; corrected the database schema, security baseline, ASVS overrides, and PWA/CI pages; updated the index to 52 verified link targets; and opened the FRS Module 4 audit-log append-only enforcement gap with exact raw-FRS/migration evidence.
- **Validation:** `python -m json.tool` passed for `.pi/settings.json` and the WIMS-route evals; `git diff --check` passed; the index contains 52 unique wiki links with 0 missing targets. No application test suite was run because the change is documentation/instruction configuration only.

## [2026-07-12] feat(database): prepare civilian photos for owner-bound pre-upload

- **Scope:** Added Alembic `0008` and clean-bootstrap `87` to make `wims.report_photos.report_id` nullable for pending rows, add `attached_at`, backfill legacy attached rows, enforce pending/attached consistency, and add a pending-owner index. Existing encrypted columns, uploader XOR ownership, report FK, RLS, and FORCE RLS are preserved.
- **RLS boundary:** Registered contributors can access only their own pending rows; attached-row staff behavior is unchanged. Anonymous pending access remains blocked pending a safe transaction-local device/capability context; no broad `TRUE` policy or BYPASSRLS session was added. Upload services/routes/UI remain out of scope.
- **Validation:** Added static migration/bootstrap contract tests covering revision lineage, parity, idempotency markers, constraints, FK/XOR preservation, FORCE RLS, owner scoping, and the documented anonymous-context blocker.

## [2026-07-12] fix(database): align civilian trust-score snapshot cleanup

- **Scope:** Added Alembic `0007` after verified head `0006` to add non-null `formula_version` (`reliability-v1`) and remove the retired leaderboard opt-in column; added clean-volume `86_civilian_contributor_snapshot.sql`.
- **Bootstrap parity:** Verified files 80–85 did not create `wims.civilian_contributors`; migration 86 now carries the canonical final table, unchanged RLS policies/grants, and the existing photo bonus helper so direct clean bootstrap and Alembic upgrades converge.
- **Validation:** Added static migration/bootstrap contract tests; targeted Ruff and pytest checks run for the new files. No gap-register update was required.

## [2026-07-10] feat(civilian): photo capture enhancement v5 — camera, EXIF, compression, offline queue

- **Scope:** Four-phase civilian photo enhancement: (A) camera/gallery toggle with `capture="environment"`; (E) client-side EXIF extraction with `exifr` before compression; (B) OffscreenCanvas compression with megapixel gate and quality iteration; (D) offline photo queue with AES-256-GCM encryption, IndexedDB v7 upgrade, atomic idempotency via `INSERT ... ON CONFLICT DO NOTHING RETURNING`.
- **Migrations:** 83 (EXIF metadata columns + provenance on `report_photos`), 84 (`client_photo_id` UUID + partial unique index), 85 (`client_report_id` UUID + partial unique index). Startup path and Alembic revision 0003 added.
- **Idempotency:** Client-supplied `client_photo_id` and `client_report_id` UUIDs provide 122-bit entropy for safe retries. `client_report_id` parsed before rate-limit check to avoid quota burn on retry. Photo cap checked after idempotent INSERT.
- **Offline:** Photos selectable while offline (camera/gallery always enabled). `syncPublicOfflineOps` calls `storePhotoLink`/`updatePhotoReportLink` after submit success. `syncPendingPhotos` skips null-linked photos.
- **Fix PR:** [#544](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/pull/544) — 28 files, +2834/-227.

## [2026-07-11] design: align civilian contributor Phase 5 Community Safety Hub spec

- **Follow-up:** Replaced the saturating fixed-point trust formula with a normalized reliability model: outcome accuracy 45%, logarithmic root-report volume 20%, normalized evidence quality 20%, rolling six-month active-month consistency 15%, and bounded inactivity decay. Append operations are excluded from volume and consistency. Added performance validation at approximately 10,000 contributors and 100,000 reports before introducing Redis or materialized-view caching.


- **Scope:** Updated `docs/superpowers/specs/2026-07-06-civilian-contributor-enhancement-design.md` after product-voice review and design brainstorming.
- **Decisions:** Retained `/` as anonymous emergency reporting; defined public `/community`, private `/contributor`, safety-first CMS content, admin preview/versioning/rollback, bilingual publishing rules, expiry, urgent banner, list-first station directory with optional map, and dedicated announcement/event routes.
- **Removed:** Public leaderboard and related endpoint/implementation scope; replaced with private self-tracking.
- **Status:** Proposal only; no application routes, CMS, or database changes were implemented.
- **Blocker resolution:** Added explicit tracking capability security, invalid-JWT handling, CMS schema/versioning constraints, synchronous expiry filtering, safe content rendering, canonical outcome statuses, encrypted photo metadata, narrow RLS exception requirements, and Phase 4 prerequisite cleanup.
- **Photo ownership refinement:** Anonymous pre-upload is now grounded on a hash-backed, expiring `anonymous_session_id` capability with narrowly scoped fixed-search-path helpers, all-or-nothing attach, explicit cleanup/audit behavior, and no client-device-ID authorization.

## [2026-07-11] fix: repair migration 0004 — civilian contributor schema alignment + add 0005 fixup

- **Scope:** Fixed 3 BLOCKER issues in the initial 0004 migration for civilian
  contributor schema: (1) `report_tracking_tokens` table now uses BIGSERIAL PK
  with `token_type`, `is_active`, `revoked_at`, `regenerated_from_id` columns
  matching postgres-init SQL 80; (2) added missing `validate_tracking_token`
  SECURITY DEFINER function; (3) added missing GRANT on `anonymous_sessions` to
  `wims_app`. Corrected RLS policy drift on `tracking_tokens_select`/`update` to
  match canonical definitions. Scoped sequence grant from ALL SEQUENCES to just
  `report_tracking_tokens_tracking_token_id_seq`. Added 3-attempt retry loop in
  entrypoint for migration failures.
- **Migration 0005:** New fixup migration for databases (like VPS) that already
  ran the buggy 0004. Applies ALTER corrections (missing columns, constraint
  fixes, index replacement, RLS policies, function) that are no-ops on the
  corrected 0004 schema, converging both paths to the same final state.
- **Tests:** Added `test_0004_civilian_contributor_schema.py` with 20+ contract
  tests covering table columns, RLS policies, function, and grants.
- **Synthesis:** PR-level review by 5 voice agents (architect, security, qa,
  devops, product) plus reviewer subagent, all blockers resolved.

## [2026-07-10] feat(civilian): complete Phase 2 photo-pipeline handoff validation

- **Scope:** Fixed `PhotoUpload` preview lifecycle: removed the effect-driven preview state that triggered `react-hooks/set-state-in-effect`, corrected the undefined preview guard, and assigns the object URL to the preview image from the file-change effect while revoking it on replacement/unmount.
- **Documentation:** Updated the civilian subsystem, backend route map, database schema overview, security baseline, frontend route map, and index with the `wims.report_photos` table, RLS boundary, encrypted artifact model, post-submit endpoint, and Celery reconciliation task.
- **Validation:** Focused civilian photo/page/API tests — 50/50 passed; full frontend Vitest — 1163/1163 passed across 103 files; frontend lint — 0 errors and 37 warnings; production build succeeded with existing Next metadata/workspace warnings.
- **Environment limitation:** Full backend pytest was not run to completion locally because integration fixtures require the Compose PostgreSQL/Redis service names; the run encountered `postgres` DNS failures and was aborted. Run the backend gate in PR/Compose CI as requested.

## [2026-07-09] feat(infra): nginx bad-bot blocker at edge (issue #517)

- **Scope:** Add vendored nginx-ultimate-bad-bot-blocker rules to nginx-gateway
  to block known bad bots, scanners, and referrer spam at the edge, reducing
  Suricata alert noise from background internet background radiation.
- **Plan:** Approach A from handoff — vendor minimal generated upstream files
  under `src/nginx/bot-blocker/` and mount as a compose volume.
- **New files:**
  - `src/nginx/bot-blocker/conf.d/globalblacklist.conf` — upstream generated
    map/geo blocklists (696 bad UAs, 7113 bad referrers, bad IPs) + bot-prefixed
    rate-limit zones (~541 KB, MIT license, version V4.2026.07.6037)
  - `src/nginx/bot-blocker/conf.d/wims-botblocker-settings.conf` — defines the
    `flood` zone required by upstream ddos.conf (not defined by WIMS or upstream)
  - `src/nginx/bot-blocker/bots.d/` — 8 support files (blockbots, ddos,
    blacklist-user-agents, blacklist-ips, bad-referrer-words, custom-bad-referrers,
    whitelist-ips, whitelist-domains) + LICENSE, README.md
  - `src/backend/tests/test_nginx_bot_blocker.py` — 10 contract tests
- **Files modified:**
  - `src/nginx/nginx.conf` — http-scope globalblacklist + wims-botblocker-settings
    includes; server-scope blockbots + ddos includes in localhost and HTTPS server blocks
  - `src/nginx/nginx.local.conf` — same pattern in HTTP and TLS server blocks
  - `src/nginx/nginx.ci.conf` — same pattern in single CI server block
  - `src/docker-compose.yml` — mount `./nginx/bot-blocker:/etc/nginx/bot-blocker:ro`
    into nginx-gateway (inherited by all compose variants)
- **Zone collision analysis:** Upstream defines bot-prefixed zones (`bot2_*`,
  `bot4_*`) — no collision with WIMS zones. Variables like `$bad_bot`,
  `$bad_referer`, `$bad_words`, `$validate_client`, `$ratelimited` are not
  used by WIMS. The `addr` zone exists in WIMS and is referenced by ddos.conf
  (compatible). The `flood` zone is defined in wims-botblocker-settings.conf.
- **Validation:** `cd src/backend && pytest tests/test_nginx_bot_blocker.py` —
  10/10 passed. `tests/test_nginx_forwarded_headers.py` — 12/12 passed.
- **Pre-existing failures (unrelated):** 2 tests in test_infra_config.py
  (keycloak image version mismatch, local config TLS carve-out).
- **Review:** Subagent-driven dev with researcher for upstream file fetch +
  worker for contract test file. Handoff-based plan followed.

## [2026-07-09] fix: pin postgis to PG 15 after PG 17 broke VPS deploy

- **Scope:** Deploy from master (PR #530 merge) failed because `postgis/postgis:17-3.5-alpine` couldn't read the existing PG 15 data volume. Postgres refused to start with "database files are incompatible with server".
- **Fix:** Pinned postgis back to `postgis/postgis:15-3.4-alpine` in:
  - `src/docker-compose.yml` (production)
  - `.github/workflows/deploy.yml` (CI test service)
  - `.github/workflows/ci.yml` (all 4 references)
  - Added inline comments explaining the PG 15 pin to prevent future deps bumps from breaking it
- **Also discovered during debugging:** The `.ssl` symlink used by `docker-compose.override.yml` gets destroyed when Docker Compose recreates the nginx container. This only affected manual debugging (override file), not the production deploy flow which mounts `/etc/letsencrypt` directly via `LETSENCRYPT_DIR=/etc/letsencrypt` in `.env.production`.
- **VPS restore:** Stopped blocking rollup INSERT queries to let schema patches complete in the entrypoint, recreated .ssl symlink, restarted nginx. All 6 deploy checks pass.
- **Other image bumps from chore(deps):** Redis 7→8, OpenBao 2.2→2.5, Suricata 7→8, Ollama 0.5→0.30 — all compatible with existing data.
- **PR #535** opened to master with the PG 15 pin.

## [2026-07-09] fix: add startup handler wrapper entrypoint for VPS lifespan hang

- **Scope:** Fix VPS backend startup hang (uvicorn 0.50.0 / Python 3.12 ASGI lifespan hang — 'Waiting for application startup' never completes). PR #527 deploy failure diagnosis and fix.
- **Root cause:** uvicorn lifespan protocol probe hangs indefinitely when the app has @app.on_event("startup") handlers but no lifespan context manager. Exact trigger after PR #527 merge is unknown (uvicorn version, Python 3.12, or dependency interaction).
- **Files new:** `src/backend/entrypoint.sh` — wrapper that explicitly runs startup handlers before uvicorn, then exec's uvicorn with --lifespan off.
- **Files modified:**
  - `src/backend/Dockerfile` — +ENTRYPOINT, COPY entrypoint.sh, --lifespan off in CMD
  - `src/docker-compose.yml` — --lifespan off in backend command
- **Behavior:** `apply_schema_patches()` and `_resync_blocklist_on_boot()` run in the entrypoint before uvicorn starts. Celery and other commands pass through without running handlers. SKIP_STARTUP_HANDLERS=1 bypasses for debugging.
- **VPS:** Backend Up 17h with --lifespan off, all 6 deploy checks passing. Nginx was temporarily broken during debugging (.ssl symlink lost on container recreate) — restored.
- **Review:** 2 parallel reviewers flagged that --lifespan off silently skips startup handlers. Oracle recommended Option B (wrapper entrypoint) which was implemented and committed.
- **CI:** PR #530 targeting master, 6 checks in progress, MERGEABLE.
- **Commits (chore/update-non-keycloak-docker-images):**
  - e03bfd26 — fix: add startup handler wrapper entrypoint for VPS lifespan hang
  - 733d8050 — fix: add --lifespan off to uvicorn to prevent startup hang
  - c56485a4 — fix: guard auth flow against KC 26 lightweight tokens missing sub claim

## [2026-07-07] fix: await async NPC data load in breach-list tests

- **Scope:** Fix CI failure on PR #530; close duplicate PR #531 (wrong base branch).
- **Files modified:** `src/frontend/src/app/admin/breach/__tests__/breach-list.test.tsx` (5 insertions, 8 deletions).
- **Files added (gotcha):** `docs/agents/gotchas.md` — entry #17: "Target `master`, not `main`".
- **Behavior:** Two breach-list tests used `waitFor` + `getByTestId` on `npc-contact-card`, which renders immediately in the loading state. Replaced with `findByTestId('npc-name-display')` which properly awaits the async NPC data load.
- **PR #531 closed as duplicate** — it was opened against `main` (stale orphan branch) instead of `master`, showing 100 unrelated commits. PR #530 has the same 3 commits targeting `master` cleanly.
- **CI:** All checks pass on PR #530 (Frontend, Backend, Security Audit, Validate Migrations, Docker Build, Security Scan, Merge Gate — all SUCCESS).
- **Gotcha added:** Entry #17 warns about the `main` vs `master` trap.

## [2026-07-03] feat(operations): day reset archive board

- **Scope:** Add validator-controlled Operations Board day reset, one-night carryover, archive viewing, and restore support.
- **Files modified:** `src/postgres-init/79_operations_day_reset.sql`, `src/backend/api/routes/operations.py`, `src/backend/schemas/operations.py`, `src/backend/tests/test_operations.py`, `src/frontend/src/app/home/page.tsx`, `src/frontend/src/components/operations/OperationsConsole.tsx`, `src/frontend/src/lib/api/operations.ts`, `src/frontend/src/lib/api/offlineOperations.ts`, `system-wiki/backend/api-route-map.md`, `system-wiki/frontend/route-map.md`, `system-wiki/database/schema-overview.md`.
- **Behavior:** Active operations can be soft-archived by Reset Day unless a validator marks `keep_overnight`; kept operations clear the flag after one reset. Archived operations are shown on a read-only board and can be restored with an explicit fire status.
- **Validation:** `cd src/backend && ruff format --check . && ruff check .`; `cd src/backend && pytest tests/test_operations.py -q`; `cd src/frontend && npm run lint` (0 errors, pre-existing warnings); `cd src/frontend && npx vitest run src/app/home/__tests__/operations-board.test.tsx`; `cd src/frontend && NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth/realms/bfp NEXT_PUBLIC_BASE_URL=http://localhost NEXT_PUBLIC_MAPBOX_TOKEN= npm run build`.

## [2026-07-03] fix(triage): claimable singleton reports and stale self-claim refresh

- **Scope:** Unblock validator triage actions for isolated civilian reports and for clusters whose current user's claim has gone stale in an open modal.
- **Files modified:** `src/backend/services/civilian_triage/queue_projection.py`, `src/backend/tests/integration/test_triage_queue.py`, `src/frontend/src/components/triage/TriageInspectionModal.tsx`, `src/frontend/src/components/triage/useTriageModalState.ts`.
- **Behavior:** Queue materialization now creates a durable one-member `citizen_report_clusters` workflow record for every active unclustered report, not only spatially related reports. The triage modal now shows a **Refresh claim** action when a cluster is already assigned to the current user, allowing the existing claim endpoint to renew `updated_at` before terminal/split/merge actions.
- **Validation:** Backend ruff format/check passed for changed triage files. Targeted integration tests were updated but could not connect locally because the test DB host `postgres` is not resolvable outside Compose.

## [2026-07-01] feat(ai): staged XAI recommended actions

- **Scope:** Keep the stage-1 IDS/XAI narrative on the low-latency `qwen2.5:1.5b` path, then let system admins generate the recommended action as an explicit stage-2 action after the anomaly/evidence narrative is visible.
- **Files modified:** `src/backend/services/ai_service.py`, `src/backend/api/routes/admin/security.py`, `src/backend/tests/test_ai_service_retry.py`, `src/backend/api/routes/admin/config.py`, `src/frontend/src/lib/api/legacy.ts`, `src/frontend/src/lib/api/admin.ts`, `src/frontend/src/app/admin/system/components/SuricataAlertModal.tsx`, `system-wiki/security/security-baseline.md`.
- **Behavior:** `analyze_threat_log()` is back to `qwen2.5:1.5b`, `num_ctx=1024`, and default `num_predict=256` for the normal first-pass narrative. Stage 1 produces anomaly description, log evidence, risk assessment, confidence, and sources only. A new `POST /api/admin/security-logs/{log_id}/recommended-action` endpoint runs a separate focused Ollama prompt for `recommended_action`, merges it into `xai_narrative`, and exposes `GET /recommended-action-status` so the UI can show persistent loading if the modal is reopened while action generation is still running.
- **Admin config:** Added missing admin allowlist entries for IP blocklist, retention, SIEM retention, and related numeric config keys so those settings can be managed through the system-config API.
- **Validation:** `cd src/backend && pytest -q tests/test_ai_service_retry.py` — 20 passed. VPS A/B testing showed `qwen2.5:1.5b` can generate readable stage-1 narratives with JSON repair, while a separate action-only prompt produced recommended actions in ~25–117s depending on prompt strictness/log content.
- **Frontend test added:** `admin-system-analyze-ai.test.tsx` — new Stage 2 test verifies that opening a modal for a log with structured narrative (no recommended_action) shows the "Generate Recommended Action" button, clicking it calls `generateRecommendedAction`, and the recommended action text appears in the UI after completion. All 5 tests pass (4 existing + 1 new).

## [2026-07-01] feat(frontend-test): Stage 2 recommended action test

- **Scope:** Added frontend test coverage for the Stage 2 "Generate Recommended Action" flow in the admin system threat telemetry modal.
- **Files modified:** `admin-system-analyze-ai.test.tsx` — added `mockGenerateRecommendedAction`, `mockCheckRecommendedActionStatus`, and a full Stage 2 integration test.
- **Behavior:** Opens a modal for a mock log with structured JSON narrative (anomaly_description, log_evidence, risk_assessment, confidence, sources — no recommended_action). Verifies "Stage 2: Recommended Action" banner appears, clicks "Generate Recommended Action", asserts the API is called, and verifies the recommended action text appears and the Stage 2 section disappears on completion.
- **Validation:** `npx vitest run src/app/admin/system/admin-system-analyze-ai.test.tsx` — 5 passed (4 existing + 1 new). Frontend lint clean. Backend `ruff check`, `ruff format`, and `pytest tests/test_ai_service_retry.py` — all pass.

## [2026-07-01] fix(deploy): tolerate stale Ollama model-pull container cleanup races

- **Scope:** Harden GitHub Actions production deploy cleanup after `docker compose up --wait` failed on a fixed-name one-shot container conflict for `wims-ollama-model-pull`.
- **Files modified:** `.github/workflows/deploy.yml`
- **Changes:**
  - Removed invalid `docker ps -aq --format ...` usage from stale Compose rename cleanup.
  - Added idempotent container removal helper that tolerates Docker's `removal already in progress` race without aborting the retry path.
  - Explicitly removes stale `wims-ollama-model-pull` before Compose recreate and waits until the exact fixed container name disappears.
  - Keeps `wims-openbao-bootstrap` protected while running; only terminal `exited`/`dead` instances are cleaned.
- **Validation:** Parsed `.github/workflows/deploy.yml` as YAML, extracted the deploy script and ran `bash -n` successfully. Live VPS dry-run removed the exited stale `wims-ollama-model-pull` container and confirmed the stack remained up. `actionlint` was not installed locally.

## [2026-07-01] feat(analytics): AFOR PDF export mode for analyst incident detail

- **Scope:** Wire the analyst incident detail PDF export button to the existing AFOR section-based PDF writer without adding a new endpoint.
- **Files modified:** `src/backend/api/routes/analytics.py`, `src/frontend/src/lib/api/legacy.ts`, `src/frontend/src/app/dashboard/analyst/incidents/[id]/page.tsx`
- **Changes:**
  - Added strict `export_mode: Literal["bulk", "afor"] = "bulk"` to analytics export requests.
  - `POST /api/analytics/export/pdf` now dispatches existing `export_analyst_incidents_task` with `format="pdf"` and `export_mode="afor"` when explicitly requested with `filters.incident_id`.
  - Explicit AFOR PDF requests without `filters.incident_id` return HTTP 400 instead of silently falling back to bulk PDF.
  - Frontend analytics export client passes optional `export_mode` only when provided.
  - Analyst incident detail page sends `export_mode: "afor"` only for PDF; CSV remains the existing tabular export.
- **Validation:** `cd src/backend && ruff check api/routes/analytics.py` passed. `cd src/frontend && npm run lint` passed with 0 errors and 40 pre-existing warnings.

## [2026-06-30] fix(ai,deploy): graceful JSON degradation, keycloak proxy-headers, deploy model check

- **Scope:** 8-edit clean hot-fix on top of `801ad9f` (replacing contaminated PR #492).
- **Files modified:** `src/backend/services/ai_service.py`, `src/docker-compose.yml`, `.gitignore`, `.github/workflows/deploy.yml`
- **Changes:**
  - Graceful JSON degradation in `analyze_threat_log` and `analyze_audit_logs` — instead of HTTP 502 on bad Ollama JSON, falls back to raw text (threat_log) or empty strings (audit_logs) with 0.5 confidence.
  - Prompt softened from "Output strictly JSON" to "Provide a structured analysis as JSON".
  - `confidence_breakdown` DB param uses `None` (SQL NULL) instead of `json.dumps(None)` (JSON `"null"`) on graceful fallback.
  - Docstring fix: `num_predict` default 512 → 256.
  - Keycloak `--proxy-headers xforwarded` CLI flag added (belt-and-suspenders with `KC_PROXY_HEADERS` env var).
  - `.pi/sessions/` added to `.gitignore`.
  - Deploy workflow model check: `qwen2.5:3b` → `qwen2.5:1.5b`.
- **Validation:** 16/16 tests pass, ruff check + format clean, reviewer subagent audit passed with no issues.
- **Edge case noted:** `xai_confidence_breakdown` in the `analyze_threat_log` return dict can now be `None` (JSON `null`) on graceful fallback, where it was previously always a `dict`. No current callers iterate it as a dict, but future callers should guard against `None`. Documented in `system-wiki/backend/services.md`.

## [2026-06-30] fix(ai): bound Ollama auto-analysis on CPU VPS

- **Scope:** Production VPS diagnosis showed Ollama connectivity was healthy, but Celery auto-AI requests to `qwen2.5:3b` took 5-16 minutes on CPU and could return 500/time out.
- **Files modified:**
  - `src/postgres-init/75_security_log_rollups.sql` — seed `auto_ai_analysis_enabled=false` so background HIGH/CRITICAL alert analysis is opt-in/manual by default. The deploy migration loop replays this idempotent seed.
  - `src/backend/services/ai_service.py` — centralize Ollama payload construction and add `options.num_predict` default cap of 256, overrideable by `OLLAMA_NUM_PREDICT`.
  - `src/docker-compose.yml` — set `OLLAMA_NUM_PARALLEL=1` and `OLLAMA_MAX_LOADED_MODELS=1` on Ollama; pass `OLLAMA_NUM_PREDICT` to backend and Celery.
  - `src/backend/tests/test_ai_service_retry.py` and `src/backend/tests/test_auto_ai_defaults.py` — regression coverage for bounded generation, compose concurrency env, and auto-AI default-off seed.
  - `system-wiki/backend/services.md` — document timeout, generation cap, concurrency guard, and auto-AI default.
- **Behavior:** Manual XAI analysis still works. Background `tasks.ai_forwarding.process_ai_queue` now remains opt-in by default, preventing automatic Suricata alert bursts from monopolizing the CPU-only Ollama service. JSON generation requests are bounded to reduce worst-case runtime.
- **Validation:** Targeted backend tests and lint run from `src/backend` before PR.

## [2026-06-30] fix(ci): isolate Compose dynamic IPs from static host mappings

- **Scope:** PR #487 CI follow-up. GitHub Actions Security Scan failed during `docker compose up -d --build` with Docker daemon `Address already in use` immediately after one-shot/dynamic services started and before the full stack reached nginx. The failure is consistent with dynamic Compose network allocations colliding with low static IPs that are only claimed when their containers start.
- **Files modified:**
  - `src/docker-compose.yml` — keep `wims_internal` on `172.18.0.0/24`, add `ipam.config.ip_range: 172.18.0.128/25` for dynamic containers, remove the unnecessary static IP from `celery-worker`, and remove the temporary `backend -> celery-worker` startup dependency.
  - `src/backend/tests/test_suricata_redis_host_networking.py` — update the subnet contract to `/24` and add a regression test proving the dynamic `ip_range` does not overlap static service IPs.
  - `src/nginx/nginx.conf`, `src/nginx/nginx.local.conf`, `src/nginx/nginx.ci.conf` — narrow `set_real_ip_from` from `172.18.0.0/16` to the configured `172.18.0.0/24` bridge subnet.
  - `src/backend/tests/test_nginx_forwarded_headers.py` — pin the `/24` real-IP trust range so it stays aligned with Compose.
  - `system-wiki/architecture/infrastructure-config.md`, `system-wiki/security/asvs-l2-state.json` — document the static-low/dynamic-high IPAM layout and nginx trusted proxy range.
- **Behavior:** Static host mappings remain stable for redis/postgres/ollama/keycloak/openbao, while dynamic services (mailhog, bootstraps, model-pull, backend, celery, frontend, nginx) are allocated from `172.18.0.128/25`, avoiding Docker 28/Compose parallel-start address collisions in CI. Nginx's trusted proxy range now matches the `/24` bridge instead of trusting the broader `/16`.
- **Validation:**
  - `cd src/backend && pytest tests/test_suricata_redis_host_networking.py tests/test_nginx_forwarded_headers.py -q` — 26 passed.
  - `cd src/backend && ruff check tests/test_suricata_redis_host_networking.py tests/test_nginx_forwarded_headers.py && ruff format --check tests/test_suricata_redis_host_networking.py tests/test_nginx_forwarded_headers.py` — clean.
  - `cd src && docker compose -f docker-compose.yml -f docker-compose.ci.yml config --quiet` — valid.
  - `/tmp/repro/no-iprange-race.yml` local Compose reproduction with low static IPs and no dynamic range split — reproduced Docker `Address already in use` during concurrent startup.
  - `/tmp/repro/iprange-race.yml` local Compose reproduction with the same static-low/dynamic-high pattern — 12 alpine containers started concurrently without `Address already in use`, then were torn down.

## [2026-06-29] fix(pen-test): Suricata redis host-networking follow-up

- **Scope:** Follow-up to the 2026-06-29 pen-test fix (R2). PR #483 changed `suricata.yaml` from `redis-server: "127.0.0.1"` to `redis-server: "redis"`, but `wims-suricata` uses `network_mode: "host"` for AF_PACKET capture, so the `redis` hostname cannot be resolved via Docker DNS. The live VPS was relying on a hand-added `172.18.0.5 redis` entry in the host's `/etc/hosts` to make the pipeline work — not reproducible across fresh deploys.
- **Files modified:**
  - `src/docker-compose.yml` — three coordinated changes:
    1. `networks.wims_internal` — add `ipam.config.subnet: 172.18.0.0/16` (so the static IP is in a valid range).
    2. `services.redis` — pin to `172.18.0.5` via `networks.wims_internal.ipv4_address` (matches the live VPS's dynamic IP, so the change is in-place; no other service gets renumbered).
    3. `services.wims-suricata` — add `extra_hosts: ["redis:172.18.0.5"]` so the hostname resolves inside the container even under `network_mode: "host"`.
  - `src/suricata/suricata.yaml` — replace the PR #483 comment with a fuller explanation that references the `extra_hosts` dependency and the `network_mode: "host"` constraint.
  - `src/backend/tests/test_suricata_redis_host_networking.py` — NEW: 9 contract tests pinning the structure (host networking, extra_hosts entry, static redis IP, IPAM subnet, in-subnet check, hostname vs IP in suricata.yaml, pen-test comment references extra_hosts + network_mode + date stamp).
  - `system-wiki/architecture/infrastructure-config.md` — new "Suricata <-> Redis host networking" section documenting the constraint, the fix, why `127.0.0.1` would also work, and the contract test.
- **Behavior:** After `docker compose up -d` on a fresh host, Suricata can resolve `redis` and alerts flow to `suricata:alerts` in Redis without requiring a host-level `/etc/hosts` entry. The static IP + IPAM subnet makes the `extra_hosts` mapping stable across `docker compose down && up` cycles.
- **Validation:**
  - `cd src/backend && pytest tests/test_suricata_redis_host_networking.py` — 9 passed.
  - `pytest tests/test_security_log_rollups_rls.py tests/test_rls_init_contract.py` — 13 passed (no regression).
  - `pytest tests/test_suricata_ingestion.py` — 18 passed (TestParseEveAlertLine, TestEveToThreatLogRow, TestEveClassifier); 2 pre-existing failures in TestIngestEveFile require a live Postgres (same gap as the 2026-06-29 pen-test fix).
  - `ruff check` + `ruff format --check` on the new test — clean.
  - `yaml.safe_load(src/docker-compose.yml)` + `yaml.safe_load(src/suricata/suricata.yaml)` — valid.
- **Live VPS validation still required:** `cd /opt/wims-bfp/src && docker compose up -d` will recreate the wims_internal network with the new IPAM config and the redis container with the static IP. Because 172.18.0.5 was the existing dynamic IP, no service should be renumbered. After the recreate, remove the hand-added `/etc/hosts` entry (it's no longer needed) and restart wims-suricata: `docker compose restart wims-suricata`.
- **Rollback:** Revert the three docker-compose changes and the suricata.yaml comment. The static IP is the only "destructive" change (it pins redis to one IP) — if the live VPS is already on 172.18.0.5 dynamically, the rollback is in-place. If somehow redis is on a different IP, the rollback could trigger IP renumbering for redis-dependent services.

## [2026-06-29] fix(pen-test): three logging pipeline gaps from 2026-06-29 review

- **Scope:** Three independent root causes were preventing pen-test alerts from reaching the System Admin hub (`/admin/audit`, `/admin/monitoring`, `/admin/system`): (R1) Suricata file-tail ingestion blocked by RLS policy mismatch on `security_threat_log_rollups`; (R2) Suricata Redis output writing to loopback, never reaching the Redis container; (R3) Keycloak SPI audit events rejected with HTTP 422 (JSON decode error) due to Java `HttpClient` defaulting to HTTP/2 against uvicorn (HTTP/1.1-only).
- **Files modified:**
  - `src/postgres-init/75_security_log_rollups.sql` — replace single `FOR ALL` policy with three granular policies (`security_rollups_insert`, `security_rollups_update`, `security_rollups_delete`); flip `siem.store_low_value_raw` default from `false` to `true` for pen-test visibility in `/admin/monitoring`.
  - `src/postgres-init/77_security_log_rollups_policy_fix.sql` — NEW: live-DB migration that re-applies the granular policies and updates the `siem.store_low_value_raw` config on the running VPS. Idempotent.
  - `src/suricata/suricata.yaml` — fix `redis-server` from `127.0.0.1` (Suricata's own loopback) to `redis` (Docker service hostname). R2 fix.
  - `src/keycloak/wims-audit-event-listener/src/main/java/gov/bfp/wims/keycloak/WimsAuditEventListenerProvider.java` — add `.version(HttpClient.Version.HTTP_1_1)` to request builder (R3 root cause); include response body in error log and request body in debug log for diagnosis.
  - `src/backend/api/routes/security_events.py` — add `WIMS_DEBUG_KEYCLOAK_BODY` env-var-gated raw body capture in `/api/auth/keycloak-event` for diagnosis.
  - `src/backend/tests/test_security_log_rollups_rls.py` — NEW: 10 contract tests pinning the RLS policy structure (granular policies exist, INSERT/UPDATE allow NATIONAL_ANALYST, DELETE is admin-only, low-value raw default is `true`, 77 is idempotent).
  - `system-wiki/database/sql-init-files.md` — document files 75, 76, 77 and the granular RLS policy structure.
- **Behavior:**
  - **R1:** The `svc_suricata` service account (role `NATIONAL_ANALYST`) can now INSERT and UPDATE rollup rows; the `record_security_threat_rollups` upsert no longer aborts the whole transaction. DELETE remains `SYSTEM_ADMIN`-only for audit integrity. The Celery task `tasks.suricata.ingest_suricata_eve` should resume ingesting within 10 seconds after the live-DB migration runs.
  - **R2:** After Suricata is restarted with the fixed config, `redis-server: "redis"` reaches the Redis container on the bridge network. `XLEN suricata:alerts` should grow within seconds. The Celery task `tasks.suricata_redis.subscribe_alerts` then processes alerts in real time.
  - **R3:** The SPI now forces HTTP/1.1, eliminating the protocol-negotiation path that was corrupting the request body. The 422 JSON decode error on `/api/auth/keycloak-event` should resolve to 202. `failed` login events from `LOGIN_ERROR` and `USER_DISABLED_BY_PERMANENT_LOCKOUT` reach `wims.system_audit_trails` as `FAILED_LOGIN` with `source: "keycloak_spi"`.
  - **Open question resolved (low-value alert visibility):** Chose option (a) — flip `siem.store_low_value_raw` to `true` so admin monitoring views see scanner/probe/bot traffic. 1-day raw retention bounds storage cost. Rollups remain intact for long-term analytics.
- **Validation:**
  - `cd src/backend && pytest tests/test_security_log_rollups_rls.py -v` — 10 passed.
  - `cd src/backend && pytest tests/test_rls_init_contract.py tests/test_security_monitoring.py -v` — 27 passed.
  - `cd src/backend && ruff check api/routes/security_events.py tests/test_security_log_rollups_rls.py` — clean.
  - `cd src/backend && ruff format --check api/routes/security_events.py tests/test_security_log_rollups_rls.py` — clean.
  - Tests that depend on the live DB (`test_security_events.py` rate-limit, `test_suricata_ingestion.py` `TestIngestEveFile`) require `DATABASE_ADMIN_URL` and a reachable Postgres/Redis — they were not run in the host environment, matching the existing 2026-06-29 triage-fix validation gap.
  - **Live VPS validation still required:** the 77 migration must be applied via `psql` against the live DB; the SPI JAR must be rebuilt and the Keycloak container restarted; Suricata must be restarted with the updated `suricata.yaml`.
- **Rollback:** See `Penetration Test Logging Gap Fixes` doc — `DROP POLICY IF EXISTS` for the three granular policies + recreate the single `FOR ALL` policy; restore original `suricata.yaml`; revert SPI to remove `.version(HttpClient.Version.HTTP_1_1)`.

## [2026-06-29] fix(triage): split/merge cluster integrity guards

- **Scope:** Hardened civilian triage split/merge workflow behavior so split operations keep valid anchors, reject source-emptying splits, and merge operations move members with one atomic delete-returning/insert statement.
- **Files modified:** `src/backend/services/civilian_triage/workflow.py`, `src/backend/tests/integration/test_triage_queue.py`.
- **Behavior:** `split_cluster_command` now orders selected members by `report_id`, assigns deterministic new-cluster anchors, re-anchors the source cluster when its old anchor is moved, and returns HTTP 422 when a split would leave the source cluster empty. `merge_clusters_command` now uses a single `WITH moved AS (DELETE ... RETURNING) INSERT ... SELECT FROM moved` flow so the moved set and inserted set stay aligned.
- **Validation:** `cd src/backend && ruff format services/civilian_triage/workflow.py tests/integration/test_triage_queue.py` and `ruff check services/civilian_triage/workflow.py tests/integration/test_triage_queue.py` passed. `pytest -q tests/integration/test_triage_queue.py` could not run in the host environment because `fastapi` is not installed, and Docker-based fallback was unavailable because `docker` is not installed.

## [2026-06-28] fix(audit): RP-06 NSD tamper detection + RP-14 analytics export audit (WS-D)

Branch: `fix/ws-d-rp06-rp14-audit`

### Scope
Two non-repudiation gaps closed: (1) direct DB edits to `wims.incident_nonsensitive_details` were undetectable by the integrity check; (2) bulk analytics exports were invisible to anomaly detectors.

### Changes
- **`src/backend/services/regional_incidents/helpers.py`** — `verify_incident_hash_chain()`: provenance JOIN and `compute_incident_data_hash()` recompute now run before the no-chain early return. Mismatch → `integrity_status="tampered"` with `INTEGRITY_VIOLATION` audit row written via `_AdminSessionLocal`. Valid no-chain result (hashes match) → `"valid"`. No-hash incident → `"unverified"` (unchanged).
- **`src/backend/main.py`** — `_backfill_verified_data_hash()` startup patch: populates `data_hash` for VERIFIED incidents with NULL hash (covers bootstrap seed data). Idempotent and non-fatal.
- **`src/backend/tasks/exports.py`** — `_insert_export_log()`: adds `log_system_audit(..., "BULK_EXPORT", ...)` alongside the `analytics_export_log` INSERT, sharing the same transaction commit. Non-fatal if audit write fails.
- **`src/backend/tests/integration/test_rp06_nsd_tamper.py`** — 3-case integration test: unmodified incident → `"valid"`, direct NSD tamper → `"tampered"` with `"NSD tamper detected"` violation, null data_hash → `"unverified"`.

### Register updates
- `system-wiki/gaps/frs-codebase-gap-register.md` — RP-06 closed (NSD recompute); RP-14 closed (BULK_EXPORT audit).
- `system-wiki/gaps/functional-bug-register.md` — F-15 (RP-06), F-16 (RP-14) added.
## [2026-06-28] ops: SIEM raw retention, rollups, and noise gating

- **Scope:** Raw Suricata threat logs are now retained for 1 day while hourly/daily rollups preserve weekly and 90-day time-range telemetry.
- **Files modified:** `src/postgres-init/75_security_log_rollups.sql`, `src/backend/services/security_rollups.py`, `src/backend/services/suricata_ingestion.py`, `src/backend/tasks/data_retention.py`, `src/backend/api/routes/admin/security.py`, and security docs.
- **Behavior:** Ingestion increments rollups for every alert, stores low-value scanner/bot/background alerts only in rollups by default, keeps HIGH/CRITICAL and credential/high-signal alerts raw, and deduplicates raw rows within a 5-minute window. `/api/admin/security-logs/rollups` exposes hourly/daily time-range data.
- **Validation:** `ruff check` passed for changed backend files; `SKIP_DB_TESTS=1 pytest -q tests/test_suricata_auto_incident.py tests/test_suricata_rules.py tests/test_suricata_ingestion.py tests/test_security_monitoring.py` passed (48 passed, 9 skipped).

## [2026-06-28] ops: Contabo GitOps deploy and Qwen2.5-3B resource tuning

- **Scope:** Production deployment now targets the hardened Contabo VPS via the non-root `wims` SSH user and restores the XAI model to `qwen2.5:3b`.
- **Files modified:** `.github/workflows/deploy.yml`, `src/docker-compose.yml`, `src/docker-compose.prod.yml`, `src/backend/services/ai_service.py`, `src/backend/tests/test_ai_service_retry.py`, and `system-wiki/architecture/infrastructure-config.md`.
- **Behavior:** GitHub Actions SSH uses `wims` with passwordless sudo for root-only certbot operations; Ollama is capped at 4 vCPU / 6 GB RAM for Qwen2.5-3B while leaving host capacity for Postgres, Keycloak, backend, Celery, Suricata, Redis, nginx, and OS cache.
- **Validation:** `src/backend/tests/test_ai_service_retry.py` passed in a temporary venv; production compose config was validated on the Contabo VPS with the updated compose files. Deploy still performs post-restart backend, gateway, Keycloak, frontend, API, and Ollama model checks.

## [2026-06-27] feat(offline): regional encoder offline UX overhaul

- **Scope:** PR #466 improves regional encoder offline visibility and control: split queued/failed/conflict counts, per-incident offline overlays, Offline Work center, conflict merge UX, cancel/withdraw controls, sync progress, enable-offline cancellation, and Sidebar badge navigation.
- **Files created:**
  - `src/frontend/src/lib/offlineModeFlags.ts` — localStorage flag helpers extracted to avoid offline-store/offline-enable circular imports.
  - `src/frontend/src/lib/regionalOfflineStatus.ts` — maps offline ops to per-incident card overlay badges.
  - `src/frontend/src/lib/offlineOpActions.ts` — cancel/withdraw helper with fresh IndexedDB sync-status re-check before delete.
  - `src/frontend/src/lib/useOfflineWorkCounts.ts` — shared pending/failed/conflict/draft count hook for nav and dashboards.
  - `src/frontend/src/app/dashboard/regional/offline-work/page.tsx` — Drafts / Queued / Failed / Conflicts work center.
  - `system-wiki/architecture/regional-offline-ux-overhaul-2026-06.md` — synthesis page for the new UX/data-flow model.
- **Files modified:** `offlineStore.ts`, `offlineEnable.ts`, `syncEngine.ts`, `useAutoSync.ts`, `SyncStatusBar.tsx`, `IncidentCard.tsx`, `OfflineModeManager.tsx`, `IncidentConflictMergePanel.tsx`, `Sidebar.tsx`, and `dashboard/regional/page.tsx`.
- **Behavior:** `offline_enabled` clears on different-user switch, conflicts/failed ops no longer hide behind generic pending counts, card-level overlays show queued/conflict/failed work, and encoders can cancel queued operations unless the latest IndexedDB state is already syncing.
- **Related non-offline changes in same PR:** `/fire-stations` geolocation centering, map-pin reverse-geocode fill, PSGC NIR corrections, and live-badge text removal are documented in the following log entry and synthesis notes.

## [2026-06-27] fix | center /fire-stations around user location when available

- **Scope:** `/fire-stations` no longer forces the initial map viewport to fit all nationwide stations when browser geolocation succeeds. It centers on the user's location at local zoom while still rendering all station markers.
- **Files modified:**
  - `src/frontend/src/app/fire-stations/page.tsx` — requests browser geolocation on load, passes `userLocation` to the map, and refreshes `/api/ref/emergency-services` with `lat/lon` for distance metadata when available. Denied/unavailable geolocation keeps the existing national fallback.
  - `src/frontend/src/app/fire-stations/FireStationsMapInner.tsx` — accepts `userLocation`, skips nationwide `fitBounds` when present, centers at zoom 12, and renders the shared user-location marker.
  - `src/frontend/src/app/fire-stations/FireStationsMapInner.test.tsx` — adds coverage for user-location centering.
- **Validation:** Targeted Vitest command could not run in the current host checkout because `vitest/config` is missing from local `node_modules`; no application test failure observed.
- **Route map:** `system-wiki/frontend/route-map.md` still omits `/fire-stations` as a pre-existing route-table gap; behavior change logged here.

## [2026-06-27] fix: remove orphaned AI incident narrative endpoints (dead code)

Branch: cleanup-ai-narrative-and-geography (off origin/master).

### Scope
Removed the AI incident narrative feature (PR #104 / #69) — backend-only feature that was never wired to the frontend and is not in the FRS.

### Changes
- **Deleted:** `src/backend/tasks/narrative.py` — Celery batch task (`batch_generate_narratives`)
- **Deleted:** `src/backend/tests/test_incident_narrative.py` — 7 tests for the orphaned endpoints
- **Removed:** `generate_incident_narrative()` from `src/backend/services/ai_service.py` (~160 lines incl. Ollama prompt, encryption, DB write)
- **Removed:** Two POST endpoints from `src/backend/api/routes/analytics.py` — `POST /incidents/{incident_id}/narrative` and `POST /incidents/batch-narratives`
- **Removed:** `TestNarrativeTaskReturnShape` from `tests/test_ai_service_retry.py`
- **Cleaned:** `celery_config.py` — removed `"tasks.narrative"` from both `include` and `imports`
- **Cleaned:** Unused imports in `ai_service.py` — `get_crypto_provider`, `SecurityProviderError`

### Preserved
- DB columns (`ai_narrative`, `ai_narrative_enc`, etc.) — harmless, no migration needed
- Historical migration script `encrypt_ai_narratives_backlog.py` — reference only
- `xai_narrative` feature for security threat logs — unrelated, actively used
- `narrative_report` field — human-written, unrelated


## [2026-06-30] refactor: replace 3-layer GitHub PoC with pi gh extension

- **Decision:** Dropped the 3-layer approach (PyGithub backend + Octokit frontend + gh CLI CI) in favor of pure `gh` CLI everywhere.
- **Rationale:** `gh` CLI handles all needed GitHub operations (issue creation, PR comments, repo queries, CI automation). The Octokit frontend route added Octokit dependency for no benefit. PyGithub Celery tasks would duplicate what `gh` already does.
- **What changed:**
  - Removed `src/frontend/src/app/api/github/repo-summary/route.ts` (PoC 2 — Octokit)
  - Removed `@octokit/rest` from frontend dependencies
  - Kept `.github/workflows/ci.yml` github-integration job (PoC 3 — gh CLI in CI, already committed in 9e18ee4)
  - Added `.pi/extensions/github-tools.ts` — pi extension registering 5 custom tools (`gh_repo_summary`, `gh_create_issue`, `gh_pr_comment`, `gh_list_prs`, `gh_list_issues`) that wrap `gh` CLI with auto repo detection and graceful degradation
- **PoC 1 remnants** (uncommitted, on disk): `celery_config.py` and `tasks/__init__.py` still have `github_integration` registration; `tests/test_github_integration.py` is untracked. `tasks/github_integration.py` was lost. These should be cleaned up.

## [2026-06-30] feat(ext): pi extensions for gh CLI + VPS SSH diagnostics

- **Added `.pi/extensions/github-tools.ts`** — 5 custom tools wrapping `gh` CLI:
  `gh_repo_summary`, `gh_create_issue`, `gh_pr_comment`, `gh_list_prs`, `gh_list_issues`.
  Auto-detects repo, graceful degradation when `gh` unauthenticated/uninstalled.
- **Added `.pi/extensions/vps-ssh.ts`** — 6 custom tools for production VPS ops:
  `vps_ssh`, `vps_compose_ps`, `vps_compose_logs`, `vps_compose_up`,
  `vps_deploy_check`, `vps_compose_down`. Auto-connects to wims@194.233.81.162.
- **Removed** `src/frontend/src/app/api/github/repo-summary/route.ts` + `@octokit/rest`
- **Remaining PoC 1 debris** (uncommitted): celery_config.py, tasks/__init__.py still
  reference `tasks.github_integration`; untracked test_github_integration.py on disk.
  Needs cleanup when convenient.

## 2026-07-09 — Alembic migration infra + GHCR SHA deploys (PRs #536, #537, #538)

### Completed
- **PR #536** (`feat/alembic-migrations`): Alembic infrastructure + startup DDL migration
  - `alembic.ini`, `env.py`, `script.py.mako`, `requirements.txt` (alembic>=1.13)
  - Migration 0001: bootstraps fresh DB from postgres-init SQL files (no-op on existing)
  - Migration 0002: consolidates all startup DDL (rules, RLS, constraints, roles)
  - CI: replaces SQL replay loops with `alembic upgrade head` in migrations + backend jobs
  - Deploy: Alembic migration step with app services stopped (prevents lock contention)
  - `apply_schema_patches()` kept as `@app.on_event("startup")` (idempotent; needed because
    3 SQL files fail via `text()` bind-param handling but succeed via `exec_driver_sql`)
- **PR #537** (`feat/ghcr-sha-deploys`): GHCR SHA immutable image deploys
  - `docker-compose.yml`: `image: ${BACKEND_IMAGE:-wims-backend:local}` pattern for
    backend, celery-worker, frontend, keycloak
  - `deploy.yml`: pull GHCR `:latest` images + `docker compose up --no-build`
- **PR #538** (`feat/consolidate-deploy`): Deploy consolidation
  - Deploy concurrency (`group: deploy-vps`, `cancel-in-progress: false`)
  - `scripts/deploy-vps.sh`: extracted deploy script for local testing/maintainability

### Gotchas
- PG 17 cannot read PG 15 data directory — pinned to `postgis/postgis:15-3.4-alpine`
- `apply_schema_patches()` must stay as startup event: 3 SQL files (38, 66, 70) fail
  via Alembic `op.execute(text(sql))` due to `:` bind-param handling, but succeed via
  `exec_driver_sql()`. The startup event re-applies these. Long-term fix: convert these
  SQL files to proper Alembic migrations with escaped `:` literals.
- Backend CI job has `working-directory: src/backend` — migration step must use plain
  `alembic upgrade head`, not `cd src/backend && alembic upgrade head`
- Test `test_267_unarchive_with_duplicate_client_id` depends on startup DDL running
  before the TestClient (2 TestClients in the test; second one skips startup via
  `_schema_patches_attempted` guard)
## [2026-07-14] feat(audit): tamper-proof export foundation (#558, PR1)

- **Scope:** Added OpenBao Transit `sign()`/`verify()` client methods, a
  non-exportable ECDSA P-256 `audit-export-signer` bootstrap key and least-
  privilege policy paths, plus the stable `AUDIT_SECURE_EXPORT` anomaly action.
- **Artifacts:** Added canonical UTF-8/LF hash-chain CSV writer/verifier and
  deterministic ReportLab PDF generator with focused unit tests.
- **Documentation:** Updated the approved three-PR design contract, OpenBao
  runbook, `.env.example`, and the backend/security wiki routing pages.
- **Validation:** `compileall`, targeted Ruff checks, and direct artifact tests
  passed. Full pytest collection remains blocked by the repository's startup
  Redis/session-management dependency; no gap-register entry changed.

## [2026-07-14] feat(audit): secure export and verifier workflow (#558, PR2)

- **Scope:** Added strict manifest schemas, deterministic signed ZIP assembly,
  50,000-row bounded admin and validator exports, and fail-closed sensitive
  `AUDIT_SECURE_EXPORT` commits.
- **Verification:** Added ZIP traversal/duplicate/encryption/size/ratio/CRC
  checks, OpenBao online verification with freshness warnings, and offline P-256
  verification through `scripts/verify_audit_export.py`.
- **Routes:** Added secure export endpoints for SYSTEM_ADMIN and
  NATIONAL_VALIDATOR plus the admin multipart verifier; legacy CSV endpoints are
  unchanged.
- **Documentation:** Updated the backend route map, utility/security synthesis,
  wiki index, and this log. No FRS/code gap-register change was introduced.
- **Validation:** Targeted Ruff, formatting, compileall, and direct valid-package
  verification passed. Pytest invocation was attempted but blocked by the
  repository's Redis/session-management startup dependency.

## [2026-07-14] fix(audit): PR2 review hardening (#595)

- **Scope:** Ignore whitespace-only admin search terms, attribute OpenBao public
  key failures to `public_key`, and bound verifier member/aggregate
  materialization to 64/128 MiB.
- **Validation:** Added regression tests; the focused verifier suite passes 4/4
  and the GitHub CI rerun is green across all required jobs.


## [2026-07-16] feat(public-surface): Tabler icon + severity design system (#610)

- **Scope:** Implemented production icon and severity system for public surface per GitHub issue #610 and IA spec `docs/superpowers/specs/2026-07-15-public-surface-ia-design.md`. Replaced emoji placeholder icons in `src/frontend/src/app/information/page.tsx` with Tabler filled icons (MIT license). Created reusable severity component with shape + color (not color-alone) for accessibility (deuteranopia/protanopia safe).
- **Package:** Added `@tabler/icons-react@^3.44.0` to `src/frontend/package.json`. Tabler is a NEW addition for public-surface icon system only, not a replacement of `lucide-react` elsewhere in the app.
- **Severity mapping:** Low = circle/green (#059669), Medium = triangle/yellow (#d97706), High = octagon/orange (#ea580c), Critical = filled-alert/red (#dc2626). Component exported from `src/frontend/src/components/SeverityIndicator.tsx` with clear prop API (`level`, `size`, `className`).
- **Icon swap:** `information/page.tsx` guide cards (📋 → IconClipboardList, 🏷️ → IconTag, ⭐ → IconStar, 📸 → IconCamera, 🔒 → IconLock, 🔄 → IconRefresh), tab buttons (⚠ → IconAlertTriangle, 📢 → IconSpeakerphone, 📖 → IconBook), empty states (🌤️ → IconSun, 📭 → IconMailbox). No logic, role-gate, tab structure, or data-fetching changes — emoji-for-icon swap only per issue scope. Location pin 📍 remains in emergency list items (content, not UI icon).
- **Icon wrapper:** `src/frontend/src/components/TablerIcon.tsx` provides reusable wrapper that yields to `currentColor` for theming.
- **Exports:** Both `SeverityIndicator` and `TablerIconWrapper` exported from `src/frontend/src/components/index.ts` for discoverability by #609 (shared header) and later issues.
- **Tests:** New `SeverityIndicator.test.tsx` (7 tests) asserts correct shape + color per level (one test per Low/Medium/High/Critical), custom size/className support, and accessibility (role="img", aria-label). New `InformationPage-icons.test.tsx` (4 tests) asserts no emoji remain in guide cards/tab buttons/empty states, SVG icons are present. Full suite: 1355/1355 passed (129 test files).
- **Icon-library boundary:** `@tabler/icons-react` (filled variants preferred) for public-surface icons; `lucide-react` for internal/admin UI.
- **Validation:** `npx vitest run` 1355/1355 passed; `npm run lint` clean; no new ESLint errors introduced. Known pre-existing baseline flake (not ours): Master CI can intermittently fail `admin-security-monitoring.test.tsx > renders StaleCacheBanner when wrappers return fromCache=true` — confirmed via 2x full local suite runs (1344/1344 passed both times) and 3x isolated runs — this is a timing/environment flake (test uses vi.useRealTimers() + waitFor), not a deterministic regression, and is unrelated to the #566-569 BlockedIpsPanel merge (different code path). Master's `Security Scan` CI job also intermittently fails at the 'Bring up the stack' step — root cause is wims-postgres crashing ~5s into a fresh multi-service compose-up on the shared GitHub runner under CPU/memory contention during the 74-file SQL bootstrap; the team already added a healthcheck-tolerance mitigation for this in docker-compose.ci.yml (PR #598) but it can still recur. Neither failure touches frontend icon/component code.
## [2026-07-16] feat(routing): OSRM route geometry storage & exposure (#611)

- **Scope:** Extended the OSRM routing pipeline to store and expose the full GeoJSON LineString road geometry from `services/routing.py` → `tasks/routing.py` → `wims.citizen_reports.routing_geometry` → frontend tracking API, enabling real road-network route visualization for public civilian reports (replaces frontend's current straight-line haversine fallback).
- **Backend changes:**
  - `services/routing.py`: `RoutingResult` NamedTuple now includes `geometry: dict | None` (GeoJSON LineString or None). `_try_osrm()` changed OSRM request from `overview=false` to `overview=full` (kept `geometries=geojson`) and extracts the geometry from the OSRM response as `route.get("geometry")`. When OSRM is skipped (unset `OSRM_BASE_URL`) or fails, `geometry` is `None` — the #552/#601 fail-safe behavior is fully preserved (no coordinate logging, no silent public OSRM dependency).
  - `tasks/routing.py`: extended the routing task's candidate evaluation to track `best_geometry` alongside distance/duration/source/path. The UPDATE persists it via `ST_GeomFromGeoJSON(:geometry_json)` when present, or explicitly sets it to NULL when OSRM was unavailable (fall-back estimate).
  - **Migration:** `alembic/versions/0020_citizen_reports_routing_geometry.py` adds `routing_geometry geometry(LineString, 4326)` to `wims.citizen_reports` (idempotent `ADD COLUMN IF NOT EXISTS`, matching the repo's alembic migration pattern from 0018/0019). Column is nullable by design — NULL when OSRM is unset, unreachable, or returns no geometry.
  - `schemas/civilian.py`: added `routing_geometry: dict | None = None` to both `CivilianReportResponse` (line 86) and `CivilianTrackingResponse` (line 109).
  - `api/routes/civilian.py`: both SQL queries (`_fetch_report_response` line 397, `get_civilian_report_by_tracking_token` line 804) now fetch `ST_AsGeoJSON(cr.routing_geometry)::jsonb AS routing_geometry`, and both response constructions pass it through (`_response_from_row` line 331, `CivilianTrackingResponse` line 836).
- **Privacy/security:** `routing_geometry` is exposed on both the device-ID-gated `_fetch_report_response` path (used by POST/PATCH report endpoints after device ownership check) and the token-gated `get_civilian_report_by_tracking_token` endpoint (tracking URL from the initial submission response). Neither is anonymous/open enumeration — both require either device_id ownership or the cryptographic tracking token. No anonymous public endpoint exposes it.
- **Tests:** `tests/test_routing.py` extended with 3 new tests (total 9/9): `test_osrm_returns_geometry_when_available` (mock OSRM response includes a 3-point LineString → `result.geometry["type"] == "LineString"`), `test_fallback_returns_null_geometry` (unset OSRM → `geometry is None`), `test_osrm_failure_returns_null_geometry` (httpx.ConnectError → fallback → `geometry is None`).
- **Validation:** `ruff check .` clean on all 4 modified backend files. Pytest cannot run in this isolated worktree (missing FastAPI/Celery dependencies, conftest import fails) — test structure and assertions verified by inspection. Migration revision chain confirmed: `0020` revises `0019`, both use the repo's idempotent `IF NOT EXISTS`/`IF EXISTS` pattern.
- **Enables:** Frontend PRs #613 (tracking page polyline), #616 (public cluster map route preview), #617 (contributor profile routes) can now consume `routing_geometry` from the tracking API — each degrades gracefully to straight-line rendering when the field is null (OSRM unavailable or unset).
- **Post-review hardening (Option A):** exception logging in `_try_osrm` was tightened to log only host+error_type (no exception string, improving coordinate-privacy), and `routing_geometry` is now exposed ONLY on the token-gated `CivilianTrackingResponse`, not on `CivilianReportResponse` (which flows to the anonymous POST /reports path).

## [2026-07-16] feat(public-surface): shared auth-aware header, nav & Report FAB (#609)

- **Scope:** Added `PublicHeader` component (`src/frontend/src/components/PublicHeader.tsx`) as the shared navigation header for the public/contributor surface. Two states per IA spec: (1) Anonymous — BFP logo, Register, Sign In, Report a Fire (desktop button + mobile FAB); (2) Logged-in civilian — BFP logo, [Home] [Dashboard] [Information] nav links, profile avatar, Report a Fire. Staff roles (encoder/validator/analyst/admin) keep their existing Sidebar and do not see this header. Locked color tokens per spec: near-black base #111116, red #dc2626 for Report CTA only, blue #3b82f6 for chrome. Mobile FAB (red, bottom-right, 52px, links to `/report`) hidden on desktop; desktop Report button hidden on mobile. Both link to `/report`.
- **Wiring:** Modified `LayoutShell.tsx` to conditionally render `PublicHeader` for public routes (`/`, `/report`, `/fire-stations`, `/tracking`, `/privacy`) and civilian-only routes (`/contributor`, `/information`). Staff routes (encoder, validator, analyst, admin) remain unchanged with Sidebar + Header layout.
- **Pages wired:** Landing (`/`), Contributor Dashboard (`/contributor`), Fire Stations (`/fire-stations`), Report Tracking (`/tracking`), Information Hub (`/information`). No page-level content changes beyond adding the header render.
- **FAB icon:** Placeholder `AlertCircle` from lucide-react (already used elsewhere in the app). The sibling #610 PR is building a Tabler-icon + severity component; once merged, the FAB icon should be swapped to the #610 component per issue #610's acceptance criteria.
- **Tests:** `PublicHeader.test.tsx` (18 tests, all passing) — anonymous nav state renders correctly, logged-in-civilian nav state renders correctly, FAB is present and links to `/report`, staff roles do NOT see the header (encoder/validator/analyst/admin all return null), loading state returns null.
- **Baseline flake note:** Master CI can intermittently fail `admin-security-monitoring.test.tsx > renders StaleCacheBanner when wrappers return fromCache=true` — confirmed via 2x full local suite runs (1344/1344 passed both times) and 3x isolated runs — this is a timing/environment flake (test uses vi.useRealTimers() + waitFor), not a deterministic regression, and is unrelated to the #566-569 BlockedIpsPanel merge (different code path). Master's `Security Scan` CI job also intermittently fails at the 'Bring up the stack' step — root cause is wims-postgres crashing ~5s into a fresh multi-service compose-up on the shared GitHub runner under CPU/memory contention during the 74-file SQL bootstrap; the team already added a healthcheck-tolerance mitigation for this in docker-compose.ci.yml (PR #598) but it can still recur. Neither failure touches header/nav frontend code.
- **Validation:** `npx vitest run` — 1361/1362 passed (1 pre-existing timeout in analyst dashboard test, unrelated to this PR). `npm run lint` — 0 errors, 47 warnings (all pre-existing, none from new files).

## [2026-07-16] feat(public-surface): Fire Stations split-view (#616)

- **Scope:** Restructured `/fire-stations` (`src/frontend/src/app/fire-stations/page.tsx`) from a stacked "directory list + collapsible Show/Hide map toggle" layout into a genuine split view: the interactive map and the scrollable station directory render side-by-side simultaneously (no toggle/click required to reveal the map). Builds on F1 (#609 `PublicHeader`, already wired via `LayoutShell`'s `/fire-stations` public-route classification) and F2 (#610 Tabler icons/`SeverityIndicator`, no emoji reintroduced).
- **Layout:** `flex flex-col xl:flex-row` container matching the prototype's split (`prototypes/public-surface/index.html` `.stations-split`/`.stations-map-side`/`.stations-dir-side`, referenced for fidelity only — not merged). Desktop (`xl:` and up): map panel `xl:flex-1` fills remaining width on the left, directory panel is a fixed `xl:w-[380px]` scrollable column on the right (`xl:overflow-y-auto`), both bounded to a shared `xl:h-[600px]` panel height. Mobile: `flex-col` stacks the map on top (fixed `h-64`) with the directory flowing below and scrolling with the page — consistent with the existing `xl:` + `overflow` responsive convention already used by the triage board/legend components rather than inventing a new breakpoint.
- **Preserved:** search-by-name/coordinates filtering, server-side nearest-first `distance_m` sort (`src/backend/api/routes/ref.py` — unchanged, no backend edits), `FireStationsMapInner`'s custom fire-pin markers and `FitBounds` behavior, and the existing list-item-click ⇄ map-marker-selection sync (`selectedStationId`/`onSelectStation`).
- **Stretch goal (routing polyline) — deferred:** Investigated whether `/fire-stations` has access to any per-station route geometry to reuse `src/frontend/src/components/map/RoutePolyline.tsx` (merged via #617/#627). The `EmergencyServiceStation`/`EmergencyServiceResponse` shapes returned by `fetchEmergencyServices()` (`src/frontend/src/lib/api/reference.ts`) carry no geometry field, and `wims.system_ref_fire_stations`/`GET /ref/emergency-services` (`src/backend/api/routes/ref.py`) compute only a haversine `distance_m` for sorting — no OSRM/PostGIS route geometry is fetched or exposed outside the token-gated tracking flow (`routing_geometry` on `CivilianTrackingResponse`, per #611/#617). **Route polyline deferred: no per-station geometry source exists outside the tracking flow; needs a routing endpoint as a follow-up.** Shipped the split-view + markers as the full deliverable per the issue's stretch-goal guidance; `RoutePolyline` was not imported and no duplicate polyline component was built.
- **Tests:** `src/frontend/src/app/fire-stations/page.test.tsx` rewritten — added assertions that the map and directory render simultaneously with no "show/hide map" toggle button present, and that the split-view container carries the `flex-col`/`xl:flex-row` responsive classes. Retained/updated existing coverage for search filtering, keyboard selection syncing the map's `selectedStationId`, empty-search state, degraded-map-tile guidance (list stays usable), and the shared fetch-failure alert appearing in both panels.
- **Validation:** `npx vitest run` — 1449/1449 passed (137 test files). `npm run lint` — 0 errors (36 pre-existing warnings, none from files touched by this PR). `npx tsc --noEmit` — 298 diagnostic lines before and after this change (`git stash` baseline diff), byte-identical — no new type errors introduced.

## [2026-07-16] fix(public-surface): refine shared public header navigation (#629)

- **Scope:** `src/frontend/src/components/PublicHeader.tsx` now provides the prototype-matched sticky translucent/frosted treatment (`rgba(10, 10, 14, 0.82)` plus blur) to public and civilian routes other than `/`. The shared brand label is `WIMS-BFP`, matching the page-owned landing header. On `/report`, the redundant desktop Report a Fire CTA and mobile FAB are both omitted; the CTA/FAB remain available on other routes.
- **Tests:** `src/frontend/src/components/PublicHeader.test.tsx` explicitly mocks the pathname, verifies the WIMS-BFP label, and verifies `/report` has neither report-action link nor FAB.
- **Validation:** `npx vitest run` — 137 files / 1480 tests passed. `npm run lint` — 0 errors, 36 pre-existing warnings. Production `npm run build` passed with the CI placeholder public variables. Full `npx tsc --noEmit` remains blocked by pre-existing test-source errors outside this change.

## [2026-07-16] feat(public-surface): shared design-system foundation + /tracking migration

- **Why:** Individual public-surface PRs (#612–#642) built screens but each re-implemented
  chrome/tokens independently, so they diverged from the prototype (`prototypes/public-surface/index.html`,
  Wayfinder #607) and "look out of place." Scope is **public/civilian surface only** (per user):
  landing, report wizard, tracking, register, login, incidents, information, fire-stations,
  contributor, profile, receipt. Authenticated internal dashboards (analyst/regional/validator/
  triage) are explicitly out of scope and keep their own design language.
- **Foundation added:**
  - `src/frontend/src/styles/public-surface.css` — ports the prototype's token system, scoped
    under `.public-surface` (dark default + `[data-theme="light"]` Cream Paper) so it does NOT
    leak into dashboards. Includes `.ps-intent-bg` (hero/map gradient) and `.ps-has-mesh`
    (content-page red-black mesh) gradients (both themes), `.ps-btn`/`.ps-btn-primary`/
    `.ps-btn-outline`/`.ps-btn-ghost` primitives, `.ps-card`/`.ps-warning` surfaces, and shared
    `.ps-header`/`.ps-footer`/`.ps-theme-toggle` chrome.
  - `src/frontend/src/components/public/PublicThemeProvider.tsx` — client wrapper that applies
    `.public-surface` + `data-theme`, renders shared header/footer, and provides the persisted
    day/night toggle (localStorage `landing-theme`, default dark, SSR-safe via lazy init +
    suppressHydrationWarning). Exposes `usePublicTheme()`.
- **First migrated screen:** `/tracking` (`src/frontend/src/app/tracking/page.tsx`) rewritten to
  consume `PublicThemeProvider` + `ps-*` classes + prototype gradient, replacing the old
  `globals.css` light tokens (`var(--content-bg)`, maroon `var(--bfp-gradient)`). Existing
  tracking test (3 tests) still passes.
- **Next screens (follow-up PRs, same pattern):** report wizard → register/login → information/
  incidents → fire-stations/contributor/profile → receipt. Each page wraps in PublicThemeProvider
  and swaps bespoke classes for `ps-*` tokens.
- **Validation:** `npx vitest run src/app/tracking/page.test.tsx` — 3/3 passed. `npm run lint` on
  new files — 0 errors. `npm run build` — passed.

## [2026-07-17] feat(validator): production manual perimeter workspace (#665)

- **Scope:** Replaced the disposable synthetic drawing screen with a role-gated, online-only workspace for a real verified incident selected by ID. It loads the existing incident/perimeter records, preserves the accepted map-left/inspector-right interaction (top-right zoom, vertex snap, close, undo, clear, GeoJSON inspection), and persists only through the existing perimeter API.
- **Authority:** `MANUAL_DRAW` is now an allowed durable map method in the clean bootstrap and Alembic upgrade. GeoJSON validity and acreage remain PostGIS-authoritative; the browser calculation is labelled preview-only. The UI displays stored incident province/region metadata rather than the prototype's coarse client-side reverse-geocode boxes.
- **Security:** UI presentation permits NATIONAL_VALIDATOR and SYSTEM_ADMIN, while the existing perimeter route and RLS policies remain the authorization boundary. The workspace rejects non-verified or unmapped incidents before drawing.
- **Wiki:** Updated [[frontend/route-map]] and [[backend/api-route-map]]. No FRS/code gap changed.

## [2026-07-17] feat(public-surface): migrate civilian contributor dashboard (#655)

- **Scope:** Restyled `src/frontend/src/app/contributor/page.tsx` with scoped `ps-*` tokens and retained its existing contributor API/auth, filter, pagination, and compact `PublicFireMap` behavior. The dashboard now has exactly two report/verification cards, a truthful three-outcome legend, and a bounded current-status Activity snapshot from the loaded reports; it does not fabricate event history, locations, drafts, or report statistics.
- **Shell:** `/contributor` remains content-only. The existing `LayoutShell` supplies `PublicThemeProvider showHeader={false}` and the real `PublicHeader`, preserving one civilian banner, Home/Dashboard/Information navigation, the Report a Fire CTA, and persisted `landing-theme` day/night state without nesting provider or page-owned chrome.
- **Tests:** Updated `src/frontend/src/app/contributor/page.test.tsx` and `src/frontend/src/app/__tests__/public-header-single-banner.test.tsx`; added `src/frontend/src/app/__tests__/contributor-public-shell.test.tsx`. Focused contributor/header tests passed: 4 of 4 files and 36 of 36 tests. T3 reliability review also passed 3 of 3 repeated runs (2 of 2 files, 7 of 7 tests each).
- **Manual QA:** Skipped because no authenticated CIVILIAN_REPORTER browser session/fixture was available. It remains required to inspect dark/light framing and reload persistence, 320px/480px report rows, keyboard focus, hydration, and map containment.
- **Wiki:** Updated [[frontend/route-map]] and `system-wiki/index.md`. No FRS/code gap changed.

## [2026-07-17] fix(security): validate Suricata rules without duplicate local signatures (#658)

- **Scope:** `suricata-update` now refreshes ET Open rules only; `suricata.yaml` directly loads the 53 committed WIMS custom SIDs without merging them into generated `suricata.rules`. SID 1000133 now uses Suricata 8's `http.uri.raw` keyword.
- **Validation:** `test_suricata_rules.py` checks the current `suricata -T` output instead of historical append-only logs, and CI validates the committed config with read-only mounts before the security scan.
- **Wiki:** Updated [[security/security-baseline]] and `system-wiki/index.md`. No FRS/code gap changed.

## [2026-07-17] feat(public-map): civilian circles and verified perimeter overlays (#639)

- **Scope:** `GET /api/information/emergencies` now adds coordinates and a GeoJSON Feature perimeter only when a published emergency links to a VERIFIED incident. `PublicFireMapInner` renders aggregated civilian pressure signals as area circles, verified incident perimeters as polygons, and falls back to a point only when the verified incident has no perimeter.
- **Privacy:** The public map continues to use aggregated civilian areas, not individual report markers. Unlinked or non-verified CMS emergencies expose no geometry.
- **Public-surface fold:** `/verify-sent` now uses the shared formal public-surface card and preserves the supplied email in the verification-code link.
- **Wiki:** Updated [[frontend/route-map]] and [[backend/api-route-map]]. No FRS/code gap changed.
