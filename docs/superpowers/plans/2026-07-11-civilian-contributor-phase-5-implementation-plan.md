# Implementation Plan

## Goal
Deliver the approved Phase 5 Community Safety Hub and its Phase 4 trust-score prerequisite without exposing civilian PII, reintroducing a public leaderboard, or weakening capability-token, RLS, audit, encryption, and frontend/backend boundaries.

## Revision blockers before implementation

These findings came from the security, QA, architecture, and product voice reviews and must be resolved in the plan/spec before implementation begins:

1. **Photo metadata final schema:** explicitly remove or permanently null existing plaintext EXIF, GPS, filename, timestamp, and device-metadata columns; define ciphertext-only envelopes, provider/key-version metadata, and photo-bound AAD. Add migration assertions.
2. **Anonymous photo RLS context:** define the exact transaction-local device/capability context and RLS predicates for pending uploads and atomic attach. No broad `BYPASSRLS` session.
3. **Trust-score status contract:** map the live statuses (`ACTIONED`, `REJECTED_BOGUS`, `REJECTED_DUPLICATE`, `REJECTED_INSUFFICIENT`, `REJECTED_TIMEOUT`) in the spec before implementation; include unknown/pending exclusions and parameterized tests.
4. **Trust-score time semantics:** decide whether the six-month window includes the current UTC calendar month and record the exact evidence timestamp tolerance and boundary tests.
5. **Routing scope:** add the five routing columns, fallback/retry tests, and degraded UI behavior to the plan while keeping production public-OSRM replacement tracked by issue #552.
6. **Tracking compatibility:** define endpoint-by-endpoint policy for capability-only lookup, capability-validated append, and sunset of device-ID/report-ID-only paths; include frontend/offline migration behavior.
7. **CMS enforcement:** make audit immutability repair a prerequisite, define explicit public projection columns/views, and require one server-side sanitizer/structured-text representation across write, preview, and public rendering.
8. **Performance gate:** benchmark live contributor aggregation at approximately 10,000 contributors and 100,000 reports against an agreed latency target before introducing Redis or materialized-view caching.
9. **Acceptance-report accuracy:** planning evidence must remain marked pending; implementation criteria are not satisfied until code and tests exist.

## Current implementation facts and constraints

