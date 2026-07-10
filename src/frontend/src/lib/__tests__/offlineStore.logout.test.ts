/**
 * Logout wipe — issue #2.
 *
 * `clearAllCachedIncidents` is called from AuthContext.logout for
 * shared-device privacy. The function's name promises "all" but the
 * original implementation only cleared CACHE_STORE (legacy Phase 1D),
 * leaving the encrypted READ_CACHE_STORE and the plaintext REFERENCE_STORE
 * on disk for the next user.
 *
 * These tests pin the contract: after `clearAllCachedIncidents`,
 *   - CACHE_STORE is empty
 *   - READ_CACHE_STORE is empty
 *   - REFERENCE_STORE is empty
 *   - offlineOps (OPS_STORE) is preserved (encrypted, encoder-scoped, must
 *     survive logout so unsynced work resumes on re-login)
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';

if (!globalThis.crypto) {
  (globalThis as Record<string, unknown>).crypto = webcrypto;
}

const DB_NAME = 'wims-bfp-db';
const DB_VERSION = 7;
const CACHE_STORE = 'cachedIncidents';
const READ_CACHE_STORE = 'analytics-cache';
const REFERENCE_STORE = 'reference-cache';
const OPS_STORE = 'offlineOps';

beforeEach(() => {
  globalThis.indexedDB = new (IDBFactory as unknown as new () => IDBFactory)();
  localStorage.clear();
});

const {
  clearAllCachedIncidents,
  cacheReferenceData,
  cacheReadResponse,
  saveDraftOp,
  setActiveOfflineUser,
  clearAllOfflineData,
} = await import('../offlineStore');

async function readAllKeys(storeName: string): Promise<unknown[]> {
  const db = await openDB(DB_NAME, DB_VERSION);
  try {
    return await db.getAllKeys(storeName);
  } finally {
    db.close();
  }
}

describe('clearAllCachedIncidents (logout wipe)', () => {
  it('clears CACHE_STORE (legacy Phase 1D)', async () => {
    // Initialise the schema via any offlineStore call (it creates all stores
    // in the upgrade callback), then seed CACHE_STORE.
    await cacheReferenceData('reference:warmup:0', [], 1000);
    const db = await openDB(DB_NAME, DB_VERSION);
    try {
      await db.put(CACHE_STORE, { serverId: 1, blob: { iv: [], data: [] } });
    } finally {
      db.close();
    }
    expect(await readAllKeys(CACHE_STORE)).toHaveLength(1);
    await clearAllCachedIncidents();
    expect(await readAllKeys(CACHE_STORE)).toEqual([]);
  });

  it('clears READ_CACHE_STORE (encrypted analytics / read cache)', async () => {
    await cacheReadResponse('admin:system-health:[]', { ok: true }, 60_000);
    expect(await readAllKeys(READ_CACHE_STORE)).toHaveLength(1);
    await clearAllCachedIncidents();
    expect(await readAllKeys(READ_CACHE_STORE)).toEqual([]);
  });

  it('clears REFERENCE_STORE (plaintext reference cache — issue #2 primary fix)', async () => {
    await cacheReferenceData('reference:userA:regions', [{ region_id: 1 }], 7 * 24 * 60 * 60 * 1000);
    expect(await readAllKeys(REFERENCE_STORE)).toHaveLength(1);
    await clearAllCachedIncidents();
    expect(await readAllKeys(REFERENCE_STORE)).toEqual([]);
  });

  it('preserves OPS_STORE (offlineOps) so unsynced work survives logout', async () => {
    await saveDraftOp('local-uuid-1', 'encoder-1', 1, { description: 'must survive logout' });
    const before = (await readAllKeys(OPS_STORE)).length;
    expect(before).toBeGreaterThan(0);
    await clearAllCachedIncidents();
    const after = (await readAllKeys(OPS_STORE)).length;
    expect(after).toBe(before);
  });
});

describe('offlineModeFlags clearing (Item 1)', () => {
  const OFFLINE_ENABLED_KEY = 'wims:offline_enabled';
  const OFFLINE_BANNER_DISMISSED_KEY = 'wims:offline_banner_dismissed';

  function seedFlags(): void {
    localStorage.setItem(OFFLINE_ENABLED_KEY, 'true');
    localStorage.setItem(OFFLINE_BANNER_DISMISSED_KEY, 'true');
  }

  function expectFlagsCleared(): void {
    expect(localStorage.getItem(OFFLINE_ENABLED_KEY)).toBeNull();
    expect(localStorage.getItem(OFFLINE_BANNER_DISMISSED_KEY)).toBeNull();
  }

  function expectFlagsSeeded(): void {
    expect(localStorage.getItem(OFFLINE_ENABLED_KEY)).toBe('true');
    expect(localStorage.getItem(OFFLINE_BANNER_DISMISSED_KEY)).toBe('true');
  }

  it('clears flags on different-user switch', async () => {
    seedFlags();
    await setActiveOfflineUser('user-A');
    expectFlagsSeeded(); // same-user first-call preserves flags
    await setActiveOfflineUser('user-B');
    expectFlagsCleared();
  });

  it('preserves flags on same-user relogin', async () => {
    seedFlags();
    await setActiveOfflineUser('user-A');
    expectFlagsSeeded();
    await setActiveOfflineUser('user-A');
    expectFlagsSeeded(); // same user again — flags survive
  });

  it('clears flags via clearAllOfflineData', async () => {
    seedFlags();
    await setActiveOfflineUser('user-A');
    expectFlagsSeeded();
    await clearAllOfflineData();
    expectFlagsCleared();
  });
});
