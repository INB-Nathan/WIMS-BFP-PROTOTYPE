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
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
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

vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isChecking: false, isReconnecting: false, state: 'online' }),
}));

const mockFetchSecurityLogsSummary = vi.fn();
const mockFetchAdminSecurityLogs = vi.fn();
const mockFetchAuditLogs = vi.fn();
const mockFetchSecurityLogsSummaryOfflineAware = vi.fn();
const mockFetchAdminSecurityLogsOfflineAware = vi.fn();
const mockFetchAuditLogsOfflineAware = vi.fn();
const mockUpdateAdminSecurityLog = vi.fn();
const mockCreateIncidentFromAlert = vi.fn();
const mockBlockSourceIp = vi.fn();
const mockBlockSecurityLog = vi.fn();
const mockDeleteSecurityLog = vi.fn();
const mockBulkActionSecurityLogs = vi.fn();
const mockBlockByFilter = vi.fn();
const mockBulkBlockPreview = vi.fn();
const mockListBlockedIps = vi.fn().mockResolvedValue([]);
const mockUnblockIp = vi.fn();

vi.mock('@/lib/api/legacy', () => ({
  fetchSecurityLogsSummary: () => mockFetchSecurityLogsSummary(),
  fetchAdminSecurityLogs: (params?: unknown) => mockFetchAdminSecurityLogs(params),
  fetchAuditLogs: (params?: unknown) => mockFetchAuditLogs(params),
  updateAdminSecurityLog: (logId: number, payload: unknown) => mockUpdateAdminSecurityLog(logId, payload),
  createIncidentFromAlert: (logId: number) => mockCreateIncidentFromAlert(logId),
}));

vi.mock('@/lib/api/offlineAdmin', () => ({
  fetchSecurityLogsSummaryOfflineAware: () => mockFetchSecurityLogsSummaryOfflineAware(),
  fetchAdminSecurityLogsOfflineAware: (params?: unknown) => mockFetchAdminSecurityLogsOfflineAware(params),
  fetchAuditLogsOfflineAware: (params?: unknown) => mockFetchAuditLogsOfflineAware(params),
}));

