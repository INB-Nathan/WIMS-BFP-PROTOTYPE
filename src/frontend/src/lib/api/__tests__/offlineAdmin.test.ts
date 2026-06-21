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
  fetchAdminSecurityLogs: vi.fn(),
  fetchSecurityLogsSummary: vi.fn(),
  fetchAnomalies: vi.fn(),
  fetchBreaches: vi.fn(),
  fetchAdminConfig: vi.fn(),
  fetchRateLimits: vi.fn(),
  getReadCachedResponse: vi.fn(),
  cacheReadResponse: vi.fn(),
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
    fetchAdminSecurityLogs: adminMocks.fetchAdminSecurityLogs,
    fetchSecurityLogsSummary: adminMocks.fetchSecurityLogsSummary,
    fetchAnomalies: adminMocks.fetchAnomalies,
    fetchAdminConfig: adminMocks.fetchAdminConfig,
    fetchRateLimits: adminMocks.fetchRateLimits,
  };
});

vi.mock('../../offlineStore', () => ({
  getReadCachedResponse: adminMocks.getReadCachedResponse,
  cacheReadResponse: adminMocks.cacheReadResponse,
}));

vi.mock('../../connectivity', () => ({
  getConnectivitySnapshot: () => adminMocks.connectivitySnapshot,
  isReachable: adminMocks.isReachable,
  markConnectivityOffline: adminMocks.markConnectivityOffline,
}));

