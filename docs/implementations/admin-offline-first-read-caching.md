# Implementation Handoff — GH #270: Admin Offline-First Read Caching

**Date:** 2026-06-12
**Issue:** https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/270
**Branch:** `offline-expansion` — implementation commits `87a4223`, `f1c1239`; parent polish captured in follow-up `fix(#270)` commit
**Impl brief:** `/tmp/pi-subagents-uid-1000/chain-runs/a2f22758/impl_brief.md`
**Test contract:** `/tmp/pi-subagents-uid-1000/chain-runs/a2f22758/test_contract.md`
**Worker result:** `/tmp/pi-subagents-uid-1000/chain-runs/a2f22758/impl_result.md`
**Cleanliness gate:** `/tmp/pi-subagents-uid-1000/chain-runs/a2f22758/cleanliness_result.md`

---

## Summary

Added offline-first read caching for the 5 monitoring-read call sites in the System Admin Hub (`/admin/system`). Each call site now uses an offline-aware wrapper (pattern-copied from `offlineAnalytics.ts`) that caches successful online responses in the encrypted IndexedDB analytics-cache store and serves cached data when offline. CRUD operations (user admin, security HITL, scheduled reports) remain online-only. No backend or sync-engine changes were made.

---

## Changed Files (12 total)

| File | Change Type | Detail |
|---|---|---|
| `src/frontend/src/lib/api/offlineAdmin.ts` | **Created** | 5 offline-aware wrappers + shared `offlineAware()` helper |
| `src/frontend/src/lib/api/admin.ts` | Modified | Re-exports 5 `*OfflineAware` fns + `OfflineAdminResult` type |
| `src/frontend/src/app/admin/system/page.tsx` | Modified | Import swaps for `*OfflineAware` fns; `useNetworkStatus` import; exact offline amber banner; `(cached)` and relative "Last checked: X sec ago" indicators on cached panels |
| `src/frontend/src/lib/api/__tests__/offlineAdmin.test.ts` | **Created** | 11 unit tests covering all 5 wrappers |
| `src/frontend/src/app/admin/system/admin-system-monitoring.test.tsx` | Modified | Mocks updated to `{ response, fromCache: false }` shape; offline banner render test added |
| `src/frontend/src/app/admin/system/admin-system-hitl.test.tsx` | Modified | Mocks updated for `*OfflineAware` return shape |
| `src/frontend/src/app/admin/system/admin-system-analyze-ai.test.tsx` | Modified | Mocks updated for `*OfflineAware` return shape |
| `src/frontend/src/app/admin/system/admin-system-search.test.tsx` | Modified | Mocks updated for `*OfflineAware` return shape |
| `system-wiki/subsystems/admin-hub.md` | Modified | Added "Offline Read Caching" section |
| `system-wiki/frontend/frontend-infrastructure.md` | Modified | Added `api/offlineAdmin.ts` to API slice table |
| `system-wiki/log.md` | Modified | Appended GH #270 entry |
| `docs/implementations/admin-offline-first-read-caching.md` | Created | Canonical handoff; duplicate worker draft removed during parent polish |

### Wrapper Contracts

| Wrapper | Cache key | TTL | Return |
|---|---|---|---|
| `fetchSystemHealthOfflineAware()` | `admin:system-health:{}` | 60s | `OfflineAdminResult<SystemHealthResponse>` |
| `fetchSystemMetricsOfflineAware()` | `admin:system-metrics:{}` | 60s | `OfflineAdminResult<SystemMetricsResponse>` |
| `fetchWorkerStatusOfflineAware()` | `admin:worker-status:{}` | 60s | `OfflineAdminResult<WorkerStatusResponse[]>` |
| `fetchActiveSessionsOfflineAware()` | `admin:active-sessions:{}` | 30s | `OfflineAdminResult<any[]>` |
| `fetchAuditLogsOfflineAware(params?)` | `admin:audit-logs:{args}` | 60s | `OfflineAdminResult<PaginatedResponse<AuditLogEntry>>` |

Key prefix format: `admin:{cacheKey}:{encodeURIComponent(stableStringify(args))}` (mirrors `offlineAnalytics.ts` with `analytics:` → `admin:`).

---

## Base-Fail Evidence

**Test:** `fetchSystemHealthOfflineAware — offline, no cache > throws when offline with no cached admin data`
**File:** `src/frontend/src/lib/api/__tests__/offlineAdmin.test.ts`

