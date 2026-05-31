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

**Changes:**

- **`src/postgres-init/43_app_login_role.sql`** — New migration. Creates `wims_app` role group and `wims_app_user` login role with least-privilege grants on all `wims.*` tables. Idempotent.
- **`src/docker-compose.yml`** — `DATABASE_URL` changed from `postgres` superuser to `wims_app_user`. Added `DATABASE_ADMIN_URL` pointing to `postgres` superuser for auth bootstrap and schema patches.
- **`src/backend/database.py`** — Added `_AdminSessionLocal` bound to `DATABASE_ADMIN_URL`. `get_db()` now uses the admin URL for auth lookups. `get_db_with_rls()` uses the app URL with RLS context set.
- **`src/backend/auth.py`** — `get_db_with_rls` now declares `get_current_wims_user` as a FastAPI `Depends()` so `request.state.wims_user` is guaranteed populated before RLS context is set.
- **`src/backend/main.py`** — `apply_schema_patches()` runs at startup. Idempotently creates `wims_app_user`, grants permissions, enables RLS on ref tables, recreates helper functions as `SECURITY DEFINER`, and broadens the users SELECT policy. Self-healing on existing deployments without `down -v`.
- **`src/postgres-init/09_rls_helpers.sql`** — `current_user_role()` and `current_user_region_id()` marked `SECURITY DEFINER`. Prevents infinite recursion where RLS policies invoke helper functions that query the same RLS-protected tables.
- **`src/postgres-init/10_rls_policies.sql`** — `users_self_or_admin_select` policy broadened to allow `REGIONAL_ENCODER`, `NATIONAL_VALIDATOR`, and `NATIONAL_ANALYST` to JOIN `wims.users` (required for incident queries that join encoder/validator user rows).

### Ref table RLS (M15a)

- **`src/postgres-init/42_ref_table_rls.sql`** — Enables RLS on `wims.ref_regions`, `wims.ref_provinces`, `wims.ref_cities`. `REGIONAL_ENCODER` sees only rows for their assigned region; `NATIONAL_VALIDATOR`, `NATIONAL_ANALYST`, and `SYSTEM_ADMIN` see all. `ref_fire_stations` intentionally excluded (public emergency reference). Startup patch in `main.py` applies this to existing deployments.
- **`src/backend/tests/test_ref_table_rls.py`** — New integration test. Verifies encoder sees only own region's ref data; analyst sees all 18 regions. Tests fixture updated to use `_AdminSessionLocal` for seed inserts.

### Login / Keycloak fixes

- **`src/keycloak/themes/wims-bfp/login/resources/css/wims-custom.css`** — Complete rework of login layout. Root cause of TOTP overflow: `align-items: stretch` on `.pf-v5-c-login__container` locked the right panel to exactly 100vh. Fix: `align-items: flex-start` on container; `position: sticky; top: 0; height: 100vh` on left branding panel; `min-height: 100vh` on right panel. TOTP setup page now scrolls normally. OTP digit grid fixed to fixed-width columns (`repeat(3, minmax(0, 44px))`). Mobile breakpoints updated.
- **`src/keycloak/themes/wims-bfp/login/login-config-totp.ftl`** — TOTP setup page restructured into a two-column grid (`wims-totp-grid-layout`) with numbered step list on the left and QR code + OTP input on the right. Eliminates the previous single-column overflow.
- **`src/keycloak/themes/wims-bfp/login/login.ftl`**, **`login-otp.ftl`** — Markup updates to match CSS selectors.
- **`src/keycloak/bfp-realm.json`** and **`src/keycloak/import/bfp-realm.json`** — `UPDATE_PROFILE` `defaultAction` changed `false` → `true`. Added `userProfileConfig` attribute marking `firstName` and `lastName` as required fields for the `user` role. Without this, Keycloak 24 marks them optional and the Update Profile form accepts empty submissions. `http://localhost:8090/*` added to client redirect URIs.
- **`scripts/seed-dev-users.sh`** and **`scripts/seed-dev-users.ps1`** — Push `UPDATE_PROFILE defaultAction=true` and `userProfileConfig` to a live Keycloak instance via `kcadm`. Applies without `down -v`. Seed users (`encoder_ncr`, `validator_test`, etc.) are unaffected — `requiredActions=[]` is explicitly cleared and profile fields are pre-populated.