vi.mock('../breach', () => ({
  fetchBreaches: adminMocks.fetchBreaches,
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
    adminMocks.getReadCachedResponse.mockResolvedValue(undefined);
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
    adminMocks.cacheReadResponse.mockResolvedValue(undefined);

    const { fetchSystemHealthOfflineAware } = await import('../offlineAdmin');

    const result = await fetchSystemHealthOfflineAware();

    expect(result).toEqual({ response: mockHealth, fromCache: false });
    expect(adminMocks.fetchSystemHealth).toHaveBeenCalledTimes(1);
    expect(adminMocks.cacheReadResponse).toHaveBeenCalledTimes(1);
    expect(adminMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringMatching(/^admin:system-health:/),
      mockHealth,
      expect.any(Number),
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
    adminMocks.getReadCachedResponse.mockResolvedValue({
      key: 'admin:system-health:',
      data: mockHealth,
      cachedAt,
      ttlMs: 30_000,
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
    adminMocks.cacheReadResponse.mockResolvedValue(undefined);
    // Cached item exists but is 31 seconds old — beyond 30s TTL
    adminMocks.getReadCachedResponse.mockResolvedValue({
      key: 'admin:active-sessions:',
      data: mockSessions,
      cachedAt: Date.now() - 31_000,
      ttlMs: 30_000,
    });

    const { fetchActiveSessionsOfflineAware } = await import('../offlineAdmin');

    const result = await fetchActiveSessionsOfflineAware();

    // Should have re-fetched online since cache was stale
    expect(result.fromCache).toBe(false);
    expect(adminMocks.fetchActiveSessions).toHaveBeenCalledTimes(1);
    expect(adminMocks.cacheReadResponse).toHaveBeenCalledTimes(1);
  });

  it('serves fresh cache when offline and TTL is within 30s', async () => {
    goOffline();
    const cachedAt = Date.now() - 10_000;
    adminMocks.getReadCachedResponse.mockResolvedValue({
      key: 'admin:active-sessions:',
      data: mockSessions,
      cachedAt,
      ttlMs: 30_000,
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
    adminMocks.cacheReadResponse.mockResolvedValue(undefined);

    const { fetchAuditLogsOfflineAware } = await import('../offlineAdmin');

    await fetchAuditLogsOfflineAware({ limit: 50, offset: 0, q: 'test' });

    expect(adminMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringContaining('admin:audit-logs:'),
      mockAuditResponse,
      expect.any(Number),
    );
  });

  it('serves cached audit logs when offline', async () => {
    goOffline();
    const cachedAt = Date.now() - 5_000;
    adminMocks.getReadCachedResponse.mockResolvedValue({
      key: 'admin:audit-logs:{}',
      data: mockAuditResponse,
      cachedAt,
      ttlMs: 30_000,
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
    adminMocks.cacheReadResponse.mockResolvedValue(undefined);

    const { fetchSystemMetricsOfflineAware } = await import('../offlineAdmin');

    const result = await fetchSystemMetricsOfflineAware();

    expect(result).toEqual({ response: mockMetrics, fromCache: false });
    expect(adminMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringMatching(/^admin:system-metrics:/),
      mockMetrics,
      expect.any(Number),
    );
  });

  it('throws offline without cache', async () => {
    goOffline();
    adminMocks.getReadCachedResponse.mockResolvedValue(undefined);

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
    adminMocks.cacheReadResponse.mockResolvedValue(undefined);

    const { fetchWorkerStatusOfflineAware } = await import('../offlineAdmin');

    const result = await fetchWorkerStatusOfflineAware();

    expect(result).toEqual({ response: mockWorkers, fromCache: false });
    expect(adminMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringMatching(/^admin:worker-status:/),
      mockWorkers,
      expect.any(Number),
    );
  });

  it('throws offline without cache', async () => {
    goOffline();
    adminMocks.getReadCachedResponse.mockResolvedValue(undefined);

    const { fetchWorkerStatusOfflineAware } = await import('../offlineAdmin');

    await expect(fetchWorkerStatusOfflineAware()).rejects.toThrow(
      'System health data is unavailable offline. Reconnect to refresh this view.',
    );
  });
});

describe('fetchAdminSecurityLogsOfflineAware — security logs', () => {
  const mockLogEntry = { log_id: 1, severity_level: 'HIGH', classification: 'INTRUSION', source_ip: '10.0.0.1', timestamp: '2025-01-01T00:00:00Z', xai_narrative: null };
  const mockResponse = { items: [mockLogEntry], total: 1 };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caches and returns online security logs', async () => {
    goOnline();
    adminMocks.fetchAdminSecurityLogs.mockResolvedValue(mockResponse);
    adminMocks.cacheReadResponse.mockResolvedValue(undefined);

    const { fetchAdminSecurityLogsOfflineAware } = await import('../offlineAdmin');

    const result = await fetchAdminSecurityLogsOfflineAware();

    expect(result).toEqual({ response: mockResponse, fromCache: false });
    expect(adminMocks.fetchAdminSecurityLogs).toHaveBeenCalledTimes(1);
    expect(adminMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringMatching(/^admin:security-logs:/),
      mockResponse,
      expect.any(Number),
    );
  });

  it('throws offline without cache', async () => {
    goOffline();
    adminMocks.getReadCachedResponse.mockResolvedValue(undefined);

    const { fetchAdminSecurityLogsOfflineAware } = await import('../offlineAdmin');

    await expect(fetchAdminSecurityLogsOfflineAware()).rejects.toThrow(
      'System health data is unavailable offline. Reconnect to refresh this view.',
    );
  });

  it('serves fresh cached data when offline', async () => {
    goOffline();
    const cachedAt = Date.now() - 5_000;
    adminMocks.getReadCachedResponse.mockResolvedValue({
      key: 'admin:security-logs:',
      data: mockResponse,
      cachedAt,
      ttlMs: 60_000,
    });

    const { fetchAdminSecurityLogsOfflineAware } = await import('../offlineAdmin');

    const result = await fetchAdminSecurityLogsOfflineAware();

    expect(result).toEqual({ response: mockResponse, fromCache: true, cachedAt });
    expect(adminMocks.fetchAdminSecurityLogs).not.toHaveBeenCalled();
  });

  it('falls back to cache on network error', async () => {
    goOnline();
    const cachedAt = Date.now() - 5_000;
    adminMocks.fetchAdminSecurityLogs.mockRejectedValue(new TypeError('Failed to fetch'));
    adminMocks.getReadCachedResponse.mockResolvedValue({
      key: 'admin:security-logs:',
      data: mockResponse,
      cachedAt,
      ttlMs: 60_000,
    });

    const { fetchAdminSecurityLogsOfflineAware } = await import('../offlineAdmin');

    const result = await fetchAdminSecurityLogsOfflineAware();

    expect(result).toEqual({ response: mockResponse, fromCache: true, cachedAt });
    expect(adminMocks.fetchAdminSecurityLogs).toHaveBeenCalledTimes(1);
    expect(adminMocks.markConnectivityOffline).toHaveBeenCalled();
  });

  it('generates cache key with params', async () => {
    goOnline();
    adminMocks.fetchAdminSecurityLogs.mockResolvedValue(mockResponse);
    adminMocks.cacheReadResponse.mockResolvedValue(undefined);

    const { fetchAdminSecurityLogsOfflineAware } = await import('../offlineAdmin');

    await fetchAdminSecurityLogsOfflineAware({ severity: 'HIGH', limit: 10 });

    expect(adminMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringContaining('admin:security-logs:'),
      mockResponse,
      expect.any(Number),
    );
  });
});

describe('fetchSecurityLogsSummaryOfflineAware — logs summary', () => {
  const mockSummary = {
    by_severity: { LOW: 10, MEDIUM: 5, HIGH: 2, CRITICAL: 1 },
    unreviewed_count: 3,
    total: 18,
    recent_narratives: [{ log_id: 1, severity_level: 'HIGH', xai_narrative: null, timestamp: '2025-01-01T00:00:00Z' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caches and returns online summary', async () => {
    goOnline();
    adminMocks.fetchSecurityLogsSummary.mockResolvedValue(mockSummary);
    adminMocks.cacheReadResponse.mockResolvedValue(undefined);

    const { fetchSecurityLogsSummaryOfflineAware } = await import('../offlineAdmin');

    const result = await fetchSecurityLogsSummaryOfflineAware();

    expect(result).toEqual({ response: mockSummary, fromCache: false });
    expect(adminMocks.fetchSecurityLogsSummary).toHaveBeenCalledTimes(1);
    expect(adminMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringMatching(/^admin:security-logs-summary:/),
      mockSummary,
      expect.any(Number),
    );
  });

  it('throws offline without cache', async () => {
    goOffline();
    adminMocks.getReadCachedResponse.mockResolvedValue(undefined);

    const { fetchSecurityLogsSummaryOfflineAware } = await import('../offlineAdmin');

    await expect(fetchSecurityLogsSummaryOfflineAware()).rejects.toThrow(
      'System health data is unavailable offline. Reconnect to refresh this view.',
    );
  });

  it('serves fresh cached summary when offline', async () => {
    goOffline();
    const cachedAt = Date.now() - 5_000;
    adminMocks.getReadCachedResponse.mockResolvedValue({
      key: 'admin:security-logs-summary:',
      data: mockSummary,
      cachedAt,
      ttlMs: 60_000,
    });

    const { fetchSecurityLogsSummaryOfflineAware } = await import('../offlineAdmin');

    const result = await fetchSecurityLogsSummaryOfflineAware();

    expect(result).toEqual({ response: mockSummary, fromCache: true, cachedAt });
    expect(adminMocks.fetchSecurityLogsSummary).not.toHaveBeenCalled();
  });

  it('falls back to cache on network error', async () => {
    goOnline();
    const cachedAt = Date.now() - 5_000;
    adminMocks.fetchSecurityLogsSummary.mockRejectedValue(new TypeError('Failed to fetch'));
    adminMocks.getReadCachedResponse.mockResolvedValue({
      key: 'admin:security-logs-summary:',
      data: mockSummary,
      cachedAt,
      ttlMs: 60_000,
    });

    const { fetchSecurityLogsSummaryOfflineAware } = await import('../offlineAdmin');

    const result = await fetchSecurityLogsSummaryOfflineAware();

    expect(result).toEqual({ response: mockSummary, fromCache: true, cachedAt });
    expect(adminMocks.fetchSecurityLogsSummary).toHaveBeenCalledTimes(1);
    expect(adminMocks.markConnectivityOffline).toHaveBeenCalled();
  });
});

describe('fetchAnomaliesOfflineAware — anomalies', () => {
  const mockAnomaly = {
    anomaly_id: 1,
    anomaly_type: 'RATE_SPIKE',
    subject_user_id: null,
    severity: 'MEDIUM',
    details: {},
    detected_at: '2025-01-01T00:00:00Z',
    status: 'OPEN',
    dedup_key: 'dedup-1',
  };
  const mockResponse = { items: [mockAnomaly], total: 1, limit: 50, offset: 0, counts: {}, type_facets: [] };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caches and returns online anomalies', async () => {
    goOnline();
    adminMocks.fetchAnomalies.mockResolvedValue(mockResponse);
    adminMocks.cacheReadResponse.mockResolvedValue(undefined);

    const { fetchAnomaliesOfflineAware } = await import('../offlineAdmin');

    const result = await fetchAnomaliesOfflineAware();

    expect(result).toEqual({ response: mockResponse, fromCache: false });
    expect(adminMocks.fetchAnomalies).toHaveBeenCalledTimes(1);
    expect(adminMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringMatching(/^admin:anomalies:/),
      mockResponse,
      expect.any(Number),
    );
  });

  it('throws offline without cache', async () => {
    goOffline();
    adminMocks.getReadCachedResponse.mockResolvedValue(undefined);

    const { fetchAnomaliesOfflineAware } = await import('../offlineAdmin');

    await expect(fetchAnomaliesOfflineAware()).rejects.toThrow(
      'System health data is unavailable offline. Reconnect to refresh this view.',
    );
  });

  it('serves fresh cached anomalies when offline', async () => {
    goOffline();
    const cachedAt = Date.now() - 5_000;
    adminMocks.getReadCachedResponse.mockResolvedValue({
      key: 'admin:anomalies:',
      data: mockResponse,
      cachedAt,
      ttlMs: 60_000,
    });

    const { fetchAnomaliesOfflineAware } = await import('../offlineAdmin');

    const result = await fetchAnomaliesOfflineAware();

    expect(result).toEqual({ response: mockResponse, fromCache: true, cachedAt });
    expect(adminMocks.fetchAnomalies).not.toHaveBeenCalled();
  });

  it('generates cache key with anomaly params', async () => {
    goOnline();
    adminMocks.fetchAnomalies.mockResolvedValue(mockResponse);
    adminMocks.cacheReadResponse.mockResolvedValue(undefined);

    const { fetchAnomaliesOfflineAware } = await import('../offlineAdmin');

    await fetchAnomaliesOfflineAware({ severity: 'HIGH', limit: 20 });

    expect(adminMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringContaining('admin:anomalies:'),
      mockResponse,
      expect.any(Number),
    );
  });
});

describe('fetchBreachesOfflineAware — breaches', () => {
  const mockBreach = {
    breach_id: 1,
    threat_log_id: 1,
    detected_at: '2025-01-01T00:00:00Z',
    npc_deadline_at: '2025-02-01T00:00:00Z',
    status: 'DETECTED' as const,
    affected_systems: null,
    data_scope: null,
    notes: null,
    reported_by: null,
    npc_submitted_at: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };
  const mockResponse = [mockBreach];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caches and returns online breaches', async () => {
    goOnline();
    adminMocks.fetchBreaches.mockResolvedValue(mockResponse);
    adminMocks.cacheReadResponse.mockResolvedValue(undefined);

    const { fetchBreachesOfflineAware } = await import('../offlineAdmin');

    const result = await fetchBreachesOfflineAware();

    expect(result).toEqual({ response: mockResponse, fromCache: false });
    expect(adminMocks.fetchBreaches).toHaveBeenCalledTimes(1);
    expect(adminMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringMatching(/^admin:breaches:/),
      mockResponse,
      expect.any(Number),
    );
  });

  it('throws offline without cache', async () => {
    goOffline();
    adminMocks.getReadCachedResponse.mockResolvedValue(undefined);

    const { fetchBreachesOfflineAware } = await import('../offlineAdmin');

    await expect(fetchBreachesOfflineAware()).rejects.toThrow(
      'System health data is unavailable offline. Reconnect to refresh this view.',
    );
  });

  it('serves fresh cached breaches when offline', async () => {
    goOffline();
    const cachedAt = Date.now() - 5_000;
    adminMocks.getReadCachedResponse.mockResolvedValue({
      key: 'admin:breaches:',
      data: mockResponse,
      cachedAt,
      ttlMs: 60_000,
    });

    const { fetchBreachesOfflineAware } = await import('../offlineAdmin');

    const result = await fetchBreachesOfflineAware();

    expect(result).toEqual({ response: mockResponse, fromCache: true, cachedAt });
    expect(adminMocks.fetchBreaches).not.toHaveBeenCalled();
  });

  it('falls back to cache on network error', async () => {
    goOnline();
    const cachedAt = Date.now() - 5_000;
    adminMocks.fetchBreaches.mockRejectedValue(new TypeError('Failed to fetch'));
    adminMocks.getReadCachedResponse.mockResolvedValue({
      key: 'admin:breaches:',
      data: mockResponse,
      cachedAt,
      ttlMs: 60_000,
    });

    const { fetchBreachesOfflineAware } = await import('../offlineAdmin');

    const result = await fetchBreachesOfflineAware();

    expect(result).toEqual({ response: mockResponse, fromCache: true, cachedAt });
    expect(adminMocks.fetchBreaches).toHaveBeenCalledTimes(1);
    expect(adminMocks.markConnectivityOffline).toHaveBeenCalled();
  });
});

describe('fetchAdminConfigOfflineAware — system config', () => {
  const mockEntry = { key: 'npc_email', value: 'npc@bfp.gov.ph', description: 'NPC notification email', updated_by: null, updated_at: null };
  const mockResponse = [mockEntry];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caches and returns online system config', async () => {
    goOnline();
    adminMocks.fetchAdminConfig.mockResolvedValue(mockResponse);
    adminMocks.cacheReadResponse.mockResolvedValue(undefined);

    const { fetchAdminConfigOfflineAware } = await import('../offlineAdmin');

    const result = await fetchAdminConfigOfflineAware();

    expect(result).toEqual({ response: mockResponse, fromCache: false });
    expect(adminMocks.fetchAdminConfig).toHaveBeenCalledTimes(1);
    expect(adminMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringMatching(/^admin:system-config:/),
      mockResponse,
      expect.any(Number),
    );
  });

  it('throws offline without cache', async () => {
    goOffline();
    adminMocks.getReadCachedResponse.mockResolvedValue(undefined);

    const { fetchAdminConfigOfflineAware } = await import('../offlineAdmin');

    await expect(fetchAdminConfigOfflineAware()).rejects.toThrow(
      'System health data is unavailable offline. Reconnect to refresh this view.',
    );
  });

  it('serves fresh cached config when offline', async () => {
    goOffline();
    const cachedAt = Date.now() - 5_000;
    adminMocks.getReadCachedResponse.mockResolvedValue({
      key: 'admin:system-config:',
      data: mockResponse,
      cachedAt,
      ttlMs: 30 * 60 * 1000,
    });

    const { fetchAdminConfigOfflineAware } = await import('../offlineAdmin');

    const result = await fetchAdminConfigOfflineAware();

    expect(result).toEqual({ response: mockResponse, fromCache: true, cachedAt });
    expect(adminMocks.fetchAdminConfig).not.toHaveBeenCalled();
  });

  it('re-fetches when cached config is stale (beyond 30min TTL)', async () => {
    goOnline();
    adminMocks.fetchAdminConfig.mockResolvedValue(mockResponse);
    adminMocks.cacheReadResponse.mockResolvedValue(undefined);
    // Cached but 31 minutes old — beyond 30min TTL
    adminMocks.getReadCachedResponse.mockResolvedValue({
      key: 'admin:system-config:',
      data: mockResponse,
      cachedAt: Date.now() - 31 * 60 * 1000,
      ttlMs: 30 * 60 * 1000,
    });

    const { fetchAdminConfigOfflineAware } = await import('../offlineAdmin');

    const result = await fetchAdminConfigOfflineAware();

    expect(result.fromCache).toBe(false);
    expect(adminMocks.fetchAdminConfig).toHaveBeenCalledTimes(1);
    expect(adminMocks.cacheReadResponse).toHaveBeenCalledTimes(1);
  });
});