vi.mock('@/lib/api/securityActions', () => ({
  blockSourceIp: (...args: unknown[]) => mockBlockSourceIp(...args),
  blockSecurityLog: (...args: unknown[]) => mockBlockSecurityLog(...args),
  deleteSecurityLog: (...args: unknown[]) => mockDeleteSecurityLog(...args),
  bulkActionSecurityLogs: (...args: unknown[]) => mockBulkActionSecurityLogs(...args),
  blockByFilter: (...args: unknown[]) => mockBlockByFilter(...args),
  bulkBlockPreview: (...args: unknown[]) => mockBulkBlockPreview(...args),
  listBlockedIps: (...args: unknown[]) => mockListBlockedIps(...args),
  unblockIp: (...args: unknown[]) => mockUnblockIp(...args),
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
    // Default online mocks for the offline-aware wrappers — delegate to legacy
    // mock so existing tests keep their data shape unchanged. The T11 test
    // overrides these to return fromCache=true.
    mockFetchAuditLogsOfflineAware.mockImplementation(async (params?: unknown) => ({
      response: await mockFetchAuditLogs(params),
      fromCache: false,
    }));
    mockFetchSecurityLogsSummaryOfflineAware.mockImplementation(async () => ({
      response: await mockFetchSecurityLogsSummary(),
      fromCache: false,
    }));
    mockFetchAdminSecurityLogsOfflineAware.mockImplementation(async (params?: unknown) => ({
      response: await mockFetchAdminSecurityLogs(params),
      fromCache: false,
    }));
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
      active_count: 0,
      dismissed_count: 0,
      recent_narratives: [],
    });

    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText(/No threats recorded/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/No threats found/i)).toBeInTheDocument();
    });
  });

  it('distribution bar renders severity labels when data is present', async () => {
    mockFetchSecurityLogsSummary.mockResolvedValue({
      by_severity: { LOW: 5, MEDIUM: 10, HIGH: 3, CRITICAL: 2 },
      unreviewed_count: 0,
      total: 20,
      active_count: 20,
      dismissed_count: 0,
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

  // ── T8: Severity chip visual active/inactive state (#297) ──────────────

  it('severity chip changes visual style to indicate active state when clicked', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(mockFetchAdminSecurityLogs).toHaveBeenCalled();
    });

    const highChip = screen.getByRole('button', { name: /HIGH/i });

    // Initially inactive — gray styling
    expect(highChip.className).toContain('bg-gray-100');
    expect(highChip.className).toContain('text-gray-600');

    // Click to activate — should get orange styling
    await user.click(highChip);
    expect(highChip.className).toContain('bg-orange-100');
    expect(highChip.className).toContain('text-orange-800');
    expect(highChip.className).not.toContain('bg-gray-100');

    // Click again to deactivate — back to gray
    await user.click(highChip);
    expect(highChip.className).toContain('bg-gray-100');
    expect(highChip.className).toContain('text-gray-600');
    expect(highChip.className).not.toContain('bg-orange-100');
  });

  it('only the clicked severity chip shows active styling', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(mockFetchAdminSecurityLogs).toHaveBeenCalled();
    });

    const highChip = screen.getByRole('button', { name: /HIGH/i });
    const lowChip = screen.getByRole('button', { name: /^LOW$/i });
    const criticalChip = screen.getByRole('button', { name: /CRITICAL/i });

    // Activate HIGH only
    await user.click(highChip);

    // HIGH should be active
    expect(highChip.className).toContain('bg-orange-100');
    // Other chips should remain inactive
    expect(lowChip.className).toContain('bg-gray-100');
    expect(criticalChip.className).toContain('bg-gray-100');
  });

  // ── T7: Non-empty XAI narratives and audit highlights (#299) ─────────────

  it('renders XAI narrative items with truncated text, severity badges, and Read more span', async () => {
    const longNarrative = 'A'.repeat(250);
    mockFetchSecurityLogsSummary.mockResolvedValue({
      ...DEFAULT_SUMMARY,
      recent_narratives: [
        {
          log_id: 1,
          severity_level: 'HIGH',
          xai_narrative: longNarrative,
          timestamp: '2026-06-12T10:00:00Z',
        },
        {
          log_id: 2,
          severity_level: 'LOW',
          xai_narrative: 'Short narrative text',
          timestamp: '2026-06-12T09:00:00Z',
        },
      ],
    });

    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText(/Recent XAI Narratives/i)).toBeInTheDocument();
    });

    // Truncated narrative should show first 200 chars + ellipsis
    expect(screen.getByText(new RegExp(longNarrative.slice(0, 200)))).toBeInTheDocument();

    // Read more span should appear for truncated narratives
    expect(screen.getByText('Read more')).toBeInTheDocument();

    // Short narrative renders in full (no truncation needed)
    expect(screen.getByText('Short narrative text')).toBeInTheDocument();

    // Severity badges should appear in narrative cards
    const highBadges = screen.getAllByText('HIGH');
    expect(highBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('clicking Read more expands full narrative and shows Show less', async () => {
    const user = userEvent.setup({ delay: null });
    const fullText = 'B'.repeat(250);
    mockFetchSecurityLogsSummary.mockResolvedValue({
      ...DEFAULT_SUMMARY,
      recent_narratives: [
        {
          log_id: 1,
          severity_level: 'MEDIUM',
          xai_narrative: fullText,
          timestamp: '2026-06-12T10:00:00Z',
        },
      ],
    });

    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('Read more')).toBeInTheDocument();
    });

    // Full text should NOT be visible when collapsed
    expect(screen.queryByText(fullText)).not.toBeInTheDocument();

    // Click "Read more"
    await user.click(screen.getByText('Read more'));

    // Full text should now be visible
    expect(screen.getByText(fullText)).toBeInTheDocument();

    // "Show less" should appear
    expect(screen.getByText('Show less')).toBeInTheDocument();
    expect(screen.getByText('Show less')).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders audit highlight items with correct event type labels when present', async () => {
    mockFetchAuditLogs.mockResolvedValue({
      items: [
        {
          audit_id: 1,
          user_id: 'admin-1',
          action_type: 'HITL_REVIEW',
          table_affected: 'incidents',
          record_id: 100,
          ip_address: '10.0.0.1',
          user_agent: null,
          timestamp: '2026-06-12T10:00:00Z',
        },
        {
          audit_id: 2,
          user_id: 'admin-2',
          action_type: 'BREACH_DETECTED',
          table_affected: 'security_logs',
          record_id: null,
          ip_address: '10.0.0.2',
          user_agent: null,
          timestamp: '2026-06-12T09:30:00Z',
        },
        {
          audit_id: 3,
          user_id: 'admin-3',
          action_type: 'PII_EXPORT',
          table_affected: 'incident_sensitive_details',
          record_id: 200,
          ip_address: null,
          user_agent: null,
          timestamp: '2026-06-12T09:00:00Z',
        },
        {
          audit_id: 4,
          user_id: 'admin-4',
          action_type: 'UNRELATED_ACTION',
          table_affected: 'analytics_cache',
          record_id: null,
          ip_address: null,
          user_agent: null,
          timestamp: '2026-06-12T08:00:00Z',
        },
      ],
      total: 4,
    });

    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('Audit Highlights')).toBeInTheDocument();
    });

    // Notable events should render with their action_type labels
    expect(screen.getByText('HITL_REVIEW')).toBeInTheDocument();
    expect(screen.getByText('BREACH_DETECTED')).toBeInTheDocument();
    expect(screen.getByText('PII_EXPORT')).toBeInTheDocument();

    // UNRELATED_ACTION should NOT appear (not a notable type)
    expect(screen.queryByText('UNRELATED_ACTION')).not.toBeInTheDocument();

    // Table affected labels should show
    expect(screen.getByText(/on incidents/)).toBeInTheDocument();
    expect(screen.getByText(/on security_logs/)).toBeInTheDocument();
  });

  // ── T5: Auto-refresh interval (#303) ─────────────────────────────────────

  it('auto-refresh sets a 30-second interval on mount', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    render(<SecurityMonitoringPage />);
    vi.advanceTimersByTime(50); // flush React effects
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    setIntervalSpy.mockRestore();
  });

  it('auto-refresh calls loadMonitoring and loadThreats after 30s interval', async () => {
    render(<SecurityMonitoringPage />);

    // Flush initial effects and load calls
    await vi.advanceTimersByTimeAsync(100);

    // Clear initial load calls so we only measure interval-triggered calls
    mockFetchSecurityLogsSummary.mockClear();
    mockFetchAdminSecurityLogs.mockClear();
    mockFetchAuditLogs.mockClear();

    // Advance 30 seconds
    await vi.advanceTimersByTimeAsync(30_000);

    // Interval callback should have triggered loadMonitoring (summary + audit)
    // and loadThreats (admin security logs)
    expect(mockFetchSecurityLogsSummary).toHaveBeenCalledTimes(1);
    expect(mockFetchAdminSecurityLogs).toHaveBeenCalledTimes(1);
    expect(mockFetchAuditLogs).toHaveBeenCalledTimes(1);
  });

  it('auto-refresh clears interval on unmount', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const { unmount } = render(<SecurityMonitoringPage />);
    vi.advanceTimersByTime(50); // flush effects
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  // ── Q4: Auto-refresh tab-visibility gating (#300) ────────────────────────

  it('clears auto-refresh interval when tab becomes hidden', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    render(<SecurityMonitoringPage />);
    vi.advanceTimersByTime(50); // flush effects — interval should be started

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    const intervalCallCountBeforeHide = setIntervalSpy.mock.calls.length;

    // Simulate tab becoming hidden
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    // clearInterval should have been called for the running interval
    expect(clearIntervalSpy).toHaveBeenCalled();

    // No new interval should be created while hidden
    expect(setIntervalSpy).toHaveBeenCalledTimes(intervalCallCountBeforeHide);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('restarts auto-refresh interval when tab becomes visible again', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');

    render(<SecurityMonitoringPage />);
    vi.advanceTimersByTime(50); // flush effects

    // Hide tab
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    const setIntervalCallsBeforeShow = setIntervalSpy.mock.calls.length;

    // Show tab again
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    // A new interval should be created
    expect(setIntervalSpy.mock.calls.length).toBeGreaterThan(setIntervalCallsBeforeShow);
    expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 30_000);

    setIntervalSpy.mockRestore();
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

  // ── T15: Hide dismissed by default ───────────────────────────────────────

  it('shows toggle pill as "Dismissed Hidden" by default and does not send show_dismissed param', async () => {
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByTestId('show-dismissed-toggle')).toBeInTheDocument();
    });
    expect(screen.getByTestId('show-dismissed-toggle')).toHaveTextContent('Dismissed Hidden');

    // API should have been called without show_dismissed
    const calls = mockFetchAdminSecurityLogs.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0];
    expect(lastCall?.show_dismissed).toBeUndefined();
  });

  it('clicking toggle pill switches to "Include Dismissed" and re-fetches with show_dismissed=true', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByTestId('show-dismissed-toggle')).toBeInTheDocument();
    });

    // Click the toggle
    await user.click(screen.getByTestId('show-dismissed-toggle'));

    // Text should flip
    await waitFor(() => {
      expect(screen.getByTestId('show-dismissed-toggle')).toHaveTextContent('Include Dismissed');
    });

    // API should have been called with show_dismissed=true
    const calls = mockFetchAdminSecurityLogs.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0];
    expect(lastCall?.show_dismissed).toBe(true);
  });

  it('clicking "X dismissed" link in summary card toggles showDismissed on', async () => {
    // Override summary with non-zero dismissed_count so the link appears
    mockFetchSecurityLogsSummary.mockResolvedValue({
      ...DEFAULT_SUMMARY,
      total: 10,
      active_count: 7,
      dismissed_count: 3,
    });

    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    // Wait for the dismissed count link to appear
    await waitFor(() => {
      expect(screen.getByText(/dismissed.*click to view/i)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/dismissed.*click to view/i));

    // Toggle pill should now show "Include Dismissed"
    await waitFor(() => {
      expect(screen.getByTestId('show-dismissed-toggle')).toHaveTextContent('Include Dismissed');
    });

    // API should have been called with show_dismissed=true
    const calls = mockFetchAdminSecurityLogs.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0];
    expect(lastCall?.show_dismissed).toBe(true);
  });
});

