/**
 * Tests for Issue #88: Scheduled Reports API client functions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Use hoisted mock to avoid top-level variable error in vi.mock
const { mockApiFetch } = vi.hoisted(() => {
  const mockApiFetch = vi.fn();
  return { mockApiFetch };
});

vi.mock('../transport', () => ({
  API_BASE: '/api',
  apiFetch: mockApiFetch,
  ApiRequestError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
      this.name = 'ApiRequestError';
    }
  },
  errorMessageFromJson: (_json: unknown, fallback: string) => fallback,
}));

import {
  fetchScheduledReports,
  createScheduledReport,
  updateScheduledReport,
  deleteScheduledReport,
} from '../legacy';

import type { ScheduledReport } from '../legacy';

describe('fetchScheduledReports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns array when API returns an array', async () => {
    const mockReports: ScheduledReport[] = [
      {
        id: 1,
        name: 'Weekly PDF',
        cron_expr: '0 7 * * 1',
        format: 'pdf',
        filters: {},
        recipients: ['admin@test.com'],
        enabled: true,
        created_at: '2026-01-01T00:00:00Z',
        last_run_at: null,
      },
    ];
    mockApiFetch.mockResolvedValue(mockReports);

    const result = await fetchScheduledReports();
    expect(result).toEqual(mockReports);
  });

  it('extracts data from wrapped response', async () => {
    const mockReports: ScheduledReport[] = [
      {
        id: 2,
        name: 'Daily CSV',
        cron_expr: '0 6 * * *',
        format: 'csv',
        filters: { region_id: 1 },
        recipients: [],
        enabled: false,
        created_at: '2026-01-02T00:00:00Z',
        last_run_at: '2026-01-03T06:00:00Z',
      },
    ];
    mockApiFetch.mockResolvedValue({ data: mockReports });

    const result = await fetchScheduledReports();
    expect(result).toEqual(mockReports);
  });

  it('throws on fetch error', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    await expect(fetchScheduledReports()).rejects.toThrow('Network error');
  });
});

describe('createScheduledReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends POST with correct body and returns created report', async () => {
    const body = {
      name: 'Weekly PDF',
      cron_expr: '0 7 * * 1',
      format: 'pdf' as const,
      filters: { region_id: 1 },
      recipients: ['admin@test.com'],
      enabled: true,
    };
    const created: ScheduledReport = {
      id: 3,
      ...body,
      created_at: '2026-06-14T00:00:00Z',
      last_run_at: null,
    };
    mockApiFetch.mockResolvedValue(created);

    const result = await createScheduledReport(body);
    expect(result).toEqual(created);
    expect(mockApiFetch).toHaveBeenCalledWith('/admin/scheduled-reports', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  });
});

describe('updateScheduledReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends PATCH to toggle enabled', async () => {
    const updated: ScheduledReport = {
      id: 1,
      name: 'Weekly PDF',
      cron_expr: '0 7 * * 1',
      format: 'pdf',
      filters: {},
      recipients: ['admin@test.com'],
      enabled: false,
      created_at: '2026-01-01T00:00:00Z',
      last_run_at: null,
    };
    mockApiFetch.mockResolvedValue(updated);

    const result = await updateScheduledReport(1, { enabled: false });
    expect(result.enabled).toBe(false);
  });
});

describe('deleteScheduledReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends DELETE and returns confirmation', async () => {
    mockApiFetch.mockResolvedValue({ status: 'ok', id: 1, deleted: true });
    const result = await deleteScheduledReport(1);
    expect(result.deleted).toBe(true);
    expect(mockApiFetch).toHaveBeenCalledWith('/admin/scheduled-reports/1', {
      method: 'DELETE',
    });
  });
});
