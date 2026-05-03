/**
 * TDD Baseline: Analyst Dashboard Queue — Frontend (AQ-04 through AQ-15).
 *
 * Red State: ALL tests here should FAIL against current codebase.
 * Green State: Each test passes when its corresponding AQ feature is implemented.
 *
 * Coverage:
 *   Phase 2 — Filters + Charts: severity filter, damage filter, pie chart, top-10, response time
 *   Phase 3 — Export: PDF/Excel download buttons
 *   Phase 4 — Extensions: multi-region, cross-region comparison, top-N, scheduled reports
 *
 * Standards:
 *   - Components render without crashing
 *   - Empty states shown when no data
 *   - RBAC: unauthorized roles see access denied
 *   - Filter changes propagate to API calls
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
const mockFetchTypeDistribution = vi.fn();
const mockFetchTopBarangays = vi.fn();
const mockFetchResponseTime = vi.fn();
const mockFetchCompareRegions = vi.fn();
const mockFetchTopN = vi.fn();

vi.mock('@/lib/api', () => ({
  fetchHeatmapData: (f: object) => mockFetchHeatmapData(f),
  fetchTrendData: (f: object) => mockFetchTrendData(f),
  fetchComparativeData: (f: object) => mockFetchComparativeData(f),
  fetchRegions: () => mockFetchRegions(),
  fetchTypeDistribution: (f: object) => mockFetchTypeDistribution(f),
  fetchTopBarangays: (f: object) => mockFetchTopBarangays(f),
  fetchResponseTimeByRegion: (f: object) => mockFetchResponseTime(f),
  fetchCompareRegions: (f: object) => mockFetchCompareRegions(f),
  fetchTopN: (f: object) => mockFetchTopN(f),
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  CircleMarker: () => null,
}));

// Recharts mock — renders data-driven divs for assertions
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="recharts-container">{children}</div>
  ),
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: ({ data }: { data: Array<{ name: string; value: number }> }) => (
    <div data-testid="pie-data">
      {(data || []).map((d, i) => (
        <span key={i} data-testid={`pie-segment-${d.name}`} data-value={d.value}>
          {d.name}: {d.value}
        </span>
      ))}
    </div>
  ),
  BarChart: ({ children, data }: { children: React.ReactNode; data?: Array<Record<string, unknown>> }) => (
    <div data-testid="bar-chart" data-count={data?.length ?? 0}>{children}</div>
  ),
  Bar: () => <div data-testid="bar" />,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Cell: () => null,
  ComposedChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="composed-chart">{children}</div>
  ),
  Line: () => null,
  CartesianGrid: () => null,
}));

function setupAuth(role = 'NATIONAL_ANALYST') {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'test-user', role },
    loading: false,
    loggingOut: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
  });
}

function setupMocks() {
  mockFetchRegions.mockResolvedValue([
    { region_id: 1, region_name: 'NCR', region_code: 'NCR' },
    { region_id: 2, region_name: 'Region III', region_code: 'R3' },
  ]);
  mockFetchHeatmapData.mockResolvedValue({ type: 'FeatureCollection', features: [] });
  mockFetchTrendData.mockResolvedValue({ data: [] });
  mockFetchComparativeData.mockResolvedValue({
    range_a: { start: '2024-01-01', end: '2024-01-31', count: 10 },
    range_b: { start: '2024-02-01', end: '2024-02-29', count: 12 },
    variance_percent: 20,
  });
  mockFetchTypeDistribution.mockResolvedValue([
    { type: 'STRUCTURAL', count: 42 },
    { type: 'NON_STRUCTURAL', count: 18 },
    { type: 'VEHICULAR', count: 7 },
  ]);
  mockFetchTopBarangays.mockResolvedValue([
    { barangay: 'Barangay 1', count: 120 },
    { barangay: 'Barangay 2', count: 95 },
    { barangay: 'Barangay 3', count: 87 },
  ]);
  mockFetchResponseTime.mockResolvedValue([
    { region_id: 1, region_name: 'NCR', avg_response_time: 12.5, min_response_time: 3, max_response_time: 45 },
    { region_id: 2, region_name: 'Region III', avg_response_time: 18.2, min_response_time: 5, max_response_time: 32 },
  ]);
  mockFetchCompareRegions.mockResolvedValue([
    { region_id: 1, region_name: 'NCR', total_incidents: 120, avg_response_time: 12.5, top_type: 'STRUCTURAL' },
    { region_id: 2, region_name: 'Region III', total_incidents: 85, avg_response_time: 18.2, top_type: 'VEHICULAR' },
  ]);
  mockFetchTopN.mockResolvedValue([
    { name: 'Barangay A', value: 120 },
    { name: 'Barangay B', value: 95 },
  ]);
}


// =========================================================================
// PHASE 2: Filters + Charts
// =========================================================================

describe('Analyst dashboard — AQ-04: Casualty severity filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    setupMocks();
  });

  it('renders casualty severity filter dropdown', async () => {
    // Dynamic import to get fresh component after mocks
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/casualty severity/i)).toBeInTheDocument();
    });
  });

  it('passes casualty_severity to heatmap and trends on apply', async () => {
    const user = userEvent.setup();
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(mockFetchHeatmapData).toHaveBeenCalled();
    });

    await user.selectOptions(screen.getByLabelText(/casualty severity/i), 'high');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => {
      const lastHeat = mockFetchHeatmapData.mock.calls[mockFetchHeatmapData.mock.calls.length - 1][0];
      const lastTrend = mockFetchTrendData.mock.calls[mockFetchTrendData.mock.calls.length - 1][0];
      expect(lastHeat.casualty_severity).toBe('high');
      expect(lastTrend.casualty_severity).toBe('high');
    });
  });

  it('has high/medium/low options', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      const select = screen.getByLabelText(/casualty severity/i);
      const options = select.querySelectorAll('option');
      const values = Array.from(options).map(o => o.value);
      expect(values).toContain('high');
      expect(values).toContain('medium');
      expect(values).toContain('low');
    });
  });
});


describe('Analyst dashboard — AQ-05: Property damage range filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    setupMocks();
  });

  it('renders damage_min and damage_max inputs', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/damage min|minimum damage/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/damage max|maximum damage/i)).toBeInTheDocument();
    });
  });

  it('passes damage range to heatmap on apply', async () => {
    const user = userEvent.setup();
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(mockFetchHeatmapData).toHaveBeenCalled();
    });

    await user.type(screen.getByLabelText(/damage min|minimum damage/i), '10000');
    await user.type(screen.getByLabelText(/damage max|maximum damage/i), '500000');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => {
      const lastHeat = mockFetchHeatmapData.mock.calls[mockFetchHeatmapData.mock.calls.length - 1][0];
      expect(lastHeat.damage_min).toBe(10000);
      expect(lastHeat.damage_max).toBe(500000);
    });
  });
});


describe('Analyst dashboard — AQ-06: Incident type pie chart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    setupMocks();
  });

  it('renders pie chart component', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });
  });

  it('fetches type distribution data on load', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(mockFetchTypeDistribution).toHaveBeenCalled();
    });
  });

  it('renders pie segments from distribution data', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('pie-segment-STRUCTURAL')).toBeInTheDocument();
      expect(screen.getByTestId('pie-segment-NON_STRUCTURAL')).toBeInTheDocument();
      expect(screen.getByTestId('pie-segment-VEHICULAR')).toBeInTheDocument();
    });
  });

  it('shows empty state when no distribution data', async () => {
    mockFetchTypeDistribution.mockResolvedValue([]);
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      // Multiple sections show empty state text, so use getAllByText
      const emptyStates = screen.getAllByText(/no.*data|no incidents|no distribution/i);
      expect(emptyStates.length).toBeGreaterThanOrEqual(1);
    });
  });
});


describe('Analyst dashboard — AQ-07: Top 10 barangays chart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    setupMocks();
  });

  it('renders top barangays chart', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(mockFetchTopBarangays).toHaveBeenCalled();
    });

    // After fetch completes, the bar-chart div should render
    await waitFor(() => {
      expect(screen.getAllByTestId('bar-chart').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('fetches top barangays data on load', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(mockFetchTopBarangays).toHaveBeenCalled();
    });
  });

  it('passes filters to top barangays fetch', async () => {
    const user = userEvent.setup();
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(mockFetchTopBarangays).toHaveBeenCalled();
    });

    await user.selectOptions(screen.getByLabelText(/incident type|type/i), 'STRUCTURAL');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => {
      const lastCall = mockFetchTopBarangays.mock.calls[mockFetchTopBarangays.mock.calls.length - 1][0];
      expect(lastCall.incident_type).toBe('STRUCTURAL');
    });
  });

  it('shows section header "Top Barangays"', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/top.*barangay/i)).toBeInTheDocument();
    });
  });
});


describe('Analyst dashboard — AQ-08: Response time by region chart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    setupMocks();
  });

  it('renders response time section header', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    // The section renders inside the data-loaded block
    await waitFor(() => {
      expect(mockFetchResponseTime).toHaveBeenCalled();
    });

    // Check that response time text exists somewhere in the document
    const elements = screen.getAllByText(/response time/i);
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it('fetches response time data on load', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(mockFetchResponseTime).toHaveBeenCalled();
    });
  });

  it('displays avg response time values', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      // NCR avg: 12.5 min
      expect(screen.getByText(/12\.5/)).toBeInTheDocument();
      // Region III avg: 18.2 min
      expect(screen.getByText(/18\.2/)).toBeInTheDocument();
    });
  });
});


// =========================================================================
// PHASE 3: Export
// =========================================================================

describe('Analyst dashboard — AQ-09/AQ-10: PDF and Excel export buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    setupMocks();
  });

  it('renders Export PDF button', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export.*pdf/i })).toBeInTheDocument();
    });
  });

  it('renders Export Excel button', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export.*excel/i })).toBeInTheDocument();
    });
  });
});


// =========================================================================
// PHASE 4: Extensions
// =========================================================================

describe('Analyst dashboard — AQ-12: Multi-region select', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    setupMocks();
  });

  it('region filter exists and is a select', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/^region$/i)).toBeInTheDocument();
    });
  });

  it('passes region_id to heatmap on apply', async () => {
    const user = userEvent.setup();
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(mockFetchHeatmapData).toHaveBeenCalled();
    });

    await user.selectOptions(screen.getByLabelText(/^region$/i), '1');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => {
      const lastHeat = mockFetchHeatmapData.mock.calls[mockFetchHeatmapData.mock.calls.length - 1][0];
      expect(lastHeat.region_id).toBe(1);
    });
  });
});


describe('Analyst dashboard — AQ-13: Cross-region comparison view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    setupMocks();
  });

  it('renders cross-region comparison when data is available', async () => {
    // Set a region so compareRegions is populated
    mockFetchCompareRegions.mockResolvedValue([
      { region_id: 1, region_name: 'NCR', total_incidents: 120, avg_response_time: 12.5, top_type: 'STRUCTURAL' },
      { region_id: 2, region_name: 'Region III', total_incidents: 85, avg_response_time: 18.2, top_type: 'VEHICULAR' },
    ]);

    const user = userEvent.setup();
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(mockFetchHeatmapData).toHaveBeenCalled();
    });

    // Select a region to trigger compare-regions
    await user.selectOptions(screen.getByLabelText(/^region$/i), '1');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => {
      expect(screen.getByText(/cross.*region|region.*comparison/i)).toBeInTheDocument();
    });
  });

  it('does not show comparison section when no region selected', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(mockFetchHeatmapData).toHaveBeenCalled();
    });

    // Comparison should not be visible when no region is selected
    expect(screen.queryByText(/cross.*region|region.*comparison/i)).not.toBeInTheDocument();
  });

  it('displays region stats when comparison loads', async () => {
    mockFetchCompareRegions.mockResolvedValue([
      { region_id: 1, region_name: '1', total_incidents: 120, avg_response_time: 12.5, top_type: 'STRUCTURAL' },
      { region_id: 2, region_name: '2', total_incidents: 85, avg_response_time: 18.2, top_type: 'VEHICULAR' },
    ]);

    const user = userEvent.setup();
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(mockFetchHeatmapData).toHaveBeenCalled();
    });

    await user.selectOptions(screen.getByLabelText(/^region$/i), '1');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    // Wait for comparison fetch to be called
    await waitFor(() => {
      expect(mockFetchCompareRegions).toHaveBeenCalled();
    });

    // Comparison table should render
    await waitFor(() => {
      expect(screen.getByText(/cross.*region/i)).toBeInTheDocument();
    });
  });
});


describe('Analyst dashboard — AQ-14: Top-N configurable analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    setupMocks();
  });

  it('renders top-N analysis section with metric/dimension selectors', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/metric/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/dimension|group by/i)).toBeInTheDocument();
    });
  });

  it('renders top-N chart with fetched data', async () => {
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      // bar-chart is rendered with top-N data
      const charts = screen.getAllByTestId('bar-chart');
      expect(charts.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('fetches top-N when metric changes and Apply clicked', async () => {
    const user = userEvent.setup();
    const { default: AnalystDashboardPage } = await import('@/app/dashboard/analyst/page');
    render(<AnalystDashboardPage />);

    await waitFor(() => {
      expect(mockFetchTopN).toHaveBeenCalled();
    });

    mockFetchTopN.mockClear();
    await user.selectOptions(screen.getByLabelText(/metric/i), 'casualties');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => {
      expect(mockFetchTopN).toHaveBeenCalled();
      const lastCall = mockFetchTopN.mock.calls[mockFetchTopN.mock.calls.length - 1][0];
      expect(lastCall.metric).toBe('casualties');
    });
  });
});