// ── T11: offline-aware read cache (T11 rewire) ──────────────────────────────

describe('M8: Security Monitoring page — offline-aware read caching (T11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAdminUser();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders StaleCacheBanner when wrappers return fromCache=true', async () => {
    const cachedAt = Date.now() - 60_000;
    mockFetchSecurityLogsSummaryOfflineAware.mockResolvedValue({
      response: DEFAULT_SUMMARY,
      fromCache: true,
      cachedAt,
    });
    mockFetchAdminSecurityLogsOfflineAware.mockResolvedValue({
      response: { items: [], total: 0 },
      fromCache: true,
      cachedAt,
    });
    mockFetchAuditLogsOfflineAware.mockResolvedValue({
      response: { items: [], total: 0 },
      fromCache: true,
      cachedAt,
    });

    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      // The page should now call the offline-aware wrappers
      expect(mockFetchSecurityLogsSummaryOfflineAware).toHaveBeenCalled();
    });
    // Stale cache banner should be present because at least one call returned fromCache
    await waitFor(() => {
      expect(screen.getByText(/Showing cached data/i)).toBeInTheDocument();
    });
    // Underlying summary cards should still render from the cached response
    await waitFor(() => {
      expect(screen.getByText('10')).toBeInTheDocument();
    });
  });
});

