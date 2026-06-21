/**
 * offlineStore eviction wiring — Task 10.
 *
 * Verifies the boot/1h guard and every-25-writes counter triggers that
 * drive `maybePruneCaches()` and `incrementCacheWriteCount()`. Both helpers
 * are best-effort wrappers around the existing `evictExpiredReadCache()` /
 * `evictExpiredReferenceData()` functions (T1) — these tests focus on the
 * trigger logic, not the eviction algorithm itself.
 *
 * localStorage is stubbed via beforeEach/afterEach so the test never
 * depends on the host environment (jsdom or node).
 *
 * Note: vitest's `vi.spyOn` cannot intercept local ESM bindings — the
 * implementation calls `evictExpiredReadCache()` / `evictExpiredReferenceData()`
 * via their local module binding, not via the module namespace. So these
 * tests verify the observable contract (localStorage state + IDB contents)
 * rather than the internal function-call count.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

if (!globalThis.crypto) {
  (globalThis as Record<string, unknown>).crypto = webcrypto;
}

// Fresh fake IndexedDB per test so DB_VERSION upgrades run cleanly every time.
beforeEach(() => {
  globalThis.indexedDB = new (IDBFactory as unknown as new () => IDBFactory)();
});

// Stub localStorage so the test never reads/writes real host storage.
const lsStore = new Map<string, string>();
const localStorageStub = {
  getItem: (key: string): string | null => (lsStore.has(key) ? lsStore.get(key)! : null),
  setItem: (key: string, value: string): void => {
    lsStore.set(key, String(value));
  },
  removeItem: (key: string): void => {
    lsStore.delete(key);
  },
  clear: (): void => {
    lsStore.clear();
  },
  key: (i: number): string | null => Array.from(lsStore.keys())[i] ?? null,
  get length(): number {
    return lsStore.size;
  },
};

let originalLocalStorage: Storage | undefined;

beforeEach(() => {
  lsStore.clear();
  originalLocalStorage = (globalThis as Record<string, unknown>).localStorage as Storage | undefined;
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageStub,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  if (originalLocalStorage !== undefined) {
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });
  } else {
    // Remove property if there was none originally.
    try {
      delete (globalThis as Record<string, unknown>).localStorage;
    } catch {
      // ignore
    }
  }
});

const offlineStore = await import('../offlineStore');
const { incrementCacheWriteCount, maybePruneCaches, cacheReadResponse, getReadCachedResponse } = offlineStore;

/**
 * Populate the read cache with a record whose `cachedAt + ttlMs` is already in
 * the past, so the next eviction pass will delete it. Returns the cache key
 * for later verification.
 */
async function seedExpiredReadRecord(): Promise<string> {
  const key = 'admin:test:expired';
  // Insert a record with cachedAt 1h ago and ttlMs 1s — well past expiry.
  await cacheReadResponse(key, { items: [] }, 1_000, Date.now() - 60 * 60 * 1000);
  return key;
}

describe('offlineStore eviction wiring — incrementCacheWriteCount', () => {
  it('increments the counter and prunes at exactly 25 (eviction deletes expired records)', async () => {
    const key = await seedExpiredReadRecord();
    // Sanity check: record is present before the prune.
    expect(await getReadCachedResponse(key)).toBeDefined();

    // First 24 calls should NOT trigger a prune. The counter is tracked via
    // localStorage; after 24 calls it should be 24, not 0.
    for (let i = 0; i < 24; i++) {
      await incrementCacheWriteCount();
    }
    expect(localStorage.getItem('wims:cacheWriteCount')).toBe('24');
    // Record still present — no prune has happened yet.
    expect(await getReadCachedResponse(key)).toBeDefined();

    // 25th call: prune both stores. The expired record must be deleted.
    await incrementCacheWriteCount();
    expect(localStorage.getItem('wims:cacheWriteCount')).toBe('0');
    expect(await getReadCachedResponse(key)).toBeUndefined();
  });

  it('resets the counter to 0 after a prune and does not double-fire', async () => {
    // Drive 25 writes — counter should be 0 after, then 24 writes should not prune.
    for (let i = 0; i < 25; i++) {
      await incrementCacheWriteCount();
    }
    expect(localStorage.getItem('wims:cacheWriteCount')).toBe('0');

    // Next 24 should not prune again — counter only resets to 0.
    for (let i = 0; i < 24; i++) {
      await incrementCacheWriteCount();
    }
    expect(localStorage.getItem('wims:cacheWriteCount')).toBe('24');

    // 25th write in this second batch — should fire prune again.
    const key = await seedExpiredReadRecord();
    expect(await getReadCachedResponse(key)).toBeDefined();
    await incrementCacheWriteCount();
    expect(localStorage.getItem('wims:cacheWriteCount')).toBe('0');
    expect(await getReadCachedResponse(key)).toBeUndefined();
  });
});