- `src/backend/services/contributor.py` still implements the legacy linear score (`+2` per root report, `+5` per `ACTIONED`, per-report photo points, inactivity decay) and still contains `get_leaderboard()`.
- `src/backend/api/routes/civilian.py`, `src/backend/schemas/civilian.py`, `src/backend/tests/test_contributor.py`, and `src/backend/tests/integration/test_contributor_endpoints.py` still expose and test `/api/civilian/contributor/leaderboard`.
- The current public tracking v2 path already hashes a 256-bit bearer token with SHA-256 and validates it through `wims.validate_tracking_token`; however, older device-ID/report-ID tracking APIs and frontend clients remain present and must not remain an alternate unauthenticated lookup path.
- The current photo implementation is post-submit (`POST /api/civilian/reports/{report_id}/photos`) and `wims.report_photos.report_id` is `NOT NULL`; the approved contract requires pre-upload followed by ownership-checked atomic attachment during report submission.
- `optional_auth()` currently converts credential-validation `401`/`403` into anonymous access. The approved contract permits anonymous behavior only when no credential is supplied; present-but-invalid credentials must fail closed.
- `src/backend/postgres-init/05_citizen_reports.sql` defines the actual terminal statuses as `ACTIONED`, `REJECTED_BOGUS`, `REJECTED_DUPLICATE`, `REJECTED_INSUFFICIENT`, and `REJECTED_TIMEOUT`. The implementation must map this actual enum explicitly to the score's decided/actionable categories rather than inventing unsupported statuses.
- Routing work is an external dependency tracked by GitHub issue [#552](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/552). Do not make a public OSRM endpoint a production prerequisite; preserve the current adapter/fallback contract and gate uncontrolled routing behind the issue's approved deployment boundary.

## Tasks

1. **Task 1: Lock the Phase 4 compatibility contract before changing behavior**
   - Files: `src/backend/services/contributor.py`, `src/backend/api/routes/civilian.py`, `src/backend/schemas/civilian.py`, `src/backend/auth.py`, `src/backend/tests/test_auth_optional.py`, `src/backend/tests/test_contributor.py`, `src/backend/tests/integration/test_contributor_endpoints.py`
   - Changes:
     - Define one `TRUST_SCORE_FORMULA_VERSION` constant and one shared terminal/decided-status mapping based on the live `citizen_reports.status` constraint. `ACTIONED` is the positive outcome; every supported `REJECTED_*` terminal status is a negative decided outcome unless the product specification explicitly says otherwise. Pending, under-review, linked, archived/nonexistent, and unknown future values are excluded.
     - Change `optional_auth` so no cookie returns `None`, while a present cookie with malformed, expired, invalid-audience, invalid-client, or unresolved-user credentials returns `401`/`403` as appropriate. Preserve `5xx` identity-provider/database failures. Add tests for all six paths: missing, valid reporter, valid non-reporter, expired, malformed, and invalid audience.
     - Remove `LeaderboardEntry`, `get_leaderboard`, the leaderboard route, and all leaderboard opt-in behavior. Do not leave a hidden public ranking endpoint or an unused opt-in column that implies the feature remains supported; remove the column in the migration after checking no production data dependency exists.
     - Extend private contributor response contracts with normalized breakdown fields (`volume_progress`, `outcome_accuracy`, `evidence_quality`, `consistency`, `decay`, `formula_version`, and decided/active-month counts) while keeping the score and badge private to the contributor and authorized validator/admin contexts.
   - Acceptance: no route, schema, service, frontend client, or test references `leaderboard`; invalid credentials cannot silently become anonymous; the live status enum is covered by explicit mapping tests.

2. **Task 2: Add the persistent migration and clean-volume bootstrap for Phase 4/5 contracts**
   - Files: new `src/backend/alembic/versions/0007_civilian_phase5_schema.py` (use the next actual Alembic revision after `0006`), new `src/postgres-init/86_civilian_phase5_schema.sql` (use the next unused lexical bootstrap number), existing `src/backend/alembic/versions/0006_contributor_trust_score.py` only if compatibility cleanup must be documented there, `src/backend/tests/test_0007_civilian_phase5_schema.py`, `src/backend/tests/integration/test_wims_initial_schema_bootstrap.py`
   - Changes:
     - Convert `report_photos.report_id` to nullable for the pre-upload state, add/retain `attached_at`, and preserve `client_photo_id` idempotency. Add indexes for pending-owner lookup and cleanup. Keep original, sanitized, and sensitive metadata artifacts independently encrypted with existing AES-GCM/OpenBao metadata and AAD conventions.
     - Add the CMS item table with UUID identity, content type (`SAFETY_ARTICLE`, `ANNOUNCEMENT`, `EVENT`), globally unique slug, lifecycle status (`DRAFT`, `PUBLISHED`, `ARCHIVED`), `published_version_id` publication pointer, expiry, last-reviewed date, urgent-banner flag, created/updated/archived metadata, and optimistic version field.
     - Add an immutable CMS version table containing monotonically increasing version number, English/Filipino structured/plain-text fields, event/announcement metadata JSON only where needed, creator, creation time, and content hash. Rollback must insert a new version and move the publication pointer; it must never update/delete historical versions.
     - Add indexes for public `(content_type, status, expires_at)`, slug lookup, version lookup, and active urgent-banner lookup. Enforce at most one published active urgent banner with a partial unique index/constraint.
     - Add `formula_version` to the contributor snapshot/cache row and remove `opt_in_leaderboard` during the forward migration. Preserve snapshot reproducibility; the score remains live-derived and the snapshot must never become the source of truth.
     - Define `FORCE ROW LEVEL SECURITY`, grants, and policies for CMS items/versions and pending/attached photos. Public content may select only published, non-expired projections; only the server-side `SYSTEM_ADMIN` dependency may mutate CMS rows. Contributor rows must select only the current contributor's data for civilian users; validators/admins get only the approved operational projection.
     - Use the append-only `wims.system_audit_trails` path for CMS transitions, rollback, publish, photo upload/attach, failed authorization, and cleanup. Do not use a general superuser/BYPASSRLS domain session. Include final-schema audit immutability regression coverage because the repository documents an existing partitioned-audit enforcement gap.
   - Acceptance: fresh bootstrap and Alembic upgrade produce equivalent schema, RLS is enabled and forced, historical CMS versions cannot be updated/deleted, the urgent-banner uniqueness rule is enforced, and migration tests pass on a disposable Postgres/PostGIS target.

3. **Task 3: Replace the legacy trust-score engine with the normalized reliability model**
   - Files: `src/backend/services/contributor.py`, `src/backend/schemas/civilian.py`, `src/backend/api/routes/civilian.py`, `src/backend/alembic/versions/0007_civilian_phase5_schema.py`, `src/backend/tests/test_contributor.py`, `src/backend/tests/integration/test_contributor_endpoints.py`
   - Changes:
     - Compute only root reports (`linked_to_report_id IS NULL`) for lifetime volume and consistency. Use `volume_progress = min(1, log(1 + root_reports) / log(21))`.
     - Compute outcome accuracy only from decided rows: `actioned / decided * min(1, decided / 10)`. Add zero-decided and one-decided confidence tests, plus mixed actioned/rejected and pending-only cases.
     - Compute evidence quality as a bounded per-root-report score: photo exists `0.25`, GPS verified `0.35`, photo near the report `0.20`, timestamp consistent `0.20`; aggregate normalized report scores without allowing multiple photos to create unbounded credit. Use PostGIS for the 500m distance predicate and only authorized/minimized derived photo flags; do not decrypt sensitive metadata in a public route.
     - Compute consistency as distinct `date_trunc('month', created_at)` values for root reports in the rolling six-calendar-month window (current month plus the five preceding calendar months), divided by six. Multiple reports in a month count once; appends never count. Add tests for one burst month, six active months, four active months, and no activity.
     - Compute bounded inactivity decay (`min(20, inactive_months * 2)`) using a documented UTC/calendar-month definition, then clamp the final result to `[0, 100]` and map existing badge thresholds unchanged.
     - Prefer a small number of set-based SQL CTEs/aggregations over the current per-report `photo_bonus_for_report()` N+1 loop. Remove or retire that legacy SECURITY DEFINER point-bonus function after all call sites/tests are migrated.
     - Return a private breakdown and formula version for `/me`, reports/stats as required; do not expose exact civilian coordinates in any public tracking projection.
   - Acceptance: score examples prove diminishing volume returns, 1/10 confidence after one decision, full confidence at 10 decisions, no score inflation from appends or photo count, consistency is not volume-dependent, decay is bounded, and a high score requires sustained quality rather than a small number of reports. Benchmark contributor profile aggregation on representative datasets (for example, 10,000 contributors and 100,000 reports) against an agreed latency target; if live-derived queries exceed that target, document Redis or materialized-view caching as the follow-up rather than adding speculative caching.

4. **Task 4: Harden tracking around the existing capability-token implementation**
   - Files: `src/backend/api/routes/civilian.py`, `src/backend/auth.py` only if a dedicated capability dependency is introduced, `src/backend/schemas/civilian.py`, `src/postgres-init/80_civilian_contributor_tables.sql`, `src/backend/alembic/versions/0007_civilian_phase5_schema.py`, `src/backend/tests/integration/test_civilian_api.py`, new/expanded `src/backend/tests/test_tracking_capabilities.py`, `src/frontend/src/lib/api/legacy.ts`, `src/frontend/src/lib/api/civilian.ts`, `src/frontend/src/app/tracking/page.tsx`, `src/frontend/src/app/tracking/v2/[report_id]/[tracking_token]/page.tsx`
   - Changes:
     - Make the opaque, high-entropy tracking capability the sole public lookup authority. Store only SHA-256 token hashes, bind validation to report ID, enforce one active token per report, honor expiry/revocation, and support safe regeneration/revocation without returning prior tokens.
     - Keep neutral `404` behavior for missing, expired, revoked, mismatched, or unauthorized capabilities; add throttling and ensure logs/audits contain only token-safe identifiers, never raw capabilities or exact civilian coordinates.
     - Remove or deprecate the old `GET /api/civilian/reports?device_id=`, `GET /api/civilian/reports/{report_id}?device_id=`, timeline, append, notification, and legacy frontend lookup paths as public authorization mechanisms. If compatibility is required, make them delegate to a capability-token check rather than accepting a report ID/device ID alone, and document the transition.
     - Reduce the tracking response to status, station name/phone, coarse road distance, ETA range, photo count if approved, and safety guidance. Exclude latitude/longitude, witness PII, chain IDs, internal notes, and any reverse-geocodable location data from the public schema.
   - Acceptance: wrong report/token pairs, expired tokens, revoked tokens, malformed tokens, and device-ID-only requests all receive indistinguishable `404`s; valid capabilities return only the approved projection; raw token values are absent from logs and audit payloads.

5. **Task 5: Implement the approved pre-upload → atomic photo-attach flow**
   - Files: `src/backend/services/report_photos.py`, `src/backend/api/routes/civilian.py`, `src/backend/schemas/civilian.py`, `src/backend/auth.py`, `src/backend/tasks/report_photos.py`, `src/backend/tests/test_report_photos.py`, `src/backend/tests/integration/test_report_photos_rls.py`, `src/backend/tests/integration/test_civilian_api.py`, `src/frontend/src/lib/api/civilian.ts`, `src/frontend/src/components/civilian/PhotoUpload.tsx`, `src/frontend/src/app/page.tsx`, `src/frontend/src/app/__tests__/page.test.tsx`
   - Changes:
     - Add `POST /api/civilian/photos/upload` for an owner-bound pre-upload. It validates extension/MIME/magic bytes/size, extracts EXIF before sanitization, computes original and sanitized SHA-256 hashes, encrypts original/sanitized/metadata artifacts with existing provider/AAD rules, and creates a pending row with no report ID.
     - Change report submission to accept UUID `photo_ids`/client photo IDs. In one transaction, lock and validate every pending photo belongs to the authenticated contributor or anonymous capability/device owner, enforce anonymous/registered photo caps, attach all photos, compute PostGIS GPS consensus/distance, insert the report, and write the audit record atomically. Reject partial ownership, duplicate attachment, terminal/invalid state, and mixed-owner batches without leaking existence.
     - Preserve idempotency for retried report and photo submissions. Return stable duplicate semantics without returning a new raw artifact or capability.
     - Keep a compatibility path for existing post-submit UI only during migration; remove it once the frontend uses pre-upload and add an explicit sunset test/route behavior. Do not permit a user to attach a photo after the report owner/capability changes.
     - Update orphan cleanup to remove pending DB rows and recognized encrypted artifacts after the approved grace period, with safe path checks, no arbitrary-file deletion, and cleanup audit outcomes. Ensure cleanup task uses an explicit system-task identity and does not rely on unset RLS context.
     - Preserve sensitive EXIF/browser GPS, original filename, device metadata, and timestamps encrypted; expose only `present/unavailable`, consensus, and bounded derived distance/status fields to authorized validators. Never write plaintext PII fallback.
   - Acceptance: pre-upload without a report works only for an owner, atomic attach rolls back both report and attachment on failure, cross-user/device attachment returns neutral `404`, retries are idempotent, orphan rows/files are cleaned safely, and RLS integration tests prove no cross-owner reads/writes.

6. **Task 6: Add the community content service, public routes, CMS admin routes, and expiry task**
   - Files: new `src/backend/services/community_content.py`, new `src/backend/api/routes/community.py`, new `src/backend/api/routes/admin/community.py`, `src/backend/api/routes/admin/__init__.py`, `src/backend/main.py` only if router registration needs a new include, `src/backend/schemas/civilian.py` or new `src/backend/schemas/community.py`, new `src/backend/tasks/community.py`, `src/backend/celery_config.py`, new `src/backend/tests/test_community_content.py`, new `src/backend/tests/integration/test_community_endpoints.py`, new `src/backend/tests/integration/test_community_cms_rls.py`
   - Changes:
     - Public service/projection: `GET /api/civilian/community/content` returns only published, non-expired content grouped into safety articles, announcements, upcoming events, and optional urgent banner; `GET /api/civilian/community/content/{slug}` returns a published detail projection. Apply expiry in the SQL predicate on every read, even if Celery is delayed.
     - Implement locale selection: safety articles and urgent banners require both English and Filipino before publication; announcements/events may fall back to English and must identify the fallback in the response. Require `last_reviewed_at` for safety articles and `expires_at` for announcements/events/banner.
     - Admin API under `/api/admin/community/content`: list/filter lifecycle and type, create draft, edit with optimistic version, preview, publish, archive, and rollback. Use the established `get_system_admin`/RLS-scoped session and existing CSRF/privileged-session controls. Reject invalid transitions, stale version IDs, missing bilingual safety content, missing review/expiry metadata, unsafe slugs, and duplicate urgent banners.
     - Store only structured/plain text or sanitize a strict allowlist. Reject template syntax, scripts, event handlers, unsafe URLs, and arbitrary HTML; ensure preview uses the same sanitizer and public renderer.
     - Make publish/rollback/version creation/audit writes atomic and idempotent. `rollback` creates a new version and advances the publication pointer without mutating history.
     - Add `tasks.community.expire_content` to archive expired announcements/events/banners safely and audit the transition; public reads remain correct when the task is unavailable.
     - Register the task in Celery imports/beat schedule and add task registration/expiry tests.
   - Acceptance: public endpoints never return drafts/expired content, locale fallback rules are exact, preview cannot publish, stale edits cannot overwrite newer versions, rollback preserves every old version, XSS/SSTI payloads are inert/rejected, and only `SYSTEM_ADMIN` can mutate CMS content.

7. **Task 7: Build the public Community Safety Hub and private contributor dashboard**
   - Files: new `src/frontend/src/app/community/page.tsx`, new `src/frontend/src/app/community/announcements/[slug]/page.tsx`, new `src/frontend/src/app/community/events/[slug]/page.tsx`, new `src/frontend/src/app/contributor/page.tsx`, new `src/frontend/src/app/admin/community/page.tsx`, new `src/frontend/src/lib/api/community.ts`, new `src/frontend/src/lib/api/contributor.ts`, new `src/frontend/src/lib/api/adminCommunity.ts`, `src/frontend/src/lib/api/index.ts`, `src/frontend/src/lib/api.ts`, existing `src/frontend/src/app/page.tsx`, existing `src/frontend/src/app/tracking/v2/[report_id]/[tracking_token]/page.tsx`
   - Changes:
     - Keep `/` as the anonymous emergency-reporting flow. Add the neutral contributor invitation only after emergency guidance, with `Sign in` primary and `Create account` secondary; never replace or obscure emergency submission.
     - Implement `/community` in the approved order: optional urgent banner, `During a fire`/`Report safely`/`Prepare` quick actions, separate Announcements and Upcoming Events, then station directory. Render loading, empty, expired, translation-fallback, and error states accessibly.
     - Implement dedicated shareable article/event detail pages. Events remain informational only; do not add RSVP or discussion behavior.
     - Implement private `/contributor` with score, badge, normalized breakdown, report history, outcome/activity metrics, photo counts, and clear provisional/low-sample messaging. Do not render a public ranking or any other contributor's data.
     - Implement admin CMS page with draft list, editor, bilingual fields, preview, lifecycle actions, version history, and rollback confirmation. UI role checks only control presentation; backend remains the authorization boundary.
     - Keep all network calls in API slices, preserve the existing cookie/CSRF/error transport, and avoid caching sensitive contributor data in offline stores unless the established encrypted per-user cache contract is explicitly extended.
   - Acceptance: keyboard/mobile users can reach all actions, focus/loading/error announcements work, reduced motion is respected, no page directly connects to PostgreSQL, and UI tests cover hierarchy, empty/error/fallback states, private score display, CMS transitions, and no-leaderboard behavior.

8. **Task 8: Upgrade station directory to list-first with optional map toggle and selection highlighting**
   - Files: existing `src/frontend/src/app/fire-stations/page.tsx`, `src/frontend/src/app/fire-stations/FireStationsMapInner.tsx`, `src/frontend/src/app/fire-stations/FireStationsMapInner.test.tsx`, new `src/frontend/src/components/community/StationDirectory.tsx`, new `src/frontend/src/components/community/StationDirectory.test.tsx`, `src/frontend/src/lib/api/reference.ts`, `src/frontend/src/lib/api/community.ts`, relevant backend station endpoint tests (`src/backend/tests/test_ref_emergency.py` or current fire-station API test owner)
   - Changes:
     - Reuse the existing public station reference endpoint as the source of truth; add server-owned search/filter parameters only if needed, never interpolate arbitrary SQL.
     - Make the searchable list the primary interaction and keep the map collapsed behind an accessible toggle. Selecting a station centers and highlights that pin while retaining every other station pin; synchronize list/map selection and filters.
     - Do not require geolocation permission. If map tiles or geolocation fail, retain a complete searchable list and explain the degraded state. Avoid exposing exact civilian report coordinates.
     - Reuse the existing dynamic Leaflet split to avoid SSR failures; add tests for all pins retained, selected station centering/highlighting, keyboard selection, search-empty state, map failure, and mobile layout.
   - Acceptance: list works with map disabled/unavailable, station selection centers/highlights without removing other pins, and station data remains public reference data only.

9. **Task 9: Reconcile frontend route and backend API maps plus security/documentation sources**
   - Files: `system-wiki/frontend/route-map.md`, `system-wiki/backend/api-route-map.md`, `system-wiki/database/schema-overview.md`, `system-wiki/security/security-baseline.md`, `system-wiki/index.md`, `system-wiki/log.md`, `docs/superpowers/specs/2026-07-06-civilian-contributor-enhancement-design.md`, `CONTEXT.md`
   - Changes:
     - Add the new public/community/contributor/admin routes and owner files to route maps; remove the public leaderboard and device-ID-only tracking claims.
     - Document CMS tables/version pointer, expiry enforcement, RLS, audit, encryption, and PII/XSS controls with live-source citations after implementation.
     - Record the trust formula version, actual terminal-status mapping, capability-token contract, and pre-upload atomic photo flow. Keep routing issue #552 as the external production-routing dependency; do not claim it is implemented.
     - Append a dated `system-wiki/log.md` entry and update `system-wiki/index.md`; update the gap register only if implementation closes or materially changes a tracked FRS/code gap.
   - Acceptance: route/schema/security statements match live code, links resolve, no stale leaderboard or public coordinate claims remain, and docs checks pass.

10. **Task 10: Run focused tests, then the required backend/frontend/migration gates**
    - Files: test files added/updated in Tasks 1–8; no production file changes in this task.
    - Changes: execute focused loops before broad gates and retain exact output for review. Use disposable Postgres/PostGIS/Redis/OpenBao services for RLS, migration, audit, and encryption tests; do not run destructive commands against persistent or production volumes.
    - Acceptance commands:
      - `cd src/backend && ruff check services/contributor.py services/report_photos.py services/community_content.py api/routes/civilian.py api/routes/community.py api/routes/admin/community.py schemas/civilian.py schemas/community.py auth.py tasks/community.py tasks/report_photos.py`
      - `cd src/backend && ruff format --check services/contributor.py services/report_photos.py services/community_content.py api/routes/civilian.py api/routes/community.py api/routes/admin/community.py schemas/civilian.py schemas/community.py auth.py tasks/community.py tasks/report_photos.py`
      - `cd src/backend && pytest tests/test_contributor.py tests/test_auth_optional.py tests/test_report_photos.py tests/test_community_content.py -q`
      - `cd src && docker compose run --rm backend pytest tests/test_0007_civilian_phase5_schema.py tests/integration/test_contributor_endpoints.py tests/integration/test_report_photos_rls.py tests/integration/test_community_endpoints.py tests/integration/test_community_cms_rls.py -v`
      - `cd src/backend && alembic heads && alembic upgrade head` against a disposable database; separately validate clean bootstrap SQL with `ON_ERROR_STOP=1` and the existing bootstrap contract suite.
      - `cd src/frontend && npm run lint && npx vitest run app/__tests__/page.test.tsx app/community app/contributor app/admin/community app/fire-stations app/tracking`
      - `cd src/frontend && NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth/realms/bfp NEXT_PUBLIC_BASE_URL=http://localhost NEXT_PUBLIC_MAPBOX_TOKEN= npm run build`
      - Before push/PR, follow `docs/agents/ci-preflight.md` and compare the exact commands with `.github/workflows/ci.yml`; report infrastructure-heavy suites that remain unavailable.

## Files to Modify

- `src/backend/services/contributor.py` — normalized score, private breakdown, formula version; remove leaderboard.
- `src/backend/services/report_photos.py` — pre-upload and atomic attach lifecycle.
- `src/backend/services/routing.py` — only if needed to enforce the controlled-routing boundary; production routing remains blocked on #552.
- `src/backend/services/community_content.py` — new CMS/public projection service.
- `src/backend/api/routes/civilian.py` — capability-only tracking, pre-upload/attach, private contributor endpoints; remove leaderboard and unsafe legacy lookups.
- `src/backend/api/routes/community.py` — new public community API.
- `src/backend/api/routes/admin/community.py` — new SYSTEM_ADMIN CMS API.
- `src/backend/api/routes/admin/__init__.py`, `src/backend/main.py` — register admin/public routers as needed.
- `src/backend/auth.py` — fail-closed `optional_auth` and any narrowly scoped capability dependency.
- `src/backend/schemas/civilian.py` and/or `src/backend/schemas/community.py` — revised API contracts.
- `src/backend/tasks/report_photos.py`, `src/backend/tasks/community.py`, `src/backend/celery_config.py` — cleanup, expiry, registration, and schedule.
- `src/backend/alembic/versions/0007_civilian_phase5_schema.py` — persistent upgrade path.
- `src/postgres-init/86_civilian_phase5_schema.sql` — clean-volume equivalent (confirm next lexical number before editing).
- `src/frontend/src/app/page.tsx`, `src/frontend/src/app/tracking/page.tsx`, `src/frontend/src/app/tracking/v2/[report_id]/[tracking_token]/page.tsx` — emergency hierarchy, capability tracking, and pre-upload flow.
- `src/frontend/src/app/fire-stations/page.tsx`, `src/frontend/src/app/fire-stations/FireStationsMapInner.tsx` — list-first station UX.
- `src/frontend/src/lib/api/civilian.ts`, `src/frontend/src/lib/api/community.ts`, `src/frontend/src/lib/api/contributor.ts`, `src/frontend/src/lib/api/adminCommunity.ts`, `src/frontend/src/lib/api/reference.ts`, `src/frontend/src/lib/api/index.ts`, `src/frontend/src/lib/api.ts` — centralized API/types.
- `src/frontend/src/app/community/page.tsx`, `src/frontend/src/app/community/announcements/[slug]/page.tsx`, `src/frontend/src/app/community/events/[slug]/page.tsx`, `src/frontend/src/app/contributor/page.tsx`, `src/frontend/src/app/admin/community/page.tsx` — new route surfaces.
- `src/frontend/src/components/civilian/PhotoUpload.tsx`, new `src/frontend/src/components/community/StationDirectory.tsx` and related community components — reusable UI.
- Existing and new backend/frontend tests listed in the tasks — contract, security, migration, and interaction coverage.
- `system-wiki/frontend/route-map.md`, `system-wiki/backend/api-route-map.md`, `system-wiki/database/schema-overview.md`, `system-wiki/security/security-baseline.md`, `system-wiki/index.md`, `system-wiki/log.md`, `docs/superpowers/specs/2026-07-06-civilian-contributor-enhancement-design.md`, `CONTEXT.md` — synchronized durable documentation after behavior lands.

## New Files

- `src/backend/alembic/versions/0007_civilian_phase5_schema.py` — upgrade/downgrade for CMS, score-version, photo pending state, and RLS/audit contracts.
- `src/postgres-init/86_civilian_phase5_schema.sql` — clean-volume bootstrap equivalent.
- `src/backend/services/community_content.py` — CMS lifecycle and public locale/expiry projection.
- `src/backend/api/routes/community.py` — public Community Safety Hub API routes.
- `src/backend/api/routes/admin/community.py` — SYSTEM_ADMIN CMS API routes.
- `src/backend/schemas/community.py` — community/CMS Pydantic contracts if keeping them separate from `civilian.py` is cleaner.
- `src/backend/tasks/community.py` — expiry task adapter.
- `src/backend/tests/test_0007_civilian_phase5_schema.py` — migration/RLS/immutability contract tests.
- `src/backend/tests/test_community_content.py` — service lifecycle, localization, expiry, sanitization, and rollback tests.
- `src/backend/tests/integration/test_community_endpoints.py` — public/admin API integration tests.
- `src/backend/tests/integration/test_community_cms_rls.py` — CMS RLS/role/audit tests.
- `src/backend/tests/test_tracking_capabilities.py` — token hash, expiry, revocation, neutral-error, and no-coordinate tests.
- `src/frontend/src/app/community/page.tsx` — public hub.
- `src/frontend/src/app/community/announcements/[slug]/page.tsx` — announcement detail route.
- `src/frontend/src/app/community/events/[slug]/page.tsx` — event detail route.
- `src/frontend/src/app/contributor/page.tsx` — private contributor dashboard.
- `src/frontend/src/app/admin/community/page.tsx` — admin CMS surface.
- `src/frontend/src/lib/api/community.ts`, `src/frontend/src/lib/api/contributor.ts`, `src/frontend/src/lib/api/adminCommunity.ts` — frontend API slices/types.
- `src/frontend/src/components/community/StationDirectory.tsx` and its tests — reusable list/map directory.

## Dependencies

- Task 1 precedes Tasks 3–5 because score/status/auth contracts must be stable before endpoint and UI changes.
- Task 2 must precede Tasks 3, 5, and 6 because trust snapshots, pending photos, CMS versions, pointers, RLS, and indexes need to exist before service code.
- Task 4 must precede frontend tracking changes in Task 7 and must be coordinated with Task 5 because report submission and capability issuance/ownership are coupled.
- Task 5 must precede the root-page frontend changes in Task 7; the report form cannot send photo IDs until pre-upload and atomic attach are available.
- Task 6 must precede the public/admin frontend routes in Task 7 and station integration in Task 8.
- Task 8 may reuse the existing reference endpoint and can proceed in parallel with CMS work after the shared API/UI contract is agreed.
- Task 9 follows implementation and re-reading of live files; Task 10 follows all code/test/docs changes.
- Production routing remains dependent on GitHub issue **#552**. Phase 5 may display already-persisted routing/fallback values, but must not claim uncontrolled public OSRM routing is production-ready.

## Risks

- **Status terminology mismatch:** the design text names `REJECTED_FALSE`, `REJECTED_INSUFFICIENT_EVIDENCE`, and `REJECTED_OUT_OF_SCOPE`, while live schema/code use `REJECTED_BOGUS`, `REJECTED_INSUFFICIENT`, and `REJECTED_TIMEOUT`. Implement the explicit mapping against the live enum and update the spec before merging; do not silently add statuses.
- **Timestamp tolerance is not numerically fixed in the approved text.** Before implementing the evidence signal, record one server-side tolerance (and timezone/clock-skew rule) in the spec and test exact boundary behavior. A reasonable candidate is 24 hours, but this must be confirmed rather than guessed.
- **Current photo schema is post-submit and non-null `report_id`; changing it to pending rows requires a carefully tested migration and RLS policy for rows without a report. Do not use a broad `BYPASSRLS` session to make the transition work.
- **Current optional-auth tests intentionally expect invalid 401/403 credentials to become anonymous.** Update those tests as part of the security contract; otherwise a green suite will encode the wrong behavior.
- **Current tracking UI/API has both capability-token v2 and device-ID legacy paths.** Removing the legacy path can break existing bookmarks/offline caches; preserve only a time-bounded compatibility redirect or require a valid capability, and test no report enumeration.
- **The existing `civilian_contributors` RLS SELECT policy allows any `CIVILIAN_REPORTER` to select contributor rows.** Tighten it to the current-user row before exposing private dashboard data.
- **Public CMS XSS:** structured/plain-text content is safest. If rich text is retained, sanitize on write and render without `dangerouslySetInnerHTML`; preview and public projections must share the same sanitizer.
- **Audit immutability:** the wiki documents that the final partitioned `system_audit_trails` parent lacks earlier UPDATE/DELETE rules. Do not call CMS/photo audit work complete without final-schema enforcement tests or explicitly carrying the pre-existing gap.
- **External routing privacy:** exact report coordinates must not be sent directly to public OSRM in production. Track #552 separately and keep a documented fallback/degraded state until controlled routing is deployed.
- **Performance validation:** live trust-score aggregation needs a representative benchmark and explicit latency target before caching is introduced. If the target is missed, use the benchmark evidence to justify Redis or materialized-view caching.
- **Frontend privacy/offline:** contributor scores and report history are private and should not be placed into existing shared/offline caches without per-user encryption/account-switch cleanup coverage.

## Validation Evidence Expected From Implementer

- `changed-files`: exact source/migration/docs paths changed after implementation.
- `tests-added`: exact backend/frontend/schema/security tests added or updated.
- `commands-run`: focused Ruff/Pytest/Vitest/build/migration commands with working directories.
- `validation-output`: migration/RLS/audit/XSS/token/photo atomicity results, plus CI-equivalent gate results.
- `residual-risks`: issue #552, status/timestamp decisions, and any pre-existing audit gap that remains open.
- `no-staged-files`: verify with final `git status --short`; do not stage files in the implementation worker.

## Acceptance Report

This artifact is a plan only; no implementation files or tests were changed.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "The plan limits scope to the approved Phase 4 normalized trust-score migration and Phase 5 Community Safety Hub contracts, with explicit file ownership, sequencing, and no code edits in this planning run."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "The plan names current and new files, ordered implementation tasks, acceptance tests, security/RLS/PII/XSS controls, validation commands, issue #552 dependency, and residual risks sufficient for independent review."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "Repository inspection via functions.read/functions.grep/functions.find/functions.ls",
      "result": "passed",
      "summary": "Read project instructions, design spec, security/database/frontend/backend route maps, directly relevant source, migrations, and tests."
    },
    {
      "command": "Backend/frontend test and lint commands",
      "result": "not-run",
      "summary": "Implementation validation is intentionally deferred because this worker was instructed to create a plan only."
    }
  ],
  "validationOutput": [
    "No repository files were modified by this planning run.",
    "Current legacy leaderboard, linear trust formula, permissive optional_auth behavior, device-ID tracking paths, and post-submit photo schema were verified in live source and incorporated as prerequisites.",
    "Approved public route, private dashboard, CMS lifecycle, bilingual/expiry, capability-token, atomic photo, RLS/audit/PII/XSS, and station list/map requirements are represented in ordered tasks."
  ],
  "residualRisks": [
    "Production controlled routing is external dependency GitHub issue #552.",
    "Live rejection-status names need explicit mapping to the design's decided-outcome vocabulary.",
    "Photo timestamp-consistency tolerance needs a recorded numeric decision before implementation.",
    "The documented final-schema system-audit immutability gap remains a security dependency until verified/fixed."
  ],
  "noStagedFiles": true,
  "diffSummary": "No diff: plan artifact only; repository source was not edited.",
  "reviewFindings": [
    "No implementation blockers found beyond the explicitly recorded status-mapping, timestamp-tolerance, audit-gap, and routing dependency risks."
  ],
  "manualNotes": "Planner must re-read current source after any prerequisite edits and verify the next unused Alembic/bootstrap revision numbers before creating migrations."
}
```