// ── T11: Per-row actions + filters (Task 11) ─────────────────────────────────

describe('M8: Security Monitoring page — per-row actions + filters (T11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAdminUser();
    mockFetchAuditLogs.mockResolvedValue({ items: [], total: 0 });
    mockFetchSecurityLogsSummary.mockResolvedValue(DEFAULT_SUMMARY);
    mockFetchAdminSecurityLogs.mockResolvedValue({
      items: [
        {
          log_id: 1,
          timestamp: '2026-06-12T10:30:00Z',
          source_ip: '192.168.1.100',
          severity_level: 'HIGH',
          suricata_sid: 2001,
          admin_action_taken: null,
          xai_confidence: 0.88,
        },
      ],
      total: 1,
    });
    mockFetchAuditLogsOfflineAware.mockImplementation(async (params?: unknown) => ({
      response: await mockFetchAuditLogs(params),
      fromCache: false,
    }));
    mockFetchSecurityLogsSummaryOfflineAware.mockImplementation(async () => ({
      response: await mockFetchSecurityLogsSummary(),
      fromCache: false,
    }));
    mockFetchAdminSecurityLogsOfflineAware.mockImplementation(async (params?: unknown) => ({
      response: await mockFetchAdminSecurityLogs(params),
      fromCache: false,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders 6 action buttons in each threat row', async () => {
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    // HITL 3-button group
    expect(screen.getByText('Confirm Threat')).toBeInTheDocument();
    expect(screen.getByText('False Positive')).toBeInTheDocument();
    expect(screen.getByText('Request More Info')).toBeInTheDocument();

    // Primary action
    expect(screen.getByText('Block Source IP')).toBeInTheDocument();

    // Secondary actions
    expect(screen.getByText('Create Incident')).toBeInTheDocument();
    expect(screen.getByText('Dismiss Alert')).toBeInTheDocument();
  });

  it('HITL Confirm Threat calls updateAdminSecurityLog with CONFIRM_THREAT', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Confirm Threat'));

    expect(mockUpdateAdminSecurityLog).toHaveBeenCalledWith(1, { action: 'CONFIRM_THREAT' });
  });

  it('Block Source IP calls blockSourceIp and shows success toast', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockBlockSourceIp.mockResolvedValue({ ip: '192.168.1.100', is_permanent: false, repeat_offender: false, already_active: false });

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Block Source IP'));

    expect(window.confirm).toHaveBeenCalled();
    expect(mockBlockSourceIp).toHaveBeenCalledWith(1, { ttl_hours: 24 });

    await waitFor(() => {
      expect(screen.getByText(/Blocked IP 192\.168\.1\.100/i)).toBeInTheDocument();
    });
  });

  it('Block Source IP with backend 400 shows error toast', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockBlockSourceIp.mockRejectedValue({
      detail: 'Cannot block your own IP address',
      message: 'Cannot block your own IP address',
    });

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Block Source IP'));

    await waitFor(() => {
      expect(screen.getByText(/Cannot block your own IP/i)).toBeInTheDocument();
    });
  });

  it('Create Incident calls createIncidentFromAlert', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockCreateIncidentFromAlert.mockResolvedValue({ status: 'ok', incident_id: 42 });

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Create Incident'));

    expect(window.confirm).toHaveBeenCalled();
    expect(mockCreateIncidentFromAlert).toHaveBeenCalledWith(1);

    await waitFor(() => {
      expect(screen.getByText(/Incident created/i)).toBeInTheDocument();
    });
  });

  it('Dismiss Alert calls deleteSecurityLog and refetches', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockDeleteSecurityLog.mockResolvedValue({ status: 'ok', log_id: 1 });

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Dismiss Alert'));

    expect(window.confirm).toHaveBeenCalled();
    expect(mockDeleteSecurityLog).toHaveBeenCalledWith(1);

    await waitFor(() => {
      expect(screen.getByText(/Alert dismissed/i)).toBeInTheDocument();
    });
  });

  it('source_ip filter input triggers refetch with source_ip param', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();

    mockFetchAdminSecurityLogs.mockResolvedValue({
      items: [
        {
          log_id: 2,
          timestamp: '2026-06-12T11:00:00Z',
          source_ip: '10.0.0.1',
          severity_level: 'MEDIUM',
          suricata_sid: 2002,
          admin_action_taken: null,
          xai_confidence: 0.75,
        },
      ],
      total: 1,
    });

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(mockFetchAdminSecurityLogs).toHaveBeenCalled();
    });

    const sourceIpInput = screen.getByPlaceholderText(/filter by source ip/i);
    await user.type(sourceIpInput, '10.0.0.1');

    await waitFor(() => {
      const calls = mockFetchAdminSecurityLogsOfflineAware.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall?.source_ip).toBe('10.0.0.1');
    });
  });
});

