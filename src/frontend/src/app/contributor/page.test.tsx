import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('@/context/AuthContext', () => {
  const mockUser = { id: 'c1', role: 'CIVILIAN_REPORTER' };
  return { useAuth: () => ({ user: mockUser, loading: false }) };
});

const summary = {
  trust_score: 74,
  badge: 'TRUSTED',
  total_reports: 12,
  actioned_reports: 9,
  pending_reports: 3,
  volume_progress: 0.8,
  outcome_accuracy: 0.6,
  evidence_quality: 0.5,
  consistency: 0.4,
  decay: 0,
  formula_version: 'reliability-v1',
  decided_reports: 10,
  active_months: 5,
};

const mockProfile = vi.fn();
const mockReports = vi.fn();

vi.mock('@/lib/api/contributor', () => ({
  fetchContributorProfile: (...args: unknown[]) => mockProfile(...args),
  fetchContributorReports: (...args: unknown[]) => mockReports(...args),
}));

// Mock PublicFireMap (SSR-unsafe, same landing-page component reused here per #615)
vi.mock('@/components/PublicFireMap', () => ({
  PublicFireMap: ({ height, showStations }: { height?: number | string; showStations?: boolean }) => (
    <div data-testid="public-fire-map" data-height={String(height)} data-show-stations={String(showStations)} />
  ),
}));

vi.mock('@tabler/icons-react', () => ({
  IconPlus: () => <span data-testid="icon-plus" />,
  IconArrowRight: () => <span data-testid="icon-arrow-right" />,
  IconInbox: () => <span data-testid="icon-inbox" />,
}));

import ContributorPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  mockProfile.mockResolvedValue({
    ...summary,
    first_report_at: '2026-01-01T00:00:00Z',
    last_report_at: '2026-07-01T00:00:00Z',
  });
  mockReports.mockResolvedValue({
    ...summary,
    reports: [
      {
        report_id: 10,
        created_at: '2026-07-10T00:00:00Z',
        category: 'Fire',
        sub_category: 'Wildfire',
        status: 'ACTIONED',
        latitude: 14.6,
        longitude: 120.98,
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
    pages: 1,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Contributor dashboard (#615 restructure)', () => {
  it('reuses the existing contributor API endpoints and does not call fetchContributorStats', async () => {
    render(<ContributorPage />);
    await waitFor(() => expect(screen.getByText('Contributor dashboard')).toBeTruthy());
    expect(mockProfile).toHaveBeenCalledTimes(1);
    expect(mockReports).toHaveBeenCalledTimes(1);
  });

  it('renders exactly the two spec stat cards: "Reports you filed" and "Verified reports"', async () => {
    render(<ContributorPage />);
    await waitFor(() => expect(screen.getByText('Contributor dashboard')).toBeTruthy());
    expect(screen.getByText('Reports you filed')).toBeTruthy();
    expect(screen.getByText('Verified reports')).toBeTruthy();
    // Verified reports shows count + percentage (9 of 12 -> 75%)
    expect(screen.getByText(/\(75%\)/)).toBeTruthy();
  });

  it('does NOT render the old 4-card grid labels (Trust score / Total reports / Actioned / Pending)', async () => {
    render(<ContributorPage />);
    await waitFor(() => expect(screen.getByText('Contributor dashboard')).toBeTruthy());
    expect(screen.queryByText('Trust score')).not.toBeInTheDocument();
    expect(screen.queryByText('Total reports')).not.toBeInTheDocument();
    expect(screen.queryByText('Actioned', { selector: 'p' })).not.toBeInTheDocument();
  });

  it('does NOT render the trust-breakdown bar or monthly-reports grid', async () => {
    render(<ContributorPage />);
    await waitFor(() => expect(screen.getByText('Contributor dashboard')).toBeTruthy());
    expect(screen.queryByText('Trust breakdown')).not.toBeInTheDocument();
    expect(screen.queryByText('Monthly reports')).not.toBeInTheDocument();
  });

  it('renders the BFP-red report CTA linking to /report', async () => {
    render(<ContributorPage />);
    const cta = await screen.findByText('Submit a report');
    expect(cta.closest('a')?.getAttribute('href')).toBe('/report');
  });

  it('renders report history cards with status indicators', async () => {
    render(<ContributorPage />);
    await waitFor(() => expect(screen.getByText('#10')).toBeTruthy());
    expect(screen.getByText(/Fire/)).toBeTruthy();
    // ACTIONED -> "Verified" status label
    expect(screen.getByText('Verified', { selector: 'span' })).toBeTruthy();
  });

  it('renders the scrollable report list container', async () => {
    render(<ContributorPage />);
    await waitFor(() => expect(screen.getByText('#10')).toBeTruthy());
    const list = screen.getByText('#10').closest('ul');
    expect(list?.className).toMatch(/overflow-y-auto/);
  });

  it('renders the compact nearby-activity map reusing the landing PublicFireMap component', async () => {
    render(<ContributorPage />);
    await waitFor(() => expect(screen.getByText('Nearby activity')).toBeTruthy());
    const map = screen.getByTestId('public-fire-map');
    expect(map).toBeInTheDocument();
    // "Compact" viewport — smaller than the landing page's 55vh full map
    expect(map.getAttribute('data-height')).toBe('220');
  });
});
