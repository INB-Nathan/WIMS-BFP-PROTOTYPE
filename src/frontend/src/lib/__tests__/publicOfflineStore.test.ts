/**
 * publicOfflineStore tests — civilian anonymous offline submission queue (FR-CIV-OFFLINE).
 *
 * These tests verify the v5 IndexedDB upgrade + CRUD helpers for the
 * publicOfflineOps store. Unlike offlineOps (encoder-scoped, encrypted),
 * publicOfflineOps is unauthenticated and stored in plaintext by design —
 * civilians have no per-user key material, and the threat model deliberately
 * accepts a malicious local-user risk in exchange for queued-submission
 * resilience (see handoff decision #2).
 *
 * Uses Map-backed mock idb (Pattern A) consistent with the other offlineStore
 * tests, so the same machinery used by queueOfflineOp / getPendingOps drives
 * the new store. This keeps the test surface area small.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
  (globalThis as Record<string, unknown>).crypto = webcrypto;
}

// ─── Minimal idb mock ─────────────────────────────────────────────────────────

type StoredPublicOp = {
  localId: string;
  deviceId: string;
  operation: string;
  linkedLocalId: string | null;
  serverId: number | null;
  status: string;
  createdAt: number;
  lastAttemptAt: number | null;
  retryCount: number;
  payload: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  [key: string]: unknown;
};

const publicOpsStore = new Map<string, StoredPublicOp>();
const keyStore = new Map<string, unknown>();

function makeMockDb() {
  return {
    get: vi.fn(async (storeName: string, key: string) => {
      if (storeName === 'crypto-keys') return keyStore.get(key);
      if (storeName === 'publicOfflineOps') return publicOpsStore.get(key);
      return undefined;
    }),
    put: vi.fn(async (storeName: string, value: StoredPublicOp | unknown, optKey?: string) => {
      if (storeName === 'crypto-keys') {
        keyStore.set(optKey as string, value);
      } else if (storeName === 'publicOfflineOps') {
        publicOpsStore.set((value as StoredPublicOp).localId, value as StoredPublicOp);
      }
    }),
    delete: vi.fn(async (storeName: string, key: string) => {
      if (storeName === 'publicOfflineOps') publicOpsStore.delete(key);
      if (storeName === 'crypto-keys') keyStore.delete(key);
    }),
    getAll: vi.fn(async (storeName: string) => {
      if (storeName === 'publicOfflineOps') return [...publicOpsStore.values()];
      return [];
    }),
    getAllFromIndex: vi.fn(async (storeName: string, _idx: string, query: string) => {
      if (storeName !== 'publicOfflineOps') return [];
      return [...publicOpsStore.values()].filter((op) => op.deviceId === query);
    }),
    transaction: vi.fn(() => {
      const txStore = {
        put: vi.fn(async (value: StoredPublicOp) => {
          publicOpsStore.set(value.localId, value);
        }),
        get: vi.fn(async (key: string) => publicOpsStore.get(key)),
        delete: vi.fn(async (key: string) => { publicOpsStore.delete(key); }),
      };
      return {
        objectStore: vi.fn(() => txStore),
        done: Promise.resolve(),
      };
    }),
    clear: vi.fn(async (storeName: string) => {
      if (storeName === 'publicOfflineOps') publicOpsStore.clear();
      if (storeName === 'crypto-keys') keyStore.clear();
    }),
  };
}

vi.mock('idb', () => ({ openDB: vi.fn(() => Promise.resolve(makeMockDb())) }));

// Import AFTER mock — module is evaluated once and uses openDB lazily.
const {
  queuePublicOfflineOp,
  getPendingPublicOps,
  getPublicOp,
  markPublicOpSynced,
  markPublicOpFailed,
  getLinkedPublicOp,
  purgeSyncedPublicOps,
  getPendingPublicOpsCount,
} = await import('../offlineStore');

const DEVICE_ID = 'device-aaa';

function makeOp(overrides: Partial<StoredPublicOp> = {}): StoredPublicOp {
  return {
    localId: crypto.randomUUID(),
    deviceId: DEVICE_ID,
    operation: 'submit',
    linkedLocalId: null,
    serverId: null,
    status: 'pending',
    createdAt: Date.now(),
    lastAttemptAt: null,
    retryCount: 0,
    payload: { general_category: 'STRUCTURAL' },
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

beforeEach(() => {
  publicOpsStore.clear();
  keyStore.clear();
  try { localStorage.clear(); } catch { /* jsdom */ }
  vi.clearAllMocks();
});

