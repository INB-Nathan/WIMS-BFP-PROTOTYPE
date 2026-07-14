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
const mockStats = vi.fn();

vi.mock('@/lib/api/contributor', () => ({
  fetchContributorProfile: (...args: unknown[]) => mockProfile(...args),
  fetchContributorReports: (...args: unknown[]) => mockReports(...args),
  fetchContributorStats: (...args: unknown[]) => mockStats(...args),
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
  mockStats.mockResolvedValue({ ...summary, monthly_report_counts: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Contributor dashboard (redesign)', () => {
  it('reuses the existing contributor API endpoints', async () => {
    render(<ContributorPage />);
    await waitFor(() => expect(screen.getByText('Contributor dashboard')).toBeTruthy());
    expect(mockProfile).toHaveBeenCalledTimes(1);
    expect(mockReports).toHaveBeenCalledTimes(1);
    expect(mockStats).toHaveBeenCalledTimes(1);
  });

  it('renders the four-stat grid', async () => {
    render(<ContributorPage />);
    await waitFor(() => expect(screen.getByText('Contributor dashboard')).toBeTruthy());
    expect(screen.getByText('Trust score')).toBeTruthy();
    expect(screen.getByText('Total reports')).toBeTruthy();
    expect(screen.getByText('Actioned', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
  });

  it('renders the BFP-red report CTA linking to /report', async () => {
    render(<ContributorPage />);
    const cta = await screen.findByText('Submit a report');
    expect(cta.closest('a')?.getAttribute('href')).toBe('/report');
  });

  it('renders report history cards with status pills', async () => {
    render(<ContributorPage />);
    await waitFor(() => expect(screen.getByText('#10')).toBeTruthy());
    expect(screen.getByText(/Fire/)).toBeTruthy();
    // ACTIONED -> "Actioned" pill
    expect(screen.getByText('Actioned', { selector: 'span' })).toBeTruthy();
  });

  it('shows the segmented trust breakdown', async () => {
    render(<ContributorPage />);
    await waitFor(() => expect(screen.getByText('Trust breakdown')).toBeTruthy());
    expect(screen.getByText(/Volume/)).toBeTruthy();
    expect(screen.getByText(/Consistency/)).toBeTruthy();
  });
});
