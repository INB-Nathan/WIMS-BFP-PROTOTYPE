import { render, screen, waitFor } from '@testing-library/react';
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
    },
  ]),
  createOperation: vi.fn().mockResolvedValue({}),
  updateOperation: vi.fn().mockResolvedValue({}),
  deleteOperation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/auth', () => ({
  useUserProfile: vi.fn().mockReturnValue({
    role: 'NATIONAL_VALIDATOR',
    assignedRegionId: null,
    loading: false,
    user: { id: 'test-user' },
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
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div className="leaflet-container">{children}</div>
  ),
  TileLayer: () => <div />,
  Circle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({
    getZoom: () => 12,
    getCenter: () => ({ lat: 14.5995, lng: 120.9842 }),
    setView: () => {},
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
    vi.doMock('@/lib/auth', () => ({
      useUserProfile: vi.fn().mockReturnValue({
        role: 'REGIONAL_ENCODER',
        assignedRegionId: 1,
        loading: false,
        user: { id: 'encoder-user' },
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
      // The mock data has linked_report_ids: [5, 6] → should show "2"
      expect(screen.getByText('2')).toBeDefined();
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
// Reproduction tests — Operations Board Map View (should FAIL on base)
// ---------------------------------------------------------------------------

describe('Operations Board — Map View Toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Table and Map view toggle buttons', async () => {
    const { default: HomePage } = await import('../page');
    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByText('Table')).toBeDefined();
      expect(screen.getByText('Map')).toBeDefined();
    });
  });

  it('switching to Map view renders the map container', async () => {
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
      },
    ]);

    const { default: HomePage } = await import('../page?map-view');
    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByText('Map')).toBeDefined();
    });

    screen.getByText('Map').click();

    await waitFor(() => {
      const container = document.querySelector('.leaflet-container');
      expect(container).toBeTruthy();
    });
  });

  it('switching back to Table view shows the operations table', async () => {
    const { default: HomePage } = await import('../page');
    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByText('Map')).toBeDefined();
    });

    screen.getByText('Map').click();

    await waitFor(() => {
      expect(document.querySelector('.leaflet-container')).toBeTruthy();
    });

    screen.getByText('Table').click();

    await waitFor(() => {
      expect(screen.getByText('Quezon City, Barangay Tatalon')).toBeDefined();
    });
  });

  it('filter tabs filter operations in map view', async () => {
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
      },
      {
        operation_id: 2,
        fire_status: 'FIRE_OUT',
        start_time: '2026-06-09T08:00:00Z',
        location: 'Cebu',
        size_hectares: 2.0,
        notes: null,
        created_by: null,
        created_at: '2026-06-09T08:00:00Z',
        updated_at: '2026-06-09T08:00:00Z',
        latitude: 10.3157,
        longitude: 123.8854,
        radius_meters: 300,
        linked_report_ids: [],
      },
    ]);

    const { default: HomePage } = await import('../page?map-filter');
    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByText('Map')).toBeDefined();
    });

    screen.getByText('Map').click();

    await waitFor(() => {
      expect(document.querySelector('.leaflet-container')).toBeTruthy();
    });

    screen.getByText('FIRE OUT').click();

    await waitFor(() => {
      expect(screen.getByText('Cebu')).toBeDefined();
      expect(screen.queryByText('Manila')).toBeNull();
    });
  });

  it('shows fallback text for operations without map coordinates', async () => {
    const { fetchOperations } = await import('@/lib/api/operations');
    (fetchOperations as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        operation_id: 1,
        fire_status: 'ACTIVE',
        start_time: '2026-06-10T08:00:00Z',
        location: 'No Coordinates City',
        size_hectares: 3.0,
        notes: null,
        created_by: null,
        created_at: '2026-06-10T08:00:00Z',
        updated_at: '2026-06-10T08:00:00Z',
        latitude: null,
        longitude: null,
        radius_meters: null,
        linked_report_ids: [],
      },
    ]);

    const { default: HomePage } = await import('../page?no-coords-v2');
    const { act } = await import('react');
    await act(async () => { render(<HomePage />); });

    await waitFor(() => {
      expect(screen.getByText('Map')).toBeDefined();
    });

    await act(async () => { screen.getByText('Map').click(); });

    await waitFor(() => {
      expect(document.querySelector('.leaflet-container')).toBeTruthy();
    });

    // Fallback list appears below the map after a short delay
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(document.body.innerHTML).toContain('without map coordinates');
    expect(screen.getByText(/No Coordinates City/)).toBeDefined();
  });
});