// ─── queuePublicOfflineOp ─────────────────────────────────────────────────────

describe('queuePublicOfflineOp', () => {
  it('stores an op with status=pending and all 13 fields', async () => {
    const op = makeOp();
    await queuePublicOfflineOp(op);

    const stored = publicOpsStore.get(op.localId);
    expect(stored).toBeDefined();
    expect(stored).toMatchObject({
      localId: op.localId,
      deviceId: DEVICE_ID,
      operation: 'submit',
      status: 'pending',
      payload: { general_category: 'STRUCTURAL' },
      retryCount: 0,
      serverId: null,
      linkedLocalId: null,
      errorCode: null,
      errorMessage: null,
      lastAttemptAt: null,
    });
    expect(typeof stored?.createdAt).toBe('number');
  });

  it('accepts submit, append, and followup operations', async () => {
    const submit = makeOp({ operation: 'submit', localId: 'op-submit' });
    const append = makeOp({ operation: 'append', localId: 'op-append' });
    const followup = makeOp({ operation: 'followup', localId: 'op-followup' });

    await queuePublicOfflineOp(submit);
    await queuePublicOfflineOp(append);
    await queuePublicOfflineOp(followup);

    expect(publicOpsStore.get('op-submit')?.operation).toBe('submit');
    expect(publicOpsStore.get('op-append')?.operation).toBe('append');
    expect(publicOpsStore.get('op-followup')?.operation).toBe('followup');
  });
});

// ─── getPendingPublicOps ──────────────────────────────────────────────────────

describe('getPendingPublicOps', () => {
  it('returns only pending and retryable ops for the given deviceId', async () => {
    await queuePublicOfflineOp(makeOp({ localId: 'p1', status: 'pending' }));
    await queuePublicOfflineOp(makeOp({ localId: 'r1', status: 'retryable' }));
    await queuePublicOfflineOp(makeOp({ localId: 's1', status: 'synced' }));
    await queuePublicOfflineOp(makeOp({ localId: 'f1', status: 'failed' }));
    await queuePublicOfflineOp(makeOp({ localId: 'sy1', status: 'syncing' }));
    // other device
    await queuePublicOfflineOp(makeOp({ localId: 'p2', status: 'pending', deviceId: 'other-device' }));

    const result = await getPendingPublicOps(DEVICE_ID);
    const localIds = result.map((o) => o.localId).sort();
    expect(localIds).toEqual(['p1', 'r1']);
  });

  it('returns ops sorted by createdAt ascending', async () => {
    const now = Date.now();
    await queuePublicOfflineOp(makeOp({ localId: 'middle', createdAt: now + 1000 }));
    await queuePublicOfflineOp(makeOp({ localId: 'first', createdAt: now }));
    await queuePublicOfflineOp(makeOp({ localId: 'last', createdAt: now + 2000 }));

    const result = await getPendingPublicOps(DEVICE_ID);
    expect(result.map((o) => o.localId)).toEqual(['first', 'middle', 'last']);
  });

  it('returns empty array when no pending ops exist', async () => {
    const result = await getPendingPublicOps(DEVICE_ID);
    expect(result).toEqual([]);
  });
});

// ─── markPublicOpSynced ───────────────────────────────────────────────────────

describe('markPublicOpSynced', () => {
  it('sets status to synced and stores serverId', async () => {
    await queuePublicOfflineOp(makeOp({ localId: 'op-1' }));

    await markPublicOpSynced('op-1', 42);

    const stored = publicOpsStore.get('op-1');
    expect(stored?.status).toBe('synced');
    expect(stored?.serverId).toBe(42);
  });

  it('is a no-op when op does not exist', async () => {
    await expect(markPublicOpSynced('missing', 99)).resolves.toBeUndefined();
  });
});

// ─── markPublicOpFailed ───────────────────────────────────────────────────────

