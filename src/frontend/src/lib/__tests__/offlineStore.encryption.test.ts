/**
 * offlineStore encryption-at-rest tests
 *
 * Verifies that every IndexedDB write path encrypts before persistence and that
 * read paths decrypt transparently. Tests are independent of the offlineStore
 * unit tests — they use the same mock infrastructure but focus exclusively on
 * encryption behaviour required by issue #64 acceptance criterion 1.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
  (globalThis as Record<string, unknown>).crypto = webcrypto;
}

// ─── Shared mock state (module-level, so getDB() always returns the same stores) ──

type AnyStoredRecord = Record<string, unknown>;

// Legacy queue store (id-keyed items, shares with existing test pattern)
const legacyQueueStore = new Map<number, AnyStoredRecord>();
// Other stores keyed by string or number
const cryptoKeysStore = new Map<string, CryptoKey>();
const offlineOpsStore = new Map<string, AnyStoredRecord>();
const cachedIncidentsStore = new Map<number, AnyStoredRecord>();
const analyticsCacheStore = new Map<string, AnyStoredRecord>();

let nextLegacyId = 1;
let getAllReturn: AnyStoredRecord[] = [];

function resetAllStores() {
  legacyQueueStore.clear();
  cryptoKeysStore.clear();
  offlineOpsStore.clear();
  cachedIncidentsStore.clear();
  analyticsCacheStore.clear();
  getAllReturn = [];
  nextLegacyId = 1;
}

function makeDbMock() {
  return {
    add: vi.fn((_s: string, item: Record<string, unknown>) => {
      const id = nextLegacyId++;
      const rec = { ...item, id } as AnyStoredRecord;
      legacyQueueStore.set(id, rec);
      getAllReturn.push(rec);
      return Promise.resolve(id);
    }),
    getAll: vi.fn((_s?: string) => {
      if (_s === 'offlineOps') return Promise.resolve([...offlineOpsStore.values()]);
      if (_s === 'cachedIncidents') return Promise.resolve([...cachedIncidentsStore.values()]);
      return Promise.resolve([...legacyQueueStore.values()]);
    }),
    get: vi.fn((_s: string, key: string | number) => {
      if (_s === 'crypto-keys') return Promise.resolve(cryptoKeysStore.get(String(key)));
      if (_s === 'incident-queue') return Promise.resolve(legacyQueueStore.get(key as number));
      if (_s === 'offlineOps') return Promise.resolve(offlineOpsStore.get(String(key)));
      if (_s === 'cachedIncidents') return Promise.resolve(cachedIncidentsStore.get(key as number));
      if (_s === 'analytics-cache') return Promise.resolve(analyticsCacheStore.get(String(key)));
      return Promise.resolve(undefined);
    }),
    put: vi.fn((_s: string, value: AnyStoredRecord | CryptoKey, optKey?: string) => {
      if (_s === 'crypto-keys' && optKey) {
        cryptoKeysStore.set(optKey, value as CryptoKey);
      } else if (_s === 'offlineOps' && (value as AnyStoredRecord).localId) {
        offlineOpsStore.set((value as AnyStoredRecord).localId as string, value as AnyStoredRecord);
      } else if (_s === 'cachedIncidents' && (value as AnyStoredRecord).serverId !== undefined) {
        cachedIncidentsStore.set((value as AnyStoredRecord).serverId as number, value as AnyStoredRecord);
      } else if (_s === 'analytics-cache' && (value as AnyStoredRecord).key) {
        analyticsCacheStore.set((value as AnyStoredRecord).key as string, value as AnyStoredRecord);
      }
      return Promise.resolve();
    }),
    delete: vi.fn((_s: string, key: string | number) => {
      if (_s === 'incident-queue') legacyQueueStore.delete(key as number);
      else if (_s === 'offlineOps') offlineOpsStore.delete(String(key));
      else if (_s === 'cachedIncidents') cachedIncidentsStore.delete(key as number);
      else if (_s === 'analytics-cache') analyticsCacheStore.delete(String(key));
      else if (_s === 'crypto-keys') cryptoKeysStore.delete(String(key));
      return Promise.resolve();
    }),
    clear: vi.fn((_s: string) => {
      if (_s === 'crypto-keys') cryptoKeysStore.clear();
      else if (_s === 'offlineOps') offlineOpsStore.clear();
      else if (_s === 'cachedIncidents') cachedIncidentsStore.clear();
      else if (_s === 'analytics-cache') analyticsCacheStore.clear();
      return Promise.resolve();
    }),
    getAllFromIndex: vi.fn((_s: string, _idx: string, query: string) => {
      if (_s === 'offlineOps') {
        return Promise.resolve(
          [...offlineOpsStore.values()].filter((op) => op.encoderId === query),
        );
      }
      if (_s === 'cachedIncidents') {
        return Promise.resolve(
          [...cachedIncidentsStore.values()].filter((op) => op.encoderId === query),
        );
      }
      return Promise.resolve([]);
    }),
    transaction: vi.fn(() => {
      const txStore = {
        get: vi.fn((id: number | string) => Promise.resolve(legacyQueueStore.get(id as number))),
        put: vi.fn((item: { id: number }) => {
          legacyQueueStore.set(item.id, item as AnyStoredRecord);
          return Promise.resolve();
        }),
        delete: vi.fn((id: number) => {
          legacyQueueStore.delete(id);
          return Promise.resolve();
        }),
        openCursor: vi.fn(() => {
          const entries = Array.from(legacyQueueStore.entries());
          let idx = 0;
          return Promise.resolve({
            get value() { return entries[idx]?.[1]; },
            delete() { if (entries[idx]) legacyQueueStore.delete(entries[idx][0]); return Promise.resolve(); },
            continue() { idx++; return idx < entries.length ? Promise.resolve(this) : Promise.resolve(null); },
          });
        }),
      };
      return {
        objectStore: vi.fn((name: string) => {
          if (name === 'offlineOps') {
            return {
              get: vi.fn((key: string) => Promise.resolve(offlineOpsStore.get(key))),
              put: vi.fn((value: AnyStoredRecord) => {
                offlineOpsStore.set(value.localId as string, value);
                return Promise.resolve();
              }),
              delete: vi.fn((key: string) => {
                offlineOpsStore.delete(key);
                return Promise.resolve();
              }),
            };
          }
          return txStore;
        }),
        done: Promise.resolve(),
      };
    }),
    objectStoreNames: {
      contains: vi.fn((name: string) => {
        return ['incident-queue', 'crypto-keys', 'offlineOps', 'cachedIncidents', 'analytics-cache'].includes(name);
      }),
    },
  };
}

vi.mock('idb', () => ({
  openDB: vi.fn(() => Promise.resolve(makeDbMock())),
}));

const {
  queueIncident,
  getPendingIncidents,
  queueOfflineOp,
  getPendingOps,
  saveDraftOp,
  getDraftOps,
  cacheIncident,
  getCachedIncident,
  cacheAnalyticsResponse,
  getCachedAnalyticsResponse,
  updateQueuedIncident,
  updateOfflineOp,
  setActiveOfflineUser,
  clearAllOfflineData,
} = await import('../offlineStore');

const ENCODER_ID = 'enc-test-001';

beforeEach(() => {
  resetAllStores();
  try { localStorage.clear(); } catch { /* jsdom */ }
  vi.clearAllMocks();
});

