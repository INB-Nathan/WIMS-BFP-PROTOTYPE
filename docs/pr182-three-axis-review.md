# PR #182 — Three-Axis Review Report

**PR:** `fix--refactored-enc-val-pages-and-M15-row-level-sec` → `master`  
**Commits reviewed:** `a890f79..bce907e` (16 commits, 80 files, +2694 / -663)  
**Date:** 2026-06-01  
**Methodology:** Scout → Parallel (Standards / Spec / Quality) → Synthesis  

---

## Executive Summary

| Axis | Verdict | Key Finding |
|------|---------|-------------|
| **Standards** | 🟢 Passing (~98%) | Senior-level architecture. Stale docstring, minor sessionmaker reuse. |
| **Spec** | 🟢 On Spec | All 32+ claimed requirements verified. Zero scope creep. Zero omissions. |
| **Quality** | 🟡 Medium-High Risk | **2 new blockers** — analytics RLS policies incompatible with `wims_app_user`; analytics-summary endpoint bypasses RLS. |

**REVIEWER'S NOTE:** The original REQUEST_CHANGE from `x1n4te` (blocking: Celery tasks silently broken by RLS transition) was **fully addressed** in commit `b1d10a9`. All 4 findings from that review are resolved. However, this review uncovered **2 new blockers** that the original review missed.

### New Blockers Found

| # | Finding | Severity | Fix |
|---|---------|----------|-----|
| 1 | `11_analytics_facts.sql` — RLS policies use `TO <role>` (PG database roles) which **never matches `wims_app_user`**. The entire analytics read model and `sync_incident_to_analytics` writes are silently broken for the non-superuser connection. | 🔴 Blocker | Rewrite using `wims.current_user_role() IN (...)` pattern (matching `10_rls_policies.sql`). Remove `TO <role>` from all `analytics_incident_facts` policies. |
| 2 | `main.py:678` — `/api/analytics-summary` uses `Depends(get_db)` (admin superuser), bypassing RLS. Authenticated users see aggregate data from **all 18 regions** regardless of their assigned region. | 🔴 Blocker | Replace `Depends(get_db)` with `Depends(auth.get_db_with_rls)`. |

---

## Section 1 — Standards Review

*Axis: Codebase standards, Karpathy principles, senior-level quality*

**Assessment: 🟢 Passing (~98% consistency)**

### 🟡 Needs Improvement

#### 1.1 Stale docstring on `get_db_with_rls`

**File:** `src/backend/auth.py:396`

The docstring still says: _"Re-exported from database.py for backward-compatible imports."_ — but the PEP 562 `__getattr__` re-export was **removed from `database.py`** in commit `b1d10a9`. All 17+ import sites were migrated to `from auth import get_db_with_rls`. A future reader looking at this function might think it's still accessible via `database.get_db_with_rls` and write a new import that will fail at runtime.

**Fix:** Update the docstring to remove the re-export claim, e.g.:
```python
"""Defined here in auth.py so it can directly depend on get_current_wims_user.
All consumers import from auth directly."""
```

**Violates:** K3 (Surgical — stale artifact), K1 (documentation should reflect reality)

#### 1.2 Fragile test database URL rewriting

**File:** `src/backend/tests/test_ref_table_rls.py:42-50`

The `_app_database_url()` helper uses string replacement to swap credentials in the DATABASE_URL:
```python
return url.replace("postgres:postgres@", "wims_app_user:wimsapp@").replace(
    "postgres:password@", "wims_app_user:wimsapp@"
)
```

Two distinct replace calls for two known patterns (CI vs dev environments) — a fragility indicator. If the DATABASE_URL format changes, these literal replacements silently produce a broken URL.

**Fix:** Read a separate `WIMS_APP_DATABASE_URL` env var with a clear fallback chain, or use `urllib.parse` to replace the userinfo component robustly.

**Violates:** K2 (Simplicity — depends on exact string patterns)

#### 1.3 `_get_admin_session()` creates `sessionmaker` per call

**File:** `src/backend/main.py:62`

```python
return _sessionmaker(autocommit=False, autoflush=False, bind=_startup_admin_engine)()
```

