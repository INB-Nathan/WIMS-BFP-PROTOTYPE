import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
    return <img {...props} />;
  },
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    <a href={href} {...rest}>{children}</a>,
}));

// MapPicker — no-op; stores onChange so tests can simulate a pin drop.
const mapPicker = vi.hoisted(() => ({ onChange: null as ((lat: number, lng: number) => void) | null }));
vi.mock('@/components/MapPicker', () => ({
  MapPicker: ({ onChange }: { onChange?: (lat: number, lng: number) => void }) => {
    mapPicker.onChange = onChange ?? null;
    return <div data-testid="map-picker" />;
  },
}));

vi.mock('@/components/civilian/PhotoUpload', () => ({
  PhotoUpload: () => <div data-testid="photo-upload" />,
}));

vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isReconnecting: false, state: 'online', isChecking: false, lastCheckedAt: null }),
}));

vi.mock('@/lib/usePublicAutoSync', () => ({
  usePublicAutoSync: () => ({ syncing: false, lastSyncedAt: null, pendingCount: 0, failedCount: 0, syncNow: vi.fn() }),
}));

const offlineMocks = vi.hoisted(() => ({
  submitCivilianReportOfflineAware: vi.fn().mockResolvedValue({
    queued: false,
    response: { report_id: 7, status: 'PENDING', tracking_token: 'tok-7', tracking_url: '/tracking/v2/7/tok-7', latitude: 14.5, longitude: 121, category: 'NON_STRUCTURAL', created_at: '2026-07-15T10:00:00.000Z' },
  }),
  checkReviewEligibility: vi.fn().mockReturnValue(undefined),
}));

vi.mock('@/lib/api/offlineCivilian', () => ({
  submitCivilianReportOfflineAware: offlineMocks.submitCivilianReportOfflineAware,
  appendCivilianReportOfflineAware: vi.fn(),
  submitFollowupOfflineAware: vi.fn(),
  checkReviewEligibility: offlineMocks.checkReviewEligibility,
}));

vi.mock('@/lib/api', () => ({
  fetchCivilianDuplicateSuggestions: vi.fn().mockResolvedValue([]),
  fetchNearbyStations: vi.fn().mockResolvedValue([
    { station_id: 1, station_name: 'Station A', address: null, latitude: 14.51, longitude: 121.01, distance_m: 1500 },
  ]),
  uploadCivilianReportPhoto: vi.fn().mockResolvedValue({}),
  submitCivilianReportV2: vi.fn(),
}));

const trackingMocks = vi.hoisted(() => ({
  // Default: response present with a routing source => SUCCESS.
  fetchPublicTracking: vi.fn().mockResolvedValue({
    report_id: 7,
    category: 'NON_STRUCTURAL',
    sub_category: null,
    reporting_context: 'WITNESS',
    safety_status: 'UNKNOWN',
    status: 'PENDING',
    status_explanation: null,
    guidance: null,
    escalation_guidance: null,
    related_cluster_status: null,
    nearest_station_name: 'Station A',
    nearest_station_phone: null,
    routing_distance_m: 1500,
    routing_duration_s: 300,
    routing_geometry: null,
    routing_data_source: 'osrm',
    photo_count: 0,
    submitter_type: 'ANONYMOUS',
    link_count: 0,
    created_at: '2026-07-15T10:00:00.000Z',
  }),
}));

