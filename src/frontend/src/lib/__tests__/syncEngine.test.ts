/**
 * syncEngine tests — regional encoder offline sync (FR-3B, FR-3F).
 *
 * Covers:
 * - Empty queue returns zero counts
 * - Successful create → markOpSynced + cacheIncident
 * - Successful batch: multiple ops processed in sequence
 * - 4xx error: markOpError, continue to next op
 * - 409 conflict: markOpConflict, report conflict count
 * - Network error (status 0): abort batch, markOpError
 * - Auth refresh failure: abortReason = 'auth'
 * - Offline check: abortReason = 'offline'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock offlineStore (new ops API) ──────────────────────────────────────────
vi.mock('../offlineStore', () => ({
  getPendingOps: vi.fn(),
  markOpSyncing: vi.fn(),
  markOpSynced: vi.fn(),
  markOpConflict: vi.fn(),
  markOpError: vi.fn(),
  deleteOfflineOp: vi.fn(),
  purgeSyncedOps: vi.fn(),
  evictStaleCachedIncidents: vi.fn(),
  cacheIncident: vi.fn(),
}));

// ── Mock auth-refresh ────────────────────────────────────────────────────────
vi.mock('../auth-refresh', () => ({
  refreshToken: vi.fn(),
}));

// ── Mock fetch ───────────────────────────────────────────────────────────────
const fetchSpy = vi.fn();
vi.stubGlobal('fetch', fetchSpy);

import { syncPendingIncidents } from '../syncEngine';
import type { OfflineOpType, OfflineOpDecrypted } from '../offlineStore';
import {
  getPendingOps, markOpSyncing, markOpSynced, markOpConflict, markOpError,
  purgeSyncedOps, evictStaleCachedIncidents, cacheIncident,
} from '../offlineStore';
import { refreshToken } from '../auth-refresh';

const ENCODER_ID = 'encoder-uuid-123';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeOp(overrides: Partial<Record<string, any>> = {}): OfflineOpDecrypted {
  return {
    localId: overrides.localId ?? 'op-1',
    operation: (overrides.operation ?? 'create') as OfflineOpType,
    serverId: overrides.serverId ?? null,
    linkedLocalId: overrides.linkedLocalId ?? null,
    serverUpdatedAt: overrides.serverUpdatedAt ?? null,
    regionId: overrides.regionId ?? 1,
    encoderId: overrides.encoderId ?? ENCODER_ID,
    payload: overrides.payload ?? { latitude: 14.5, longitude: 121.0 },
    createdAt: overrides.createdAt ?? Date.now(),
    syncStatus: overrides.syncStatus ?? 'pending',
    errorCode: overrides.errorCode ?? null,
    errorMessage: overrides.errorMessage ?? null,
    serverVersion: overrides.serverVersion ?? null,
    retryCount: overrides.retryCount ?? 0,
    lastAttemptAt: overrides.lastAttemptAt ?? null,
  } as unknown as OfflineOpDecrypted;
}


beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(refreshToken).mockResolvedValue({ ok: true });
  vi.mocked(markOpSyncing).mockResolvedValue(undefined);
  vi.mocked(markOpSynced).mockResolvedValue(undefined);
  vi.mocked(markOpConflict).mockResolvedValue(undefined);
  vi.mocked(markOpError).mockResolvedValue(undefined);
  vi.mocked(purgeSyncedOps).mockResolvedValue(undefined);
  vi.mocked(evictStaleCachedIncidents).mockResolvedValue(undefined);
  vi.mocked(cacheIncident).mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('syncPendingIncidents', () => {
  it('returns zero counts when queue is empty', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([]);

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(result.synced).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.conflicts).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('aborts with abortReason=offline when navigator.onLine is false', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(result.abortReason).toBe('offline');
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it('aborts with abortReason=auth when token refresh fails', async () => {
    vi.mocked(refreshToken).mockResolvedValue({ ok: false, reason: 'auth' });
    vi.mocked(getPendingOps).mockResolvedValue([makeOp()]);

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(result.abortReason).toBe('auth');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('syncs a create op: POSTs the bundle envelope to upload-bundle with credentials', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([makeOp()]);
    fetchSpy.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ status: 'ok', incident_ids: [42], failed: [] }),
    });

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('/api/incidents/upload-bundle');
    expect(opts.method).toBe('POST');
    expect(opts.credentials).toBe('include');
    const body = JSON.parse(opts.body);
    // Bundle envelope: { region_id, incidents: [{ ...payload, client_id }] }
    expect(Array.isArray(body.incidents)).toBe(true);
    expect(body.incidents[0].client_id).toBe('op-1');
    expect(markOpSynced).toHaveBeenCalledWith('op-1', 42);
    expect(cacheIncident).toHaveBeenCalledWith(42, expect.any(Object), ENCODER_ID);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('marks create error when bundle imports nothing (no incident id returned)', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([makeOp({ localId: 'op-empty' })]);
    fetchSpy.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ status: 'ok', incident_ids: [], failed: [{ index: 1, reason: 'bad row' }] }),
    });

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(markOpSynced).not.toHaveBeenCalled();
    expect(markOpError).toHaveBeenCalledWith('op-empty', '4xx', 'bad row');
    expect(result.synced).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('processes multiple ops sequentially', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({ localId: 'op-a' }),
      makeOp({ localId: 'op-b' }),
    ]);
    fetchSpy.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ incident_ids: [99], failed: [] }),
    });

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(markOpSynced).toHaveBeenCalledWith('op-a', 99);
    expect(markOpSynced).toHaveBeenCalledWith('op-b', 99);
    expect(result.synced).toBe(2);
  });

  it('on 4xx error: marks error, continues to next op', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({ localId: 'op-bad' }),
      makeOp({ localId: 'op-good' }),
    ]);
    fetchSpy
      .mockResolvedValueOnce({ ok: false, status: 422, json: () => Promise.resolve({ detail: 'Validation error' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ incident_ids: [77], failed: [] }) });

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(markOpError).toHaveBeenCalledWith('op-bad', '4xx', 'Validation error');
    expect(markOpSynced).toHaveBeenCalledWith('op-good', 77);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].localId).toBe('op-bad');
  });

  it('on 409 conflict (OCC): marks conflict, increments conflicts count', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([makeOp()]);
    fetchSpy.mockResolvedValue({
      ok: false, status: 409,
      json: () => Promise.resolve({ detail: 'Conflict', server_version: { incident_id: 1 } }),
    });

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(markOpConflict).toHaveBeenCalledWith('op-1', '409_conflict', expect.any(Object));
    expect(result.conflicts).toBe(1);
    expect(result.synced).toBe(0);
  });

  it('on network error (status 0): marks error, aborts batch', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({ localId: 'op-net' }),
      makeOp({ localId: 'op-next' }),
    ]);
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await syncPendingIncidents(ENCODER_ID);

    // Only first op attempted, second skipped (batch aborted)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(markOpError).toHaveBeenCalledWith('op-net', 'network', expect.any(String));
    expect(result.failed).toBe(1);
    expect(result.synced).toBe(0);
  });

  it('calls purgeSyncedOps and evictStaleCachedIncidents after syncing', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([makeOp()]);
    fetchSpy.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ incident_ids: [5], failed: [] }),
    });

    await syncPendingIncidents(ENCODER_ID);

    expect(purgeSyncedOps).toHaveBeenCalled();
    expect(evictStaleCachedIncidents).toHaveBeenCalledWith(ENCODER_ID);
  });

  it('skips op that has hit MAX_RETRY (retryCount >= 5)', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({ localId: 'op-maxed', retryCount: 5 }),
    ]);

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.errors[0].error).toMatch(/max retries/);
  });
});

describe('op-type dispatch — verify ops', () => {
  it('dispatches verify op to PATCH /regional/incidents/{id}/verification with client_id from localId', async () => {
    const localId = 'verify-op-uuid-abc123';
    const incidentId = 42;

    vi.mocked(getPendingIncidents).mockResolvedValue([
      {
        id: 1,
        opType: 'verify',
        localId,
        payload: {
          incident_id: incidentId,
          action: 'accept',
          notes: 'Looks good',
        },
        createdAt: Date.now(),
        status: 'pending',
      },
    ]);

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ previous_status: 'PENDING_VALIDATION', new_status: 'VERIFIED' }),
    });
    vi.mocked(markSynced).mockResolvedValue(undefined);

    const result = await syncPendingIncidents();

    // 1. Must dispatch to the verification endpoint (not /api/v1/public/report)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/regional\/incidents\/42\/verification/);

    // 2. Method must be PATCH (verification endpoint uses PATCH, not POST)
    expect(options.method).toBe('PATCH');

    // 3. Body must include client_id mapped from the op's localId
    const body = JSON.parse(options.body as string);
    expect(body.client_id).toBe(localId);
    expect(body.action).toBe('accept');
    expect(body.notes).toBe('Looks good');

    // 4. Auth: must use cookie-based auth (credentials: 'include')
    expect(options.credentials).toBe('include');

    // 5. Successful sync marks the item synced
    expect(markSynced).toHaveBeenCalledWith(1);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('409 DUPLICATE_DETECTED on verify keeps op pending, does not markSynced', async () => {
    vi.mocked(getPendingIncidents).mockResolvedValue([
      {
        id: 1,
        opType: 'verify',
        localId: 'dup-uuid',
        payload: { incident_id: 99, action: 'accept', notes: null },
        createdAt: Date.now(),
        status: 'pending',
      },
    ]);

    fetchSpy.mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ detail: 'Incident already in VERIFIED status' }),
    });

    const result = await syncPendingIncidents();

    expect(markSynced).not.toHaveBeenCalled();
    expect(result.synced).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0].status).toBe(409);
    expect(result.errors[0].error).toMatch(/DUPLICATE_DETECTED/);
  });
});

describe('op-type dispatch — archive_action ops', () => {
  it('dispatches archive action to PATCH /regional/validator/incidents/{id}/archive with client_id', async () => {
    const localId = 'archive-op-uuid-xyz';

    vi.mocked(getPendingIncidents).mockResolvedValue([
      {
        id: 1,
        opType: 'archive_action',
        localId,
        payload: { incident_id: 55, action: 'archive' },
        createdAt: Date.now(),
        status: 'pending',
      },
    ]);

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'already_applied', incident_id: 55 }),
    });
    vi.mocked(markSynced).mockResolvedValue(undefined);

    const result = await syncPendingIncidents();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/regional\/validator\/incidents\/55\/archive/);
    expect(options.method).toBe('PATCH');
    expect(options.credentials).toBe('include');

    const body = JSON.parse(options.body as string);
    expect(body.client_id).toBe(localId);

    expect(markSynced).toHaveBeenCalledWith(1);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('dispatches unarchive action to PATCH .../unarchive endpoint', async () => {
    vi.mocked(getPendingIncidents).mockResolvedValue([
      {
        id: 1,
        opType: 'archive_action',
        localId: 'unarchive-uuid',
        payload: { incident_id: 77, action: 'unarchive' },
        createdAt: Date.now(),
        status: 'pending',
      },
    ]);

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'already_applied', incident_id: 77 }),
    });
    vi.mocked(markSynced).mockResolvedValue(undefined);

    const result = await syncPendingIncidents();

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/regional\/validator\/incidents\/77\/unarchive/);
    expect(result.synced).toBe(1);
  });
});

describe('backward compatibility — legacy items (no opType)', () => {
  it('items without opType still POST to /api/v1/public/report (legacy)', async () => {
    vi.mocked(getPendingIncidents).mockResolvedValue([
      { id: 1, payload: { description: 'Legacy public report' }, createdAt: Date.now(), status: 'pending' },
    ]);
    fetchSpy.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({ report_id: 42 }) });
    vi.mocked(markSynced).mockResolvedValue(undefined);

    const result = await syncPendingIncidents();

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/public\/report/);
    expect(options.method).toBe('POST');
    expect(result.synced).toBe(1);
  });
});

describe('network error abort', () => {
  it('network error on first of multiple items aborts remaining batch', async () => {
    vi.mocked(getPendingIncidents).mockResolvedValue([
      { id: 1, opType: 'verify', localId: 'a', payload: { incident_id: 1, action: 'accept' }, createdAt: Date.now(), status: 'pending' },
      { id: 2, opType: 'verify', localId: 'b', payload: { incident_id: 2, action: 'pending' }, createdAt: Date.now(), status: 'pending' },
      { id: 3, opType: 'verify', localId: 'c', payload: { incident_id: 3, action: 'reject' }, createdAt: Date.now(), status: 'pending' },
    ]);

    // First call: network error
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await syncPendingIncidents();

    // Only the first item should have been attempted
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0].error).toMatch(/Failed to fetch/);
    // Remaining two items preserved (not attempted)
    expect(markSynced).not.toHaveBeenCalled();
  });

  it('HTTP error on first item does NOT abort — continues to next', async () => {
    vi.mocked(getPendingIncidents).mockResolvedValue([
      { id: 1, opType: 'verify', localId: 'a', payload: { incident_id: 1, action: 'accept' }, createdAt: Date.now(), status: 'pending' },
      { id: 2, opType: 'verify', localId: 'b', payload: { incident_id: 2, action: 'accept' }, createdAt: Date.now(), status: 'pending' },
    ]);

    fetchSpy
      .mockResolvedValueOnce({ ok: false, status: 422, json: () => Promise.resolve({ detail: 'Validation error' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) });
    vi.mocked(markSynced).mockResolvedValue(undefined);

    const result = await syncPendingIncidents();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    expect(markSynced).toHaveBeenCalledWith(2);
    expect(markSynced).not.toHaveBeenCalledWith(1);
  });
});
