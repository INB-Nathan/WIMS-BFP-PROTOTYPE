'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  RefreshCw, Flame, Building2, TreePine, Car, ChevronLeft, ChevronRight, Trees,
  Home, Users, Layers, Truck, FileText, Upload, CalendarDays, Archive,
} from 'lucide-react';
import { apiFetch, fetchRegionalStats, type RegionalIncidentListItem } from '@/lib/api';
import { fetchRegionalIncidentsOfflineAware } from '@/lib/api/offlineRegional';
import { useNetworkStatus } from '@/lib/useNetworkStatus';
import { getPendingOps, type OfflineOpDecrypted } from '@/lib/offlineStore';
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
import { formatIncidentDate, isDateOnly, getDateBounds as getDateBoundsUtil, categoryCount } from '@/lib/incident-utils';
import { NotificationToasts } from '@/components/regional/NotificationToasts';
import { IncidentCard } from '@/components/regional/IncidentCard';
import { WildlandFireBreakdown } from '@/components/regional/WildlandFireBreakdown';

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

const getRegionalDateBounds = getDateBoundsUtil;

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
    role === 'ENCODER';

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

  const { isOnline } = useNetworkStatus();
  const [isFromCache, setIsFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | undefined>();
  const [queuedOps, setQueuedOps] = useState<OfflineOpDecrypted[]>([]);

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
  const [isArchiveView, setIsArchiveView] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
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
      const encoderId = (user as { id?: string })?.id ?? '';
      const { response: data, fromCache, cachedAt: cAt } = await fetchRegionalIncidentsOfflineAware(
        {
          limit: size,
          offset,
          category: isArchiveView ? undefined : (categoryFilter || undefined),
          status: isArchiveView ? undefined : (statusFilter || undefined),
          date_from: isArchiveView ? undefined : dateBounds.date_from,
          date_to: isArchiveView ? undefined : dateBounds.date_to,
          archived: isArchiveView || undefined,
        },
        encoderId,
      );
      setIncidents(data.items ?? []);
      setIncidentsTotal(typeof data.total === 'number' ? data.total : 0);
      setIsFromCache(fromCache);
      setCachedAt(cAt);

      // Always surface queued create ops — online or offline — so the encoder
      // can see incidents awaiting sync right in the main list.
      if (encoderId) {
        const ops = await getPendingOps(encoderId);
        setQueuedOps(ops.filter((op) => op.operation === 'create' && op.syncStatus !== 'synced'));
      } else {
        setQueuedOps([]);
      }
    } catch (e) {
      setIncidents([]);
      setIncidentsTotal(0);
      setIncidentsError(e instanceof Error ? e.message : 'Failed to load incidents.');
    } finally {
      setIncidentsLoading(false);
    }
  }, [pageIndex, pageSize, categoryFilter, statusFilter, dateBounds.date_from, dateBounds.date_to, isArchiveView, user]);

  useEffect(() => {
    if (canAccessRegional) {
      loadStats().catch(() => { /* stats errors surface via empty cards */ });
    }
  }, [canAccessRegional, loadStats]);

  useEffect(() => {
    if (canAccessRegional) {
      loadIncidents();
    }
  }, [canAccessRegional, loadIncidents, isOnline]);

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

  const showAllTimeIncidents = () => updateFiltersWithoutScrollShift(() => {
    setDateFilter('all');
    setSpecificDate('');
    setSpecificDateDraft('');
    setPageIndex(0);
  });

  const doEncoderArchive = async (incidentId: number, e: MouseEvent) => {
    e.stopPropagation();
    setArchiveError(null);
    try {
      await apiFetch(`/regional/incidents/${incidentId}/archive`, { method: 'PATCH' });
      await loadIncidents();
    } catch (err: unknown) {
      setArchiveError(err instanceof Error ? err.message : 'Archive failed');
    }
  };

  const doEncoderUnarchive = async (incidentId: number, e: MouseEvent) => {
    e.stopPropagation();
    setArchiveError(null);
    try {
      await apiFetch(`/regional/incidents/${incidentId}/unarchive`, { method: 'PATCH' });
      await loadIncidents();
    } catch (err: unknown) {
      setArchiveError(err instanceof Error ? err.message : 'Unarchive failed');
    }
  };

  const toggleArchiveView = () => updateFiltersWithoutScrollShift(() => {
    setIsArchiveView((prev) => !prev);
    setStatusFilter('');
    setCategoryFilter('');
    setDateFilter('all');
    setSpecificDate('');
    setSpecificDateDraft('');
    setPageIndex(0);
  });

  const selectStatusFilter = (nextStatus: string) => updateFiltersWithoutScrollShift(() => {
    setStatusFilter(nextStatus);
    setPageIndex(0);
  });

  const showRejectedAndScroll = () => {
    showRejectedFilter();
    setTimeout(() => {
      incidentsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  // Extract display fields from a queued-op payload.
  // Handles both the flat Incident structure from IncidentForm and the nested
  // AFOR row structure ({incident_nonsensitive_details, incident_sensitive_details}).
  const getQueuedOpDisplay = (op: OfflineOpDecrypted) => {
    const p = op.payload as Record<string, unknown>;
    const ns = (p.incident_nonsensitive_details ?? {}) as Record<string, unknown>;
    const sens = (p.incident_sensitive_details ?? {}) as Record<string, unknown>;
    const category = String(ns.general_category ?? p.general_category ?? '—');
    const station = String(ns.fire_station_name ?? p.fire_station_name ?? '—');
    const location = [
      sens.street_address ?? p.street_address,
      ns.city_municipality ?? p.city_municipality,
      ns.province_district ?? p.province_district,
    ].filter(Boolean).join(', ') || '—';
    const savedAt = new Date(op.createdAt).toLocaleString('en-PH', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return { category, station, location, savedAt };
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

      {/* ── Archive error banner ── */}
      {archiveError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {archiveError}
          <button type="button" onClick={() => setArchiveError(null)} className="ml-3 underline text-red-600 hover:text-red-800">Dismiss</button>
        </div>
      )}

      <NotificationToasts
        pendingActionedBanner={pendingActionedBanner}
        rejectedCount={rejectedCount}
        rejectionNoticeDismissed={rejectionNoticeDismissed}
        onDismissPendingActioned={() => setPendingActionedBanner(false)}
        onRefreshAndDismiss={() => { setPendingActionedBanner(false); void refreshAll(); }}
        onDismissRejection={() => setRejectionNoticeDismissed(true)}
        onShowRejected={showRejectedAndScroll}
      />

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

      {/* ── Stale cache banner (offline) ── */}
      {isFromCache && (
        <div
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          role="status"
        >
          <span className="mt-0.5 inline-block h-2 w-2 flex-shrink-0 rounded-full bg-amber-500" />
          <div>
            <span className="font-semibold">Showing cached data</span>
            {cachedAt !== undefined && (
              <span className="ml-1 font-normal">
                — last updated {formatCacheAge(cachedAt)}
              </span>
            )}
            <span className="ml-1 font-normal text-amber-700">
              Reconnect to see the latest incidents.
            </span>
          </div>
        </div>
      )}


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
                {isArchiveView ? 'Archived Incidents' : 'Your Incidents'}
              </h2>
              <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {isArchiveView ? 'Showing incidents that have been archived by a validator.' : 'Click an incident card to view details.'}
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
                      selectStatusFilter(chip.value);
                    }
                  }}
                  disabled={incidentsLoading || isArchiveView}
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
            <div className="flex min-h-[260px] flex-col items-center justify-center px-5 py-14 text-center">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {incidentsError ? 'Could not load incidents.' : 'No incidents found'}
              </p>
              {incidentsError ? (
                <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Try refreshing the dashboard.</p>
              ) : dateFilter !== 'all' ? (
                <>
                  <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Try searching All Time.</p>
                  <button
                    type="button"
                    onClick={showAllTimeIncidents}
                    className="mt-4 inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-900"
                    style={{ backgroundColor: '#991B1B' }}
                  >
                    Search All Time
                  </button>
                </>
              ) : null}
            </div>
          ) : (
            <div className={`grid min-h-[420px] gap-4 p-5 transition-opacity lg:grid-cols-2 ${incidentsLoading ? 'opacity-60' : ''}`}>
              {queuedOps.map((op) => {
                const { category, station, location, savedAt } = getQueuedOpDisplay(op);
                return (
                  <div
                    key={`queued-${op.localId}`}
                    role="button"
                    tabIndex={0}
                    className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 flex flex-col gap-2 cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    title="Edit this locally saved incident"
                    onClick={() => router.push(`/dashboard/regional/incidents/local/${op.localId}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        router.push(`/dashboard/regional/incidents/local/${op.localId}`);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Pending Sync
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{savedAt}</span>
                    </div>
                    <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                      {formatClassification(category)}
                    </div>
                    <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                      {station !== '—' ? `${station} · ` : ''}{location}
                    </div>
                  </div>
                );
              })}
              {incidents.map((inc) => (
                <IncidentCard
                  key={inc.incident_id}
                  inc={inc}
                  isArchiveView={isArchiveView}
                  onCardClick={(id) => router.push(`/dashboard/regional/incidents/${id}`)}
                  onHoverStart={scheduleHoverHint}
                  onHoverMove={hideHoverHintOnMove}
                  onHoverEnd={clearHoverHint}
                  onArchive={doEncoderArchive}
                  onUnarchive={doEncoderUnarchive}
                />
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
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {incidentsLoading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    Loading incidents…
                  </td>
                </tr>
              ) : incidents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12">
                    <div className="flex min-h-[180px] flex-col items-center justify-center text-center">
                      <p className="text-sm font-semibold" style={{ color: incidentsError ? '#991B1B' : 'var(--text-primary)' }}>
                        {incidentsError ? 'Could not load incidents.' : 'No incidents found'}
                      </p>
                      {incidentsError ? (
                        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Try refreshing the dashboard.</p>
                      ) : dateFilter !== 'all' ? (
                        <>
                          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Try searching All Time.</p>
                          <button
                            type="button"
                            onClick={showAllTimeIncidents}
                            className="mt-4 inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-900"
                            style={{ backgroundColor: '#991B1B' }}
                          >
                            Search All Time
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : (
                <>
                {queuedOps.map((op) => {
                  const { category, station, location, savedAt } = getQueuedOpDisplay(op);
                  return (
                    <tr
                      key={`queued-${op.localId}`}
                      className="border-b bg-amber-50/50 cursor-pointer hover:bg-amber-100/70 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400"
                      title="Edit this locally saved incident"
                      tabIndex={0}
                      role="link"
                      aria-label={`Edit local incident (${category})`}
                      onClick={() => router.push(`/dashboard/regional/incidents/local/${op.localId}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          router.push(`/dashboard/regional/incidents/local/${op.localId}`);
                        }
                      }}
                    >
                      <td className="px-5 py-4 whitespace-nowrap text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                        {savedAt}
                      </td>
                      <td className="px-5 py-4">
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                          {formatClassification(category)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {station}
                      </td>
                      <td className="px-5 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {location}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-muted)' }}>
                        {savedAt}
                      </td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                          Pending Sync
                        </span>
                      </td>
                      <td className="px-5 py-4" />
                    </tr>
                  );
                })}
                {incidents.map((inc, idx) => (
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
                    <td className="px-5 py-4 whitespace-nowrap">
                      {inc.verification_status === 'VERIFIED' && (
                        <button
                          type="button"
                          onClick={(e) => isArchiveView
                            ? void doEncoderUnarchive(inc.incident_id, e)
                            : void doEncoderArchive(inc.incident_id, e)
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium transition-colors hover:bg-gray-50"
                          style={{ color: 'var(--text-secondary)' }}
                          title={isArchiveView ? 'Restore this incident to the active list' : 'Archive this verified incident'}
                        >
                          <Archive className="h-3.5 w-3.5" aria-hidden />
                          {isArchiveView ? 'Unarchive' : 'Archive'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
                }</>
              )}
            </tbody>
          </table>
        </div>
        )}

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Total: <strong style={{ color: 'var(--text-primary)' }}>{incidentsTotal.toLocaleString()}</strong>
            </span>
            <button
              type="button"
              onClick={toggleArchiveView}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${isArchiveView ? 'border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
              style={isArchiveView ? {} : { color: 'var(--text-primary)' }}
            >
              <Archive className="h-4 w-4" aria-hidden />
              {isArchiveView ? 'Hide Archive' : 'See Archive'}
            </button>
          </div>
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

      {stats && (stats.wildland_total ?? 0) > 0 && (
        <WildlandFireBreakdown
          wildlandTotal={stats.wildland_total ?? 0}
          byWildlandType={stats.by_wildland_type}
        />
      )}
    </div>
  );
}

function formatCacheAge(cachedAt: number): string {
  const diffMs = Date.now() - cachedAt;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