// ─── Encryption-at-rest: legacy queue (incident-queue) ─────────────────────

describe('encryption at rest — legacy incident queue', () => {
  it('encrypts payload on queueIncident', async () => {
    await queueIncident({ description: 'secret fire data', lat: 14.5, lon: 120.9 });

    const raw = [...legacyQueueStore.values()][0] as {
      encrypted?: { iv: unknown; data: unknown };
      payload?: unknown;
    };

    expect(raw.encrypted).toBeDefined();
    expect(raw.encrypted!.iv).toBeDefined();
    expect(raw.encrypted!.data).toBeDefined();
    expect(raw.payload).toBeUndefined();
  });

  it('decrypts payload on getPendingIncidents', async () => {
    const original = { description: 'test incident', lat: 15.1 };
    await queueIncident(original);

    const pending = await getPendingIncidents();
    expect(pending[0].payload).toEqual(original);
  });

  it('updates re-encrypt with new ciphertext (unique IV)', async () => {
    await queueIncident({ description: 'Original' });
    const beforeItem = [...legacyQueueStore.values()][0] as { encrypted: { iv: number[]; data: number[] } };
    const beforeData = [...beforeItem.encrypted.data];
    const beforeIv = [...beforeItem.encrypted.iv];

    await updateQueuedIncident(1, { description: 'Updated', extra: true });
    const after = [...legacyQueueStore.values()][0] as { encrypted: { iv: number[]; data: number[] } };

    // Re-encryption must produce different ciphertext (new IV)
    expect(Buffer.from(after.encrypted.iv)).not.toEqual(Buffer.from(beforeIv));
    expect(Buffer.from(after.encrypted.data)).not.toEqual(Buffer.from(beforeData));
  });
});

