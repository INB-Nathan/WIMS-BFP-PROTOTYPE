/**
 * offlineStore reference (unencrypted) store — Task 1 / spec v3 storage refactor.
 *
 * Verifies the new REFERENCE_STORE (unencrypted, per-user namespaced) +
 * cacheReferenceData / getCachedReferenceData / evictExpiredReferenceData /
 * clearReferenceDataForUser API. Uses fake-indexeddb so real IDB transactions
 * (cursor iteration, db upgrade, object store creation) are exercised.
 */

import { beforeEach, describe, expect, it } from 'vitest';
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

const {
  cacheReferenceData,
  getCachedReferenceData,
  evictExpiredReferenceData,
  clearReferenceDataForUser,
} = await import('../offlineStore');

describe('offlineStore reference (unencrypted) store', () => {
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
    await cacheReferenceData('reference:userA:regions', [1], longTtl, now - 70_000);
    await cacheReferenceData('reference:userA:provinces:1', [2], shortTtl, now - 70_000);
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
