/**
 * offlineValidator reproduction test — GH #269 Validator Dashboard Offline Wiring
 *
 * Verifies that submitVerificationOfflineAware() queues a 'verify' op
 * via queueIncident when the connectivity state is 'offline', bypassing
 * the network entirely. The queued payload is structured so the existing
 * syncEngine processVerify dispatch can replay it on reconnect.
 *
 * This test MUST fail on the unmodified base commit because the
 * submitVerificationOfflineAware function does not exist yet.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock connectivity ──────────────────────────────────────────────
const connectivityMocks = vi.hoisted(() => ({
  connectivitySnapshot: {
    state: 'offline' as const,
    isOnline: false,
    isChecking: false,
    isReconnecting: false,
    lastCheckedAt: null as number | null,
  },
  markConnectivityOffline: vi.fn(),
}));

vi.mock('../connectivity', () => ({
  getConnectivitySnapshot: () => connectivityMocks.connectivitySnapshot,
  markConnectivityOffline: connectivityMocks.markConnectivityOffline,
}));

// ── Mock offlineStore ──────────────────────────────────────────────
const offlineStoreMocks = vi.hoisted(() => ({
  queueIncident: vi.fn(),
  getReadCachedResponse: vi.fn(),
  cacheReadResponse: vi.fn(),
}));

vi.mock('../offlineStore', () => ({
  cacheReadResponse: offlineStoreMocks.cacheReadResponse,
  getReadCachedResponse: offlineStoreMocks.getReadCachedResponse,
  queueIncident: offlineStoreMocks.queueIncident,
}));

// ── Mock ./validator (the API barrel) — keep other re-exports intact ─
const validatorApiMocks = vi.hoisted(() => ({
  fetchOperationalMap: vi.fn(),
  fetchValidatorAuditLogs: vi.fn(),
}));

vi.mock('../api/validator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/validator')>();
  return {
    ...actual,
    fetchOperationalMap: validatorApiMocks.fetchOperationalMap,
    fetchValidatorAuditLogs: validatorApiMocks.fetchValidatorAuditLogs,
  };
});

// ── Tests ──────────────────────────────────────────────────────────
describe('submitVerificationOfflineAware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectivityMocks.connectivitySnapshot.state = 'offline';
    connectivityMocks.connectivitySnapshot.isOnline = false;
    offlineStoreMocks.queueIncident.mockResolvedValue(undefined);
  });

  it('queues a verify op with localId and full payload when offline', async () => {
    // Dynamic import from the barrel — validator.ts will re-export from
    // offlineValidator.ts once implemented. Currently fails on import.
    const { submitVerificationOfflineAware } = await import('../api/offlineValidator');

    const result = await submitVerificationOfflineAware(
      42,           // incident_id
      'accept',     // action
      'Looks good', // notes
    );

    // Must queue via offlineStore, not attempt a network request.
    expect(offlineStoreMocks.queueIncident).toHaveBeenCalledTimes(1);

    const [payload, options] = offlineStoreMocks.queueIncident.mock.calls[0];

    // Payload must contain the verification data the sync engine will replay.
    expect(payload).toEqual({
      incident_id: 42,
      action: 'accept',
      notes: 'Looks good',
    });

    // Metadata must mark this as a verify op so syncEngine dispatches
    // to processVerify (PATCH /regional/incidents/{id}/verification).
    expect(options.opType).toBe('verify');

    // Must generate a localId for server-side idempotency (sent as client_id).
    expect(typeof options.localId).toBe('string');
    expect(options.localId!.length).toBeGreaterThan(0);

    // Must return queue acknowledgement so the page can show a toast
    // indicating the verification is queued for sync.
    expect(result).toHaveProperty('queued', true);
    expect(result).toHaveProperty('localId', options.localId);
  });

  it('includes original_incident_id when queuing accept_replace offline', async () => {
    const { submitVerificationOfflineAware } = await import('../api/offlineValidator');

    await submitVerificationOfflineAware(
      42,
      'accept_replace',
      'Replace duplicate',
      7,
    );

    expect(offlineStoreMocks.queueIncident).toHaveBeenCalledTimes(1);
    const [payload, options] = offlineStoreMocks.queueIncident.mock.calls[0];

    expect(payload).toEqual({
      incident_id: 42,
      action: 'accept_replace',
      notes: 'Replace duplicate',
      original_incident_id: 7,
    });
    expect(options.opType).toBe('verify');
  });
});

// ── Archive / Unarchive offline queuing ──────────────────────────

describe('archiveIncidentOfflineAware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectivityMocks.connectivitySnapshot.state = 'offline';
    connectivityMocks.connectivitySnapshot.isOnline = false;
    offlineStoreMocks.queueIncident.mockResolvedValue(undefined);
  });

  it('queues an archive_action op with incident_id and action=archive when offline', async () => {
    const { archiveIncidentOfflineAware } = await import('../api/offlineValidator');

    const result = await archiveIncidentOfflineAware(99);

    expect(offlineStoreMocks.queueIncident).toHaveBeenCalledTimes(1);

    const [payload, options] = offlineStoreMocks.queueIncident.mock.calls[0];

    expect(payload).toEqual({
      incident_id: 99,
      action: 'archive',
    });

    expect(options.opType).toBe('archive_action');
    expect(typeof options.localId).toBe('string');
    expect(options.localId!.length).toBeGreaterThan(0);

    expect(result).toHaveProperty('queued', true);
    expect(result).toHaveProperty('localId', options.localId);
  });
});

describe('unarchiveIncidentOfflineAware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectivityMocks.connectivitySnapshot.state = 'offline';
    connectivityMocks.connectivitySnapshot.isOnline = false;
    offlineStoreMocks.queueIncident.mockResolvedValue(undefined);
  });

  it('queues an archive_action op with incident_id and action=unarchive when offline', async () => {
    const { unarchiveIncidentOfflineAware } = await import('../api/offlineValidator');

    const result = await unarchiveIncidentOfflineAware(101);

    expect(offlineStoreMocks.queueIncident).toHaveBeenCalledTimes(1);

    const [payload, options] = offlineStoreMocks.queueIncident.mock.calls[0];

    expect(payload).toEqual({
      incident_id: 101,
      action: 'unarchive',
    });

    expect(options.opType).toBe('archive_action');
    expect(typeof options.localId).toBe('string');
    expect(options.localId!.length).toBeGreaterThan(0);

    expect(result).toHaveProperty('queued', true);
    expect(result).toHaveProperty('localId', options.localId);
  });
});

// ── Task 6: encrypted read wrappers (offlineValidator map + audit) ──

// Helpers shared by the 2 new wrapper describe blocks.
function goOnline() {
  (connectivityMocks.connectivitySnapshot.state as 'online' | 'offline') = 'online';
  connectivityMocks.connectivitySnapshot.isOnline = true;
}

function goOffline() {
  (connectivityMocks.connectivitySnapshot.state as 'online' | 'offline') = 'offline';
  connectivityMocks.connectivitySnapshot.isOnline = false;
}

describe('fetchOperationalMapOfflineAware — operational map clusters', () => {
  const mockClusters = [
    {
      lat: 10.5,
      lng: 120.5,
      count: 3,
      severity: 'low' as const,
      latest_at: '2025-06-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caches and returns online operational map clusters', async () => {
    goOnline();
    validatorApiMocks.fetchOperationalMap.mockResolvedValue(mockClusters);
    offlineStoreMocks.cacheReadResponse.mockResolvedValue(undefined);

    const { fetchOperationalMapOfflineAware } = await import('../api/offlineValidator');

    const result = await fetchOperationalMapOfflineAware({
      sw: [10.0, 120.0],
      ne: [11.0, 121.0],
      zoom: 12,
      status: 'active',
    });

    expect(result).toEqual({ response: mockClusters, fromCache: false });
    expect(validatorApiMocks.fetchOperationalMap).toHaveBeenCalledTimes(1);
    expect(validatorApiMocks.fetchOperationalMap).toHaveBeenCalledWith({
      sw: [10.0, 120.0],
      ne: [11.0, 121.0],
      zoom: 12,
      status: 'active',
    });
    expect(offlineStoreMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringMatching(/^validator:operational-map:/),
      mockClusters,
      expect.any(Number),
    );
  });

  it('throws offline without cache', async () => {
    goOffline();
    offlineStoreMocks.getReadCachedResponse.mockResolvedValue(undefined);

    const { fetchOperationalMapOfflineAware } = await import('../api/offlineValidator');

    await expect(
      fetchOperationalMapOfflineAware({
        sw: [10.0, 120.0],
        ne: [11.0, 121.0],
        zoom: 12,
      }),
    ).rejects.toThrow(
      'Validator operational map is unavailable offline. Reconnect to refresh this view.',
    );

    expect(validatorApiMocks.fetchOperationalMap).not.toHaveBeenCalled();
  });

  it('serves fresh cached clusters when offline', async () => {
    goOffline();
    const cachedAt = Date.now() - 5_000;
    offlineStoreMocks.getReadCachedResponse.mockResolvedValue({
      key: 'validator:operational-map:',
      data: mockClusters,
      cachedAt,
      ttlMs: 60_000,
    });

    const { fetchOperationalMapOfflineAware } = await import('../api/offlineValidator');

    const result = await fetchOperationalMapOfflineAware({
      sw: [10.0, 120.0],
      ne: [11.0, 121.0],
      zoom: 12,
    });

    expect(result).toEqual({ response: mockClusters, fromCache: true, cachedAt });
    expect(validatorApiMocks.fetchOperationalMap).not.toHaveBeenCalled();
  });

  it('falls back to cache on network error', async () => {
    goOnline();
    const cachedAt = Date.now() - 5_000;
    validatorApiMocks.fetchOperationalMap.mockRejectedValue(new TypeError('Failed to fetch'));
    offlineStoreMocks.getReadCachedResponse.mockResolvedValue({
      key: 'validator:operational-map:',
      data: mockClusters,
      cachedAt,
      ttlMs: 60_000,
    });

    const { fetchOperationalMapOfflineAware } = await import('../api/offlineValidator');

    const result = await fetchOperationalMapOfflineAware({
      sw: [10.0, 120.0],
      ne: [11.0, 121.0],
      zoom: 12,
    });

    expect(result).toEqual({ response: mockClusters, fromCache: true, cachedAt });
    expect(validatorApiMocks.fetchOperationalMap).toHaveBeenCalledTimes(1);
    expect(connectivityMocks.markConnectivityOffline).toHaveBeenCalled();
  });

  it('generates cache key with map params (60s TTL)', async () => {
    goOnline();
    validatorApiMocks.fetchOperationalMap.mockResolvedValue(mockClusters);
    offlineStoreMocks.cacheReadResponse.mockResolvedValue(undefined);

    const { fetchOperationalMapOfflineAware } = await import('../api/offlineValidator');

    await fetchOperationalMapOfflineAware({
      sw: [10.0, 120.0],
      ne: [11.0, 121.0],
      zoom: 12,
      status: 'active',
    });

    expect(offlineStoreMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringContaining('validator:operational-map:'),
      mockClusters,
      60_000,
    );
  });
});

describe('fetchValidatorAuditLogsOfflineAware — audit logs', () => {
  const mockAuditResponse = {
    items: [
      {
        history_id: 1,
        incident_id: 42,
        region_id: 13,
        region_display: 'Region 13',
        action_by_user_id: 'u1',
        actor_username: 'jdoe',
        previous_status: 'PENDING',
        new_status: 'APPROVED',
        action_label: 'Approved',
        notes: null,
        action_timestamp: '2025-06-01T00:00:00Z',
      },
    ],
    total: 1,
    limit: 50,
    offset: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caches and returns online audit logs', async () => {
    goOnline();
    validatorApiMocks.fetchValidatorAuditLogs.mockResolvedValue(mockAuditResponse);
    offlineStoreMocks.cacheReadResponse.mockResolvedValue(undefined);

    const { fetchValidatorAuditLogsOfflineAware } = await import('../api/offlineValidator');

    const result = await fetchValidatorAuditLogsOfflineAware({
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
      regionId: '13',
    });

    expect(result).toEqual({ response: mockAuditResponse, fromCache: false });
    expect(validatorApiMocks.fetchValidatorAuditLogs).toHaveBeenCalledTimes(1);
    expect(offlineStoreMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringMatching(/^validator:audit-logs:/),
      mockAuditResponse,
      expect.any(Number),
    );
  });

  it('throws offline without cache', async () => {
    goOffline();
    offlineStoreMocks.getReadCachedResponse.mockResolvedValue(undefined);

    const { fetchValidatorAuditLogsOfflineAware } = await import('../api/offlineValidator');

    await expect(
      fetchValidatorAuditLogsOfflineAware({ dateFrom: '2025-01-01' }),
    ).rejects.toThrow(
      'Validator audit logs are unavailable offline. Reconnect to refresh this view.',
    );

    expect(validatorApiMocks.fetchValidatorAuditLogs).not.toHaveBeenCalled();
  });

  it('serves fresh cached audit logs when offline', async () => {
    goOffline();
    const cachedAt = Date.now() - 5_000;
    offlineStoreMocks.getReadCachedResponse.mockResolvedValue({
      key: 'validator:audit-logs:',
      data: mockAuditResponse,
      cachedAt,
      ttlMs: 60_000,
    });

    const { fetchValidatorAuditLogsOfflineAware } = await import('../api/offlineValidator');

    const result = await fetchValidatorAuditLogsOfflineAware({ dateFrom: '2025-01-01' });

    expect(result).toEqual({ response: mockAuditResponse, fromCache: true, cachedAt });
    expect(validatorApiMocks.fetchValidatorAuditLogs).not.toHaveBeenCalled();
  });

  it('falls back to cache on network error', async () => {
    goOnline();
    const cachedAt = Date.now() - 5_000;
    validatorApiMocks.fetchValidatorAuditLogs.mockRejectedValue(new TypeError('Failed to fetch'));
    offlineStoreMocks.getReadCachedResponse.mockResolvedValue({
      key: 'validator:audit-logs:',
      data: mockAuditResponse,
      cachedAt,
      ttlMs: 60_000,
    });

    const { fetchValidatorAuditLogsOfflineAware } = await import('../api/offlineValidator');

    const result = await fetchValidatorAuditLogsOfflineAware({ dateFrom: '2025-01-01' });

    expect(result).toEqual({ response: mockAuditResponse, fromCache: true, cachedAt });
    expect(validatorApiMocks.fetchValidatorAuditLogs).toHaveBeenCalledTimes(1);
    expect(connectivityMocks.markConnectivityOffline).toHaveBeenCalled();
  });

  it('generates cache key with audit log params (60s TTL)', async () => {
    goOnline();
    validatorApiMocks.fetchValidatorAuditLogs.mockResolvedValue(mockAuditResponse);
    offlineStoreMocks.cacheReadResponse.mockResolvedValue(undefined);

    const { fetchValidatorAuditLogsOfflineAware } = await import('../api/offlineValidator');

    await fetchValidatorAuditLogsOfflineAware({
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
      regionId: '13',
      actorUsername: 'jdoe',
      action: 'APPROVED',
    });

    expect(offlineStoreMocks.cacheReadResponse).toHaveBeenCalledWith(
      expect.stringContaining('validator:audit-logs:'),
      mockAuditResponse,
      60_000,
    );
  });
});

