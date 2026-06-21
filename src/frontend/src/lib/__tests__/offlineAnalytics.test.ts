import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyticsMocks = vi.hoisted(() => ({
  fetchHeatmapData: vi.fn(),
  getReadCachedResponse: vi.fn(),
  cacheReadResponse: vi.fn(),
  markConnectivityOffline: vi.fn(),
  isReachable: vi.fn(),
  connectivitySnapshot: {
    state: 'offline',
    isOnline: false,
    isChecking: false,
    isReconnecting: false,
    lastCheckedAt: null,
  },
}));

vi.mock('../api/legacy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/legacy')>();
  return {
    ...actual,
    fetchHeatmapData: analyticsMocks.fetchHeatmapData,
  };
});

vi.mock('../offlineStore', () => ({
  getReadCachedResponse: analyticsMocks.getReadCachedResponse,
  cacheReadResponse: analyticsMocks.cacheReadResponse,
}));

vi.mock('../connectivity', () => ({
  getConnectivitySnapshot: () => analyticsMocks.connectivitySnapshot,
  isReachable: analyticsMocks.isReachable,
  markConnectivityOffline: analyticsMocks.markConnectivityOffline,
}));

describe('fetchHeatmapDataOfflineAware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    analyticsMocks.connectivitySnapshot.state = 'offline';
    analyticsMocks.connectivitySnapshot.isOnline = false;
    analyticsMocks.connectivitySnapshot.isChecking = false;
    analyticsMocks.connectivitySnapshot.isReconnecting = false;
    analyticsMocks.connectivitySnapshot.lastCheckedAt = null;
    analyticsMocks.isReachable.mockResolvedValue(false);
  });

  it('serves cached heatmap data with cache metadata when the analyst is offline', async () => {
    const cachedAt = Date.now() - 60_000;
    const cachedResponse = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [120.9842, 14.5995] as [number, number] },
          properties: {
            incident_id: 266,
            alarm_level: 'first_alarm',
            incident_type: 'Structural Fire',
          },
        },
      ],
    };

    analyticsMocks.getReadCachedResponse.mockResolvedValue({
      key: 'analytics:heatmap:region-4:2026-06',
      data: cachedResponse,
      cachedAt,
      ttlMs: 30 * 60 * 1000,
    });

    const { fetchHeatmapDataOfflineAware } = await import('../api/analytics');

    const result = await fetchHeatmapDataOfflineAware({
      region_id: 4,
      start_date: '2026-06-01',
      end_date: '2026-06-30',
    });

    expect(result).toEqual({
      response: cachedResponse,
      fromCache: true,
      cachedAt,
    });
    expect(analyticsMocks.fetchHeatmapData).not.toHaveBeenCalled();
  });

  it('caches successful online heatmap responses without changing the payload shape', async () => {
    analyticsMocks.connectivitySnapshot.state = 'online';
    analyticsMocks.connectivitySnapshot.isOnline = true;
    const response = {
      type: 'FeatureCollection' as const,
      features: [],
    };
    analyticsMocks.fetchHeatmapData.mockResolvedValue(response);

    const { fetchHeatmapDataOfflineAware } = await import('../api/analytics');

    const filters = { region_id: 4, start_date: '2026-06-01' };
    const result = await fetchHeatmapDataOfflineAware(filters);

    expect(analyticsMocks.fetchHeatmapData).toHaveBeenCalledWith(filters);
    expect(analyticsMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringMatching(/^analytics:heatmap:/),
      response,
      expect.any(Number),
    );
    expect(result).toEqual({ response, fromCache: false });
  });
});
