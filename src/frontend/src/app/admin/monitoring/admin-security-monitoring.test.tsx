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

vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isChecking: false, isReconnecting: false, state: 'online' }),
}));

const mockFetchSecurityLogsSummary = vi.fn();
const mockFetchAdminSecurityLogs = vi.fn();
const mockFetchAuditLogs = vi.fn();
const mockFetchSecurityLogsSummaryOfflineAware = vi.fn();
const mockFetchAdminSecurityLogsOfflineAware = vi.fn();
const mockFetchAuditLogsOfflineAware = vi.fn();

vi.mock('@/lib/api/legacy', () => ({
  fetchSecurityLogsSummary: () => mockFetchSecurityLogsSummary(),
  fetchAdminSecurityLogs: (params?: unknown) => mockFetchAdminSecurityLogs(params),
  fetchAuditLogs: (params?: unknown) => mockFetchAuditLogs(params),
}));

vi.mock('@/lib/api/offlineAdmin', () => ({
  fetchSecurityLogsSummaryOfflineAware: () => mockFetchSecurityLogsSummaryOfflineAware(),
  fetchAdminSecurityLogsOfflineAware: (params?: unknown) => mockFetchAdminSecurityLogsOfflineAware(params),
  fetchAuditLogsOfflineAware: (params?: unknown) => mockFetchAuditLogsOfflineAware(params),
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
    expect(screen.getByText(/Showing cached data/i)).toBeInTheDocument();
    // Underlying summary cards should still render from the cached response
    await waitFor(() => {
      expect(screen.getByText('10')).toBeInTheDocument();
    });
  });
});
