/**
 * TDD: M8 Anomaly Detection ACK/RESOLVE page
 *
 * Verifies that on /admin/anomalies:
 * 1. Summary cards render with counts
 * 2. Anomaly table renders items with correct data
 * 3. Acknowledge button transitions status and refreshes
 * 4. Resolve button transitions status and refreshes
 * 5. Empty state when no anomalies
 * 6. Non-admin users see access-restricted message
 * 7. Error state on API failure
 * 8. Status filter chips trigger API call with correct filters
 * 9. Pagination controls work
 */
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AnomalyDetectionPage from './page';
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

const mockFetchAnomalies = vi.fn();
const mockUpdateAnomalyStatus = vi.fn();

vi.mock('@/lib/api/legacy', () => ({
  fetchAnomalies: (params?: unknown) => mockFetchAnomalies(params),
  updateAnomalyStatus: (id: number, status: string) => mockUpdateAnomalyStatus(id, status),
}));

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

const DEFAULT_ANOMALIES = {
  items: [
    {
      anomaly_id: 1,
      anomaly_type: 'BULK_DELETE',
      subject_user_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      severity: 'HIGH',
      details: { count: 12 },
      detected_at: '2026-06-14T10:00:00Z',
      status: 'NEW',
      dedup_key: 'BULK_DELETE:test:1',
    },
    {
      anomaly_id: 2,
      anomaly_type: 'OFF_HOURS',
      subject_user_id: 'bbbbbbbb-0000-4000-8000-000000000002',
      severity: 'MEDIUM',
      details: { action_type: 'PII_EXPORT', audit_id: 42 },
      detected_at: '2026-06-14T09:00:00Z',
      status: 'ACKNOWLEDGED',
      dedup_key: 'OFF_HOURS:42',
    },
    {
      anomaly_id: 3,
      anomaly_type: 'RAPID_IP_SWITCH',
      subject_user_id: null,
      severity: 'MEDIUM',
      details: { distinct_ip_count: 2, ips: ['1.1.1.1', '2.2.2.2'] },
      detected_at: '2026-06-14T08:00:00Z',
      status: 'RESOLVED',
      dedup_key: 'RAPID_IP:test:3',
    },
  ],
  total: 3,
  limit: 20,
  offset: 0,
  counts: { NEW: 1, ACKNOWLEDGED: 1, RESOLVED: 1 },
  type_facets: [
    { type: 'BULK_DELETE', count: 1 },
    { type: 'OFF_HOURS', count: 1 },
    { type: 'RAPID_IP_SWITCH', count: 1 },
  ],
};

