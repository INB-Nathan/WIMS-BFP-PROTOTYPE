/**
 * offlineStore tests — verifies IndexedDB queue operations with AES-256-GCM encryption.
 *
 * These tests confirm the foundation that syncEngine will consume.
 * Payload encryption is transparent: queueIncident encrypts on write,
 * getPendingIncidents/getQueuedIncident decrypt on read.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    (globalThis as Record<string, unknown>).crypto = webcrypto;
}

type StoredRecord = {
    id: number;
    opType?: 'create' | 'verify' | 'archive_action';
    localId?: string;
    encrypted: { iv: number[]; data: number[] };
    createdAt: number;
    status: 'pending' | 'synced';
};

const store = new Map<number, StoredRecord>();
const keyStore = new Map<string, CryptoKey>();
let nextId = 1;
let getAllReturn: StoredRecord[] = [];

function makeDbMock() {
    return {
        add: vi.fn((_s: string, item: Record<string, unknown>) => {
            const id = nextId++;
            const record = { ...item, id } as StoredRecord;
            store.set(id, record);
            getAllReturn.push(record);
            return Promise.resolve(id);
        }),
        getAll: vi.fn(() => Promise.resolve(Array.from(store.values()))),
        get: vi.fn((_s: string, key: string | number) => {
            if (_s === 'crypto-keys') {
                return Promise.resolve(keyStore.get(String(key)));
            }
            return Promise.resolve(store.get(key as number));
        }),
        put: vi.fn((_s: string, key: unknown, keyName: string) => {
            if (_s === 'crypto-keys') {
                keyStore.set(keyName, key as CryptoKey);
            }
            return Promise.resolve();
        }),
        transaction: vi.fn(() => ({
            objectStore: vi.fn(() => ({
                get: vi.fn((id: number) => Promise.resolve(store.get(id))),
                put: vi.fn((item: { id: number }) => {
                    store.set(item.id, item as StoredRecord);
                    return Promise.resolve();
                }),
                delete: vi.fn((id: number) => { store.delete(id); return Promise.resolve(); }),
                openCursor: vi.fn(() => {
                    const entries = Array.from(store.entries());
                    let idx = 0;
                    return Promise.resolve({
                        get value() { return entries[idx]?.[1]; },
                        delete() { if (entries[idx]) store.delete(entries[idx][0]); return Promise.resolve(); },
                        continue() { idx++; return idx < entries.length ? Promise.resolve(this) : Promise.resolve(null); },
                    });
                }),
            })),
            done: Promise.resolve(),
        })),
    };
}

vi.mock('idb', () => ({
    openDB: vi.fn(() => Promise.resolve(makeDbMock())),
}));

const { queueIncident, getPendingIncidents, getQueuedIncident, updateQueuedIncident, markSynced, deleteQueuedIncident } = await import('../offlineStore');

beforeEach(() => {
    store.clear();
    keyStore.clear();
    getAllReturn = [];
    nextId = 1;
});

describe('offlineStore', () => {
    it('queueIncident stores item with status pending', async () => {
        await queueIncident({ description: 'Fire at building', lat: 14.5 });
        const pending = await getPendingIncidents();
        expect(pending).toHaveLength(1);
        expect(pending[0].status).toBe('pending');
        expect(pending[0].payload.description).toBe('Fire at building');
    });

    it('queueIncident preserves op type metadata for validator sync', async () => {
        await queueIncident(
            { incident_id: 42, action: 'accept', notes: null },
            { opType: 'verify', localId: 'verify-client-id' }
        );

        const pending = await getPendingIncidents();

        expect(pending).toHaveLength(1);
        expect(pending[0].opType).toBe('verify');
        expect(pending[0].localId).toBe('verify-client-id');
        expect(pending[0].payload).toEqual({ incident_id: 42, action: 'accept', notes: null });
    });

    it('getPendingIncidents returns only pending items', async () => {
        await queueIncident({ description: 'Incident 1' });
        await queueIncident({ description: 'Incident 2' });
        const pending = await getPendingIncidents();
        expect(pending).toHaveLength(2);
        expect(pending.every(i => i.status === 'pending')).toBe(true);
    });

    it('markSynced removes item from store', async () => {
        await queueIncident({ description: 'To sync' });
        const pending = await getPendingIncidents();
        await markSynced(pending[0].id!);
        const after = await getPendingIncidents();
        expect(after).toHaveLength(0);
    });

    it('payload is encrypted at rest', async () => {
        await queueIncident({ description: 'Secret fire data', lat: 14.5, lon: 120.9 });
        const rawRecord = store.get(1) as
            | { encrypted: { iv: unknown[]; data: unknown[] }; payload?: unknown }
            | undefined;
        expect(rawRecord).toBeDefined();
        expect(rawRecord).toHaveProperty('encrypted');
        expect(rawRecord!.encrypted).toHaveProperty('iv');
        expect(rawRecord!.encrypted).toHaveProperty('data');
        expect(Array.isArray(rawRecord!.encrypted.iv)).toBe(true);
        expect(Array.isArray(rawRecord!.encrypted.data)).toBe(true);
        expect(rawRecord!.payload).toBeUndefined();
        expect(JSON.stringify(rawRecord).includes('Secret fire data')).toBe(false);
    });

    it('getPendingIncidents returns decrypted payload', async () => {
        const originalPayload = { description: 'Test incident', lat: 15.1, lon: 121.3 };
        await queueIncident(originalPayload);
        const pending = await getPendingIncidents();
        expect(pending).toHaveLength(1);
        expect(pending[0].payload).toEqual(originalPayload);
    });

    it('updateQueuedIncident re-encrypts updated payload', async () => {
        await queueIncident({ description: 'Original' });
        await updateQueuedIncident(1, { description: 'Updated description', lat: 16.0 });
        const pending = await getPendingIncidents();
        expect(pending[0].payload.description).toBe('Updated description');
        const rawRecord = store.get(1) as
            | { encrypted: { iv: unknown[]; data: unknown[] }; payload?: unknown }
            | undefined;
        expect(rawRecord).toHaveProperty('encrypted');
        expect(rawRecord!.payload).toBeUndefined();
    });

    it('getQueuedIncident returns decrypted payload', async () => {
        const originalPayload = { description: 'Queued incident', lat: 14.0 };
        await queueIncident(originalPayload);
        const item = await getQueuedIncident(1);
        expect(item).toBeDefined();
        expect(item!.payload).toEqual(originalPayload);
    });

    it('deleteQueuedIncident removes record', async () => {
        await queueIncident({ description: 'To delete' });
        await deleteQueuedIncident(1);
        const pending = await getPendingIncidents();
        expect(pending).toHaveLength(0);
    });
});
