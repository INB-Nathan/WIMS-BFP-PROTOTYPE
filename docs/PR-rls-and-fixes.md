# PR: Encoder/Validator Page Refactor + M15a Row-Level Security

**Branch:** `fix--refactored-enc-val-pages-and-M15-row-level-sec`
**Base:** `master`
**Authors:** Claude (Part 1), Codex (Part 2)

---

## Summary

This PR delivers three grouped issues from `local docs/issues.md` plus a set of accumulated UI/login fixes and RLS infrastructure required to make row-level security functional end-to-end.

1. **Component extraction** — `validator/page.tsx` and `regional/page.tsx` reduced below 1,000 lines via structured component extraction.
2. **Five cleanup fixes** — stale test fields, wiki gaps, PR body update, MapPicker display names.
3. **Ref table RLS (M15a)** — `ref_regions`, `ref_provinces`, `ref_cities` now enforce region-scoped access for `REGIONAL_ENCODER`.
4. **RLS infrastructure** — switches app connection from `postgres` superuser to `wims_app_user`; adds startup self-healing patches; fixes `SECURITY DEFINER` recursion on RLS helper functions.
5. **Login / auth fixes** — TOTP overflow, post-login redirect cross-role bug, Update Profile enforcement, IncidentForm draft isolation.
6. **Dashboard filter fixes** — status chip no longer auto-mutates date filter; `loadStatsRef` double API call removed.

---

## Part 1 — RLS Infrastructure + UI Fixes (Claude)

### Row-Level Security infrastructure

**Problem:** The app connected as the `postgres` superuser, which bypasses all RLS policies. All `wims.*` RLS policies were written correctly but had no effect.

- **`src/postgres-init/43_app_login_role.sql`** — New migration. Creates `wims_app` role group and `wims_app_user` login role with least-privilege grants on all `wims.*` tables. Idempotent.
- **`src/docker-compose.yml`** — `DATABASE_URL` changed from `postgres` superuser to `wims_app_user`. Added `DATABASE_ADMIN_URL` pointing to `postgres` superuser for auth bootstrap and schema patches.
- **`src/backend/database.py`** — Added `_AdminSessionLocal` bound to `DATABASE_ADMIN_URL`. `get_db()` uses admin URL for auth lookups. `get_db_with_rls()` uses app URL with RLS context set.
- **`src/backend/auth.py`** — `get_db_with_rls` now declares `get_current_wims_user` as a FastAPI `Depends()` so `request.state.wims_user` is populated before RLS context is set.
- **`src/backend/main.py`** — `apply_schema_patches()` runs at startup. Idempotently creates `wims_app_user`, grants permissions, enables RLS on ref tables, recreates helper functions as `SECURITY DEFINER`, and broadens the users SELECT policy. Self-healing on existing deployments without `down -v`.
- **`src/postgres-init/09_rls_helpers.sql`** — `current_user_role()` and `current_user_region_id()` marked `SECURITY DEFINER`. Prevents infinite recursion where RLS policies invoke helper functions that query the same RLS-protected tables.
- **`src/postgres-init/10_rls_policies.sql`** — `users_self_or_admin_select` broadened to allow `REGIONAL_ENCODER`, `NATIONAL_VALIDATOR`, and `NATIONAL_ANALYST` to JOIN `wims.users` (required for incident queries that join encoder/validator rows).

### Ref table RLS (M15a)

- **`src/postgres-init/42_ref_table_rls.sql`** — Enables RLS on `wims.ref_regions`, `wims.ref_provinces`, `wims.ref_cities`. `REGIONAL_ENCODER` sees only rows for their assigned region; `NATIONAL_VALIDATOR`, `NATIONAL_ANALYST`, and `SYSTEM_ADMIN` see all. `ref_fire_stations` intentionally excluded (public emergency reference). Startup patch in `main.py` applies this to existing deployments.
- **`src/backend/tests/test_ref_table_rls.py`** — New integration test. Verifies encoder sees only own region's ref data; analyst sees all 18 regions.

