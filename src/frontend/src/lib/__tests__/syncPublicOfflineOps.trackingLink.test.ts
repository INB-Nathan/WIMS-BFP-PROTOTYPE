/**
 * Test A — offline sync persists the tracking link (Issue #654).
 *
 * When syncPublicOfflineOps() replays a queued `submit` op and the backend
 * echoes a tracking_url, the engine must mirror submitCivilianReportV2() and
 * write wims_last_report + wims_tracking_links_by_report so a reporter who
 * filed offline can still find their report after sync.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../offlineStore', () => ({
  getPendingPublicOps: vi.fn(),
  markPublicOpSyncing: vi.fn(),
  markPublicOpSynced: vi.fn(),
  markPublicOpFailed: vi.fn(),
  getLinkedPublicOp: vi.fn().mockResolvedValue([]),
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
  markPublicOpSynced,
  purgeSyncedPublicOps,
} = await import('../offlineStore');
const { isReachable } = await import('../connectivity');
const { syncPublicOfflineOps } = await import('../syncEngine');

const fetchSpy = vi.fn();
vi.stubGlobal('fetch', fetchSpy);

const DEVICE_ID = 'device-1';
const TRACKING_URL = 'https://wims.test/tracking/7/abc123token';

function makeJsonResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function makeSubmitOp() {
  return {
    localId: crypto.randomUUID(),
    deviceId: DEVICE_ID,
    operation: 'submit' as const,
    payload: { category: 'FIRE', latitude: 14.6, longitude: 120.9 },
    linkedLocalId: null,
    serverId: null,
    createdAt: Date.now(),
    status: 'pending',
    retryCount: 0,
    errorCode: null,
    errorMessage: null,
    lastAttemptAt: null,
  };
}

describe('syncPublicOfflineOps tracking link persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    isReachable.mockResolvedValue(true);
  });

  it('writes wims_last_report and wims_tracking_links_by_report after a submit sync with tracking_url', async () => {
    fetchSpy.mockResolvedValue(
      makeJsonResponse(200, { report_id: 7, tracking_url: TRACKING_URL }),
    );
    getPendingPublicOps.mockResolvedValue([makeSubmitOp()]);

    const result = await syncPublicOfflineOps(DEVICE_ID);

    expect(result.synced).toBe(1);
    expect(markPublicOpSynced).toHaveBeenCalledTimes(1);

    // wims_last_report captured the resolved serverId + tracking_url.
    const last = JSON.parse(localStorage.getItem('wims_last_report') as string);
    expect(last).toMatchObject({ id: 7, tracking_url: TRACKING_URL });
    expect(last.category).toBe('FIRE');

    // wims_tracking_links_by_report is keyed by reportId.
    const links = JSON.parse(
      localStorage.getItem('wims_tracking_links_by_report') as string,
    );
    expect(links['7']).toBe(TRACKING_URL);
  });

  it('does NOT write a tracking link when the response has no tracking_url', async () => {
    fetchSpy.mockResolvedValue(makeJsonResponse(200, { report_id: 8 }));
    getPendingPublicOps.mockResolvedValue([makeSubmitOp()]);

    const result = await syncPublicOfflineOps(DEVICE_ID);

    expect(result.synced).toBe(1);
    expect(localStorage.getItem('wims_last_report')).toBeNull();
    expect(localStorage.getItem('wims_tracking_links_by_report')).toBeNull();
  });

  it('does not write a tracking link when the queue is empty', async () => {
    getPendingPublicOps.mockResolvedValue([]);
    const result = await syncPublicOfflineOps(DEVICE_ID);

    expect(result.synced).toBe(0);
    // purgeSyncedPublicOps only runs when synced > 0, so an empty queue must
    // NOT trigger it; the tracking-link writers must also stay quiet.
    expect(purgeSyncedPublicOps).not.toHaveBeenCalled();
    expect(localStorage.getItem('wims_last_report')).toBeNull();
  });
});