describe('fetchRateLimitsOfflineAware — rate limits', () => {
  const mockResponse = { tier: 'default', login_window_seconds: 300, login_threshold: 5, updated_at: null };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caches and returns online rate limits', async () => {
    goOnline();
    adminMocks.fetchRateLimits.mockResolvedValue(mockResponse);
    adminMocks.cacheReadResponse.mockResolvedValue(undefined);

    const { fetchRateLimitsOfflineAware } = await import('../offlineAdmin');

    const result = await fetchRateLimitsOfflineAware();

    expect(result).toEqual({ response: mockResponse, fromCache: false });
    expect(adminMocks.fetchRateLimits).toHaveBeenCalledTimes(1);
    expect(adminMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringMatching(/^admin:rate-limits:/),
      mockResponse,
      expect.any(Number),
    );
  });

  it('throws offline without cache', async () => {
    goOffline();
    adminMocks.getReadCachedResponse.mockResolvedValue(undefined);

    const { fetchRateLimitsOfflineAware } = await import('../offlineAdmin');

    await expect(fetchRateLimitsOfflineAware()).rejects.toThrow(
      'System health data is unavailable offline. Reconnect to refresh this view.',
    );
  });

  it('serves fresh cached rate limits when offline', async () => {
    goOffline();
    const cachedAt = Date.now() - 5_000;
    adminMocks.getReadCachedResponse.mockResolvedValue({
      key: 'admin:rate-limits:',
      data: mockResponse,
      cachedAt,
      ttlMs: 30 * 60 * 1000,
    });

    const { fetchRateLimitsOfflineAware } = await import('../offlineAdmin');

    const result = await fetchRateLimitsOfflineAware();

    expect(result).toEqual({ response: mockResponse, fromCache: true, cachedAt });
    expect(adminMocks.fetchRateLimits).not.toHaveBeenCalled();
  });

  it('falls back to cache on network error', async () => {
    goOnline();
    const cachedAt = Date.now() - 5_000;
    adminMocks.fetchRateLimits.mockRejectedValue(new TypeError('Failed to fetch'));
    adminMocks.getReadCachedResponse.mockResolvedValue({
      key: 'admin:rate-limits:',
      data: mockResponse,
      cachedAt,
      ttlMs: 30 * 60 * 1000,
    });

    const { fetchRateLimitsOfflineAware } = await import('../offlineAdmin');

    const result = await fetchRateLimitsOfflineAware();

    expect(result).toEqual({ response: mockResponse, fromCache: true, cachedAt });
    expect(adminMocks.fetchRateLimits).toHaveBeenCalledTimes(1);
    expect(adminMocks.markConnectivityOffline).toHaveBeenCalled();
  });
});