### Login / Keycloak fixes

- **`src/keycloak/themes/wims-bfp/login/resources/css/wims-custom.css`** — Complete layout rework. Root cause of TOTP overflow: `align-items: stretch` on `.pf-v5-c-login__container` locked the right panel to exactly 100vh. Fix: `align-items: flex-start` on container; `position: sticky; top: 0; height: 100vh` on left panel; `min-height: 100vh` on right panel. OTP digit grid fixed to fixed-width columns. Mobile breakpoints updated.
- **`src/keycloak/themes/wims-bfp/login/login-config-totp.ftl`** — TOTP setup page restructured into a two-column grid with numbered step list on the left and QR code + OTP input on the right.
- **`src/keycloak/themes/wims-bfp/login/login.ftl`**, **`login-otp.ftl`** — Markup updates to match CSS selectors.
- **`src/keycloak/bfp-realm.json`** and **`src/keycloak/import/bfp-realm.json`** — `UPDATE_PROFILE` `defaultAction` changed `false` → `true`. Added `userProfileConfig` marking `firstName` and `lastName` as required fields for the `user` role (Keycloak 24 marks them optional by default). `http://localhost:8090/*` added to client redirect URIs.
- **`scripts/seed-dev-users.sh`** and **`scripts/seed-dev-users.ps1`** — Push `UPDATE_PROFILE defaultAction=true` and `userProfileConfig` to a live Keycloak instance via `kcadm`. Applies without `down -v`. Seed users are unaffected — `requiredActions=[]` explicitly cleared, profile fields pre-populated.

### Post-login redirect fix

- **`src/frontend/src/lib/roleRedirect.ts`** — New module. `defaultRouteForRole(role)` maps roles to canonical dashboard paths. `resolvePostLoginRedirect(role, savedRedirect, origin)` resolves the post-login destination with guards: cross-origin redirects discarded; generic paths use role default; saved redirects pointing to another role's `/dashboard/*` sub-path are discarded.
- **`src/frontend/src/lib/__tests__/roleRedirect.test.ts`** — 5 tests: default routes, stale generic paths, cross-role dashboard rejection, own-dashboard deep-link preservation.
- **`src/frontend/src/app/callback/page.tsx`** — After session refresh, fetches `/api/auth/session` to resolve role before redirect. Uses `resolvePostLoginRedirect`.
- **`src/frontend/src/app/login/page.tsx`** and **`src/frontend/src/app/dashboard/page.tsx`** — Routing simplified using `defaultRouteForRole`.

**Bug fixed:** `transport.ts` saves `window.location.href` to sessionStorage on any 401. If that URL was `/dashboard/validator` (from a prior session or accidental navigation), an encoder logging in next was sent to the validator page, which returned 403 `NATIONAL_VALIDATOR privileges required`. Fix: `resolvePostLoginRedirect` rejects any saved redirect starting with `/dashboard/` that does not start with the user's own dashboard prefix.

### Dashboard filter fixes

- **`src/frontend/src/app/dashboard/regional/page.tsx`** — `selectStatusFilter` no longer mutates `dateFilter`. Removed `loadStatsRef` pattern that fired a redundant `loadStats` call inside `loadIncidents` on every filter change.
- **`src/frontend/src/app/dashboard/validator/page.tsx`** — `selectStatusFilter` no longer resets `dateFilter` to `"today"` on `STATUS_FILTER_ALL`. Removed redundant header block. Fixed card spacing.
- **`src/frontend/src/components/Sidebar.tsx`** — Operational Map link added to the validator sidebar section.

### IncidentForm draft isolation

- **`src/frontend/src/components/IncidentForm.tsx`** — Draft localStorage key changed from shared `wims:incident_draft` to `wims:incident_draft:<user_id>`. Prevents draft from one account appearing in another user's restore prompt on the same device. Auto-save only fires after a user interaction (`userEditedDraftRef` guard).