// ─── Encryption-at-rest: offlineOps queue ───────────────────────────────────

describe('encryption at rest — offlineOps queue', () => {
  beforeEach(async () => {
    await setActiveOfflineUser(ENCODER_ID);
  });

  it('encrypts payload on queueOfflineOp', async () => {
    await queueOfflineOp({
      localId: 'op-enc-1',
      operation: 'create',
      serverId: null,
      linkedLocalId: null,
      serverUpdatedAt: null,
      regionId: 1,
      encoderId: ENCODER_ID,
      payload: { latitude: 14.5995, longitude: 120.9842, general_category: 'STRUCTURAL', fire_station_name: 'Station 1' },
      createdAt: Date.now(),
    });

    const raw = offlineOpsStore.get('op-enc-1')!;
    const enc = raw.payload as { iv: number[]; data: number[] };
    expect(Array.isArray(enc.iv)).toBe(true);
    expect(enc.iv.length).toBe(12); // AES-GCM IV
    expect(Array.isArray(enc.data)).toBe(true);
    // Raw data should not contain plaintext strings
    const rawJson = JSON.stringify(raw);
    expect(rawJson.includes('STRUCTURAL')).toBe(false);
    expect(rawJson.includes('Station 1')).toBe(false);
  });

  it('decrypts payload on getPendingOps', async () => {
    const payload = { latitude: 14.5995, longitude: 120.9842, general_category: 'VEHICULAR', incident_address: 'EDSA' };
    await queueOfflineOp({
      localId: 'op-enc-2',
      operation: 'create',
      serverId: null,
      linkedLocalId: null,
      serverUpdatedAt: null,
      regionId: 1,
      encoderId: ENCODER_ID,
      payload,
      createdAt: Date.now(),
    });

    const ops = await getPendingOps(ENCODER_ID);
    expect(ops).toHaveLength(1);
    expect(ops[0].payload).toEqual(payload);
  });

  it('encrypts payload on saveDraftOp', async () => {
    await saveDraftOp('draft-enc-1', ENCODER_ID, 1, { general_category: 'WILDLAND', notes: 'draft notes' });

    const raw = offlineOpsStore.get('draft-enc-1')!;
    const enc = raw.payload as { iv: number[]; data: number[] };
    expect(Array.isArray(enc.iv)).toBe(true);
    expect(Array.isArray(enc.data)).toBe(true);

    const rawJson = JSON.stringify(raw);
    expect(rawJson.includes('WILDLAND')).toBe(false);
    expect(rawJson.includes('draft notes')).toBe(false);
  });

  it('decrypts draft payload on getDraftOps', async () => {
    await saveDraftOp('draft-enc-2', ENCODER_ID, 1, { general_category: 'NON_STRUCTURAL', foo: 'bar' });

    const drafts = await getDraftOps(ENCODER_ID);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].payload.general_category).toBe('NON_STRUCTURAL');
    expect(drafts[0].payload.foo).toBe('bar');
  });

  it('updateOfflineOp re-encrypts with new ciphertext', async () => {
    await queueOfflineOp({
      localId: 'op-re-enc',
      operation: 'create',
      serverId: null,
      linkedLocalId: null,
      serverUpdatedAt: null,
      regionId: 1,
      encoderId: ENCODER_ID,
      payload: { latitude: 14.5995, longitude: 120.9842, desc: 'original' },
      createdAt: Date.now(),
    });

    const beforeEnc = (offlineOpsStore.get('op-re-enc')!.payload as { iv: number[]; data: number[] });
    const beforeData = [...beforeEnc.data];
    const beforeIv = [...beforeEnc.iv];

    await updateOfflineOp('op-re-enc', { latitude: 14.5995, longitude: 120.9842, desc: 'updated payload' });

    const afterEnc = (offlineOpsStore.get('op-re-enc')!.payload as { iv: number[]; data: number[] });
    expect(Buffer.from(afterEnc.iv)).not.toEqual(Buffer.from(beforeIv));
    expect(Buffer.from(afterEnc.data)).not.toEqual(Buffer.from(beforeData));
  });
});

