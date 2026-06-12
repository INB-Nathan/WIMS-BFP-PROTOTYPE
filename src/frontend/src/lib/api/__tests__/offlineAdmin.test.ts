/**
 * Tests for GH #270: Admin Offline-First Read Caching
 *
 * Covers all 5 admin offline-aware wrappers:
 *   fetchSystemHealthOfflineAware, fetchSystemMetricsOfflineAware,
 *   fetchWorkerStatusOfflineAware, fetchActiveSessionsOfflineAware,
 *   fetchAuditLogsOfflineAware
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks (mirrors offlineAnalytics.test.ts pattern)
// ---------------------------------------------------------------------------
const adminMocks = vi.hoisted(() => ({
  fetchSystemHealth: vi.fn(),
  fetchSystemMetrics: vi.fn(),
  fetchWorkerStatus: vi.fn(),
  fetchActiveSessions: vi.fn(),
  fetchAuditLogs: vi.fn(),
  getCachedAnalyticsResponse: vi.fn(),
  cacheAnalyticsResponse: vi.fn(),
  markConnectivityOffline: vi.fn(),
  isReachable: vi.fn(),
  connectivitySnapshot: {
    state: 'offline' as const,
    isOnline: false,
    isChecking: false,
    isReconnecting: false,
    lastCheckedAt: null as number | null,
  },
}));

vi.mock('../legacy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../legacy')>();
  return {
    ...actual,
    fetchSystemHealth: adminMocks.fetchSystemHealth,
    fetchSystemMetrics: adminMocks.fetchSystemMetrics,
    fetchWorkerStatus: adminMocks.fetchWorkerStatus,
    fetchActiveSessions: adminMocks.fetchActiveSessions,
    fetchAuditLogs: adminMocks.fetchAuditLogs,
  };
});

vi.mock('../../offlineStore', () => ({
  getCachedAnalyticsResponse: adminMocks.getCachedAnalyticsResponse,
  cacheAnalyticsResponse: adminMocks.cacheAnalyticsResponse,
}));

vi.mock('../../connectivity', () => ({
  getConnectivitySnapshot: () => adminMocks.connectivitySnapshot,
  isReachable: adminMocks.isReachable,
  markConnectivityOffline: adminMocks.markConnectivityOffline,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function goOnline() {
  adminMocks.connectivitySnapshot.state = 'online';
  adminMocks.connectivitySnapshot.isOnline = true;
}

function goOffline() {
  adminMocks.connectivitySnapshot.state = 'offline';
  adminMocks.connectivitySnapshot.isOnline = false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('fetchSystemHealthOfflineAware — offline, no cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    goOffline();
    adminMocks.getCachedAnalyticsResponse.mockResolvedValue(undefined);
  });

  it('throws when offline with no cached admin data', async () => {
    const { fetchSystemHealthOfflineAware } = await import('../offlineAdmin');

    await expect(fetchSystemHealthOfflineAware()).rejects.toThrow(
      'System health data is unavailable offline. Reconnect to refresh this view.',
    );

    expect(adminMocks.fetchSystemHealth).not.toHaveBeenCalled();
  });
});

describe('fetchSystemHealthOfflineAware — online fresh', () => {
  const mockHealth = { status: 'HEALTHY' as const, components: { db: { status: 'HEALTHY' as const, latency_ms: 2 } } };

  beforeEach(() => {
    vi.clearAllMocks();
    goOnline();
  });

  it('returns { response, fromCache: false } and writes cache on success', async () => {
    adminMocks.fetchSystemHealth.mockResolvedValue(mockHealth);
    adminMocks.cacheAnalyticsResponse.mockResolvedValue(undefined);

    const { fetchSystemHealthOfflineAware } = await import('../offlineAdmin');

    const result = await fetchSystemHealthOfflineAware();

    expect(result).toEqual({ response: mockHealth, fromCache: false });
    expect(adminMocks.fetchSystemHealth).toHaveBeenCalledTimes(1);
    expect(adminMocks.cacheAnalyticsResponse).toHaveBeenCalledTimes(1);
    expect(adminMocks.cacheAnalyticsResponse).toHaveBeenCalledWith(
      expect.stringMatching(/^admin:system-health:/),
      mockHealth,
    );
  });
});

describe('fetchSystemHealthOfflineAware — network error, cached fallback', () => {
  const mockHealth = { status: 'HEALTHY' as const, components: { db: { status: 'HEALTHY' as const, latency_ms: 2 } } };
  const cachedAt = Date.now() - 5_000;

  beforeEach(() => {
    vi.clearAllMocks();
    goOnline();
  });

  it('falls back to cache on network error with { response, fromCache: true }', async () => {
    adminMocks.fetchSystemHealth.mockRejectedValue(new TypeError('Failed to fetch'));
    adminMocks.getCachedAnalyticsResponse.mockResolvedValue({
      key: 'admin:system-health:',
      data: mockHealth,
      cachedAt,
    });

    const { fetchSystemHealthOfflineAware } = await import('../offlineAdmin');

    const result = await fetchSystemHealthOfflineAware();

    expect(result).toEqual({ response: mockHealth, fromCache: true, cachedAt });
    expect(adminMocks.fetchSystemHealth).toHaveBeenCalledTimes(1);
    expect(adminMocks.markConnectivityOffline).toHaveBeenCalled();
  });
});

describe('fetchActiveSessionsOfflineAware — 30s TTL', () => {
  const mockSessions = [{ session_id: 's1', user_id: 'u1', username: 'admin', role: 'ADMIN', ip_address: '127.0.0.1', start: 1, last_access: 2 }];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-fetches when cache is older than 30s (stale TTL)', async () => {
    goOnline();
    adminMocks.fetchActiveSessions.mockResolvedValue(mockSessions);
    adminMocks.cacheAnalyticsResponse.mockResolvedValue(undefined);
    // Cached item exists but is 31 seconds old — beyond 30s TTL
    adminMocks.getCachedAnalyticsResponse.mockResolvedValue({
      key: 'admin:active-sessions:',
      data: mockSessions,
      cachedAt: Date.now() - 31_000,
    });

    const { fetchActiveSessionsOfflineAware } = await import('../offlineAdmin');

    const result = await fetchActiveSessionsOfflineAware();

    // Should have re-fetched online since cache was stale
    expect(result.fromCache).toBe(false);
    expect(adminMocks.fetchActiveSessions).toHaveBeenCalledTimes(1);
    expect(adminMocks.cacheAnalyticsResponse).toHaveBeenCalledTimes(1);
  });

  it('serves fresh cache when offline and TTL is within 30s', async () => {
    goOffline();
    const cachedAt = Date.now() - 10_000;
    adminMocks.getCachedAnalyticsResponse.mockResolvedValue({
      key: 'admin:active-sessions:',
      data: mockSessions,
      cachedAt,
    });

    const { fetchActiveSessionsOfflineAware } = await import('../offlineAdmin');

    const result = await fetchActiveSessionsOfflineAware();

    expect(result).toEqual({ response: mockSessions, fromCache: true, cachedAt });
    expect(adminMocks.fetchActiveSessions).not.toHaveBeenCalled();
  });
});

describe('fetchAuditLogsOfflineAware — cache key with params', () => {
  const mockAuditResponse = { items: [{ audit_id: 1, user_id: 'u1', action_type: 'LOGIN', table_affected: null, record_id: null, ip_address: '127.0.0.1', user_agent: 'test', timestamp: '2025-01-01' }], total: 1, limit: 50, offset: 0 };

  beforeEach(() => {
    vi.clearAllMocks();
    goOnline();
  });

  it('generates cache key with args for audit logs with params', async () => {
    adminMocks.fetchAuditLogs.mockResolvedValue(mockAuditResponse);
    adminMocks.cacheAnalyticsResponse.mockResolvedValue(undefined);

    const { fetchAuditLogsOfflineAware } = await import('../offlineAdmin');

    await fetchAuditLogsOfflineAware({ limit: 50, offset: 0, q: 'test' });

    expect(adminMocks.cacheAnalyticsResponse).toHaveBeenCalledWith(
      expect.stringContaining('admin:audit-logs:'),
      mockAuditResponse,
    );
  });

  it('serves cached audit logs when offline', async () => {
    goOffline();
    const cachedAt = Date.now() - 5_000;
    adminMocks.getCachedAnalyticsResponse.mockResolvedValue({
      key: 'admin:audit-logs:{}',
      data: mockAuditResponse,
      cachedAt,
    });

    const { fetchAuditLogsOfflineAware } = await import('../offlineAdmin');

    const result = await fetchAuditLogsOfflineAware();

    expect(result).toEqual({ response: mockAuditResponse, fromCache: true, cachedAt });
    expect(adminMocks.fetchAuditLogs).not.toHaveBeenCalled();
  });
});

describe('fetchSystemMetricsOfflineAware — basic contract', () => {
  const mockMetrics = { cpu_percent: 42, memory: { total_mb: 8192, used_mb: 3500, percent: 42.7 }, disk: { total_gb: 100, used_gb: 45, percent: 45 } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caches and returns online metrics', async () => {
    goOnline();
    adminMocks.fetchSystemMetrics.mockResolvedValue(mockMetrics);
    adminMocks.cacheAnalyticsResponse.mockResolvedValue(undefined);

    const { fetchSystemMetricsOfflineAware } = await import('../offlineAdmin');

    const result = await fetchSystemMetricsOfflineAware();

    expect(result).toEqual({ response: mockMetrics, fromCache: false });
    expect(adminMocks.cacheAnalyticsResponse).toHaveBeenCalledWith(
      expect.stringMatching(/^admin:system-metrics:/),
      mockMetrics,
    );
  });

  it('throws offline without cache', async () => {
    goOffline();
    adminMocks.getCachedAnalyticsResponse.mockResolvedValue(undefined);

    const { fetchSystemMetricsOfflineAware } = await import('../offlineAdmin');

    await expect(fetchSystemMetricsOfflineAware()).rejects.toThrow(
      'System health data is unavailable offline. Reconnect to refresh this view.',
    );
  });
});

describe('fetchWorkerStatusOfflineAware — basic contract', () => {
  const mockWorkers = [{ worker_id: 'w1@host', hostname: 'host1', last_seen: '2025-01-01T00:00:00Z', active_tasks: 3, status: 'UP' }];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caches and returns online worker status', async () => {
    goOnline();
    adminMocks.fetchWorkerStatus.mockResolvedValue(mockWorkers);
    adminMocks.cacheAnalyticsResponse.mockResolvedValue(undefined);

    const { fetchWorkerStatusOfflineAware } = await import('../offlineAdmin');

    const result = await fetchWorkerStatusOfflineAware();

    expect(result).toEqual({ response: mockWorkers, fromCache: false });
    expect(adminMocks.cacheAnalyticsResponse).toHaveBeenCalledWith(
      expect.stringMatching(/^admin:worker-status:/),
      mockWorkers,
    );
  });

  it('throws offline without cache', async () => {
    goOffline();
    adminMocks.getCachedAnalyticsResponse.mockResolvedValue(undefined);

    const { fetchWorkerStatusOfflineAware } = await import('../offlineAdmin');

    await expect(fetchWorkerStatusOfflineAware()).rejects.toThrow(
      'System health data is unavailable offline. Reconnect to refresh this view.',
    );
  });
});