vi.mock('@/lib/api/tracking', () => ({
  fetchPublicTracking: trackingMocks.fetchPublicTracking,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function dropPin(lat = 14.5, lng = 121) {
  expect(mapPicker.onChange).not.toBeNull();
  act(() => {
    mapPicker.onChange!(lat, lng);
  });
}

async function driveToReview() {
  // Step 0 Location
  fireEvent.click(screen.getByText('Use my location'));
  dropPin();
  fireEvent.click(screen.getByText('Continue'));
  // Step 1 Photo
  await screen.findByText('Add a photo', { exact: false });
  fireEvent.click(screen.getByText('Continue'));
  // Step 2 Category
  await screen.findByText('What do you observe?');
  fireEvent.click(screen.getByTestId('observable-LARGE_FLAMES'));
  fireEvent.click(screen.getByText('Continue'));
  // Step 3 Details
  await screen.findByTestId('description-input');
  await userEvent.type(screen.getByTestId('description-input'), 'Large structural fire spreading.');
  fireEvent.click(screen.getByText('Review'));
  await screen.findByText('Review your report');
}

beforeEach(() => {
  vi.clearAllMocks();
  try { localStorage.clear(); } catch {}
  mapPicker.onChange = null;
  offlineMocks.submitCivilianReportOfflineAware.mockResolvedValue({
    queued: false,
    response: { report_id: 7, status: 'PENDING', tracking_token: 'tok-7', tracking_url: '/tracking/v2/7/tok-7', latitude: 14.5, longitude: 121, category: 'NON_STRUCTURAL', created_at: '2026-07-15T10:00:00.000Z' },
  });
  offlineMocks.checkReviewEligibility.mockReturnValue(undefined);
  trackingMocks.fetchPublicTracking.mockResolvedValue({
    report_id: 7, category: 'NON_STRUCTURAL', sub_category: null, reporting_context: 'WITNESS',
    safety_status: 'UNKNOWN', status: 'PENDING', status_explanation: null, guidance: null,
    escalation_guidance: null, related_cluster_status: null, nearest_station_name: 'Station A',
    nearest_station_phone: null, routing_distance_m: 1500, routing_duration_s: 300,
    routing_geometry: null, routing_data_source: 'osrm', photo_count: 0,
    submitter_type: 'ANONYMOUS', link_count: 0, created_at: '2026-07-15T10:00:00.000Z',
  });
});

afterEach(() => {
  try { localStorage.clear(); } catch {}
});

describe('Report Wizard — 5-step progression', () => {
  it('advances through all 5 steps (Location → Photo → Category → Details → Review)', async () => {
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);

    // Location
    expect(screen.getByTestId('step-label')).toHaveTextContent('Step 1 of 5: Location');
    fireEvent.click(screen.getByText('Use my location'));
    dropPin();
    fireEvent.click(screen.getByText('Continue'));

    // Photo
    expect(await screen.findByText('Add a photo', { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId('step-label')).toHaveTextContent('Step 2 of 5: Photo');
    fireEvent.click(screen.getByText('Continue'));

    // Category
    expect(await screen.findByText('What do you observe?')).toBeInTheDocument();
    expect(screen.getByTestId('step-label')).toHaveTextContent('Step 3 of 5: Category');
    fireEvent.click(screen.getByTestId('observable-LARGE_FLAMES'));
    fireEvent.click(screen.getByText('Continue'));

    // Details
    expect(await screen.findByTestId('description-input')).toBeInTheDocument();
    expect(screen.getByTestId('step-label')).toHaveTextContent('Step 4 of 5: Details');
    await userEvent.type(screen.getByTestId('description-input'), 'Fire reported.');
    fireEvent.click(screen.getByText('Review'));

    // Review
    expect(await screen.findByText('Review your report')).toBeInTheDocument();
    expect(screen.getByTestId('step-label')).toHaveTextContent('Step 5 of 5: Review');
  });

  it('submits and renders the receipt with QR, token, copy, and timestamp', async () => {
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);

    await driveToReview();
    fireEvent.click(screen.getByTestId('submit-report'));

    // Receipt
    expect(await screen.findByTestId('qr-code')).toBeInTheDocument();
    expect(screen.getByTestId('tracking-token')).toHaveTextContent('tok-7');
    expect(screen.getByTestId('tracking-link').getAttribute('href')).toBe('/tracking/v2/7/tok-7');
    expect(screen.getByTestId('receipt-timestamp')).toBeInTheDocument();

    // Copy to clipboard
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    fireEvent.click(screen.getByTestId('copy-token'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('tok-7'));
    expect(screen.getByText('Copied')).toBeInTheDocument();

    // Registration incentive progressive disclosure
    expect(screen.queryByTestId('registration-incentive')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('registration-incentive-toggle'));
    expect(screen.getByTestId('registration-incentive')).toBeInTheDocument();
  });

  it('fetches duplicate suggestions when entering review', async () => {
    const { fetchCivilianDuplicateSuggestions } = await import('@/lib/api');
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);
    await driveToReview();
    expect(fetchCivilianDuplicateSuggestions).toHaveBeenCalled();
  });
});

describe('Report Wizard — draft save / restore / 24h expiry', () => {
  it('shows the draft prompt when a draft exists and restores fields on Continue', async () => {
    const { default: ReportPage } = await import('../page');
    // Pre-seed a draft at the Category step.
    localStorage.setItem(
      'wims_report_wizard_draft_v1',
      JSON.stringify({
        stepIndex: 2,
        savedAt: Date.now(),
        latitude: 14.6,
        longitude: 121.1,
        landmark: 'near Jollibee',
        photoPresent: false,
        category: 'NON_STRUCTURAL',
        observables: ['HEAVY_SMOKE'],
        description: 'Smoke observed',
        contactName: '',
        contactPhone: '',
        notes: '',
      }),
    );
    render(<ReportPage />);

    expect(await screen.findByTestId('continue-draft')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('continue-draft'));

    // Should resume at the Category step with the saved observable selected.
    expect(await screen.findByText('What do you observe?')).toBeInTheDocument();
    expect(screen.getByTestId('step-label')).toHaveTextContent('Step 3 of 5: Category');
    expect(screen.getByTestId('observable-HEAVY_SMOKE')).toHaveAttribute('aria-pressed', 'true');
  });

  it('clears the draft when "Start fresh" is chosen', async () => {
    localStorage.setItem(
      'wims_report_wizard_draft_v1',
      JSON.stringify({
        stepIndex: 1, savedAt: Date.now(), latitude: null, longitude: null, landmark: '',
        photoPresent: false, category: 'UNSURE', observables: [], description: '', contactName: '',
        contactPhone: '', notes: '',
      }),
    );
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);
    fireEvent.click(await screen.findByTestId('start-fresh'));
    expect(localStorage.getItem('wims_report_wizard_draft_v1')).toBeNull();
    expect(await screen.findByText('Step 1 of 5: Location')).toBeInTheDocument();
  });

  it('auto-saves a draft to localStorage after completing a step', async () => {
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);
    fireEvent.click(screen.getByText('Use my location'));
    dropPin();
    fireEvent.click(screen.getByText('Continue'));
    await screen.findByText('Step 2 of 5: Photo');
    const raw = localStorage.getItem('wims_report_wizard_draft_v1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.latitude).toBe(14.5);
    expect(parsed.stepIndex).toBe(1);
  });

  it('expires a draft older than 24h (no prompt shown)', async () => {
    localStorage.setItem(
      'wims_report_wizard_draft_v1',
      JSON.stringify({
        stepIndex: 1, savedAt: Date.now() - (25 * 60 * 60 * 1000), latitude: null, longitude: null,
        landmark: '', photoPresent: false, category: 'UNSURE', observables: [], description: '',
        contactName: '', contactPhone: '', notes: '',
      }),
    );
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);
    // Expired draft => no prompt, starts at wizard step 1.
    expect(screen.queryByTestId('continue-draft')).not.toBeInTheDocument();
    expect(await screen.findByText('Step 1 of 5: Location')).toBeInTheDocument();
  });

  it('clears the draft after a successful submit', async () => {
    localStorage.setItem(
      'wims_report_wizard_draft_v1',
      JSON.stringify({
        stepIndex: 1, savedAt: Date.now(), latitude: null, longitude: null, landmark: '', photoPresent: false,
        category: 'UNSURE', observables: [], description: '', contactName: '', contactPhone: '', notes: '',
      }),
    );
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);
    // A draft exists at entry -> prompt. Start fresh to clear it, then drive.
    fireEvent.click(await screen.findByTestId('start-fresh'));
    expect(await screen.findByText('Step 1 of 5: Location')).toBeInTheDocument();
    await driveToReview();
    fireEvent.click(screen.getByTestId('submit-report'));
    await screen.findByTestId('qr-code');
    expect(localStorage.getItem('wims_report_wizard_draft_v1')).toBeNull();
  });
});

