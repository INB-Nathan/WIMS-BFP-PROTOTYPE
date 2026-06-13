/**
 * Analyst dashboard page tests — filter controls, loading, access denied, error states.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AnalystDashboardPage from './page';

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: analystOfflineMocks.networkOnline, isReconnecting: false }),
}));

vi.mock('@/lib/useAutoSync', () => ({
  useAutoSync: () => ({ syncing: false, lastSyncedAt: null, pendingCount: 0, syncNow: vi.fn() }),
}));

const analystOfflineMocks = vi.hoisted(() => ({
  fromCache: false,
  cachedAt: undefined as number | undefined,
  networkOnline: true,
}));

import { useAuth } from '@/context/AuthContext';

const mockFetchHeatmapData = vi.fn();
const mockFetchTrendData = vi.fn();
const mockFetchComparativeData = vi.fn();
const mockFetchRegions = vi.fn();
const mockFetchTypeDistribution = vi.fn();
const mockFetchTopBarangays = vi.fn();
const mockFetchResponseTimeByRegion = vi.fn();
const mockFetchCompareRegions = vi.fn();
const mockFetchTopN = vi.fn();
const mockFetchAnalyticsFilterOptions = vi.fn();
const mockFetchAnalystIncidentList = vi.fn();

vi.mock('@/lib/api', () => ({
  fetchHeatmapDataOfflineAware: async (f: object) => ({ response: await mockFetchHeatmapData(f), fromCache: analystOfflineMocks.fromCache, cachedAt: analystOfflineMocks.cachedAt }),
  fetchTrendDataOfflineAware: async (f: object) => ({ response: await mockFetchTrendData(f), fromCache: analystOfflineMocks.fromCache, cachedAt: analystOfflineMocks.cachedAt }),
  fetchComparativeDataOfflineAware: async (f: object) => ({ response: await mockFetchComparativeData(f), fromCache: analystOfflineMocks.fromCache, cachedAt: analystOfflineMocks.cachedAt }),
  fetchRegions: () => mockFetchRegions(),
  fetchTypeDistributionOfflineAware: async (f: object) => ({ response: await mockFetchTypeDistribution(f), fromCache: analystOfflineMocks.fromCache, cachedAt: analystOfflineMocks.cachedAt }),
  fetchTopBarangays: (f: object) => mockFetchTopBarangays(f),
  fetchResponseTimeByRegionOfflineAware: async (f: object) => ({ response: await mockFetchResponseTimeByRegion(f), fromCache: analystOfflineMocks.fromCache, cachedAt: analystOfflineMocks.cachedAt }),
  fetchCompareRegions: (f: object) => mockFetchCompareRegions(f),
  fetchTopNOfflineAware: async (f: object) => ({ response: await mockFetchTopN(f), fromCache: analystOfflineMocks.fromCache, cachedAt: analystOfflineMocks.cachedAt }),
  fetchAnalyticsFilterOptionsOfflineAware: async (field: string, filters: object) =>
    ({ response: await mockFetchAnalyticsFilterOptions(field, filters), fromCache: analystOfflineMocks.fromCache, cachedAt: analystOfflineMocks.cachedAt }),
  fetchAnalystIncidentList: (params: object) => mockFetchAnalystIncidentList(params),
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  CircleMarker: () => null,
}));

describe('Analyst dashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    analystOfflineMocks.fromCache = false;
    analystOfflineMocks.cachedAt = undefined;
    analystOfflineMocks.networkOnline = true;
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'test-user', role: 'NATIONAL_ANALYST' },
      loading: false,
      loggingOut: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });
    mockFetchRegions.mockResolvedValue([
      { region_id: 1, region_name: 'NCR', region_code: 'NCR' },
    ]);
    mockFetchHeatmapData.mockResolvedValue({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [120.9842, 14.5995] },
          properties: {
            incident_id: 1,
            alarm_level: '1',
            general_category: 'STRUCTURAL',
            notification_dt: '2024-01-15T10:00:00',
          },
        },
      ],
    });
    mockFetchTrendData.mockResolvedValue({ data: [] });
    mockFetchComparativeData.mockResolvedValue({
      range_a: { start: '2024-01-01', end: '2024-01-31', count: 10 },
      range_b: { start: '2024-02-01', end: '2024-02-29', count: 12 },
      variance_percent: 20,
    });
    mockFetchTypeDistribution.mockResolvedValue([
      { type: 'STRUCTURAL', count: 42 },
    ]);
    mockFetchTopBarangays.mockResolvedValue([
      { barangay: 'Barangay 1', count: 120 },
    ]);
    mockFetchResponseTimeByRegion.mockResolvedValue([
      { region_id: 1, region_name: 'NCR', avg_response_time: 12.5, min_response_time: 3, max_response_time: 45 },
    ]);
    mockFetchCompareRegions.mockResolvedValue([]);
    mockFetchTopN.mockResolvedValue([
      { name: 'Barangay A', value: 120 },
    ]);
    mockFetchAnalyticsFilterOptions.mockResolvedValue([]);
    mockFetchAnalystIncidentList.mockResolvedValue({
      incidents: [],
      total: 0,
      page: 1,
      page_size: 25,
    });
  });

  it('renders filter controls', async () => {
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/start date|date from/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/end date|date to/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^region$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/incident type|type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/alarm level/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/range a start/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/range a end/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/range b start/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/range b end/i)).toBeInTheDocument();
  });

  it('loads analytics data on success', async () => {
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(mockFetchHeatmapData).toHaveBeenCalled();
      expect(mockFetchTrendData).toHaveBeenCalled();
      expect(mockFetchComparativeData).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByTestId('tile-layer')).toBeInTheDocument();
    });
  });

  it('passes shared filters and explicit comparative ranges to all analytics fetches', async () => {
    const user = userEvent.setup();
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(mockFetchComparativeData).toHaveBeenCalled();
    });

    await user.selectOptions(screen.getByLabelText(/alarm level/i), '2');
    await user.clear(screen.getByLabelText(/range a start/i));
    await user.type(screen.getByLabelText(/range a start/i), '2024-06-01');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => {
      const lastHeat = mockFetchHeatmapData.mock.calls[mockFetchHeatmapData.mock.calls.length - 1][0];
      const lastTrend = mockFetchTrendData.mock.calls[mockFetchTrendData.mock.calls.length - 1][0];
      const lastCmp = mockFetchComparativeData.mock.calls[mockFetchComparativeData.mock.calls.length - 1][0];
      expect(lastHeat.alarm_level).toBe('2');
      expect(lastTrend.alarm_level).toBe('2');
      expect(lastCmp.alarm_level).toBe('2');
      expect(lastCmp.range_a_start).toBe('2024-06-01');
    });
  });

  it('shows loading state initially', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: true,
      loggingOut: false,
      isAuthenticated: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });

    render(<AnalystDashboardPage />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows access denied state for 403', async () => {
    mockFetchHeatmapData.mockRejectedValue(new Error('NATIONAL_ANALYST or SYSTEM_ADMIN required'));

    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/access denied|403|not authorized/i)).toBeInTheDocument();
    });
  });

  it('shows generic error state for non-403 failures', async () => {
    mockFetchHeatmapData.mockRejectedValue(new Error('Network error'));

    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/error|failed|try again/i)).toBeInTheDocument();
    });
  });

  it('Clear button resets filters and fetches with empty/default values', async () => {
    const user = userEvent.setup();
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(mockFetchHeatmapData).toHaveBeenCalled();
    });

    // Set filters
    const startInput = screen.getByLabelText(/start date/i);
    const regionSelect = screen.getByLabelText(/region/i);
    await user.clear(startInput);
    await user.type(startInput, '2024-01-15');
    await user.selectOptions(regionSelect, '1');
    await user.selectOptions(screen.getByLabelText(/incident type/i), 'STRUCTURAL');

    // Apply
    await user.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => {
      const lastCall = mockFetchHeatmapData.mock.calls[mockFetchHeatmapData.mock.calls.length - 1];
      expect(lastCall[0]).toMatchObject({
        start_date: '2024-01-15',
        region_id: 1,
        incident_type: 'STRUCTURAL',
      });
    });

    mockFetchHeatmapData.mockClear();

    // Clear
    await user.click(screen.getByRole('button', { name: /clear/i }));

    await waitFor(() => {
      expect(mockFetchHeatmapData).toHaveBeenCalled();
      const clearCall = mockFetchHeatmapData.mock.calls[0];
      const filters = clearCall[0];
      expect(filters.start_date).toBeUndefined();
      expect(filters.end_date).toBeUndefined();
      expect(filters.region_id).toBeUndefined();
      expect(filters.incident_type).toBeUndefined();
      expect(filters.alarm_level).toBeUndefined();
    });
  });

  describe('offline / cached-data UI', () => {
    beforeEach(() => {
      analystOfflineMocks.fromCache = true;
      analystOfflineMocks.cachedAt = Date.now() - 60_000;
      analystOfflineMocks.networkOnline = false;
    });

    it('shows offline banner when the network is offline', async () => {
      render(<AnalystDashboardPage />);

      await waitFor(() => {
        expect(mockFetchHeatmapData).toHaveBeenCalled();
      });

      expect(screen.getByText(/you are offline/i)).toBeInTheDocument();
      expect(screen.getByText(/cached analyst reads/i)).toBeInTheDocument();
    });

    it('shows cached data indicators when APIs return fromCache:true', async () => {
      render(<AnalystDashboardPage />);

      await waitFor(() => {
        expect(mockFetchHeatmapData).toHaveBeenCalled();
      });

      // At least one panel should display the cached-data label after all async
      // dashboard fetches settle and cache metadata is applied.
      await waitFor(() => {
        expect(screen.getAllByText(/showing cached data/i).length).toBeGreaterThanOrEqual(1);
      });
    });

    it('disables export buttons when offline', async () => {
      render(<AnalystDashboardPage />);

      await waitFor(() => {
        expect(mockFetchHeatmapData).toHaveBeenCalled();
      });

      // Export buttons are gated behind !loadingData && heatmap !== null.
      // Use findBy* (async retry) rather than getBy* (synchronous) so React
      // can finish the loadData finally block and re-render the export section.
      const csvBtn = await screen.findByLabelText('Export CSV');
      const pdfBtn = await screen.findByLabelText('Export PDF');
      const excelBtn = await screen.findByLabelText('Export Excel');
      expect(csvBtn).toBeDisabled();
      expect(pdfBtn).toBeDisabled();
      expect(excelBtn).toBeDisabled();
    });
  });
});
