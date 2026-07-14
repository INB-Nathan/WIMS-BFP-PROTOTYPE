'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { ApiRequestError } from '@/lib/api/errors';
import {
  fetchContributorProfile,
  fetchContributorReports,
  fetchContributorStats,
  type ContributorPrivateSummary,
  type ContributorProfile,
  type ContributorReportsResponse,
  type ContributorStats,
} from '@/lib/api/contributor';

const PAGE_SIZE = 20;

type LoadError = { kind: 'auth' | 'forbidden' | 'operational'; message: string };

function errorFor(error: unknown): LoadError {
  if (error instanceof ApiRequestError && error.status === 401) {
    return { kind: 'auth', message: 'Your session has expired. Please sign in again.' };
  }
  if (error instanceof ApiRequestError && error.status === 403) {
    return { kind: 'forbidden', message: 'This dashboard is available to civilian reporters only.' };
  }
  return { kind: 'operational', message: 'We could not load your contributor dashboard. Please try again.' };
}

function formatDate(value: string | null): string {
  if (!value) return 'Not yet available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not yet available' : date.toLocaleDateString();
}

function formatMonth(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

// Trust-score components surfaced as the segmented "Trust breakdown" bar.
const TRUST_FACTORS: ReadonlyArray<{
  key: keyof ContributorPrivateSummary;
  label: string;
  color: string;
}> = [
  { key: 'volume_progress', label: 'Volume', color: '#0891B2' },
  { key: 'outcome_accuracy', label: 'Accuracy', color: '#06B6D4' },
  { key: 'evidence_quality', label: 'Evidence', color: '#6366F1' },
  { key: 'consistency', label: 'Consistency', color: '#8B5CF6' },
];

type ReportFilter = 'all' | 'pending' | 'resolved';

function reportStatusPill(status: string): { label: string; className: string } {
  const s = status.toUpperCase();
  if (s === 'ACTIONED') return { label: 'Actioned', className: 'bg-green-50 text-green-700' };
  if (s.startsWith('REJECTED')) return { label: 'Rejected', className: 'bg-slate-100 text-slate-600' };
  if (s === 'LINKED') return { label: 'Linked', className: 'bg-cyan-50 text-cyan-700' };
  if (s === 'UNDER_REVIEW') return { label: 'Under review', className: 'bg-amber-50 text-amber-700' };
  return { label: 'Pending', className: 'bg-amber-50 text-amber-700' };
}

function matchesFilter(status: string, filter: ReportFilter): boolean {
  if (filter === 'all') return true;
  const s = status.toUpperCase();
  if (filter === 'pending') return ['PENDING', 'UNDER_REVIEW', 'LINKED'].includes(s);
  return s === 'ACTIONED';
}

export default function ContributorPage() {
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<ContributorProfile | null>(null);
  const [stats, setStats] = useState<ContributorStats | null>(null);
  const [reports, setReports] = useState<ContributorReportsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [reportFilter, setReportFilter] = useState<ReportFilter>('all');
  const [busy, setBusy] = useState(true);
  const [reportsBusy, setReportsBusy] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);

  const loadReports = useCallback(async (nextPage: number) => {
    setReportsBusy(true);
    try {
      setReports(await fetchContributorReports(nextPage, PAGE_SIZE));
      setPage(nextPage);
      setError(null);
    } catch (cause) {
      setError(errorFor(cause));
    } finally {
      setReportsBusy(false);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [nextProfile, nextReports, nextStats] = await Promise.all([
        fetchContributorProfile(),
        fetchContributorReports(1, PAGE_SIZE),
        fetchContributorStats(),
      ]);
      setProfile(nextProfile);
      setReports(nextReports);
      setStats(nextStats);
      setPage(nextReports.page);
    } catch (cause) {
      setError(errorFor(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && user?.role === 'CIVILIAN_REPORTER') void loadDashboard();
    if (!loading && user?.role !== 'CIVILIAN_REPORTER') setBusy(false);
  }, [loading, user, loadDashboard]);

  const summary: ContributorPrivateSummary | null = stats ?? profile;

  const trustBreakdown = useMemo(() => {
    if (!summary) return [];
    const values = TRUST_FACTORS.map((f) => {
      const raw = summary[f.key];
      const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
      return { ...f, value: Math.max(0, Math.min(1, v)) };
    });
    const total = values.reduce((a, b) => a + b.value, 0);
    return values.map((v) => ({
      ...v,
      widthPct: total > 0 ? Math.round((v.value / total) * 100) : 0,
      actualPct: Math.round(v.value * 100),
    }));
  }, [summary]);

  const hasTrustData = trustBreakdown.some((v) => v.value > 0);

  const actionedPct =
    summary && summary.total_reports > 0
      ? Math.round((summary.actioned_reports / summary.total_reports) * 100)
      : null;

  const visibleReports = useMemo(() => {
    if (!reports) return [];
    return reports.reports.filter((r) => matchesFilter(r.status, reportFilter));
  }, [reports, reportFilter]);

  if (loading || busy) {
    return (
      <main className="mx-auto max-w-6xl p-6" aria-busy="true">
        <p role="status">Loading contributor dashboard…</p>
      </main>
    );
  }
  if (!user) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <section className="rounded border bg-white p-6" role="alert">
          <h1 className="text-2xl font-semibold">Sign in required</h1>
          <p className="mt-2">Sign in to view your contributor dashboard.</p>
          <Link className="mt-4 inline-block rounded bg-blue-700 px-4 py-2 text-white" href="/login">
            Sign in
          </Link>
        </section>
      </main>
    );
  }
  if (user.role !== 'CIVILIAN_REPORTER') {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <section className="rounded border bg-white p-6" role="alert">
          <h1 className="text-2xl font-semibold">Access restricted</h1>
          <p className="mt-2">This dashboard is available to civilian reporters only.</p>
          <Link className="mt-4 inline-block rounded border px-4 py-2" href="/">
            Return to home
          </Link>
        </section>
      </main>
    );
  }
  if (error && !profile && !stats) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <section className="rounded border bg-white p-6" role="alert">
          <h1 className="text-2xl font-semibold">
            {error.kind === 'auth' ? 'Sign in required' : 'Dashboard unavailable'}
          </h1>
          <p className="mt-2">{error.message}</p>
          {error.kind === 'auth' ? (
            <Link className="mt-4 inline-block rounded bg-blue-700 px-4 py-2 text-white" href="/login">
              Sign in again
            </Link>
          ) : (
            <button className="mt-4 rounded bg-blue-700 px-4 py-2 text-white" onClick={() => void loadDashboard()}>
              Try again
            </button>
          )}
        </section>
      </main>
    );
  }

  const totalReports = summary?.total_reports ?? 0;
  const isNewReporter = totalReports === 0;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Contributor dashboard</h1>
          <p className="mt-1 text-gray-600">Your private reporting activity and reliability summary.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-600">
          <span className="h-2 w-2 rounded-full bg-green-600" />
          {isNewReporter ? 'New reporter' : 'Active reporter'}
        </span>
      </header>

      {/* BFP red report CTA */}
      <Link
        href="/report"
        className="flex items-center gap-4 rounded-lg bg-[#C62828] p-4 text-white no-underline transition-colors hover:bg-[#8E1B1B]"
      >
        <span className="text-2xl leading-none" aria-hidden>
          ＋
        </span>
        <span className="flex-1">
          <span className="block text-base font-bold">Submit a report</span>
          <span className="block text-sm opacity-80">
            Your observations drive faster emergency response
          </span>
        </span>
        <span className="text-xl opacity-70" aria-hidden>
          →
        </span>
      </Link>

      {error && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4" role="alert">
          <p>{error.message}</p>
          <button className="mt-2 underline" onClick={() => void loadDashboard()}>
            Retry dashboard
          </button>
        </div>
      )}

      {/* 4-stat grid */}
      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="sr-only">
          Contributor summary
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded border bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Trust score</p>
            <p className="mt-2 text-4xl font-semibold" style={{ fontFamily: MONO, color: '#0891B2' }}>
              {summary?.trust_score ?? '—'}
              <span className="text-base font-normal text-gray-400">/100</span>
            </p>
            <p className="mt-1 text-xs text-gray-500">{summary?.badge ?? 'Unrated'}</p>
          </div>
          <div className="rounded border bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total reports</p>
            <p className="mt-2 text-4xl font-semibold" style={{ fontFamily: MONO }}>
              {summary?.total_reports ?? '—'}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {summary?.active_months ? `${summary.active_months} mo active` : 'Lifetime'}
            </p>
          </div>
          <div className="rounded border bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Actioned</p>
            <p className="mt-2 text-4xl font-semibold" style={{ fontFamily: MONO }}>
              {summary?.actioned_reports ?? '—'}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {actionedPct !== null ? `${actionedPct}% actioned` : 'Awaiting review'}
            </p>
          </div>
          <div className="rounded border bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Pending</p>
            <p className="mt-2 text-4xl font-semibold" style={{ fontFamily: MONO }}>
              {summary?.pending_reports ?? '—'}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {summary && summary.pending_reports > 0 ? 'Awaiting review' : 'All reviewed'}
            </p>
          </div>
        </div>
      </section>

      {/* Segmented trust breakdown bar */}
      {hasTrustData && (
        <section className="rounded border bg-white p-4 shadow-sm" aria-labelledby="trust-heading">
          <h2 id="trust-heading" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Trust breakdown
          </h2>
          <div className="mt-3 flex h-2 overflow-hidden rounded" role="img" aria-label="Trust score composition">
            {trustBreakdown.map((seg) => (
              <div
                key={seg.key}
                style={{ width: `${seg.widthPct}%`, backgroundColor: seg.color }}
                className="h-full"
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-600">
            {trustBreakdown.map((seg) => (
              <span key={seg.key} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seg.color }} />
                {seg.label} {seg.actualPct}%
              </span>
            ))}
          </div>
        </section>
      )}

      {stats && stats.monthly_report_counts.length > 0 && (
        <section className="rounded border bg-white p-4 shadow-sm" aria-labelledby="monthly-heading">
          <h2 id="monthly-heading" className="text-xl font-semibold">
            Monthly reports
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stats.monthly_report_counts.map((item) => (
              <li className="flex justify-between rounded bg-gray-50 p-3" key={item.month}>
                <span>{formatMonth(item.month)}</span>
                <strong>{item.count}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile && (
        <p className="text-sm text-gray-600">
          First report: {formatDate(profile.first_report_at)} · Last report:{' '}
          {formatDate(profile.last_report_at)}
        </p>
      )}

      {/* Report history */}
      <section className="rounded border bg-white p-4 shadow-sm" aria-labelledby="reports-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="reports-heading" className="text-xl font-semibold">
            Report history
          </h2>
          <div className="flex gap-1 rounded border border-gray-200 bg-gray-50 p-1">
            {(['all', 'pending', 'resolved'] as ReportFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setReportFilter(f)}
                className={`rounded px-3 py-1 text-xs font-semibold capitalize ${
                  reportFilter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {isNewReporter ? (
          <div className="mt-4 rounded-lg border-2 border-dashed border-gray-200 p-10 text-center">
            <p className="text-2xl">🛰️</p>
            <h3 className="mt-3 text-base font-semibold">Welcome, civilian reporter</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm text-gray-600">
              Submit your first field report to activate your dashboard. Your trust score, activity
              stats, and report history will appear here.
            </p>
          </div>
        ) : (
          <>
            {reportsBusy && (
              <p className="mt-3" role="status">
                Loading reports…
              </p>
            )}
            {!reportsBusy && visibleReports.length === 0 && (
              <p className="mt-3 text-gray-600">No reports match this filter.</p>
            )}
            {!reportsBusy && visibleReports.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {visibleReports.map((report) => {
                  const pill = reportStatusPill(report.status);
                  return (
                    <li
                      key={report.report_id}
                      className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded border bg-white p-3 shadow-sm"
                    >
                      <span
                        className="font-medium text-gray-400"
                        style={{ fontFamily: MONO, minWidth: '52px' }}
                      >
                        #{report.report_id}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-gray-900">
                          {report.sub_category ?? report.category ?? 'Report'}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {formatDate(report.created_at)}
                        </span>
                      </span>
                      <span className="whitespace-nowrap rounded bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">
                        {report.category ?? '—'}
                        {report.sub_category ? ` · ${report.sub_category}` : ''}
                      </span>
                      <span
                        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${pill.className}`}
                      >
                        {pill.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {reports && reports.pages > 1 && (
              <nav className="mt-4 flex items-center justify-between" aria-label="Report pages">
                <button
                  className="rounded border px-3 py-2 disabled:opacity-50"
                  disabled={page <= 1 || reportsBusy}
                  onClick={() => void loadReports(page - 1)}
                >
                  Previous
                </button>
                <span aria-live="polite">
                  Page {page} of {reports.pages}
                </span>
                <button
                  className="rounded border px-3 py-2 disabled:opacity-50"
                  disabled={page >= reports.pages || reportsBusy}
                  onClick={() => void loadReports(page + 1)}
                >
                  Next
                </button>
              </nav>
            )}
          </>
        )}
      </section>
    </main>
  );
}
