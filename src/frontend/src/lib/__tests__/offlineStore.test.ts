/**
 * offlineStore tests — verifies existing IndexedDB queue operations.
 *
 * These tests confirm the foundation that syncEngine will consume.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory store backing the idb mock
const store = new Map<number, { id: number; payload: Record<string, unknown>; createdAt: number; status: 'pending' | 'synced' }>();
let nextId = 1;

function makeDbMock() {
  return {
    add: vi.fn((_s: string, item: Record<string, unknown>) => {
      const id = nextId++;
      store.set(id, { ...(item as Omit<typeof store extends Map<number, infer V> ? V : never, 'id'>), id } as typeof store extends Map<number, infer V> ? V : never);
      return Promise.resolve(id);
    }),
    get: vi.fn((_s: string, id: number) => Promise.resolve(store.get(id))),
    getAll: vi.fn(() => Promise.resolve(Array.from(store.values()))),
    delete: vi.fn((_s: string, id: number) => { store.delete(id); return Promise.resolve(); }),
    transaction: vi.fn(() => ({
      objectStore: vi.fn(() => ({
        get: vi.fn((id: number) => Promise.resolve(store.get(id))),
        put: vi.fn((item: { id: number }) => {
          store.set(item.id, item as typeof store extends Map<number, infer V> ? V : never);
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

// Must import AFTER mock
const { queueIncident, getPendingIncidents, markSynced, getQueuedIncident, updateQueuedIncident, deleteQueuedIncident } = await import('../offlineStore');

beforeEach(() => {
  store.clear();
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

  it('getQueuedIncident returns the queued item by id', async () => {
    await queueIncident({ description: 'Draft incident' });
    const pending = await getPendingIncidents();
    const item = await getQueuedIncident(pending[0].id!);
    expect(item).not.toBeUndefined();
    expect(item!.payload.description).toBe('Draft incident');
    expect(item!.status).toBe('pending');
  });

  it('updateQueuedIncident changes payload, preserves id + status=pending', async () => {
    await queueIncident({ description: 'Original' });
    const pending = await getPendingIncidents();
    const id = pending[0].id!;
    await updateQueuedIncident(id, { description: 'Updated', lat: 40.7128 });
    const updated = await getQueuedIncident(id);
    expect(updated).not.toBeUndefined();
    expect(updated!.payload.description).toBe('Updated');
    expect(updated!.payload.lat).toBe(40.7128);
    expect(updated!.id).toBe(id);
    expect(updated!.status).toBe('pending');
  });

  it('updateQueuedIncident throws when item is already synced', async () => {
    await queueIncident({ description: 'To sync' });
    const pending = await getPendingIncidents();
    const id = pending[0].id!;
    await markSynced(id);
    await expect(updateQueuedIncident(id, { description: 'Should fail' })).rejects.toThrow('not found');
  });

  it('deleteQueuedIncident removes the item', async () => {
    await queueIncident({ description: 'To delete' });
    const pending = await getPendingIncidents();
    const id = pending[0].id!;
    await deleteQueuedIncident(id);
    const result = await getQueuedIncident(id);
    expect(result).toBeUndefined();
  });
});