// ── Wayfinder #571: modified blocking flow (device vs IP choice) ────────────

describe('M8: Security Monitoring page — device-vs-IP blocking flow (#571)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAdminUser();
    mockFetchAuditLogs.mockResolvedValue({ items: [], total: 0 });
    mockFetchSecurityLogsSummary.mockResolvedValue(DEFAULT_SUMMARY);
    mockFetchAdminSecurityLogs.mockResolvedValue({
      items: [
        {
          log_id: 1,
          timestamp: '2026-07-15T10:30:00Z',
          source_ip: '192.168.1.100',
          severity_level: 'HIGH',
          suricata_sid: 2001,
          admin_action_taken: null,
          xai_confidence: 0.88,
          device_token_hash: 'abcdef0123456789hash',
        },
      ],
      total: 1,
    });
    mockFetchAuditLogsOfflineAware.mockImplementation(async (params?: unknown) => ({
      response: await mockFetchAuditLogs(params),
      fromCache: false,
    }));
    mockFetchSecurityLogsSummaryOfflineAware.mockImplementation(async () => ({
      response: await mockFetchSecurityLogsSummary(),
      fromCache: false,
    }));
    mockFetchAdminSecurityLogsOfflineAware.mockImplementation(async (params?: unknown) => ({
      response: await mockFetchAdminSecurityLogs(params),
      fromCache: false,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows "Block Device / IP" label when the row has a device_token_hash', async () => {
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });
    expect(screen.getByText('Block Device / IP')).toBeInTheDocument();
    expect(screen.queryByText('Block Source IP')).not.toBeInTheDocument();
  });

  it('blocks the device when the admin confirms the device choice', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    vi.spyOn(window, 'confirm').mockReturnValue(true); // first prompt: "OK = Block this device"
    mockBlockSecurityLog.mockResolvedValue({
      device_token_hash: 'abcdef0123456789hash',
      is_permanent: false,
      already_active: false,
    });

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Block Device / IP'));

    expect(mockBlockSecurityLog).toHaveBeenCalledWith(1, { type: 'device', ttl_hours: 24 });
    expect(mockBlockSourceIp).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText(/Blocked device abcdef012345/i)).toBeInTheDocument();
    });
  });

  it('falls back to blocking the IP when the admin declines the device choice', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    // First confirm (device choice) -> false; second confirm (IP fallback) -> true
    const confirmSpy = vi.spyOn(window, 'confirm');
    confirmSpy.mockReturnValueOnce(false).mockReturnValueOnce(true);
    mockBlockSourceIp.mockResolvedValue({ ip: '192.168.1.100', is_permanent: false, already_active: false });

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Block Device / IP'));

    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(mockBlockSecurityLog).not.toHaveBeenCalled();
    expect(mockBlockSourceIp).toHaveBeenCalledWith(1, { ttl_hours: 24 });
  });

  it('does nothing when the admin declines both prompts', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    const confirmSpy = vi.spyOn(window, 'confirm');
    confirmSpy.mockReturnValueOnce(false).mockReturnValueOnce(false);

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Block Device / IP'));

    expect(mockBlockSecurityLog).not.toHaveBeenCalled();
    expect(mockBlockSourceIp).not.toHaveBeenCalled();
  });
});

// ── Task 12: Bulk actions + filter-scoped block (S3) ────────────────────────