describe('offlineStore eviction wiring — maybePruneCaches (boot guard)', () => {
  it('skips when last prune was less than 1h ago', async () => {
    const key = await seedExpiredReadRecord();

    // Set the last-prune timestamp to 5 minutes ago — well within the 1h window.
    localStorage.setItem('wims:cachePruneAt', String(Date.now() - 5 * 60 * 1000));

    await maybePruneCaches();
    // The timestamp should NOT be updated (skipped).
    const stored = Number(localStorage.getItem('wims:cachePruneAt'));
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    // Allow a few ms of test-runtime drift, but the stored value should still
    // reflect the pre-call timestamp (within 1s).
    expect(Math.abs(stored - fiveMinAgo)).toBeLessThan(1_000);
    // The expired record is still present — no prune ran.
    expect(await getReadCachedResponse(key)).toBeDefined();
  });

  it('prunes when last prune was more than 1h ago and stamps the new timestamp', async () => {
    const key = await seedExpiredReadRecord();

    // Set the last-prune timestamp to 2h ago.
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    localStorage.setItem('wims:cachePruneAt', String(twoHoursAgo));

    await maybePruneCaches();
    // The expired record should be deleted.
    expect(await getReadCachedResponse(key)).toBeUndefined();

    // The new last-prune timestamp should be very recent.
    const stored = Number(localStorage.getItem('wims:cachePruneAt'));
    expect(stored).toBeGreaterThan(Date.now() - 5_000);
  });

  it('prunes when no last-prune timestamp exists (first boot)', async () => {
    const key = await seedExpiredReadRecord();

    // No wims:cachePruneAt in storage — first boot in this device's lifetime.
    expect(localStorage.getItem('wims:cachePruneAt')).toBeNull();

    await maybePruneCaches();
    expect(await getReadCachedResponse(key)).toBeUndefined();

    // A timestamp should now be set.
    const stored = Number(localStorage.getItem('wims:cachePruneAt'));
    expect(stored).toBeGreaterThan(Date.now() - 5_000);
  });
});

describe('offlineStore eviction wiring — best-effort catch', () => {
  it('incrementCacheWriteCount is best-effort: never throws on counter errors', async () => {
    // Replace localStorage with a broken stub that throws on getItem/setItem.
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => { throw new Error('localStorage broken'); },
        setItem: () => { throw new Error('localStorage broken'); },
        removeItem: () => { throw new Error('localStorage broken'); },
        clear: () => { throw new Error('localStorage broken'); },
        key: () => null,
        length: 0,
      },
      writable: true,
      configurable: true,
    });

    // 25 calls must NOT throw despite localStorage being broken.
    for (let i = 0; i < 25; i++) {
      await expect(incrementCacheWriteCount()).resolves.toBeUndefined();
    }
  });

  it('maybePruneCaches is best-effort: never throws on counter errors', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => { throw new Error('localStorage broken'); },
        setItem: () => { throw new Error('localStorage broken'); },
        removeItem: () => { throw new Error('localStorage broken'); },
        clear: () => { throw new Error('localStorage broken'); },
        key: () => null,
        length: 0,
      },
      writable: true,
      configurable: true,
    });

    // No prior prune — call must NOT throw despite localStorage being broken.
    await expect(maybePruneCaches()).resolves.toBeUndefined();
  });
});
