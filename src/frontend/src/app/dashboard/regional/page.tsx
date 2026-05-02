'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { RefreshCw, Flame, Building2, TreePine, Car, ChevronLeft, ChevronRight, Trees } from 'lucide-react';
import { fetchRegionalIncidents, fetchRegionalStats, type RegionalIncidentListItem } from '@/lib/api';
import Link from 'next/link';
import {
  REGIONAL_INCIDENT_GENERAL_CATEGORIES,
  REGIONAL_PAGE_SIZE_OPTIONS,
  REGIONAL_VERIFICATION_STATUSES,
  clampRegionalPageSize,
  offsetFromPage,
  totalRegionalPages,
} from '@/lib/regional-incidents';

interface RegionalStatsPayload {
  total_incidents?: number;
  by_category?: Array<{ category: string | null; count: number }>;
  by_status?: Array<{ status: string; count: number }>;
  wildland_total?: number;
  by_wildland_type?: Array<{ fire_type: string | null; count: number }>;
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
  }, [pageIndex, pageSize, categoryFilter, statusFilter]);

  useEffect(() => {
    if (canAccessRegional) {
      loadStats().catch(() => {
        /* stats errors surface via empty cards */
      });
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
        Loading Regional Dashboard...
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

  const rejectedCount = stats?.by_status?.find((s) => s.status === 'REJECTED')?.count ?? 0;

  const summaryCards = [
    { key: 'total', title: 'Total Incidents', icon: Flame, value: stats?.total_incidents?.toLocaleString() ?? '0', borderColor: '#dc2626' },
    { key: 'STRUCTURAL', title: 'Structural', icon: Building2, value: stats?.by_category?.find((c) => c.category === 'STRUCTURAL')?.count.toLocaleString() ?? '0', borderColor: '#f97316' },
    { key: 'NON_STRUCTURAL', title: 'Non-Structural', icon: TreePine, value: stats?.by_category?.find((c) => c.category === 'NON_STRUCTURAL')?.count.toLocaleString() ?? '0', borderColor: '#22c55e' },
    { key: 'VEHICULAR', title: 'Vehicular', icon: Car, value: stats?.by_category?.find((c) => c.category === 'VEHICULAR')?.count.toLocaleString() ?? '0', borderColor: '#3b82f6' },
    { key: 'WILDLAND', title: 'Wildland Fire', icon: Trees, value: stats?.wildland_total?.toLocaleString() ?? '0', borderColor: '#92400e' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Regional Dashboard
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Overview of your incident workload
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => refreshAll()}
            disabled={statsRefreshing || incidentsLoading}
            className={`card flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors hover:bg-gray-50 ${statsRefreshing || incidentsLoading ? 'opacity-70' : ''}`}
          >
            <RefreshCw className={`h-4 w-4 ${statsRefreshing ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
          <Link
            href="/afor/import"
            className="card flex items-center gap-2 px-3 py-2 text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: 'var(--bfp-maroon)' }}
          >
            Import AFOR
          </Link>
        </div>
      </div>

      {rejectedCount > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
          <span className="font-semibold">
            {rejectedCount} incident{rejectedCount > 1 ? 's were' : ' was'} rejected by a validator.
          </span>{' '}
          Review the rejection reasons and resubmit.{' '}
          <button
            type="button"
            className="ml-1 underline font-medium hover:text-red-700"
            onClick={() => { setStatusFilter('REJECTED'); setPageIndex(0); }}
          >
            Show rejected
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        {summaryCards.map((card) => {
          const IconComp = card.icon;
          return (
            <div
              key={card.key}
              className="card overflow-hidden transition-all duration-200 hover:shadow-md"
              style={{ borderLeft: `4px solid ${card.borderColor}` }}
            >
              <div className="flex items-start justify-between p-4">
                <div>
                  <div
                    className="mb-1 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {card.title}
                  </div>
                  <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    {card.value}
                  </div>
                </div>
                <div className="opacity-20" style={{ color: card.borderColor }}>
                  <IconComp className="h-8 w-8" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <section className="card" aria-labelledby="region-incidents-heading">
        <div className="card-header flex flex-col gap-3">
          <div>
            <h2 id="region-incidents-heading" className="font-bold">
              Your incidents
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              All incidents you encoded with server-driven total count, filters, and pagination.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
              Classification
              <select
                className="card min-w-[10rem] rounded border border-gray-200 px-2 py-1.5 text-sm"
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setPageIndex(0);
                }}
                disabled={incidentsLoading}
              >
                <option value="">All classifications</option>
                {REGIONAL_INCIDENT_GENERAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c === 'NON_STRUCTURAL' ? 'Non-Structural' : c.charAt(0) + c.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
              Verification status
              <select
                className="card min-w-[10rem] rounded border border-gray-200 px-2 py-1.5 text-sm"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPageIndex(0);
                }}
                disabled={incidentsLoading}
              >
                <option value="">All statuses</option>
                {REGIONAL_VERIFICATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
              Per page
              <select
                className="card min-w-[5rem] rounded border border-gray-200 px-2 py-1.5 text-sm"
                value={String(size)}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPageIndex(0);
                }}
                disabled={incidentsLoading}
              >
                {REGIONAL_PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => {
                setCategoryFilter('');
                setStatusFilter('');
                setPageIndex(0);
              }}
              disabled={incidentsLoading || (!categoryFilter && !statusFilter)}
            >
              Clear filters
            </button>
          </div>

          <p className="text-sm text-gray-600" aria-live="polite">
            {incidentsLoading
              ? 'Loading incidents…'
              : `Showing ${fromRow}–${toRow} of ${incidentsTotal.toLocaleString()} (page ${pageIndex + 1} of ${pages})`}
          </p>
        </div>

        {incidentsError && (
          <div className="border-t border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {incidentsError}
          </div>
        )}

        <div className="card-body overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-700">
              <tr>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Classification</th>
                <th className="px-6 py-3">Station</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {incidentsLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                    Loading incidents…
                  </td>
                </tr>
              ) : incidents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                    {incidentsError ? 'Could not load incidents.' : 'No incidents match the current filters.'}
                  </td>
                </tr>
              ) : (
                incidents.map((inc) => (
                  <tr key={inc.incident_id} className="border-b bg-white hover:bg-gray-50">
                    <td className="px-6 py-4">
                      {(() => {
                        const raw = inc.notification_dt || inc.created_at;
                        if (!raw) return '—';
                        const d = new Date(raw);
                        return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
                      })()}
                    </td>
                    <td className="px-6 py-4 font-medium">
                      <div className="flex items-center gap-2">
                        {inc.general_category ?? '—'}
                        {inc.is_wildland && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                            Wildland
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-500">{inc.fire_station_name || 'N/A'}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          inc.verification_status === 'VERIFIED'
                            ? 'bg-green-100 text-green-800'
                            : inc.verification_status === 'REJECTED'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {inc.verification_status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/dashboard/regional/incidents/${inc.incident_id}`}
                        className="inline-flex rounded text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        aria-label={`View incident ${inc.incident_id}`}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3">
          <span className="text-sm text-gray-600">
            Total: <strong>{incidentsTotal.toLocaleString()}</strong>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="card inline-flex items-center gap-1 rounded px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              disabled={!canPrev}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Prev
            </button>
            <span className="text-sm tabular-nums text-gray-700">
              Page {pageIndex + 1} / {pages}
            </span>
            <button
              type="button"
              className="card inline-flex items-center gap-1 rounded px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
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

      {/* Wildland Fire Classifications Breakdown */}
      {stats && (stats.wildland_total ?? 0) > 0 && (
        <section className="card" aria-labelledby="wildland-breakdown-heading">
          <div className="card-header flex items-center justify-between px-4 py-3 border-b">
            <div>
              <h2 id="wildland-breakdown-heading" className="font-bold">
                Wildland Fire Classifications
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                Breakdown by wildland fire type (Wildland Fire AFOR)
              </p>
            </div>
            <span className="text-2xl font-bold" style={{ color: '#92400e' }}>
              {stats.wildland_total?.toLocaleString() ?? '0'}
            </span>
          </div>
          <div className="card-body p-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {[
                { type: 'fire', label: 'Fire', color: '#dc2626' },
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
                    className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 transition-all hover:shadow-sm"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: color }}
                    >
                      {count}
                    </div>
                    <span className="text-sm font-medium text-gray-700">{label}</span>
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
