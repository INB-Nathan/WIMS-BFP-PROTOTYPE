/**
 * offlineStore tests — verifies IndexedDB queue operations with AES-256-GCM encryption.
 *
 * These tests confirm the foundation that syncEngine will consume.
 * Payload encryption is transparent: queueIncident encrypts on write,
 * getPendingIncidents/getQueuedIncident decrypt on read.
 *
 * Uses fake-indexeddb instead of a Map-backed mock so real transaction
 * semantics (readonly vs readwrite, version upgrades, object store creation)
 * are exercised in CI as they would be in the browser.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';

if (!globalThis.crypto) {
    (globalThis as Record<string, unknown>).crypto = webcrypto;
}

// ─── Constants matching offlineStore.ts ──────────────────────────────────────
const DB_NAME = 'wims-bfp-db';
const DB_VERSION = 4;
const STORE_NAME = 'incident-queue';

// ─── Local type for raw IndexedDB records (not exported from offlineStore.ts) ─
interface RawRecord {
    id?: number;
    opType?: string;
    localId?: string;
    encrypted: { iv: number[]; data: number[] };
    createdAt: number;
    status: string;
}

// ─── Helper: read a raw record directly from fake IndexedDB ──────────────────
async function getRawRecord(id: number): Promise<RawRecord | undefined> {
    const db = await openDB(DB_NAME, DB_VERSION);
    try {
        return (await db.get(STORE_NAME, id)) as RawRecord | undefined;
    } finally {
        db.close();
    }
}

// ─── Fresh fake IndexedDB factory per test ────────────────────────────────────
beforeEach(() => {
    globalThis.indexedDB = new (IDBFactory as unknown as new () => IDBFactory)();
});

// Import AFTER beforeEach registration — the offlineStore module calls openDB
// lazily (not at import time), so the fresh factory is active when each test runs.
const {
    queueIncident,
    getPendingIncidents,
    getQueuedIncident,
    updateQueuedIncident,
    markSynced,
    deleteQueuedIncident,
    initOfflineStorageLimit,
} = await import('../offlineStore');

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
        const rawRecord = await getRawRecord(1);
        expect(rawRecord).toBeDefined();
        expect(rawRecord).toHaveProperty('encrypted');
        expect(rawRecord!.encrypted).toHaveProperty('iv');
        expect(rawRecord!.encrypted).toHaveProperty('data');
        expect(Array.isArray(rawRecord!.encrypted.iv)).toBe(true);
        expect(Array.isArray(rawRecord!.encrypted.data)).toBe(true);
        expect((rawRecord as unknown as Record<string, unknown>).payload).toBeUndefined();
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
        const rawRecord = await getRawRecord(1);
        expect(rawRecord).toHaveProperty('encrypted');
        expect((rawRecord as unknown as Record<string, unknown>).payload).toBeUndefined();
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

    // ── PR #272 review S3: cap enforcement works regardless of console.warn gate (#275) ──
    it('throws when encrypted total exceeds advisory storage cap', async () => {
        // Fill the store with one item at the default cap.
        await queueIncident({ description: 'fill' });
        // Lower cap to a tiny value so the existing encrypted bytes exceed it.
        initOfflineStorageLimit(0.00001);
        await expect(queueIncident({ description: 'burst' })).rejects.toThrow(
            'Offline storage cap reached'
        );
        // Reset cap so subsequent tests are not affected.
        initOfflineStorageLimit(50);
    });
});
