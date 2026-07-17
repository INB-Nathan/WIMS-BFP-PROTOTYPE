'use client';

// Issue #655 — Contributor dashboard (CIVILIAN_REPORTER) public-surface migration.
// The provider, shared civilian header, and footer are supplied centrally by
// LayoutShell, which wraps this route in <PublicThemeProvider showHeader={false}>
// and renders PublicHeader for every civilian route. This page is content-only:
// it must not import, instantiate, or configure PublicThemeProvider, nor add
// any page-owned chrome, theme toggle, or navigation.

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { ApiRequestError } from '@/lib/api/errors';
import {
  fetchContributorProfile,
  fetchContributorReports,
  type ContributorProfile,
  type ContributorReportsResponse,
} from '@/lib/api/contributor';
import { IconPlus, IconArrowRight, IconInbox, IconShieldCheckFilled, IconFlameFilled } from '@tabler/icons-react';

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

type ReportFilter = 'all' | 'pending' | 'resolved';

type StatusPresentation = { label: string; toneClass: string; pillClass: string };

// Centralized status mapping: text + pill (with a decorative dot, aria-hidden).
// PENDING/UNDER_REVIEW/LINKED stay pending and ACTIONED is resolved downstream.
function reportStatusIndicator(status: string): StatusPresentation {
  const s = status.toUpperCase();
  if (s === 'ACTIONED') {
    return { label: 'Verified', toneClass: 'ps-contributor-tone-verified', pillClass: 'ps-pill-green' };
  }
  if (s.startsWith('REJECTED')) {
    return { label: 'Rejected', toneClass: 'ps-contributor-tone-rejected', pillClass: 'ps-pill-red' };
  }
  if (s === 'LINKED') {
    return { label: 'Linked', toneClass: 'ps-contributor-tone-linked', pillClass: 'ps-pill-cyan' };
  }
  if (s === 'UNDER_REVIEW') {
    return { label: 'Under review', toneClass: 'ps-contributor-tone-review', pillClass: 'ps-pill-orange' };
  }
  return { label: 'Pending', toneClass: 'ps-contributor-tone-pending', pillClass: 'ps-pill-yellow' };
}

function matchesFilter(status: string, filter: ReportFilter): boolean {
  if (filter === 'all') return true;
  const s = status.toUpperCase();
  if (filter === 'pending') return ['PENDING', 'UNDER_REVIEW', 'LINKED'].includes(s);
  return s === 'ACTIONED';
}