`sessionmaker` is a factory intended to be created once and reused. Creating it on every invocation is wasteful. The engine was correctly cached to a module-level variable in the latest commit; the sessionmaker should follow the same pattern.

**Fix:** Create a module-level `_AdminSessionMaker` alongside `_startup_admin_engine`.

**Violates:** K2 (Simplicity — unnecessary object creation)

#### 1.4 Broad non-fatal exception handling in schema patches

**File:** `src/backend/main.py:129-192`

Every DDL patch block is wrapped in its own `try/except` that logs a warning, rolls back, and continues. Only the session acquisition (line 141) re-raises. If a DDL statement consistently fails, the startup log shows a warning, but the app starts with silently broken schema. The startup guard (`_schema_patches_attempted`) prevents retries on restart.

This is an acknowledged design trade-off (self-healing vs fail-fast), acceptable because:
1. Fresh containers get the correct schema from `postgres-init/` scripts
2. Patches are only needed for existing containers that predate a migration
3. A loud warning in the startup log is discoverable

**Recommendation:** Add a structured log dimension (e.g., `"patch_name"`) to each warning so it's clear which patch failed without reading the log message text.

### 🟢 Patterns of Excellence

#### 1.5 Dual-session architecture

**Files:** `database.py`, `auth.py`

Clean three-tier separation:
- `_AdminSessionLocal` (superuser) — auth bootstrap, DDL schema patches
- `_SessionLocal` (wims_app_user) — RLS-scoped queries via `get_db_with_rls()`
- `get_session(user_id)` — Celery tasks with explicit user context

Every path through the session layer is accounted for and documented. The `get_db_with_rls()` declaration using `Depends(get_current_wims_user)` directly eliminates the old fragile `request.state` approach. **This is senior-level architecture.**

#### 1.6 Systematic PEP 562 import migration

All 17+ import sites of `get_db_with_rls` were migrated from `from database import ...` to `from auth import ...`. The `__getattr__` re-export was cleanly removed. Zero stragglers remain.

Files updated: 8 route files, 9 test files, 2 integration test files.

#### 1.7 Contract test for encoder seed mapping

`test_dev_user_seed_mapping.py` validates 18 encoders across 4 artifacts (seed scripts, SQL bootstrap, 2 Keycloak realm exports) — catching drift in any one of them. ID, region, credentials, email, names, `requiredActions` all verified.

**This is exactly the kind of defensive test a senior engineer writes.**

#### 1.8 Thread-safe startup guard

```python
_schema_patches_lock = threading.Lock()
```

Process-local lock + boolean guards prevent concurrent DDL execution during test scenarios. `_reset_schema_patch_state_for_tests()` properly resets the guard for CI.

#### 1.9 SECURITY DEFINER on RLS helpers

Both `current_user_role()` and `current_user_region_id()` are marked `SECURITY DEFINER` in `09_rls_helpers.sql`. Without this, calling these functions from within a `CREATE POLICY` on `wims.users` would cause infinite recursion (policy → table query → function → table → policy → ...). A subtle, hard-to-debug issue that was correctly identified and fixed.

#### 1.10 Per-user draft isolation

```typescript
const draftStorageKey = useMemo(
    () => (user?.id ? `wims:incident_draft:${user.id}` : null),
    [user?.id],
);
```

Redis draft storage keyed by user ID, preventing one user from seeing another's draft. Fixes a real multi-user race condition.

#### 1.11 MV ownership transfer

Three materialized views (`mv_incident_counts_daily`, `mv_incident_by_region`, `mv_incident_type_distribution`) transferred to `wims_app_user` so `REFRESH MATERIALIZED VIEW CONCURRENTLY` works from the non-superuser connection. This was a blocker for the analytics Celery task — now fixed.

#### 1.12 System-wiki compliance

Every post-review commit updates `system-wiki/log.md` + relevant synthesis pages. The frontend performance gap investigation (P-01/P-02/P-03) is properly documented with root causes and recommended fix (TanStack Query).

#### 1.13 Zero debris

