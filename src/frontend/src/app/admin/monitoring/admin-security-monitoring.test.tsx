/**
 * TDD: M8 Security Monitoring page
 *
 * Verifies that on /admin/monitoring:
 * 1. Summary cards render with correct data from fetchSecurityLogsSummary
 * 2. Severity chip toggle calls fetchAdminSecurityLogs with correct severity filter
 * 3. Empty state when no threats
 * 4. Distribution bar renders severity labels when data is present
 */
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SecurityMonitoringPage from './page';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { role: 'SYSTEM_ADMIN' },
    loading: false,
    logout: vi.fn(),
  }),
}));

const mockFetchSecurityLogsSummary = vi.fn();
const mockFetchAdminSecurityLogs = vi.fn();
const mockFetchAuditLogs = vi.fn();

vi.mock('@/lib/api/legacy', () => ({
  fetchSecurityLogsSummary: () => mockFetchSecurityLogsSummary(),
  fetchAdminSecurityLogs: (params?: unknown) => mockFetchAdminSecurityLogs(params),
  fetchAuditLogs: (params?: unknown) => mockFetchAuditLogs(params),
}));

describe('M8: Security Monitoring page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockFetchAuditLogs.mockResolvedValue({ items: [], total: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('summary cards render with correct data', async () => {
    mockFetchSecurityLogsSummary.mockResolvedValue({
      by_severity: { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 },
      unreviewed_count: 5,
      total: 10,
      recent_narratives: [],
    });
    mockFetchAdminSecurityLogs.mockResolvedValue([]);

    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('10')).toBeInTheDocument();
    });
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument(); // HIGH (3) + CRITICAL (4)
  });

  it('severity chip toggle calls API with correct severity', async () => {
    mockFetchSecurityLogsSummary.mockResolvedValue({
      by_severity: { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 },
      unreviewed_count: 0,
      total: 10,
      recent_narratives: [],
    });
    mockFetchAdminSecurityLogs.mockResolvedValue([]);

    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(mockFetchAdminSecurityLogs).toHaveBeenCalled();
    });

    const highChip = screen.getByRole('button', { name: /HIGH/i });
    await user.click(highChip);

    await waitFor(() => {
      const calls = mockFetchAdminSecurityLogs.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall?.severity).toBe('HIGH');
    });
  });

  it('empty state when no threats', async () => {
    mockFetchSecurityLogsSummary.mockResolvedValue({
      by_severity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
      unreviewed_count: 0,
      total: 0,
      recent_narratives: [],
    });
    mockFetchAdminSecurityLogs.mockResolvedValue([]);

    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText(/No threats recorded/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/No threats found/i)).toBeInTheDocument();
  });

  it('distribution bar renders severity labels when data is present', async () => {
    mockFetchSecurityLogsSummary.mockResolvedValue({
      by_severity: { LOW: 5, MEDIUM: 10, HIGH: 3, CRITICAL: 2 },
      unreviewed_count: 0,
      total: 20,
      recent_narratives: [],
    });
    mockFetchAdminSecurityLogs.mockResolvedValue([]);

    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText(/LOW \(5\)/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/MEDIUM \(10\)/i)).toBeInTheDocument();
    expect(screen.getByText(/HIGH \(3\)/i)).toBeInTheDocument();
    expect(screen.getByText(/CRITICAL \(2\)/i)).toBeInTheDocument();
  });
});
