'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  RefreshCw, Flame, Building2, TreePine, Car, ChevronLeft, ChevronRight, Trees,
  Home, Users, Layers, Truck, FileText, Upload, X, CalendarDays,
} from 'lucide-react';
import { apiFetch, fetchRegionalIncidents, fetchRegionalStats, type RegionalIncidentListItem } from '@/lib/api';
import Link from 'next/link';
import {
  REGIONAL_INCIDENT_GENERAL_CATEGORIES,
  REGIONAL_PAGE_SIZE_OPTIONS,
  clampRegionalPageSize,
  offsetFromPage,
  totalRegionalPages,
} from '@/lib/regional-incidents';
import { formatClassification } from '@/lib/afor-utils';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { MetricPill } from '@/components/ui/MetricPill';
import { formatIncidentDate, manilaTodayUtcDate, dateOnly, isDateOnly, addUtcDays, getDateBounds as getDateBoundsUtil, displayValue, statusBorderColor, categoryCount } from '@/lib/incident-utils';

interface RegionalStatsPayload {
  total_incidents?: number;
  total_incidents_this_week?: number;
  by_category?: Array<{ category: string | null; count: number }>;
  by_status?: Array<{ status: string; count: number }>;
  wildland_total?: number;
  by_wildland_type?: Array<{ fire_type: string | null; count: number }>;
  structures_affected?: number;
  households_affected?: number;
  families_affected?: number;
  individuals_affected?: number;
  vehicles_affected?: number;
}

// Date utils and display helpers imported from @/lib/incident-utils

const getRegionalDateBounds = getDateBoundsUtil;

function completeAddress(incident: RegionalIncidentListItem): string {
  return incident.street_address || '-';
}

const STATUS_CHIPS = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Verified', value: 'VERIFIED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Drafts', value: 'DRAFT' },
];

const DATE_FILTERS = [
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
  { label: 'This Year', value: 'year' },
  { label: 'Specific Date', value: 'specific' },
  { label: 'All Time', value: 'all' },
] as const;

const STATS_DATE_FILTERS = [
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
  { label: 'All Time', value: 'all' },
] as const;

type StatsDateFilterValue = (typeof STATS_DATE_FILTERS)[number]['value'];
type DateFilterValue = (typeof DATE_FILTERS)[number]['value'];

interface HoverHint {
  id: number;
  x: number;
  y: number;
}


