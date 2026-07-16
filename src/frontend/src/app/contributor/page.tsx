'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { ApiRequestError } from '@/lib/api/errors';
import {
  fetchContributorProfile,
  fetchContributorReports,
  type ContributorPrivateSummary,
  type ContributorProfile,
  type ContributorReportsResponse,
} from '@/lib/api/contributor';
import { IconPlus, IconArrowRight, IconInbox } from '@tabler/icons-react';

// SSR guard: react-leaflet breaks without window. Reuses the same map
// component as the public landing page (#612), just rendered at a
// smaller/"compact" viewport height for the contributor dashboard (#615).
const PublicFireMap = dynamic(
  () => import('@/components/PublicFireMap').then((m) => m.PublicFireMap),
  { ssr: false },
);

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

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

type ReportFilter = 'all' | 'pending' | 'resolved';

function reportStatusIndicator(status: string): { label: string; className: string; dotClassName: string } {
  const s = status.toUpperCase();
  if (s === 'ACTIONED') {
    return { label: 'Verified', className: 'bg-green-50 text-green-700', dotClassName: 'bg-green-600' };
  }
  if (s.startsWith('REJECTED')) {
    return { label: 'Rejected', className: 'bg-slate-100 text-slate-600', dotClassName: 'bg-slate-500' };
  }
  if (s === 'LINKED') {
    return { label: 'Linked', className: 'bg-cyan-50 text-cyan-700', dotClassName: 'bg-cyan-600' };
  }
  if (s === 'UNDER_REVIEW') {
    return { label: 'Under review', className: 'bg-amber-50 text-amber-700', dotClassName: 'bg-amber-500' };
  }
  return { label: 'Pending', className: 'bg-amber-50 text-amber-700', dotClassName: 'bg-amber-500' };
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
      const [nextProfile, nextReports] = await Promise.all([
        fetchContributorProfile(),
        fetchContributorReports(1, PAGE_SIZE),
      ]);
      setProfile(nextProfile);
      setReports(nextReports);
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

  const summary: ContributorPrivateSummary | null = reports ?? profile;

  const verifiedPct =
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
  if (error && !profile && !reports) {
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

      {/* BFP red report CTA — "Report again" flow: location-first, matching Report Wizard order */}
      <Link
        href="/report"
        className="flex items-center gap-4 rounded-lg bg-[#C62828] p-4 text-white no-underline transition-colors hover:bg-[#8E1B1B]"
      >
        <IconPlus size={24} aria-hidden className="flex-shrink-0" />
        <span className="flex-1">
          <span className="block text-base font-bold">Submit a report</span>
          <span className="block text-sm opacity-80">
            Your observations drive faster emergency response
          </span>
        </span>
        <IconArrowRight size={20} aria-hidden className="flex-shrink-0 opacity-70" />
      </Link>

      {error && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4" role="alert">
          <p>{error.message}</p>
          <button className="mt-2 underline" onClick={() => void loadDashboard()}>
            Retry dashboard
          </button>
        </div>
      )}

      {/* Two stat cards per IA spec (docs/superpowers/specs/2026-07-15-public-surface-ia-design.md #5) */}
      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="sr-only">
          Contributor summary
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded border bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Reports you filed</p>
            <p className="mt-2 text-4xl font-semibold" style={{ fontFamily: MONO }}>
              {summary?.total_reports ?? '—'}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {summary?.active_months ? `${summary.active_months} mo active` : 'Lifetime'}
            </p>
          </div>
          <div className="rounded border bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Verified reports</p>
            <p className="mt-2 text-4xl font-semibold" style={{ fontFamily: MONO, color: '#059669' }}>
              {summary?.actioned_reports ?? '—'}
              {verifiedPct !== null && (
                <span className="text-base font-normal text-gray-400"> ({verifiedPct}%)</span>
              )}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {summary && summary.pending_reports > 0
                ? `${summary.pending_reports} awaiting review`
                : 'All reviewed'}
            </p>
          </div>
        </div>
      </section>

      {/* Scrollable report list with status indicators */}
      <section className="rounded border bg-white p-4 shadow-sm" aria-labelledby="reports-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="reports-heading" className="text-xl font-semibold">
            Your reports
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
            <IconInbox size={32} className="mx-auto text-gray-300" aria-hidden />
            <h3 className="mt-3 text-base font-semibold">Welcome, civilian reporter</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm text-gray-600">
              Submit your first field report to activate your dashboard. Your report history and
              verification status will appear here.
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
              <ul className="mt-3 flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
                {visibleReports.map((report) => {
                  const indicator = reportStatusIndicator(report.status);
                  return (
                    <li
                      key={report.report_id}
                      className="grid grid-cols-[auto_auto_1fr_auto_auto] items-center gap-3 rounded border bg-white p-3 shadow-sm"
                    >
                      <span
                        className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${indicator.dotClassName}`}
                        aria-hidden
                      />
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
                        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${indicator.className}`}
                      >
                        {indicator.label}
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

      {/* Compact nearby-activity map — same component as the landing page (#612),
          rendered at a smaller viewport per the IA spec's "compact" requirement. */}
      <section className="rounded border bg-white p-4 shadow-sm" aria-labelledby="nearby-map-heading">
        <h2 id="nearby-map-heading" className="text-xl font-semibold">
          Nearby activity
        </h2>
        <div className="mt-3">
          <PublicFireMap height={220} zoom={11} showStations className="nearby-activity-map" />
        </div>
      </section>
    </main>
  );
}
