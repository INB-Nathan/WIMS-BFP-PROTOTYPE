/**
 * Tests for the newer offlineOps store functions added for offline-first stability:
 * - recoverStaleSyncingOps: resets stale 'syncing' ops back to 'pending' on mount
 * - updateOfflineOp: updates payload only (preserves createdAt)
 * - getOfflineOp: returns decrypted op by localId
 * - deleteOfflineOpCascade: removes a create op plus linked follow-up ops
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
  (globalThis as Record<string, unknown>).crypto = webcrypto;
}

// ─── Minimal idb mock for offlineOps store ───────────────────────────────────

type StoredOp = {
  localId: string;
  syncStatus: string;
  encoderId: string;
  lastAttemptAt: number | null;
  createdAt: number;
  payload: { iv: number[]; data: number[] };
  [key: string]: unknown;
};

// Per-test mutable state
const opsStore = new Map<string, StoredOp>();
const keyStore = new Map<string, CryptoKey>();
const cacheStore = new Map<number, unknown>();

function makeOpsDbMock() {
  return {
    // key-value get (used for crypto-keys and direct op lookup)
    get: vi.fn(async (storeName: string, key: string) => {
      if (storeName === 'crypto-keys') return keyStore.get(key);
      return opsStore.get(key);
    }),
    put: vi.fn(async (storeName: string, value: StoredOp | CryptoKey, optKey?: string) => {
      if (storeName === 'crypto-keys') {
        keyStore.set(optKey as string, value as CryptoKey);
      } else {
        opsStore.set((value as StoredOp).localId, value as StoredOp);
      }
    }),
    delete: vi.fn(async (_storeName: string, key: string) => {
      opsStore.delete(key);
    }),
    // Index-based scan used by recoverStaleSyncingOps, getPendingOps, etc.
    getAllFromIndex: vi.fn(async (_storeName: string, _indexName: string, query: string) => {
      return [...opsStore.values()].filter((op) => op.encoderId === query);
    }),
    // Transactional writes
    transaction: vi.fn(() => {
      const txStore = {
        put: vi.fn(async (value: StoredOp) => {
          opsStore.set(value.localId, value);
        }),
        get: vi.fn(async (key: string) => opsStore.get(key)),
      };
      return {
        objectStore: vi.fn(() => txStore),
        done: Promise.resolve(),
      };
    }),
    getAll: vi.fn(async (storeName?: string) => {
      if (storeName === 'offlineOps') return [...opsStore.values()];
      if (storeName === 'cachedIncidents') return [...cacheStore.values()];
      return [];
    }),
    clear: vi.fn(async (storeName: string) => {
      if (storeName === 'offlineOps') opsStore.clear();
      else if (storeName === 'cachedIncidents') cacheStore.clear();
      else if (storeName === 'crypto-keys') keyStore.clear();
    }),
  };
}

vi.mock('idb', () => ({
  openDB: vi.fn(() => Promise.resolve(makeOpsDbMock())),
}));

// Import AFTER mock is defined so the module sees the mock
const {
  deleteOfflineOpCascade,
  recoverStaleSyncingOps,
  resolveConflictOp,
  resetFailedOp,
  updateOfflineOp,
  queueOfflineOp,
  getOfflineOp,
  setActiveOfflineUser,
  markOpFailed,
  getFailedOps,
} = await import('../offlineStore');

const ENCODER_ID = 'enc-001';

function makeOp(overrides: Partial<StoredOp> = {}): StoredOp {
  return {
    localId: crypto.randomUUID(),
    syncStatus: 'pending',
    encoderId: ENCODER_ID,
    lastAttemptAt: null,
    createdAt: Date.now() - 10_000,
    operation: 'create',
    serverId: null,
    linkedLocalId: null,
    serverUpdatedAt: null,
    regionId: 1,
    payload: { iv: [], data: [] },
    errorCode: null,
    errorMessage: null,
    serverVersion: null,
    retryCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  opsStore.clear();
  keyStore.clear();
  cacheStore.clear();
  try { localStorage.clear(); } catch { /* jsdom */ }
  vi.clearAllMocks();
});

// ─── recoverStaleSyncingOps ───────────────────────────────────────────────────