export default function RegionalDashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const role = (user as { role?: string })?.role ?? null;
  const canAccessRegional =
    role === 'REGIONAL_ENCODER' ||
    role === 'NATIONAL_VALIDATOR' ||
    role === 'ENCODER' ||
    role === 'VALIDATOR';

  useEffect(() => {
    if (!loading && !canAccessRegional) {
      router.replace('/dashboard');
    }
  }, [loading, canAccessRegional, router]);

  const [stats, setStats] = useState<RegionalStatsPayload | null>(null);
  const [incidents, setIncidents] = useState<RegionalIncidentListItem[]>([]);
  const [incidentsTotal, setIncidentsTotal] = useState(0);
  const [statsRefreshing, setStatsRefreshing] = useState(false);
  const [incidentsLoading, setIncidentsLoading] = useState(false);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilterValue>('today');
  const [specificDate, setSpecificDate] = useState('');
  const [specificDateDraft, setSpecificDateDraft] = useState('');
  const [statsDateFilter, setStatsDateFilter] = useState<StatsDateFilterValue>('week');
  const [rejectionNoticeDismissed, setRejectionNoticeDismissed] = useState(false);
  const [pendingActionedBanner, setPendingActionedBanner] = useState(false);
  const lastKnownPendingCountRef = useRef<number | null>(null);
  const [hoverHint, setHoverHint] = useState<HoverHint | null>(null);
  const hoverHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const incidentsSectionRef = useRef<HTMLElement | null>(null);
  const dateBounds = useMemo(() => getRegionalDateBounds(dateFilter, specificDate), [dateFilter, specificDate]);
  const statsDateBounds = useMemo(() => getRegionalDateBounds(statsDateFilter, ''), [statsDateFilter]);
  const specificDateDraftIsValid = isDateOnly(specificDateDraft);

  const updateFiltersWithoutScrollShift = useCallback((update: () => void) => {
    const x = window.scrollX;
    const y = window.scrollY;
    update();
    const restore = () => {
      if (Math.abs(window.scrollY - y) > 1 || Math.abs(window.scrollX - x) > 1) {
        window.scrollTo({ left: x, top: y, behavior: 'auto' });
      }
    };
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
  }, []);

  const clearHoverHint = useCallback(() => {
    if (hoverHintTimer.current) {
      clearTimeout(hoverHintTimer.current);
      hoverHintTimer.current = null;
    }
    setHoverHint(null);
  }, []);

  const applySpecificDateFilter = useCallback(() => {
    if (!specificDateDraftIsValid) return;
    updateFiltersWithoutScrollShift(() => {
      setSpecificDate(specificDateDraft);
      setDateFilter('specific');
      setPageIndex(0);
    });
  }, [specificDateDraft, specificDateDraftIsValid, updateFiltersWithoutScrollShift]);

  const scheduleHoverHint = useCallback((id: number, event: MouseEvent<HTMLElement>) => {
    if (hoverHintTimer.current) clearTimeout(hoverHintTimer.current);
    const { clientX, clientY } = event;
    hoverHintTimer.current = setTimeout(() => {
      setHoverHint({ id, x: clientX, y: clientY });
      hoverHintTimer.current = null;
    }, 2000);
  }, []);

  const hideHoverHintOnMove = useCallback(() => {
    if (hoverHintTimer.current) {
      clearTimeout(hoverHintTimer.current);
      hoverHintTimer.current = null;
    }
    if (hoverHint) setHoverHint(null);
  }, [hoverHint]);

  useEffect(() => () => {
    if (hoverHintTimer.current) clearTimeout(hoverHintTimer.current);
  }, []);

  const loadStats = useCallback(async () => {
    const statsData = await fetchRegionalStats(statsDateBounds);
    setStats(statsData);
  }, [statsDateBounds]);

  const loadIncidents = useCallback(async () => {
    setIncidentsLoading(true);
    setIncidentsError(null);
    try {
      const size = clampRegionalPageSize(pageSize);
      const offset = offsetFromPage(pageIndex, size);
      const data = await fetchRegionalIncidents({
        limit: size,
        offset,
        category: categoryFilter || undefined,
        status: statusFilter || undefined,
        date_from: dateBounds.date_from,
        date_to: dateBounds.date_to,
      });
      setIncidents(data.items ?? []);
      setIncidentsTotal(typeof data.total === 'number' ? data.total : 0);
    } catch (e) {
      setIncidents([]);
      setIncidentsTotal(0);
      setIncidentsError(e instanceof Error ? e.message : 'Failed to load incidents.');
    } finally {
      setIncidentsLoading(false);
    }
  }, [pageIndex, pageSize, categoryFilter, statusFilter, dateBounds.date_from, dateBounds.date_to]);

  useEffect(() => {
    if (canAccessRegional) {
      loadStats().catch(() => { /* stats errors surface via empty cards */ });
    }
  }, [canAccessRegional, loadStats]);

  useEffect(() => {
    if (canAccessRegional) {
      loadIncidents();
    }
  }, [canAccessRegional, loadIncidents]);

  // Background poll: detect when a PENDING submission is actioned by a validator.
  // Compares the PENDING total every 20 s; if it drops, something was resolved.
  useEffect(() => {
    if (!canAccessRegional) return;
    const checkPending = async () => {
      try {
        const data = await apiFetch<{ total: number }>(`/regional/incidents?status=PENDING&limit=1&offset=0`);
        if (
          lastKnownPendingCountRef.current !== null &&
          data.total < lastKnownPendingCountRef.current
        ) {
          setPendingActionedBanner(true);
        }
        lastKnownPendingCountRef.current = data.total;
      } catch { /* non-critical */ }
    };
    const id = setInterval(checkPending, 20_000);
    return () => clearInterval(id);
  }, [canAccessRegional]);

  const refreshAll = async () => {
    setStatsRefreshing(true);
    try {
      await Promise.all([loadStats(), loadIncidents()]);
    } finally {
      setStatsRefreshing(false);
    }
  };

  if (loading || !canAccessRegional) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-500">
        Loading Dashboard…
      </div>
    );
  }

  const size = clampRegionalPageSize(pageSize);
  const offset = offsetFromPage(pageIndex, size);
  const pages = totalRegionalPages(incidentsTotal, size);
  const fromRow = incidentsTotal === 0 ? 0 : offset + 1;
  const toRow = Math.min(offset + incidents.length, incidentsTotal);
  const canPrev = pageIndex > 0 && !incidentsLoading;
  const canNext = incidentsTotal > 0 && offset + size < incidentsTotal && !incidentsLoading;
  const isTodayView = dateFilter === 'today' || dateFilter === 'specific';
  const useCardView = isTodayView || (!incidentsLoading && incidentsTotal > 0 && incidentsTotal <= 6);

  const rejectedCount = stats?.by_status?.find((s) => s.status === 'REJECTED')?.count ?? 0;
  const showRejectedFilter = () => updateFiltersWithoutScrollShift(() => {
    setStatusFilter('REJECTED');
    setCategoryFilter('');
    setDateFilter('all');
    setSpecificDate('');
    setSpecificDateDraft('');
    setPageIndex(0);
  });

  const showRejectedAndScroll = () => {
    showRejectedFilter();
    setTimeout(() => {
      incidentsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  const incidentCards = [
    {
      key: 'total-period',
      title: 'Total Verified',
      icon: Flame,
      value: stats?.total_incidents?.toLocaleString() ?? '0',
      iconBg: '#FEE2E2',
      iconColor: '#991B1B',
    },
    {
      key: 'STRUCTURAL',
      title: 'Structural',
      icon: Building2,
      value: categoryCount(stats, ['STRUCTURAL', 'Structural']),
      iconBg: '#FEF3C7',
      iconColor: '#D97706',
    },
    {
      key: 'NON_STRUCTURAL',
      title: 'Non-Structural',
      icon: TreePine,
      value: categoryCount(stats, ['NON_STRUCTURAL', 'NON-STRUCTURAL', 'Non-Structural']),
      iconBg: '#DCFCE7',
      iconColor: '#16A34A',
    },
    {
      key: 'VEHICULAR',
      title: 'Vehicular',
      icon: Car,
      value: categoryCount(stats, ['VEHICULAR', 'TRANSPORTATION', 'Vehicular', 'Transportation']),
      iconBg: '#DBEAFE',
      iconColor: '#2563EB',
    },
    {
      key: 'WILDLAND',
      title: 'Wildland Fire',
      icon: Trees,
      value: stats?.wildland_total?.toLocaleString() ?? '0',
      iconBg: '#FEF9C3',
      iconColor: '#92400E',
    },
  ];

  const affectedCards = [
    {
      key: 'structures',
      title: 'Structures',
      icon: Layers,
      value: stats?.structures_affected?.toLocaleString() ?? '0',
      iconBg: '#F3E8FF',
      iconColor: '#7C3AED',
    },
    {
      key: 'households',
      title: 'Households',
      icon: Home,
      value: stats?.households_affected?.toLocaleString() ?? '0',
      iconBg: '#FCE7F3',
      iconColor: '#BE185D',
    },
    {
      key: 'families',
      title: 'Families',
      icon: Users,
      value: stats?.families_affected?.toLocaleString() ?? '0',
      iconBg: '#E0F2FE',
      iconColor: '#0369A1',
    },
    {
      key: 'individuals',
      title: 'Individuals',
      icon: Users,
      value: stats?.individuals_affected?.toLocaleString() ?? '0',
      iconBg: '#ECFDF5',
      iconColor: '#047857',
    },
    {
      key: 'vehicles',
      title: 'Vehicles',
      icon: Truck,
      value: stats?.vehicles_affected?.toLocaleString() ?? '0',
      iconBg: '#FFF7ED',
      iconColor: '#C2410C',
    },
  ];

  return (
    <div className="space-y-6 pb-8" style={{ backgroundColor: 'var(--content-bg)' }}>

      {/* ── Sticky notification toasts (visible while scrolling) ── */}
      {(pendingActionedBanner || (rejectedCount > 0 && !rejectionNoticeDismissed)) && (
        <div className="sticky top-0 z-40 space-y-2">
          {pendingActionedBanner && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 shadow-md" role="alert">
              <span>
                <span className="font-semibold">A pending submission was actioned by a validator.</span>{' '}
                Refresh to see what changed.
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => { setPendingActionedBanner(false); void refreshAll(); }}
                  className="rounded-lg px-3 py-1 text-xs font-semibold text-white"
                  style={{ backgroundColor: '#1D4ED8' }}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setPendingActionedBanner(false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-blue-700 transition-colors hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  aria-label="Dismiss notification"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          )}
          {rejectedCount > 0 && !rejectionNoticeDismissed && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-md" role="alert">
              <div>
                <span className="font-semibold">
                  {rejectedCount} incident{rejectedCount > 1 ? 's were' : ' was'} rejected by a validator.
                </span>{' '}
                Review the rejection reasons and resubmit.{' '}
                <button
                  type="button"
                  className="ml-1 underline font-medium hover:text-red-700"
                  onClick={showRejectedAndScroll}
                >
                  Show rejected
                </button>
              </div>
              <button
                type="button"
                onClick={() => setRejectionNoticeDismissed(true)}
                className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-red-700 transition-colors hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-300"
                aria-label="Dismiss rejection notice"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Page header ── */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1
              className="font-bold leading-tight"
              style={{ fontSize: '32px', color: 'var(--text-primary)' }}
            >
              Dashboard
            </h1>
          </div>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Regional incident workload and submissions.
          </p>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/afor/create"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: '#991B1B' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bfp-red-dark)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#991B1B'; }}
          >
            <FileText className="h-3.5 w-3.5" aria-hidden />
            Manual Entry
          </Link>
          <Link
            href="/afor/import"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
            style={{ borderColor: 'var(--bfp-red)', color: 'var(--bfp-red)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bfp-red-light)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = ''; }}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Import AFOR
          </Link>
          <button
            type="button"
            onClick={() => refreshAll()}
            disabled={statsRefreshing || incidentsLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${statsRefreshing ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Stats period filter ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          Stats:
        </span>
        {STATS_DATE_FILTERS.map((f) => {
          const active = statsDateFilter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatsDateFilter(f.value)}
              className="rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
              style={active
                ? { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5', color: '#991B1B' }
                : { backgroundColor: '#fff', borderColor: '#e5e7eb', color: 'var(--text-secondary)' }
              }
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* ── Incident type stats ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {incidentCards.map((card) => {
          const IconComp = card.icon;
          return (
            <div
              key={card.key}
              className="bg-white rounded-2xl p-4 flex flex-col gap-3 transition-shadow hover:shadow-md"
              style={{ boxShadow: 'var(--card-shadow)', border: '1px solid var(--border-color)' }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: card.iconBg }}
              >
                <IconComp className="w-5 h-5" style={{ color: card.iconColor }} />
              </div>
              <div>
                <div className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-muted)' }}>
                  {card.title}
                </div>
                <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {card.value}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Affected count stats ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {affectedCards.map((card) => {
          const IconComp = card.icon;
          return (
            <div
              key={card.key}
              className="bg-white rounded-2xl p-4 flex flex-col gap-3 transition-shadow hover:shadow-md"
              style={{ boxShadow: 'var(--card-shadow)', border: '1px solid var(--border-color)' }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: card.iconBg }}
              >
                <IconComp className="w-5 h-5" style={{ color: card.iconColor }} />
              </div>
              <div>
                <div className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-muted)' }}>
                  {card.title}
                </div>
                <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {card.value}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Incidents section ── */}
      <section
        ref={incidentsSectionRef}
        className="rounded-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)', border: '1px solid var(--border-color)' }}
        aria-labelledby="region-incidents-heading"
      >
        {/* Section header */}
        <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 id="region-incidents-heading" className="font-bold text-[20px]" style={{ color: 'var(--text-primary)' }}>
                Your Incidents
              </h2>
              <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                Click an incident card to view details.
              </p>
            </div>
            <p className="text-sm whitespace-nowrap" style={{ color: 'var(--text-secondary)' }} aria-live="polite">
              {incidentsLoading
                ? 'Loading…'
                : `${fromRow}–${toRow} of ${incidentsTotal.toLocaleString()}`}
            </p>
          </div>

          {/* Status filter chips */}
          <div className="mt-4 flex flex-wrap gap-2">
            {STATUS_CHIPS.map((chip) => {
              const active = statusFilter === chip.value;
              return (
                <button
                  key={chip.value}
                  type="button"
                  onClick={() => {
                    if (chip.value === 'REJECTED') {
                      showRejectedFilter();
                    } else {
                      updateFiltersWithoutScrollShift(() => { setStatusFilter(chip.value); setPageIndex(0); });
                    }
                  }}
                  disabled={incidentsLoading}
                  className="relative rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50"
                  style={active
                    ? { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5', color: '#991B1B' }
                    : { backgroundColor: '#fff', borderColor: '#e5e7eb', color: 'var(--text-secondary)' }
                  }
                  onMouseEnter={(e) => {
                    if (!active) (e.currentTarget as HTMLElement).style.borderColor = 'var(--bfp-red)';
                  }}
                  onMouseLeave={(e) => {
                    if (!active) (e.currentTarget as HTMLElement).style.borderColor = '#e5e7eb';
                  }}
                >
                  {chip.label}
                  {chip.value === 'REJECTED' && rejectedCount > 0 && (
                    <span className="absolute -right-2 -top-2 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white ring-2 ring-white">
                      {rejectedCount.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Secondary filters row */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <select
              className="min-h-9 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium transition-colors focus:border-[#C62828] focus:outline-none"
              style={{ color: 'var(--text-primary)' }}
              value={categoryFilter}
              onChange={(e) => updateFiltersWithoutScrollShift(() => { setCategoryFilter(e.target.value); setPageIndex(0); })}
              disabled={incidentsLoading}
            >
              <option value="">Classification</option>
              {REGIONAL_INCIDENT_GENERAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{formatClassification(c)}</option>
              ))}
            </select>

            <select
              className="min-h-9 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium transition-colors focus:border-[#C62828] focus:outline-none"
              style={{ color: 'var(--text-primary)' }}
              value={String(size)}
              onChange={(e) => updateFiltersWithoutScrollShift(() => { setPageSize(Number(e.target.value)); setPageIndex(0); })}
              disabled={incidentsLoading}
            >
              {REGIONAL_PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}/page</option>
              ))}
            </select>

            {(statusFilter || categoryFilter || dateFilter !== 'today' || size !== 10) && (
              <button
                type="button"
                className="min-h-9 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold transition-colors hover:border-gray-300 hover:bg-gray-50"
                style={{ color: 'var(--text-primary)' }}
                onClick={() => updateFiltersWithoutScrollShift(() => {
                  setStatusFilter('');
                  setCategoryFilter('');
                  setDateFilter('today');
                  setSpecificDate('');
                  setSpecificDateDraft('');
                  setPageSize(10);
                  setPageIndex(0);
                })}
                disabled={incidentsLoading}
              >
                Clear Filters
              </button>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-3">
              <select
                className="min-h-9 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium transition-colors focus:border-[#C62828] focus:outline-none"
                style={{ color: 'var(--text-primary)' }}
                value={dateFilter}
                onChange={(e) => updateFiltersWithoutScrollShift(() => {
                  setDateFilter(e.target.value as DateFilterValue);
                  setSpecificDate('');
                  setSpecificDateDraft('');
                  setPageIndex(0);
                })}
                disabled={incidentsLoading}
              >
                {DATE_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>{filter.label}</option>
                ))}
              </select>

              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
                <input
                  type="date"
                  className="min-h-9 rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm font-medium transition-colors focus:border-[#C62828] focus:outline-none"
                  style={{ color: 'var(--text-primary)' }}
                  value={specificDateDraft}
                  onChange={(e) => setSpecificDateDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applySpecificDateFilter();
                    if (e.key === 'Escape') setSpecificDateDraft(specificDate);
                  }}
                  disabled={incidentsLoading}
                  aria-label="Filter by specific modified date"
                  title="Filter by specific modified date"
                />
              </div>

              <button
                type="button"
                className="min-h-9 rounded-lg px-3 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#991B1B' }}
                onClick={applySpecificDateFilter}
                disabled={incidentsLoading || !specificDateDraftIsValid}
              >
                Apply Date
              </button>
            </div>
          </div>
        </div>

        {incidentsError && (
          <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-800" role="alert">
            {incidentsError}
          </div>
        )}

        {/* Incident list */}
        {useCardView ? (
          incidentsLoading && incidents.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Loading incidents...
            </div>
          ) : !incidentsLoading && incidents.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {incidentsError ? 'Could not load incidents.' : 'No incidents found'}
              </p>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {incidentsError ? 'Try refreshing the dashboard.' : 'Adjust the filters or clear them to see more records.'}
              </p>
            </div>
          ) : (
            <div className={`grid min-h-[420px] gap-4 p-5 transition-opacity lg:grid-cols-2 ${incidentsLoading ? 'opacity-60' : ''}`}>
              {incidents.map((inc) => (
                <article
                  key={inc.incident_id}
                  onClick={() => router.push(`/dashboard/regional/incidents/${inc.incident_id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      router.push(`/dashboard/regional/incidents/${inc.incident_id}`);
                    }
                  }}
                  tabIndex={0}
                  role="link"
                  aria-label={`View incident ${inc.incident_id}`}
                  onMouseEnter={(e) => scheduleHoverHint(inc.incident_id, e)}
                  onMouseMove={hideHoverHintOnMove}
                  onMouseLeave={clearHoverHint}
                  className="cursor-pointer rounded-xl border border-gray-200 bg-white p-5 shadow-sm outline-none transition-all hover:border-red-200 hover:bg-red-50/30 hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#C62828]"
                  style={{ borderColor: statusBorderColor(inc.verification_status) }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                      Last modified <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{formatIncidentDate(inc.updated_at)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {inc.is_wildland && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          Wildland
                        </span>
                      )}
                      <StatusBadge status={inc.verification_status} />
                    </div>
                  </div>

                  <div className="mt-4 space-y-4">
                    <div>
                      <InfoBlock
                        label="Date/Time of Fire"
                        value={formatIncidentDate(inc.notification_dt || inc.created_at)}
                        tone="primary"
                      />
                      <div className="mt-3">
                        <InfoBlock label="Location" value={completeAddress(inc)} tone="primary" />
                      </div>
                    </div>

                    <div className="grid gap-x-6 gap-y-3 border-t border-gray-100 pt-4 text-sm sm:grid-cols-2">
                      <InfoBlock label="Classification" value={formatClassification(inc.general_category)} />
                      <InfoBlock label="Category / Type" value={inc.sub_category || inc.alarm_level} />
                      <InfoBlock label="District" value={inc.province_district} />
                      <InfoBlock label="City" value={inc.city_municipality} />
                    </div>

                    <div className="grid gap-x-6 gap-y-3 border-t border-gray-100 pt-4 text-sm sm:grid-cols-2">
                      <InfoBlock label="Responder Type" value={inc.responder_type} />
                      <InfoBlock label="Caller / Contact" value={`${displayValue(inc.caller_name)} / ${displayValue(inc.caller_number)}`} />
                      <div className="sm:col-span-2">
                        <InfoBlock label="Extent of Damage" value={inc.extent_of_damage} />
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                    <MetricPill label="Structures" value={inc.structures_affected} />
                    <MetricPill label="Households" value={inc.households_affected} />
                    <MetricPill label="Families" value={inc.families_affected} />
                    <MetricPill label="Individuals" value={inc.individuals_affected} />
                    <MetricPill label="Vehicles" value={inc.vehicles_affected} />
                  </div>
                </article>
              ))}
            </div>
          )
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr style={{ backgroundColor: '#FAFAFA', borderBottom: '1px solid var(--border-color)' }}>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Date</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Classification</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Station</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Location</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Last Modified</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {incidentsLoading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    Loading incidents…
                  </td>
                </tr>
              ) : incidents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    {incidentsError ? 'Could not load incidents.' : 'No incidents match the current filters.'}
                  </td>
                </tr>
              ) : (
                incidents.map((inc, idx) => (
                  <tr
                    key={inc.incident_id}
                    onClick={() => router.push(`/dashboard/regional/incidents/${inc.incident_id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        router.push(`/dashboard/regional/incidents/${inc.incident_id}`);
                      }
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={`View incident ${inc.incident_id}`}
                    className="cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#C62828] focus-visible:ring-inset"
                    style={{
                      backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bfp-red-light)';
                      scheduleHoverHint(inc.incident_id, e);
                    }}
                    onMouseMove={hideHoverHintOnMove}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA';
                      clearHoverHint();
                    }}
                  >
                    <td className="px-5 py-4 whitespace-nowrap text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {formatIncidentDate(inc.notification_dt || inc.created_at)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                          {formatClassification(inc.general_category)}
                        </span>
                        {inc.is_wildland && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                            Wildland
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <div className="flex items-center gap-2">
                        <span>{inc.fire_station_name || '—'}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {inc.location_display ?? '—'}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {formatIncidentDate(inc.updated_at)}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={inc.verification_status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Total: <strong style={{ color: 'var(--text-primary)' }}>{incidentsTotal.toLocaleString()}</strong>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ color: 'var(--text-primary)' }}
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              disabled={!canPrev}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Prev
            </button>
            <span className="text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>
              {pageIndex + 1} / {pages}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ color: 'var(--text-primary)' }}
              onClick={() => setPageIndex((p) => p + 1)}
              disabled={!canNext}
              aria-label="Next page"
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </section>

      {hoverHint && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg bg-gray-950 px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
          style={{ left: hoverHint.x + 12, top: hoverHint.y + 12 }}
        >
          Click to view
        </div>
      )}

      {/* ── Wildland Fire Breakdown ── */}
      {stats && (stats.wildland_total ?? 0) > 0 && (
        <section
          className="rounded-2xl overflow-hidden"
          style={{ backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)', border: '1px solid var(--border-color)' }}
          aria-labelledby="wildland-breakdown-heading"
        >
          <div className="flex items-center justify-between px-6 py-5 border-b" style={{ borderColor: 'var(--border-color)' }}>
            <div>
              <h2 id="wildland-breakdown-heading" className="font-bold text-[20px]" style={{ color: 'var(--text-primary)' }}>
                Wildland Fire Classifications
              </h2>
              <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                Breakdown by wildland fire type
              </p>
            </div>
            <span className="text-2xl font-bold" style={{ color: '#92400E' }}>
              {stats.wildland_total?.toLocaleString() ?? '0'}
            </span>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {[
                { type: 'fire', label: 'Fire', color: '#991B1B' },
                { type: 'agricultural land fire', label: 'Agricultural Fire', color: '#65a30d' },
                { type: 'forest fire', label: 'Forest Fire', color: '#166534' },
                { type: 'grassland fire', label: 'Grassland Fire', color: '#84cc16' },
                { type: 'brush fire', label: 'Brush Fire', color: '#d97706' },
                { type: 'peatland fire', label: 'Peatland Fire', color: '#78350f' },
                { type: 'grazing land fire', label: 'Grazing Land Fire', color: '#a16207' },
                { type: 'mineral land fire', label: 'Mineral Land Fire', color: '#57534e' },
              ].map(({ type, label, color }) => {
                const count = stats.by_wildland_type?.find((w) => (w.fire_type ?? '').trim().toLowerCase() === type)?.count ?? 0;
                return (
                  <div
                    key={type}
                    className="flex items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5 transition-shadow hover:shadow-sm"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: color }}
                    >
                      {count}
                    </div>
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function InfoBlock({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string | null | undefined;
  tone?: 'default' | 'primary';
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div
        className={`${tone === 'primary' ? 'mt-1 text-base font-semibold' : 'mt-0.5 text-sm font-medium'} break-words leading-relaxed`}
        style={{ color: 'var(--text-primary)' }}
      >
        {displayValue(value)}
      </div>
    </div>
  );
}