function displayNameFor(user: { preferred_username?: string | null; email?: string | null } | null): string {
  const preferred = user?.preferred_username?.trim();
  if (preferred) return preferred;
  const email = user?.email?.trim();
  if (email) return email.split('@')[0] || 'reporter';
  return 'reporter';
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

  const summary = reports ?? profile;

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
      <div className="ps-contributor-page ps-has-mesh">
        <div className="ps-contributor-inner ps-contributor-state">
          <p className="ps-status-msg" role="status" aria-busy="true">
            Loading contributor dashboard…
          </p>
        </div>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="ps-contributor-page ps-has-mesh">
        <div className="ps-contributor-inner ps-contributor-state">
          <section className="ps-card" role="alert">
            <h1 className="ps-contributor-section-heading">Sign in required</h1>
            <p className="ps-secondary">Sign in to view your contributor dashboard.</p>
            <Link className="ps-btn ps-btn-primary" href="/login">
              Sign in
            </Link>
          </section>
        </div>
      </div>
    );
  }
  if (user.role !== 'CIVILIAN_REPORTER') {
    return (
      <div className="ps-contributor-page ps-has-mesh">
        <div className="ps-contributor-inner ps-contributor-state">
          <section className="ps-card" role="alert">
            <h1 className="ps-contributor-section-heading">Access restricted</h1>
            <p className="ps-secondary">This dashboard is available to civilian reporters only.</p>
            <Link className="ps-btn ps-btn-outline" href="/">
              Return to home
            </Link>
          </section>
        </div>
      </div>
    );
  }
  if (error && !profile && !reports) {
    return (
      <div className="ps-contributor-page ps-has-mesh">
        <div className="ps-contributor-inner ps-contributor-state">
          <section className="ps-card" role="alert">
            <h1 className="ps-contributor-section-heading">
              {error.kind === 'auth' ? 'Sign in required' : 'Dashboard unavailable'}
            </h1>
            <p className="ps-secondary">{error.message}</p>
            {error.kind === 'auth' ? (
              <Link className="ps-btn ps-btn-primary" href="/login">
                Sign in again
              </Link>
            ) : (
              <button className="ps-btn ps-btn-primary" onClick={() => void loadDashboard()}>
                Try again
              </button>
            )}
          </section>
        </div>
      </div>
    );
  }

  const totalReports = summary?.total_reports ?? 0;
  const isNewReporter = totalReports === 0;
  const actionedReports = summary?.actioned_reports ?? 0;
  const pendingReports = summary?.pending_reports ?? 0;
  const verified = actionedReports;
  const awaitingReview = pendingReports;
  const rejected = Math.max(0, totalReports - actionedReports - pendingReports);

  const reporterBadge = isNewReporter
    ? 'New reporter'
    : actionedReports > 0
      ? 'Verified reporter'
      : 'Active reporter';
  const showVerifiedBadge = !isNewReporter && actionedReports > 0;

  const displayName = displayNameFor(user);

  // Activity snapshot: at most the first three currently loaded reports.
  const activityReports = reports ? reports.reports.slice(0, 3) : [];

  return (
    <div className="ps-contributor-page ps-has-mesh">
      <div className="ps-contributor-inner">
        <header className="ps-contributor-heading">
          <div>
            <h1>Welcome back, {displayName}</h1>
            <p>Civilian Reporter</p>
          </div>
          <span className="ps-contributor-reporter-badge">
            {showVerifiedBadge && <IconShieldCheckFilled size={16} aria-hidden />}
            {reporterBadge}
          </span>
        </header>

        {/* BFP red report CTA — complements the header's "Report a Fire" flow */}
        <Link href="/report" className="ps-btn ps-btn-primary ps-contributor-report-cta">
          <IconPlus size={24} aria-hidden className="flex-shrink-0" />
          <span className="flex-1">
            <span className="block">Submit a report</span>
            <span className="block">Your observations drive faster emergency response</span>
          </span>
          <IconArrowRight size={20} aria-hidden className="flex-shrink-0" />
        </Link>

        {error && (
          <div className="ps-alert" role="alert">
            <p>{error.message}</p>
            <button type="button" onClick={() => void loadDashboard()}>
              Retry dashboard
            </button>
          </div>
        )}

        {/* Exactly two stat cards: report count and verification status */}
        <section className="ps-contributor-stats" aria-labelledby="summary-heading">
          <h2 id="summary-heading" className="ps-visually-hidden">
            Contributor summary
          </h2>

          <div className="ps-contributor-stat-card">
            <p className="ps-contributor-stat-label">Reports you filed</p>
            <p className="ps-contributor-stat-value">{summary?.total_reports ?? '—'}</p>
            <p className="ps-contributor-stat-detail">
              {summary?.active_months ? `${summary.active_months} mo active` : 'Lifetime'}
            </p>
          </div>

          <div className="ps-contributor-stat-card">
            <p className="ps-contributor-stat-label">Verification status</p>
            <p className="ps-contributor-stat-value">
              {summary?.actioned_reports ?? '—'}
              {verifiedPct !== null && <span className="ps-secondary"> ({verifiedPct}%)</span>}
            </p>
            {totalReports === 0 ? (
              <p className="ps-contributor-stat-detail">No reports yet</p>
            ) : (
              <div className="ps-contributor-status-breakdown">
                <div className="ps-contributor-status-bar" role="img" aria-label={`${verified} verified, ${awaitingReview} awaiting review, ${rejected} rejected`}>
                  {verified > 0 && (
                    <span className="ps-contributor-status-segment ps-contributor-tone-verified" style={{ flexGrow: verified }} />
                  )}
                  {awaitingReview > 0 && (
                    <span className="ps-contributor-status-segment ps-contributor-tone-review" style={{ flexGrow: awaitingReview }} />
                  )}
                  {rejected > 0 && (
                    <span className="ps-contributor-status-segment ps-contributor-tone-rejected" style={{ flexGrow: rejected }} />
                  )}
                </div>
                <ul className="ps-contributor-status-legend">
                  <li className="ps-contributor-status-key">
                    <span className="ps-contributor-status-dot ps-contributor-tone-verified" aria-hidden />
                    {verified} Verified
                  </li>
                  <li className="ps-contributor-status-key">
                    <span className="ps-contributor-status-dot ps-contributor-tone-review" aria-hidden />
                    {awaitingReview} Awaiting review
                  </li>
                  <li className="ps-contributor-status-key">
                    <span className="ps-contributor-status-dot ps-contributor-tone-rejected" aria-hidden />
                    {rejected} Rejected
                  </li>
                </ul>
              </div>
            )}
          </div>
        </section>

        {/* Impact strip — truthful generic claim derived from the report count */}
        <div className="ps-contributor-impact">
          <IconFlameFilled size={20} aria-hidden className="flex-shrink-0" />
          <span>
            {totalReports > 0
              ? `Your ${totalReports} report${totalReports === 1 ? '' : 's'} help BFP assess fire activity and community safety.`
              : 'Submit your first report to help BFP assess fire activity and community safety.'}
          </span>
        </div>

        {!isNewReporter && (
          <section className="ps-contributor-section" aria-labelledby="activity-heading">
            <h2 id="activity-heading" className="ps-contributor-section-heading">
              Activity
            </h2>
            <div className="ps-contributor-activity-feed">
              {activityReports.map((report) => {
                const indicator = reportStatusIndicator(report.status);
                const title = report.sub_category ?? report.category ?? 'Report';
                return (
                  <div key={report.report_id} className="ps-contributor-activity-group">
                    <div className="ps-contributor-activity-head">
                      <h3 className="ps-contributor-activity-title">{title}</h3>
                      <span className="ps-contributor-activity-meta">#{report.report_id}</span>
                    </div>
                    <ul className="ps-contributor-timeline">
                      <li className="ps-contributor-timeline-item">
                        <span className="ps-contributor-status-dot" aria-hidden />
                        Report received {formatDate(report.created_at)}
                      </li>
                      <li className="ps-contributor-timeline-item">
                        <span className={`ps-contributor-status-dot ${indicator.toneClass}`} aria-hidden />
                        Current status: {indicator.label}
                      </li>
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {isNewReporter ? (
          <section className="ps-contributor-section" aria-labelledby="reports-heading">
            <h2 id="reports-heading" className="ps-contributor-section-heading">
              Your reports
            </h2>
            <div className="ps-empty">
              <div className="ps-empty-icon">
                <IconInbox size={32} aria-hidden />
              </div>
              <h3 className="ps-empty-title">Welcome, civilian reporter</h3>
              <p className="ps-empty-text">
                Submit your first field report to activate your dashboard. Your report history and
                verification status will appear here.
              </p>
            </div>
          </section>
        ) : (
          <section className="ps-contributor-section" aria-labelledby="reports-heading">
            <div className="ps-contributor-heading">
              <h2 id="reports-heading" className="ps-contributor-section-heading">
                Your reports
              </h2>
              <div className="ps-contributor-filter-tabs" role="group" aria-label="Filter reports">
                {(['all', 'pending', 'resolved'] as ReportFilter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={reportFilter === f}
                    onClick={() => setReportFilter(f)}
                    className="ps-contributor-filter-tab"
                  >
                    {f === 'all' ? 'All' : f === 'pending' ? 'Pending' : 'Resolved'}
                  </button>
                ))}
              </div>
            </div>

            {reportsBusy && (
              <p className="ps-status-msg" role="status">
                Loading reports…
              </p>
            )}
            {!reportsBusy && visibleReports.length === 0 && (
              <p className="ps-secondary">No reports match this filter.</p>
            )}
            {!reportsBusy && visibleReports.length > 0 && (
              <ul className="ps-contributor-report-list">
                {visibleReports.map((report) => {
                  const indicator = reportStatusIndicator(report.status);
                  return (
                    <li key={report.report_id} className="ps-contributor-report-row">
                      <span className={`ps-contributor-status-dot ${indicator.toneClass}`} aria-hidden />
                      <span className="ps-contributor-report-id">#{report.report_id}</span>
                      <span className="ps-contributor-report-main">
                        <span className="ps-contributor-report-title">
                          {report.sub_category ?? report.category ?? 'Report'}
                        </span>
                        <span className="ps-contributor-report-meta">{formatDate(report.created_at)}</span>
                      </span>
                      <span className="ps-contributor-report-category">
                        {report.category ?? '—'}
                        {report.sub_category ? ` · ${report.sub_category}` : ''}
                      </span>
                      <span className={`ps-pill ${indicator.pillClass}`}>{indicator.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {reports && reports.pages > 1 && (
              <nav className="ps-contributor-pagination" aria-label="Report pages">
                <button type="button" disabled={page <= 1 || reportsBusy} onClick={() => void loadReports(page - 1)}>
                  Previous
                </button>
                <span className="ps-contributor-page-status" aria-live="polite">
                  Page {page} of {reports.pages}
                </span>
                <button type="button" disabled={page >= reports.pages || reportsBusy} onClick={() => void loadReports(page + 1)}>
                  Next
                </button>
              </nav>
            )}
          </section>
        )}

        {/* Compact nearby-activity map — same component as the landing page (#612),
            rendered at a smaller viewport per the IA spec's "compact" requirement. */}
        <section className="ps-contributor-section" aria-labelledby="nearby-map-heading">
          <h2 id="nearby-map-heading" className="ps-contributor-section-heading">
            Nearby activity
          </h2>
          <PublicFireMap height={220} zoom={11} showStations className="ps-contributor-map" />
        </section>
      </div>
    </div>
  );
}
