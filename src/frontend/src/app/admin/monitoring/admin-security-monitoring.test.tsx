/**
 * TDD: M8 Security Monitoring page
 *
 * Verifies that on /admin/monitoring:
 * 1. Summary cards render with correct data from fetchSecurityLogsSummary
 * 2. Severity chip toggle calls fetchAdminSecurityLogs with correct severity filter
 * 3. Empty state when no threats
 * 4. Distribution bar renders severity labels when data is present
 * 5. T3: Non-admin users see access-restricted message (auth gate)
 * 6. T4: Non-empty threat feed renders table rows with severity badges
 * 7. S2+S3: API failure shows user-visible error banner instead of "No threats found"
 * 8. Q1: Pagination Next button is disabled when total shows no more pages
 */
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SecurityMonitoringPage from './page';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(() => ({
    user: { role: 'SYSTEM_ADMIN' },
    loading: false,
    logout: vi.fn(),
  })),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockFetchSecurityLogsSummary = vi.fn();
const mockFetchAdminSecurityLogs = vi.fn();
const mockFetchAuditLogs = vi.fn();

vi.mock('@/lib/api/legacy', () => ({
  fetchSecurityLogsSummary: () => mockFetchSecurityLogsSummary(),
  fetchAdminSecurityLogs: (params?: unknown) => mockFetchAdminSecurityLogs(params),
  fetchAuditLogs: (params?: unknown) => mockFetchAuditLogs(params),
}));

const DEFAULT_SUMMARY = {
  by_severity: { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 },
  unreviewed_count: 5,
  total: 10,
  recent_narratives: [] as Array<{
    log_id: number;
    severity_level: string;
    xai_narrative: string | null;
    timestamp: string;
  }>,
};

function mockAdminUser() {
  mockUseAuth.mockReturnValue({
    user: { role: 'SYSTEM_ADMIN' },
    loading: false,
    logout: vi.fn(),
  });
}

function mockNonAdminUser() {
  mockUseAuth.mockReturnValue({
    user: { role: 'REGIONAL_ENCODER' },
    loading: false,
    logout: vi.fn(),
  });
}

describe('M8: Security Monitoring page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAdminUser();
    mockFetchAuditLogs.mockResolvedValue({ items: [], total: 0 });
    mockFetchSecurityLogsSummary.mockResolvedValue(DEFAULT_SUMMARY);
    mockFetchAdminSecurityLogs.mockResolvedValue({ items: [], total: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // ── Original tests (updated for new API shape) ──────────────────────────

  it('summary cards render with correct data', async () => {
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('10')).toBeInTheDocument();
    });
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument(); // HIGH (3) + CRITICAL (4)
  });

  it('severity chip toggle calls API with correct severity', async () => {
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

    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText(/LOW \(5\)/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/MEDIUM \(10\)/i)).toBeInTheDocument();
    expect(screen.getByText(/HIGH \(3\)/i)).toBeInTheDocument();
    expect(screen.getByText(/CRITICAL \(2\)/i)).toBeInTheDocument();
  });

  // ── T3: Auth gate test ──────────────────────────────────────────────────

  it('shows access-restricted message for non-admin users', async () => {
    mockNonAdminUser();

    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/Access restricted to System Administrators/i)
      ).toBeInTheDocument();
    });

    // API functions should NOT be called for non-admin users
    expect(mockFetchSecurityLogsSummary).not.toHaveBeenCalled();
    expect(mockFetchAdminSecurityLogs).not.toHaveBeenCalled();
    expect(mockFetchAuditLogs).not.toHaveBeenCalled();
  });

  // ── T4: Non-empty threat feed rendering ─────────────────────────────────

  it('renders threat feed table rows with severity badges when data is present', async () => {
    mockFetchAdminSecurityLogs.mockResolvedValue({
      items: [
        {
          log_id: 101,
          timestamp: '2026-06-12T10:30:00Z',
          source_ip: '192.168.1.100',
          severity_level: 'HIGH',
          suricata_sid: 2001,
          admin_action_taken: null,
          xai_confidence: 0.88,
        },
        {
          log_id: 102,
          timestamp: '2026-06-12T09:15:00Z',
          source_ip: '10.0.0.50',
          severity_level: 'CRITICAL',
          suricata_sid: 2002,
          admin_action_taken: 'Confirmed Threat',
          xai_confidence: 0.95,
        },
      ],
      total: 2,
    });

    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    // Wait for the table to appear
    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });
    expect(screen.getByText('10.0.0.50')).toBeInTheDocument();

    // Severity badges should be visible (in the table, not the filter chips)
    const highBadges = screen.getAllByText('HIGH');
    const criticalBadges = screen.getAllByText('CRITICAL');
    // There should be at least the table badge (may also be in filter chips)
    expect(highBadges.length).toBeGreaterThanOrEqual(1);
    expect(criticalBadges.length).toBeGreaterThanOrEqual(1);

    // SID values should render
    expect(screen.getByText('2001')).toBeInTheDocument();
    expect(screen.getByText('2002')).toBeInTheDocument();

    // Status: one pending, one reviewed
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Reviewed')).toBeInTheDocument();

    // XAI confidence should display as percentage
    expect(screen.getByText('88%')).toBeInTheDocument();
    expect(screen.getByText('95%')).toBeInTheDocument();

    // Pagination should appear
    expect(screen.getByText('Previous')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();

    // Not the empty state
    expect(screen.queryByText(/No threats found/i)).not.toBeInTheDocument();
  });

  // ── S2+S3: Error state visibility ──────────────────────────────────────

  it('shows error banner when summary API fails instead of silent empty state', async () => {
    mockFetchSecurityLogsSummary.mockRejectedValue(new Error('Network error'));
    mockFetchAdminSecurityLogs.mockResolvedValue({ items: [], total: 0 });

    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText(/Unable to load monitoring data/i)).toBeInTheDocument();
    });
  });

  it('shows error banner when threat feed API fails', async () => {
    mockFetchAdminSecurityLogs.mockRejectedValue(new Error('Server error'));

    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText(/Unable to load monitoring data/i)).toBeInTheDocument();
    });
  });

  // ── Q1: Pagination with total-based disabling ──────────────────────────

  it('disables Next button when total shows all items loaded', async () => {
    // 20 items on page 0, total 20 → no next page
    mockFetchAdminSecurityLogs.mockResolvedValue({
      items: Array.from({ length: 20 }, (_, i) => ({
        log_id: i + 1,
        timestamp: '2026-06-12T10:00:00Z',
        source_ip: `10.0.0.${i + 1}`,
        severity_level: 'LOW' as const,
        suricata_sid: 1000 + i,
        admin_action_taken: null,
        xai_confidence: 0.5,
      })),
      total: 20,
    });

    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      const nextBtn = screen.getByText('Next');
      expect(nextBtn).toBeDisabled();
    });
  });

  it('enables Next button when more pages exist beyond current page', async () => {
    // 20 items on page 0, total 45 → next page exists
    mockFetchAdminSecurityLogs.mockResolvedValue({
      items: Array.from({ length: 20 }, (_, i) => ({
        log_id: i + 1,
        timestamp: '2026-06-12T10:00:00Z',
        source_ip: `10.0.0.${i + 1}`,
        severity_level: 'LOW' as const,
        suricata_sid: 1000 + i,
        admin_action_taken: null,
        xai_confidence: 0.5,
      })),
      total: 45,
    });

    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      const nextBtn = screen.getByText('Next');
      expect(nextBtn).not.toBeDisabled();
    });
  });
});