// ─── Encryption-at-rest: cached incidents ───────────────────────────────────

describe('encryption at rest — cached incidents', () => {
  beforeEach(async () => {
    await setActiveOfflineUser(ENCODER_ID);
  });

  it('encrypts data on cacheIncident', async () => {
    await cacheIncident(42, { description: 'cached fire incident' }, ENCODER_ID);

    const raw = cachedIncidentsStore.get(42)!;
    const enc = raw.data as { iv: number[]; data: number[] };
    expect(Array.isArray(enc.iv)).toBe(true);
    expect(Array.isArray(enc.data)).toBe(true);

    const rawJson = JSON.stringify(raw);
    expect(rawJson.includes('cached fire incident')).toBe(false);
  });

  it('decrypts data on getCachedIncident', async () => {
    const original = { description: 'cached test', status: 'PENDING' };
    await cacheIncident(7, original, ENCODER_ID);

    const cached = await getCachedIncident(7, ENCODER_ID);
    expect(cached!.data).toEqual(original);
  });
});

// ─── Encryption-at-rest: analytics cache ────────────────────────────────────

describe('encryption at rest — analytics cache', () => {
  beforeEach(async () => {
    await setActiveOfflineUser(ENCODER_ID);
  });

  it('encrypts data on cacheAnalyticsResponse', async () => {
    await cacheAnalyticsResponse('heatmap:ncr', { geometry: 'GeoJSON', count: 100 });

    const raw = analyticsCacheStore.get('heatmap:ncr')!;
    const enc = raw.encrypted as { iv: number[]; data: number[] };
    expect(Array.isArray(enc.iv)).toBe(true);
    expect(Array.isArray(enc.data)).toBe(true);

    const rawJson = JSON.stringify(raw);
    expect(rawJson.includes('GeoJSON')).toBe(false);
  });

  it('decrypts data on getCachedAnalyticsResponse', async () => {
    const original = { items: [{ name: 'Manila' }, { name: 'Quezon City' }] };
    await cacheAnalyticsResponse('topbarangays', original);

    const cached = await getCachedAnalyticsResponse<typeof original>('topbarangays');
    expect(cached!.data).toEqual(original);
  });
});

// ─── Unique IV per encryption ───────────────────────────────────────────────

describe('unique IV per encryption', () => {
  beforeEach(async () => {
    await setActiveOfflineUser(ENCODER_ID);
  });

  it('produces unique IV for each queueIncident call', async () => {
    const payload = { desc: 'same payload' };
    await queueIncident(payload);
    await queueIncident(payload);
    await queueIncident(payload);

    const items = [...legacyQueueStore.values()] as Array<{ encrypted: { iv: number[] } }>;
    const ivs = items.map((i) => Buffer.from(i.encrypted.iv).toString('hex'));
    expect(new Set(ivs).size).toBe(3); // all unique
  });

  it('produces unique IV for each queueOfflineOp call', async () => {
    const payload = { latitude: 14.5995, longitude: 120.9842, desc: 'same payload' };
    await queueOfflineOp({
      localId: 'op1', operation: 'create', serverId: null, linkedLocalId: null,
      serverUpdatedAt: null, regionId: 1, encoderId: ENCODER_ID,
      payload, createdAt: Date.now(),
    });
    await queueOfflineOp({
      localId: 'op2', operation: 'create', serverId: null, linkedLocalId: null,
      serverUpdatedAt: null, regionId: 1, encoderId: ENCODER_ID,
      payload, createdAt: Date.now(),
    });

    const iv1 = Buffer.from((offlineOpsStore.get('op1')!.payload as { iv: number[] }).iv).toString('hex');
    const iv2 = Buffer.from((offlineOpsStore.get('op2')!.payload as { iv: number[] }).iv).toString('hex');
    expect(iv1).not.toBe(iv2);
  });

  it('produces unique IV for repeated cacheAnalyticsResponse calls', async () => {
    await cacheAnalyticsResponse('same-key', { data: 1 });
    const iv1 = Buffer.from((analyticsCacheStore.get('same-key')!.encrypted as { iv: number[] }).iv).toString('hex');

    await cacheAnalyticsResponse('same-key', { data: 2 });
    const iv2 = Buffer.from((analyticsCacheStore.get('same-key')!.encrypted as { iv: number[] }).iv).toString('hex');

    expect(iv1).not.toBe(iv2);
  });
});