**Command:**
```bash
cd src/frontend && npx vitest run src/lib/api/__tests__/offlineAdmin.test.ts \
  -t 'throws when offline with no cached admin data' --reporter=verbose
```

**Exit code:** 1

**Output:**
```
 FAIL  src/lib/api/__tests__/offlineAdmin.test.ts
Error: Failed to resolve import "../offlineAdmin" from
  "src/lib/api/__tests__/offlineAdmin.test.ts". Does the file exist?
  Plugin: vite:import-analysis
  File: .../src/lib/api/__tests__/offlineAdmin.test.ts:62:59
  38 |    });
  39 |    it("throws when offline with no cached admin data", async () => {
  40 |      const { fetchSystemHealthOfflineAware } = await import("../offlineAdmin");
     |                                                             ^
  41 |      await expect(fetchSystemHealthOfflineAware()).rejects.toThrow(
  42 |        "System health data is unavailable offline. Reconnect to refresh this view."

 Test Files  1 failed (1)
      Tests  no tests
```

**Root cause:** `src/frontend/src/lib/api/offlineAdmin.ts` did not exist. The import could not resolve, confirming the feature was entirely unimplemented.

**Test fixture pattern** (mirrors `offlineAnalytics.test.ts`):
- Mocks `../../connectivity` → `getConnectivitySnapshot` returns `{ state: 'offline', isOnline: false }`
- Mocks `../../offlineStore` → `getCachedAnalyticsResponse` resolves `undefined`
- Spies on `../legacy` → `fetchSystemHealth` to prove network is never touched
- Uses `vi.hoisted()` + dynamic import pattern for clean module isolation

---

## Patch-Pass Evidence

**Full test suite:**
```bash
$ cd src/frontend && npx vitest run
 ✓ 237 tests passed | 37 files | 0 failures
```

**Targeted test results:**

| Test File | Tests | Result |
|---|---|---|
| `src/lib/api/__tests__/offlineAdmin.test.ts` | 11 | ✅ Passed |
| `src/app/admin/system/admin-system-monitoring.test.tsx` | — | ✅ Passed (mocks + offline banner) |
| `src/app/admin/system/admin-system-hitl.test.tsx` | — | ✅ Passed (mocks only) |
| `src/app/admin/system/admin-system-analyze-ai.test.tsx` | — | ✅ Passed (mocks only) |
| `src/app/admin/system/admin-system-search.test.tsx` | — | ✅ Passed (mocks only) |
| **Total** | **32** | **✅ All passed** |

**Test coverage for `offlineAdmin.test.ts` (11 tests):**
1. `fetchSystemHealthOfflineAware` — offline, no cache → throws descriptive error
2. `fetchSystemHealthOfflineAware` — online fresh → `{ response, fromCache: false }` + cache written
3. `fetchSystemHealthOfflineAware` — network error → falls back to cached `{ response, fromCache: true }`
4. `fetchSystemMetricsOfflineAware` — standard 60s wrapper (smoke)
5. `fetchWorkerStatusOfflineAware` — standard 60s wrapper (smoke)
6. `fetchActiveSessionsOfflineAware` — offline, no cache → throws (session-specific message)
7. `fetchActiveSessionsOfflineAware` — stale TTL (30s) → re-fetch or throw
8. `fetchAuditLogsOfflineAware` — with params → correct cache key `admin:audit-logs:{args}`
9. `fetchAuditLogsOfflineAware` — without params → cache key uses `{}`
10. `fetchAuditLogsOfflineAware` — offline, no cache → throws
11. `fetchAuditLogsOfflineAware` — network error → cached fallback

---

## Lint, Build & Test Gates

