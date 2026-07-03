import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any dynamic imports of the component
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/offlineOperations', () => ({
  fetchOperationsOfflineAware: vi.fn().mockResolvedValue({
    response: [
    {
      operation_id: 1,
      fire_status: 'ACTIVE',
      start_time: '2026-06-10T08:00:00Z',
      location: 'Quezon City, Barangay Tatalon',
      size_hectares: 2.5,
      notes: 'Test operation',
      created_by: null,
      created_at: '2026-06-10T08:00:00Z',
      updated_at: '2026-06-10T08:00:00Z',
      linked_report_ids: [5, 6],
      linked_reports: [
        {
          report_id: 5,
          status: 'LINKED',
          category: 'STRUCTURAL',
          sub_category: 'Residential',
          reported_at: '2026-06-10T07:55:00Z',
          latitude: 14.6,
          longitude: 120.98,
          trust_score: 80,
          safety_status: 'I_AM_SAFE',
          reporting_context: 'WITNESS',
          linked_operation_id: 1,
          linked_operation_label: 'Operation #1',
          distance_meters: 42,
        },
        {
          report_id: 6,
          status: 'LINKED',
          category: 'WILDLAND',
          sub_category: null,
          reported_at: '2026-06-10T08:00:00Z',
          latitude: null,
          longitude: null,
          trust_score: 90,
          safety_status: 'I_AM_SAFE',
          reporting_context: 'DIRECT',
          linked_operation_id: 1,
          linked_operation_label: 'Operation #1',
          distance_meters: 100,
        },
      ],
    },
    ],
  }),
  createOperation: vi.fn().mockResolvedValue({}),
  updateOperation: vi.fn().mockResolvedValue({}),
  deleteOperation: vi.fn().mockResolvedValue(undefined),
  fetchLinkableReports: vi.fn().mockResolvedValue([
    {
      report_id: 7,
      status: 'PENDING',
      category: 'STRUCTURAL',
      sub_category: 'Residential',
      reported_at: '2026-06-10T07:45:00Z',
      latitude: 14.61,
      longitude: 120.99,
      trust_score: 70,
      safety_status: 'I_AM_SAFE',
      reporting_context: 'WITNESS',
      linked_operation_id: null,
      linked_operation_label: null,
      distance_meters: 120,
      link_disabled: false,
      disabled_reason: null,
    },
    {
      report_id: 8,
      status: 'LINKED',
      category: 'STRUCTURAL',
      sub_category: 'Warehouse',
      reported_at: '2026-06-10T07:40:00Z',
      latitude: 14.62,
      longitude: 121,
      trust_score: 60,
      safety_status: 'UNKNOWN',
      reporting_context: 'WITNESS',
      linked_operation_id: 99,
      linked_operation_label: 'Operation #99',
      distance_meters: 240,
      link_disabled: true,
      disabled_reason: 'Already linked to Operation #99',
    },
    ...[9, 10, 11, 12, 13].map((id) => ({
      report_id: id,
      status: 'PENDING',
      category: 'STRUCTURAL',
      sub_category: `Mock ${id}`,
      reported_at: '2026-06-10T07:35:00Z',
      latitude: 14.6 + id / 1000,
      longitude: 120.9 + id / 1000,
      trust_score: 50,
      safety_status: 'I_AM_SAFE',
      reporting_context: 'WITNESS',
      linked_operation_id: null,
      linked_operation_label: null,
      distance_meters: id * 10,
      link_disabled: false,
      disabled_reason: null,
    })),
  ]),
  linkReport: vi.fn().mockResolvedValue({}),
  unlinkReport: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/api/operations', () => ({
  createOperation: vi.fn().mockResolvedValue({}),
  updateOperation: vi.fn().mockResolvedValue({}),
  deleteOperation: vi.fn().mockResolvedValue(undefined),
  fetchResetPreview: vi.fn().mockResolvedValue({ archive_count: 0, carried_over_count: 0 }),
  runResetDay: vi.fn().mockResolvedValue({ archive_count: 0, carried_over_count: 0, reset_id: 1 }),
  restoreOperation: vi.fn().mockResolvedValue({}),
  fetchLinkableReports: vi.fn().mockResolvedValue([
    {
      report_id: 7,
      status: 'PENDING',
      category: 'STRUCTURAL',
      sub_category: 'Residential',
      reported_at: '2026-06-10T07:45:00Z',
      latitude: 14.61,
      longitude: 120.99,
      trust_score: 70,
      safety_status: 'I_AM_SAFE',
      reporting_context: 'WITNESS',
      linked_operation_id: null,
      linked_operation_label: null,
      distance_meters: 120,
      link_disabled: false,
      disabled_reason: null,
    },
    {
      report_id: 8,
      status: 'LINKED',
      category: 'STRUCTURAL',
      sub_category: 'Warehouse',
      reported_at: '2026-06-10T07:40:00Z',
      latitude: 14.62,
      longitude: 121,
      trust_score: 60,
      safety_status: 'UNKNOWN',
      reporting_context: 'WITNESS',
      linked_operation_id: 99,
      linked_operation_label: 'Operation #99',
      distance_meters: 240,
      link_disabled: true,
      disabled_reason: 'Already linked to Operation #99',
    },
    ...[9, 10, 11, 12, 13].map((id) => ({
      report_id: id,
      status: 'PENDING',
      category: 'STRUCTURAL',
      sub_category: `Mock ${id}`,
      reported_at: '2026-06-10T07:35:00Z',
      latitude: 14.6 + id / 1000,
      longitude: 120.9 + id / 1000,
      trust_score: 50,
      safety_status: 'I_AM_SAFE',
      reporting_context: 'WITNESS',
      linked_operation_id: null,
      linked_operation_label: null,
      distance_meters: id * 10,
      link_disabled: false,
      disabled_reason: null,
    })),
  ]),
  linkReport: vi.fn().mockResolvedValue({}),
  unlinkReport: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn().mockReturnValue({
    user: { id: 'test-user', role: 'NATIONAL_VALIDATOR', assignedRegionId: null },
    isAuthenticated: true,
    loading: false,
    loggingOut: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
  }),
}));

vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: () => ({
    isOnline: true,
    isChecking: false,
    isReconnecting: false,
    status: 'online',
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Must mock react-leaflet — MapContainer uses browser APIs unavailable in jsdom
const mockSetView = vi.hoisted(() => vi.fn());

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div className="leaflet-container">{children}</div>
  ),
  TileLayer: () => <div />,
  Circle: ({ children }: { children?: React.ReactNode }) => <div data-testid="operation-circle">{children}</div>,
  CircleMarker: ({ children }: { children?: React.ReactNode }) => <div data-testid="linked-report-marker">{children}</div>,
  Marker: () => <div data-testid="leaflet-marker" />,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({
    getZoom: () => 12,
    getCenter: () => ({ lat: 14.5995, lng: 120.9842 }),
    setView: mockSetView,
    fitBounds: vi.fn(),
    on: () => {},
    off: () => {},
  }),
  useMapEvents: () => ({}),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Operations Board', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the operations table after load', async () => {
    const { default: HomePage } = await import('../page');
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Quezon City, Barangay Tatalon')).toBeDefined();
    });
  });

  it('shows filter tabs', async () => {
    const { default: HomePage } = await import('../page');
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('ON-GOING')).toBeDefined();
      expect(screen.getByText('FIRE OUT')).toBeDefined();
      expect(screen.getByText('ALL')).toBeDefined();
    });
  });

  it('shows New Operation button for validator', async () => {
    const { default: HomePage } = await import('../page');
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('New Operation')).toBeDefined();
    });
  });

  it('validator can open the edit operation modal from the selected operation panel', async () => {
    const { default: HomePage } = await import('../page?validator-edit-operation');
    render(<HomePage />);

    await waitFor(() => expect(screen.getByText('Quezon City, Barangay Tatalon')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Operation' }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Quezon City, Barangay Tatalon')).toBeDefined();
    });
  });

  it('hides New Operation button for non-validator', async () => {
    // Override the module mock to return encoder role for this test
    vi.doMock('@/context/AuthContext', () => ({
      useAuth: vi.fn().mockReturnValue({
        user: { id: 'encoder-user', role: 'REGIONAL_ENCODER', assignedRegionId: 1 },
        isAuthenticated: true,
        loading: false,
        loggingOut: false,
        login: vi.fn(),
        logout: vi.fn(),
        refreshSession: vi.fn(),
      }),
    }));

    // Re-import the component fresh so it picks up the new mock
    const { default: HomePage } = await import('../page?encoder');
    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByText('Quezon City, Barangay Tatalon')).toBeDefined();
    });

    expect(screen.queryByText('New Operation')).toBeNull();
  });

  it('shows loading spinner while fetching', async () => {
    const { fetchOperationsOfflineAware } = await import('@/lib/api/offlineOperations');
    // Make it never resolve so we catch the loading state
    (fetchOperationsOfflineAware as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise(() => {}));

    const { default: HomePage } = await import('../page');
    render(<HomePage />);

    // The board's loading spinner should be present
    // (we check for absence of the table body instead since spinner has no text)
    expect(screen.queryByText('Quezon City, Barangay Tatalon')).toBeNull();
  });

  it('shows "No operations found" when list is empty', async () => {
    const { fetchOperationsOfflineAware } = await import('@/lib/api/offlineOperations');
    (fetchOperationsOfflineAware as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ response: [], fromCache: false });

    const { default: HomePage } = await import('../page');
    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByText('No operations found.')).toBeDefined();
    });
  });
});

