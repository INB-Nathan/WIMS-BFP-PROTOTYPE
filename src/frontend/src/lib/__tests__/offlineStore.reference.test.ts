/**
 * offlineStore reference store tests — Task 1
 *
 * Covers the unencrypted REFERENCE_STORE (DB v6):
 *   1. cacheReferenceData/getCachedReferenceData round-trip stores data plaintext
 *   2. Per-user isolation: different userId prefix → undefined
 *   3. evictExpiredReferenceData deletes only records past their own ttlMs
 *   4. clearReferenceDataForUser deletes only that userId's prefix
 *
 * Mirrors the fake-indexeddb pattern from offlineStore.test.ts (real
 * transactions, real upgrade callback, real cursor delete).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';
// 'fake-indexeddb/auto' populates the jsdom global scope with
// IDBRequest/IDBKeyRange/etc. that idb's openDB relies on. Importing the
// default factory is not sufficient.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';

if (!globalThis.crypto) {
  (globalThis as Record<string, unknown>).crypto = webcrypto;
}

// Fresh fake IDB factory per test — real DB upgrade callback runs.
beforeEach(() => {
  globalThis.indexedDB = new (IDBFactory as unknown as new () => IDBFactory)();
});

// Import AFTER beforeEach registration — the offlineStore module opens IDB
// lazily, so the fresh factory is active for each test.
const {
  cacheReferenceData,
  getCachedReferenceData,
  evictExpiredReferenceData,
  clearReferenceDataForUser,
} = await import('../offlineStore');

// Helper: assert a raw record is PLAINTEXT (no EncryptedPayload shape).
async function assertPlaintextPersisted(key: string) {
  const db = await openDB('wims-bfp-db', 6);
  try {
    const raw = (await db.get('reference-cache', key)) as
      | { key: string; data: unknown; cachedAt: number; ttlMs: number }
      | undefined;
    expect(raw).toBeDefined();
    expect(raw).not.toHaveProperty('encrypted'); // unencrypted
    if (raw && typeof raw.data === 'object' && raw.data !== null) {
      const candidate = raw.data as Record<string, unknown>;
      const looksEncrypted =
        Array.isArray(candidate.iv) &&
        Array.isArray(candidate.data) &&
        Object.keys(candidate).length === 2;
      expect(looksEncrypted).toBe(false);
    }
  } finally {
    db.close();
  }
}

describe('offlineStore reference (unencrypted) store', () => {
  it('round-trips plaintext data without an EncryptedPayload shape', async () => {
    const ttl = 7 * 24 * 60 * 60 * 1000;
    await cacheReferenceData('reference:userA:regions', [{ region_id: 1 }], ttl);

    const got = await getCachedReferenceData<{ region_id: number }[]>(
      'reference:userA:regions',
    );
    expect(got?.data).toEqual([{ region_id: 1 }]);
    expect(got?.ttlMs).toBe(ttl);
    expect(got?.cachedAt).toBeTypeOf('number');
    expect(got?.key).toBe('reference:userA:regions');

    await assertPlaintextPersisted('reference:userA:regions');
  });

  it('is per-user isolated: userB key does not return userA data', async () => {
    const ttl = 7 * 24 * 60 * 60 * 1000;
    await cacheReferenceData('reference:userA:regions', [{ region_id: 1 }], ttl);

    const got = await getCachedReferenceData('reference:userB:regions');
    expect(got).toBeUndefined();
  });

  it('evictExpiredReferenceData deletes only records past their own ttlMs', async () => {
    const longTtl = 7 * 24 * 60 * 60 * 1000;
    const shortTtl = 60_000; // 60s
    const now = Date.now();

    await cacheReferenceData(
      'reference:userA:regions',
      [1],
      longTtl,
      now - 70_000,
    );
    await cacheReferenceData(
      'reference:userA:provinces:1',
      [2],
      shortTtl,
      now - 70_000,
    );

    const deleted = await evictExpiredReferenceData();
    expect(deleted).toBe(1);
    expect(
      await getCachedReferenceData('reference:userA:regions'),
    ).toBeDefined();
    expect(
      await getCachedReferenceData('reference:userA:provinces:1'),
    ).toBeUndefined();
  });

  it('clearReferenceDataForUser deletes only that user prefix', async () => {
    const ttl = 7 * 24 * 60 * 60 * 1000;
    await cacheReferenceData('reference:userA:regions', [1], ttl);
    await cacheReferenceData('reference:userA:provinces:1', [2], ttl);
    await cacheReferenceData('reference:userB:regions', [3], ttl);

    const deleted = await clearReferenceDataForUser('userA');
    expect(deleted).toBe(2);
    expect(
      await getCachedReferenceData('reference:userA:regions'),
    ).toBeUndefined();
    expect(
      await getCachedReferenceData('reference:userA:provinces:1'),
    ).toBeUndefined();
    expect(
      await getCachedReferenceData('reference:userB:regions'),
    ).toBeDefined();
  });
});
