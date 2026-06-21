import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConnectivity = vi.hoisted(() => ({
  snapshot: { state: 'online' as 'online' | 'offline', isOnline: true },
  markConnectivityOffline: vi.fn(),
}));

vi.mock('../connectivity', () => ({
  getConnectivitySnapshot: () => mockConnectivity.snapshot,
  markConnectivityOffline: mockConnectivity.markConnectivityOffline,
}));

const mockApi = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock('../api/transport', () => ({
  apiFetch: mockApi.apiFetch,
  ApiRequestError: class ApiRequestError extends Error {
    status: number;
    detail: unknown;
    constructor(status: number, detail?: unknown) {
      super(`Request failed: ${status}`);
      this.status = status;
      this.detail = detail;
    }
  },
}));

const mockStore = vi.hoisted(() => ({
  queueOfflineOp: vi.fn(),
}));

vi.mock('../offlineStore', () => ({
  queueOfflineOp: mockStore.queueOfflineOp,
}));

import { submitEncoderArchiveActionOfflineAware } from '../api/offlineRegionalActions';

const ENCODER_ID = 'encoder-123';
const REGION_ID = 9;

beforeEach(() => {
  vi.clearAllMocks();
  mockConnectivity.snapshot = { state: 'online', isOnline: true };
  mockApi.apiFetch.mockResolvedValue({ ok: true });
  mockStore.queueOfflineOp.mockResolvedValue(undefined);
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('encoder-archive-local-id' as `${string}-${string}-${string}-${string}-${string}`);
});

describe('submitEncoderArchiveActionOfflineAware', () => {
  it('queues encoder archive action when connectivity is offline', async () => {
    mockConnectivity.snapshot = { state: 'offline', isOnline: false };

    const result = await submitEncoderArchiveActionOfflineAware(55, 'archive', {
      encoderId: ENCODER_ID,
      regionId: REGION_ID,
    });

    expect(result).toEqual({ queued: true, localId: 'encoder-archive-local-id' });
    expect(mockApi.apiFetch).not.toHaveBeenCalled();
    expect(mockStore.queueOfflineOp).toHaveBeenCalledWith(expect.objectContaining({
      localId: 'encoder-archive-local-id',
      operation: 'archive_action',
      serverId: 55,
      regionId: REGION_ID,
      encoderId: ENCODER_ID,
      payload: { incident_id: 55, action: 'archive', scope: 'encoder' },
    }));
  });

  it('queues encoder unarchive action when the online request fails with a network error', async () => {
    mockApi.apiFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await submitEncoderArchiveActionOfflineAware(56, 'unarchive', {
      encoderId: ENCODER_ID,
      regionId: REGION_ID,
    });

    expect(result).toEqual({ queued: true, localId: 'encoder-archive-local-id' });
    expect(mockConnectivity.markConnectivityOffline).toHaveBeenCalled();
    expect(mockStore.queueOfflineOp).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'archive_action',
      serverId: 56,
      payload: { incident_id: 56, action: 'unarchive', scope: 'encoder' },
    }));
  });
});
