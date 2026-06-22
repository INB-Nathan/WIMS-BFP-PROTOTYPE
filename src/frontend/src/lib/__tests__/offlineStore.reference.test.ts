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

  it('clearReferenceDataForUser does NOT match a longer userId with the same prefix (issue #11)', async () => {
    // Switching from userId "abc" to "abcd" must not delete reference:abcd:*
    // (and vice-versa) — the regex was matching the literal prefix without
    // requiring the trailing colon, so ^reference:abc: also matched
    // ^reference:abcd:. The fix requires a `:` immediately after the userId.
    await cacheReferenceData('reference:abc:regions', [1], 7 * 24 * 60 * 60 * 1000);
    await cacheReferenceData('reference:abcd:regions', [2], 7 * 24 * 60 * 60 * 1000);
    const deleted = await clearReferenceDataForUser('abc');
    expect(deleted).toBe(1);
    expect(await getCachedReferenceData('reference:abc:regions')).toBeUndefined();
    // abcd's data must NOT have been deleted.
    expect(await getCachedReferenceData('reference:abcd:regions')).toBeDefined();
  });

  it('cacheReferenceData rejects non-canonical keys in development (issue #10)', async () => {
    // The reference store is plaintext and shared across users on the same
    // device (per-user isolation relies entirely on the key prefix). A
    // future caller that accidentally caches a non-public payload via this
    // function would silently break the threat model. The runtime guard
    // throws in non-production builds to fail loud.
    const origEnv = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'development';
    try {
      await expect(
        cacheReferenceData('admin:system-health:[]', { ok: true }, 60_000),
      ).rejects.toThrow(/reference:/);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = origEnv;
    }
  });

  it('evictExpiredInStore(REFERENCE_STORE) deletes only expired reference records (issue #12)', async () => {
    const longTtl = 7 * 24 * 60 * 60 * 1000;
    const shortTtl = 60_000;
    const now = Date.now();
    // Two records in REFERENCE_STORE (plaintext), one expired, one fresh.
    await cacheReferenceData('reference:userA:regions', [1], longTtl, now - 100);
    await cacheReferenceData('reference:userA:provinces:1', [2], shortTtl, now - 70_000);
    // Also seed a record in the encrypted read cache so we can verify the
    // helper only touches the store it's given.
    const { cacheReadResponse } = await import('../offlineStore');
    await cacheReadResponse('admin:warmup:[]', { ok: true }, 60_000);
    const { evictExpiredInStore } = await import('../offlineStore');
    const deleted = await evictExpiredInStore('reference-cache');
    expect(deleted).toBe(1);
    expect(await getCachedReferenceData('reference:userA:regions')).toBeDefined();
    expect(await getCachedReferenceData('reference:userA:provinces:1')).toBeUndefined();
    // The encrypted read cache must not have been touched.
    const { getReadCachedResponse } = await import('../offlineStore');
    expect(await getReadCachedResponse('admin:warmup:[]')).toBeDefined();
  });

  it('devWarn is the shared helper for NODE_ENV !== "production" warns (issue #15)', async () => {
    const { devWarn } = await import('../offlineStore');
    const origEnv = process.env.NODE_ENV;
    const origWarn = console.warn;
    const captured: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      captured.push(args);
    };
    try {
      (process.env as Record<string, string>).NODE_ENV = 'development';
      devWarn('test message', { detail: 'x' });
      expect(captured.length).toBe(1);
      expect(captured[0]![0]).toBe('test message');
      expect(captured[0]![1]).toEqual({ detail: 'x' });

      // In production, devWarn is a no-op.
      captured.length = 0;
      (process.env as Record<string, string>).NODE_ENV = 'production';
      devWarn('test message', { detail: 'x' });
      expect(captured.length).toBe(0);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = origEnv;
      console.warn = origWarn;
    }
  });

  // Issue #13 (security D1): the isolation test was positive-only. Verify
  // the user-switch path actually wipes the prior user's prefix via
  // clearReferenceDataForUser.
  it('user-switch via setActiveOfflineUser wipes the prior user prefix (issue #13)', async () => {
    const { setActiveOfflineUser, clearReferenceDataForUser } = await import('../offlineStore');
    // Seed two users' reference data.
    await cacheReferenceData('reference:userA:regions', [{ region_id: 1 }], 7 * 24 * 60 * 60 * 1000);
    await cacheReferenceData('reference:userA:provinces:1', [{ province_id: 11 }], 7 * 24 * 60 * 60 * 1000);
    await cacheReferenceData('reference:userB:regions', [{ region_id: 2 }], 7 * 24 * 60 * 60 * 1000);
    // Switch from userA to userB. This must wipe userA's plaintext prefix.
    await setActiveOfflineUser('userA');
    await setActiveOfflineUser('userB');
    // userA's data must be gone; userB's data preserved.
    expect(await getCachedReferenceData('reference:userA:regions')).toBeUndefined();
    expect(await getCachedReferenceData('reference:userA:provinces:1')).toBeUndefined();
    expect(await getCachedReferenceData('reference:userB:regions')).toBeDefined();
    // And the explicit clearReferenceDataForUser call also still works.
    const deleted = await clearReferenceDataForUser('userB');
    expect(deleted).toBe(1);
    expect(await getCachedReferenceData('reference:userB:regions')).toBeUndefined();
  });

  // Issue #13 (security D1): the escapeRegex in clearReferenceDataForUser
  // is correct, but there is no regression test. Add one for a userId
  // containing regex meta-characters.
  it('clearReferenceDataForUser escapeRegex handles regex meta-characters (issue #13)', async () => {
    const { clearReferenceDataForUser } = await import('../offlineStore');
    // userId with regex meta-characters: .*+?^$()[]{}|\.
    // If escapeRegex is broken (e.g. forgets to escape '.'), this would
    // also match reference:userA:foo (and many other keys).
    await cacheReferenceData('reference:userA.*:regions', [1], 7 * 24 * 60 * 60 * 1000);
    await cacheReferenceData('reference:userAXX:regions', [2], 7 * 24 * 60 * 60 * 1000);
    const deleted = await clearReferenceDataForUser('userA.*');
    expect(deleted).toBe(1);
    expect(await getCachedReferenceData('reference:userA.*:regions')).toBeUndefined();
    // The unescaped match must NOT have deleted the userAXX entry.
    expect(await getCachedReferenceData('reference:userAXX:regions')).toBeDefined();
  });
});
