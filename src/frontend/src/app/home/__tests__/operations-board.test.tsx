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
