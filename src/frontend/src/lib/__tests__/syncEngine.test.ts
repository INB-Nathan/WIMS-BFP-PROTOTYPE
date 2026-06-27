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
  getPendingIncidents: vi.fn(),
  markSynced: vi.fn(),
  markOpSyncing: vi.fn(),
  markOpPending: vi.fn(),
  markOpSynced: vi.fn(),
  markOpConflict: vi.fn(),
  markOpError: vi.fn(),
  markOpFailed: vi.fn(),
  deleteOfflineOp: vi.fn(),
  purgeSyncedOps: vi.fn(),
  evictStaleCachedIncidents: vi.fn(),
  cacheIncident: vi.fn(),
  getCachedIncident: vi.fn(() => Promise.resolve(undefined)),
}));

// ── Mock auth-refresh ────────────────────────────────────────────────────────
vi.mock('../auth-refresh', () => ({
  refreshToken: vi.fn(),
}));

vi.mock('../connectivity', () => ({
  isReachable: vi.fn(),
  markConnectivityOffline: vi.fn(),
}));

// ── Mock fetch ───────────────────────────────────────────────────────────────
const fetchSpy = vi.fn();
vi.stubGlobal('fetch', fetchSpy);

import { syncPendingIncidents, computeBackoffDelay, isWithinBackoffWindow } from '../syncEngine';
import type { OfflineOpType, OfflineOpDecrypted } from '../offlineStore';
import {
  getPendingOps, getPendingIncidents, markSynced, markOpSyncing, markOpPending, markOpSynced, markOpConflict, markOpError, markOpFailed,
  purgeSyncedOps, evictStaleCachedIncidents, cacheIncident,
} from '../offlineStore';
import { refreshToken } from '../auth-refresh';
import { isReachable, markConnectivityOffline } from '../connectivity';

const ENCODER_ID = 'encoder-uuid-123';

const sessionOkResponse = {
  ok: true,
  status: 200,
  json: () => Promise.resolve({ user: { id: ENCODER_ID } }),
  text: () => Promise.resolve(JSON.stringify({ user: { id: ENCODER_ID } })),
};

