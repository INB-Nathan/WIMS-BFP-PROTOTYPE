# Implementation Handoff — GH #270: Admin Offline-First Read Caching

**Date:** 2026-06-12
**Issue:** https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/270
**Branch:** feat/gh-270-admin-offline-read-caching

## Summary

Added offline-first read caching for the System Admin Hub's monitoring reads (system health, system metrics, worker status, active sessions, audit logs). The 5 monitoring-read call sites in `/admin/system` now use offline-aware wrappers that cache successful online responses in the encrypted IndexedDB analytics-cache store and serve cached data when offline.

## Files Changed

| File | Change |
|---|---|
| `src/frontend/src/lib/api/offlineAdmin.ts` | **Created.** 5 offline-aware wrappers + shared `offlineAware()` helper |
| `src/frontend/src/lib/api/admin.ts` | Re-exports 5 `*OfflineAware` fns + `OfflineAnalyticsResult` type |
| `src/frontend/src/app/admin/system/page.tsx` | Wired `*OfflineAware` fns, `useNetworkStatus`, offline banner, cache indicators |
| `src/frontend/src/lib/api/__tests__/offlineAdmin.test.ts` | 11 unit tests covering all 5 wrappers |
| `src/frontend/src/app/admin/system/admin-system-monitoring.test.tsx` | Updated mocks to `{ response, fromCache }` shape; added offline banner test |
| `src/frontend/src/app/admin/system/admin-system-hitl.test.tsx` | Updated mocks |
| `src/frontend/src/app/admin/system/admin-system-analyze-ai.test.tsx` | Updated mocks |
| `src/frontend/src/app/admin/system/admin-system-search.test.tsx` | Updated mocks |
| `system-wiki/subsystems/admin-hub.md` | Added Offline Read Caching section |
| `system-wiki/log.md` | Appended GH #270 entry |

## What Was NOT Changed

- User CRUD (`fetchAdminUsers`, `createAdminUser`, `updateAdminUser`)
- Security HITL ops (`fetchAdminSecurityLogs`, `analyzeSecurityLog`, `updateAdminSecurityLog`)
- Scheduled reports, backup management
- Backend routes, sync engine, offlineStore core

## Wrapper Contracts

| Wrapper | Cache key | TTL | Return |
|---|---|---|---|
| `fetchSystemHealthOfflineAware()` | `admin:system-health:{}` | 60s | `OfflineAnalyticsResult<SystemHealthResponse>` |
| `fetchSystemMetricsOfflineAware()` | `admin:system-metrics:{}` | 60s | `OfflineAnalyticsResult<SystemMetricsResponse>` |
| `fetchWorkerStatusOfflineAware()` | `admin:worker-status:{}` | 60s | `OfflineAnalyticsResult<WorkerStatusResponse[]>` |
| `fetchActiveSessionsOfflineAware()` | `admin:active-sessions:{}` | 30s | `OfflineAnalyticsResult<any[]>` |
| `fetchAuditLogsOfflineAware(params?)` | `admin:audit-logs:{args}` | 60s | `OfflineAnalyticsResult<PaginatedResponse<AuditLogEntry>>` |

## Base-Fail / Patch-Pass Evidence

**Reproduction test:** `src/frontend/src/lib/api/__tests__/offlineAdmin.test.ts > fetchSystemHealthOfflineAware — offline, no cache > throws when offline with no cached admin data`

```
# Before (base-fail):
$ npx vitest run src/lib/api/__tests__/offlineAdmin.test.ts -t 'throws when offline with no cached admin data'
 FAIL — Failed to resolve import "../offlineAdmin" ... Does the file exist?
 Exit code: 1

# After (patch-pass):
$ npx vitest run src/lib/api/__tests__/offlineAdmin.test.ts
 ✓ 11 tests passed
 Exit code: 0
```

## Mechanical Gate Results

| Gate | Status |
|---|---|
| `npm run lint` | ✅ 0 errors (15 pre-existing warnings) |
| `npx vitest run` | ✅ 237 tests passed, 37 files |
| `ruff check` (backend) | N/A — no backend changes |
| TypeScript compilation | N/A (Vite handles this; tests pass = types resolve) |

## Deviations from Spec

None. Followed the implementation brief exactly:
- 5 wrappers with `admin:` prefix, 60s/30s TTLs
- Offline-aware helper pattern copied from `offlineAnalytics.ts`
- Amber offline banner + `(cached)` + "Last checked" indicators
- Admin CRUD and security ops untouched

## Residual Risks

- **Cache key collision risk low:** The `admin:` prefix and `stableStringify` of args ensure distinct keys per endpoint+params. No two wrappers share the same cache key space.
- **Session TTL staleness:** Active sessions have a 30s TTL. A session could be revoked server-side within that window and the admin would see stale data for up to 30s while offline.
- **Encrypted cache size:** No eviction or size cap for the analytics-cache store (separate from the incident queue cap). Long-running sessions could accumulate admin cache entries. Mitigation: cache keys are deterministic (no unbounded growth per wrapper), and `clearAnalyticsCache()` is available.
- **No offline banner test in hitl/analyze/search test files:** Those test suites mock `isOnline: true` statically and don't test the offline banner. The offline banner is tested in `admin-system-monitoring.test.tsx`.

## Recommended Next Steps

1. **Merge and verify** CI passes (lint + test gates).
2. Consider adding `admin:` cache key prefix constants to avoid string duplication.
3. Future: add a "Clear admin cache" button in the admin hub for debugging.