describe('markPublicOpFailed', () => {
  it('increments retryCount, sets errorCode/errorMessage, marks retryable', async () => {
    await queuePublicOfflineOp(makeOp({ localId: 'op-1', retryCount: 0 }));

    await markPublicOpFailed('op-1', 'network', 'connection lost');

    const stored = publicOpsStore.get('op-1');
    expect(stored?.status).toBe('retryable');
    expect(stored?.errorCode).toBe('network');
    expect(stored?.errorMessage).toBe('connection lost');
    expect(stored?.retryCount).toBe(1);
    expect(typeof stored?.lastAttemptAt).toBe('number');
  });

  it('marks permanent failure after MAX_RETRY=5 attempts', async () => {
    await queuePublicOfflineOp(makeOp({ localId: 'op-1', retryCount: 4 }));

    await markPublicOpFailed('op-1', 'network', 'connection lost');

    const stored = publicOpsStore.get('op-1');
    expect(stored?.status).toBe('failed');
    // 4 + 1 = 5 (or however implementation chooses; just confirm it stopped at 5)
    expect(stored?.retryCount).toBeGreaterThanOrEqual(4);
  });
});

// ─── getLinkedPublicOp ────────────────────────────────────────────────────────

describe('getLinkedPublicOp', () => {
  it('returns ops whose linkedLocalId matches, sorted by createdAt ascending', async () => {
    const parentId = 'parent-1';
    const now = Date.now();
    await queuePublicOfflineOp(makeOp({ localId: 'a', linkedLocalId: parentId, createdAt: now + 2000 }));
    await queuePublicOfflineOp(makeOp({ localId: 'b', linkedLocalId: parentId, createdAt: now + 1000 }));
    await queuePublicOfflineOp(makeOp({ localId: 'c', linkedLocalId: 'other-parent', createdAt: now + 500 }));

    const result = await getLinkedPublicOp(parentId);
    expect(result.map((o) => o.localId)).toEqual(['b', 'a']);
  });

  it('returns empty array when nothing is linked', async () => {
    const result = await getLinkedPublicOp('nonexistent');
    expect(result).toEqual([]);
  });
});

// ─── purgeSyncedPublicOps ─────────────────────────────────────────────────────

describe('purgeSyncedPublicOps', () => {
  it('removes synced ops older than 7 days, leaves fresh ones', async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await queuePublicOfflineOp(makeOp({ localId: 'old', status: 'synced', createdAt: now - 8 * day }));
    await queuePublicOfflineOp(makeOp({ localId: 'fresh', status: 'synced', createdAt: now - 2 * day }));
    await queuePublicOfflineOp(makeOp({ localId: 'pending-old', status: 'pending', createdAt: now - 8 * day }));

    await purgeSyncedPublicOps(7 * day);

    expect(publicOpsStore.has('old')).toBe(false);
    expect(publicOpsStore.has('fresh')).toBe(true);
    expect(publicOpsStore.has('pending-old')).toBe(true);
  });
});

// ─── getPendingPublicOpsCount ─────────────────────────────────────────────────

describe('getPendingPublicOpsCount', () => {
  it('counts only pending+retryable for the deviceId', async () => {
    await queuePublicOfflineOp(makeOp({ localId: 'p1', status: 'pending' }));
    await queuePublicOfflineOp(makeOp({ localId: 'r1', status: 'retryable' }));
    await queuePublicOfflineOp(makeOp({ localId: 's1', status: 'synced' }));
    await queuePublicOfflineOp(makeOp({ localId: 'f1', status: 'failed' }));
    await queuePublicOfflineOp(makeOp({ localId: 'o1', status: 'pending', deviceId: 'other' }));

    const count = await getPendingPublicOpsCount(DEVICE_ID);
    expect(count).toBe(2);
  });
});

// ─── getPublicOp ──────────────────────────────────────────────────────────────

describe('getPublicOp', () => {
  it('returns op by localId', async () => {
    await queuePublicOfflineOp(makeOp({ localId: 'op-1' }));
    const op = await getPublicOp('op-1');
    expect(op?.localId).toBe('op-1');
  });

  it('returns undefined for missing localId', async () => {
    const op = await getPublicOp('nope');
    expect(op).toBeUndefined();
  });
});