describe('Report Wizard — safety banner on all steps', () => {
  it('renders the non-dismissible safety banner at every step', async () => {
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);

    const bannerText = 'You are safe. If you are in danger, call 911 or your local BFP hotline immediately.';
    expect(screen.getByTestId('safety-banner')).toHaveTextContent(bannerText);

    // Step 1
    fireEvent.click(screen.getByText('Use my location'));
    dropPin();
    fireEvent.click(screen.getByText('Continue'));
    expect(await screen.findByText('Step 2 of 5: Photo')).toBeInTheDocument();
    expect(screen.getByTestId('safety-banner')).toHaveTextContent(bannerText);

    fireEvent.click(screen.getByText('Continue'));
    expect(await screen.findByText('What do you observe?')).toBeInTheDocument();
    expect(screen.getByTestId('safety-banner')).toHaveTextContent(bannerText);

    fireEvent.click(screen.getByTestId('observable-LARGE_FLAMES'));
    fireEvent.click(screen.getByText('Continue'));
    expect(await screen.findByTestId('description-input')).toBeInTheDocument();
    await userEvent.type(screen.getByTestId('description-input'), 'Fire reported.');
    expect(screen.getByTestId('safety-banner')).toHaveTextContent(bannerText);

    fireEvent.click(screen.getByText('Review'));
    expect(await screen.findByText('Review your report')).toBeInTheDocument();
    expect(screen.getByTestId('safety-banner')).toHaveTextContent(bannerText);

    // Receipt keeps the banner too.
    fireEvent.click(screen.getByTestId('submit-report'));
    expect(await screen.findByTestId('qr-code')).toBeInTheDocument();
    expect(screen.getByTestId('safety-banner')).toHaveTextContent(bannerText);
  });
});

