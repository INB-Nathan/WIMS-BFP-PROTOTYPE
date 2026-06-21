import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConnectivity = vi.hoisted(() => ({
  online: false,
  reachable: false,
  fetchRegionalIncidents: vi.fn(),
  fetchRegionalIncident: vi.fn(),
  getCachedIncidents: vi.fn(),
  getCachedIncident: vi.fn(),
  getOfflineOpByServerId: vi.fn(),
}));

vi.mock('../api/legacy', () => ({
  fetchRegionalIncidents: mockConnectivity.fetchRegionalIncidents,
  fetchRegionalIncident: mockConnectivity.fetchRegionalIncident,
}));

vi.mock('../offlineStore', () => ({
  cacheIncident: vi.fn(),
  getCachedIncidents: mockConnectivity.getCachedIncidents,
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

import {
  fetchRegionalIncidentOfflineAware,
  fetchRegionalIncidentsOfflineAware,
} from '../api/offlineRegional';

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

describe('fetchRegionalIncidentsOfflineAware — cached list filters', () => {
  // Build a small mixed fixture of cached list items that exercises every
  // filter axis (status, category, date, archived).
  const makeCached = () => [
    {
      incidentId: 1,
      encoderId: 'enc-1',
      cachedAt: 1000,
      data: {
        incident_id: 1,
        verification_status: 'DRAFT',
        general_category: 'STRUCTURAL',
        notification_dt: '2026-06-10T08:00:00Z',
        created_at: '2026-06-10T08:00:00Z',
        is_archived: false,
      },
    },
    {
      incidentId: 2,
      encoderId: 'enc-1',
      cachedAt: 2000,
      data: {
        incident_id: 2,
        verification_status: 'VERIFIED',
        general_category: 'STRUCTURAL',
        notification_dt: '2026-06-12T08:00:00Z',
        created_at: '2026-06-12T08:00:00Z',
        is_archived: false,
      },
    },
    {
      incidentId: 3,
      encoderId: 'enc-1',
      cachedAt: 3000,
      data: {
        incident_id: 3,
        verification_status: 'DRAFT',
        general_category: 'NON_STRUCTURAL',
        notification_dt: '2026-06-15T08:00:00Z',
        created_at: '2026-06-15T08:00:00Z',
        is_archived: false,
      },
    },
    {
      incidentId: 4,
      encoderId: 'enc-1',
      cachedAt: 4000,
      data: {
        incident_id: 4,
        verification_status: 'PENDING',
        general_category: 'VEHICULAR',
        notification_dt: '2026-06-20T08:00:00Z',
        created_at: '2026-06-20T08:00:00Z',
        is_archived: false,
      },
    },
    {
      incidentId: 5,
      encoderId: 'enc-1',
      cachedAt: 5000,
      data: {
        incident_id: 5,
        verification_status: 'VERIFIED',
        general_category: 'STRUCTURAL',
        notification_dt: '2026-05-01T08:00:00Z',
        created_at: '2026-05-01T08:00:00Z',
        is_archived: true,
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectivity.online = false;
    mockConnectivity.reachable = false;
    mockConnectivity.getCachedIncidents.mockResolvedValue(makeCached());
  });

  it('returns the full cached list when no filters are provided (active view)', async () => {
    const result = await fetchRegionalIncidentsOfflineAware(undefined, 'enc-1');

    expect(result.fromCache).toBe(true);
    // Default view excludes the archived item (#5).
    const ids = result.response.items.map((i) => i.incident_id);
    expect(ids.sort()).toEqual([1, 2, 3, 4]);
  });

  it('filters cached list by status', async () => {
    const result = await fetchRegionalIncidentsOfflineAware(
      { status: 'DRAFT' },
      'enc-1',
    );

    const ids = result.response.items.map((i) => i.incident_id);
    expect(ids.sort()).toEqual([1, 3]);
    for (const item of result.response.items) {
      expect(item.verification_status).toBe('DRAFT');
    }
  });

  it('filters cached list by category', async () => {
    const result = await fetchRegionalIncidentsOfflineAware(
      { category: 'STRUCTURAL' },
      'enc-1',
    );

    const ids = result.response.items.map((i) => i.incident_id);
    expect(ids.sort()).toEqual([1, 2]);
    for (const item of result.response.items) {
      expect(item.general_category).toBe('STRUCTURAL');
    }
  });

  it('combines status and category filters (AND)', async () => {
    const result = await fetchRegionalIncidentsOfflineAware(
      { status: 'VERIFIED', category: 'STRUCTURAL' },
      'enc-1',
    );

    const ids = result.response.items.map((i) => i.incident_id);
    expect(ids).toEqual([2]);
  });

  it('filters cached list by date range (date_from inclusive, date_to inclusive)', async () => {
    const result = await fetchRegionalIncidentsOfflineAware(
      {
        date_from: '2026-06-11T00:00:00Z',
        date_to: '2026-06-19T23:59:59Z',
      },
      'enc-1',
    );

    // Items in [2026-06-11, 2026-06-19]: #2 (Jun 12), #3 (Jun 15).
    const ids = result.response.items.map((i) => i.incident_id);
    expect(ids.sort()).toEqual([2, 3]);
  });

  it('filters cached list by archived flag (true = archived only)', async () => {
    const result = await fetchRegionalIncidentsOfflineAware(
      { archived: true },
      'enc-1',
    );

    const ids = result.response.items.map((i) => i.incident_id);
    expect(ids).toEqual([5]);
  });

  it('filters cached list by archived flag (false / omitted = active only)', async () => {
    const result = await fetchRegionalIncidentsOfflineAware(
      { archived: false },
      'enc-1',
    );

    const ids = result.response.items.map((i) => i.incident_id);
    expect(ids.sort()).toEqual([1, 2, 3, 4]);
    for (const item of result.response.items) {
      expect((item as unknown as { is_archived?: boolean }).is_archived).toBeFalsy();
    }
  });

  it('returns empty list when filters match nothing', async () => {
    const result = await fetchRegionalIncidentsOfflineAware(
      { status: 'REJECTED' },
      'enc-1',
    );

    expect(result.fromCache).toBe(true);
    expect(result.response.items).toEqual([]);
    expect(result.response.total).toBe(0);
  });

  it('reports the newest cachedAt from the cache set (not the oldest)', async () => {
    const result = await fetchRegionalIncidentsOfflineAware(
      { status: 'DRAFT' },
      'enc-1',
    );

    // Cache fixture has cachedAt values 1000..5000, newest = 5000.
    expect(result.cachedAt).toBe(5000);
  });

  it('never calls the online list API in the offline branch', async () => {
    await fetchRegionalIncidentsOfflineAware({ status: 'DRAFT' }, 'enc-1');

    expect(mockConnectivity.fetchRegionalIncidents).not.toHaveBeenCalled();
  });
});
