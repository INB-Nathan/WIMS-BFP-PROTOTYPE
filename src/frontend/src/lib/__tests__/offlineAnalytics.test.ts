import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyticsMocks = vi.hoisted(() => ({
  fetchHeatmapData: vi.fn(),
  fetchAnalystIncidentWildlandDetail: vi.fn(),
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
    fetchAnalystIncidentWildlandDetail: analyticsMocks.fetchAnalystIncidentWildlandDetail,
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

// ── Wildland detail fixture ─────────────────────────────────────────────────

const wildlandDetailResponse = {
  incident_id: 42,
  reference_number: 'REF-001',
  wildland: { fire_type: 'forest' },
  alarm_statuses: [
    {
      sort_order: 1,
      alarm_status: 'First Alarm',
      time_declared: '2026-06-20T10:00:00Z',
      ground_commander: 'BC Garcia',
    },
  ],
  assistance_rows: [
    {
      sort_order: 1,
      organization_or_unit: 'BFP Rizal',
      detail: 'Water tanker',
    },
  ],
};

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

describe('fetchAnalystIncidentWildlandDetailOfflineAware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    analyticsMocks.connectivitySnapshot.state = 'offline';
    analyticsMocks.connectivitySnapshot.isOnline = false;
    analyticsMocks.connectivitySnapshot.isChecking = false;
    analyticsMocks.connectivitySnapshot.isReconnecting = false;
    analyticsMocks.connectivitySnapshot.lastCheckedAt = null;
    analyticsMocks.isReachable.mockResolvedValue(false);
  });

  it('caches successful online wildland detail (online cache miss → fetch)', async () => {
    analyticsMocks.connectivitySnapshot.state = 'online';
    analyticsMocks.connectivitySnapshot.isOnline = true;
    analyticsMocks.fetchAnalystIncidentWildlandDetail.mockResolvedValue(wildlandDetailResponse);

    const { fetchAnalystIncidentWildlandDetailOfflineAware } = await import('../api/analytics');

    const result = await fetchAnalystIncidentWildlandDetailOfflineAware(42);

    expect(analyticsMocks.fetchAnalystIncidentWildlandDetail).toHaveBeenCalledWith(42);
    expect(analyticsMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringMatching(/^analytics:analyst-wildland-detail:/),
      wildlandDetailResponse,
      expect.any(Number),
    );
    expect(result).toEqual({ response: wildlandDetailResponse, fromCache: false });
  });

  it('falls back to fresh cache on network error (online cache hit → cached)', async () => {
    analyticsMocks.connectivitySnapshot.state = 'online';
    analyticsMocks.connectivitySnapshot.isOnline = true;
    analyticsMocks.fetchAnalystIncidentWildlandDetail.mockRejectedValue(new TypeError('Failed to fetch'));

    const cachedAt = Date.now() - 60_000;
    analyticsMocks.getReadCachedResponse.mockResolvedValue({
      key: 'analytics:analyst-wildland-detail:42',
      data: wildlandDetailResponse,
      cachedAt,
      ttlMs: 30 * 60 * 1000,
    });

    const { fetchAnalystIncidentWildlandDetailOfflineAware } = await import('../api/analytics');

    const result = await fetchAnalystIncidentWildlandDetailOfflineAware(42);

    expect(analyticsMocks.fetchAnalystIncidentWildlandDetail).toHaveBeenCalledWith(42);
    expect(result).toEqual({
      response: wildlandDetailResponse,
      fromCache: true,
      cachedAt,
    });
  });

  it('serves cached wildland detail when offline and cache is fresh (offline+fresh → cached)', async () => {
    const cachedAt = Date.now() - 60_000;
    analyticsMocks.getReadCachedResponse.mockResolvedValue({
      key: 'analytics:analyst-wildland-detail:42',
      data: wildlandDetailResponse,
      cachedAt,
      ttlMs: 30 * 60 * 1000,
    });

    const { fetchAnalystIncidentWildlandDetailOfflineAware } = await import('../api/analytics');

    const result = await fetchAnalystIncidentWildlandDetailOfflineAware(42);

    expect(result).toEqual({
      response: wildlandDetailResponse,
      fromCache: true,
      cachedAt,
    });
    expect(analyticsMocks.fetchAnalystIncidentWildlandDetail).not.toHaveBeenCalled();
  });

  it('throws OFFLINE_ANALYTICS_ERROR when offline and cache is stale (offline+stale → throw)', async () => {
    const staleCachedAt = Date.now() - 31 * 60 * 1000;
    analyticsMocks.getReadCachedResponse.mockResolvedValue({
      key: 'analytics:analyst-wildland-detail:42',
      data: wildlandDetailResponse,
      cachedAt: staleCachedAt,
      ttlMs: 30 * 60 * 1000,
    });

    const { fetchAnalystIncidentWildlandDetailOfflineAware } = await import('../api/analytics');

    await expect(fetchAnalystIncidentWildlandDetailOfflineAware(42)).rejects.toThrow(
      'Analytics data is unavailable offline. Reconnect to refresh this view.',
    );
    expect(analyticsMocks.fetchAnalystIncidentWildlandDetail).not.toHaveBeenCalled();
  });

  it('throws OFFLINE_ANALYTICS_ERROR when offline and cache is missing (offline+miss → throw)', async () => {
    analyticsMocks.getReadCachedResponse.mockResolvedValue(null);

    const { fetchAnalystIncidentWildlandDetailOfflineAware } = await import('../api/analytics');

    await expect(fetchAnalystIncidentWildlandDetailOfflineAware(42)).rejects.toThrow(
      'Analytics data is unavailable offline. Reconnect to refresh this view.',
    );
    expect(analyticsMocks.fetchAnalystIncidentWildlandDetail).not.toHaveBeenCalled();
  });
});