### Infrastructure

- **`src/nginx/nginx.conf`** — Added `server` block for `server_name localhost 127.0.0.1` on ports 80 and 8090 for local dev HTTP passthrough. Existing HTTPS block keyed on `wimsbfp.tech` is unaffected.
- **`src/frontend/.dockerignore`** — Added `.env.local` to prevent local override files from leaking into the Docker build context.

---

## Part 2 — Component Extraction + Small Fixes (Codex)

### Component extraction

- `src/frontend/src/app/dashboard/validator/page.tsx` — **1,379 → 967 lines**. Extracted: `ValidatorDuplicateModal`, `AcceptConfirmModal`, `BulkApproveConfirmModal`, `BulkDuplicateModal`, `ActionModal`, `IncidentTableRow`, `types.ts` into `src/frontend/src/components/validator/`.
- `src/frontend/src/app/dashboard/regional/page.tsx` — **1,181 → 965 lines**. Extracted: `NotificationToasts`, `IncidentCard`, `WildlandFireBreakdown` into `src/frontend/src/components/regional/`. `InfoBlock` extracted to `src/frontend/src/components/ui/` and added to barrel export.

### Cleanup fixes

- Removed `station_code: "TST"` from `test_immutable_records.py` create payload (column dropped in migration 39).
- Updated PR #143 body via `gh pr edit 143` with "Changes Since Review" section.
- Removed `station_code` from `system-wiki/subsystems/references/regional-api-ref.md` lines 350 and 397.
- Added migration-39 cross-reference to `system-wiki/database/sql-init-files.md`.
- Stripped `, Philippines` suffix from all 14 fallback `display_name` strings in `src/frontend/src/components/MapPickerInner.tsx`.

### Dev encoder accounts (18 regions)

- Replaced offset encoder usernames with canonical region-code names (`encoder_ncr` through `encoder_nir`). `encoder_ncr` retains the old `encoder_test` deterministic UUID.
- Updated seed scripts, SQL bootstrap files, and both Keycloak realm JSONs. Seed scripts repair legacy usernames in place, set `Password123!`, clear `requiredActions`, and print the seeded user list.
- `src/backend/tests/test_dev_user_seed_mapping.py` — 3 tests guarding seed script, SQL bootstrap, and Keycloak realm JSON against future mapping drift.

### Codex verification

- `npm run lint` passed (warnings only). `npx vitest run` passed: 21 files / 145 tests. `npm run build` passed.
- `scripts/seed-dev-users.ps1` ran successfully against live dev stack.
- Postgres maps all 18 canonical encoders to expected region IDs. Keycloak token login confirmed for `encoder_ncr`, `encoder_car`, `encoder_r01`, `encoder_r02`, `encoder_nir`.
- `test_dev_user_seed_mapping.py` passed: 3 tests.

---

---

## Part 3 — Review Fixes (post-merge review)

**Reviewer:** PR #182 three-axis review · 2026-06-01

### Fix 1 — Celery tasks silently returning zero results (BLOCKER)

All four affected tasks were calling `get_session()` without a user UUID, so `wims.current_user_id` GUC was never set and RLS policies returned zero rows.

- **`src/backend/database.py`** — Added `SYSTEM_TASK_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")` constant.
- **`src/postgres-init/03_users.sql`** — Seeded `svc_task` service account with `SYSTEM_ADMIN` role (ON CONFLICT DO NOTHING).
- **`src/backend/main.py`** — Added two new startup patches: (1) ensures `svc_task` user exists on existing deployments; (2) transfers ownership of `wims.mv_incident_counts_daily`, `wims.mv_incident_by_region`, `wims.mv_incident_type_distribution` to `wims_app_user` so the non-superuser can run `REFRESH MATERIALIZED VIEW`.
- **`src/backend/tasks/drafts.py`** — `get_session()` → `get_session(SYSTEM_TASK_USER_ID)`.
- **`src/backend/tasks/civilian_reports.py`** — Same.
- **`src/backend/tasks/narrative.py`** — `next(get_db())` (admin URL, resource-leak pattern) → `get_session(SYSTEM_TASK_USER_ID)`.
- **`src/backend/tasks/analytics_refresh.py`** — `get_session()` → `get_session(SYSTEM_TASK_USER_ID)`; MV ownership patch in `main.py` fixes the REFRESH permission.

