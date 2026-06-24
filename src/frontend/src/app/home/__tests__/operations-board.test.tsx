import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any dynamic imports of the component
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/operations', () => ({
  fetchOperations: vi.fn().mockResolvedValue([
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
  ]),
  createOperation: vi.fn().mockResolvedValue({}),
  updateOperation: vi.fn().mockResolvedValue({}),
  deleteOperation: vi.fn().mockResolvedValue(undefined),
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
    const { fetchOperations } = await import('@/lib/api/operations');
    // Make it never resolve so we catch the loading state
    (fetchOperations as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise(() => {}));

    const { default: HomePage } = await import('../page');
    render(<HomePage />);

    // The board's loading spinner should be present
    // (we check for absence of the table body instead since spinner has no text)
    expect(screen.queryByText('Quezon City, Barangay Tatalon')).toBeNull();
  });

  it('shows "No operations found" when list is empty', async () => {
    const { fetchOperations } = await import('@/lib/api/operations');
    (fetchOperations as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

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

    const { fetchOperations } = await import('@/lib/api/operations');
    (fetchOperations as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
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
    ]);

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
    const { fetchOperations } = await import('@/lib/api/operations');
    (fetchOperations as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
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
    ]);

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
    const { fetchOperations } = await import('@/lib/api/operations');
    (fetchOperations as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
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
    ]);

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
