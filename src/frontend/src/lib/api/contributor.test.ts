import { describe, expect, it, vi } from 'vitest';
import { fetchContributorProfile, fetchContributorReports, fetchContributorStats } from './contributor';
import { apiFetch } from './transport';

vi.mock('./transport', () => ({ apiFetch: vi.fn() }));

const mockedApiFetch = vi.mocked(apiFetch);
const summary = {
  trust_score: 42,
  badge: 'TRUSTED',
  total_reports: 3,
  actioned_reports: 2,
  pending_reports: 1,
  volume_progress: 0.4,
  outcome_accuracy: 0.5,
  evidence_quality: 0.3,
  consistency: 0.5,
  decay: 0,
  formula_version: 'reliability-v1',
  decided_reports: 2,
  active_months: 3,
};

describe('contributor API clients', () => {
  it('uses the existing authenticated profile endpoint', async () => {
    mockedApiFetch.mockResolvedValueOnce({ ...summary, first_report_at: null, last_report_at: null });
    await fetchContributorProfile();
    expect(mockedApiFetch).toHaveBeenCalledWith('/civilian/contributor/me', {
      skipAuthRedirect: true,
      cache: 'no-store',
    });
  });

  it('encodes pagination in the reports endpoint', async () => {
    mockedApiFetch.mockResolvedValueOnce({ ...summary, reports: [], total: 0, page: 2, limit: 20, pages: 1 });
    await fetchContributorReports(2, 20);
    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/civilian/contributor/reports?page=2&limit=20',
      { skipAuthRedirect: true, cache: 'no-store' },
    );
  });

  it('uses the existing stats endpoint', async () => {
    mockedApiFetch.mockResolvedValueOnce({ ...summary, monthly_report_counts: [] });
    await fetchContributorStats();
    expect(mockedApiFetch).toHaveBeenCalledWith('/civilian/contributor/stats', {
      skipAuthRedirect: true,
      cache: 'no-store',
    });
  });
});
