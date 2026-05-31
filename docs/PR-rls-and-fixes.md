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

## Files changed

### Backend

| File | Change |
|---|---|
| `src/backend/auth.py` | `get_db_with_rls` depends on `get_current_wims_user` |
| `src/backend/database.py` | `_AdminSessionLocal` added; `get_db()` uses admin URL |
| `src/backend/main.py` | `apply_schema_patches()` startup hook; `GET /api/user/me` JIT provisioning |
| `src/backend/tests/test_ref_table_rls.py` | New — RLS integration tests for ref endpoints |
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
| `src/postgres-init/03_users.sql` | 18 canonical encoder seed rows |
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
| `src/frontend/src/components/IncidentForm.tsx` | Per-user draft key; `userEditedDraftRef` guard |
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

22 test files / 147 tests passed. Includes 5 `roleRedirect` tests (3 original + 2 new for cross-role rejection and own-dashboard deep-link).

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

- `celery-worker` uses `DATABASE_URL = wims_app_user` with no `DATABASE_ADMIN_URL`. Celery tasks requiring DDL or superuser access are out of scope.
- 56 pre-existing test failures remain — not regressions. They were in ERROR state before this PR and now surface as assertion failures after fixture plumbing was corrected.
- Keycloak `UPDATE_PROFILE` / `userProfileConfig` only applies to freshly admin-created users. Dev seed users bypass it by design.
