# Civilian Contributor Phase 5 — Slices C, D, E Handoff

Parent session: 2026-07-12. Slices A–B were completed earlier (see
`2026-07-12-civilian-contributor-phase-5-slice-a-handoff.md`, Slice B appendix).
This doc records the decisions, residual risks, and next-slice contracts for
Slices C, D, E. All three passed both review gates (spec + quality). Nothing
was committed (parent does not commit without user approval).

## Slice C — Registered-contributor pending-photo attach helper ✅
- **Files:** `src/backend/alembic/versions/0011_registered_photo_ownership_helper.py`,
  `src/postgres-init/90_registered_photo_ownership.sql`,
  `src/backend/tests/test_0011_registered_photo_ownership_schema.py` (10 static tests).
- **Helper:** `wims.attach_registered_photos(p_user_id UUID, p_report_id INTEGER,
  p_photo_ids UUID[]) RETURNS BOOLEAN` — `SECURITY DEFINER`,
  `SET search_path = wims, pg_temp`, `REVOKE ... FROM PUBLIC` + `GRANT EXECUTE ... TO wims_app`.
  Mirrors the anonymous helper `attach_anonymous_photos` (Slice B).
- **Decision:** revision numbering is `0011`/`90` because the live head when this
  slice started was `0010`/`89`. The plan's `0007`/`86` reference was stale.
- **Residual:** live RLS execution gate skipped (environment has only superuser
  `postgres`; the opt-in integration test requires `RUN_CIVILIAN_PHOTO_RLS_TESTS=1`
  + a non-superuser `wims_app_user`).
- **Next-slice contract (D):** wire the helper into `POST /api/civilian/reports`
  with a server-derived `user_id`.

## Slice D — Wire registered attach into report submission ✅
- **Files:** `src/backend/api/routes/civilian.py`,
  `src/backend/services/report_photos.py` (adapter `attach_registered_pending_photos`),
  `src/backend/tests/test_civilian_api.py`, `src/backend/tests/test_report_photos.py`,
  `src/backend/tests/integration/test_report_photos_rls.py`.
- **Blocking bug fixed during review:** the deliberate `raise HTTPException(422)`
  (photo-attach rejected, capability missing, wrong owner) was caught by the generic
  `except Exception` and re-raised as **500**. Fixed by adding
  `except HTTPException: db.rollback(); raise` immediately before the generic
  handler. This also corrected a latent Slice B defect (anonymous branch had the
  same 422→500 problem).
- **Decision:** `contributor_user_id` is set from the `optional_auth`-derived
  registered identity for registered reports (server-derived, never request body) —
  the registered analog of the anonymous `anonymous_session_id` binding required by
  the Slice C helper's `contributor_user_id = p_user_id` check.
- **Residual:** the route-level 422+rollback path is asserted only indirectly
  (helper-level FALSE paths + adapter boolean are unit-tested; the opt-in live
  integration test covers owner-binding). No endpoint-level test POSTs the route with
  `photo_ids` and asserts the 422+no-orphan. Live RLS skipped (as Slice C).
- **Next-slice contract (E):** CMS backend schema/migration.

## Slice E — CMS backend schema + migration ✅
- **Files:** `src/backend/alembic/versions/0012_community_content_schema.py`,
  `src/postgres-init/91_community_content_schema.sql`,
  `src/backend/tests/test_0012_community_content_schema.py` (12 static tests),
  `system-wiki/database/schema-overview.md`, `system-wiki/security/security-baseline.md`,
  `system-wiki/log.md`, `system-wiki/index.md`.
- **Tables:** `wims.community_content` (live pointer row: slug, lifecycle_status,
  `published_version_id` FK, expires_at, urgent_banner, optimistic `row_version`)
  and `wims.community_content_version` (immutable append-only versions: content_id
  FK, version_number, title/body en+uk, metadata_json, content_hash, creator).
- **RLS:** `ENABLE` + `FORCE ROW LEVEL SECURITY` on both. Public/anon/authenticated
  `SELECT` only where `lifecycle_status='PUBLISHED' AND (expires_at IS NULL OR
  expires_at > now())`. Writes gated to `SYSTEM_ADMIN` via the repo convention
  `wims.current_user_role() = 'SYSTEM_ADMIN'` (from `10_rls_policies.sql`). Grants to
  `wims_app` only — **no** PUBLIC, **no** BYPASSRLS.