describe('recoverStaleSyncingOps', () => {
  it('returns 0 when there are no syncing ops', async () => {
    opsStore.set('op1', makeOp({ syncStatus: 'pending' }));
    const count = await recoverStaleSyncingOps(ENCODER_ID);
    expect(count).toBe(0);
  });

  it('does not recover a recently-started syncing op (within threshold)', async () => {
    const recentOp = makeOp({
      syncStatus: 'syncing',
      lastAttemptAt: Date.now() - 30_000, // 30s ago — within 5-min default
    });
    opsStore.set(recentOp.localId, recentOp);

    const count = await recoverStaleSyncingOps(ENCODER_ID, 5 * 60 * 1000);
    expect(count).toBe(0);
    expect(opsStore.get(recentOp.localId)?.syncStatus).toBe('syncing');
  });

  it('recovers a stale syncing op (older than threshold) to pending', async () => {
    const staleOp = makeOp({
      syncStatus: 'syncing',
      lastAttemptAt: Date.now() - 10 * 60 * 1000, // 10 min ago — past 5-min default
    });
    opsStore.set(staleOp.localId, staleOp);

    const count = await recoverStaleSyncingOps(ENCODER_ID);
    expect(count).toBe(1);
    expect(opsStore.get(staleOp.localId)?.syncStatus).toBe('pending');
  });

  it('recovers a syncing op with null lastAttemptAt (never attempted, defensive)', async () => {
    const unstarted = makeOp({
      syncStatus: 'syncing',
      lastAttemptAt: null,
    });
    opsStore.set(unstarted.localId, unstarted);

    const count = await recoverStaleSyncingOps(ENCODER_ID);
    expect(count).toBe(1);
    expect(opsStore.get(unstarted.localId)?.syncStatus).toBe('pending');
  });

  it('only processes ops belonging to the given encoder', async () => {
    const myOp = makeOp({ syncStatus: 'syncing', lastAttemptAt: null });
    const otherOp = makeOp({ syncStatus: 'syncing', lastAttemptAt: null, encoderId: 'other-enc' });
    opsStore.set(myOp.localId, myOp);
    opsStore.set(otherOp.localId, otherOp);

    const count = await recoverStaleSyncingOps(ENCODER_ID);
    expect(count).toBe(1);
    expect(opsStore.get(otherOp.localId)?.syncStatus).toBe('syncing'); // untouched
  });
});

// ─── updateOfflineOp ──────────────────────────────────────────────────────────

describe('updateOfflineOp', () => {
  it('updates payload without changing createdAt', async () => {
    const originalCreatedAt = Date.now() - 60_000;
    const localId = crypto.randomUUID();

    // Seed via queueOfflineOp so the payload gets properly encrypted
    await queueOfflineOp({
      localId,
      operation: 'create',
      serverId: null,
      linkedLocalId: null,
      serverUpdatedAt: null,
      regionId: 1,
      encoderId: ENCODER_ID,
      payload: { general_category: 'STRUCTURAL' },
      createdAt: originalCreatedAt,
    });

    const before = opsStore.get(localId)!;
    expect(before.createdAt).toBe(originalCreatedAt);

    await updateOfflineOp(localId, { general_category: 'VEHICULAR', updated_at: '2026-06-09T10:00:00.000Z' });

    const after = opsStore.get(localId)!;
    // createdAt must NOT have changed
    expect(after.createdAt).toBe(originalCreatedAt);
  });

  it('silently no-ops when op is not found', async () => {
    // Should not throw
    await expect(updateOfflineOp('nonexistent-id', { field: 'value' })).resolves.toBeUndefined();
  });
});

// ─── getOfflineOp ────────────────────────────────────────────────────────────

describe('getOfflineOp', () => {
  it('returns undefined for missing localId', async () => {
    const result = await getOfflineOp('no-such-id');
    expect(result).toBeUndefined();
  });

  it('returns decrypted op when found', async () => {
    const localId = crypto.randomUUID();
    await queueOfflineOp({
      localId,
      operation: 'create',
      serverId: null,
      linkedLocalId: null,
      serverUpdatedAt: null,
      regionId: 1,
      encoderId: ENCODER_ID,
      payload: { general_category: 'STRUCTURAL', fire_station_name: 'Station 1' },
      createdAt: Date.now(),
    });

    const op = await getOfflineOp(localId);
    expect(op).toBeDefined();
    expect(op!.localId).toBe(localId);
    expect(op!.payload.general_category).toBe('STRUCTURAL');
    expect(op!.payload.fire_station_name).toBe('Station 1');
  });
});