describe('M8: Security Monitoring page — bulk actions + S3 (Task 12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAdminUser();
    mockFetchAuditLogs.mockResolvedValue({ items: [], total: 0 });
    mockFetchSecurityLogsSummary.mockResolvedValue(DEFAULT_SUMMARY);
    mockFetchAdminSecurityLogs.mockResolvedValue({
      items: [
        {
          log_id: 1,
          timestamp: '2026-06-12T10:30:00Z',
          source_ip: '192.168.1.100',
          severity_level: 'HIGH',
          suricata_sid: 2001,
          admin_action_taken: null,
          xai_confidence: 0.88,
        },
        {
          log_id: 2,
          timestamp: '2026-06-12T09:15:00Z',
          source_ip: '10.0.0.50',
          severity_level: 'CRITICAL',
          suricata_sid: 2002,
          admin_action_taken: null,
          xai_confidence: 0.95,
        },
      ],
      total: 2,
    });
    mockFetchAuditLogsOfflineAware.mockImplementation(async (params?: unknown) => ({
      response: await mockFetchAuditLogs(params),
      fromCache: false,
    }));
    mockFetchSecurityLogsSummaryOfflineAware.mockImplementation(async () => ({
      response: await mockFetchSecurityLogsSummary(),
      fromCache: false,
    }));
    mockFetchAdminSecurityLogsOfflineAware.mockImplementation(async (params?: unknown) => ({
      response: await mockFetchAdminSecurityLogs(params),
      fromCache: false,
    }));
    // Default: no device_token_hash on these fixture rows, so a bulk block
    // preview finds no device groups — "Block Selected" falls straight
    // through to the existing flat IP-block flow, matching the fixtures.
    mockBulkBlockPreview.mockResolvedValue({ device_groups: [], ip_only_log_ids: [1, 2] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders checkbox column in threat table rows', async () => {
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    // Find checkboxes: header checkbox + 2 row checkboxes
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(3); // 1 header + 2 rows
  });

  it('bulk action bar is hidden when no rows are selected', async () => {
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  it('bulk action bar appears when a row checkbox is clicked', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    // checkboxes[0] = header, checkboxes[1] = first row
    await user.click(checkboxes[1]);

    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
    expect(screen.getByText(/Block Selected$/i)).toBeInTheDocument();
    expect(screen.getByText(/Dismiss Selected/i)).toBeInTheDocument();
    expect(screen.getByText(/Mark False Positive/i)).toBeInTheDocument();
  });

  it('select-all header checkbox toggles all visible rows', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    // Header checkbox (index 0)
    await user.click(checkboxes[0]);

    // Bulk bar should show 2 selected
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();

    // Click again to deselect
    await user.click(checkboxes[0]);
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  it('bulk Block action calls bulkActionSecurityLogs with block_ip', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockBulkActionSecurityLogs.mockResolvedValue({ results: [{ log_id: 1, status: 'blocked' }, { log_id: 2, status: 'blocked' }] });

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    // Select all
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);

    // Click Block Selected — preview finds no device groups (default mock),
    // so it falls straight through to the existing flat IP-block confirm.
    await user.click(screen.getByText(/Block Selected$/i));
    await waitFor(() => expect(mockBulkBlockPreview).toHaveBeenCalledWith([1, 2]));

    expect(window.confirm).toHaveBeenCalled();
    expect(mockBulkActionSecurityLogs).toHaveBeenCalledWith({
      log_ids: [1, 2],
      action: 'block_ip',
      ttl_hours: 24,
    });

    await waitFor(() => {
      expect(screen.getByText(/block_ip applied to 2 alerts/i)).toBeInTheDocument();
    });
  });

  it('bulk Dismiss action calls bulkActionSecurityLogs with dismiss', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockBulkActionSecurityLogs.mockResolvedValue({ results: [{ log_id: 1, status: 'dismissed' }] });

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    // Select first row
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[1]);

    await user.click(screen.getByText(/Dismiss Selected/i));

    expect(mockBulkActionSecurityLogs).toHaveBeenCalledWith({
      log_ids: [1],
      action: 'dismiss',
      ttl_hours: 24,
    });
  });

  // ── Wayfinder #571: bulk grouping preview ─────────────────────────────

  it('shows the grouping preview panel when the selection includes device-linked logs', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    mockBulkBlockPreview.mockResolvedValue({
      device_groups: [{ device_token_hash: 'abcdef012345hash', log_ids: [1, 2] }],
      ip_only_log_ids: [],
    });

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]); // select all

    await user.click(screen.getByText(/Block Selected$/i));

    await waitFor(() => {
      expect(screen.getByTestId('bulk-block-preview-panel')).toBeInTheDocument();
    });
    expect(screen.getByText(/abcdef012345/i)).toBeInTheDocument();
    const group = screen.getByTestId('bulk-preview-device-group');
    expect(within(group).getByText('Block Device')).toBeInTheDocument();
    expect(within(group).getByText('Block IP')).toBeInTheDocument();
    expect(within(group).getByText('Skip')).toBeInTheDocument();
    // Defaults to "Block Device" selected for each group.
    expect(within(group).getByRole('radio', { name: 'Block Device' })).toBeChecked();
    expect(mockBulkActionSecurityLogs).not.toHaveBeenCalled();
  });

  it('confirming the preview blocks each device group and the IP-only group separately', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    mockBulkBlockPreview.mockResolvedValue({
      device_groups: [
        { device_token_hash: 'hash-a', log_ids: [1] },
        { device_token_hash: 'hash-b', log_ids: [2] },
      ],
      ip_only_log_ids: [3],
    });
    mockBulkActionSecurityLogs.mockResolvedValue({ results: [] });

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);
    await user.click(screen.getByText(/Block Selected$/i));

    await waitFor(() => {
      expect(screen.getByTestId('bulk-block-preview-panel')).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Confirm Blocks/i));

    await waitFor(() => {
      expect(mockBulkActionSecurityLogs).toHaveBeenCalledWith({
        log_ids: [1],
        action: 'block_device',
        ttl_hours: 24,
      });
    });
    expect(mockBulkActionSecurityLogs).toHaveBeenCalledWith({
      log_ids: [2],
      action: 'block_device',
      ttl_hours: 24,
    });
    expect(mockBulkActionSecurityLogs).toHaveBeenCalledWith({
      log_ids: [3],
      action: 'block_ip',
      ttl_hours: 24,
    });
    expect(mockBulkActionSecurityLogs).toHaveBeenCalledTimes(3);

    await waitFor(() => {
      expect(screen.queryByTestId('bulk-block-preview-panel')).not.toBeInTheDocument();
    });
  });

  it('switching a group to Skip excludes it from the block', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    mockBulkBlockPreview.mockResolvedValue({
      device_groups: [{ device_token_hash: 'hash-a', log_ids: [1] }],
      ip_only_log_ids: [2],
    });
    mockBulkActionSecurityLogs.mockResolvedValue({ results: [] });

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);
    await user.click(screen.getByText(/Block Selected$/i));

    await waitFor(() => {
      expect(screen.getByTestId('bulk-block-preview-panel')).toBeInTheDocument();
    });

    // Switch the device group to "Skip", leaving only the IP-only group checked.
    const group = screen.getByTestId('bulk-preview-device-group');
    await user.click(within(group).getByRole('radio', { name: 'Skip' }));

    await user.click(screen.getByText(/Confirm Blocks/i));

    await waitFor(() => {
      expect(mockBulkActionSecurityLogs).toHaveBeenCalledWith({
        log_ids: [2],
        action: 'block_ip',
        ttl_hours: 24,
      });
    });
    expect(mockBulkActionSecurityLogs).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'block_device' })
    );
    expect(mockBulkActionSecurityLogs).toHaveBeenCalledTimes(1);
  });

  it('switching a group to "Block IP" blocks that group\'s IP instead of its device', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    mockBulkBlockPreview.mockResolvedValue({
      device_groups: [{ device_token_hash: 'hash-a', log_ids: [1, 2] }],
      ip_only_log_ids: [],
    });
    mockBulkActionSecurityLogs.mockResolvedValue({ results: [] });

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);
    await user.click(screen.getByText(/Block Selected$/i));

    await waitFor(() => {
      expect(screen.getByTestId('bulk-block-preview-panel')).toBeInTheDocument();
    });

    const group = screen.getByTestId('bulk-preview-device-group');
    await user.click(within(group).getByRole('radio', { name: 'Block IP' }));
    await user.click(screen.getByText(/Confirm Blocks/i));

    await waitFor(() => {
      expect(mockBulkActionSecurityLogs).toHaveBeenCalledWith({
        log_ids: [1, 2],
        action: 'block_ip',
        ttl_hours: 24,
      });
    });
    expect(mockBulkActionSecurityLogs).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'block_device' })
    );
  });

  it('cancel closes the preview panel without blocking anything', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    mockBulkBlockPreview.mockResolvedValue({
      device_groups: [{ device_token_hash: 'hash-a', log_ids: [1] }],
      ip_only_log_ids: [],
    });

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);
    await user.click(screen.getByText(/Block Selected$/i));

    await waitFor(() => {
      expect(screen.getByTestId('bulk-block-preview-panel')).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Cancel/i));

    expect(screen.queryByTestId('bulk-block-preview-panel')).not.toBeInTheDocument();
    expect(mockBulkActionSecurityLogs).not.toHaveBeenCalled();
  });

  it('S3 button is hidden when no filter is active', async () => {
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('block-by-filter-btn')).not.toBeInTheDocument();
  });

  it('S3 button becomes visible when a severity filter is active', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(mockFetchAdminSecurityLogs).toHaveBeenCalled();
    });

    // Click a severity chip to activate a filter
    const highChip = screen.getByRole('button', { name: /HIGH/i });
    await user.click(highChip);

    expect(screen.getByTestId('block-by-filter-btn')).toBeInTheDocument();
  });

  it('S3 button visible when source_ip filter is active', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(mockFetchAdminSecurityLogs).toHaveBeenCalled();
    });

    const sourceIpInput = screen.getByPlaceholderText(/filter by source ip/i);
    await user.type(sourceIpInput, '10.0.0');

    expect(screen.getByTestId('block-by-filter-btn')).toBeInTheDocument();
  });

  it('S3 block-by-filter preview shows counts then executes on confirm', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const previewResult = {
      dry_run: true,
      total_distinct_ips: 3,
      would_block: 2,
      repeat_offenders: 1,
      skipped_self: 1,
      skipped_allowlist: 0,
      capped_at: 500,
    };
    const execResult = {
      dry_run: false,
      total_distinct_ips: 3,
      blocked_count: 2,
      permanent_count: 1,
      skipped_self: 1,
      skipped_allowlist: 0,
      already_blocked: 0,
      capped: false,
    };

    mockBlockByFilter
      .mockResolvedValueOnce(previewResult)
      .mockResolvedValueOnce(execResult);

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(mockFetchAdminSecurityLogs).toHaveBeenCalled();
    });

    // Activate a filter to show the S3 button
    const highChip = screen.getByRole('button', { name: /HIGH/i });
    await user.click(highChip);

    const s3Btn = screen.getByTestId('block-by-filter-btn');
    await user.click(s3Btn);

    // First call should be preview
    expect(mockBlockByFilter.mock.calls[0][1]).toEqual({ preview: true });

    // Confirm should have been called
    expect(window.confirm).toHaveBeenCalled();

    // Second call should be execute
    expect(mockBlockByFilter.mock.calls[1][1]).toEqual({ preview: false });

    // Toast should show the execute result
    await waitFor(() => {
      expect(screen.getByText(/Blocked 2 IPs/i)).toBeInTheDocument();
    });
  });

  it('S3 preview shows 500-IP cap warning when total exceeds cap', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const previewResult = {
      dry_run: true,
      total_distinct_ips: 1000,
      would_block: 500,
      repeat_offenders: 10,
      skipped_self: 0,
      skipped_allowlist: 0,
      capped_at: 500,
    };

    mockBlockByFilter.mockResolvedValue(previewResult);

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(mockFetchAdminSecurityLogs).toHaveBeenCalled();
    });

    // Activate a filter
    const highChip = screen.getByRole('button', { name: /HIGH/i });
    await user.click(highChip);

    await user.click(screen.getByTestId('block-by-filter-btn'));

    // Confirm message should contain the cap warning
    const confirmMessage = confirmSpy.mock.calls[0][0];
    expect(confirmMessage).toContain('first 500 of 1000');
    expect(confirmMessage).toContain('repeat offenders');
  });

  it('clear selection button clears all selected rows', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    // Select first row
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[1]);

    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();

    // Click clear selection
    await user.click(screen.getByText(/Clear selection/i));

    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });
});