### Fix 2 — Vestigial `request.state.wims_user` assignment (High)

`get_current_wims_user` in `auth.py` still set `request.state.wims_user = user_dict` after the refactor to direct `Depends()`. No consumer remained. Removed the assignment and updated the docstring.

### Fix 3 — Validator operational map bypasses RLS (High)

`get_operational_map()` in `map.py` used `Depends(get_db)` (admin URL, no RLS) and a separate dummy `_user` parameter for auth. Replaced both with `Depends(auth.get_db_with_rls)`, which enforces both authentication and region-scoped RLS.

### Fix 4 — Remove fragile `__getattr__` re-export (Medium)

`database.py` used a `PEP 562 __getattr__` hook to lazily re-export `auth.get_db_with_rls`. Import errors deferred to runtime; static analysis blind spot. Removed the `__getattr__` block and updated all 16 import sites from `from database import get_db_with_rls` → `from auth import get_db_with_rls`.

### Fix 5 — Redundant `onInput` on IncidentForm (Low)

`IncidentForm.tsx` had both `onChange` and `onInput` on the `<form>` element doing the same thing (`userEditedDraftRef.current = true`). Removed `onInput`; `onChange` is the standard React pattern.

### Fix 6 — Engine created per call in `_get_admin_session` (Low)

`_get_admin_session()` in `main.py` called `create_engine(admin_url)` on every invocation, creating a new SQLAlchemy engine (and connection pool) each time. Moved to a module-level cached `_startup_admin_engine`.

### Fix 7 — Test override signature mismatch and redundant dual override (Medium)

`test_ref_table_rls.py`: the `_rls_db_override` inner function used `def _override(request: Request):` — a stale artifact from the old `request.state` approach, with an outdated comment. Each test also overrode both `get_db_with_rls` and `auth.get_db_with_rls` (same object via `__getattr__`). Fixed: signature changed to `def _override():`, stale comment removed, `import auth` / `from fastapi import Request` removed, and 6 redundant `auth.get_db_with_rls` override lines removed.

---

## Part 4 — Second-pass Review Fixes (2026-06-02)

**Reviewer:** PR #182 three-axis review (second pass) — 2 new P0 blockers + P1–P3 findings

### Fix 1 — Analytics RLS policies incompatible with `wims_app_user` (P0 Blocker)

`11_analytics_facts.sql` used `TO NATIONAL_ANALYST` / `TO REGIONAL_ENCODER` / `TO SYSTEM_ADMIN` — PostgreSQL database roles. `wims_app_user` is not a member of any of them, so `FORCE ROW LEVEL SECURITY` denied all SELECT/INSERT/UPDATE. Analytics dashboards returned empty and `sync_incident_to_analytics` writes failed silently.

- **`src/postgres-init/11_analytics_facts.sql`** — Rewrote all 4 policies to use `wims.current_user_role() IN (...)` pattern (matching `10_rls_policies.sql`). Replaced the `FOR ALL` write policy with separate `aif_staff_insert`, `aif_staff_update`, `aif_staff_delete` policies (FOR ALL would OR-broaden the region-scoped SELECT policies since PostgreSQL ORs multiple policies). Added NATIONAL_ANALYST to write roles (needed because `correct_verified_incident` permits analysts to trigger `sync_incident_to_analytics`). Added DELETE to the `wims_app` GRANT.
- **`src/backend/main.py`** — Added `_apply_analytics_facts_rls()` helper and a new startup patch block that drops and recreates the analytics_incident_facts policies on existing deployments.