| Gate | Command | Result | Detail |
|---|---|---|---|
| Backend ruff check | `ruff check .` (backend) | ✅ Pass | No backend changes; all checks pass |
| Backend ruff format | `ruff format --check .` | ✅ Pass | 177 files already formatted |
| Frontend ESLint | `npm run lint` | ✅ Pass | 0 errors, 15 warnings (all pre-existing, none introduced by GH #270) |
| Vitest (full suite) | `npx vitest run` | ✅ Pass | 237 tests, 37 files, 0 failures |
| Whitespace | `git diff --check` | ✅ Pass | No whitespace errors, no merge conflict markers |
| Dead code / debug artifacts | Manual scan | ✅ Pass | No `console.log`, `debugger`, `print()`, or leftover debug artifacts |
| Merge conflict markers | Manual scan | ✅ Pass | None found |
| File permissions | Manual check | ✅ Pass | All new files mode 644 |
| Naming consistency | Manual review | ✅ Pass | `camelCase` functions/vars match `src/lib/api/` conventions; file names follow `offlineAdmin.ts` → `offlineAnalytics.ts` pattern |

**Notable:** The single fixable eslint warning (`tracking/page.tsx:266` — unused `eslint-disable` directive) is **not in any GH #270 touched file** and was left alone. The warning in a touched file (`page.tsx:221` — `react-hooks/exhaustive-deps`) is pre-existing and not auto-fixable.

---

## Wiki Updates

| Wiki Page | Change | Status |
|---|---|---|
| `system-wiki/subsystems/admin-hub.md` | Added "Offline Read Caching" section documenting the 5 wrappers, cache key prefix, TTLs, and UX pattern | ✅ Updated |
| `system-wiki/log.md` | Appended GH #270 entry with summary, files changed, and verification status | ✅ Updated |
| `system-wiki/gaps/frs-codebase-gap-register.md` | No update needed — no FRS gap status was changed by this work | — |

---

## Spec Deviations

**None.** Implementation follows the issue brief exactly.

| Requirement | Status | Evidence |
|---|---|---|
| 5 offline-aware wrappers with `admin:` prefix | ✅ Done | `offlineAdmin.ts` — `fetchSystemHealthOfflineAware`, `fetchSystemMetricsOfflineAware`, `fetchWorkerStatusOfflineAware`, `fetchActiveSessionsOfflineAware`, `fetchAuditLogsOfflineAware` |
| 60s TTL (30s for sessions) | ✅ Done | Sessions TTL = 30s; all others = 60s |
| Re-export from `admin.ts` | ✅ Done | `admin.ts` re-exports all 5 + `OfflineAdminResult` |
| `offlineAware()` helper copied from `offlineAnalytics.ts:109-126` | ✅ Done | `offlineAdmin.ts` has identical `offlineAware()` with `admin:` prefix |
| Amber offline banner (analyst/page.tsx:526-529 pattern) | ✅ Done | `<div>` with amber styling at top of `/admin/system` page |
| Cache indicators: `(cached)` + relative "Last checked: X sec ago" | ✅ Done | Appended to health, monitoring, sessions, and audit panels only when served from cache |
| Admin CRUD + security ops untouched | ✅ Done | `fetchAdminUsers`, `createAdminUser`, `updateAdminUser`, `fetchAdminSecurityLogs`, `analyzeSecurityLog`, `updateAdminSecurityLog` — all untouched |
| No backend / sync-engine changes | ✅ Done | All changes are frontend-only |

---

## Residual Risks

1. **Session TTL staleness (30s window).** Active sessions have a 30s TTL. A session revoked server-side will appear active for up to 30s while the admin is offline. Acceptable for the offline-first pattern; the page re-fetches when connectivity returns.

2. **Cache size growth.** The analytics-cache store has no eviction or size cap (separate from the incident queue cap). Cache keys are deterministic (one per unique args), so growth is bounded by the number of distinct parameter combinations used. `clearAnalyticsCache()` is available as a manual escape hatch.

3. **No offline banner test in hitl/analyze/search test files.** Those 3 test suites mock `isOnline: true` statically and don't render-test the offline banner. Only `admin-system-monitoring.test.tsx` covers it. Manual QA should verify the banner on each panel.

4. **Pre-existing eslint warning in touched file.** `page.tsx:221` has a `react-hooks/exhaustive-deps` warning that predates this PR. Not introduced, not auto-fixable. Low risk but could mask future lint regressions in that file.

---

## Next Steps

1. **Merge** `offline-expansion` branch into target.
2. **CI re-validation** — run the full pre-flight (`npm run lint`, `npx vitest run`) on the merge commit. Backend gates (`ruff check`, `ruff format --check`) can be skipped if the merge is clean (no backend changes).
3. **Optional:** Add `admin:` cache key prefix constants to `offlineAdmin.ts` to avoid string duplication across wrappers.
4. **Optional:** Add a "Clear admin cache" button in the admin hub for debugging during development.
5. **Future:** When adding offline reading for additional admin panels, follow the same pattern: create wrapper in `offlineAdmin.ts`, re-export from `admin.ts`, wire into page with `useNetworkStatus`, add `(cached)`/`(refreshing)` indicators.