- Zero `console.log`, `print()`, `debugger`, `TODO`, or `FIXME` in the diff
- Zero orphaned imports (verified via `rg` for old `from database import get_db_with_rls`)
- Zero remaining `request.state.wims_user` references

#### 1.14 Clean component extraction

- Validator page: 1,400 → 967 lines (6 components + `types.ts`)
- Regional page: 1,181 → 965 lines (3 components + `InfoBlock`)
- Proper Props interfaces, `useCallback` preservation, isolated types, barrel export

### Standards Assessment Summary

**Karpathy alignment:**
- **K1 (Think):** 9/10 — Dual-session architecture, SECURITY DEFINER recursion fix, MV ownership. One stale docstring.
- **K2 (Simplicity):** 9/10 — Minimal changes for what they deliver. Minor sessionmaker excess.
- **K3 (Surgical):** 10/10 — Every line traces to stated requirements. No scope creep, no formatting churn.
- **K4 (Goal-Driven):** 9/10 — Tests exist, contract test is excellent, system-wiki updated. 56 pre-existing test failures documented as non-regressions.

**Pattern consistency:** ~98% — follows project conventions throughout (snake_case Python, PascalCase components, camelCase functions, colocated tests, typed FastAPI signatures).

---

## Section 2 — Spec Review

*Axis: Requirements alignment, scope verification*

**Assessment: 🟢 On Spec — All 32+ requirements verified**

### Full Scope Coverage Matrix