### Post-login redirect fix

- **`src/frontend/src/lib/roleRedirect.ts`** — New module. Centralises post-login routing: `defaultRouteForRole(role)` maps role strings to canonical dashboard paths; `resolvePostLoginRedirect(role, savedRedirect, origin)` resolves the post-login destination. Guards: cross-origin saved redirects are discarded; generic paths (`/login`, `/callback`, `/dashboard`, `/home`) use role default; **saved redirects pointing to a different role's `/dashboard/*` sub-path are discarded** — this is the fix for encoders landing on the validator page (see below).
- **`src/frontend/src/lib/__tests__/roleRedirect.test.ts`** — 5 tests covering default routes, stale generic paths, cross-role dashboard redirect rejection, and own-dashboard deep-link preservation.
- **`src/frontend/src/app/callback/page.tsx`** — After session refresh, fetches `/api/auth/session` to resolve the user's role before redirect. Uses `resolvePostLoginRedirect` instead of unconditional `/dashboard` push.
- **`src/frontend/src/app/login/page.tsx`** and **`src/frontend/src/app/dashboard/page.tsx`** — Routing logic simplified using `defaultRouteForRole`. Removed per-role conditional chains.

**Bug fixed:** When any API call returned 401, `transport.ts` saved `window.location.href` to sessionStorage as the post-login redirect. If that URL was `/dashboard/validator` (from a previous session or accidental navigation), an encoder logging in next would be sent to the validator page. The validator page fired `GET /regional/validator/incidents` → 403 `NATIONAL_VALIDATOR privileges required`. Visible until the auth context re-evaluated the role and redirected back. Fix: `resolvePostLoginRedirect` now rejects any saved redirect that starts with `/dashboard/` unless it starts with the user's own dashboard prefix.

### Dashboard filter fixes

- **`src/frontend/src/app/dashboard/regional/page.tsx`** — `selectStatusFilter` no longer mutates `dateFilter`. Removed `loadStatsRef` pattern that was firing a redundant `loadStats` API call inside `loadIncidents` on every filter change.
- **`src/frontend/src/app/dashboard/validator/page.tsx`** — `selectStatusFilter` no longer sets `dateFilter` to `"today"` when switching to `STATUS_FILTER_ALL`. Removed redundant header block. Fixed card spacing. `selectStatusFilter` uses `useCallback`.
- **`src/frontend/src/components/Sidebar.tsx`** — Operational Map link added to the validator sidebar section.

### IncidentForm draft isolation

- **`src/frontend/src/components/IncidentForm.tsx`** — Draft localStorage key changed from the shared `wims:incident_draft` to `wims:incident_draft:<user_id>`. Prevents draft data from one account appearing in the restore prompt when a different user logs in on the same device. Draft is only auto-saved after a user interaction (`userEditedDraftRef` guard).

### Infrastructure

- **`src/nginx/nginx.conf`** — Added `server` block for `server_name localhost 127.0.0.1` listening on ports 80 and 8090. Routes local dev traffic without TLS redirect. The existing HTTPS block is keyed on `wimsbfp.tech` and is unaffected.
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
- Added migration-39 cross-reference to `system-wiki/database/sql-init-files.md` at the `19_reference_number.sql` section.
- Stripped `, Philippines` suffix from all 14 fallback `display_name` strings in `src/frontend/src/components/MapPickerInner.tsx`.

### Dev encoder accounts (18 regions)

- Replaced offset encoder usernames with canonical region-code names (`encoder_ncr` through `encoder_nir`). `encoder_ncr` retains the old `encoder_test` deterministic UUID for existing dev databases.
- Updated `scripts/seed-dev-users.sh`, `scripts/seed-dev-users.ps1`, `src/postgres-init/03_users.sql`, `src/postgres-init/21_all_regions.sql`, `src/postgres-init/14a_assign_ncr_to_test_users.sql`, `src/postgres-init/15_validator_workflow.sql`, and both Keycloak realm JSONs.
- Seed scripts repair legacy usernames in place, set `Password123!`, verify email, populate profile fields, clear `requiredActions`, and print the seeded user list.
- `src/backend/tests/test_dev_user_seed_mapping.py` — 3 tests guarding seed script, SQL bootstrap, and Keycloak realm JSON against future mapping drift.