describe('Report Wizard — routing feedback 3-state (straight line)', () => {
  it('shows PENDING while the tracking fetch is loading', async () => {
    trackingMocks.fetchPublicTracking.mockImplementation(
      () => new Promise(() => {}), // never resolves => loading
    );
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);
    await driveToReview();
    fireEvent.click(screen.getByTestId('submit-report'));
    const feedback = await screen.findByTestId('route-feedback');
    expect(feedback).toHaveAttribute('data-state', 'PENDING');
    expect(screen.getByText(/Calculating route/i)).toBeInTheDocument();
  });

  it('shows SUCCESS (straight line) when routing_data_source is present', async () => {
    trackingMocks.fetchPublicTracking.mockResolvedValue({
      report_id: 7, category: 'NON_STRUCTURAL', sub_category: null, reporting_context: 'WITNESS',
      safety_status: 'UNKNOWN', status: 'PENDING', status_explanation: null, guidance: null,
      escalation_guidance: null, related_cluster_status: null, nearest_station_name: 'Station A',
      nearest_station_phone: null, routing_distance_m: 1500, routing_duration_s: 300,
      routing_geometry: null, routing_data_source: 'osrm', photo_count: 0,
      submitter_type: 'ANONYMOUS', link_count: 0, created_at: '2026-07-15T10:00:00.000Z',
    });
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);
    await driveToReview();
    fireEvent.click(screen.getByTestId('submit-report'));
    const feedback = await screen.findByTestId('route-feedback');
    await waitFor(() => expect(feedback).toHaveAttribute('data-state', 'SUCCESS'));
    // Straight line is always rendered (no road polyline available).
    expect(screen.getByTestId('route-line').querySelector('line')).toBeInTheDocument();
    expect(screen.getByText(/Distance: 1.5 km/)).toBeInTheDocument();
  });

  it('shows FAILED (permanent straight line) when routing_data_source is absent', async () => {
    trackingMocks.fetchPublicTracking.mockResolvedValue({
      report_id: 7, category: 'NON_STRUCTURAL', sub_category: null, reporting_context: 'WITNESS',
      safety_status: 'UNKNOWN', status: 'PENDING', status_explanation: null, guidance: null,
      escalation_guidance: null, related_cluster_status: null, nearest_station_name: 'Station A',
      nearest_station_phone: null, routing_distance_m: null, routing_duration_s: null,
      routing_geometry: null, routing_data_source: null, photo_count: 0,
      submitter_type: 'ANONYMOUS', link_count: 0, created_at: '2026-07-15T10:00:00.000Z',
    });
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);
    await driveToReview();
    fireEvent.click(screen.getByTestId('submit-report'));
    const feedback = await screen.findByTestId('route-feedback');
    await waitFor(() => expect(feedback).toHaveAttribute('data-state', 'FAILED'));
    expect(screen.getByText(/Route unavailable/i)).toBeInTheDocument();
  });
});

describe('Report Wizard — offline queue', () => {
  it('queues offline when submit returns queued and shows a tracking id', async () => {
    offlineMocks.submitCivilianReportOfflineAware.mockResolvedValue({
      queued: true,
      localId: 'queued-local-x',
    });
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);
    await driveToReview();
    fireEvent.click(screen.getByTestId('queue-offline'));
    expect(await screen.findByTestId('queued-local-id')).toHaveTextContent('queued-local-x');
  });
});