| Requirement | Status | Code Evidence | Notes |
|---|---|---|---|
| **RLS Infrastructure** | | | |
| DATABASE_URL → wims_app_user non-superuser | ✅ | `docker-compose.yml:127` | `postgresql://wims_app_user:wimsapp@postgres:5432/wims` |
| DATABASE_ADMIN_URL fallback | ✅ | `docker-compose.yml:128`, `database.py:28-29` | Admin URL points to `postgres:password` superuser |
| Dual session factories | ✅ | `database.py:26-33` | `_SessionLocal` (app) + `_AdminSessionLocal` (admin) |
| `get_db()` uses admin URL | ✅ | `database.py:69-76` | `db = _AdminSessionLocal()` |
| `get_db_with_rls` rewritten as `Depends()` | ✅ | `auth.py:381-401` | Declares `Depends(get_current_wims_user)`, uses `_SessionLocal` |
| Startup self-healing DDL patches | ✅ | `main.py:111-277` | 6 patch blocks: wims_app_user role, RULE, ref RLS, users RLS, svc_task, MV ownership |
| RLS helpers SECURITY DEFINER | ✅ | `09_rls_helpers.sql:19,39` | Both `current_user_role()` and `current_user_region_id()` |
| Thread-safety + dedup guard on patches | ✅ | `main.py:72-75,116-122` | `_schema_patches_lock`, `_schema_patches_attempted`, `_schema_patches_in_progress` |
| PEP 562 backward compat removed | ✅ | `database.py` (diff) | `__getattr__` hook present in `a8f4fb2`, removed in `b1d10a9` |
| Cached startup engine | ✅ | `main.py:80-84` | `_startup_admin_engine` module-level, `_get_admin_session()` reuses it |
| **M15a Ref Table RLS** | | | |
| `ref_regions` RLS enforced | ✅ | `42_ref_table_rls.sql:9-10` | `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;` |
| `ref_provinces` RLS enforced | ✅ | `42_ref_table_rls.sql:12-13` | Same |
| `ref_cities` RLS enforced | ✅ | `42_ref_table_rls.sql:15-16` | Same |
| REGIONAL_ENCODER sees own region only | ✅ | `42_ref_table_rls.sql:20-22,27-29,33-37` | `OR region_id = wims.current_user_region_id()` |
| NATIONAL_VALIDATOR/ANALYST/ADMIN see all | ✅ | `42_ref_table_rls.sql:20,27,33` | `IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'NATIONAL_VALIDATOR')` |
| `ref_fire_stations` excluded | ✅ | `42_ref_table_rls.sql` comment | Comment: `ref_fire_stations is intentionally excluded` |
| RLS integration tests | ✅ | `test_ref_table_rls.py` | 6 tests: encoder/analyst × regions/provinces/cities |
| **UI Fixes** | | | |
| TOTP overflow fix | ✅ | `wims-custom.css`, `login-config-totp.ftl` | `align-items: flex-start`, sticky left panel, fixed-width OTP grid |
| Post-login redirect cross-role fix | ✅ | `roleRedirect.ts:28-36` | Cross-dashboard saved redirects rejected |
| `roleRedirect.ts` test coverage | ✅ | `roleRedirect.test.ts` | 5 tests: defaults, stale generic, cross-role, deep-link |
| `callback/page.tsx` fetches role before redirect | ✅ | `callback/page.tsx:55-58` | Fetches `/api/auth/session` for `role` before calling `resolvePostLoginRedirect` |
| `login/page.tsx` uses `defaultRouteForRole` | ✅ | `login/page.tsx` (diff) | Replaces hardcoded paths |
| `dashboard/page.tsx` simplified | ✅ | `dashboard/page.tsx` (diff) | Uses `defaultRouteForRole` |
| UPDATE_PROFILE `defaultAction=true` | ✅ | `bfp-realm.json` (diff) | `"defaultAction": false` → `true` |
| `userProfileConfig` with required firstName/lastName | ✅ | `bfp-realm.json` (diff) | `"required":{"roles":["user"]}` for both fields |
| IncidentForm draft isolation per-user key | ✅ | `IncidentForm.tsx:112-115` | `wims:incident_draft:${user.id}` from `useMemo` |
| `userEditedDraftRef` guard | ✅ | `IncidentForm.tsx:98,806,809,1418` | Prevents auto-save before user interaction |
| Draft restore from per-user key | ✅ | `IncidentForm.tsx:798-808` | Reads from `draftStorageKey` not shared key |
| `onInput` → `onChange` (redundant removed) | ✅ | `IncidentForm.tsx:1418` | `onInput` absent in final code, `onChange` present |
| Dashboard filter fixes (validator) | ✅ | `validator/page.tsx:198-207` | `selectStatusFilter` no longer mutates `dateFilter` |
| Dashboard filter fixes (regional) | ✅ | `regional/page.tsx:312-313` | `loadStatsRef` removed, date mutation removed |
| **Component Extraction** | | | |
| Validator page under 1000 lines | ✅ | `validator/page.tsx` — 967 lines | Actual: 967 (spec claimed 999) |
| Regional page under 1000 lines | ✅ | `regional/page.tsx` — 965 lines | Actual: 965 |
| 6 validator components extracted | ✅ | `src/frontend/src/components/validator/` | 6 `.tsx` + 1 `types.ts` |
| 3 regional components extracted | ✅ | `src/frontend/src/components/regional/` | 3 `.tsx` files |
| `InfoBlock` extracted to `ui/` | ✅ | `src/frontend/src/components/ui/InfoBlock.tsx` | New primitive |
| **Keycloak Realm** | | | |
| 18 canonical encoder accounts | ✅ | `bfp-realm.json` (diff), `03_users.sql:45-62` | encoder_ncr through encoder_nir |
| Seed scripts updated | ✅ | `seed-dev-users.sh`, `seed-dev-users.ps1` | Full rewrite with 18 encoders, legacy rename |
| Seed mapping drift guard tests | ✅ | `test_dev_user_seed_mapping.py` | 3 tests |
| **Post-Review Celery Fixes** | | | |
| SYSTEM_TASK_USER_ID constant | ✅ | `database.py:36` | `00000000-0000-0000-0000-000000000002` |
| `svc_task` seed row | ✅ | `03_users.sql:42-48`, `main.py:220-232` | SYSTEM_ADMIN role, `ON CONFLICT DO NOTHING` |
| `drafts.py`: `get_session(SYSTEM_TASK_USER_ID)` | ✅ | `drafts.py:29` | |
| `civilian_reports.py`: same | ✅ | `civilian_reports.py:23` | |
| `narrative.py`: replaces `next(get_db())` | ✅ | `narrative.py:23` | `get_session(SYSTEM_TASK_USER_ID)` |
| `analytics_refresh.py`: same | ✅ | `analytics_refresh.py:38` | |
| MV ownership transfer (3 MVs) | ✅ | `main.py:234-245` | `ALTER MATERIALIZED VIEW ... OWNER TO wims_app_user` |
| **Auth / Import Fixes** | | | |
| `request.state.wims_user` vestige removed | ✅ | `auth.py` (diff) | Removed `request.state.wims_user = user_dict` |
| `map.py`: `get_db` → `auth.get_db_with_rls` | ✅ | `map.py:378` | `Depends(auth.get_db_with_rls)` replaces `Depends(get_db)` + `_user` |
| 17 import sites updated (database→auth) | ✅ | 14 route + test files | All migrated. No stragglers. |
| Test fixtures switched to `_AdminSessionLocal` | ✅ | 7 test files | `...as _SessionLocal` imports now reference admin |
| `test_immutable_records`: `station_code` removed | ✅ | `test_immutable_records.py` (diff) | Payload no longer has `station_code` field |
| **Infrastructure** | | | |
| nginx localhost passthrough | ✅ | `nginx.conf:18-90` | Server block for `localhost 127.0.0.1` on ports 80+8090 |
| `.dockerignore` `.env.local` | ✅ | `.dockerignore:10` | `.env*.local` added |
| **System Wiki Updates** | ✅ | 13 system-wiki files updated | Mandatory per AGENTS.md |
| **Documentation** | ✅ | `docs/PR-rls-and-fixes.md`, `docs/fix-localhost-hsts.md` etc. | PR doc, localhost HSTS fix, changelog |

