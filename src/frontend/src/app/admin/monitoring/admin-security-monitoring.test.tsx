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
const mockUpdateAdminSecurityLog = vi.fn();
const mockCreateIncidentFromAlert = vi.fn();
const mockBlockSourceIp = vi.fn();
const mockDeleteSecurityLog = vi.fn();
const mockBulkActionSecurityLogs = vi.fn();
const mockBlockByFilter = vi.fn();
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
  deleteSecurityLog: (...args: unknown[]) => mockDeleteSecurityLog(...args),
  bulkActionSecurityLogs: (...args: unknown[]) => mockBulkActionSecurityLogs(...args),
  blockByFilter: (...args: unknown[]) => mockBlockByFilter(...args),
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
    expect(screen.getByText('Delete Alert')).toBeInTheDocument();
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
      response: { data: { detail: 'Cannot block your own IP address' } },
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

  it('Delete Alert calls deleteSecurityLog and refetches', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockDeleteSecurityLog.mockResolvedValue({ status: 'ok', log_id: 1 });

    render(<SecurityMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Delete Alert'));

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
    expect(screen.getByText(/Block Selected IPs/i)).toBeInTheDocument();
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

    // Click Block Selected IPs
    await user.click(screen.getByText(/Block Selected IPs/i));

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
