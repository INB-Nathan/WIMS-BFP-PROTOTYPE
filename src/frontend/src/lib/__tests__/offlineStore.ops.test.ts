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
      return [];
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
  updateOfflineOp,
  queueOfflineOp,
  getOfflineOp,
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
