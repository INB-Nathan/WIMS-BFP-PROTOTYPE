# Offline Caching for Every Role — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete encrypted/unencrypted offline read-caching across all four roles (admin, validator, analyst, reference) and fix the storage, SW, and eviction layers per spec v3.

**Architecture:** Extend the existing `offlineAware()` pattern in `offlineBase.ts`. Rename the single `cacheAnalyticsResponse` storage path to generic `cacheReadResponse`/`getReadCachedResponse` (encrypted) + add `cacheReferenceData`/`getCachedReferenceData` (unencrypted, per-user namespaced) in a new `REFERENCE_STORE` (DB v6). Add 12 domain wrappers across 4 lib files, extract 2 raw `apiFetch` calls into API functions first, add one shared `StaleCacheBanner`, rewire 12 pages (no `useAutoSync`), add SW canonical-path collapse + post-login role prefetch, and wire per-record-TTL eviction.

**Tech Stack:** TypeScript, Next.js App Router, React, `idb` (IndexedDB), Web Crypto (AES-GCM), Vitest + jsdom, service worker (`public/sw.js`).

## Global Constraints

- Python-style 4-space indent does NOT apply; this is the frontend — follow existing TS/React conventions in `src/frontend`.
- TDD red-first for every code task: write the failing test, run it, implement, run green, commit. No production code without a failing test first.
- Run `cd src/frontend && npx vitest run` after every task; `npm run lint` + `npm run build` (with `NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth` and `NEXT_PUBLIC_BASE_URL=http://localhost:3000`) before the final task.
- Each task ends with a commit using Conventional Commit subjects scoped to the change (e.g. `feat(offline): ...`, `refactor(offlineStore): ...`).
- Do NOT mount `useAutoSync` on any of the 7 full-rewire pages or the 5 swap pages. Scope A queues no offline writes. Only `useNetworkStatus` may be added.
- Reference cache keys MUST embed `userId` (`reference:{userId}:…`) — RLS-scoped data, unencrypted store.
- The old method names `cacheAnalyticsResponse`/`getCachedAnalyticsResponse` are removed; all callers (in-repo) migrated.
- DB `DB_VERSION` bumps 5 → 6; the `upgrade()` callback must NOT drop existing stores.
- `CACHE_NAME` bumps `wims-bfp-cache-v11` → `wims-bfp-cache-v12`.
- Caveman communication mode is active in this session; plan prose stays technical, not padded.

## File Structure

**New files:**
- `src/frontend/src/lib/api/offlineReference.ts` — 3 unencrypted, userId-namespaced ref wrappers (regions/provinces/cities, 7-day TTL).
- `src/frontend/src/lib/__tests__/offlineReference.test.ts` — table-driven wrapper tests + per-user isolation test.
- `src/frontend/src/components/ui/StaleCacheBanner.tsx` — shared amber stale-cache banner over `StickyBanner`.
- `src/frontend/src/components/ui/__tests__/StaleCacheBanner.test.tsx` — unit test.
- `src/frontend/src/app/dashboard/analyst/incidents/[id]/wildland/wildland.test.tsx` — new page test (none exists).
- `src/frontend/src/lib/__tests__/offlineStore.reference.test.ts` — unencrypted store + eviction + per-user isolation tests.
- `src/frontend/src/lib/__tests__/swRolePrefetch.test.ts` — SW `PREFETCH_ROLE` message handler test.

**Modified files:**
- `src/frontend/src/lib/offlineStore.ts` — rename methods, add `REFERENCE_STORE` + DB v6, per-record `ttlMs`, eviction fns, user-switch prefix clear.
- `src/frontend/src/lib/api/offlineBase.ts` — migrate to new method names, add `offlineAwareReference`, pass `ttlMs` into cache writes.
- `src/frontend/src/lib/api/offlineValidator.ts` — migrate direct cache calls to new names; +2 wrappers (map/audit).
- `src/frontend/src/lib/api/offlineAdmin.ts` — +6 wrappers.
- `src/frontend/src/lib/api/offlineAnalytics.ts` — +1 wrapper (wildland).
- `src/frontend/src/lib/api/validator.ts` — +2 API functions (`fetchOperationalMap`, `fetchValidatorAuditLogs`).
- `src/frontend/src/lib/api/index.ts` — re-export new wrappers + ref wrappers.
- `src/frontend/src/lib/api/admin.ts` — re-export admin wrappers (existing hub).
- `src/frontend/public/sw.js` — bump cache, canonical-path collapse, 3 shells, `PREFETCH_ROLE` handler.
- `src/frontend/__tests__/sw-cache-key.test.ts` — extend with new collapse + prefetch assertions.
- 12 page files (listed in Tasks 11–14) + their existing test files (mock updates).
- `system-wiki/architecture/pwa-tests-cicd.md`, `system-wiki/log.md` — wiki updates.

## Dependency Graph & Parallelism

Tasks form a DAG. The critical path is linear through the storage layer (everything depends on it), but several branches fan out into parallel work once the foundation lands:

```
T1 storage refactor ──► T2 offlineAwareReference ──► T4 ref wrappers ─┐
                  ├──► T3 API abstraction (validator fns) ────────────┤
                  ├──► T5 admin wrappers (needs T1 only) ─────────────┤
                  ├──► T6 validator wrappers (needs T1 + T3) ─────────┤
                  ├──► T7 analyst wildland wrapper (needs T1 only) ───┤
                  ├──► T8 StaleCacheBanner (independent, no deps) ────┤
                  ├──► T9 SW canonical + prefetch (needs T8? no — independent) ──┤
                  ├──► T10 eviction wiring (needs T1) ────────────────┤
                                                                        ▼
                                                                 T11–14 page rewires (need all wrappers + banner + SW)
                                                                        ▼
                                                                 T15 wiki + CI
```

**Parallelizable groups (can run concurrently after their common dependency lands):**
- **After T1 (storage refactor):** T2, T3, T5, T7, T8, T9, T10 can all run in parallel (T6 needs T3 too, so it waits for T3).
- **After T2 + T3:** T4 (ref wrappers, needs T2) and T6 (validator wrappers, needs T1+T3) join the parallel pool.
- **Page rewires (T11–14) are the fan-in:** they need ALL wrapper tasks + T8 banner + T9 SW done. Within the rewires, the 4 page groups are independent of each other and can run in parallel.
- **T8 (StaleCacheBanner) and T9 (SW) have NO upstream deps** — they can start immediately, in parallel with T1.

