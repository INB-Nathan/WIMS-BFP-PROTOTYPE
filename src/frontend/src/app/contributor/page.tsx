'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { ApiRequestError } from '@/lib/api/errors';
import {
  fetchContributorProfile,
  fetchContributorReports,
  fetchContributorStats,
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

export default function ContributorPage() {
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<ContributorProfile | null>(null);
  const [stats, setStats] = useState<ContributorStats | null>(null);
  const [reports, setReports] = useState<ContributorReportsResponse | null>(null);
  const [page, setPage] = useState(1);
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

  if (loading || busy) {
    return <main className="mx-auto max-w-6xl p-6" aria-busy="true"><p role="status">Loading contributor dashboard…</p></main>;
  }
  if (!user) {
    return <main className="mx-auto max-w-2xl p-6"><section className="rounded border bg-white p-6" role="alert"><h1 className="text-2xl font-semibold">Sign in required</h1><p className="mt-2">Sign in to view your contributor dashboard.</p><Link className="mt-4 inline-block rounded bg-blue-700 px-4 py-2 text-white" href="/login">Sign in</Link></section></main>;
  }
  if (user.role !== 'CIVILIAN_REPORTER') {
    return <main className="mx-auto max-w-2xl p-6"><section className="rounded border bg-white p-6" role="alert"><h1 className="text-2xl font-semibold">Access restricted</h1><p className="mt-2">This dashboard is available to civilian reporters only.</p><Link className="mt-4 inline-block rounded border px-4 py-2" href="/">Return to home</Link></section></main>;
  }
  if (error && !profile && !stats) {
    return <main className="mx-auto max-w-2xl p-6"><section className="rounded border bg-white p-6" role="alert"><h1 className="text-2xl font-semibold">{error.kind === 'auth' ? 'Sign in required' : 'Dashboard unavailable'}</h1><p className="mt-2">{error.message}</p>{error.kind === 'auth' ? <Link className="mt-4 inline-block rounded bg-blue-700 px-4 py-2 text-white" href="/login">Sign in again</Link> : <button className="mt-4 rounded bg-blue-700 px-4 py-2 text-white" onClick={() => void loadDashboard()}>Try again</button>}</section></main>;
  }

  const shownStats = stats ?? profile;
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header><h1 className="text-3xl font-semibold">Contributor dashboard</h1><p className="mt-1 text-gray-600">Your private reporting activity and reliability summary.</p></header>
      {error && <div className="rounded border border-amber-300 bg-amber-50 p-4" role="alert"><p>{error.message}</p><button className="mt-2 underline" onClick={() => void loadDashboard()}>Retry dashboard</button></div>}
      {shownStats && <section aria-labelledby="summary-heading"><h2 id="summary-heading" className="sr-only">Contributor summary</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded border bg-white p-4"><p className="text-sm text-gray-600">Trust score</p><p className="text-3xl font-bold">{shownStats.trust_score}<span className="text-base font-normal">/100</span></p></div>
        <div className="rounded border bg-white p-4"><p className="text-sm text-gray-600">Badge</p><p className="text-xl font-semibold">{shownStats.badge}</p></div>
        <div className="rounded border bg-white p-4"><p className="text-sm text-gray-600">Lifetime reports</p><p className="text-3xl font-bold">{shownStats.total_reports}</p></div>
        <div className="rounded border bg-white p-4"><p className="text-sm text-gray-600">Actioned</p><p className="text-3xl font-bold">{shownStats.actioned_reports}</p></div>
        <div className="rounded border bg-white p-4"><p className="text-sm text-gray-600">Pending</p><p className="text-3xl font-bold">{shownStats.pending_reports}</p></div>
      </div></section>}
      {stats && <section className="rounded border bg-white p-4" aria-labelledby="monthly-heading"><h2 id="monthly-heading" className="text-xl font-semibold">Monthly reports</h2>{stats.monthly_report_counts.length === 0 ? <p className="mt-3 text-gray-600">No monthly report activity yet.</p> : <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{stats.monthly_report_counts.map((item) => <li className="flex justify-between rounded bg-gray-50 p-3" key={item.month}><span>{formatMonth(item.month)}</span><strong>{item.count}</strong></li>)}</ul>}</section>}
      {profile && <p className="text-sm text-gray-600">First report: {formatDate(profile.first_report_at)} · Last report: {formatDate(profile.last_report_at)}</p>}
      <section className="rounded border bg-white p-4" aria-labelledby="reports-heading"><h2 id="reports-heading" className="text-xl font-semibold">Your reports</h2>{reportsBusy && <p className="mt-3" role="status">Loading reports…</p>}{!reportsBusy && reports?.reports.length === 0 && <p className="mt-3 text-gray-600">You have not submitted any reports yet.</p>}{!reportsBusy && reports && reports.reports.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Paginated list of your reports</caption><thead><tr className="border-b"><th className="p-2">Report</th><th className="p-2">Submitted</th><th className="p-2">Category</th><th className="p-2">Status</th></tr></thead><tbody>{reports.reports.map((report) => <tr className="border-b" key={report.report_id}><th scope="row" className="p-2">#{report.report_id}</th><td className="p-2">{formatDate(report.created_at)}</td><td className="p-2">{report.category ?? '—'}{report.sub_category ? ` · ${report.sub_category}` : ''}</td><td className="p-2">{report.status}</td></tr>)}</tbody></table></div>}{reports && reports.pages > 1 && <nav className="mt-4 flex items-center justify-between" aria-label="Report pages"><button className="rounded border px-3 py-2 disabled:opacity-50" disabled={page <= 1 || reportsBusy} onClick={() => void loadReports(page - 1)}>Previous</button><span aria-live="polite">Page {page} of {reports.pages}</span><button className="rounded border px-3 py-2 disabled:opacity-50" disabled={page >= reports.pages || reportsBusy} onClick={() => void loadReports(page + 1)}>Next</button></nav>}</section>
    </main>
  );
}
