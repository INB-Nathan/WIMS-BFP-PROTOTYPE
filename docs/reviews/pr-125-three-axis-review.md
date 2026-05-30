# Three-Axis Review: PR #125

**Reviewed:** `feat/m9a-health-auto-refresh` @ `b749610`
**Base:** `master` @ `b25e7e8`
**Size:** 11 files, +412 / −14 lines (net after cruft removal in `b749610`)
**Date:** 2026-05-29

> **Review history:**
> - 2026-05-27: User comment requesting monitoring endpoints, `Promise.allSettled`, and tests. Addressed in `d11cb92` and `77b06e5`.
> - 2026-05-29: Detailed three-axis review at `77b06e5` (CHANGES_REQUESTED) — 4 blocking items (committed certs, throwaway scripts, empty package.json, stale wiki). Addressed in `b749610`.
> - **Current review** at `b749610` — all prior feedback resolved.

## BLOCKING — Resolved ✓

All 4 blocking items from the prior review at `77b06e5` have been resolved in commit `b749610`:

| # | Issue | Resolution |
|---|-------|------------|
| 1 | `src/nginx/certs/nginx.pfx` (private key committed) | ✅ Removed; `.gitignore` added for `src/nginx/certs/` |
| 2 | Throwaway dev scripts (gen-certs-temp*.ps1, gen_certs.py) | ✅ All 4 files removed |
| 3 | Empty root `package.json` | ✅ Removed |
| 4 | Stale `docs/wiki/*` files | ✅ All 7 files removed; separate docs-audit PR to follow |

**No new blocking items found.**

## SUGGESTIONS (Non-blocking)

### 5. `queue-baseline.test.tsx` fix is unrelated to M9a
> **quote(code):** `src/frontend/src/app/dashboard/analyst/queue-baseline.test.tsx` line 497: `await waitFor(() => expect(screen.getByText('NCR (NCR)')).toBeInTheDocument())`

This is a test stability fix for the analyst dashboard — unrelated to system monitoring. Should be in its own commit/PR to keep M9a diffs clean. Non-blocking since it's a single `waitFor` assertion that won't cause merge conflicts.

### 6. Firebase mock + vitest alias are test infrastructure, not M9a feature code
> **quote(code):** `src/frontend/src/test/__mocks__/firebase-app.ts` and `src/frontend/vitest.config.ts` lines 12-14

These fix Firebase import failures in the Vitest environment (admin system page imports Firebase for notifications). Necessary for monitoring tests to run, but they're test infrastructure. Worth calling out in the PR description.

### 7. TypeScript interfaces could be in a shared types file
> **quote(code):** `page.tsx` lines 93-106: `SystemMetrics` and `WorkerStatus` interfaces defined inline

If other admin pages later consume these endpoints, the types will need extraction. Non-blocking — only one consumer exists now.

### 8. `healthLastChecked` and `monitoringLastChecked` track identical timestamps
> **quote(code):** `page.tsx` lines 117 and 120 — two separate state variables that will always be set together since `loadHealth()` is called from `loadMonitoring()`

The health panel (line 548) and monitoring panel (line 462) each show their own "Last checked" timestamp. Since `loadHealth()` is now called from `loadMonitoring()`, both timestamps are always identical. Consider consolidating into a single `lastChecked` state to reduce duplication.

## PRAISE

- **`Promise.allSettled` for resilience:** One failed endpoint doesn't block the others. Clean implementation in `loadMonitoring()` (lines 169-185).
- **`loadMonitoring` now reuses `loadHealth`:** Addressed the duplication concern from the prior review. `loadHealth` converted to `useCallback` for proper dependency management. The refactoring in `b749610` is clean.
- **Test coverage:** 6 tests in `admin-system-monitoring.test.tsx` covering initial fetch, DOM rendering, 60s interval, unmount cleanup, partial failure resilience, and empty state. Uses `vi.useFakeTimers()` correctly.
- **Firebase mock fix:** `firebase-app.ts` + vitest alias unblocks tests. Surgical.
- **Role-gating:** 60s interval gated on `role === 'SYSTEM_ADMIN'` — prevents unnecessary fetches.
- **Wiki discipline:** `system-wiki/log.md` and `gaps/frs-codebase-gap-register.md` updated. AGENTS.md mandatory wiki update rule satisfied.

## SPEC VERIFICATION

| # | Area | Status | Notes |
|---|------|--------|-------|
| 1 | GET /api/admin/monitoring/system (CPU/RAM/disk) | ✅ | `fetchSystemMetrics()` → progress bars + absolute values |
| 2 | GET /api/admin/monitoring/workers (Celery) | ✅ | `fetchWorkerStatus()` → table with hostname/status/tasks/last-seen |
| 3 | Grouped refresh via `Promise.allSettled` | ✅ | `loadMonitoring()` fans out; partial failure doesn't crash |
| 4 | 60s auto-refresh (initial + interval) | ✅ | `useEffect` with `setInterval(loadMonitoring, 60000)` + cleanup |
| 5 | "Last checked" timestamp visible | ✅ | Both monitoring (line 462) and health (line 548) show timestamps |
| 6 | Tests: initial fetch | ✅ | `admin-system-monitoring.test.tsx` line 102 |
| 7 | Tests: 60s auto-refresh (fake timers) | ✅ | Line 136 — verifies 2nd call after interval |
| 8 | Tests: interval cleanup on unmount | ✅ | Line 158 — unmount + advance, no extra calls |
| 9 | Tests: partial failure resilience | ✅ | Line 182 — metrics rejects, health + workers still render |
| 10 | Tests: worker/system metrics rendering | ✅ | Line 118 — CPU%, memory, disk, worker hostname all checked |

## AGGREGATE SUMMARY

| Axis | Blocking | Suggestion | Nitpick | Praise |
|------|----------|------------|---------|--------|
| Standards | 0 | 1 | 1 | 1 |
| Spec | 0 | 0 | 0 | 1 |
| Quality | 0 | 2 | 2 | 2 |
| **Total** | **0** | **3** | **3** | — |

## VERDICT

**APPROVE.** All 4 blocking items from the prior CHANGES_REQUESTED review are resolved. The `loadMonitoring` refactoring correctly reuses `loadHealth`. The core feature is correct, well-tested, and follows project conventions. Remaining suggestions are non-blocking improvements that can be addressed in follow-up PRs.