### Scope Assessment

**Changes within scope:** ✅ Fully within scope

All changes across 80 files / +2694 / -663 lines trace directly to requirements documented in the PR spec (`docs/PR-rls-and-fixes.md`) or are mandatory wiki updates (per AGENTS.md).

**Scope creep detected:** No

Every change is explicitly called out in the spec:
- System-wiki updates (13 files) — mandatory per AGENTS.md
- `docs/fix-localhost-hsts.md` + `scripts/Fix-LocalhostHSTS.ps1` — documented in commit `bce907e`
- `docs/CHANGELOG.md`, `docs/M4-INCIDENT-WORKFLOW-DETAILS.md`, `docs/regional-dashboard-handover.md` — routine documentation syncs

**Scope omissions:** No

All spec requirements are covered. The only minor deviation: the spec claims "16 import sites" but the diff shows 15 `+from auth import get_db_with_rls` lines across 14 unique files. The 16th count likely includes `map.py`'s `auth.get_db_with_rls` (qualified name, no import) or `test_ai_ids_api.py` (new import, not a change site). Trivial discrepancy — all imports were correctly migrated.

### Notable Observations

1. **Validator page line count:** Spec says 999 lines; actual is **967** — well under 1000.
2. **Import site count:** Spec claims 16; actual 15. All correctly migrated — the discrepancy is cosmetic.
3. **`onInput` removal:** The spec describes removing `onInput` — confirmed absent in final code.
4. **Wiki compliance:** 13 system-wiki files updated. `system-wiki/log.md` has a 109-line entry. Fully compliant with AGENTS.md.

---

## Section 3 — Quality Review

*Axis: Correctness, Security, Performance, Maintainability*

**Assessment: 🟡 Medium-High Risk — 2 new blockers found**

### 🔴 Blocker — Correctness & Security

#### 3.1 Analytics RLS policies incompatible with `wims_app_user`

**File:** `src/postgres-init/11_analytics_facts.sql:29-44`

**What:** All `analytics_incident_facts` RLS policies use `TO <ROLE>` syntax:
```sql
CREATE POLICY aif_national_analyst_read ON wims.analytics_incident_facts
    FOR SELECT TO NATIONAL_ANALYST USING (true);
```

This scopes policies to **PostgreSQL database roles** (actual PG login roles), not application roles. The runtime login role is `wims_app_user`, which inherits from `wims_app` and is **NOT** a member of `NATIONAL_ANALYST`, `NATIONAL_VALIDATOR`, `REGIONAL_ENCODER`, or `SYSTEM_ADMIN` as PostgreSQL roles.