Recommended execution waves (for subagent-driven parallel dispatch):
- **Wave 0 (parallel, no deps):** T8, T9.
- **Wave 1 (sequential, foundation):** T1.
- **Wave 2 (parallel, after T1):** T2, T3, T5, T7, T10. (T6 waits for T3.)
- **Wave 3 (parallel, after T2 + T3):** T4, T6.
- **Wave 4 (parallel, after all wrappers + T8 + T9):** T11, T12, T13, T14.
- **Wave 5 (sequential):** T15.

---

### Task 1: Storage layer refactor (offlineStore.ts)

**Files:**
- Modify: `src/frontend/src/lib/offlineStore.ts`
- Test: `src/frontend/src/lib/__tests__/offlineStore.reference.test.ts` (create), `src/frontend/src/lib/__tests__/offlineStore.encryption.test.ts` (modify), `src/frontend/src/lib/api/__tests__/offlineAdmin.test.ts` (modify mock names), `src/frontend/src/lib/__tests__/offlineValidator.test.ts` (modify mock names), `src/frontend/src/lib/__tests__/offlineAnalytics.test.ts` (modify mock names)

**Interfaces:**
- Consumes: existing `encryptPayload`/`decryptPayload`, `getDB`, `setActiveOfflineUser`, `clearAllOfflineData`, per-user crypto key machinery (unchanged).
- Produces (exact signatures later tasks rely on):
  - `cacheReadResponse<T>(key: string, data: T, ttlMs: number, cachedAt?: number): Promise<void>` — encrypted, `READ_CACHE_STORE`.
  - `getReadCachedResponse<T>(key: string): Promise<CachedResponse<T> | undefined>` — decrypts.
  - `cacheReferenceData<T>(key: string, data: T, ttlMs: number, cachedAt?: number): Promise<void>` — UNENCRYPTED, `REFERENCE_STORE`. Caller builds userId-namespaced key.
  - `getCachedReferenceData<T>(key: string): Promise<CachedResponse<T> | undefined>` — plaintext read.
  - `evictExpiredReadCache(): Promise<number>` — per-record `ttlMs` prune, returns deleted count.
  - `evictExpiredReferenceData(): Promise<number>` — same for ref store.
  - `CachedResponse<T> = { key: string; data: T; cachedAt: number; ttlMs: number }` (type; `CachedAnalyticsResponse` kept as alias).
  - `clearReferenceDataForUser(userId: string): Promise<number>` — deletes `reference:{userId}:*` prefix.

- [ ] **Step 1: Write failing test — unencrypted ref round-trip + per-record ttlMs**

Create `src/frontend/src/lib/__tests__/offlineStore.reference.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  cacheReferenceData,
  getCachedReferenceData,
  evictExpiredReferenceData,
  clearReferenceDataForUser,
} from '../offlineStore';

describe('offlineStore reference (unencrypted) store', () => {
  beforeEach(async () => {
    // Wipe IDB between tests via fake-indexeddb reset (pattern from encryption test)
    const { default: fakeIDB } = await import('fake-indexeddb');
    // @ts-expect-error test override of global indexedDB
    global.indexedDB = fakeIDB;
  });

  it('round-trips plaintext data without an EncryptedPayload shape', async () => {
    await cacheReferenceData('reference:userA:regions', [{ region_id: 1 }], 7 * 24 * 60 * 60 * 1000);
    const got = await getCachedReferenceData<{ region_id: number }[]>('reference:userA:regions');
    expect(got?.data).toEqual([{ region_id: 1 }]);
    expect(got?.ttlMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(got?.cachedAt).toBeTypeOf('number');
  });

  it('is per-user isolated: userB key does not return userA data', async () => {
    await cacheReferenceData('reference:userA:regions', [{ region_id: 1 }], 7 * 24 * 60 * 60 * 1000);
    const got = await getCachedReferenceData('reference:userB:regions');
    expect(got).toBeUndefined();
  });

  it('evictExpiredReferenceData deletes only records past their own ttlMs', async () => {
    const longTtl = 7 * 24 * 60 * 60 * 1000;
    const shortTtl = 60_000;
    const now = Date.now();
    await cacheReferenceData('reference:userA:regions', [1], longTtl, now - 70_000); // expired (short-ish aged but long ttl -> NOT expired)
    await cacheReferenceData('reference:userA:provinces:1', [2], shortTtl, now - 70_000); // expired
    const deleted = await evictExpiredReferenceData();
    expect(deleted).toBe(1);
    expect(await getCachedReferenceData('reference:userA:regions')).toBeDefined();
    expect(await getCachedReferenceData('reference:userA:provinces:1')).toBeUndefined();
  });

  it('clearReferenceDataForUser deletes only that user prefix', async () => {
    await cacheReferenceData('reference:userA:regions', [1], 7 * 24 * 60 * 60 * 1000);
    await cacheReferenceData('reference:userB:regions', [2], 7 * 24 * 60 * 60 * 1000);
    const deleted = await clearReferenceDataForUser('userA');
    expect(deleted).toBe(1);
    expect(await getCachedReferenceData('reference:userA:regions')).toBeUndefined();
    expect(await getCachedReferenceData('reference:userB:regions')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/frontend && npx vitest run src/lib/__tests__/offlineStore.reference.test.ts`
Expected: FAIL — `cacheReferenceData` is not exported (does not exist yet).

- [ ] **Step 3: Implement — add REFERENCE_STORE, new methods, per-record ttlMs, eviction**