describe('Report Wizard — submit error / loading UX (#604 hardening)', () => {
  it('BLOCKER(a): shows the submit error banner and re-enables submit on rejection', async () => {
    offlineMocks.submitCivilianReportOfflineAware.mockRejectedValue(new Error('boom'));
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);
    await driveToReview();
    fireEvent.click(screen.getByTestId('submit-report'));

    // Error banner renders the thrown message inside an alert region.
    const bannerText = await screen.findByText('boom');
    expect(bannerText).toBeInTheDocument();
    const alertEl = bannerText.closest('[role="alert"]');
    expect(alertEl).not.toBeNull();
    expect(alertEl).toHaveTextContent('boom');
    // The submit button must be re-enabled so the user can retry.
    expect(screen.getByTestId('submit-report')).not.toBeDisabled();
  });

  it('BLOCKER(b): blocks submit without a location and shows the validation message', async () => {
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);
    // Reach Review WITH a description but WITHOUT dropping a pin (no lat/lng).
    fireEvent.click(screen.getByText('Use my location'));
    fireEvent.click(screen.getByText('Continue')); // step 0 -> 1, no pin
    expect(await screen.findByText('Add a photo', { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Continue')); // 1 -> 2
    expect(await screen.findByText('What do you observe?')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('observable-HEAVY_SMOKE'));
    fireEvent.click(screen.getByText('Continue')); // 2 -> 3
    expect(await screen.findByTestId('description-input')).toBeInTheDocument();
    await userEvent.type(screen.getByTestId('description-input'), 'Smoke but no pin.');
    fireEvent.click(screen.getByText('Review')); // 3 -> 4
    expect(await screen.findByText('Review your report')).toBeInTheDocument();

    // buildPayload returns null (no coordinates) -> validation error, no network call.
    fireEvent.click(screen.getByTestId('submit-report'));
    expect(await screen.findByText('A description and a location are required to submit.')).toBeInTheDocument();
    expect(offlineMocks.submitCivilianReportOfflineAware).not.toHaveBeenCalled();
  });

  it('LOADING: shows "Submitting…" label and disables submit while in-flight', async () => {
    // Never-resolving promise keeps the submitting state true.
    offlineMocks.submitCivilianReportOfflineAware.mockImplementation(() => new Promise(() => {}));
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);
    await driveToReview();
    fireEvent.click(screen.getByTestId('submit-report'));

    // In-flight: button label switches to "Submitting…" and becomes disabled.
    expect(await screen.findByText('Submitting…')).toBeInTheDocument();
    expect(screen.getByTestId('submit-report')).toBeDisabled();
  });
});

describe('Report Wizard — Back navigation', () => {
  it('WARNING: Back from Category returns to Photo and preserves entered data', async () => {
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);
    // Step 0 Location
    fireEvent.click(screen.getByText('Use my location'));
    dropPin();
    fireEvent.click(screen.getByText('Continue'));
    // Step 1 Photo
    expect(await screen.findByText('Add a photo', { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Continue'));
    // Step 2 Category
    expect(await screen.findByText('What do you observe?')).toBeInTheDocument();
    expect(screen.getByTestId('step-label')).toHaveTextContent('Step 3 of 5: Category');
    fireEvent.click(screen.getByTestId('observable-HEAVY_SMOKE'));

    // Go Back to Photo.
    fireEvent.click(screen.getByText('Back'));
    expect(await screen.findByText('Step 2 of 5: Photo')).toBeInTheDocument();

    // Return to Category and confirm the selection persisted.
    fireEvent.click(screen.getByText('Continue'));
    expect(await screen.findByText('What do you observe?')).toBeInTheDocument();
    expect(screen.getByTestId('observable-HEAVY_SMOKE')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Report Wizard — clipboard fallback', () => {
  it('WARNING: copies via document.execCommand when navigator.clipboard is unavailable', async () => {
    const { default: ReportPage } = await import('../page');
    render(<ReportPage />);
    await driveToReview();
    fireEvent.click(screen.getByTestId('submit-report'));
    expect(await screen.findByTestId('qr-code')).toBeInTheDocument();

    // Remove the clipboard API to force the execCommand fallback path.
    Object.assign(navigator, { clipboard: undefined });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true });

    fireEvent.click(screen.getByTestId('copy-token'));
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });
});
