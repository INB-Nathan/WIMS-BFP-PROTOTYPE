# Implementation Handoff: GH #269 — Validator Dashboard Offline Wiring

**Date:** 2026-06-12  
**Branch:** `offline-expansion`  
**Commit:** `d9f79ad`  
**Parent:** `a46f618` (fix(#268): persist validator offline op metadata)  
**PR:** GH #269

---

## Summary

Wired the Validator Dashboard (`src/frontend/src/app/dashboard/validator/page.tsx`) for offline-first operation by:

1. **Creating `offlineValidator.ts`** — 5 offline-aware wrapper functions following the `offlineAnalytics.ts` pattern (30-min TTL encrypted cache, connectivity failover, network-error fallback to queuing).
2. **Extending `validator.ts`** — re-exports the new wrappers and types alongside existing regional re-exports.
3. **Adding barrel export** — `index.ts` now has `export * from './validator'`.
4. **Wiring the dashboard page** — replaced direct `apiFetch` calls for queue fetch, archive, unarchive, and verification with offline-aware wrappers; mounted `useNetworkStatus` and `useAutoSync`; added stale-cache amber banner, pending-ops badge, offline indicator, and `wims:sync-complete` SW message listener.
5. **Keeping online-only:** Delete, bulk approve, stats poll, and `force=true` (accept_replace override).

---

## Changed Files

| File | Change |
|---|---|
| `src/frontend/src/lib/api/offlineValidator.ts` | **NEW** — 5 offline-aware wrappers |
| `src/frontend/src/lib/api/validator.ts` | Extended — re-exports wrappers + types |
| `src/frontend/src/lib/api/index.ts` | Extended — added `export * from './validator'` |
| `src/frontend/src/app/dashboard/validator/page.tsx` | Modified — wired hooks, wrappers, UI indicators |
| `src/frontend/src/lib/__tests__/offlineValidator.test.ts` | **NEW** — 3 tests |
| `system-wiki/frontend/frontend-infrastructure.md` | Updated — API slice layout table |
| `system-wiki/architecture/pwa-tests-cicd.md` | Updated — `offlineValidator.ts` section |
| `system-wiki/log.md` | Updated — GH #269 entry appended |

---

## Test Evidence

### Base Fail (reproduction test)

```
$ npx vitest run src/lib/__tests__/offlineValidator.test.ts --reporter=verbose

 FAIL  src/lib/__tests__/offlineValidator.test.ts > submitVerificationOfflineAware > queues a verify op with localId and full payload when offline
TypeError: submitVerificationOfflineAware is not a function
 ❯ src/lib/__tests__/offlineValidator.test.ts:55:26
```

**Root cause:** `offlineValidator.ts` did not exist.

### Patch Pass (3 new tests)

```
$ npx vitest run src/lib/__tests__/offlineValidator.test.ts --reporter=verbose

 ✓ submitVerificationOfflineAware > queues a verify op with localId and full payload when offline (1 ms)
 ✓ archiveIncidentOfflineAware > queues an archive_action op with archive action when offline (1 ms)
 ✓ unarchiveIncidentOfflineAware > queues an archive_action op with unarchive action when offline (1 ms)

 Tests  3 passed (3)
```

### Full Suite

```
$ npx vitest run --reporter=verbose

 Tests  224 passed (224)
 Files  36 of 36
```

---

## Mechanical Gates

| Gate | Result |
|---|---|
| `npm run lint` (all) | ✅ 0 errors, 15 pre-existing warnings (none in changed files) |
| `npm run lint` (changed files only) | ✅ 0 errors, 0 warnings |
| `vitest` (new tests) | ✅ 3/3 passed |
| `vitest` (full suite) | ✅ 224 tests, 36 files, 0 failures |
| `npm run build` | ✅ Compiles clean, 36 static pages generated |
| `console.log`/`debugger` scan | ✅ None found |
| `TODO`/`FIXME`/`HACK`/`XXX` scan | ✅ None found |
| Merge conflict markers | ✅ None |
| Trailing whitespace in added lines | ✅ None |
| Dead imports | ✅ All imports used |
| Naming convention | ✅ camelCase functions, PascalCase components |

---

## Spec Compliance (GH #269 Acceptance Criteria)

| # | Acceptance Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `submitVerificationOfflineAware` queues as `opType: 'verify'` when offline | ✅ | `offlineValidator.ts:81-84` |
| 2 | `localId` generated via `crypto.randomUUID()` | ✅ | `offlineValidator.ts:80,97,152,167` |
| 3 | Online calls include `client_id` UUID | ✅ | `offlineValidator.ts:91,157` |
| 4 | 409 `DUPLICATE_DETECTED` surfaced to page (not queued) | ✅ | `offlineValidator.ts:94-96,160-162` |
| 5 | `fetchValidatorQueueOfflineAware` uses 30-min TTL encrypted cache | ✅ | `offlineValidator.ts:46-47,188,228` |
| 6 | Delete stays online-only | ✅ | `page.tsx` `doDelete` uses `apiFetch` directly |
| 7 | Bulk approve stays online-only | ✅ | `page.tsx` `submitBulkApprove` uses `apiFetch` directly |
| 8 | Stats poll stays online-only | ✅ | Uses `fetchValidatorStats` from `'./regional'` |
| 9 | `wims:sync-complete` SW listener triggers queue refresh | ✅ | `page.tsx` lines ~282-291 |
| 10 | Stale cache banner shown | ✅ | `page.tsx` `cacheMeta` state + amber banner |
| 11 | Pending ops badge shown | ✅ | `page.tsx` `autoSync.pendingCount` badge |
| 12 | Offline indicator shown | ✅ | `page.tsx` `!networkStatus.isOnline` badge |

---

## Spec Deviations

### 1. `force=true` stays online-only (documented)

**What:** The `accept_replace` override (`force=true`) verification is not routed through the offline wrapper. It remains a direct `apiFetch` call.

**Why:** The sync engine's `processVerify` does not yet replay forced override verifications. Adding this would require modifying `syncEngine.ts` to carry and dispatch a `force` flag, plus a conflict-resolution strategy for replaced incidents. That's a separate feature. Documented in code comment at `page.tsx:301-302`.

**Impact:** Minimal — forced overrides are rare admin actions, and the operator will see a standard network error toast if offline. No data loss risk; the action simply won't succeed until connectivity is restored.

---

## Residual Risks

1. **Service worker message listener** depends on `navigator.serviceWorker` being available; gracefully no-ops when absent (e.g., SSR, non-supporting browsers).
2. **No page-level test exists** for the validator dashboard (`validator/__tests__/page.test.tsx`). The wrappers are unit-tested, but the full page integration (hooks + SW listener + cache banner rendering) is not.
3. **Unnecessary type assertion** in `offlineValidator.ts:142,153` — `as unknown as Record<string, unknown>` on archive payload. Cosmetic only; no behavioral impact.
4. **Re-export overlap** — `validator.ts` re-exports `archiveIncident`, `fetchValidatorStats`, `forceReplaceIncident` from `'./regional'`, which are already barrel-exported via `index.ts`'s `export * from './regional'`. Harmless redundancy.

---

## Next Steps

1. **Page-level integration test** — add `validator/__tests__/page.test.tsx` covering offline banner rendering, SW message handler, and cache-banner display.
2. **`force=true` offline fallback** — extend `syncEngine.ts` to support a `force` flag on `processVerify`, then route the `accept_replace` action through `submitVerificationOfflineAware`.
3. **Remove `as unknown as` type assertion** on archive payload lines 142 and 153 of `offlineValidator.ts` (cosmetic cleanup).
4. **Consider dropping duplicate re-exports** from `validator.ts` if barrel cleanliness becomes a concern.

---

## Related Docs

- [Validator Offline Op Types & Sync Engine (GH #268)](validator-offline-op-types-sync-engine.md)
- [Analyst Offline-First Read Caching (GH #266)](analyst-offline-first-read-caching.md)
- [System Wiki — Frontend Infrastructure](../../system-wiki/frontend/frontend-infrastructure.md)
- [System Wiki — PWA Tests & CI/CD](../../system-wiki/architecture/pwa-tests-cicd.md)