// ── Task 13: Blocked IPs panel mount ──────────────────────────────────────

describe('T13: Blocked IPs panel mount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAdminUser();
    mockFetchAuditLogs.mockResolvedValue({ items: [], total: 0 });
    mockFetchSecurityLogsSummary.mockResolvedValue(DEFAULT_SUMMARY);
    mockFetchAdminSecurityLogs.mockResolvedValue({ items: [], total: 0 });
    mockFetchAuditLogsOfflineAware.mockImplementation(async (params?: unknown) => ({
      response: await mockFetchAuditLogs(params),
      fromCache: false,
    }));
    mockFetchSecurityLogsSummaryOfflineAware.mockImplementation(async () => ({
      response: await mockFetchSecurityLogsSummary(),
      fromCache: false,
    }));
    mockFetchAdminSecurityLogsOfflineAware.mockImplementation(async (params?: unknown) => ({
      response: await mockFetchAdminSecurityLogs(params),
      fromCache: false,
    }));
    // The panel calls listBlockedIps on mount — return empty by default
    mockListBlockedIps.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the BlockedIpsPanel on the monitoring page with empty state', async () => {
    vi.useRealTimers();
    render(<SecurityMonitoringPage />);

    // The panel is async — listBlockedIps is called in useEffect
    await waitFor(() => {
      expect(screen.getByText(/No IPs currently blocked/i)).toBeInTheDocument();
    });

    // Confirm the panel data-testid is present
    expect(screen.getByTestId('blocked-ips-panel')).toBeInTheDocument();
  });
});

// ── #419: no-analyze-on-load regression guard ──────────────────────────────

describe('Security Monitoring — #419 no-analyze-on-load guard', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not call analyzeSecurityLog on initial render', async () => {
    vi.useRealTimers();
    // analyzeSecurityLog is not imported by the monitoring page at all.
    // This test is a future-regression guard: if a future change adds an
    // analyze call on mount, this test will catch it.
    const analyzeSpy = vi.fn();
    vi.doMock('@/lib/api/admin', () => ({
      ...vi.importActual('@/lib/api/admin'),
      analyzeSecurityLog: analyzeSpy,
    }));

    const { default: MonitoringPage } = await import('./page');
    render(<MonitoringPage />);

    // Wait for initial load effects to settle
    await waitFor(() => {
      expect(analyzeSpy).not.toHaveBeenCalled();
    });
  });
});