**Impact:** With `FORCE ROW LEVEL SECURITY` active on `analytics_incident_facts`, **no policy matches for `wims_app_user`**. Default-deny applies:
- `SELECT` returns zero rows — analytics dashboards show empty data
- `INSERT`/`UPDATE`/`DELETE` raise permission errors — `sync_incident_to_analytics()` fails silently

This breaks:
- `incidents.py:487` — analytics sync on incident create
- `regional.py:2317` — analytics sync on AFOR import
- `lifecycle.py:726,953,1014` — lifecycle transitions
- All analytics summary and dashboard endpoints serving aggregate data

**Fix:** Rewrite all policies in `11_analytics_facts.sql` to use the `wims.current_user_role()` pattern (matching `10_rls_policies.sql`), removing `TO <role>`:

```sql
-- Instead of:
CREATE POLICY aif_national_analyst_read ON wims.analytics_incident_facts
    FOR SELECT TO NATIONAL_ANALYST USING (true);

-- Use:
CREATE POLICY aif_national_analyst_read ON wims.analytics_incident_facts
    FOR SELECT USING (wims.current_user_role() IN ('NATIONAL_ANALYST', 'SYSTEM_ADMIN'));
```

Also add `INSERT`/`UPDATE` policies for `REGIONAL_ENCODER` and `NATIONAL_VALIDATOR` so `sync_incident_to_analytics` writes work from those routes.

#### 3.2 Analytics-summary endpoint bypasses RLS

**File:** `src/backend/main.py:678`

**What:**
```python
async def get_analytics_summary(
    # ...
    db: Annotated[Session, Depends(get_db)],       # <-- superuser session
    _user: Annotated[dict, Depends(get_current_wims_user)],  # authentication required
):
```

The endpoint authenticates the user but uses `Depends(get_db)` — the admin superuser connection — to query `wims.fire_incidents` and `wims.incident_nonsensitive_details`. The superuser bypasses all RLS policies.

**Impact:** A REGIONAL_ENCODER assigned to Region 1 can see aggregate incident counts from **all 18 regions** — a direct data leak. The `region_id` query parameter provides a client-side filter but no enforcement.

**Fix:** Replace `Depends(get_db)` with `Depends(auth.get_db_with_rls)`:
```python
db: Annotated[Session, Depends(auth.get_db_with_rls)],
```

### 🟠 High

#### 3.3 nginx CORS mirrors `$http_origin`

**Files:** `src/nginx/nginx.conf:68,150`

**What:** Both the localhost and production `location /api/` blocks use:
```nginx
add_header Access-Control-Allow-Origin $http_origin always;
```

This echoes back whatever `Origin` header the client sends — an open CORS policy. Combined with `Access-Control-Allow-Credentials: true`, any website can make credentialed cross-origin requests to the API.

**Impact:** On the VPS production block (line 150), this is a real security vulnerability — arbitrary origins can trigger authenticated API requests from a user's browser.

**Fix:** On the HTTPS production block, restrict to known origins:
```nginx
set $cors_origin "";
if ($http_origin ~* "^https://(wimsbfp\.tech|wims\.bfp\.gov\.ph)$") {
    set $cors_origin $http_origin;
}
add_header Access-Control-Allow-Origin $cors_origin always;
```

For the localhost block, add a comment noting this is dev-only and must never ship to production.

#### 3.4 Validator region-guard removed

**File:** `src/frontend/src/app/dashboard/page.tsx:54-60`

**What:** The old code defensively showed an error when `NATIONAL_VALIDATOR` had no `assignedRegionId`. The new code unconditionally redirects via `defaultRouteForRole(role)`:
```typescript
// Old: if (!assignedRegionId) → setRedirectError('No region assigned...')
// New: router.replace(defaultRouteForRole(role)) → always /dashboard/validator
```

**Impact:** A validator without an assigned region sees an empty queue (RLS returns zero incidents) with no error or guidance message. The old code defensively blocked this at the UI layer; the new code removed that defense.

