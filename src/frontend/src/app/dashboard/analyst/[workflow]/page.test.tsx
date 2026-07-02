/**
 * Tests for workflow-specific export buttons (Step 9 of workflow-analytics-export).
 *
 * Coverage:
 * - Export buttons render for each workflow type
 * - Clicking triggers the useWorkflowExport hook
 * - Buttons disabled when offline
 * - Top-N Export Selected disabled when no hotspot selected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mocks (hoisted) ────────────────────────────────────────────────────────────

const mockReplace = vi.fn();
const mockExportWorkflow = vi.fn();
const mockUseWorkflowExport = vi.fn(() => ({
  state: 'idle' as const,
  error: null,
  exportWorkflow: mockExportWorkflow,
  reset: vi.fn(),
}));

vi.mock('@/lib/useWorkflowExport', () => ({
  useWorkflowExport: () => mockUseWorkflowExport(),
}));

const mockUseParams = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useParams: () => mockUseParams(),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: vi.fn(),
}));

vi.mock('@/lib/useAutoSync', () => ({
  useAutoSync: () => ({ syncing: false, lastSyncedAt: null, pendingCount: 0, syncNow: vi.fn() }),
}));

vi.mock('@/lib/analyst-workflow-transfer', () => ({
  readAnalystWorkflowTransfer: () => null,
  createAnalystWorkflowTransferUrl: () => '/analyst/heatmap',
}));

const mockFetchComparativeData = vi.fn();
const mockFetchTrendData = vi.fn();
const mockFetchResponseTime = vi.fn();
const mockFetchTopN = vi.fn();
const mockFetchHeatmapData = vi.fn();
const mockFetchRegionsOfflineAware = vi.fn();
const mockFetchAnalyticsFilterOptions = vi.fn();
const mockFetchAnalystIncidentList = vi.fn();

vi.mock('@/lib/api', () => ({
  fetchAnalyticsFilterOptionsOfflineAware: async (field: string, filters: object) =>
    ({ response: await mockFetchAnalyticsFilterOptions(field, filters), fromCache: false }),
  fetchComparativeDataOfflineAware: async (f: object) =>
    ({ response: await mockFetchComparativeData(f), fromCache: false }),
  fetchHeatmapDataOfflineAware: async (f: object) =>
    ({ response: await mockFetchHeatmapData(f), fromCache: false }),
  fetchRegionsOfflineAware: async () =>
    ({ response: await mockFetchRegionsOfflineAware(), fromCache: false }),
  fetchResponseTimeByRegionOfflineAware: async (f: object) =>
    ({ response: await mockFetchResponseTime(f), fromCache: false }),
  fetchTopNOfflineAware: async (f: object) =>
    ({ response: await mockFetchTopN(f), fromCache: false }),
  fetchTrendDataOfflineAware: async (f: object) =>
    ({ response: await mockFetchTrendData(f), fromCache: false }),
  fetchAnalystIncidentList: (params: object) => mockFetchAnalystIncidentList(params),
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  CircleMarker: () => null,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="recharts-container">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => <div data-testid="bar" />,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  CartesianGrid: () => null,
  Line: () => null,
  ComposedChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="composed-chart">{children}</div>
  ),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

import { useAuth } from '@/context/AuthContext';
import { useNetworkStatus } from '@/lib/useNetworkStatus';

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

function setupNetworkStatus(isOnline = true) {
  vi.mocked(useNetworkStatus).mockReturnValue({
    isOnline,
    isReconnecting: false,
  });
}

function setupDataMocks() {
  mockFetchRegionsOfflineAware.mockResolvedValue([
    { region_id: 1, region_name: 'NCR', region_code: 'NCR' },
  ]);
  mockFetchComparativeData.mockResolvedValue({
    range_a: { start: '2024-01-01', end: '2024-01-31', count: 10 },
    range_b: { start: '2024-02-01', end: '2024-02-29', count: 12 },
    variance_percent: 20,
  });
  mockFetchTrendData.mockResolvedValue({ data: [] });
  mockFetchResponseTime.mockResolvedValue([]);
  mockFetchTopN.mockResolvedValue([
    { name: 'Hotspot A', value: 120, incident_count: 15 },
    { name: 'Hotspot B', value: 95, incident_count: 10 },
  ]);
  mockFetchHeatmapData.mockResolvedValue({ type: 'FeatureCollection', features: [] });
  mockFetchAnalyticsFilterOptions.mockResolvedValue([]);
  mockFetchAnalystIncidentList.mockResolvedValue({ incidents: [], total: 0 });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Workflow Export Buttons', () => {
  let AnalystWorkflowPage: React.ComponentType;

  beforeAll(async () => {
    // Import once — mocked dependencies are already hoisted
    const mod = await import('./page');
    AnalystWorkflowPage = mod.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    setupNetworkStatus(true);
    setupDataMocks();
  });

  it('renders Export XLSX button for comparative workflow', async () => {
    mockUseParams.mockReturnValue({ workflow: 'comparative' });
    const { container } = render(<AnalystWorkflowPage />);

    await waitFor(() => {
      const heading = container.querySelector('h1');
      expect(heading).toBeTruthy();
      expect(heading?.textContent).toContain('Comparative');
    });

    const buttons = screen.getAllByText('Export XLSX');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Export XLSX button for trends workflow', async () => {
    mockUseParams.mockReturnValue({ workflow: 'trends' });
    const { container } = render(<AnalystWorkflowPage />);

    await waitFor(() => {
      const heading = container.querySelector('h1');
      expect(heading).toBeTruthy();
      expect(heading?.textContent).toContain('Trend');
    });

    const buttons = screen.getAllByText('Export XLSX');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Export XLSX button for response-time workflow', async () => {
    mockUseParams.mockReturnValue({ workflow: 'response-time' });
    const { container } = render(<AnalystWorkflowPage />);

    await waitFor(() => {
      const heading = container.querySelector('h1');
      expect(heading).toBeTruthy();
      expect(heading?.textContent).toContain('Response Time');
    });

    const buttons = screen.getAllByText('Export XLSX');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Export Chart and Export Selected buttons for top-n workflow', async () => {
    mockUseParams.mockReturnValue({ workflow: 'top-n' });
    const { container } = render(<AnalystWorkflowPage />);

    await waitFor(() => {
      const heading = container.querySelector('h1');
      expect(heading).toBeTruthy();
      expect(heading?.textContent).toContain('Top-N');
    });

    const chartButtons = screen.getAllByText('Export Chart');
    const selectedButtons = screen.getAllByText('Export Selected');
    expect(chartButtons.length).toBeGreaterThanOrEqual(1);
    expect(selectedButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('clicking comparative Export XLSX calls exportWorkflow with expected params', async () => {
    mockUseParams.mockReturnValue({ workflow: 'comparative' });
    const { container } = render(<AnalystWorkflowPage />);

    await waitFor(() => {
      expect(container.querySelector('h1')).toBeTruthy();
    });

    const buttons = screen.getAllByText('Export XLSX');
    expect(buttons.length).toBeGreaterThanOrEqual(1);

    await userEvent.click(buttons[0]);

    // Should call exportWorkflow with comparative type and range params
    expect(mockExportWorkflow).toHaveBeenCalledWith(
      'comparative',
      expect.objectContaining({
        range_a_start: expect.any(String),
        range_a_end: expect.any(String),
        range_b_start: expect.any(String),
        range_b_end: expect.any(String),
        filters: expect.any(Object),
      }),
    );
  });

  it('export buttons disabled when offline', async () => {
    setupNetworkStatus(false);
    mockUseParams.mockReturnValue({ workflow: 'comparative' });
    const { container } = render(<AnalystWorkflowPage />);

    await waitFor(() => {
      expect(container.querySelector('h1')).toBeTruthy();
    });

    const buttons = screen.getAllByText('Export XLSX');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it('top-n Export Selected button disabled when no hotspot selected', async () => {
    mockUseParams.mockReturnValue({ workflow: 'top-n' });
    const { container } = render(<AnalystWorkflowPage />);

    await waitFor(() => {
      expect(container.querySelector('h1')).toBeTruthy();
    });

    const selectedButtons = screen.getAllByText('Export Selected');
    expect(selectedButtons.length).toBeGreaterThanOrEqual(1);
    selectedButtons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });
});
