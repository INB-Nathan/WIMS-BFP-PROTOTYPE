/**
 * syncEngine tests — core sync logic (3B) + conflict resolution (3F).
 *
 * Expected behavior:
 * - Reads pending items from offlineStore
 * - POSTs each to the correct API endpoint
 * - On 2xx: marks item synced
 * - On 4xx/5xx: increments retryCount, keeps item pending
 * - On 409 Conflict: applies last-write-wins resolution
 * - Returns { synced, failed, errors }
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock offlineStore
vi.mock('../offlineStore', () => ({
  getPendingIncidents: vi.fn(),
  markSynced: vi.fn(),
}));

// Mock fetch
const fetchSpy = vi.fn();
vi.stubGlobal('fetch', fetchSpy);

import { syncPendingIncidents } from '../syncEngine';
import { getPendingIncidents, markSynced } from '../offlineStore';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('syncPendingIncidents', () => {
  it('returns { synced: 0, failed: 0 } when no pending items', async () => {
    vi.mocked(getPendingIncidents).mockResolvedValue([]);

    const result = await syncPendingIncidents();

    expect(result.synced).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('syncs a single pending item via POST and marks it synced on 2xx', async () => {
    vi.mocked(getPendingIncidents).mockResolvedValue([
      { id: 1, payload: { description: 'Fire', lat: 14.5, lng: 121.0 }, createdAt: Date.now(), status: 'pending' },
    ]);
    fetchSpy.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({ report_id: 10 }) });
    vi.mocked(markSynced).mockResolvedValue(undefined);

    const result = await syncPendingIncidents();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
    expect(markSynced).toHaveBeenCalledWith(1);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('syncs multiple pending items in sequence', async () => {
    vi.mocked(getPendingIncidents).mockResolvedValue([
      { id: 1, payload: { description: 'A' }, createdAt: Date.now(), status: 'pending' },
      { id: 2, payload: { description: 'B' }, createdAt: Date.now(), status: 'pending' },
      { id: 3, payload: { description: 'C' }, createdAt: Date.now(), status: 'pending' },
    ]);
    fetchSpy.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({}) });
    vi.mocked(markSynced).mockResolvedValue(undefined);

    const result = await syncPendingIncidents();

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(markSynced).toHaveBeenCalledTimes(3);
    expect(result.synced).toBe(3);
    expect(result.failed).toBe(0);
  });

  it('on 400/500 failure: does NOT markSynced, reports failure', async () => {
    vi.mocked(getPendingIncidents).mockResolvedValue([
      { id: 1, payload: { description: 'Bad data' }, createdAt: Date.now(), status: 'pending' },
    ]);
    fetchSpy.mockResolvedValue({
      ok: false, status: 422,
      json: () => Promise.resolve({ detail: 'Validation error' }),
    });

    const result = await syncPendingIncidents();

    expect(markSynced).not.toHaveBeenCalled();
    expect(result.synced).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].status).toBe(422);
  });

  it('partial batch: some succeed, some fail — counts are correct', async () => {
    vi.mocked(getPendingIncidents).mockResolvedValue([
      { id: 1, payload: { description: 'Good' }, createdAt: Date.now(), status: 'pending' },
      { id: 2, payload: { description: 'Bad' }, createdAt: Date.now(), status: 'pending' },
      { id: 3, payload: { description: 'Good2' }, createdAt: Date.now(), status: 'pending' },
    ]);
    fetchSpy
      .mockResolvedValueOnce({ ok: true, status: 201, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ detail: 'Server error' }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: () => Promise.resolve({}) });
    vi.mocked(markSynced).mockResolvedValue(undefined);

    const result = await syncPendingIncidents();

    expect(result.synced).toBe(2);
    expect(result.failed).toBe(1);
    expect(markSynced).toHaveBeenCalledWith(1);
    expect(markSynced).toHaveBeenCalledWith(3);
    expect(markSynced).not.toHaveBeenCalledWith(2);
  });

  it('on 409 Conflict: applies last-write-wins resolution (local wins)', async () => {
    vi.mocked(getPendingIncidents).mockResolvedValue([
      { id: 1, payload: { description: 'Conflict item', lat: 14.5 }, createdAt: new Date('2030-01-01').getTime(), status: 'pending' },
    ]);
    // First call: 409 Conflict
    fetchSpy.mockResolvedValueOnce({
      ok: false, status: 409,
      json: () => Promise.resolve({
        detail: 'Conflict',
        server_updated_at: '2026-04-12T10:00:00Z',
        server_data: { description: 'Server version' },
      }),
    });
    // Second call (LWW overwrite): succeeds
    fetchSpy.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({ resolved: true }),
    });
    vi.mocked(markSynced).mockResolvedValue(undefined);

    const result = await syncPendingIncidents();

    // Should attempt resolution retry
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // After resolution, should mark synced
    expect(result.synced).toBe(1);
  });

  it('on 409 Conflict where server wins: does NOT overwrite, keeps pending', async () => {
    vi.mocked(getPendingIncidents).mockResolvedValue([
      { id: 1, payload: { description: 'Old local' }, createdAt: 500, status: 'pending' },
    ]);
    // 409 with server timestamp newer than local createdAt
    fetchSpy.mockResolvedValueOnce({
      ok: false, status: 409,
      json: () => Promise.resolve({
        detail: 'Conflict',
        server_updated_at: '2026-12-31T23:59:59Z', // far future — server wins
        server_data: { description: 'Newer server version' },
      }),
    });

    const result = await syncPendingIncidents();

    // Server wins — do not overwrite, keep pending
    expect(markSynced).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.errors[0].status).toBe(409);
  });

  it('sends payload as JSON body with Content-Type header', async () => {
    vi.mocked(getPendingIncidents).mockResolvedValue([
      { id: 1, payload: { description: 'Test', lat: 14.0 }, createdAt: Date.now(), status: 'pending' },
    ]);
    fetchSpy.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({}) });
    vi.mocked(markSynced).mockResolvedValue(undefined);

    await syncPendingIncidents();

    const [, options] = fetchSpy.mock.calls[0];
    expect(options.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(options.body);
    expect(body.description).toBe('Test');
    expect(body.lat).toBe(14.0);
  });

  it('uses /api/v1/public/report endpoint for civilian payloads', async () => {
    vi.mocked(getPendingIncidents).mockResolvedValue([
      { id: 1, payload: { description: 'Public report' }, createdAt: Date.now(), status: 'pending' },
    ]);
    fetchSpy.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({}) });
    vi.mocked(markSynced).mockResolvedValue(undefined);

    await syncPendingIncidents();

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/public\/report/);
  });

  it('network error during sync: reports failure, does not crash', async () => {
    vi.mocked(getPendingIncidents).mockResolvedValue([
      { id: 1, payload: { description: 'Network fail' }, createdAt: Date.now(), status: 'pending' },
    ]);
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await syncPendingIncidents();

    expect(result.synced).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0].error).toMatch(/Failed to fetch/);
  });
});