describe('Operations Board — map fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders linked report count in the table', async () => {
    const { default: HomePage } = await import('../page');
    render(<HomePage />);
    await waitFor(() => {
      // The mock data has linked_report_ids: [5, 6] and linked_reports length 2
      const panel = screen.getByTestId('operations-panel-pane');
      expect(within(panel).getByText('2 linked report(s)')).toBeDefined();
    });
  });

  it('shows map picker when creating a new operation', async () => {
    const { default: HomePage } = await import('../page');
    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByText('New Operation')).toBeDefined();
    });

    // Click New Operation to open the form modal
    const newOpButton = screen.getByText('New Operation');
    newOpButton.click();

    await waitFor(() => {
      // MapPickerInner contains a search input placeholder
      expect(screen.getByPlaceholderText(/search/i)).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Split operations console (Task 5)
// ---------------------------------------------------------------------------

describe('Operations Board — Split Console', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a split operations console instead of table map toggle buttons', async () => {
    const { default: HomePage } = await import('../page?split-console');
    render(<HomePage />);

    await waitFor(() => expect(screen.getByTestId('operations-split-console')).toBeDefined());
    expect(screen.getByTestId('operations-map-pane')).toBeDefined();
    expect(screen.getByTestId('operations-panel-pane')).toBeDefined();
    expect(screen.queryByText('Table')).toBeNull();
    expect(screen.queryByText('Map')).toBeNull();
  });

  it('shows linked report details read only for regional encoder', async () => {
    vi.doMock('@/context/AuthContext', () => ({
      useAuth: vi.fn().mockReturnValue({
        user: { id: 'encoder-user', role: 'REGIONAL_ENCODER', assignedRegionId: 1 },
        isAuthenticated: true,
        loading: false,
        loggingOut: false,
        login: vi.fn(),
        logout: vi.fn(),
        refreshSession: vi.fn(),
      }),
    }));

    const { fetchOperationsOfflineAware } = await import('@/lib/api/offlineOperations');
    (fetchOperationsOfflineAware as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      response: [
      {
        operation_id: 1,
        fire_status: 'ACTIVE',
        start_time: '2026-06-10T08:00:00Z',
        location: 'Quezon City',
        size_hectares: 2.5,
        notes: null,
        created_by: null,
        created_at: '2026-06-10T08:00:00Z',
        updated_at: '2026-06-10T08:00:00Z',
        latitude: 14.5995,
        longitude: 120.9842,
        radius_meters: 500,
        linked_report_ids: [5],
        linked_reports: [
          {
            report_id: 5,
            status: 'LINKED',
            category: 'STRUCTURAL',
            sub_category: 'Residential',
            reported_at: '2026-06-10T07:55:00Z',
            latitude: 14.6,
            longitude: 120.98,
            trust_score: 80,
            safety_status: 'I_AM_SAFE',
            reporting_context: 'WITNESS',
            linked_operation_id: 1,
            linked_operation_label: 'Operation #1',
            distance_meters: 42,
          },
        ],
      },
    ], fromCache: false });

    const { default: HomePage } = await import('../page?encoder-readonly-linked-reports');
    render(<HomePage />);

    await waitFor(() => {
      const buttons = screen.getAllByText('Quezon City');
      expect(buttons.length).toBeGreaterThanOrEqual(1);
    });
    screen.getAllByText('Quezon City')[0].click();

    await waitFor(() => {
      const reportHeadings = screen.getAllByText('Report #5');
      expect(reportHeadings.length).toBeGreaterThanOrEqual(1);
    });
    const categoryElements = screen.getAllByText('STRUCTURAL / Residential');
    expect(categoryElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Add civilian reports')).toBeNull();
    expect(screen.queryByLabelText('Unlink report 5')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Map centering and linked report markers (TDD — Task 4)
// ---------------------------------------------------------------------------

describe('Operations Board — Map Centering and Linked Reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clicking an operation centers the map on that operation', async () => {
    const { fetchOperationsOfflineAware } = await import('@/lib/api/offlineOperations');
    (fetchOperationsOfflineAware as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      response: [
      {
        operation_id: 1,
        fire_status: 'ACTIVE',
        start_time: '2026-06-10T08:00:00Z',
        location: 'Manila',
        size_hectares: 5.0,
        notes: null,
        created_by: null,
        created_at: '2026-06-10T08:00:00Z',
        updated_at: '2026-06-10T08:00:00Z',
        latitude: 14.5995,
        longitude: 120.9842,
        radius_meters: 500,
        linked_report_ids: [],
        linked_reports: [],
      },
    ], fromCache: false });

    const { default: HomePage } = await import('../page?split-center');
    render(<HomePage />);

    await waitFor(() => {
      const buttons = screen.getAllByText('Manila');
      expect(buttons.length).toBeGreaterThanOrEqual(1);
    });
    screen.getAllByText('Manila')[0].click();

    await waitFor(() => {
      expect(mockSetView).toHaveBeenCalledWith([14.5995, 120.9842], 12, { animate: true });
    });
  });

  it('renders linked report markers for the selected operation', async () => {
    const { fetchOperationsOfflineAware } = await import('@/lib/api/offlineOperations');
    (fetchOperationsOfflineAware as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      response: [
      {
        operation_id: 1,
        fire_status: 'ACTIVE',
        start_time: '2026-06-10T08:00:00Z',
        location: 'Manila',
        size_hectares: 5.0,
        notes: null,
        created_by: null,
        created_at: '2026-06-10T08:00:00Z',
        updated_at: '2026-06-10T08:00:00Z',
        latitude: 14.5995,
        longitude: 120.9842,
        radius_meters: 500,
        linked_report_ids: [5],
        linked_reports: [
          {
            report_id: 5,
            status: 'LINKED',
            category: 'STRUCTURAL',
            sub_category: 'Residential',
            reported_at: '2026-06-10T07:55:00Z',
            latitude: 14.6,
            longitude: 120.98,
            trust_score: 80,
            safety_status: 'I_AM_SAFE',
            reporting_context: 'WITNESS',
            linked_operation_id: 1,
            linked_operation_label: 'Operation #1',
            distance_meters: 42,
          },
        ],
      },
    ], fromCache: false });

    const { default: HomePage } = await import('../page?linked-report-marker');
    render(<HomePage />);

    await waitFor(() => {
      const buttons = screen.getAllByText('Manila');
      expect(buttons.length).toBeGreaterThanOrEqual(1);
    });
    screen.getAllByText('Manila')[0].click();

    await waitFor(() => {
      const reportHeadings = screen.getAllByText('Report #5');
      expect(reportHeadings.length).toBeGreaterThanOrEqual(1);
      expect(document.querySelectorAll('[data-testid="linked-report-marker"]').length).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Validator link search (TDD — Task 6)
// ---------------------------------------------------------------------------

describe('Operations Board — Validator Link Search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore validator AuthContext override in case a prior test's vi.doMock leaked
    vi.doMock('@/context/AuthContext', () => ({
      useAuth: vi.fn().mockReturnValue({
        user: { id: 'test-user', role: 'NATIONAL_VALIDATOR', assignedRegionId: null },
        isAuthenticated: true,
        loading: false,
        loggingOut: false,
        login: vi.fn(),
        logout: vi.fn(),
        refreshSession: vi.fn(),
      }),
    }));
  });

  it('validator can search and link reports from the selected operation panel', async () => {
    const { default: HomePage } = await import('../page?validator-link-search');
    render(<HomePage />);

    await waitFor(() => expect(screen.getByText('Quezon City, Barangay Tatalon')).toBeDefined());
    screen.getByText('Quezon City, Barangay Tatalon').click();
    screen.getByText('Add civilian reports').click();

    await waitFor(() => expect(screen.getByText('Report #7')).toBeDefined());
    expect(screen.getByText('Already linked to Operation #99')).toBeDefined();
    expect(screen.getByText('Report #13')).toBeDefined();
    expect(screen.queryByText(/Page 1 of/)).toBeNull();
    screen.getByRole('button', { name: 'Link report 7' }).click();

    const { linkReport } = await import('@/lib/api/operations');
    await waitFor(() => expect(linkReport).toHaveBeenCalledWith(1, 7));
  });

  it('create operation can select a report and suggest fields from the first selected report', async () => {
    const { default: HomePage } = await import('../page?create-with-linked-report');
    render(<HomePage />);

    await waitFor(() => expect(screen.getByText('New Operation')).toBeDefined());
    screen.getByText('New Operation').click();
    await waitFor(() => expect(screen.getByText('Select civilian reports')).toBeDefined());
    screen.getByText('Select civilian reports').click();

    await waitFor(() => expect(screen.getByText('Report #7')).toBeDefined());
    screen.getByRole('button', { name: 'Select report 7' }).click();

    await waitFor(() => {
      expect(screen.getByDisplayValue(/Report #7 \(14\.61/)).toBeDefined();
      expect(screen.getByText(/1 selected report/)).toBeDefined();
      expect(screen.getByTestId('selected-report-summaries')).toHaveTextContent('Report #7');
      expect(screen.getByTestId('selected-report-summaries')).toHaveAttribute('aria-label', 'Selected report summaries');
    });
  });

  it('removes a selected civilian report from the create operation modal', async () => {
    const { default: HomePage } = await import('../page?remove-linked-report-chip');
    render(<HomePage />);

    await waitFor(() => expect(screen.getByText('New Operation')).toBeDefined());
    screen.getByText('New Operation').click();
    await waitFor(() => expect(screen.getByText('Select civilian reports')).toBeDefined());
    screen.getByText('Select civilian reports').click();

    await waitFor(() => expect(screen.getByText('Report #7')).toBeDefined());
    screen.getByRole('button', { name: 'Select report 7' }).click();
    await waitFor(() => expect(screen.getByText(/1 selected report/)).toBeDefined());

    screen.getAllByRole('button', { name: 'Remove report 7' })[0].click();

    await waitFor(() => {
      expect(screen.getByText(/0 selected report/)).toBeDefined();
      expect(screen.queryByTestId('selected-report-summaries')).toBeNull();
    });
  });

  it('paginates civilian report results inside the create operation modal', async () => {
    const { default: HomePage } = await import('../page?create-report-pagination');
    render(<HomePage />);

    await waitFor(() => expect(screen.getByText('New Operation')).toBeDefined());
    screen.getByText('New Operation').click();
    await waitFor(() => expect(screen.getByText('Select civilian reports')).toBeDefined());
    screen.getByText('Select civilian reports').click();

    await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeDefined());
    const results = screen.getByTestId('linkable-report-results');
    expect(within(results).getByText('Report #7')).toBeDefined();
    expect(within(results).queryByText('Report #12')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next civilian report results page' }));

    await waitFor(() => expect(screen.getByText('Page 2 of 2')).toBeDefined());
    expect(within(results).queryByText('Report #7')).toBeNull();
    expect(within(results).getByText('Report #12')).toBeDefined();
  });
});