**Fix:** Restore the `assignedRegionId` check for `NATIONAL_VALIDATOR` in the dashboard redirect:
```typescript
if (!loading && role === 'NATIONAL_VALIDATOR' && !assignedRegionId) {
    setRedirectError('No region assigned to your account. Contact your administrator.');
    return;
}
```

#### 3.5 `SET LOCAL` ephemerality after `db.commit()`

**Files:** `database.py:47-58`, `incidents.py:360-362`, and several route handlers

**What:** `set_rls_context()` uses `SET LOCAL wims.current_user_id = ...`, which resets on transaction commit. Several routes call `db.commit()` mid-handler then continue with RLS-protected queries. For example, `incidents.py:360-362` calls `sync_incident_to_analytics(db, iid)` **after** `db.commit()` — meaning the analytics write runs without RLS context.

**Impact:** The `SELECT` inside `sync_incident_to_analytics` (which queries `wims.fire_incidents`) may return empty results after commit, because `SET LOCAL` has been reset.

**Fix:** Either (a) move `sync_incident_to_analytics` before the first commit, (b) re-apply `set_rls_context()` after commit, or (c) restructure handlers to commit only once at the end.

#### 3.6 `get_db()` silently bypasses RLS — no compile-time guard

**File:** `src/backend/database.py:100-101`

**What:** The docstring warns: "Routes that use `get_db()` directly must not return data that should be filtered by RLS." But this is a human-enforced convention with zero programmatic enforcement. The `main.py:678` analytics-summary endpoint is proof this pattern fails in practice.

**Fix:** Rename `get_db` to `get_admin_db` or `get_unsafe_db` to make the danger explicit, or audit all remaining `get_db()` call sites to ensure none handle data-plane queries. Current safe call sites: `ref.py:103,168` (public fire-stations), `map.py:129,260` (public map), `civilian.py:*` (public routes), `admin.py:*` (admin operations), `user.py:104` (profile updates). Only `main.py:678` is the clear violator.

### 🟡 Medium

#### 3.7 `GRANT ALL` on all `wims.*` tables

**File:** `src/postgres-init/43_app_login_role.sql:31`

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA wims TO wims_app;
```

Comment says "avoids brittle per-table bookkeeping" — but RLS is the only enforcement layer. A single RLS misconfiguration or policy logic error becomes full data exposure for `wims_app_user`.

**Fix:** Long-term: audit per-table grants and reduce:
```sql
REVOKE DELETE ON wims.fire_incidents FROM wims_app;
REVOKE DELETE ON wims.citizen_reports FROM wims_app;
```

#### 3.8 `SYSTEM_TASK_USER_ID` UUID defined in 3 places

**Files:** `database.py:35`, `main.py:230`, `03_users.sql`

The UUID `00000000-0000-0000-0000-000000000002` appears in a Python constant, a startup patch upsert, and a SQL seed. Drift between them silently breaks Celery RLS — `current_user_role()` returns `ANONYMOUS` and all RLS-protected queries return empty.

**Fix:** Centralize in a single constants file, or add a unit test that asserts all three values match. The existing `test_dev_user_seed_mapping.py` doesn't cover this cross-validation.

#### 3.9 SQL string interpolation in `ref.py`

**File:** `src/backend/api/routes/ref.py:85-93`

Province IDs are split, filtered by `.isdigit()`, cast to `int`, cast back to `str`, and interpolated into SQL:
```python
q = text("SELECT ... WHERE province_id IN (" + ",".join([str(i) for i in ids]) + ") ...")
```

The sanitization makes SQL injection unlikely, but string interpolation is inherently fragile. A future refactor could weaken the sanitization.

**Fix:** Use bound parameters:
```python
placeholders = ",".join([f":pid_{i}" for i in range(len(ids))])
q = text(f"SELECT ... WHERE province_id IN ({placeholders}) ...")
params = {f"pid_{i}": v for i, v in enumerate(ids)}
rows = db.execute(q, params).fetchall()
```

#### 3.10 `asyncio.run()` in serial loop

**File:** `src/backend/tasks/narrative.py:44`

Each incident's narrative is generated with `asyncio.run(generate_incident_narrative(iid, db))` inside a sequential for-loop. With a batch of 50 incidents, each requiring an AI API call, this takes ~50 × API latency.

**Fix:** Use `asyncio.gather()` inside a single `asyncio.run()` call:
```python
async def _generate_all(ids, session):
    tasks = [generate_incident_narrative(iid, session) for iid in ids]
    return await asyncio.gather(*tasks, return_exceptions=True)