### Fix 2 — `/api/analytics-summary` bypasses RLS (P0 Blocker)

`main.py:get_analytics_summary` used `Depends(get_db)` — the admin superuser — so encoders saw aggregates from all 18 regions.

- **`src/backend/main.py`** — Replaced `Depends(get_db)` + separate `_user` auth param with `Depends(auth.get_db_with_rls)`. Auth is now enforced inside `get_db_with_rls`.

### Fix 3 — nginx CORS mirrors `$http_origin` on production HTTPS block (P1 Security)

Open CORS echo with `Access-Control-Allow-Credentials: true` on the production block allowed any origin to make credentialed requests.

- **`src/nginx/nginx.conf`** — Production HTTPS `location /api/` block now uses an origin whitelist (`wimsbfp.tech`, `wims.bfp.gov.ph`) via a `$cors_origin` variable. OPTIONS preflight block updated to match. Localhost block annotated as dev-only.

### Fix 4 — `NATIONAL_VALIDATOR` region-guard removed (P1 Quality)

`dashboard/page.tsx` guarded `REGIONAL_ENCODER` against missing `assignedRegionId` but silently dropped validators into an empty queue if their region was unset.

- **`src/frontend/src/app/dashboard/page.tsx`** — Added `NATIONAL_VALIDATOR` arm to the useEffect redirect, showing the same "No region assigned" error.

### Fix 5 — `SET LOCAL` ephemerality after `db.commit()` (P1 Correctness)

Three handlers called `sync_incident_to_analytics` after a mid-handler `db.commit()`. `SET LOCAL` resets on commit, so the sync ran without `wims.current_user_id` set and the write policy denied the INSERT.

- **`src/backend/api/routes/incidents.py`** — Added `set_rls_context(db, uuid.UUID(user_id))` before the sync in `create_incident` (after commit at line 481) and `upload_bundle` (after commit at line 350). Imported `set_rls_context` from `database`.
- **`src/backend/api/routes/regional.py`** — Added `set_rls_context(db, corrector_user_id)` before the sync in `correct_verified_incident` (after commit at line 2308). Imported `set_rls_context` from `database`.

### Fix 6 — Stale docstring in `auth.py` (P2 Standards)

`get_db_with_rls` docstring still said "Re-exported from database.py for backward-compatible imports."

- **`src/backend/auth.py`** — Updated line to "All consumers import from auth directly."

### Fix 7 — `_get_admin_session()` creates sessionmaker per call (P2 Standards)

`_sessionmaker(...)` was called on every `_get_admin_session()` invocation, creating a new factory each time.

- **`src/backend/main.py`** — Added module-level `_startup_admin_session_factory`. `_get_admin_session()` now calls `_startup_admin_session_factory()`.

### Fix 8 — Fragile test URL rewriting (P2 Standards)

`test_ref_table_rls.py` rewrote credentials via two `str.replace` calls that would silently produce a broken URL if the format changed.

- **`src/backend/tests/test_ref_table_rls.py`** — Replaced with `urllib.parse` approach. Reads `WIMS_APP_DATABASE_URL` env var directly if set; otherwise rewrites via `urlparse`/`urlunparse`.

### Fix 9 — SQL string interpolation in `ref.py` (P3 Security)

`province_ids` list was joined into a SQL string instead of using named bind parameters.

- **`src/backend/api/routes/ref.py`** — Uses `:pid_0, :pid_1, ...` named parameters via `text(f"... IN ({placeholders})")` + params dict.

### Fix 10 — Narrative AI calls serialized (P3 Performance)

`batch_generate_narratives` spawned a new event loop per incident with `asyncio.run()` in a loop.