describe('M8: Anomaly Detection ACK/RESOLVE page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAdminUser();
    mockFetchAnomalies.mockResolvedValue(DEFAULT_ANOMALIES);
    mockUpdateAnomalyStatus.mockResolvedValue({
      status: 'ok',
      anomaly_id: 1,
      previous_status: 'NEW',
      new_status: 'ACKNOWLEDGED',
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders summary cards with aggregate counts from API', async () => {
    vi.useRealTimers();
    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(screen.getByText('BULK DELETE')).toBeInTheDocument();
    });

    // Summary cards: New, Acknowledged, Resolved each display "1"
    const ones = screen.getAllByText('1');
    // At least 3 summary card labels + anomaly_id #1 = 4+ elements
    expect(ones.length).toBeGreaterThanOrEqual(3);
  });

  it('renders anomaly table with correct data', async () => {
    vi.useRealTimers();
    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(screen.getByText('BULK DELETE')).toBeInTheDocument();
    });

    expect(screen.getByText('OFF HOURS')).toBeInTheDocument();
    expect(screen.getByText('RAPID IP SWITCH')).toBeInTheDocument();

    // Severity badges
    expect(screen.getByText('HIGH')).toBeInTheDocument();
    // MEDIUM appears twice (OFF_HOURS and RAPID_IP_SWITCH)
    const mediumBadges = screen.getAllByText('MEDIUM');
    expect(mediumBadges.length).toBe(2);

    // Status badges with icons (use getAllByText - summary card + filter chip + badge)
    expect(screen.getAllByText('Acknowledged').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Resolved').length).toBeGreaterThanOrEqual(1);
  });

  it('shows Acknowledge button for NEW anomalies', async () => {
    vi.useRealTimers();
    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(screen.getByText('BULK DELETE')).toBeInTheDocument();
    });

    // Acknowledge button for the NEW anomaly
    const ackButton = screen.getByText('Acknowledge');
    expect(ackButton).toBeInTheDocument();
  });

  it('shows Resolve button for ACKNOWLEDGED anomalies', async () => {
    vi.useRealTimers();
    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(screen.getByText('OFF HOURS')).toBeInTheDocument();
    });

    // Resolve button for the ACKNOWLEDGED anomaly
    const resolveButton = screen.getByText('Resolve');
    expect(resolveButton).toBeInTheDocument();
  });

  it('calls updateAnomalyStatus on Acknowledge click', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(screen.getByText('BULK DELETE')).toBeInTheDocument();
    });

    const ackButton = screen.getByText('Acknowledge');
    await user.click(ackButton);

    await waitFor(() => {
      expect(mockUpdateAnomalyStatus).toHaveBeenCalledWith(1, 'ACKNOWLEDGED');
    });

    // After update, fetchAnomalies is called again to refresh
    expect(mockFetchAnomalies).toHaveBeenCalledTimes(2); // initial + refresh
  });

  it('calls updateAnomalyStatus on Resolve click', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(screen.getByText('OFF HOURS')).toBeInTheDocument();
    });

    const resolveButton = screen.getByText('Resolve');
    await user.click(resolveButton);

    await waitFor(() => {
      expect(mockUpdateAnomalyStatus).toHaveBeenCalledWith(2, 'RESOLVED');
    });
  });

  it('shows empty state with seed hint when no anomalies exist', async () => {
    mockFetchAnomalies.mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
      counts: { NEW: 0, ACKNOWLEDGED: 0, RESOLVED: 0 },
      type_facets: [],
    });

    vi.useRealTimers();
    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(screen.getByText(/No anomaly detections exist yet/i)).toBeInTheDocument();
    });

    // Seed script hint is shown
    expect(screen.getByText(/seed-anomaly-detections\.sh/)).toBeInTheDocument();
  });

  it('shows adjust-filters message when filters produce empty result', async () => {
    mockFetchAnomalies.mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
      counts: { NEW: 0, ACKNOWLEDGED: 0, RESOLVED: 0 },
      type_facets: [],
    });

    vi.useRealTimers();
    render(<AnomalyDetectionPage />);

    // Apply a status filter so hasAnyFilters becomes true
    await waitFor(() => {
      expect(mockFetchAnomalies).toHaveBeenCalled();
    });

    // Click the "New" filter chip
    const newButtons = screen.getAllByText('New');
    const newFilterBtn = newButtons.find((el) => el.tagName === 'BUTTON');
    expect(newFilterBtn).toBeDefined();

    const user = userEvent.setup({ delay: null });

    // Set up the filtered mock BEFORE clicking (so next fetch returns the filtered result)
    mockFetchAnomalies.mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
      counts: { NEW: 0, ACKNOWLEDGED: 3, RESOLVED: 2 },
      type_facets: [
        { type: 'OFF_HOURS', count: 3 },
        { type: 'BULK_DELETE', count: 2 },
      ],
    });

    await user.click(newFilterBtn!);

    await waitFor(() => {
      expect(screen.getByText(/No anomalies match the current filters/i)).toBeInTheDocument();
    });
  });

  it('renders dynamic type filter options from type_facets', async () => {
    vi.useRealTimers();
    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(screen.getByText('BULK DELETE')).toBeInTheDocument();
    });

    // Type filter options are rendered dynamically from type_facets (with counts)
    // The type text uses .replace(/_/g, ' ') so "BULK_DELETE" → "BULK DELETE"
    // Options include: "All Types", "BULK DELETE (1)", "OFF HOURS (1)", "RAPID IP SWITCH (1)"
    const typeSelects = screen.getAllByRole('combobox');
    // First combobox is type filter, second is severity
    const typeSelect = typeSelects[0] as HTMLSelectElement;
    expect(typeSelect).toBeInTheDocument();
    // Should have options beyond "All Types"
    expect(typeSelect.options.length).toBeGreaterThan(1);
    // "All Types" is present
    expect(screen.getByText('All Types')).toBeInTheDocument();
  });

  it('renders severity filter dropdown', async () => {
    vi.useRealTimers();
    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(screen.getByText('BULK DELETE')).toBeInTheDocument();
    });

    // The severity filter has "All Severities" option
    expect(screen.getByText('All Severities')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('severity filter triggers API with severity param', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    mockFetchAnomalies.mockResolvedValue(DEFAULT_ANOMALIES);

    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(mockFetchAnomalies).toHaveBeenCalled();
    });

    // Select "Critical" from the severity dropdown
    const selects = screen.getAllByRole('combobox');
    // severity is the second combobox
    const severitySelect = selects[1];
    await user.selectOptions(severitySelect, 'CRITICAL');

    await waitFor(() => {
      const calls = mockFetchAnomalies.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall?.severity).toBe('CRITICAL');
    });
  });

  it('shows access-restricted message for non-admin', async () => {
    mockNonAdminUser();

    vi.useRealTimers();
    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(screen.getByText(/Access restricted to System Administrators/i)).toBeInTheDocument();
    });

    expect(mockFetchAnomalies).not.toHaveBeenCalled();
  });

  it('shows error banner on API failure', async () => {
    mockFetchAnomalies.mockRejectedValue(new Error('Network error'));

    vi.useRealTimers();
    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });
  });

  it('status filter chips trigger API with correct filter', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();

    // Reset to ensure clean call count
    mockFetchAnomalies.mockResolvedValue(DEFAULT_ANOMALIES);

    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(mockFetchAnomalies).toHaveBeenCalled();
    });

    // Click "Acknowledged" filter chip
    // There are 3+ elements with text "Acknowledged": summary card, filter button, status badge
    const allAckEls = screen.getAllByText('Acknowledged');
    // The filter button is the one that is a <button> element
    const ackFilterBtn = allAckEls.find((el) => el.tagName === 'BUTTON');
    expect(ackFilterBtn).toBeDefined();
    await user.click(ackFilterBtn!);

    await waitFor(() => {
      const calls = mockFetchAnomalies.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall?.status).toBe('ACKNOWLEDGED');
    });
  });

  it('type filter dropdown triggers API with anomaly_type', async () => {
    const user = userEvent.setup({ delay: null });
    vi.useRealTimers();
    mockFetchAnomalies.mockResolvedValue(DEFAULT_ANOMALIES);

    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(mockFetchAnomalies).toHaveBeenCalled();
    });

    // Two comboboxes now: type filter (index 0), severity filter (index 1)
    const selects = screen.getAllByRole('combobox');
    const typeSelect = selects[0];
    await user.selectOptions(typeSelect, 'OFF_HOURS');

    await waitFor(() => {
      const calls = mockFetchAnomalies.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall?.anomaly_type).toBe('OFF_HOURS');
    });
  });

  it('pagination Previous button disabled on first page', async () => {
    vi.useRealTimers();
    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(screen.getByText('BULK DELETE')).toBeInTheDocument();
    });

    const prevButton = screen.getByText('Previous');
    expect(prevButton).toBeDisabled();
  });

  it('pagination Next button disabled when total fits on one page', async () => {
    // 3 items, total 3 — no next page
    vi.useRealTimers();
    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(screen.getByText('BULK DELETE')).toBeInTheDocument();
    });

    const nextButton = screen.getByText('Next');
    expect(nextButton).toBeDisabled();
  });

  it('pagination Next button enabled when more pages exist', async () => {
    mockFetchAnomalies.mockResolvedValue({
      ...DEFAULT_ANOMALIES,
      total: 45,
    });

    vi.useRealTimers();
    render(<AnomalyDetectionPage />);

    await waitFor(() => {
      expect(screen.getByText('BULK DELETE')).toBeInTheDocument();
    });

    const nextButton = screen.getByText('Next');
    expect(nextButton).not.toBeDisabled();
  });
});