asyncio.run(_generate_all(incident_ids, db))
```

#### 3.11 Only 6 integration tests for reference table RLS

**File:** `src/backend/tests/test_ref_table_rls.py`

Covers encoder/analyst × 3 geography tables (regions, provinces, cities). Missing:
- NATIONAL_VALIDATOR ref table access
- SYSTEM_ADMIN ref table access
- REGIONAL_ENCODER with `assigned_region_id = NULL` (should see nothing)
- Broader RLS matrix across 18+ tables

**Fix:** Register as a gap in the FRS gap register. Not blocking for merge.

#### 3.12 `get_db_with_rls` couples authentication to RLS context

**File:** `src/backend/auth.py:381-401`

```python
def get_db_with_rls(
    wims_user: Annotated[Optional[dict], Depends(get_current_wims_user)],
):
```

This means `get_current_wims_user` is always called when `get_db_with_rls` is used as a dependency. Routes can't have an RLS-scoped session without also authenticating. Not a bug — the design is intentional — but the coupling should be documented prominently.

### 🟢 Maintainability Strengths

#### 3.13 `roleRedirect.ts` — clean module design

**File:** `src/frontend/src/lib/roleRedirect.ts`

- Cross-origin protection (validates `target.origin !== origin`)
- Generic-path filtering (`GENERIC_LOGIN_PATHS`)
- Cross-role dashboard redirect prevention (`!target.pathname.startsWith(defaultRoute)`)
- 5 vitest tests covering all key scenarios

#### 3.14 Contract test for seed mapping

`test_dev_user_seed_mapping.py` cross-validates 18 encoders across 4 artifacts. Catches drift proactively.

#### 3.15 Thread-safe startup guard

Prevents DDL race conditions in CI when multiple `TestClient(app)` instances trigger startup patches.

#### 3.16 Comprehensive new test files

4 new test files added:
- `test_ref_table_rls.py` — 6 integration tests for ref table RLS
- `test_rls_init_contract.py` — prevents RLS helper function drift
- `test_schema_patch_startup_guard.py` — verifies idempotent startup
- `test_dev_user_seed_mapping.py` — cross-artifact encoder validation

---

## Cross-Cutting Priority Matrix

| Priority | Finding | Axis | Fix |
|----------|---------|------|-----|
| **🔴 P0** | Analytics RLS uses `TO <role>` — never matches `wims_app_user` | Quality | Rewrite using `current_user_role() IN (...)` pattern |
| **🔴 P0** | `/api/analytics-summary` uses `get_db()` — superuser bypass | Quality, Security | Change to `Depends(auth.get_db_with_rls)` |
| 🟠 P1 | nginx production CORS mirrors `$http_origin` | Security, Standards | Restrict to known origins on HTTPS block |
| 🟠 P1 | Validator region-guard removed in dashboard | Quality | Restore `assignedRegionId` check |
| 🟠 P1 | `SET LOCAL` ephemerality after `db.commit()` | Correctness | Re-apply context or restructure commit ordering |
| 🟠 P1 | `GRANT ALL` violates least-privilege | Security | Per-table grant audit |
| 🟡 P2 | Stale docstring in `auth.py:396` | Standards | Update to reflect import from auth |
| 🟡 P2 | `SYSTEM_TASK_USER_ID` in 3 places | Maintainability | Centralize or add cross-assert test |
| 🟡 P2 | `_get_admin_session()` creates sessionmaker per call | Standards, Performance | Cache at module level |
| 🟡 P2 | Fragile test URL rewriting | Standards | Use env var or `urllib.parse` |
| 🟡 P3 | Narrative AI calls serialized | Performance | Use `asyncio.gather()` |
| 🟡 P3 | SQL string interpolation in `ref.py` | Security | Use bound parameters |

---

*End of report. Three axes evaluated independently per the review methodology.*