- **`src/backend/tasks/narrative.py`** — Replaced with a single `asyncio.run(_generate_all())` using `asyncio.gather()`, processing all incidents concurrently.

### Fix 11 — `SYSTEM_TASK_USER_ID` cross-artifact drift guard (P2 Maintainability)

The UUID `00000000-0000-0000-0000-000000000002` appeared in `database.py`, `03_users.sql`, and `main.py` with no contract test to catch drift.

- **`src/backend/tests/test_dev_user_seed_mapping.py`** — Added `test_system_task_user_id_consistent_across_artifacts()` that asserts the UUID is present and correctly assigned in all three artifacts.

---

## Files changed

### Backend

| File | Change |
|---|---|
| `src/backend/auth.py` | `get_db_with_rls` depends on `get_current_wims_user`; vestigial `request.state.wims_user` removed |
| `src/backend/database.py` | `_AdminSessionLocal` added; `get_db()` uses admin URL; `SYSTEM_TASK_USER_ID` constant added; `__getattr__` re-export removed |
| `src/backend/main.py` | `apply_schema_patches()` startup hook; `GET /api/user/me` JIT provisioning; `svc_task` + MV ownership startup patches; `_get_admin_session` engine cached |
| `src/backend/api/routes/map.py` | `get_operational_map` uses `auth.get_db_with_rls` (RLS enforced) |
| `src/backend/tasks/drafts.py` | `get_session(SYSTEM_TASK_USER_ID)` — RLS context set |
| `src/backend/tasks/civilian_reports.py` | `get_session(SYSTEM_TASK_USER_ID)` — RLS context set |
| `src/backend/tasks/narrative.py` | `get_session(SYSTEM_TASK_USER_ID)` — replaces `next(get_db())` |
| `src/backend/tasks/analytics_refresh.py` | `get_session(SYSTEM_TASK_USER_ID)` — RLS context set |
| `src/backend/api/routes/analytics.py` | `from auth import get_db_with_rls` |
| `src/backend/api/routes/incidents.py` | `from auth import get_db_with_rls` |
| `src/backend/api/routes/triage.py` | `from auth import get_db_with_rls` |
| `src/backend/api/routes/regional.py` | `from auth import get_db_with_rls` |
| `src/backend/api/routes/sessions.py` | `from auth import get_db_with_rls` |
| `src/backend/api/routes/admin.py` | `from auth import get_db_with_rls` |
| `src/backend/api/routes/user.py` | `from auth import get_db_with_rls` |
| `src/backend/api/routes/ref.py` | `from auth import get_db_with_rls` |
| 8 test files | `from auth import get_db_with_rls` |
| `src/backend/tests/test_ref_table_rls.py` | New — RLS integration tests; fixed override signatures; redundant overrides removed |
| `src/backend/tests/test_dev_user_seed_mapping.py` | New — seed mapping drift guard |
| `src/backend/tests/test_immutable_records.py` | Removed stale `station_code` field |
| 6 integration/unit test fixtures | `_SessionLocal` → `_AdminSessionLocal` for seed inserts |

### Database

| File | Change |
|---|---|
| `src/postgres-init/42_ref_table_rls.sql` | New — RLS on `ref_regions`, `ref_provinces`, `ref_cities` |
| `src/postgres-init/43_app_login_role.sql` | New — `wims_app_user` non-superuser login role |
| `src/postgres-init/09_rls_helpers.sql` | `SECURITY DEFINER` on RLS helper functions |
| `src/postgres-init/10_rls_policies.sql` | `users_self_or_admin_select` broadened for BFP staff roles |
| `src/postgres-init/03_users.sql` | 18 canonical encoder seed rows; `svc_task` SYSTEM_ADMIN service account |
| `src/postgres-init/14a_assign_ncr_to_test_users.sql` | Updated for canonical usernames |
| `src/postgres-init/15_validator_workflow.sql` | Updated for canonical usernames |
| `src/postgres-init/21_all_regions.sql` | All 18 region rows with encoder assignments |

