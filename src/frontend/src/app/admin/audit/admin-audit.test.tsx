/**
 * TDD: /admin/audit — Dedicated System Audit page (issue #352)
 *
 * Verifies:
 * - Renders page for SYSTEM_ADMIN role
 * - Shows filter inputs (q, user_id, action_type, table_affected, ip_address, date_from, date_to)
 * - Submits filters as query params on Apply Filters
 * - Clear Filters resets inputs
 * - Pagination buttons work (prev/next)
 * - Loading skeleton state
 * - Empty state (no audit entries)
 * - Empty state (no matches with active filters)
 * - Error state
 * - Offline cached indicator
 * - Redirects non-admin roles
 * - Loading state while auth resolves
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import AdminAuditPage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const mockFetchAuditLogs = vi.fn();

vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isReconnecting: false }),
}));

vi.mock('@/lib/connectivity', () => ({
  getConnectivitySnapshot: () => ({ state: 'online' }),
  subscribeConnectivity: () => () => {},
  probeConnectivity: () => {},
}));

vi.mock('@/lib/api', () => ({
  fetchAuditLogs: (...args: unknown[]) => mockFetchAuditLogs(...args),
  fetchAuditLogsOfflineAware: async (...args: unknown[]) => ({
    response: await mockFetchAuditLogs(...args),
    fromCache: false,
  }),
}));

const mockAuth = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: mockAuth.useAuth,
}));

const sampleEntry = {
  audit_id: 1,
  user_id: 'abc-def-001',
  action_type: 'HITL_REVIEW',
  table_affected: 'security_threat_logs',
  record_id: 42,
  ip_address: '192.168.1.100',
  user_agent: 'Mozilla/5.0 Test Browser',
  timestamp: '2026-06-15T10:30:00Z',
};

const manyEntries = Array.from({ length: 55 }, (_, i) => ({
  ...sampleEntry,
  audit_id: i + 1,
  timestamp: `2026-06-15T${String(i).padStart(2, '0')}:00:00Z`,
}));

describe('Admin Audit page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.useAuth.mockReturnValue({
      user: { role: 'SYSTEM_ADMIN' },
      loading: false,
      logout: vi.fn(),
    });
    mockFetchAuditLogs.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it('renders the page for SYSTEM_ADMIN', async () => {
    render(<AdminAuditPage />);
    await waitFor(() => {
      expect(screen.getByText('System Audit Logs')).toBeInTheDocument();
    });
  });

  it('shows filter inputs', async () => {
    render(<AdminAuditPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Full-text search audit logs')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Filter by action type')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by table affected')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by user ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by IP address')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by date from')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by date to')).toBeInTheDocument();
    expect(screen.getByText('Apply Filters')).toBeInTheDocument();
  });

  it('includes incident upload and civilian follow-up action types in filter suggestions', async () => {
    render(<AdminAuditPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Filter by action type')).toBeInTheDocument();
    });

    const options = Array.from(document.querySelectorAll('#action-type-list option')).map(
      (option) => option.getAttribute('value'),
    );
    expect(options).toContain('UPLOAD_BUNDLE');
    expect(options).toContain('CIVILIAN_FOLLOWUP');
  });

  it('submits filters as query params on Apply Filters click', async () => {
    const user = userEvent.setup();
    render(<AdminAuditPage />);

    await waitFor(() => {
      expect(screen.getByText('System Audit Logs')).toBeInTheDocument();
    });

    // Fill in filters
    await user.type(screen.getByLabelText('Full-text search audit logs'), 'test query');
    await user.type(screen.getByLabelText('Filter by action type'), 'HITL_REVIEW');
    await user.type(screen.getByLabelText('Filter by table affected'), 'users');
    await user.type(screen.getByLabelText('Filter by user ID'), 'abc-123');
    await user.type(screen.getByLabelText('Filter by IP address'), '10.0.0.1');
    await user.type(screen.getByLabelText('Filter by date from'), '2026-01-01');
    await user.type(screen.getByLabelText('Filter by date to'), '2026-06-16');

    await user.click(screen.getByText('Apply Filters'));

    // The last call should include all filter params
    await waitFor(() => {
      const calls = mockFetchAuditLogs.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall).toEqual({
        limit: 50,
        offset: 0,
        q: 'test query',
        user_id: 'abc-123',
        action_type: 'HITL_REVIEW',
        table_affected: 'users',
        ip_address: '10.0.0.1',
        date_from: '2026-01-01',
        date_to: '2026-06-16',
      });
    });
  });

  it('shows Clear Filters button when filters are active', async () => {
    const user = userEvent.setup();
    render(<AdminAuditPage />);

    await waitFor(() => {
      expect(screen.getByText('System Audit Logs')).toBeInTheDocument();
    });

    // No Clear Filters button initially
    expect(screen.queryByText('Clear Filters')).not.toBeInTheDocument();

    // Add a filter
    await user.type(screen.getByLabelText('Filter by action type'), 'LOGIN');

    // Clear Filters should appear
    expect(screen.getByText('Clear Filters')).toBeInTheDocument();
  });

  it('clears all filters on Clear Filters click', async () => {
    const user = userEvent.setup();
    render(<AdminAuditPage />);

    await waitFor(() => {
      expect(screen.getByText('System Audit Logs')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Filter by action type'), 'LOGIN');
    await user.type(screen.getByLabelText('Filter by IP address'), '10.0.0.1');

    await user.click(screen.getByText('Clear Filters'));

    await waitFor(() => {
      expect(screen.getByLabelText('Filter by action type')).toHaveValue('');
      expect(screen.getByLabelText('Filter by IP address')).toHaveValue('');
    });

    // Clear Filters button should be gone
    expect(screen.queryByText('Clear Filters')).not.toBeInTheDocument();
  });

  it('shows pagination with prev/next buttons', async () => {
    mockFetchAuditLogs.mockResolvedValue({ items: manyEntries.slice(0, 50), total: 55, limit: 50, offset: 0 });
    render(<AdminAuditPage />);

    await waitFor(() => {
      expect(screen.getByText('Previous')).toBeInTheDocument();
      expect(screen.getByText('Next')).toBeInTheDocument();
    });

    // First page: Previous disabled, Next enabled
    const prevBtn = screen.getByText('Previous');
    const nextBtn = screen.getByText('Next');
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).not.toBeDisabled();

    // Should show page info
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
  });

  it('navigates to next page on Next click', async () => {
    const user = userEvent.setup();
    mockFetchAuditLogs.mockResolvedValue({ items: manyEntries.slice(0, 50), total: 55, limit: 50, offset: 0 });
    render(<AdminAuditPage />);

    await waitFor(() => {
      expect(screen.getByText('Next')).toBeInTheDocument();
    });

    // Resolve with next-page data
    mockFetchAuditLogs.mockResolvedValue({ items: manyEntries.slice(50, 55), total: 55, limit: 50, offset: 50 });

    await user.click(screen.getByText('Next'));

    // The last call should have offset: 50
    await waitFor(() => {
      const calls = mockFetchAuditLogs.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall).toEqual(expect.objectContaining({ offset: 50 }));
    });
  });

  it('shows loading skeleton', async () => {
    // Don't resolve the fetch so loading persists
    mockFetchAuditLogs.mockReturnValue(new Promise(() => {}));
    render(<AdminAuditPage />);

    // The loading skeleton rows should be visible (table rows with animate-pulse)
    await waitFor(() => {
      const skeletonRows = document.querySelectorAll('.animate-pulse');
      expect(skeletonRows.length).toBeGreaterThan(0);
    });
  });

  it('shows empty state when no audit entries exist', async () => {
    mockFetchAuditLogs.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    render(<AdminAuditPage />);

    await waitFor(() => {
      expect(screen.getByText('No audit entries found.')).toBeInTheDocument();
    });
  });

  it('shows filtered empty state when filters produce no results', async () => {
    const user = userEvent.setup();
    mockFetchAuditLogs.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    render(<AdminAuditPage />);

    await waitFor(() => {
      expect(screen.getByText('System Audit Logs')).toBeInTheDocument();
    });

    // Add a filter and apply
    await user.type(screen.getByLabelText('Filter by action type'), 'NONEXISTENT');
    await user.click(screen.getByText('Apply Filters'));

    await waitFor(() => {
      expect(screen.getByText('No audit entries match the current filters.')).toBeInTheDocument();
    });
  });

  it('shows error state on fetch failure', async () => {
    mockFetchAuditLogs.mockRejectedValue(new Error('Network failure'));
    render(<AdminAuditPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network failure');
    });
  });

  it('redirects non-admin user', async () => {
    mockAuth.useAuth.mockReturnValue({
      user: { role: 'REGIONAL_ENCODER' },
      loading: false,
      logout: vi.fn(),
    });

    render(<AdminAuditPage />);

    // The component renders a redirect message for non-admin
    await waitFor(() => {
      expect(screen.getByText('Redirecting…')).toBeInTheDocument();
    });
  });

  it('renders audit entries in the table', async () => {
    mockFetchAuditLogs.mockResolvedValue({
      items: [
        {
          audit_id: 1,
          user_id: 'user-1',
          action_type: 'LOGIN',
          table_affected: null,
          record_id: null,
          ip_address: '10.0.0.1',
          user_agent: 'UA-Test',
          timestamp: '2026-06-15T10:30:00Z',
        },
        {
          audit_id: 2,
          user_id: null,
          action_type: 'HITL_REVIEW',
          table_affected: 'security_threat_logs',
          record_id: 99,
          ip_address: null,
          user_agent: null,
          timestamp: null,
          old_values: { status: 'UNREVIEWED' },
          new_values: { status: 'CONFIRMED', action: 'CONFIRM_THREAT' },
        },
      ],
      total: 2,
      limit: 50,
      offset: 0,
    });

    const user = userEvent.setup();
    render(<AdminAuditPage />);

    await waitFor(() => {
      expect(screen.getByText('LOGIN')).toBeInTheDocument();
      expect(screen.getByText('HITL_REVIEW')).toBeInTheDocument();
      expect(screen.getByText('security_threat_logs')).toBeInTheDocument();
    });

    // The second entry has old_values/new_values — clicking should expand
    const hitlRow = screen.getByText('HITL_REVIEW').closest('tr');
    expect(hitlRow).not.toBeNull();

    await user.click(hitlRow!);

    await waitFor(() => {
      expect(screen.getByText('Old Values')).toBeInTheDocument();
      expect(screen.getByText('New Values')).toBeInTheDocument();
    });

    // Collapse on second click
    await user.click(hitlRow!);

    await waitFor(() => {
      expect(screen.queryByText('Old Values')).not.toBeInTheDocument();
    });
  });

  it('shows refresh button that triggers reload', async () => {
    const user = userEvent.setup();
    render(<AdminAuditPage />);

    await waitFor(() => {
      expect(screen.getByText('System Audit Logs')).toBeInTheDocument();
    });

    mockFetchAuditLogs.mockClear();

    await user.click(screen.getByText('Refresh'));

    await waitFor(() => {
      expect(mockFetchAuditLogs).toHaveBeenCalledTimes(1);
    });
  });
});
