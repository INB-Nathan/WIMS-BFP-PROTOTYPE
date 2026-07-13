# Session Handoff: Civilian Contributor Phase 5 — Slice A (Anonymous Pending Photo Insertion)

**Date:** 2026-07-12  
**Branch:** `feat/civilian-contributor-phase-5`  
**Pull request:** [#553](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/pull/553)  
**Base:** `master`  
**Parent handoff:** `docs/superpowers/handoffs/2026-07-11-civilian-contributor-phase-5-session-handoff.md`

## Purpose

Complete **Slice A** of the Phase 5 civilian contributor work: wire the anonymous
capability-bound pending photo insertion that the previous session deliberately
left as `501`/deferred. Subagent-driven development was used: read-only context
and review subagents ran first; the parent was the single writer for the slice;
no subagent committed files.

## What changed in this slice

### Backend capability-bound insertion

- New migration `src/backend/alembic/versions/0010_anonymous_pending_photo_insert.py`
  and clean-bootstrap `src/postgres-init/89_anonymous_pending_photo_insert.sql`
  add `wims.insert_anonymous_pending_photo(...)`.
- The function is `SECURITY DEFINER` with `SET search_path = wims, pg_temp`, takes
  a `p_raw_token`, validates it via `wims.validate_anonymous_session`, derives
  `anonymous_session_id` internally, forces `report_id`/`attached_at`/`uploader_user_id`/
  `uploader_device_id` `NULL`, serializes a one-outstanding-pending-row cap with a
  transaction advisory lock, classifies same-owner pending retries as `duplicate`,
  and returns `(photo_id, duplicate, cap_reached)`. It is granted only to `wims_app`.
- `src/backend/services/anonymous_sessions.py` adds `ValidatedAnonymousCapability`
  (raw token hidden from `repr`) and the `insert_anonymous_pending_photo()` adapter.
- `src/backend/auth.py` adds `get_anonymous_session_capability()` (header-only bearer
  validation, returns a transient, non-repr capability object; `get_anonymous_session_id`
  remains UUID-only compatibility plumbing).
- `src/backend/api/routes/civilian.py` `/photos/upload` now depends on
  `get_anonymous_session_capability` instead of `get_anonymous_session_id`.
- `src/backend/services/report_photos.py` `upload_pending_photo()` accepts
  `anonymous_capability`, routes anonymous requests to the new helper, and keeps
  audit + fail-closed file cleanup compensation. Legacy post-submit `device_id`
  ownership and registered `CIVILIAN_REPORTER` upload are unchanged.

### Documentation/wikis (live behavior changed)

- `system-wiki/security/security-baseline.md`, `system-wiki/backend/api-route-map.md`,
  `system-wiki/database/schema-overview.md`, `system-wiki/index.md`,
  `system-wiki/log.md` updated to describe the implemented helper-bound anonymous
  path (no longer `501`/deferred).
- Stale `TODO(photo-preupload)` and anonymous-deferred comments in
  `src/postgres-init/87_photo_preupload_schema.sql` and
  `src/backend/alembic/versions/0008_photo_preupload_schema.py` updated to the
  helper-bound contract.
- Stale `PendingPhotoUploadResponse` docstring in `src/backend/schemas/civilian.py`
  corrected.

### Tests

- `src/backend/tests/test_0010_anonymous_pending_photo_insert_schema.py` (new):
  migration/bootstrap parity, capability-bound signature, one-pending cap,
  owner-bound idempotency, forced NULL owner/attachment fields, narrow grant,
  no `BYPASSRLS` / permissive policy.
- `src/backend/tests/test_pending_photo_upload.py`: anonymous capability path,
  null owner fields, duplicate/cap/failure cleanup, and real audit emission
  assertions (`action_type="PHOTO_UPLOAD_PREUPLOAD"`).
- `src/backend/tests/test_anonymous_sessions.py`, `src/backend/tests/test_civilian_api.py`:
  capability plumbing and route response.
- `src/backend/tests/integration/test_report_photos_rls.py`: best-effort cleanup,
  admin-superuser skip moved to the app connection, and a new live helper matrix
  (`test_anonymous_pending_helper_binds_owner_cap_and_idempotency`) covering
  owner binding, idempotency, cap, foreign-client-ID neutrality, revocation, and
  expiry. This test is opt-in (`RUN_CIVILIAN_PHOTO_RLS_TESTS=1`) and remains skipped
  in this environment.

## Validation run (this environment)

- Focused backend suite: **45 passed** (`test_pending_photo_upload`,
  `test_0010_*`, `test_anonymous_sessions`, `test_civilian_api`,
  `test_0008_*`, `test_0009_*`).
- `ruff check` and `ruff format --check` pass on touched Python files.
- `git diff --check` passes.
- Live disposable PostgreSQL: the `0010`/`89` `CREATE FUNCTION` + `REVOKE` + `GRANT`
  block was executed inside a rolled-back transaction against the local Postgres
  container and succeeded (signature mismatch found during review was fixed: the
  grant/revoke type list had one extra `TEXT`/misaligned `INTEGER`).

## Known gaps / required before merge

1. **Live RLS/helper execution gate is unrun.** The opt-in integration tests need a
   non-superuser `SQLALCHEMY_DATABASE_URL` + `DATABASE_ADMIN_URL` and
   `RUN_CIVILIAN_PHOTO_RLS_TESTS=1`. This environment has only the superuser
   `postgres` connection, so the two integration tests skip. Run them in a disposable
   Postgres with a least-privilege `wims_app_user` before approving.
2. **Parallel review coverage was partial.** The async SQL-correctness and security
   reviewers timed out; one reviewer (tests/docs) completed. The parent manually
   validated the SQL signature and migration semantics. Re-run independent security
   and SQL reviewers against the final diff before merge.
3. **Pre-existing unresolved QA blockers from the plan remain outside this slice:**
   plaintext EXIF columns still written elsewhere, contributor snapshot RLS not
   owner-scoped, trust-score formula missing a timestamp-consistency term, and the
   audit immutability gap. These are tracked separately and not addressed here.
4. **Unstaged `.pi` changes** (`.pi/settings.json` modified; `.pi/agents/`,
   `.pi/chains/` untracked) are unrelated to this slice. Preserve them; do not stage
   unless explicitly asked.

## Next slice (now completed — see Slice B addendum below)

### Slice B — Atomic report creation and photo attach

- Accept photo IDs / client photo IDs during report submission.
- Set `citizen_reports.anonymous_session_id` from the validated capability in the
  same transaction.
- Lock the report and complete the pending photo batch via the existing attach
  helper; reject cross-owner, mixed-owner, duplicate, partial, expired, or
  already-attached batches neutrally.
- Create the report + audit as one transaction with rollback coverage.
- Add idempotent retry and live RLS/audit tests.

---

# Session Handoff Addendum: Civilian Contributor Phase 5 — Slice B (Atomic report + anonymous pending-photo attach)

**Date:** 2026-07-12
**Branch:** `feat/civilian-contributor-phase-5` (continues Slice A worktree)
**Parent handoff:** this file (Slice A)

## Purpose

Complete **Slice B** of the Phase 5 civilian contributor work: wire atomic report
creation together with anonymous pending-photo attach so a single `POST
/api/civilian/reports` request can both create the civilian report and bind its
validated-session pending photos in one transaction, with fail-closed rollback and
a `PHOTO_UPLOAD_ATTACH` audit row.

## What changed in this slice

### Backend atomic attach (reused prior context)

- `src/backend/schemas/civilian.py` `CivilianReportCreate.photo_ids` (max 20 UUIDs,
  optional) — added in prior context.
- `src/backend/services/anonymous_sessions.py` `attach_anonymous_pending_photos(
  db, capability, report_id, photo_ids) -> bool` adapter — added in prior context;
  calls `wims.attach_anonymous_photos(:p_raw_token, :p_report_id,
  :p_photo_ids::uuid[])` and returns `bool(value)`. `ValidatedAnonymousCapability
  .raw_token` stays `repr=False`.
- `src/backend/api/routes/civilian.py` `submit_civilian_report`: already depends on
  `get_anonymous_session_capability`, already computes `anonymous_session_id` from
  the capability, and both INSERT column lists + value dicts already include
  `anonymous_session_id`. **This slice adds** inside the existing `try:` block
  (before the `CIVILIAN_REPORT_SUBMIT` audit) the atomic attach: when `body.photo_ids`
  is set, raise neutral `422` if the capability is missing, call
  `attach_anonymous_pending_photos(...)`, raise neutral `422` if it returns `False`,
  and emit a `PHOTO_UPLOAD_ATTACH` audit (`record_id=report_id`,
  `new_values={"photo_ids": [...]}`, `sensitive=True`). Report INSERT + attach +
both audits commit together; any failure rolls back via the existing `except`.

### Documentation/wikis (live behavior changed)

- `system-wiki/backend/api-route-map.md`: `/reports` POST row notes `photo_ids` +
  neutral 422; new **Civilian Report + Anonymous Pending-Photo Attach (Slice B)**
  section.
- `system-wiki/database/schema-overview.md`: `88` helper note now states the report
  route sets the owner and calls `attach_anonymous_photos`.
- `system-wiki/security/security-baseline.md`: anonymous report+photo ownership now
  bound via capability; no new policy/BYPASSRLS; neutral 422 on rejected batches.
- `system-wiki/index.md` and `system-wiki/log.md`: dated Slice B entries appended.

### Tests

- `src/backend/tests/test_anonymous_sessions.py`: `test_attach_pending_photos_
  delegates_to_helper_and_passes_raw_token` and `test_attach_pending_photos_
  returns_false_on_null_result` — assert SQL contains `wims.attach_anonymous_photos`,
  raw token is passed, and the bool result is returned with no commit.
- `src/backend/tests/test_civilian_api.py`: `test_report_post_route_wires_
  anonymous_capability_dependency` (asserts `get_anonymous_session_capability` in the
  `/reports` route dependency callables) and `test_civilian_report_create_has_
  photo_ids_field` (asserts `photo_ids` in `CivilianReportCreate.model_fields`).
- `src/backend/tests/integration/test_report_photos_rls.py`: opt-in live test
  `test_anonymous_attach_binds_owner_and_rejects_cross_owner` covering same-owner
  TRUE + bind, cross-owner FALSE, re-attach FALSE, and duplicate-array FALSE. Skipped
  without `RUN_CIVILIAN_PHOTO_RLS_TESTS=1` + non-superuser creds.

## Validation run (this environment)

- Targeted backend suite: **34 passed** (`test_anonymous_sessions`, `test_civilian_api`,
  `test_0009_*`, `test_0010_*`).
- `ruff check` and `ruff format --check` pass on touched Python files (two files
  auto-formatted, then verified clean).
- `git diff --check` passes.
- Live disposable PostgreSQL execution of the new integration test **was not run**
  (no non-superuser `wims_app_user` credentials in this environment); it remains an
  opt-in skipped gate requiring `RUN_CIVILIAN_PHOTO_RLS_TESTS=1`.

## Known gaps / required before merge

1. **Live RLS/attach gate is unrun** (same residual as Slice A): run
   `test_anonymous_attach_binds_owner_and_rejects_cross_owner` in a disposable
   Postgres with a least-privilege `wims_app_user` before approving.
2. **No SQL/migration changes in this slice** — the `0009`/`88` helper was already
   present; this slice only wires the application transaction. No new RLS policy or
   `BYPASSRLS` was introduced.
3. **Unstaged `.pi` changes** (`.pi/settings.json` modified; `.pi/agents/`,
   `.pi/chains/` untracked) and other pre-existing modified files (e.g.
   `src/backend/alembic/versions/0008_*.py`, `src/backend/auth.py`, etc.) are
   unrelated to this slice. Preserve them; do not stage unless explicitly asked.

## Safety boundaries (unchanged)

- No broad `BYPASSRLS`, caller-set owner IDs, or unrestricted GUCs.
- Raw capability accepted only via Authorization header, used transiently, never
  logged/persisted in Python or placed in a URL; `new_values` carries only
  `photo_ids`, never the raw token.
- `FORCE ROW LEVEL SECURITY` preserved; no permissive `report_photos` policy added.
- Do not turn `/` into the Community landing page or reintroduce a public leaderboard.
