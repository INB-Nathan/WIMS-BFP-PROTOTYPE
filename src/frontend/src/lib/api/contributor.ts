import { apiFetch } from './transport';

export interface ContributorPrivateSummary {
  trust_score: number;
  badge: string;
  total_reports: number;
  actioned_reports: number;
  pending_reports: number;
  volume_progress: number;
  outcome_accuracy: number;
  evidence_quality: number;
  consistency: number;
  decay: number;
  formula_version: string;
  decided_reports: number;
  active_months: number;
}

export interface ContributorProfile extends ContributorPrivateSummary {
  first_report_at: string | null;
  last_report_at: string | null;
}

export interface ContributorReport {
  report_id: number;
  created_at: string;
  category: string | null;
  sub_category: string | null;
  status: string;
  latitude: number;
  longitude: number;
}

export interface ContributorReportsResponse extends ContributorPrivateSummary {
  reports: ContributorReport[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface ContributorStats extends ContributorPrivateSummary {
  monthly_report_counts: Array<{ month: string; count: number }>;
}

export function fetchContributorProfile(): Promise<ContributorProfile> {
  return apiFetch<ContributorProfile>('/civilian/contributor/me', {
    skipAuthRedirect: true,
    cache: 'no-store',
  });
}

export function fetchContributorReports(page = 1, limit = 20): Promise<ContributorReportsResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  return apiFetch<ContributorReportsResponse>(`/civilian/contributor/reports?${params}`, {
    skipAuthRedirect: true,
    cache: 'no-store',
  });
}

export function fetchContributorStats(): Promise<ContributorStats> {
  return apiFetch<ContributorStats>('/civilian/contributor/stats', {
    skipAuthRedirect: true,
    cache: 'no-store',
  });
}