### Frontend

| File | Change |
|---|---|
| `src/frontend/src/lib/roleRedirect.ts` | New — post-login routing helpers |
| `src/frontend/src/lib/__tests__/roleRedirect.test.ts` | New — 5 tests |
| `src/frontend/src/app/callback/page.tsx` | Uses `resolvePostLoginRedirect`; fetches role before redirect |
| `src/frontend/src/app/login/page.tsx` | Uses `defaultRouteForRole` |
| `src/frontend/src/app/dashboard/page.tsx` | Simplified role redirect |
| `src/frontend/src/app/dashboard/regional/page.tsx` | 1,181 → 965 lines; filter fixes |
| `src/frontend/src/app/dashboard/validator/page.tsx` | 1,379 → 967 lines; filter fixes; header removed |
| `src/frontend/src/components/IncidentForm.tsx` | Per-user draft key; `userEditedDraftRef` guard; redundant `onInput` handler removed |
| `src/frontend/src/components/Sidebar.tsx` | Operational Map in validator sidebar |
| `src/frontend/src/components/MapPickerInner.tsx` | `, Philippines` stripped from 14 fallbacks |
| `src/frontend/src/components/validator/` | 6 new files + `types.ts` |
| `src/frontend/src/components/regional/` | 3 new files |
| `src/frontend/src/components/ui/InfoBlock.tsx` | New primitive; added to barrel |

### Keycloak / Infra

| File | Change |
|---|---|
| `src/keycloak/themes/wims-bfp/login/resources/css/wims-custom.css` | Full layout rework: TOTP overflow, OTP grid, mobile |
| `src/keycloak/themes/wims-bfp/login/login-config-totp.ftl` | TOTP setup redesigned as two-column grid |
| `src/keycloak/themes/wims-bfp/login/login.ftl` | Markup updates |
| `src/keycloak/themes/wims-bfp/login/login-otp.ftl` | Markup updates |
| `src/keycloak/bfp-realm.json` | `UPDATE_PROFILE defaultAction: true`; `userProfileConfig`; port 8090 URI; 18 encoders |
| `src/keycloak/import/bfp-realm.json` | Same |
| `scripts/seed-dev-users.sh` | Full rewrite: 18 encoders, legacy rename, kcadm profile push |
| `scripts/seed-dev-users.ps1` | Same for PowerShell |
| `src/docker-compose.yml` | `DATABASE_URL` → `wims_app_user`; `DATABASE_ADMIN_URL` added |
| `src/nginx/nginx.conf` | Local dev HTTP passthrough on ports 80 / 8090 |
| `src/frontend/.dockerignore` | `.env.local` excluded from build context |

---

## Test results

### Backend (pytest)

| | Before | After |
|---|---|---|
| Passed | 304 | 358 |
| Errors | 156 | 2 |
| Failed | 13 | 56 |
| **Total broken** | **169** | **58** |

56 remaining failures were previously in ERROR state (fixture setup crashing before assertions). They now run to assertion failures on pre-existing logic unrelated to this PR. All 6 ref-table RLS integration tests pass.

### Frontend (Vitest)

22 test files / 150 tests passed. Includes 5 `roleRedirect` tests (3 original + 2 new for cross-role rejection and own-dashboard deep-link).

---

## RLS access matrix

| Role | `fire_incidents` | `ref_regions/provinces/cities` | `citizen_reports` |
|---|---|---|---|
| `REGIONAL_ENCODER` | Own region only | Own region only | No access |
| `NATIONAL_VALIDATOR` | All regions | All regions | No access |
| `NATIONAL_ANALYST` | All regions | All regions | No access |
| `SYSTEM_ADMIN` | All | All | All |
| `CIVILIAN_REPORTER` | No access | No access via RLS endpoints | Own reports only |

---

## Rollout

