# Thermo Issues — Progress Ledger

Source: meta-review of `/tmp/thermo-{security,maintainability,arch,correctness}-review.md`

Worktree: `/home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/.worktrees/fix-thermo-issues`
Branch: `fix/thermo-issues`

## Task groups (de-duplicated, priority-ordered)

| Group | Issues | Files | Status |
|---|---|---|---|
| A. correctness-blockers | #1, #2 | offlineBase.ts, offlineStore.ts | TODO |
| B. security-and-privacy | #3, #4, #5 | sw.js, AuthContext.tsx | TODO |
| C. reference-store-bugs | #10, #11 | offlineStore.ts | TODO |
| D. orchestrator-cleanup | #6, #8 | offlineBase.ts | TODO (depends on A) |
| E. wrappers-and-types | #7, #9 | 4 wrapper files | TODO (depends on D) |
| F. offlineStore-structural | #12, #15, #16, #17 | offlineStore.ts | TODO |
| G. api-barrel | #14 | api/index.ts | TODO |
| H. dashboard-banner | #18, #19 | dashboard/page.tsx, StaleCacheBanner.tsx | TODO |
| I. sw-cache-key | #20 | sw.js | TODO |
| J. test-surface | #13 | test files | TODO |

## Issue cross-reference

- #1: correctness B1 — wrap cacheReferenceData in try/catch
- #2: correctness B2 — clearAllCachedIncidents should also clear READ_CACHE_STORE + REFERENCE_STORE
- #3: security H1 — SW message handler origin/source check
- #4: correctness H1 — AuthContext.logout postMessage try/catch
- #5: security B3 — restoreSessionFromCache server re-validation
- #6: correctness H2 — move incrementCacheWriteCount out of finally
- #7: maintainability #1 — delete identity type aliases
- #8: arch #1 / maintainability #2 — unify offlineAware + offlineAwareReference
- #9: maintainability #4 — keep wrappers, extract shared helper
- #10: security B2 — runtime key-prefix assertion in cacheReferenceData
- #11: correctness L4 — exact prefix match in clearReferenceDataForUser
- #12: arch #5 — extract evictExpiredInStore helper
- #13: test surface gaps
- #14: arch #13 — api/index.ts re-export coverage
- #15: maintainability #11 — devWarn helper
- #16: maintainability #12 — CachedRecord<TPayload>
- #17: maintainability #13 — LegacyOfflineOpType as Pick<>
- #18: arch #11 — dashboard stale banner
- #19: arch #10 — StaleCacheBanner JSDoc
- #20: correctness L2 — RSC cache key query string

## Progress

(empty)
