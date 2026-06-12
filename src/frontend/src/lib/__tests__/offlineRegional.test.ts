import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConnectivity = vi.hoisted(() => ({
  online: false,
  reachable: false,
  fetchRegionalIncident: vi.fn(),
  getCachedIncident: vi.fn(),
  getOfflineOpByServerId: vi.fn(),
}));

vi.mock('../api/legacy', () => ({
  fetchRegionalIncidents: vi.fn(),
  fetchRegionalIncident: mockConnectivity.fetchRegionalIncident,
}));

vi.mock('../offlineStore', () => ({
  cacheIncident: vi.fn(),
  getCachedIncidents: vi.fn(),
  getCachedIncident: mockConnectivity.getCachedIncident,
  getOfflineOpByServerId: mockConnectivity.getOfflineOpByServerId,
}));

vi.mock('../connectivity', () => ({
  getConnectivitySnapshot: () => ({
    state: mockConnectivity.online ? 'online' : 'offline',
    isOnline: mockConnectivity.online,
    isChecking: false,
    isReconnecting: false,
    lastCheckedAt: null,
  }),
  isReachable: vi.fn(() => Promise.resolve(mockConnectivity.reachable)),
  markConnectivityOffline: vi.fn(),
}));

import { fetchRegionalIncidentOfflineAware } from '../api/offlineRegional';

describe('fetchRegionalIncidentOfflineAware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectivity.online = false;
    mockConnectivity.reachable = false;
    mockConnectivity.getCachedIncident.mockResolvedValue(null);
    mockConnectivity.getOfflineOpByServerId.mockResolvedValue(null);
  });

  it('shows a friendly unavailable-offline error when the incident is not cached', async () => {
    await expect(fetchRegionalIncidentOfflineAware(123, 'encoder-1')).rejects.toThrow(
      /not available offline|not saved on this device/i,
    );
    expect(mockConnectivity.fetchRegionalIncident).not.toHaveBeenCalled();
  });

  it('serves cached incident detail while offline', async () => {
    mockConnectivity.getCachedIncident.mockResolvedValue({
      incidentId: 123,
      encoderId: 'encoder-1',
      cachedAt: 1000,
      data: { incident_id: 123, verification_status: 'DRAFT' },
    });

    const result = await fetchRegionalIncidentOfflineAware(123, 'encoder-1');

    expect(result.fromCache).toBe(true);
    expect(result.response.incident_id).toBe(123);
  });
});