describe('deleteOfflineOpCascade', () => {
  it('deletes a create op and linked submit or update ops', async () => {
    const createOp = makeOp({ localId: 'create-local', operation: 'create' });
    const linkedSubmit = makeOp({
      localId: 'submit-local',
      operation: 'submit',
      linkedLocalId: createOp.localId,
    });
    const linkedUpdate = makeOp({
      localId: 'update-local',
      operation: 'update',
      linkedLocalId: linkedSubmit.localId,
    });
    const unrelated = makeOp({ localId: 'unrelated-local', operation: 'create' });

    opsStore.set(createOp.localId, createOp);
    opsStore.set(linkedSubmit.localId, linkedSubmit);
    opsStore.set(linkedUpdate.localId, linkedUpdate);
    opsStore.set(unrelated.localId, unrelated);

    await deleteOfflineOpCascade(createOp.localId);

    expect(opsStore.has(createOp.localId)).toBe(false);
    expect(opsStore.has(linkedSubmit.localId)).toBe(false);
    expect(opsStore.has(linkedUpdate.localId)).toBe(false);
    expect(opsStore.has(unrelated.localId)).toBe(true);
  });
});

describe('resolveConflictOp', () => {
  beforeEach(async () => {
    await setActiveOfflineUser(ENCODER_ID);
  });

  it('re-encrypts payload and resets op to pending', async () => {
    // Create an op via the normal path so the payload is properly encrypted
    await queueOfflineOp({
      localId: 'conflict-op-1',
      operation: 'create',
      serverId: null,
      linkedLocalId: null,
      serverUpdatedAt: null,
      regionId: 1,
      encoderId: ENCODER_ID,
      payload: { general_category: 'STRUCTURAL' },
      createdAt: Date.now(),
    });

    // Simulate conflict state: manually set syncStatus + metadata
    const raw = opsStore.get('conflict-op-1')!;
    const beforeEnc = raw.payload as { iv: number[]; data: number[] };
    opsStore.set('conflict-op-1', {
      ...raw,
      syncStatus: 'conflict',
      errorCode: '409_conflict',
      errorMessage: 'Version mismatch',
      serverVersion: { version: 3 },
      retryCount: 2,
    });

    const merged = { general_category: 'VEHICULAR', notes: 'merged' };
    await resolveConflictOp('conflict-op-1', merged);

    const resolved = opsStore.get('conflict-op-1')!;
    expect(resolved.syncStatus).toBe('pending');
    expect(resolved.errorCode).toBeNull();
    expect(resolved.errorMessage).toBeNull();
    expect(resolved.serverVersion).toBeNull();
    expect(resolved.retryCount).toBe(0);

    // Payload must be re-encrypted (new ciphertext)
    const afterEnc = resolved.payload as { iv: number[]; data: number[] };
    expect(Buffer.from(afterEnc.iv)).not.toEqual(Buffer.from(beforeEnc.iv));
    expect(Buffer.from(afterEnc.data)).not.toEqual(Buffer.from(beforeEnc.data));
  });

  it('is a no-op when the op does not exist', async () => {
    // Should not throw
    await expect(
      resolveConflictOp('nonexistent', { field: 'value' }),
    ).resolves.toBeUndefined();
  });
});

describe('per-user isolation (F12)', () => {
  it('wipes all offline ops + cache when a different uid logs in', async () => {
    await setActiveOfflineUser('user-A');
    await queueOfflineOp({
      localId: 'a-1', operation: 'create', serverId: null, linkedLocalId: null,
      serverUpdatedAt: null, regionId: 1, encoderId: 'user-A',
      payload: { general_category: 'STRUCTURAL' }, createdAt: Date.now(),
    });
    cacheStore.set(42, { serverId: 42 });
    expect(opsStore.size).toBe(1);
    expect(cacheStore.size).toBe(1);

    // A different account logs in on the same device → prior data destroyed.
    await setActiveOfflineUser('user-B');
    expect(opsStore.size).toBe(0);
    expect(cacheStore.size).toBe(0);
  });

  it('preserves offline ops on a same-user re-login', async () => {
    await setActiveOfflineUser('user-A');
    await queueOfflineOp({
      localId: 'a-2', operation: 'create', serverId: null, linkedLocalId: null,
      serverUpdatedAt: null, regionId: 1, encoderId: 'user-A',
      payload: { general_category: 'STRUCTURAL' }, createdAt: Date.now(),
    });
    expect(opsStore.size).toBe(1);

    await setActiveOfflineUser('user-A'); // same uid → no wipe
    expect(opsStore.size).toBe(1);
  });
});

// ─── markOpFailed ────────────────────────────────────────────────────────────

