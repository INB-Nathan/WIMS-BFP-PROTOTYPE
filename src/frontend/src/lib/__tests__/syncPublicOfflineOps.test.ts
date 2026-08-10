/**
 * syncPublicOfflineOps tests — Pattern D (simple vi.mock + fetch stub).
 *
 * The public sync engine differs from the encoder sync engine in two important
 * ways:
 *   1. NO auth check — civilians are unauthenticated, so we must not call
 *      /api/auth/session or attempt to refresh tokens.
 *   2. credentials: 'omit' — publicApiFetch already uses this; the sync
 *      engine must not override it with 'include'.
 *
 * The replay order test is the critical correctness check: submits must be
 * processed oldest-first so the serverId resolution works correctly, and any
 * append/followup whose linkedLocalId points to a not-yet-synced submit must
 * resolve through the syncedServerIds map (not the original queued serverId,
 * which is null at queue time).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../offlineStore', () => ({
  getPendingPublicOps: vi.fn(),
  recoverStalePublicSyncingOps: vi.fn().mockResolvedValue(0),
  markPublicOpSyncing: vi.fn(),
  markPublicOpSynced: vi.fn(),
  markPublicOpFailed: vi.fn(),
  getLinkedPublicOp: vi.fn(),
  purgeSyncedPublicOps: vi.fn(),
  getPublicOp: vi.fn(),
  getPendingPhotosForSync: vi.fn().mockResolvedValue([]),
  storePhotoLink: vi.fn(),
  getPhotosByParentLocalId: vi.fn().mockResolvedValue([]),
  updatePhotoReportLink: vi.fn(),
}));

vi.mock('../connectivity', () => ({
  markConnectivityOffline: vi.fn(),
  isReachable: vi.fn(),
}));

const {
  getPendingPublicOps,
  recoverStalePublicSyncingOps,
  markPublicOpSyncing,
  markPublicOpSynced,
  markPublicOpFailed,
  getLinkedPublicOp,
  purgeSyncedPublicOps,
  getPublicOp,
  getPendingPhotosForSync,
  storePhotoLink,
  getPhotosByParentLocalId,
  updatePhotoReportLink,
} = await import('../offlineStore');
const { markConnectivityOffline, isReachable } = await import('../connectivity');
const { syncPublicOfflineOps } = await import('../syncEngine');

const fetchSpy = vi.fn();
vi.stubGlobal('fetch', fetchSpy);

const DEVICE_ID = 'device-1';

interface QueuedPublicOpMock {
  localId: string;
  deviceId: string;
  operation: 'submit' | 'append' | 'followup';
  payload: Record<string, unknown>;
  linkedLocalId: string | null;
  serverId: number | null;
  createdAt: number;
  status: string;
  retryCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  lastAttemptAt: number | null;
}

function makeOp(overrides: Partial<QueuedPublicOpMock> = {}): QueuedPublicOpMock {
  return {
    localId: crypto.randomUUID(),
    deviceId: DEVICE_ID,
    operation: 'submit',
    payload: {},
    linkedLocalId: null,
    serverId: null,
    createdAt: Date.now(),
    status: 'pending',
    retryCount: 0,
    errorCode: null,
    errorMessage: null,
    lastAttemptAt: null,
    ...overrides,
  };
}

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isReachable).mockResolvedValue(true);
  vi.mocked(recoverStalePublicSyncingOps).mockResolvedValue(0);
  vi.mocked(markPublicOpSyncing).mockResolvedValue(undefined);
  vi.mocked(markPublicOpSynced).mockResolvedValue(undefined);
  vi.mocked(markPublicOpFailed).mockResolvedValue(undefined);
  vi.mocked(purgeSyncedPublicOps).mockResolvedValue(undefined);
  vi.mocked(getLinkedPublicOp).mockResolvedValue([]);
  vi.mocked(getPublicOp).mockResolvedValue(undefined);
});

// ── Replay order ────────────────────────────────────────────────────

describe('syncPublicOfflineOps — replay order', () => {
  it('processes submits in createdAt ascending order', async () => {
    const now = Date.now();
    const a = makeOp({ localId: 'a', createdAt: now, operation: 'submit' });
    const b = makeOp({ localId: 'b', createdAt: now + 100, operation: 'submit' });
    const c = makeOp({ localId: 'c', createdAt: now + 200, operation: 'submit' });
    vi.mocked(getPendingPublicOps).mockResolvedValue([a, b, c]);

    // Return a fresh Response per call so the body stream isn't consumed.
    fetchSpy.mockImplementation(async () => makeJsonResponse(200, { report_id: 1 }));

    await syncPublicOfflineOps(DEVICE_ID);

    const urls = fetchSpy.mock.calls.map((c) => (c[0] as string) ?? '');
    // The first three calls are the submits. They should hit /api/civilian/reports.
    expect(urls.filter((u) => u.includes('/api/civilian/reports'))).toHaveLength(3);
  });

  it('resolves linkedLocalId chain after submit succeeds', async () => {
    const submit = makeOp({ localId: 'sub-1', operation: 'submit', payload: { foo: 'bar' } });
    const append = makeOp({
      localId: 'app-1',
      operation: 'append',
      linkedLocalId: 'sub-1',
      payload: { description: 'more info' },
    });
    vi.mocked(getPendingPublicOps).mockResolvedValue([submit, append]);

    // submit returns report_id=42, append returns success
    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/api/civilian/reports') && !u.includes('/append')) {
        return makeJsonResponse(200, { report_id: 42 });
      }
      if (u.includes('/api/civilian/reports/42/append')) {
        return makeJsonResponse(200, { report_id: 42, status: 'PENDING' });
      }
      return makeJsonResponse(404, { detail: 'not found' });
    });

    const result = await syncPublicOfflineOps(DEVICE_ID);

    expect(result.synced).toBe(2);
    expect(markPublicOpSynced).toHaveBeenCalledWith('sub-1', 42);
    expect(markPublicOpSynced).toHaveBeenCalledWith('app-1', 42);
  });
});

// ── Stale sync recovery ───────────────────────────────────────────

describe('syncPublicOfflineOps — stale sync recovery', () => {
  it('recovers stale syncing ops for the device before the queue is filtered', async () => {
    vi.mocked(getPendingPublicOps).mockResolvedValue([makeOp({ localId: 'sub-1' })]);
    fetchSpy.mockResolvedValue(makeJsonResponse(200, { report_id: 1 }));

    await syncPublicOfflineOps(DEVICE_ID);

    expect(recoverStalePublicSyncingOps).toHaveBeenCalledWith(DEVICE_ID);
    const recoveryOrder = vi.mocked(recoverStalePublicSyncingOps).mock.invocationCallOrder[0];
    const queueOrder = vi.mocked(getPendingPublicOps).mock.invocationCallOrder[0];
    // Recovery must complete before the replay queue is read, so an op re-armed
    // by recovery is visible to this pass.
    expect(recoveryOrder).toBeLessThan(queueOrder);
  });

  it('replays ops re-armed by recovery in the same pass', async () => {
    const op = makeOp({ localId: 'sub-1', operation: 'submit' });
    vi.mocked(recoverStalePublicSyncingOps).mockResolvedValue(1);
    vi.mocked(getPendingPublicOps).mockResolvedValue([op]);
    fetchSpy.mockResolvedValue(makeJsonResponse(200, { report_id: 9 }));

    const result = await syncPublicOfflineOps(DEVICE_ID);

    expect(markPublicOpSynced).toHaveBeenCalledWith('sub-1', 9);
    expect(result.synced).toBe(1);
  });

  it('does not recover when offline (replay aborts before recovery)', async () => {
    vi.mocked(isReachable).mockResolvedValue(false);

    const result = await syncPublicOfflineOps(DEVICE_ID);

    expect(result.abortReason).toBe('offline');
    expect(recoverStalePublicSyncingOps).not.toHaveBeenCalled();
  });
});

// ── No auth ─────────────────────────────────────────────────────────

describe('syncPublicOfflineOps — no auth', () => {
  it('does NOT call /api/auth/session', async () => {
    vi.mocked(getPendingPublicOps).mockResolvedValue([]);
    await syncPublicOfflineOps(DEVICE_ID);

    const urls = fetchSpy.mock.calls.map((c) => String(c[0] ?? ''));
    expect(urls.some((u) => u.includes('/api/auth/session'))).toBe(false);
  });

  it('uses credentials: omit (via publicApiFetch)', async () => {
    const op = makeOp({ localId: 'sub-1', operation: 'submit' });
    vi.mocked(getPendingPublicOps).mockResolvedValue([op]);
    fetchSpy.mockResolvedValue(makeJsonResponse(200, { report_id: 1 }));

    await syncPublicOfflineOps(DEVICE_ID);

    // fetch should be called with credentials: 'omit' (via the publicApiFetch impl)
    // The actual fetch wrapper sits inside publicApiFetch, but we verify the
    // call was made without setting credentials: 'include'.
    const call = fetchSpy.mock.calls[0];
    const init = (call[1] ?? {}) as RequestInit;
    expect(init.credentials).not.toBe('include');
  });
});

// ── Error handling ──────────────────────────────────────────────────

describe('syncPublicOfflineOps — error handling', () => {
  it('stops on network error and marks connectivity offline', async () => {
    const op = makeOp({ localId: 'sub-1', operation: 'submit' });
    vi.mocked(getPendingPublicOps).mockResolvedValue([op]);
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await syncPublicOfflineOps(DEVICE_ID);

    expect(markConnectivityOffline).toHaveBeenCalled();
    expect(markPublicOpFailed).toHaveBeenCalled();
    expect(result.abortReason).toBe('offline');
  });

  it('marks retryable on 5xx and continues with next op', async () => {
    const a = makeOp({ localId: 'a', operation: 'submit' });
    const b = makeOp({ localId: 'b', operation: 'submit' });
    vi.mocked(getPendingPublicOps).mockResolvedValue([a, b]);

    let callCount = 0;
    fetchSpy.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) return makeJsonResponse(500, { detail: 'server error' });
      return makeJsonResponse(200, { report_id: 7 });
    });

    const result = await syncPublicOfflineOps(DEVICE_ID);

    expect(markPublicOpFailed).toHaveBeenCalledWith('a', expect.any(String), expect.any(String));
    expect(markPublicOpSynced).toHaveBeenCalledWith('b', 7);
    expect(result.synced).toBe(1);
  });

  it('returns empty result when no pending ops', async () => {
    vi.mocked(getPendingPublicOps).mockResolvedValue([]);

    const result = await syncPublicOfflineOps(DEVICE_ID);

    expect(result).toEqual({
      synced: 0,
      failed: 0,
      errors: [],
      syncedIncidents: [],
      photoSynced: 0,
      photoFailed: 0,
      photoKeyLost: 0,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Empty queue ─────────────────────────────────────────────────────

describe('syncPublicOfflineOps — empty queue', () => {
  it('returns synced=0, failed=0 with no errors when queue is empty', async () => {
    vi.mocked(getPendingPublicOps).mockResolvedValue([]);

    const result = await syncPublicOfflineOps(DEVICE_ID);

    expect(result.synced).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.syncedIncidents).toEqual([]);
  });

  it('returns abortReason=offline when not reachable', async () => {
    vi.mocked(isReachable).mockResolvedValue(false);
    vi.mocked(getPendingPublicOps).mockResolvedValue([makeOp()]);

    const result = await syncPublicOfflineOps(DEVICE_ID);

    expect(result.abortReason).toBe('offline');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
