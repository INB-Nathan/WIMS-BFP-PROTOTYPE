import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ContributorPage from './page';
import { useAuth } from '@/context/AuthContext';
import { ApiRequestError } from '@/lib/api/errors';
import * as contributorApi from '@/lib/api/contributor';

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/api/contributor', () => ({
  fetchContributorProfile: vi.fn(),
  fetchContributorReports: vi.fn(),
  fetchContributorStats: vi.fn(),
}));

const auth = vi.mocked(useAuth);
const summary = {
  trust_score: 74,
  badge: 'TRUSTED',
  total_reports: 3,
  actioned_reports: 2,
  pending_reports: 1,
  volume_progress: 0.42,
  outcome_accuracy: 0.5,
  evidence_quality: 0.4,
  consistency: 0.5,
  decay: 0,
  formula_version: 'reliability-v1',
  decided_reports: 2,
  active_months: 3,
};
const profile = { ...summary, first_report_at: null, last_report_at: null };
const reports = {
  ...summary,
  reports: [{ report_id: 12, created_at: '2026-07-01T00:00:00Z', category: 'FIRE', sub_category: null, status: 'PENDING', latitude: 14, longitude: 120 }],
  total: 21,
  page: 1,
  limit: 20,
  pages: 2,
};
const stats = { ...summary, monthly_report_counts: [{ month: '2026-07-01T00:00:00Z', count: 1 }] };

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockReturnValue({ user: { id: 'u1', role: 'CIVILIAN_REPORTER' }, loading: false, isAuthenticated: true, serverValidated: true, canQueueOfflineWrites: false, loggingOut: false, login: vi.fn(), logout: vi.fn(), refreshSession: vi.fn() });
  vi.mocked(contributorApi.fetchContributorProfile).mockResolvedValue(profile);
  vi.mocked(contributorApi.fetchContributorReports).mockResolvedValue(reports);
  vi.mocked(contributorApi.fetchContributorStats).mockResolvedValue(stats);
});

describe('contributor dashboard', () => {
  it('renders summary, monthly activity, and reports', async () => {
    render(<ContributorPage />);
    expect(await screen.findByText('Contributor dashboard')).toBeInTheDocument();
    expect(screen.getByText('TRUSTED')).toBeInTheDocument();
    expect(screen.getByText('#12')).toBeInTheDocument();
    expect(screen.getByText('July 2026')).toBeInTheDocument();
  });

  it('shows a loading status while authentication is still loading', () => {
    auth.mockReturnValue({ user: null, loading: true, isAuthenticated: false, serverValidated: false, canQueueOfflineWrites: false, loggingOut: false, login: vi.fn(), logout: vi.fn(), refreshSession: vi.fn() });
    render(<ContributorPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading contributor dashboard…');
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(contributorApi.fetchContributorProfile).not.toHaveBeenCalled();
  });

  it('shows the empty monthly and report states', async () => {
    vi.mocked(contributorApi.fetchContributorReports).mockResolvedValue({ ...reports, reports: [], total: 0, pages: 1 });
    vi.mocked(contributorApi.fetchContributorStats).mockResolvedValue({ ...stats, monthly_report_counts: [] });
    render(<ContributorPage />);
    expect(await screen.findByText('No monthly report activity yet.')).toBeInTheDocument();
    expect(screen.getByText('You have not submitted any reports yet.')).toBeInTheDocument();
  });

  it('shows an operational error when dashboard loading fails', async () => {
    vi.mocked(contributorApi.fetchContributorStats).mockRejectedValueOnce(new Error('server failure'));
    render(<ContributorPage />);
    expect(await screen.findByRole('heading', { name: 'Dashboard unavailable' })).toBeInTheDocument();
    expect(screen.getByText('We could not load your contributor dashboard. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('handles an endpoint-level 401 as an expired session', async () => {
    vi.mocked(contributorApi.fetchContributorProfile).mockRejectedValueOnce(new ApiRequestError('expired', 401));
    render(<ContributorPage />);
    expect(await screen.findByRole('heading', { name: 'Sign in required' })).toBeInTheDocument();
    expect(screen.getByText('Your session has expired. Please sign in again.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/login');
  });

  it('handles an endpoint-level 403 as a forbidden dashboard', async () => {
    vi.mocked(contributorApi.fetchContributorReports).mockRejectedValueOnce(new ApiRequestError('forbidden', 403));
    render(<ContributorPage />);
    expect(await screen.findByRole('heading', { name: 'Dashboard unavailable' })).toBeInTheDocument();
    expect(screen.getByText('This dashboard is available to civilian reporters only.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('supports moving to the next report page', async () => {
    vi.mocked(contributorApi.fetchContributorReports).mockResolvedValueOnce(reports).mockResolvedValueOnce({ ...reports, page: 2, reports: [] });
    render(<ContributorPage />);
    const next = await screen.findByRole('button', { name: 'Next' });
    fireEvent.click(next);
    await waitFor(() => expect(contributorApi.fetchContributorReports).toHaveBeenLastCalledWith(2, 20));
    expect(await screen.findByText('You have not submitted any reports yet.')).toBeInTheDocument();
  });

  it('shows a restricted state for other roles', () => {
    auth.mockReturnValue({ user: { id: 'u1', role: 'NATIONAL_ANALYST' }, loading: false, isAuthenticated: true, serverValidated: true, canQueueOfflineWrites: false, loggingOut: false, login: vi.fn(), logout: vi.fn(), refreshSession: vi.fn() });
    render(<ContributorPage />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
  });

  it('asks unauthenticated visitors to sign in', () => {
    auth.mockReturnValue({ user: null, loading: false, isAuthenticated: false, serverValidated: false, canQueueOfflineWrites: false, loggingOut: false, login: vi.fn(), logout: vi.fn(), refreshSession: vi.fn() });
    render(<ContributorPage />);
    expect(screen.getByText('Sign in required')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});