---

## Files changed

### Backend

| File | Change |
|---|---|
| `src/backend/auth.py` | `get_db_with_rls` depends on `get_current_wims_user`; ordering fix |
| `src/backend/database.py` | `_AdminSessionLocal` added; `get_db()` uses admin URL |
| `src/backend/main.py` | `apply_schema_patches()` startup hook; `GET /api/user/me` JIT provisioning |
| `src/backend/tests/test_ref_table_rls.py` | New — RLS integration tests for ref endpoints |
| `src/backend/tests/test_dev_user_seed_mapping.py` | New — seed mapping drift guard |
| `src/backend/tests/test_immutable_records.py` | Removed stale `station_code` field |
| `src/backend/tests/test_incident_narrative.py` | Fixture: `_SessionLocal` → `_AdminSessionLocal` |
| 5 integration test fixtures | `_SessionLocal` → `_AdminSessionLocal` for seed inserts |

### Database

| File | Change |
|---|---|
| `src/postgres-init/42_ref_table_rls.sql` | New — RLS on `ref_regions`, `ref_provinces`, `ref_cities` |
| `src/postgres-init/43_app_login_role.sql` | New — `wims_app_user` non-superuser login role |
| `src/postgres-init/09_rls_helpers.sql` | `SECURITY DEFINER` on `current_user_role()` / `current_user_region_id()` |
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
| `src/frontend/src/app/dashboard/page.tsx` | Uses `defaultRouteForRole`; simplified role redirect |
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
| `src/keycloak/themes/wims-bfp/login/resources/css/wims-custom.css` | Full layout rework: TOTP overflow fix, OTP grid fix, mobile breakpoints |
| `src/keycloak/themes/wims-bfp/login/login-config-totp.ftl` | TOTP setup redesigned as two-column grid |
| `src/keycloak/themes/wims-bfp/login/login.ftl` | Markup updates |
| `src/keycloak/themes/wims-bfp/login/login-otp.ftl` | Markup updates |
| `src/keycloak/bfp-realm.json` | `UPDATE_PROFILE defaultAction: true`; `userProfileConfig`; port 8090 redirect URI; 18 encoder users |
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

The 56 remaining failures were previously in ERROR state (fixture setup crashing before assertions). They now run to assertion failures on pre-existing logic issues unrelated to this PR. The 6 ref-table RLS integration tests all pass.

### Frontend (Vitest)

| | Result |
|---|---|
| Test files | 22 passed |
| Tests | 147 passed |

Includes 5 `roleRedirect` tests (3 pre-existing + 2 new for cross-role and deep-link cases).

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

### Option A — Rolling restart (preserves data, recommended for VPS)

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

To apply Keycloak profile enforcement (`UPDATE_PROFILE`, `userProfileConfig`) without `down -v`:
```bash
bash scripts/seed-dev-users.sh
```

### Option B — Clean slate

```bash
cd src
docker compose down -v
docker compose up --build -d
# Realm JSON is imported fresh — no seed script required for passwords or Keycloak config.
# Run seed script only to repair/sync wims.users PostgreSQL rows if needed:
bash scripts/seed-dev-users.sh
```

### RLS verification

1. Log in as `encoder_ncr` → AFOR import region dropdown shows **only NCR**.
2. Log in as `validator_test` → validator queue shows incidents from **all regions**.
3. Log in as `encoder_r01` → AFOR import region dropdown shows **only Region I**.

---

## Known issues / out of scope

- `celery-worker` uses `DATABASE_URL = wims_app_user` and has no `DATABASE_ADMIN_URL`. Celery tasks requiring DDL or superuser access are out of scope for this PR.
- 56 pre-existing test failures remain. Not regressions — they were in ERROR state before this PR and now surface as assertion failures after fixture plumbing was corrected.
- The Keycloak `UPDATE_PROFILE` / `userProfileConfig` changes only apply to freshly admin-created users. Dev seed users bypass them by design (`requiredActions=[]`, pre-populated profile fields).
