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

import { useAuth } from '@/context/AuthContext';

const mockFetchHeatmapData = vi.fn();
const mockFetchTrendData = vi.fn();
const mockFetchComparativeData = vi.fn();
const mockFetchRegions = vi.fn();

vi.mock('@/lib/api', () => ({
  fetchHeatmapData: (f: object) => mockFetchHeatmapData(f),
  fetchTrendData: (f: object) => mockFetchTrendData(f),
  fetchComparativeData: (f: object) => mockFetchComparativeData(f),
  fetchRegions: () => mockFetchRegions(),
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  CircleMarker: () => null,
}));

describe('Analyst dashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: { role: 'NATIONAL_ANALYST' },
      loading: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockFetchRegions.mockResolvedValue([
      { region_id: 1, region_name: 'NCR', region_code: 'NCR' },
    ]);
    mockFetchHeatmapData.mockResolvedValue({
      type: 'FeatureCollection',
      features: [],
    });
    mockFetchTrendData.mockResolvedValue({ data: [] });
    mockFetchComparativeData.mockResolvedValue({
      range_a: { start: '2024-01-01', end: '2024-01-31', count: 10 },
      range_b: { start: '2024-02-01', end: '2024-02-29', count: 12 },
      variance_percent: 20,
    });
  });

  it('renders filter controls', async () => {
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/start date|date from/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/end date|date to/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/region/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/incident type|type/i)).toBeInTheDocument();
  });

  it('loads analytics data on success', async () => {
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(mockFetchHeatmapData).toHaveBeenCalled();
      expect(mockFetchTrendData).toHaveBeenCalled();
      expect(mockFetchComparativeData).toHaveBeenCalled();
    });
  });

  it('shows loading state initially', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: true,
      isAuthenticated: false,
      login: vi.fn(),
      logout: vi.fn(),
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
    });
  });
});