In `src/frontend/src/lib/offlineStore.ts`:
- Change `const DB_VERSION = 5;` → `const DB_VERSION = 6;`.
- Add `const REFERENCE_STORE = 'reference-cache';` near `ANALYTICS_STORE`.
- Add `interface CachedReadRecord { key: string; encrypted: EncryptedPayload; cachedAt: number; ttlMs: number }` and `interface CachedReferenceRecord { key: string; data: unknown; cachedAt: number; ttlMs: number }`.
- In the `upgrade()` callback, add `if (oldVersion < 6) db.createObjectStore(REFERENCE_STORE, { keyPath: 'key' });` — do NOT touch existing stores.
- Rename `cacheAnalyticsResponse` → `cacheReadResponse` with new signature `(key, data, ttlMs, cachedAt = Date.now())`; store `ttlMs` on the record. Keep `getCachedAnalyticsResponse` → `getReadCachedResponse` returning `CachedResponse<T>` (add `ttlMs`).
- Add `cacheReferenceData`/`getCachedReferenceData` (no encrypt/decrypt; use `REFERENCE_STORE`; `data: unknown` stored directly).
- Add `evictExpiredReadCache()` and `evictExpiredReferenceData()`: open a read+write cursor over the store, delete records where `cachedAt + record.ttlMs < Date.now()`, cap at 500 deletions per pass, return count. Back-compat: records missing `ttlMs` (shouldn't happen post-v3 but guard) use `30 * 60 * 1000` as default.
- Add `clearReferenceDataForUser(userId)`: cursor over `REFERENCE_STORE`, delete keys matching `new RegExp('^reference:' + escapeRegex(userId) + ':')`, return count. Add a small `escapeRegex` helper.
- Export `CachedResponse<T>` type; add `export type CachedAnalyticsResponse<T> = CachedResponse<T>` alias.
- Update `setActiveOfflineUser(userId)`: in the branch where `prev && prev !== userId`, after the existing crypto-key wipe, `await clearReferenceDataForUser(prev)` (best-effort `try/catch` + `console.warn`).

- [ ] **Step 4: Run reference test to verify it passes**

Run: `cd src/frontend && npx vitest run src/lib/__tests__/offlineStore.reference.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write failing test — renamed encrypted methods + migration**

In `src/frontend/src/lib/__tests__/offlineStore.encryption.test.ts`, replace every `cacheAnalyticsResponse` → `cacheReadResponse` and `getCachedAnalyticsResponse` → `getReadCachedResponse`, and update calls to pass `ttlMs` (e.g. `60_000`). Add one assertion that the stored record carries `ttlMs`.

```ts
// example updated call
await cacheReadResponse('admin:system-health', { ok: true }, 60_000);
const got = await getReadCachedResponse('admin:system-health');
expect(got?.ttlMs).toBe(60_000);
```

- [ ] **Step 6: Run encryption test to verify it passes**

Run: `cd src/frontend && npx vitest run src/lib/__tests__/offlineStore.encryption.test.ts`
Expected: PASS.

- [ ] **Step 7: Migrate callers + their test mocks (compile-break sweep)**

- `src/frontend/src/lib/api/offlineBase.ts`: change imports `cacheAnalyticsResponse`/`getCachedAnalyticsResponse` → `cacheReadResponse`/`getReadCachedResponse`; in `offlineAware`, pass the wrapper's `ttlMs` into `cacheReadResponse(key, response, ttlMs)`.
- `src/frontend/src/lib/api/offlineValidator.ts`: replace its direct `cacheAnalyticsResponse`/`getCachedAnalyticsResponse` calls with `cacheReadResponse`/`getReadCachedResponse` (pass `ttlMs`).
- Test mock files — update `vi.mock('../../offlineStore', ...)` blocks in `lib/api/__tests__/offlineAdmin.test.ts`, `lib/__tests__/offlineValidator.test.ts`, `lib/__tests__/offlineAnalytics.test.ts`: rename the mock keys to `cacheReadResponse`/`getReadCachedResponse` and update call assertions.

- [ ] **Step 8: Run full vitest + tsc to confirm no dangling old-name refs**

Run: `cd src/frontend && npx vitest run && npx tsc --noEmit`
Expected: all green, no `cacheAnalyticsResponse` errors.

- [ ] **Step 9: Commit**

```bash
git add src/frontend/src/lib/offlineStore.ts src/frontend/src/lib/api/offlineBase.ts src/frontend/src/lib/api/offlineValidator.ts src/frontend/src/lib/__tests__/offlineStore.reference.test.ts src/frontend/src/lib/__tests__/offlineStore.encryption.test.ts src/frontend/src/lib/api/__tests__/offlineAdmin.test.ts src/frontend/src/lib/__tests__/offlineValidator.test.ts src/frontend/src/lib/__tests__/offlineAnalytics.test.ts
git commit -m "refactor(offlineStore): generic cache methods, REFERENCE_STORE (unencrypted, per-user), per-record ttlMs, eviction"
```

---

### Task 2: offlineAwareReference orchestrator

**Files:**
- Modify: `src/frontend/src/lib/api/offlineBase.ts`
- Test: `src/frontend/src/lib/api/__tests__/offlineBase.test.ts` (create if absent, else extend)

**Interfaces:**
- Consumes: `cacheReferenceData`/`getCachedReferenceData` (Task 1), shared helpers `shouldServeOffline`, `isNetworkError`, `markConnectivityOffline`, `buildCacheKey`, `isFresh`.
- Produces: `offlineAwareReference<T>(cacheKey: string, args: unknown[], prefix: string, ttlMs: number, userId: string, fetcher: () => Promise<T>, errorMessage: string): Promise<OfflineResult<T>>` — same control flow as `offlineAware` but unencrypted store + userId baked into key via `buildCacheKey(\`${prefix}:${userId}\`, cacheKey, args)`.

- [ ] **Step 1: Write failing test**

Create/extend `src/frontend/src/lib/api/__tests__/offlineBase.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refMocks = vi.hoisted(() => ({
  getCachedReferenceData: vi.fn(),
  cacheReferenceData: vi.fn(),
  fetcher: vi.fn(),
  markConnectivityOffline: vi.fn(),
  snapshot: { state: 'online' as const, isOnline: true, isChecking: false, isReconnecting: false, lastCheckedAt: null },
}));

vi.mock('../../offlineStore', () => ({
  getCachedReferenceData: refMocks.getCachedReferenceData,
  cacheReferenceData: refMocks.cacheReferenceData,
}));
vi.mock('../../connectivity', () => ({
  getConnectivitySnapshot: () => refMocks.snapshot,
  markConnectivityOffline: refMocks.markConnectivityOffline,
}));

import { offlineAwareReference } from '../offlineBase';

describe('offlineAwareReference', () => {
  beforeEach(() => { vi.clearAllMocks(); refMocks.snapshot.state = 'online'; });

  it('online: fetches, caches with ttlMs + userId-namespaced key, returns fromCache:false', async () => {
    refMocks.fetcher.mockResolvedValue([{ region_id: 1 }]);
    const res = await offlineAwareReference('regions', [], 'reference', 7 * 24 * 60 * 60 * 1000, 'userA', refMocks.fetcher, 'err');
    expect(res).toEqual({ response: [{ region_id: 1 }], fromCache: false });
    expect(refMocks.cacheReferenceData).toHaveBeenCalledWith('reference:userA:regions:%5B%5D', [{ region_id: 1 }], 7 * 24 * 60 * 60 * 1000, expect.any(Number));
  });

  it('offline + fresh cache: returns cached', async () => {
    refMocks.snapshot.state = 'offline';
    refMocks.getCachedReferenceData.mockResolvedValue({ data: [{ region_id: 1 }], cachedAt: Date.now(), ttlMs: 7 * 24 * 60 * 60 * 1000 });
    const res = await offlineAwareReference('regions', [], 'reference', 7 * 24 * 60 * 60 * 1000, 'userA', refMocks.fetcher, 'err');
    expect(res.fromCache).toBe(true);
  });

  it('offline + miss: throws errorMessage', async () => {
    refMocks.snapshot.state = 'offline';
    refMocks.getCachedReferenceData.mockResolvedValue(undefined);
    await expect(offlineAwareReference('regions', [], 'reference', 7 * 24 * 60 * 60 * 1000, 'userA', refMocks.fetcher, 'unavailable')).rejects.toThrow('unavailable');
  });

  it('network error: marks offline + falls back to fresh cache', async () => {
    refMocks.fetcher.mockRejectedValue(new TypeError('Failed to fetch'));
    refMocks.getCachedReferenceData.mockResolvedValue({ data: [{ region_id: 1 }], cachedAt: Date.now(), ttlMs: 7 * 24 * 60 * 60 * 1000 });
    const res = await offlineAwareReference('regions', [], 'reference', 7 * 24 * 60 * 60 * 1000, 'userA', refMocks.fetcher, 'err');
    expect(refMocks.markConnectivityOffline).toHaveBeenCalled();
    expect(res.fromCache).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/frontend && npx vitest run src/lib/api/__tests__/offlineBase.test.ts`
Expected: FAIL — `offlineAwareReference` not exported.

- [ ] **Step 3: Implement offlineAwareReference**

In `src/frontend/src/lib/api/offlineBase.ts`, add (mirroring `offlineAware` but unencrypted + userId):

```ts
export async function offlineAwareReference<T>(
  cacheKey: string,
  args: unknown[],
  prefix: string,
  ttlMs: number,
  userId: string,
  fetcher: () => Promise<T>,
  errorMessage: string,
): Promise<OfflineResult<T>> {
  const key = buildCacheKey(`${prefix}:${userId}`, cacheKey, args);
  if (shouldServeOffline()) {
    return readFreshReferenceCacheOrThrow<T>(key, ttlMs, errorMessage);
  }
  try {
    const response = await fetcher();
    await cacheReferenceData(key, response, ttlMs);
    return { response, fromCache: false };
  } catch (err) {
    if (isNetworkError(err)) {
      markConnectivityOffline();
      return readFreshReferenceCacheOrThrow<T>(key, ttlMs, errorMessage);
    }
    throw err;
  }
}
```

Add `readFreshReferenceCacheOrThrow` (sibling of `readFreshCacheOrThrow` using `getCachedReferenceData` + `isFresh`). Import `cacheReferenceData`/`getCachedReferenceData` from `../offlineStore`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/frontend && npx vitest run src/lib/api/__tests__/offlineBase.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/lib/api/offlineBase.ts src/frontend/src/lib/api/__tests__/offlineBase.test.ts
git commit -m "feat(offlineBase): offlineAwareReference orchestrator (unencrypted, userId-namespaced)"
```

---

### Task 3: API abstraction — fetchOperationalMap + fetchValidatorAuditLogs

**Files:**
- Modify: `src/frontend/src/lib/api/validator.ts` (verify location first; if validator fns live in `legacy.ts`, add there instead and re-export from `validator.ts`)
- Test: `src/frontend/src/lib/api/__tests__/validator.test.ts` (create or extend)

**Interfaces:**
- Consumes: `apiFetch` from `@/lib/api`.
- Produces:
  - `fetchOperationalMap(params: { /* verify exact keys from validator/map/page.tsx:55-63 */ }): Promise<MapClusterItem[]>`
  - `fetchValidatorAuditLogs(params: AuditLogParams): Promise<AuditResponse>`
  - Types `OperationalMapParams`, `AuditLogParams`, `MapClusterItem` (already exported), `AuditResponse` (extract from the inline generic in `validator/audit/page.tsx`).

- [ ] **Step 1: Read the two pages to extract exact param keys + types**

Read `src/frontend/src/app/dashboard/validator/map/page.tsx` (lines ~50–65) and `src/frontend/src/app/dashboard/validator/audit/page.tsx` (lines ~80–95) to copy the exact `URLSearchParams` keys and the response generics.

- [ ] **Step 2: Write failing test**

Create `src/frontend/src/lib/api/__tests__/validator.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../api';
import { fetchOperationalMap, fetchValidatorAuditLogs } from '../validator';

describe('validator API functions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetchOperationalMap builds query + calls apiFetch', async () => {
    (apiFetch as vi.Mock).mockResolvedValue({ clusters: [{ incident_id: 1, lat: 1, lng: 2 }] });
    const res = await fetchOperationalMap({ /* exact keys from step 1 */ });
    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/api/validator/operational-map?'));
    expect(res).toEqual([{ incident_id: 1, lat: 1, lng: 2 }]);
  });

  it('fetchValidatorAuditLogs builds query + calls apiFetch', async () => {
    (apiFetch as vi.Mock).mockResolvedValue({ items: [], total: 0 });
    await fetchValidatorAuditLogs({ /* exact keys from step 1 */ });
    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/api/regional/validator/audit-logs?'));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src/frontend && npx vitest run src/lib/api/__tests__/validator.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 4: Implement the two functions**

In `src/frontend/src/lib/api/validator.ts` (or `legacy.ts`), port the `URLSearchParams` building verbatim from the pages into named functions. Export `OperationalMapParams`, `AuditLogParams`, `AuditResponse` types. Re-export from `lib/api/index.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src/frontend && npx vitest run src/lib/api/__tests__/validator.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/lib/api/validator.ts src/frontend/src/lib/api/__tests__/validator.test.ts src/frontend/src/lib/api/index.ts
git commit -m "feat(validator): fetchOperationalMap + fetchValidatorAuditLogs API functions"
```

---

### Task 4: Reference wrappers (offlineReference.ts)

**Files:**
- Create: `src/frontend/src/lib/api/offlineReference.ts`
- Test: `src/frontend/src/lib/__tests__/offlineReference.test.ts` (create)

**Interfaces:**
- Consumes: `offlineAwareReference` (Task 2), `fetchRegions`/`fetchProvinces`/`fetchCities` from `./legacy`, `Region`/`Province`/`City` types.
- Produces:
  - `fetchRegionsOfflineAware(userId: string): Promise<OfflineResult<Region[]>>`
  - `fetchProvincesOfflineAware(userId: string, regionId: string | number): Promise<OfflineResult<Province[]>>`
  - `fetchCitiesOfflineAware(userId: string, provinceId: string | number): Promise<OfflineResult<City[]>>`
  - All 7-day TTL, prefix `reference`, unencrypted store, userId-namespaced keys.

- [ ] **Step 1: Write failing test (table-driven + isolation)**

Create `src/frontend/src/lib/__tests__/offlineReference.test.ts` mirroring the `offlineAdmin.test.ts` mock pattern (`vi.hoisted`, mock `../legacy` + `../../offlineStore` + `../../connectivity`). Use `describe.each` over the 3 wrappers × 5 cases (online-caches, offline-fresh, offline-miss, neterr-fallback, stale-throws). Add one isolation case: userA's `fetchRegionsOfflineAware('userA')` cached result is NOT returned when calling with `'userB'` offline.

```ts
const REF_TTL = 7 * 24 * 60 * 60 * 1000;
const cases: Array<[string, () => Promise<unknown>, string]> = [
  ['regions', () => fetchRegionsOfflineAware('userA'), 'fetchRegions'],
  ['provinces', () => fetchProvincesOfflineAware('userA', 1), 'fetchProvinces'],
  ['cities', () => fetchCitiesOfflineAware('userA', 1), 'fetchCities'],
];
describe.each(cases)('%s wrapper', (_name, call, legacyName) => { /* 5 cases */ });
it('userA cache is not returned for userB offline', async () => { /* cache for userA, snapshot offline, call with userB -> throws/miss */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/frontend && npx vitest run src/lib/__tests__/offlineReference.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement offlineReference.ts**

```ts
import { fetchRegions as legacyFetchRegions, fetchProvinces as legacyFetchProvinces, fetchCities as legacyFetchCities } from './legacy';
import type { Region, Province, City } from './legacy';
import { OfflineResult, offlineAwareReference } from './offlineBase';

const REF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_REF_ERROR = 'Reference data is unavailable offline. Reconnect to refresh.';
export type OfflineReferenceResult<T> = OfflineResult<T>;

export function fetchRegionsOfflineAware(userId: string): Promise<OfflineReferenceResult<Region[]>> {
  return offlineAwareReference('regions', [], 'reference', REF_TTL_MS, userId, () => legacyFetchRegions(), OFFLINE_REF_ERROR);
}
export function fetchProvincesOfflineAware(userId: string, regionId: string | number): Promise<OfflineReferenceResult<Province[]>> {
  return offlineAwareReference('provinces', [regionId], 'reference', REF_TTL_MS, userId, () => legacyFetchProvinces(regionId), OFFLINE_REF_ERROR);
}
export function fetchCitiesOfflineAware(userId: string, provinceId: string | number): Promise<OfflineReferenceResult<City[]>> {
  return offlineAwareReference('cities', [provinceId], 'reference', REF_TTL_MS, userId, () => legacyFetchCities(provinceId), OFFLINE_REF_ERROR);
}
```

Re-export from `src/frontend/src/lib/api/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/frontend && npx vitest run src/lib/__tests__/offlineReference.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/lib/api/offlineReference.ts src/frontend/src/lib/__tests__/offlineReference.test.ts src/frontend/src/lib/api/index.ts
git commit -m "feat(offline): reference wrappers (regions/provinces/cities, unencrypted, per-user, 7d TTL)"
```

---

### Task 5: Admin 6 wrappers (offlineAdmin.ts)

**Files:**
- Modify: `src/frontend/src/lib/api/offlineAdmin.ts`
- Test: `src/frontend/src/lib/api/__tests__/offlineAdmin.test.ts` (extend)

**Interfaces:**
- Consumes: `offlineAware` (Task 1 migration), `legacy.fetchAdminSecurityLogs`/`fetchSecurityLogsSummary`/`fetchAnomalies`/`fetchAdminConfig`/`fetchRateLimits`, `breach.fetchBreaches`, types.
- Produces (all encrypted, prefix `admin`):
  - `fetchAdminSecurityLogsOfflineAware(params?): Promise<OfflineAdminResult<{ items: any[]; total: number }>>` — 60s
  - `fetchSecurityLogsSummaryOfflineAware(): Promise<OfflineAdminResult<SecurityLogsSummary>>` — 60s
  - `fetchAnomaliesOfflineAware(params?): Promise<OfflineAdminResult<AnomalyAggregateResponse>>` — 60s
  - `fetchBreachesOfflineAware(): Promise<OfflineAdminResult<Breach[]>>` — 60s
  - `fetchAdminConfigOfflineAware(): Promise<OfflineAdminResult<SystemConfigEntry[]>>` — 30min
  - `fetchRateLimitsOfflineAware(): Promise<OfflineAdminResult<RateLimitConfig>>` — 30min

- [ ] **Step 1: Write failing test (extend describe.each matrix)**

Extend `offlineAdmin.test.ts` with 6 new `describe.each` rows × 5 cases, mirroring the existing 5-wrapper matrix. Import `fetchBreaches` from `../breach` in the mock. `fetchAdminSecurityLogs` returns `{ items: [...], total: 1 }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/frontend && npx vitest run src/lib/api/__tests__/offlineAdmin.test.ts`
Expected: FAIL — new wrappers not exported.

- [ ] **Step 3: Implement the 6 wrappers**

In `src/frontend/src/lib/api/offlineAdmin.ts`, add imports for `fetchAdminSecurityLogs`, `fetchSecurityLogsSummary`, `fetchAnomalies` from `./legacy`; `fetchBreaches` from `./breach`; types. Add 6 wrappers using `offlineAware(cacheKey, args, 'admin', TTL, () => legacyFn(...), OFFLINE_ADMIN_ERROR)`. TTLs: 60_000 for security logs/summary/anomalies/breaches; `30 * 60 * 1000` for config/rate-limits. Re-export via `lib/api/admin.ts` + `index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/frontend && npx vitest run src/lib/api/__tests__/offlineAdmin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/lib/api/offlineAdmin.ts src/frontend/src/lib/api/__tests__/offlineAdmin.test.ts src/frontend/src/lib/api/admin.ts src/frontend/src/lib/api/index.ts
git commit -m "feat(offlineAdmin): security logs, summary, anomalies, breaches, config, rate-limits wrappers"
```

---

### Task 6: Validator map/audit wrappers (offlineValidator.ts)

**Files:**
- Modify: `src/frontend/src/lib/api/offlineValidator.ts`
- Test: `src/frontend/src/lib/__tests__/offlineValidator.test.ts` (extend)

**Interfaces:**
- Consumes: `offlineAware` (Task 1), `fetchOperationalMap`/`fetchValidatorAuditLogs` (Task 3).
- Produces (encrypted, prefix `validator`, 60s):
  - `fetchOperationalMapOfflineAware(params): Promise<OfflineValidatorResult<MapClusterItem[]>>`
  - `fetchValidatorAuditLogsOfflineAware(params): Promise<OfflineValidatorResult<AuditResponse>>`

- [ ] **Step 1: Write failing test (extend matrix)**

Extend `offlineValidator.test.ts` with 2 new `describe.each` rows × 5 cases. Mock `../validator` `fetchOperationalMap`/`fetchValidatorAuditLogs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/frontend && npx vitest run src/lib/__tests__/offlineValidator.test.ts`
Expected: FAIL — wrappers not exported.

- [ ] **Step 3: Implement the 2 wrappers**

In `src/frontend/src/lib/api/offlineValidator.ts`, import the 2 new API fns + types from `./validator`; add wrappers via `offlineAware(cacheKey, [params], 'validator', 60_000, () => fn(params), OFFLINE_VALIDATOR_ERROR)`. Re-export from `index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/frontend && npx vitest run src/lib/__tests__/offlineValidator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/lib/api/offlineValidator.ts src/frontend/src/lib/__tests__/offlineValidator.test.ts src/frontend/src/lib/api/index.ts
git commit -m "feat(offlineValidator): operational map + audit logs wrappers"
```

---

### Task 7: Analyst wildland wrapper (offlineAnalytics.ts)

**Files:**
- Modify: `src/frontend/src/lib/api/offlineAnalytics.ts`
- Test: `src/frontend/src/lib/__tests__/offlineAnalytics.test.ts` (extend)

**Interfaces:**
- Consumes: `offlineAware`, `legacy.fetchAnalystIncidentWildlandDetail`.
- Produces: `fetchAnalystIncidentWildlandDetailOfflineAware(incidentId: number): Promise<OfflineAnalyticsResult<AnalystIncidentWildlandDetail>>` — encrypted, prefix `analytics`, 30min.

- [ ] **Step 1: Write failing test (extend matrix)**

Extend `offlineAnalytics.test.ts` with 1 new `describe.each` row × 5 cases. Mock `fetchAnalystIncidentWildlandDetail`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/frontend && npx vitest run src/lib/__tests__/offlineAnalytics.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the wrapper**

In `offlineAnalytics.ts`, import `fetchAnalystIncidentWildlandDetail` + its return type from `./legacy`; add `fetchAnalystIncidentWildlandDetailOfflineAware(incidentId)` via `offlineAware('analyst-wildland-detail', [incidentId], 'analytics', ANALYTICS_CACHE_TTL_MS, () => legacyFn(incidentId), OFFLINE_ANALYTICS_ERROR)`. Re-export from `index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/frontend && npx vitest run src/lib/__tests__/offlineAnalytics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/lib/api/offlineAnalytics.ts src/frontend/src/lib/__tests__/offlineAnalytics.test.ts src/frontend/src/lib/api/index.ts
git commit -m "feat(offlineAnalytics): analyst wildland detail wrapper"
```

---

### Task 8: StaleCacheBanner component (no deps — start in Wave 0)

**Files:**
- Create: `src/frontend/src/components/ui/StaleCacheBanner.tsx`
- Test: `src/frontend/src/components/ui/__tests__/StaleCacheBanner.test.tsx`

**Interfaces:**
- Consumes: `StickyBanner` from `./StickyBanner`.
- Produces: `StaleCacheBanner({ freshness?: { cachedAt?: number; isOnline: boolean }; message?: string })` — renders nothing when `freshness?.cachedAt == null`; else renders `StickyBanner` tone `amber` with default `Showing cached data — reconnect to refresh.` + ` from HH:MM:SS` suffix when `cachedAt` present.

- [ ] **Step 1: Read StickyBanner to match its props API**

Read `src/frontend/src/components/ui/StickyBanner.tsx` for exact prop names (tone, children, className).

- [ ] **Step 2: Write failing test**

Create `src/frontend/src/components/ui/__tests__/StaleCacheBanner.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StaleCacheBanner } from '../StaleCacheBanner';

describe('StaleCacheBanner', () => {
  it('renders nothing when cachedAt is null', () => {
    const { container } = render(<StaleCacheBanner freshness={{ cachedAt: undefined, isOnline: false }} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('renders amber banner with cached time when cachedAt present', () => {
    render(<StaleCacheBanner freshness={{ cachedAt: 1_700_000_000_000, isOnline: false }} />);
    expect(screen.getByText(/Showing cached data/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src/frontend && npx vitest run src/components/ui/__tests__/StaleCacheBanner.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement StaleCacheBanner**

```tsx
import { StickyBanner } from './StickyBanner';

export function StaleCacheBanner({ freshness, message }: { freshness?: { cachedAt?: number; isOnline: boolean }; message?: string }) {
  if (freshness?.cachedAt == null) return null;
  const time = new Date(freshness.cachedAt).toLocaleTimeString();
  return <StickyBanner tone="amber">{(message ?? 'Showing cached data — reconnect to refresh.') + ` from ${time}`}</StickyBanner>;
}
```
(Adjust `StickyBanner` props to match step 1's real API.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src/frontend && npx vitest run src/components/ui/__tests__/StaleCacheBanner.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/components/ui/StaleCacheBanner.tsx src/frontend/src/components/ui/__tests__/StaleCacheBanner.test.tsx
git commit -m "feat(ui): StaleCacheBanner shared component"
```

---

### Task 9: SW canonical-path collapse + role prefetch (no deps — start in Wave 0)

**Files:**
- Modify: `src/frontend/public/sw.js`
- Test: `src/frontend/__tests__/sw-cache-key.test.ts` (extend), `src/frontend/src/lib/__tests__/swRolePrefetch.test.ts` (create)

**Interfaces:**
- Consumes: existing `canonicalPath`, `urlsToCache`, navigate handler, `CACHE_NAME`.
- Produces: `CACHE_NAME = 'wims-bfp-cache-v12'`; `ANALYST_DETAIL_SHELL`, `WILDLAND_SHELL`, `WORKFLOW_SHELL` constants in `urlsToCache`; extended `canonicalPath()`; `PREFETCH_ROLE` `message` handler.

- [ ] **Step 1: Write failing test — canonical collapse + cache name**

Extend `__tests__/sw-cache-key.test.ts`: add `offlineNavigationFallbackKeys` cases for `/dashboard/analyst/incidents/5`, `/dashboard/analyst/incidents/5/wildland`, `/dashboard/analyst/heatmap` returning the respective shell before the dashboard; add a replicated `canonicalPath` helper covering the 3 new families; assert `CACHE_NAME === 'wims-bfp-cache-v12'`; assert the 3 shells are in a replicated `urlsToCache`; assert the 7 admin/validator routes are NOT in the list.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/frontend && npx vitest run __tests__/sw-cache-key.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement sw.js changes — cache bump + shells + canonicalPath**

In `src/frontend/public/sw.js`:
- `const CACHE_NAME = 'wims-bfp-cache-v12';`
- Add `const ANALYST_DETAIL_SHELL = '/dashboard/analyst/incidents/1';`, `const WILDLAND_SHELL = '/dashboard/analyst/incidents/1/wildland';`, `const WORKFLOW_SHELL = '/dashboard/analyst/comparative';`.
- Push the 3 shells into `urlsToCache` (do NOT add admin/validator routes).
- Extend `canonicalPath(pathname)` (mirror the existing regional regex): collapse the 3 analyst families to `__detail__`, `__detail__/wildland`, `__workflow__` (validate workflow slug against the 6 valid slugs before collapsing).
- Update the navigate handler fallback to try the 3 new shells when `canonicalPath` indicates an analyst detail/wildland/workflow URL.

- [ ] **Step 4: Run cache-key test to verify it passes**

Run: `cd src/frontend && npx vitest run __tests__/sw-cache-key.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing test — role prefetch handler**

Create `src/frontend/src/lib/__tests__/swRolePrefetch.test.ts` — replicate the SW's `PREFETCH_ROLE` route map as a function under test; assert each role maps to its expected route set, that already-cached routes are skipped, and a failed fetch does not reject (use `Promise.allSettled` semantics).

- [ ] **Step 6: Run test to verify it fails**

Run: `cd src/frontend && npx vitest run src/lib/__tests__/swRolePrefetch.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement PREFETCH_ROLE handler in sw.js**

Add a `message` listener: on `{ type: 'PREFETCH_ROLE', role }`, open `CACHE_NAME`, for each route in the role's set, `cache.match` first (skip if present), else `fetch` + `cache.put` (best-effort via `Promise.allSettled`). Role route sets:
- `SYSTEM_ADMIN` → the 5 admin routes + `/admin/system`.
- `NATIONAL_ANALYST` → `/dashboard/analyst` + 6 workflow slugs + the 2 shells.
- `NATIONAL_VALIDATOR` → `/dashboard/validator`, `/dashboard/validator/map`, `/dashboard/validator/audit`.
- `REGIONAL_ENCODER` → `/dashboard/regional`.

- [ ] **Step 8: Run prefetch test to verify it passes**

Run: `cd src/frontend && npx vitest run src/lib/__tests__/swRolePrefetch.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/frontend/public/sw.js src/frontend/__tests__/sw-cache-key.test.ts src/frontend/src/lib/__tests__/swRolePrefetch.test.ts
git commit -m "feat(sw): cache v12, analyst canonical collapse, post-login role prefetch"
```

---

### Task 10: Eviction wiring (boot + sync + every-N-writes + user-switch)

**Files:**
- Modify: `src/frontend/src/lib/offlineStore.ts` (counter + boot helper), `src/frontend/src/lib/api/offlineBase.ts` (increment on write), `src/frontend/src/components/LayoutShell.tsx` (boot trigger), sync-completion listener (locate existing).

**Interfaces:**
- Consumes: `evictExpiredReadCache`/`evictExpiredReferenceData`/`clearReferenceDataForUser` (Task 1).
- Produces: a `maybePruneCaches()` helper that checks the `wims:cachePruneAt` (1h) + `wims:cacheWriteCount` (every 25) guards and runs both evictions; `incrementCacheWriteCount()` called inside `cacheReadResponse`/`cacheReferenceData`.

- [ ] **Step 1: Write failing test**

Extend `offlineStore.reference.test.ts` or a new `offlineStore.eviction.test.ts`: stub `localStorage`, write 25 records, assert `evictExpiredReadCache` invoked once (spy); assert boot guard skips a second prune within 1h.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/frontend && npx vitest run src/lib/__tests__/offlineStore.eviction.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the guards + wiring**

- In `offlineStore.ts`: add `incrementCacheWriteCount()` (reads `wims:cacheWriteCount`, ++, on hitting 25 resets to 0 and calls `evictExpiredReadCache()` + `evictExpiredReferenceData()` best-effort). Call it at the end of `cacheReadResponse` + `cacheReferenceData`.
- Add `maybePruneCaches()` (exported): reads `wims:cachePruneAt`; if `now - last > 3_600_000`, run both evictions + set `wims:cachePruneAt = now`.
- In `LayoutShell.tsx` (or the app root): call `maybePruneCaches()` once on mount.
- In the existing sync-completion listener (locate via `rg "sync-complete|wims:sync-complete" src/frontend/src`): call `maybePruneCaches()` after a successful sync batch.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/frontend && npx vitest run src/lib/__tests__/offlineStore.eviction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/lib/offlineStore.ts src/frontend/src/lib/api/offlineBase.ts src/frontend/src/components/LayoutShell.tsx src/frontend/src/lib/__tests__/offlineStore.eviction.test.ts
git commit -m "feat(offline): cache eviction wiring (boot 1h, sync, every-25-writes, user-switch)"
```

---

### Task 11: Page rewires — admin 5 pages (parallel-safe)

**Files:**
- Modify: `src/frontend/src/app/admin/monitoring/page.tsx`, `app/admin/anomalies/page.tsx`, `app/admin/breach/page.tsx`, `app/admin/system/config/page.tsx`, `app/admin/system/rate-limits/page.tsx` + their existing test files.
- Consumes: Task 5 wrappers, Task 8 `StaleCacheBanner`, `useNetworkStatus` (NOT `useAutoSync`).

For each page: swap the read import → offline-aware wrapper; mount `useNetworkStatus()`; render `<StaleCacheBanner freshness={{ cachedAt, isOnline }} />` from the wrapper result's `fromCache`/`cachedAt`; add an offline badge in the header; on cache-miss error render a friendly "unavailable offline" state instead of crashing. Writes unchanged (online). Update existing tests to mock the new wrappers + `useNetworkStatus` online (operations-board pattern); add 1 offline-render test per page.

- [ ] **Step 1: TDD each page — write failing offline-render test, run fail, implement rewire, run pass, commit (one commit per page)**

```bash
git commit -m "feat(admin/monitoring): offline-aware read cache + stale banner"
# repeat per page
```

---

### Task 12: Page rewires — validator map + audit (parallel-safe)

**Files:**
- Modify: `src/frontend/src/app/dashboard/validator/map/page.tsx`, `app/dashboard/validator/audit/page.tsx` (+ tests if present, else create minimal ones).
- Consumes: Task 6 wrappers, Task 8 banner, `useNetworkStatus`.

Same pattern as Task 11. Replace raw `apiFetch` calls with the Task 6 wrappers.

- [ ] **Step 1: TDD each page — failing test, fail, implement, pass, commit per page**

```bash
git commit -m "feat(validator/map): offline-aware operational map"
git commit -m "feat(validator/audit): offline-aware audit logs"
```

---

### Task 13: Page rewire — analyst wildland (new test file) + swap pages

**Files:**
- Modify: `src/frontend/src/app/dashboard/analyst/incidents/[id]/wildland/page.tsx` (full rewire) + create `wildland.test.tsx`.
- Modify: `app/dashboard/analyst/page.tsx`, `app/dashboard/analyst/[workflow]/page.tsx`, `app/dashboard/page.tsx`, `app/admin/system/page.tsx` (ref/config swaps only).
- Consumes: Task 7 wildland wrapper, Task 4 ref wrappers, `useAuth()` for `userId`, `useNetworkStatus` (wildland only).

For the 4 swap pages: replace `fetchRegions` (and provinces/cities where present) with `fetchRegionsOfflineAware(user.id)` etc.; pass `user.id` from `useAuth()`. Wildland page: full rewire (wrapper + `useNetworkStatus` + banner + cache-miss state) + new test file (online happy-path, offline cached-render, cache-miss state). Update `dashboard/page.test.tsx` + `admin/system` test mocks to add `fetchRegionsOfflineAware` (+ provinces/cities) mocks.

- [ ] **Step 1: TDD wildland page — create failing test, fail, rewire, pass, commit**

```bash
git commit -m "feat(analyst/wildland): offline-aware detail + new page tests"
```

- [ ] **Step 2: TDD each swap page — failing test, fail, swap imports, pass, commit per page**

```bash
git commit -m "feat(dashboard): offline-aware reference reads (regions/provinces/cities)"
git commit -m "feat(analyst): offline-aware regions read"
git commit -m "feat(admin/system): offline-aware regions read"
```

---

### Task 14: Post-login role prefetch wiring

**Files:**
- Modify: `src/frontend/src/context/AuthContext.tsx` (or the post-login redirect site).
- Consumes: Task 9 SW `PREFETCH_ROLE` handler.

After a successful login + user role is known, `navigator.serviceWorker.controller?.postMessage({ type: 'PREFETCH_ROLE', role })` (guard for `controller` null + SW unsupported). Add a test asserting the message is posted on login (mock `navigator.serviceWorker`).

- [ ] **Step 1: TDD — failing test, fail, wire postMessage, pass, commit**

```bash
git commit -m "feat(auth): post-login role prefetch message to service worker"
```

---

### Task 15: Wiki + CI pre-flight

**Files:**
- Modify: `system-wiki/architecture/pwa-tests-cicd.md`, `system-wiki/log.md`, (review `system-wiki/gaps/frs-codebase-gap-register.md`).

- [ ] **Step 1: Update pwa-tests-cicd.md**

Add: new wrapper inventory (admin×6, validator×2, analyst×1, reference×3), storage refactor (generic methods + `REFERENCE_STORE` unencrypted per-user + per-record `ttlMs` + eviction), `StaleCacheBanner`, SW runtime-vs-precache + role prefetch policy, `useAutoSync`-only-where-writes rule.

- [ ] **Step 2: Append log.md entry**

One entry: date, change summary (offline read-cache completion across all roles + storage/SW/eviction fixes), commit refs.

- [ ] **Step 3: Review gap register**

Add/close FRS M2 offline-first gaps if the change affects them.

- [ ] **Step 4: Run full CI pre-flight**

```bash
cd src/frontend
NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth NEXT_PUBLIC_BASE_URL=http://localhost:3000 npm run lint
NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth NEXT_PUBLIC_BASE_URL=http://localhost:3000 npm run build
npx vitest run
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add system-wiki/architecture/pwa-tests-cicd.md system-wiki/log.md system-wiki/gaps/frs-codebase-gap-register.md
git commit -m "docs(wiki): offline cache every-role completion + storage/SW/eviction updates"
```

---

## Self-Review

**1. Spec coverage:**
- Storage rename (directive 1) → Task 1. ✅
- Unencrypted ref store + per-user (directive 2 + P1) → Task 1 (store) + Task 2 (orchestrator) + Task 4 (wrappers). ✅
- API abstraction first (directive 3) → Task 3. ✅
- SW runtime + role prefetch (directive 4 + P2) → Task 9 + Task 14. ✅
- Drop useAutoSync (directive 5) → Global Constraint + Tasks 11–13 (no autosync added). ✅
- Eviction (directive 6 + P3 + P4) → Task 1 (fns) + Task 10 (wiring). ✅
- P5 staleness note → spec risk note only (no task needed; documented). ✅
- 12 wrappers → Tasks 4, 5, 6, 7. ✅
- 12 page rewires → Tasks 11, 12, 13. ✅
- StaleCacheBanner → Task 8. ✅
- Wiki + CI → Task 15. ✅

**2. Placeholder scan:** No TBD/TODO. Task 3 step 1 + Task 8 step 1 say "read the file to extract exact keys/props" — these are unavoidable reads (the exact `URLSearchParams` keys + `StickyBanner` prop API must be copied verbatim from source; hardcoding them now risks drift). All other steps contain concrete code.

**3. Type consistency:** `OfflineResult<T>` (Task 1/2) used by Tasks 4–7. `CachedResponse<T>` (Task 1) consistent. `OfflineAdminResult`/`OfflineAnalyticsResult`/`OfflineValidatorResult`/`OfflineReferenceResult` all = `OfflineResult<T>` aliases (matches existing pattern). `cacheReadResponse(key, data, ttlMs, cachedAt?)` signature consistent across Tasks 1, 2, 10. `offlineAwareReference(..., userId, ...)` consistent across Tasks 2, 4.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-offline-cache-every-role.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Parallel waves (0, 2, 3, 4) can fan out to concurrent subagents.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