describe('markOpFailed', () => {
  beforeEach(async () => {
    await setActiveOfflineUser(ENCODER_ID);
  });

  it('sets syncStatus to failed', async () => {
    const localId = crypto.randomUUID();
    await queueOfflineOp({
      localId,
      operation: 'create',
      serverId: null,
      linkedLocalId: null,
      serverUpdatedAt: null,
      regionId: 1,
      encoderId: ENCODER_ID,
      payload: { general_category: 'STRUCTURAL' },
      createdAt: Date.now(),
    });

    await markOpFailed(localId, 'network', 'max retries exceeded');

    const op = await getOfflineOp(localId);
    expect(op).toBeDefined();
    expect(op!.syncStatus).toBe('failed');
    expect(op!.errorCode).toBe('network');
    expect(op!.errorMessage).toBe('max retries exceeded');
    expect(op!.lastAttemptAt).not.toBeNull();
  });

  it('does NOT double-increment retryCount (already at ceiling)', async () => {
    const localId = crypto.randomUUID();
    await queueOfflineOp({
      localId,
      operation: 'create',
      serverId: null,
      linkedLocalId: null,
      serverUpdatedAt: null,
      regionId: 1,
      encoderId: ENCODER_ID,
      payload: { general_category: 'STRUCTURAL' },
      createdAt: Date.now(),
    });

    // Manually set retryCount to 5 (MAX_RETRY)
    const raw = opsStore.get(localId)!;
    opsStore.set(localId, { ...raw, retryCount: 5 });

    await markOpFailed(localId, '4xx', 'HTTP 422');

    const op = await getOfflineOp(localId);
    expect(op).toBeDefined();
    expect(op!.retryCount).toBe(5); // not 6
  });

  it('silently no-ops when op does not exist', async () => {
    await expect(markOpFailed('nonexistent', 'network', 'gone')).resolves.toBeUndefined();
  });
});

// ─── getFailedOps ────────────────────────────────────────────────────────────

describe('getFailedOps', () => {
  beforeEach(async () => {
    await setActiveOfflineUser(ENCODER_ID);
  });

  it('returns empty array when no failed ops exist', async () => {
    await queueOfflineOp({
      localId: crypto.randomUUID(),
      operation: 'create',
      serverId: null, linkedLocalId: null, serverUpdatedAt: null,
      regionId: 1, encoderId: ENCODER_ID,
      payload: { general_category: 'STRUCTURAL' },
      createdAt: Date.now(),
    });

    const result = await getFailedOps(ENCODER_ID);
    expect(result).toEqual([]);
  });

  it('returns only ops with syncStatus=failed', async () => {
    const failedId = crypto.randomUUID();
    const pendingId = crypto.randomUUID();

    await queueOfflineOp({
      localId: failedId,
      operation: 'create',
      serverId: null, linkedLocalId: null, serverUpdatedAt: null,
      regionId: 1, encoderId: ENCODER_ID,
      payload: { general_category: 'STRUCTURAL' },
      createdAt: Date.now(),
    });
    await queueOfflineOp({
      localId: pendingId,
      operation: 'update',
      serverId: null, linkedLocalId: null, serverUpdatedAt: null,
      regionId: 1, encoderId: ENCODER_ID,
      payload: { notes: 'test' },
      createdAt: Date.now(),
    });

    await markOpFailed(failedId, 'network', 'max retries');

    const result = await getFailedOps(ENCODER_ID);
    expect(result).toHaveLength(1);
    expect(result[0].localId).toBe(failedId);
    expect(result[0].syncStatus).toBe('failed');
  });

  it('scopes results by encoderId', async () => {
    const myFailedId = crypto.randomUUID();
    const otherFailedId = crypto.randomUUID();

    await queueOfflineOp({
      localId: myFailedId,
      operation: 'create',
      serverId: null, linkedLocalId: null, serverUpdatedAt: null,
      regionId: 1, encoderId: ENCODER_ID,
      payload: { general_category: 'STRUCTURAL' },
      createdAt: Date.now(),
    });
    await queueOfflineOp({
      localId: otherFailedId,
      operation: 'create',
      serverId: null, linkedLocalId: null, serverUpdatedAt: null,
      regionId: 1, encoderId: 'other-enc',
      payload: { general_category: 'VEHICULAR' },
      createdAt: Date.now(),
    });

    await markOpFailed(myFailedId, 'network', 'max retries');
    await markOpFailed(otherFailedId, '4xx', 'HTTP 422');

    const myResult = await getFailedOps(ENCODER_ID);
    expect(myResult).toHaveLength(1);
    expect(myResult[0].localId).toBe(myFailedId);
  });
});