function mockSessionOkWithApiResponses(...responses: Array<Record<string, unknown>>) {
  const queue = [...responses];
  fetchSpy.mockImplementation((url: string) => {
    if (url === '/api/auth/session') return Promise.resolve(sessionOkResponse);
    if (url === '/api/admin/sync/report') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'logged' }), text: () => Promise.resolve(JSON.stringify({ status: 'logged' })) });
    }
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected fetch call: ${url}`);
    return Promise.resolve(next);
  });
}

function mockSessionStatus(status: number) {
  fetchSpy.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve('{}'),
  });
}

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
  vi.mocked(isReachable).mockResolvedValue(true);
  vi.mocked(refreshToken).mockResolvedValue({ ok: true });
  vi.mocked(getPendingIncidents).mockResolvedValue([]);
  vi.mocked(markSynced).mockResolvedValue(undefined);
  vi.mocked(markOpSyncing).mockResolvedValue(undefined);
  vi.mocked(markOpPending).mockResolvedValue(undefined);
  vi.mocked(markOpSynced).mockResolvedValue(undefined);
  vi.mocked(markOpConflict).mockResolvedValue(undefined);
  vi.mocked(markOpError).mockResolvedValue(undefined);
  vi.mocked(markOpFailed).mockResolvedValue(undefined);
  vi.mocked(purgeSyncedOps).mockResolvedValue(undefined);
  vi.mocked(evictStaleCachedIncidents).mockResolvedValue(undefined);
  vi.mocked(cacheIncident).mockResolvedValue(undefined);
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

  it('calls onProgress callback for each op during sync', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({ localId: 'op-1', operation: 'create' }),
      makeOp({ localId: 'op-2', operation: 'create' }),
    ]);
    mockSessionOkWithApiResponses(
      { ok: true, status: 200, json: () => Promise.resolve({ status: 'ok', incident_ids: [42], failed: [] }), text: () => Promise.resolve(JSON.stringify({ status: 'ok', incident_ids: [42], failed: [] })) },
      { ok: true, status: 200, json: () => Promise.resolve({ status: 'ok', incident_ids: [43], failed: [] }), text: () => Promise.resolve(JSON.stringify({ status: 'ok', incident_ids: [43], failed: [] })) },
    );

    const progressCalls: Array<{ done: number; total: number; currentOperation?: string }> = [];
    const onProgress = (p: { done: number; total: number; currentOperation?: string }) => {
      progressCalls.push(p);
    };

    const result = await syncPendingIncidents(ENCODER_ID, { onProgress });

    expect(result.synced).toBe(2);
    expect(progressCalls.length).toBeGreaterThanOrEqual(2);
    // First call should be done=1, total=2
    expect(progressCalls[0].done).toBe(1);
    expect(progressCalls[0].total).toBe(2);
    // Last call should have done=total
    expect(progressCalls[progressCalls.length - 1].done).toBe(progressCalls[progressCalls.length - 1].total);
  });

  it('aborts with abortReason=offline when app reachability check fails', async () => {
    vi.mocked(isReachable).mockResolvedValue(false);

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(result.abortReason).toBe('offline');
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it('aborts with abortReason=auth when token refresh fails', async () => {
    vi.mocked(refreshToken).mockResolvedValue({ ok: false, reason: 'auth' });
    vi.mocked(getPendingOps).mockResolvedValue([makeOp()]);
    mockSessionStatus(401);

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(result.abortReason).toBe('auth');
    expect(refreshToken).toHaveBeenCalledTimes(1);
  });

  it('uses an active access session without requiring refresh before sync', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([makeOp()]);
    mockSessionOkWithApiResponses({
      ok: true, status: 200,
      json: () => Promise.resolve({ status: 'ok', incident_ids: [42], failed: [] }), text: () => Promise.resolve(JSON.stringify({ status: 'ok', incident_ids: [42], failed: [] })),
    });

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(refreshToken).not.toHaveBeenCalled();
    expect(result.synced).toBe(1);
  });

  it('syncs a create op: POSTs the bundle envelope to upload-bundle with credentials', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([makeOp()]);
    mockSessionOkWithApiResponses({
      ok: true, status: 200,
      json: () => Promise.resolve({ status: 'ok', incident_ids: [42], failed: [] }), text: () => Promise.resolve(JSON.stringify({ status: 'ok', incident_ids: [42], failed: [] })),
    });

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, opts] = fetchSpy.mock.calls[1];
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
    mockSessionOkWithApiResponses({
      ok: true, status: 200,
      json: () => Promise.resolve({ status: 'ok', incident_ids: [], failed: [{ index: 1, reason: 'bad row' }] }), text: () => Promise.resolve(JSON.stringify({ status: 'ok', incident_ids: [], failed: [{ index: 1, reason: 'bad row' }] })),
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
    mockSessionOkWithApiResponses(
      {
        ok: true, status: 200,
        json: () => Promise.resolve({ incident_ids: [99], failed: [] }), text: () => Promise.resolve(JSON.stringify({ incident_ids: [99], failed: [] })),
      },
      {
        ok: true, status: 200,
        json: () => Promise.resolve({ incident_ids: [99], failed: [] }), text: () => Promise.resolve(JSON.stringify({ incident_ids: [99], failed: [] })),
      }
    );

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(markOpSynced).toHaveBeenCalledWith('op-a', 99);
    expect(markOpSynced).toHaveBeenCalledWith('op-b', 99);
    expect(result.synced).toBe(2);
  });

  it('on 4xx error: marks error, continues to next op', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({ localId: 'op-bad' }),
      makeOp({ localId: 'op-good' }),
    ]);
    mockSessionOkWithApiResponses(
      { ok: false, status: 422, json: () => Promise.resolve({ detail: 'Validation error' }), text: () => Promise.resolve(JSON.stringify({ detail: 'Validation error' })) },
      { ok: true, status: 200, json: () => Promise.resolve({ incident_ids: [77], failed: [] }), text: () => Promise.resolve(JSON.stringify({ incident_ids: [77], failed: [] })) }
    );

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
    mockSessionOkWithApiResponses({
      ok: false, status: 409,
      json: () => Promise.resolve({ detail: 'Conflict', server_version: { incident_id: 1 } }), text: () => Promise.resolve(JSON.stringify({ detail: 'Conflict', server_version: { incident_id: 1 } })),
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
    fetchSpy.mockImplementation((url: string) => {
      if (url === '/api/auth/session') return Promise.resolve(sessionOkResponse);
      return Promise.reject(new TypeError('Failed to fetch'));
    });

    const result = await syncPendingIncidents(ENCODER_ID);

    // Only first op attempted, second skipped (batch aborted)
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(markOpError).toHaveBeenCalledWith('op-net', 'network', expect.any(String));
    expect(markConnectivityOffline).toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.synced).toBe(0);
  });

  it('on 401 during replay: restores op to pending and aborts for login', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({ localId: 'op-auth' }),
      makeOp({ localId: 'op-next' }),
    ]);
    mockSessionOkWithApiResponses({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ detail: 'Not authenticated' }), text: () => Promise.resolve(JSON.stringify({ detail: 'Not authenticated' })),
    });

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(markOpPending).toHaveBeenCalledWith(
      'op-auth',
      'Session expired before this operation could sync.'
    );
    expect(markOpError).not.toHaveBeenCalled();
    expect(result.abortReason).toBe('auth');
    expect(result.synced).toBe(0);
  });

  it('calls purgeSyncedOps and evictStaleCachedIncidents after syncing', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([makeOp()]);
    mockSessionOkWithApiResponses({
      ok: true, status: 200,
      json: () => Promise.resolve({ incident_ids: [5], failed: [] }), text: () => Promise.resolve(JSON.stringify({ incident_ids: [5], failed: [] })),
    });

    await syncPendingIncidents(ENCODER_ID);

    expect(purgeSyncedOps).toHaveBeenCalled();
    expect(evictStaleCachedIncidents).toHaveBeenCalledWith(ENCODER_ID);
  });

  it('skips op that has hit MAX_RETRY (retryCount >= 5)', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({ localId: 'op-maxed', retryCount: 5 }),
    ]);
    // Use the helper with no API responses — the op is skipped before any API call
    mockSessionOkWithApiResponses();

    const result = await syncPendingIncidents(ENCODER_ID);

    // session check + best-effort report → 2 fetch calls, no op fetch
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(markOpFailed).toHaveBeenCalledWith('op-maxed', 'network', 'max retries exceeded');
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
      json: () => Promise.resolve({ previous_status: 'PENDING_VALIDATION', new_status: 'VERIFIED' }), text: () => Promise.resolve(JSON.stringify({ previous_status: 'PENDING_VALIDATION', new_status: 'VERIFIED' })),
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
      json: () => Promise.resolve({ detail: 'Incident already in VERIFIED status' }), text: () => Promise.resolve(JSON.stringify({ detail: 'Incident already in VERIFIED status' })),
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
      json: () => Promise.resolve({ status: 'already_applied', incident_id: 55 }), text: () => Promise.resolve(JSON.stringify({ status: 'already_applied', incident_id: 55 })),
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
      json: () => Promise.resolve({ status: 'already_applied', incident_id: 77 }), text: () => Promise.resolve(JSON.stringify({ status: 'already_applied', incident_id: 77 })),
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
    fetchSpy.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({ report_id: 42 }), text: () => Promise.resolve(JSON.stringify({ report_id: 42 })) });
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
      .mockResolvedValueOnce({ ok: false, status: 422, json: () => Promise.resolve({ detail: 'Validation error' }), text: () => Promise.resolve(JSON.stringify({ detail: 'Validation error' })) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('{}') });
    vi.mocked(markSynced).mockResolvedValue(undefined);

    const result = await syncPendingIncidents();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    expect(markSynced).toHaveBeenCalledWith(2);
    expect(markSynced).not.toHaveBeenCalledWith(1);
  });
});

// ── OfflineOps path — verify ops (processVerify via getPendingOps) ──────────

describe('offlineOps dispatch — verify ops', () => {
  it('dispatches verify op to PATCH /regional/incidents/{id}/verification with client_id from localId', async () => {
    const localId = 'verify-offlineops-uuid-abc';
    const incidentId = 42;

    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({
        localId,
        operation: 'verify',
        payload: {
          incident_id: incidentId,
          action: 'accept',
          notes: 'Looks good',
        },
      }),
    ]);

    mockSessionOkWithApiResponses({
      ok: true, status: 200,
      json: () => Promise.resolve({ previous_status: 'PENDING_VALIDATION', new_status: 'VERIFIED' }), text: () => Promise.resolve(JSON.stringify({ previous_status: 'PENDING_VALIDATION', new_status: 'VERIFIED' })),
    });

    const result = await syncPendingIncidents(ENCODER_ID);

    // Auth check fires first, then the verification request (2 total)
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, options] = fetchSpy.mock.calls[1];
    expect(url).toMatch(/\/regional\/incidents\/42\/verification/);
    expect(options.method).toBe('PATCH');
    expect(options.credentials).toBe('include');

    const body = JSON.parse(options.body as string);
    expect(body.client_id).toBe(localId);
    expect(body.action).toBe('accept');
    expect(body.notes).toBe('Looks good');

    expect(markOpSynced).toHaveBeenCalledWith(localId, undefined);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('includes original_incident_id when accept_replace verify op syncs', async () => {
    const localId = 'verify-replace-uuid';

    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({
        localId,
        operation: 'verify',
        payload: {
          incident_id: 42,
          action: 'accept_replace',
          notes: 'Replacing duplicate',
          original_incident_id: 7,
        },
      }),
    ]);

    mockSessionOkWithApiResponses({
      ok: true, status: 200,
      json: () => Promise.resolve({ previous_status: 'PENDING_VALIDATION', new_status: 'VERIFIED' }), text: () => Promise.resolve(JSON.stringify({ previous_status: 'PENDING_VALIDATION', new_status: 'VERIFIED' })),
    });

    await syncPendingIncidents(ENCODER_ID);

    const [, options] = fetchSpy.mock.calls[1];
    const body = JSON.parse(options.body as string);
    expect(body.original_incident_id).toBe(7);
  });

  it('409 DUPLICATE_DETECTED on verify marks conflict, does not markSynced', async () => {
    const localId = 'verify-dup-uuid';

    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({
        localId,
        operation: 'verify',
        payload: { incident_id: 99, action: 'accept', notes: null },
      }),
    ]);

    mockSessionOkWithApiResponses({
      ok: false, status: 409,
      json: () => Promise.resolve({ detail: { code: 'DUPLICATE_DETECTED' } }), text: () => Promise.resolve(JSON.stringify({ detail: { code: 'DUPLICATE_DETECTED' } })),
    });

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(markOpConflict).toHaveBeenCalledWith(localId, '409_duplicate', undefined);
    expect(markOpSynced).not.toHaveBeenCalled();
    expect(result.synced).toBe(0);
    expect(result.conflicts).toBe(1);
    expect(result.errors[0].error).toBe('409_duplicate');
  });

  it('network error on verify marks error and aborts batch', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({ localId: 'v-net-1', operation: 'verify', payload: { incident_id: 1, action: 'accept' } }),
      makeOp({ localId: 'v-net-2', operation: 'verify', payload: { incident_id: 2, action: 'reject' } }),
    ]);

    fetchSpy.mockImplementation((url: string) => {
      if (url === '/api/auth/session') return Promise.resolve(sessionOkResponse);
      return Promise.reject(new TypeError('Failed to fetch'));
    });

    const result = await syncPendingIncidents(ENCODER_ID);

    // Only first op attempted, second skipped (batch aborted)
    expect(fetchSpy).toHaveBeenCalledTimes(2); // session + 1 op
    expect(markOpError).toHaveBeenCalledWith('v-net-1', 'network', expect.any(String));
    expect(markConnectivityOffline).toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });
});

// ── Backoff window — ops within backoff window are skipped ──────────────────

describe('backoff window skip', () => {
  it('skips op that is within its backoff window', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({ localId: 'op-backoff', retryCount: 1, lastAttemptAt: Date.now() - 100 }),
    ]);

    const result = await syncPendingIncidents(ENCODER_ID);

    // Only the session check fetch, no op attempted
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(markOpSyncing).not.toHaveBeenCalled();
    expect(markOpFailed).not.toHaveBeenCalled();
    expect(result.failed).toBe(0);
    expect(result.synced).toBe(0);
  });

  it('bypasses the backoff window for manual Sync Now', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({ localId: 'op-manual-backoff', retryCount: 1, lastAttemptAt: Date.now() - 100 }),
    ]);
    mockSessionOkWithApiResponses({
      ok: true, status: 200,
      json: () => Promise.resolve({ incident_ids: [11], failed: [] }), text: () => Promise.resolve(JSON.stringify({ incident_ids: [11], failed: [] })),
    });

    const result = await syncPendingIncidents(ENCODER_ID, { bypassBackoff: true });

    expect(markOpSyncing).toHaveBeenCalledWith('op-manual-backoff');
    expect(result.synced).toBe(1);
  });

  it('retries op that is past its backoff window', async () => {
    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({ localId: 'op-past-backoff', retryCount: 1, lastAttemptAt: Date.now() - 10000 }),
    ]);
    mockSessionOkWithApiResponses({
      ok: true, status: 200,
      json: () => Promise.resolve({ incident_ids: [10], failed: [] }), text: () => Promise.resolve(JSON.stringify({ incident_ids: [10], failed: [] })),
    });

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(markOpSyncing).toHaveBeenCalledWith('op-past-backoff');
    expect(result.synced).toBe(1);
  });
});

// ── computeBackoffDelay / isWithinBackoffWindow unit tests ───────────────────

describe('computeBackoffDelay', () => {
  it('returns ~1000ms for retryCount=0 with no jitter', () => {
    // deterministic random always returns 0.5 (center of range)
    const rng = () => 0.5;
    const delay = computeBackoffDelay(0, rng);
    // base = 2^0 * 1000 = 1000; jitter = (0.5*0.4 - 0.2) * 1000 = 0
    expect(delay).toBe(1000);
  });

  it('returns ~2000ms for retryCount=1 with no jitter', () => {
    const rng = () => 0.5;
    const delay = computeBackoffDelay(1, rng);
    expect(delay).toBe(2000);
  });

  it('caps at MAX_BACKOFF_MS (64000ms)', () => {
    const rng = () => 0.5;
    const delay = computeBackoffDelay(7, rng); // 2^7 * 1000 = 128000, capped
    expect(delay).toBe(64000);
  });

  it('always returns non-negative', () => {
    // extreme jitter at low end
    const rng = () => 0.0; // jitter = -20% of capped
    const delay = computeBackoffDelay(0, rng);
    expect(delay).toBeGreaterThanOrEqual(0);
  });

  it('jitter range is within ±20%', () => {
    const rngMin = () => 0.0;
    const rngMax = () => 1.0;
    const minDelay = computeBackoffDelay(2, rngMin);
    const maxDelay = computeBackoffDelay(2, rngMax);
    const base = 4000; // 2^2 * 1000
    expect(minDelay).toBeGreaterThanOrEqual(base * 0.8);
    expect(maxDelay).toBeLessThanOrEqual(base * 1.2);
  });
});

describe('isWithinBackoffWindow', () => {
  it('returns false when lastAttemptAt is null', () => {
    expect(isWithinBackoffWindow({ retryCount: 1, lastAttemptAt: null })).toBe(false);
  });

  it('returns false when retryCount is 0', () => {
    expect(isWithinBackoffWindow({ retryCount: 0, lastAttemptAt: Date.now() })).toBe(false);
  });

  it('returns true when within backoff window', () => {
    // retryCount=1, lastAttemptAt was 100ms ago — still within ~2000ms window
    expect(isWithinBackoffWindow({ retryCount: 1, lastAttemptAt: Date.now() - 100 })).toBe(true);
  });

  it('returns false when backoff window has expired', () => {
    // retryCount=1, lastAttemptAt was 10s ago — past the ~2000ms window
    expect(isWithinBackoffWindow({ retryCount: 1, lastAttemptAt: Date.now() - 10000 })).toBe(false);
  });
});

// ── OfflineOps path — archive_action ops (processArchiveAction via getPendingOps) ──

describe('offlineOps dispatch — archive_action ops', () => {
  it('dispatches archive action to PATCH .../archive with client_id from localId', async () => {
    const localId = 'archive-offlineops-uuid';

    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({
        localId,
        operation: 'archive_action',
        payload: { incident_id: 55, action: 'archive' },
      }),
    ]);

    mockSessionOkWithApiResponses({
      ok: true, status: 200,
      json: () => Promise.resolve({ status: 'already_applied', incident_id: 55 }), text: () => Promise.resolve(JSON.stringify({ status: 'already_applied', incident_id: 55 })),
    });

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, options] = fetchSpy.mock.calls[1];
    expect(url).toMatch(/\/regional\/validator\/incidents\/55\/archive/);
    expect(options.method).toBe('PATCH');
    expect(options.credentials).toBe('include');

    const body = JSON.parse(options.body as string);
    expect(body.client_id).toBe(localId);

    expect(markOpSynced).toHaveBeenCalledWith(localId, undefined);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('dispatches unarchive action to PATCH .../unarchive endpoint', async () => {
    const localId = 'unarchive-offlineops-uuid';

    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({
        localId,
        operation: 'archive_action',
        payload: { incident_id: 77, action: 'unarchive' },
      }),
    ]);

    mockSessionOkWithApiResponses({
      ok: true, status: 200,
      json: () => Promise.resolve({ status: 'already_applied', incident_id: 77 }), text: () => Promise.resolve(JSON.stringify({ status: 'already_applied', incident_id: 77 })),
    });

    await syncPendingIncidents(ENCODER_ID);

    const [url] = fetchSpy.mock.calls[1];
    expect(url).toMatch(/\/regional\/validator\/incidents\/77\/unarchive/);
  });

  it('dispatches encoder archive action to the encoder archive endpoint when scope is encoder', async () => {
    const localId = 'encoder-archive-offlineops-uuid';

    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({
        localId,
        operation: 'archive_action',
        payload: { incident_id: 88, action: 'archive', scope: 'encoder' },
      }),
    ]);

    mockSessionOkWithApiResponses({
      ok: true, status: 200,
      json: () => Promise.resolve({ status: 'archived', incident_id: 88 }), text: () => Promise.resolve(JSON.stringify({ status: 'archived', incident_id: 88 })),
    });

    await syncPendingIncidents(ENCODER_ID);

    const [url, options] = fetchSpy.mock.calls[1];
    expect(url).toMatch(/\/regional\/incidents\/88\/archive/);
    expect(url).not.toMatch(/\/regional\/validator\/incidents/);
    expect(options.method).toBe('PATCH');
  });

  it('dispatches encoder unarchive action to the encoder unarchive endpoint when scope is encoder', async () => {
    const localId = 'encoder-unarchive-offlineops-uuid';

    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({
        localId,
        operation: 'archive_action',
        payload: { incident_id: 89, action: 'unarchive', scope: 'encoder' },
      }),
    ]);

    mockSessionOkWithApiResponses({
      ok: true, status: 200,
      json: () => Promise.resolve({ status: 'unarchived', incident_id: 89 }), text: () => Promise.resolve(JSON.stringify({ status: 'unarchived', incident_id: 89 })),
    });

    await syncPendingIncidents(ENCODER_ID);

    const [url, options] = fetchSpy.mock.calls[1];
    expect(url).toMatch(/\/regional\/incidents\/89\/unarchive/);
    expect(url).not.toMatch(/\/regional\/validator\/incidents/);
    expect(options.method).toBe('PATCH');
  });

  it('409 on archive_action marks conflict', async () => {
    const localId = 'archive-dup-uuid';

    vi.mocked(getPendingOps).mockResolvedValue([
      makeOp({
        localId,
        operation: 'archive_action',
        payload: { incident_id: 99, action: 'archive' },
      }),
    ]);

    mockSessionOkWithApiResponses({
      ok: false, status: 409,
      json: () => Promise.resolve({ detail: { code: 'DUPLICATE_DETECTED' } }), text: () => Promise.resolve(JSON.stringify({ detail: { code: 'DUPLICATE_DETECTED' } })),
    });

    const result = await syncPendingIncidents(ENCODER_ID);

    expect(markOpConflict).toHaveBeenCalledWith(localId, '409_duplicate', undefined);
    expect(result.conflicts).toBe(1);
  });
});
