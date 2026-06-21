import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import AnalystWorkflowPage from './page';

const mockReplace = vi.fn();
const mockPush = vi.fn();
const mockFetchAnalystIncidentList = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useParams: () => ({ workflow: 'incident-explorer' }),
  // Return a fresh object every render to match the unstable identity pattern
  // that can happen around App Router query updates.
  useSearchParams: () => new URLSearchParams('transfer=transfer-1'),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'analyst-1', role: 'NATIONAL_ANALYST' },
    loading: false,
    loggingOut: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
  }),
}));

vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isReconnecting: false }),
}));

vi.mock('@/lib/useAutoSync', () => ({
  useAutoSync: () => ({ syncing: false, lastSyncedAt: null, pendingCount: 0, syncNow: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({
  fetchRegions: vi.fn().mockResolvedValue([]),
  fetchAnalyticsFilterOptionsOfflineAware: vi.fn().mockResolvedValue({ response: [], fromCache: false }),
  fetchComparativeDataOfflineAware: vi.fn().mockResolvedValue({
    response: {
      range_a: { start: '2024-01-01', end: '2024-01-15', count: 1 },
      range_b: { start: '2024-01-16', end: '2024-01-31', count: 2 },
      variance_percent: 100,
    },
    fromCache: false,
  }),
  fetchHeatmapDataOfflineAware: vi.fn().mockResolvedValue({ response: { type: 'FeatureCollection', features: [] }, fromCache: false }),
  fetchResponseTimeByRegionOfflineAware: vi.fn().mockResolvedValue({ response: [], fromCache: false }),
  fetchTopNOfflineAware: vi.fn().mockResolvedValue({ response: [], fromCache: false }),
  fetchTrendDataOfflineAware: vi.fn().mockResolvedValue({ response: { data: [] }, fromCache: false }),
  fetchAnalystIncidentList: (params: object) => mockFetchAnalystIncidentList(params),
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.sessionStorage.setItem(
    'analyst-workflow-transfer:transfer-1',
    JSON.stringify({
      filters: {},
      selectedIncidentIds: [111, 112, 113],
      createdAt: '2026-06-21T00:00:00.000Z',
    }),
  );
  mockFetchAnalystIncidentList.mockResolvedValue({
    incidents: [],
    total: 0,
    page: 1,
    page_size: 100,
  });
});

describe('AnalystWorkflowPage transfer hydration', () => {
  it('does not fetch the incident evidence table without transferred incident_ids', async () => {
    render(<AnalystWorkflowPage />);

    await waitFor(() => {
      expect(mockFetchAnalystIncidentList).toHaveBeenCalled();
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockFetchAnalystIncidentList).toHaveBeenCalledTimes(1);
    expect(mockFetchAnalystIncidentList).toHaveBeenCalledWith(
      expect.objectContaining({ incident_ids: [111, 112, 113] }),
    );

    for (const [params] of mockFetchAnalystIncidentList.mock.calls) {
      expect((params as { incident_ids?: number[] }).incident_ids).toEqual([111, 112, 113]);
    }
  });
});
