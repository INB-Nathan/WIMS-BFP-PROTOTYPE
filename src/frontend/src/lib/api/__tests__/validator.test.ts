/**
 * Tests for Task 3: validator API abstraction — fetchOperationalMap + fetchValidatorAuditLogs.
 *
 * Mocks `../transport` (the module that provides `apiFetch`) so calls to the
 * real fetch never execute. Asserts URL shape matches the inline patterns in
 * the validator pages verbatim.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../transport', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../transport';
import {
  type AuditResponse,
  fetchOperationalMap,
  fetchValidatorAuditLogs,
} from '../validator';
import type { MapClusterItem } from '../map';

describe('validator API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetchOperationalMap builds URLSearchParams and calls apiFetch', async () => {
    const mockCluster: MapClusterItem = {
      lat: 10.5,
      lng: 120.5,
      count: 3,
      severity: 'low',
      latest_at: '2025-06-01T00:00:00Z',
    };
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      clusters: [mockCluster],
    });

    const result = await fetchOperationalMap({
      sw: [10.0, 120.0] as [number, number],
      ne: [11.0, 121.0] as [number, number],
      zoom: 12,
      status: 'active',
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const callUrl = (apiFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(callUrl).toContain('/api/validator/operational-map?');
    expect(callUrl).toContain('sw_lat=');
    expect(callUrl).toContain('sw_lng=');
    expect(callUrl).toContain('ne_lat=');
    expect(callUrl).toContain('ne_lng=');
    expect(callUrl).toContain('zoom=');
    expect(callUrl).toContain('status_filter=');
    expect(result).toEqual([mockCluster]);
  });

  it('fetchValidatorAuditLogs builds URLSearchParams and calls apiFetch', async () => {
    const mockResponse: AuditResponse = {
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
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await fetchValidatorAuditLogs({
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
      regionId: '13',
      actorUsername: 'jdoe',
      roleFilter: 'NATIONAL_VALIDATOR',
      action: 'APPROVED',
      page: 0,
      pageSize: 50,
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const callUrl = (apiFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(callUrl).toContain('/regional/validator/audit-logs?');
    expect(callUrl).toContain('date_from=');
    expect(callUrl).toContain('date_to=');
    expect(callUrl).toContain('region_id=');
    expect(callUrl).toContain('actor_username=');
    expect(callUrl).toContain('role=');
    expect(callUrl).toContain('action=');
    expect(callUrl).toContain('limit=');
    expect(callUrl).toContain('offset=');
    expect(result).toEqual(mockResponse);
  });
});
