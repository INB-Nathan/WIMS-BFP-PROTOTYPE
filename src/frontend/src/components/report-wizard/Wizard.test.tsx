/**
 * Test B — "your last report" banner on the report wizard (Issue #654).
 *
 * When wims_last_report exists in localStorage, the wizard renders a banner
 * with a tracking link. A signed-in CIVILIAN_REPORTER also sees a link to
 * their contributor dashboard; an anonymous user sees only the tracking link.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReportWizard } from './Wizard';

// Keep the heavy wizard light: stub the auto-sync hook, the safety banner,
// and the step components so only the banner (Fix B) is exercised.
vi.mock('@/lib/usePublicAutoSync', () => ({
  usePublicAutoSync: () => ({
    syncing: false,
    lastSyncedAt: null,
    pendingCount: 0,
    failedCount: 0,
    syncNow: vi.fn(),
  }),
}));

vi.mock('./SafetyBanner', () => ({
  SafetyBanner: () => <div data-testid="safety-banner" />,
}));

vi.mock('./StepLocation', () => ({ StepLocation: () => null }));
vi.mock('./StepPhoto', () => ({ StepPhoto: () => null }));
vi.mock('./StepCategory', () => ({ StepCategory: () => null }));
vi.mock('./StepDetails', () => ({ StepDetails: () => null }));
vi.mock('./StepReview', () => ({ StepReview: () => null }));

function makeReporter(role: string | null) {
  return {
    user: role ? { id: 'c1', role } : null,
    isAuthenticated: role !== null,
    loading: false,
  };
}

const useAuthMock = vi.fn();
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

const LAST_REPORT = {
  id: 7,
  category: 'FIRE',
  tracking_url: 'https://wims.test/tracking/7/abc',
};

describe('ReportWizard last-report banner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthMock.mockReturnValue(makeReporter(null));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the banner with a tracking link when wims_last_report exists', () => {
    localStorage.setItem('wims_last_report', JSON.stringify(LAST_REPORT));
    render(<ReportWizard />);

    const banner = screen.getByTestId('last-report-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('Your last report #7');
    const trackLink = screen.getByText('Track this report');
    expect(trackLink).toHaveAttribute('href', 'https://wims.test/tracking/7/abc');
  });

  it('does NOT show the banner when there is no last report', () => {
    render(<ReportWizard />);
    expect(screen.queryByTestId('last-report-banner')).not.toBeInTheDocument();
  });

  it('links to /contributor for a signed-in CIVILIAN_REPORTER', () => {
    localStorage.setItem('wims_last_report', JSON.stringify(LAST_REPORT));
    useAuthMock.mockReturnValue(makeReporter('CIVILIAN_REPORTER'));
    render(<ReportWizard />);

    const dashboardLink = screen.getByText('View on your dashboard');
    expect(dashboardLink).toHaveAttribute('href', '/contributor');
  });

  it('does NOT link to /contributor for an anonymous user', () => {
    localStorage.setItem('wims_last_report', JSON.stringify(LAST_REPORT));
    useAuthMock.mockReturnValue(makeReporter(null));
    render(<ReportWizard />);

    expect(screen.queryByText('View on your dashboard')).not.toBeInTheDocument();
  });
});
