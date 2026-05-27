'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  RefreshCw, Flame, Building2, TreePine, Car, ChevronLeft, ChevronRight, Trees,
  Home, Users, Layers, Truck, FileText, Upload,
} from 'lucide-react';
import { fetchRegionalIncidents, fetchRegionalStats, type RegionalIncidentListItem } from '@/lib/api';
import Link from 'next/link';
import {
  REGIONAL_INCIDENT_GENERAL_CATEGORIES,
  REGIONAL_PAGE_SIZE_OPTIONS,
  clampRegionalPageSize,
  offsetFromPage,
  totalRegionalPages,
} from '@/lib/regional-incidents';
import { formatClassification } from '@/lib/afor-utils';

interface RegionalStatsPayload {
  total_incidents?: number;
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

// Format date as "Mar 28 • 16:36" (no year, bullet separator)
function formatIncidentDate(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  const month = d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short' });
  const day = d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', day: 'numeric' });
  const time = d.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `${month} ${day} • ${time}`;
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
  { label: 'All Time', value: 'all' },
] as const;

type DateFilterValue = (typeof DATE_FILTERS)[number]['value'];
type DateBasisValue = 'modified' | 'fire';

const DATE_BASIS_OPTIONS: Array<{ label: string; value: DateBasisValue }> = [
  { label: 'Date Modified', value: 'modified' },
  { label: 'Date of Fire', value: 'fire' },
];

interface HoverHint {
  id: number;
  x: number;
  y: number;
}

function manilaTodayUtcDate(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getRegionalDateBounds(filter: DateFilterValue): { date_from?: string; date_to?: string } {
  if (filter === 'all') return {};
  const today = manilaTodayUtcDate();
  if (filter === 'today') return { date_from: dateOnly(today), date_to: dateOnly(today) };
  if (filter === 'week') {
    const day = today.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    return { date_from: dateOnly(addUtcDays(today, mondayOffset)), date_to: dateOnly(addUtcDays(today, mondayOffset + 6)) };
  }
  if (filter === 'month') {
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    return { date_from: dateOnly(first), date_to: dateOnly(last) };
  }
  const first = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  const last = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
  return { date_from: dateOnly(first), date_to: dateOnly(last) };
}

function displayValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function completeAddress(incident: RegionalIncidentListItem): string {
  return [incident.street_address, incident.location_display].filter(Boolean).join(', ') || '-';
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
  const [dateBasis, setDateBasis] = useState<DateBasisValue>('modified');
  const [hoverHint, setHoverHint] = useState<HoverHint | null>(null);
  const hoverHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dateBounds = useMemo(() => getRegionalDateBounds(dateFilter), [dateFilter]);

  const updateFiltersWithoutScrollShift = useCallback((update: () => void) => {
    const x = window.scrollX;
    const y = window.scrollY;
    update();
    requestAnimationFrame(() => window.scrollTo(x, y));
  }, []);

  const clearHoverHint = useCallback(() => {
    if (hoverHintTimer.current) {
      clearTimeout(hoverHintTimer.current);
      hoverHintTimer.current = null;
    }
    setHoverHint(null);
  }, []);

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
    const statsData = await fetchRegionalStats();
    setStats(statsData);
  }, []);

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
        date_basis: dateBasis,
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
  }, [pageIndex, pageSize, categoryFilter, statusFilter, dateBounds.date_from, dateBounds.date_to, dateBasis]);

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
  const isTodayView = dateFilter === 'today';

  const rejectedCount = stats?.by_status?.find((s) => s.status === 'REJECTED')?.count ?? 0;

  const incidentCards = [
    {
      key: 'total',
      title: 'Total Incidents',
      icon: Flame,
      value: stats?.total_incidents?.toLocaleString() ?? '0',
      iconBg: '#FEE2E2',
      iconColor: '#C62828',
    },
    {
      key: 'STRUCTURAL',
      title: 'Structural',
      icon: Building2,
      value: stats?.by_category?.find((c) => c.category === 'STRUCTURAL')?.count.toLocaleString() ?? '0',
      iconBg: '#FEF3C7',
      iconColor: '#D97706',
    },
    {
      key: 'NON_STRUCTURAL',
      title: 'Non-Structural',
      icon: TreePine,
      value: stats?.by_category?.find((c) => c.category === 'NON_STRUCTURAL')?.count.toLocaleString() ?? '0',
      iconBg: '#DCFCE7',
      iconColor: '#16A34A',
    },
    {
      key: 'VEHICULAR',
      title: 'Vehicular',
      icon: Car,
      value: stats?.by_category?.find((c) => c.category === 'VEHICULAR')?.count.toLocaleString() ?? '0',
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
            style={{ backgroundColor: 'var(--bfp-red)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bfp-red-dark)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bfp-red)'; }}
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

      {/* ── Rejection alert ── */}
      {rejectedCount > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
          <span className="font-semibold">
            {rejectedCount} incident{rejectedCount > 1 ? 's were' : ' was'} rejected by a validator.
          </span>{' '}
          Review the rejection reasons and resubmit.{' '}
          <button
            type="button"
            className="ml-1 underline font-medium hover:text-red-700"
            onClick={() => updateFiltersWithoutScrollShift(() => { setStatusFilter('REJECTED'); setPageIndex(0); })}
          >
            Show rejected
          </button>
        </div>
      )}

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
                Click a row to view details, edit drafts, or resubmit rejected incidents.
              </p>
            </div>
            <p className="text-sm whitespace-nowrap" style={{ color: 'var(--text-secondary)' }} aria-live="polite">
              {incidentsLoading
                ? 'Loading…'
                : `${fromRow}–${toRow} of ${incidentsTotal.toLocaleString()}`}
            </p>
          </div>

          {/* Status filter chips */}
          <div className="flex flex-wrap gap-2 mt-4">
            {STATUS_CHIPS.map((chip) => {
              const active = statusFilter === chip.value;
              return (
                <button
                  key={chip.value}
                  type="button"
                onClick={() => updateFiltersWithoutScrollShift(() => { setStatusFilter(chip.value); setPageIndex(0); })}
                  disabled={incidentsLoading}
                  className="px-4 py-1.5 rounded-full text-sm font-medium transition-colors disabled:opacity-50"
                  style={active
                    ? { backgroundColor: 'var(--bfp-red)', color: '#fff' }
                    : { backgroundColor: '#fff', border: '1px solid #e5e7eb', color: 'var(--text-secondary)' }
                  }
                  onMouseEnter={(e) => {
                    if (!active) (e.currentTarget as HTMLElement).style.borderColor = 'var(--bfp-red)';
                  }}
                  onMouseLeave={(e) => {
                    if (!active) (e.currentTarget as HTMLElement).style.borderColor = '#e5e7eb';
                  }}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          {/* Secondary filters row */}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <select
              className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium focus:outline-none focus:border-[#C62828] transition-colors"
              style={{ color: 'var(--text-primary)' }}
              value={dateFilter}
              onChange={(e) => updateFiltersWithoutScrollShift(() => { setDateFilter(e.target.value as DateFilterValue); setPageIndex(0); })}
              disabled={incidentsLoading}
            >
              {DATE_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>{filter.label}</option>
              ))}
            </select>

            <select
              className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium focus:outline-none focus:border-[#C62828] transition-colors"
              style={{ color: 'var(--text-primary)' }}
              value={dateBasis}
              onChange={(e) => updateFiltersWithoutScrollShift(() => { setDateBasis(e.target.value as DateBasisValue); setPageIndex(0); })}
              disabled={incidentsLoading}
            >
              {DATE_BASIS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <select
              className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm focus:outline-none focus:border-[#C62828] transition-colors"
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
              className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm focus:outline-none focus:border-[#C62828] transition-colors"
              style={{ color: 'var(--text-primary)' }}
              value={String(size)}
              onChange={(e) => updateFiltersWithoutScrollShift(() => { setPageSize(Number(e.target.value)); setPageIndex(0); })}
              disabled={incidentsLoading}
            >
              {REGIONAL_PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}/page</option>
              ))}
            </select>

            {(categoryFilter || dateFilter !== 'today' || dateBasis !== 'modified') && (
              <button
                type="button"
                className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm font-semibold hover:border-gray-300 transition-colors"
                style={{ color: 'var(--text-primary)' }}
                onClick={() => updateFiltersWithoutScrollShift(() => { setCategoryFilter(''); setDateFilter('today'); setDateBasis('modified'); setPageIndex(0); })}
                disabled={incidentsLoading}
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>

        {incidentsError && (
          <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-800" role="alert">
            {incidentsError}
          </div>
        )}

        {/* Incident list */}
        {isTodayView ? (
          incidentsLoading ? (
            <div className="px-5 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Loading incidents...
            </div>
          ) : incidents.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              {incidentsError ? 'Could not load incidents.' : 'No incidents match the current filters.'}
            </div>
          ) : (
            <div className="grid gap-3 p-5 lg:grid-cols-2">
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
                  className="cursor-pointer rounded-xl border border-gray-200 bg-white p-4 shadow-sm outline-none transition-colors hover:border-red-200 hover:bg-red-50/50 focus-visible:ring-2 focus-visible:ring-[#C62828]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>
                        Last modified
                      </div>
                      <div className="mt-1 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {formatIncidentDate(inc.updated_at)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {formatClassification(inc.general_category)}
                        </span>
                        {inc.is_wildland && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                            Wildland
                          </span>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={inc.verification_status} />
                  </div>

                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <InfoBlock label="Date/Time of Fire" value={formatIncidentDate(inc.notification_dt || inc.created_at)} />
                    <InfoBlock label="Type of Responder" value={inc.responder_type} />
                    <InfoBlock label="Complete Address" value={completeAddress(inc)} />
                    <InfoBlock label="Caller / Reporter Name" value={inc.caller_name} />
                    <InfoBlock label="Caller Contact Number" value={inc.caller_number} />
                    <InfoBlock label="Classification" value={formatClassification(inc.general_category)} />
                    <InfoBlock label="Category / Type" value={inc.sub_category || inc.alarm_level} />
                    <InfoBlock label="Damage Extent" value={inc.extent_of_damage} />
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <MetricPill label="Structures" value={inc.structures_affected} />
                    <MetricPill label="Households" value={inc.households_affected} />
                    <MetricPill label="Families" value={inc.families_affected} />
                    <MetricPill label="Individuals" value={inc.individuals_affected} />
                    <MetricPill label="Vehicles" value={inc.vehicles_affected} />
                  </div>

                  <div className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      Responsible party:
                    </span>{' '}
                    {displayValue(inc.establishment_name || inc.owner_name || inc.caller_name)}
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
                { type: 'fire', label: 'Fire', color: '#C62828' },
                { type: 'agricultural land fire', label: 'Agricultural Fire', color: '#65a30d' },
                { type: 'forest fire', label: 'Forest Fire', color: '#166534' },
                { type: 'grassland fire', label: 'Grassland Fire', color: '#84cc16' },
                { type: 'brush fire', label: 'Brush Fire', color: '#d97706' },
                { type: 'peatland fire', label: 'Peatland Fire', color: '#78350f' },
                { type: 'grazing land fire', label: 'Grazing Land Fire', color: '#a16207' },
                { type: 'mineral land fire', label: 'Mineral Land Fire', color: '#57534e' },
              ].map(({ type, label, color }) => {
                const count = stats.by_wildland_type?.find((w) => (w.fire_type ?? '').toLowerCase() === type)?.count ?? 0;
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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string }> = {
    VERIFIED:  { bg: '#DCFCE7', text: '#15803D' },
    REJECTED:  { bg: '#FEE2E2', text: '#B91C1C' },
    DRAFT:     { bg: '#F3F4F6', text: '#6B7280' },
    PENDING:   { bg: '#FEF9C3', text: '#92400E' },
  };
  const style = styles[status] ?? { bg: '#F3F4F6', text: '#6B7280' };
  return (
    <span
      className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {status}
    </span>
  );
}

function InfoBlock({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>
        {label}
      </div>
      <div className="mt-0.5 font-semibold break-words" style={{ color: 'var(--text-primary)' }}>
        {displayValue(value)}
      </div>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2 text-center">
      <div className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
        {value ?? 0}
      </div>
      <div className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
        {label}
      </div>
    </div>
  );
}