- **DECISION — Option A (forced deviation, supervisor-approved):** PostgreSQL
  requires **IMMUTABLE** functions in a partial-index predicate, and `now()` is
  **STABLE**, so the at-most-one urgent-banner partial unique index uses
  `WHERE urgent_banner = TRUE AND lifecycle_status = 'PUBLISHED'`
  (the volatile `expires_at > now()` clause is omitted). Expiry is enforced at
  **read time** by the Slice F service via the SQL predicate (the repo-wide pattern,
  and exactly what the plan's Task 6 specifies: "Apply expiry in the SQL predicate
  on every read, even if Celery is delayed"). This deviates from the plan's exact
  WHERE clause; it is documented in the migration, the bootstrap, and both wiki pages.
- **Validation note:** the worker executed the `91` bootstrap end-to-end against a
  throwaway Postgres (reached `COMMIT`, all indexes/policies/grants created) — stronger
  than the static-only checks of Slices A–D.
- **Contributor snapshot:** `86_civilian_contributor_snapshot.sql` was already carrying
  `formula_version` and had already dropped `opt_in_leaderboard`, so it was intentionally
  **not** edited; migration `0012` adds idempotent `ADD COLUMN IF NOT EXISTS` /
  `DROP COLUMN IF EXISTS` ALTERs.
- **Optional findings (not blocking):** version-table append-only is discipline-enforced
  (the `FOR ALL` write policy still permits a SYSTEM_ADMIN `UPDATE`/`DELETE`) — consistent
  with the repo's known `incident_verification_history` enforcement gap and the slice's
  own docstring; cross-content `published_version_id` is not FK-checked (Slice F's job);
  `formula_version` is nullable on an Alembic-upgraded volume vs `NOT NULL DEFAULT` on a
  fresh bootstrap (harmless drift).
- **Residual:** live least-privilege RLS execution still deferred (no non-superuser creds);
  the opt-in live RLS test is deferred to Slice F.
- **Next-slice contract (F):** community content service + public/admin routes + expiry
  Celery sweep + audit emission, reading only published/non-expired rows.

## Cross-slice residual risks (all slices A–E)
- **Live RLS / helper execution gate unrun** for Slices B, C, D, E integration tests:
  requires a disposable Postgres with a non-superuser `wims_app_user` and env flags
  (`RUN_CIVILIAN_PHOTO_RLS_TESTS=1`, `RUN_COMMUNITY_RLS_TESTS=1`). Must run before merge.
- PR #553 (`feat/civilian-contributor-phase-5`) is `CONFLICTING`/`DIRTY` against
  `origin/master` (`a6aa8793`); rebase/resolve before merge.
- Known QA blocker from the plan still open (outside A–E scope): plaintext EXIF columns
  in `report_photos.py`; contributor snapshot RLS not owner-scoped; trust-score formula
  missing timestamp term; audit immutability gap. Tracked in the gap register.

## Slice F — Community Safety Hub service, routes, expiry, and audits ✅
- **Files:** `src/backend/services/community_content.py`,
  `src/backend/api/routes/community_content.py`,
  `src/backend/api/routes/admin/community.py`, `src/backend/schemas/community.py`,
  `src/backend/tasks/expire_content.py`, `src/backend/auth.py` (`get_public_db_with_rls`),
  `src/backend/celery_config.py`, route/admin/main wiring, service/route/task/RLS tests,
  and the four relevant wiki pages.
- **Public security boundary:** public routes use `get_public_db_with_rls`, backed by
  `_SessionLocal` (`wims_app_user`) with optional user context — never the
  admin-backed `get_db()`. The service still applies the published/non-expired SQL
  predicate as defense in depth. Admin mutations use existing `get_system_admin` +
  `get_db_with_rls` dependencies.
- **Mutation model:** draft creation and edits insert immutable version rows; publish
  inserts a new version and conditionally moves the pointer using `row_version`; a
  stale conditional update raises 409. Archive and expiry increment `row_version`,
  preventing stale publishes from resurrecting archived content. UUID IDs are stored
  in audit `new_values` because `system_audit_trails.record_id` is INTEGER.
- **Expiry:** `tasks.expire_content.expire_published_content` is consistently imported,
  decorated, and scheduled every five minutes. It uses `RETURNING id`, increments
  `row_version`, emits a best-effort summary audit within a savepoint, then commits.
  Duplicate pre-existing Celery beat key was removed.
- **Version immutability:** `community_content_version` grants/policies permit only
  SELECT/INSERT; UPDATE/DELETE are absent. Migration/bootstrap parity tests cover this.
- **XSS contract:** content remains plain text; frontend must render via escaped React
  text and never `dangerouslySetInnerHTML`; no sanitizer dependency added.
- **Validation:** full backend `ruff check .` and `ruff format --check .` pass (306
  files formatted); CMS/service/routes/task suite **40 passed, 4 skipped**. Quality
  gate PASS. Live non-superuser RLS remains an explicit pre-merge gate requiring
  `RUN_COMMUNITY_RLS_TESTS=1`, `SQLALCHEMY_DATABASE_URL` for a non-superuser, and
  `DATABASE_ADMIN_URL`.

## Slice H — Contributor dashboard ✅
- **Files:** `src/frontend/src/app/contributor/page.tsx` + tests,
  `src/frontend/src/lib/api/contributor.ts` + tests, frontend/backend route-map and
  log updates, `src/backend/api/routes/civilian.py` contributor dependency/test updates.
- **Behavior:** authenticated `/contributor` dashboard consumes existing
  `/api/civilian/contributor/me`, `/reports`, and `/stats` contracts for trust/badge,
  lifetime/monthly metrics, and paginated owned reports. It handles loading, empty,
  operational, 401/403, pagination, and accessible states without localStorage/offline
  PII caching or mutations.
- **Security fix:** all three backend routes now use `get_db_with_rls` rather than the
  admin-backed `get_db`; server-side `CIVILIAN_REPORTER` checks and parameter-bound
  owner predicates remain authoritative. Responses set `Cache-Control: no-store, private`;
  frontend API calls use authenticated transport with `cache: 'no-store'`.
- **Validation:** backend contributor suite **30 passed**; frontend contributor suite
  **12 passed**; Ruff/ESLint/diff clean; final security gate PASS. Production frontend
  build remains blocked by existing undefined OIDC Authority URL during unrelated
  prerender. Live non-superuser RLS owner isolation remains a required pre-merge gate.
- **Next-slice contract (I):** SYSTEM_ADMIN CMS UI against existing community content
  admin routes; do not duplicate authorization client-side or expose admin controls to
  contributors/public users.

## Slice G — Public Community Safety Hub frontend ✅
- **Files:** `src/frontend/src/app/community/page.tsx`,
  `src/frontend/src/app/community/[slug]/page.tsx`,
  `src/frontend/src/components/community/CommunityHubContent.tsx` + tests,
  `src/frontend/src/lib/api/community.ts` + tests, frontend route-map/index/log updates.
- **Behavior:** public bilingual Hub/detail pages consume `/api/community/hub` and
  `/api/community/{slug}` through the centralized `publicApiFetch` transport. The Hub
  supports urgent-banner projection, content-type filtering, `en`/`uk` switching with
  English restoration/fallback, loading/error/empty states, accessible native controls,
  and escaped plain-text rendering. Detail maps only real 404s to `notFound()` and
  renders an accessible operational-error state for other failures.
- **Runtime contract:** API parser validates literal content type/language, required
  fields, nullable timestamps, and nullable object metadata; malformed payloads reject
  through the existing parse-error path. Backend response schemas and `type` filter
  query use the `CommunityContentType`/`CommunityLanguage` literals.
- **Tests:** API malformed/shape tests (9), Hub component tests (6), detail 404/error
  tests (3), plus backend route/service tests (28) all pass. Frontend focused ESLint
  and backend focused Ruff pass; full frontend lint has only pre-existing warnings.
- **Build gap:** production `npm run build` reaches compilation but fails during the
  existing `/_not-found` prerender because `OIDC Authority URL is undefined`; this is
  an environment/configuration prerequisite unrelated to Slice G community imports.
  Backend live non-superuser RLS remains the shared pre-merge gate.
- **Next-slice contract (H):** contributor dashboard UI; preserve server-side RBAC,
  encrypted/offline boundaries, and do not expose CMS admin controls in contributor UI.
- **Next-slice contract (G):** build the Community Safety Hub frontend against the
  public `/api/community/hub` and `/api/community/{slug}` contracts. Preserve plain
  text rendering, loading/error/empty states, accessibility, and existing PWA/offline
  boundaries; do not connect the browser directly to PostgreSQL.