### Option A — Rolling restart (preserves data, recommended)

```bash
git pull origin fix--refactored-enc-val-pages-and-M15-row-level-sec
cd src
docker compose down
docker compose up --build -d
docker logs -f wims-backend --since 30s
```

Expected startup log lines:
```
INFO  Schema patch applied: wims_app_user role ensured
INFO  Schema patch applied: no_update_verified rule updated ...
INFO  Schema patch applied: ref_regions/ref_provinces/ref_cities RLS policies
INFO  Schema patch applied: current_user_role/region_id made SECURITY DEFINER
INFO  Schema patch applied: wims.users SELECT policy broadened for BFP staff roles
INFO  Schema patch applied: svc_task system service account ensured
INFO  Schema patch applied: analytics materialized view ownership transferred to wims_app_user
```

To apply Keycloak profile enforcement on a running stack without `down -v`:
```bash
bash scripts/seed-dev-users.sh
```

### Option B — Clean slate

```bash
cd src
docker compose down -v
docker compose up --build -d
# Realm JSON imports fresh — no seed script needed for Keycloak config or passwords.
# Run seed script only to sync wims.users PostgreSQL rows:
bash scripts/seed-dev-users.sh
```

### RLS verification

1. Log in as `encoder_ncr` → AFOR import region dropdown shows **only NCR**.
2. Log in as `validator_test` → validator queue shows incidents from **all regions**.
3. Log in as `encoder_r01` → AFOR import region dropdown shows **only Region I**.

---

## Known issues / out of scope

- 56 pre-existing test failures remain — not regressions. They were in ERROR state before this PR and now surface as assertion failures after fixture plumbing was corrected.
- Keycloak `UPDATE_PROFILE` / `userProfileConfig` only applies to freshly admin-created users. Dev seed users bypass it by design.
- `nginx.conf` localhost block uses `$http_origin` for CORS — intentional for local dev; not present in the production HTTPS block.

---

## Observed: Frontend tab-switching performance (out of scope)

Investigated 2026-06-01. Sluggishness when switching between dashboard tabs is caused by three compounding issues — not addressed in this PR.

### Root causes

| # | Cause | Files | Impact |
|---|---|---|---|
| P-01 | **Full data re-fetch on every navigation** | `dashboard/validator/page.tsx`, `dashboard/regional/page.tsx`, `dashboard/analyst/page.tsx` | Each sidebar link click unmounts the page component and remounts it, triggering all `useEffect` data-fetch chains from scratch. No cached state survives the navigation. Each page shows a full loading spinner until API calls resolve (300 ms–2 s per switch). |
| P-02 | **7 parallel API calls on analyst dashboard** | `dashboard/analyst/page.tsx:321-340` | `Promise.all([heatmap, trends, comparative, typeDistribution, responseTime, compareRegions, topN])` fires on every mount. Backend handles the burst but the waterfall adds latency before any content renders. |
| P-03 | **No client-side request deduplication or caching** | `src/frontend/src/lib/api/` (all slices) | The fetch layer is plain `async` wrappers with no cache, stale-while-revalidate, or deduplication. Identical query params re-hit the backend on every call. |

### What would fix it

The correct fix is adding **TanStack Query (React Query)** as a caching layer:
- Wrap each page's data-fetch calls in `useQuery` with a stable key (e.g., `['validator-queue', page, statusFilter, regionFilter, dateBounds]`).
- `staleTime: 60_000` — data stays fresh for 60 s without a re-fetch.
- Navigation back to a tab renders instantly from cache; background refetch happens silently.
- Analyst dashboard's 7 concurrent calls become 7 independent queries with shared cache keys — a second visit to the analyst tab does not re-fire any call whose key hasn't changed.

This is a non-trivial cross-cutting refactor (all three dashboard pages + the API slice layer). Tracked in `system-wiki/gaps/ui-ux-gap-register.md` as P-01.
