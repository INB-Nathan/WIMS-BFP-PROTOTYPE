'use client';

import { useEffect, useMemo, useState, useCallback, type MouseEvent, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import type { Region } from '@/types/api';
import {
  fetchHeatmapData,
  fetchTrendData,
  fetchComparativeData,
  fetchRegions,
  fetchTypeDistribution,
  fetchResponseTimeByRegion,
  fetchCompareRegions,
  fetchTopN,
  fetchAnalyticsFilterOptions,
  type HeatmapGeoJSON,
  type TrendsResponse,
  type ComparativeResponse,
  type TypeDistributionItem,
  type ResponseTimeRegionItem,
  type CompareRegionItem,
  type TopNItem,
  type AnalystIncidentListParams,
} from '@/lib/api';
import { TrendCharts } from '@/components/analytics/TrendCharts';
import { TypeDistributionChart } from '@/components/analytics/TypeDistributionChart';
import { ResponseTimeChart } from '@/components/analytics/ResponseTimeChart';
import { AnalystIncidentList } from '@/components/analytics/AnalystIncidentList';
import {
  AlertTriangle,
  BarChart3,
  Clock,
  Download,
  FileDown,
  Filter,
  ListChecks,
  MapPinned,
  RefreshCw,
  RotateCcw,
  Search,
  TrendingUp,
} from 'lucide-react';
import { ExportPreviewModal, type ExportFormat } from '@/components/analytics/ExportPreviewModal';
import {
  createAnalystWorkflowTransferUrl,
  type AnalystWorkflowSlug,
} from '@/lib/analyst-workflow-transfer';
import { getShortRegionName, PH_REGIONS } from '@/lib/ph-regions';

const HeatmapViewer = dynamic(
  () => import('@/components/analytics/HeatmapViewer').then((m) => m.HeatmapViewer),
  { ssr: false, loading: () => <div className="h-[400px] rounded-md border border-gray-200 bg-gray-50 flex items-center justify-center text-gray-500">Loading map...</div> }
);

const INCIDENT_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'STRUCTURAL', label: 'Structural' },
  { value: 'NON_STRUCTURAL', label: 'Non-Structural' },
  { value: 'VEHICULAR', label: 'Vehicular' },
];

const ALARM_LEVELS = [
  { value: '', label: 'All Alarms' },
  { value: '1', label: 'Alarm 1' },
  { value: '2', label: 'Alarm 2' },
  { value: '3', label: 'Alarm 3' },
  { value: '4', label: 'Alarm 4' },
  { value: '5', label: 'Alarm 5' },
];

const INTERVALS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const ANALYST_ROLES = ['NATIONAL_ANALYST', 'SYSTEM_ADMIN'];

const WORKFLOW_LINKS = [
  {
    slug: 'comparative',
    href: '/dashboard/analyst/comparative',
    title: 'Comparative',
    description: 'Period variance, calculations, export, and evidence table',
    icon: <BarChart3 className="h-5 w-5" />,
  },
  {
    slug: 'heatmap',
    href: '/dashboard/analyst/heatmap',
    title: 'Heatmap',
    description: 'Map-first geographic review with filtered records',
    icon: <MapPinned className="h-5 w-5" />,
  },
  {
    slug: 'trends',
    href: '/dashboard/analyst/trends',
    title: 'Trends',
    description: 'Interval controls, bucket totals, and incident table',
    icon: <TrendingUp className="h-5 w-5" />,
  },
  {
    slug: 'response-time',
    href: '/dashboard/analyst/response-time',
    title: 'Response Time',
    description: 'Regional min, max, average detail, and export',
    icon: <Clock className="h-5 w-5" />,
  },
  {
    slug: 'top-n',
    href: '/dashboard/analyst/top-n',
    title: 'Top-N Hotspots',
    description: 'Metric and dimension controls for hotspot ranking',
    icon: <ListChecks className="h-5 w-5" />,
  },
  {
    slug: 'incident-explorer',
    href: '/dashboard/analyst/incident-explorer',
    title: 'Incident Explorer',
    description: 'Dedicated verified incident table and detail drawer',
    icon: <Search className="h-5 w-5" />,
  },
];

function FilterField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function PanelHeader({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-gray-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-700">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase text-gray-500">{label}</span>
        <span className="text-red-700">{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-bold text-gray-900">{value}</div>
      <p className="mt-1 text-xs text-gray-500">{detail}</p>
    </div>
  );
}

/** Default comparative windows: last 30 days split into Range A then Range B (ranges may overlap — server does not enforce ordering). */
function initialComparativeRanges(): {
  rangeAStart: string;
  rangeAEnd: string;
  rangeBStart: string;
  rangeBEnd: string;
} {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const mid = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
  const rangeBStart = new Date(mid.getTime() + 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return {
    rangeAStart: fmt(start),
    rangeAEnd: fmt(mid),
    rangeBStart: fmt(rangeBStart),
    rangeBEnd: fmt(end),
  };
}

export default function AnalystDashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const role = (user as { role?: string })?.role ?? null;

  useEffect(() => {
    if (!loading && role && !ANALYST_ROLES.includes(role)) {
      router.replace('/dashboard');
    }
  }, [loading, role, router]);

  const [heatmap, setHeatmap] = useState<HeatmapGeoJSON | null>(null);
  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [comparative, setComparative] = useState<ComparativeResponse | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [regionId, setRegionId] = useState<string>('');
  const [incidentType, setIncidentType] = useState('');
  const [alarmLevel, setAlarmLevel] = useState('');
  const [interval, setInterval] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [regions, setRegions] = useState<Region[]>([]);
  const [province, setProvince] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [provinceOptions, setProvinceOptions] = useState<string[]>([]);
  const [municipalityOptions, setMunicipalityOptions] = useState<string[]>([]);

  const [cmpRanges, setCmpRanges] = useState(() => initialComparativeRanges());

  // AQ-04: Casualty severity filter
  const [casualtySeverity, setCasualtySeverity] = useState('');
  // AQ-05: Damage range filter
  const [damageMin, setDamageMin] = useState('');
  const [damageMax, setDamageMax] = useState('');
  // Export modal state
  const [exportModal, setExportModal] = useState<{ format: ExportFormat; open: boolean } | null>(null);
  // AQ-06: Type distribution
  const [typeDistribution, setTypeDistribution] = useState<TypeDistributionItem[] | null>(null);
  // AQ-08: Response time by region
  const [responseTime, setResponseTime] = useState<ResponseTimeRegionItem[] | null>(null);
  // AQ-13: Cross-region comparison
  const [compareRegions, setCompareRegions] = useState<CompareRegionItem[] | null>(null);
  // AQ-14: Top-N
  const [topNData, setTopNData] = useState<TopNItem[] | null>(null);
  const [topNMetric, setTopNMetric] = useState('incidents');
  const [topNDimension, setTopNDimension] = useState('municipality');
  const [appliedIncidentFilters, setAppliedIncidentFilters] = useState<AnalystIncidentListParams>({});

  type FilterOverrides = {
    startDate?: string;
    endDate?: string;
    regionId?: string;
    province?: string;
    municipality?: string;
    incidentType?: string;
    alarmLevel?: string;
    interval?: 'daily' | 'weekly' | 'monthly';
    rangeAStart?: string;
    rangeAEnd?: string;
    rangeBStart?: string;
    rangeBEnd?: string;
    casualtySeverity?: string;
    damageMin?: string;
    damageMax?: string;
  };

  const loadData = useCallback(async (overrides?: FilterOverrides) => {
    if (!role || !ANALYST_ROLES.includes(role)) return;
    const sd = overrides?.startDate ?? startDate;
    const ed = overrides?.endDate ?? endDate;
    const rid = overrides?.regionId ?? regionId;
    const it = overrides?.incidentType ?? incidentType;
    const al = overrides?.alarmLevel ?? alarmLevel;
    const iv = overrides?.interval ?? interval;
    const raS = overrides?.rangeAStart ?? cmpRanges.rangeAStart;
    const raE = overrides?.rangeAEnd ?? cmpRanges.rangeAEnd;
    const rbS = overrides?.rangeBStart ?? cmpRanges.rangeBStart;
    const rbE = overrides?.rangeBEnd ?? cmpRanges.rangeBEnd;
    const cs = overrides?.casualtySeverity ?? casualtySeverity;
    const dm = overrides?.damageMin ?? damageMin;
    const dx = overrides?.damageMax ?? damageMax;

    setLoadingData(true);
    setError(null);
    setAccessDenied(false);
    try {
      const pv = overrides?.province ?? province;
      const mc = overrides?.municipality ?? municipality;
      const filters = {
        start_date: sd || undefined,
        end_date: ed || undefined,
        region_id: rid ? parseInt(rid, 10) : undefined,
        province: pv || undefined,
        municipality: mc || undefined,
        incident_type: it || undefined,
        alarm_level: al || undefined,
        casualty_severity: cs || undefined,
        damage_min: dm ? parseFloat(dm) : undefined,
        damage_max: dx ? parseFloat(dx) : undefined,
      };
      const comparisonRegionIds = rid
        ? (regions.length >= 2 ? regions.map((r) => r.region_id) : PH_REGIONS.map((r) => r.regionId))
        : [];
      setAppliedIncidentFilters(filters as AnalystIncidentListParams);
      const [heatmapRes, trendsRes, comparativeRes, typeDistRes, respTimeRes, cmpRegionsRes, topNRes] = await Promise.all([
        fetchHeatmapData(filters),
        fetchTrendData({ ...filters, interval: iv }),
        fetchComparativeData({
          range_a_start: raS,
          range_a_end: raE,
          range_b_start: rbS,
          range_b_end: rbE,
          ...filters,
        }),
        fetchTypeDistribution(filters),
        fetchResponseTimeByRegion(filters),
        comparisonRegionIds.length >= 2
          ? fetchCompareRegions({
              ...filters,
              region_id: undefined,
              region_ids: comparisonRegionIds.join(','),
            }).catch(() => [])
          : Promise.resolve([]),
        fetchTopN({ metric: topNMetric, dimension: topNDimension, ...filters }),
      ]);
      setHeatmap(heatmapRes);
      setTrends(trendsRes);
      setComparative(comparativeRes);
      setTypeDistribution(typeDistRes);
      setResponseTime(respTimeRes);
      setCompareRegions(cmpRegionsRes.length >= 2 ? cmpRegionsRes : null);
      setTopNData(topNRes);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/403|NATIONAL_ANALYST|SYSTEM_ADMIN|required|forbidden/i.test(msg)) {
        setAccessDenied(true);
      } else {
        setError('Error loading data. Please try again.');
      }
    } finally {
      setLoadingData(false);
    }
  }, [
    role,
    startDate,
    endDate,
    regionId,
    province,
    municipality,
    incidentType,
    alarmLevel,
    interval,
    cmpRanges,
    casualtySeverity,
    damageMin,
    damageMax,
    topNMetric,
    topNDimension,
    regions,
  ]);

  useEffect(() => {
    if (loading) return;
    fetchRegions().then((r) => setRegions(Array.isArray(r) ? r : []));
  }, [loading]);

  // Cascade: load province options when region changes
  useEffect(() => {
    if (!ANALYST_ROLES.includes(role ?? '')) return;
    fetchAnalyticsFilterOptions('province', {
      region_id: regionId ? parseInt(regionId, 10) : undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
    }).then(setProvinceOptions).catch(() => setProvinceOptions([]));
  }, [loading, regionId, startDate, endDate, role]);

  // Cascade: load municipality options when province changes
  useEffect(() => {
    if (!ANALYST_ROLES.includes(role ?? '')) return;
    if (!province) {
      setMunicipalityOptions([]);
      return;
    }
    fetchAnalyticsFilterOptions('municipality', {
      region_id: regionId ? parseInt(regionId, 10) : undefined,
      province,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
    }).then(setMunicipalityOptions).catch(() => setMunicipalityOptions([]));
  }, [loading, regionId, province, startDate, endDate, role]);

  // Clear municipality when province is cleared
  useEffect(() => {
    if (!province && municipality) setMunicipality('');
  }, [province, municipality]);

  useEffect(() => {
    if (ANALYST_ROLES.includes(role ?? '')) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only; Apply button triggers refresh
  }, [role]);

  const activeFilterCount = [
    startDate,
    endDate,
    regionId,
    province,
    municipality,
    incidentType,
    alarmLevel,
    casualtySeverity,
    damageMin,
    damageMax,
  ].filter(Boolean).length;
  const activeRegionName = regionId
    ? regions.find((r) => String(r.region_id) === regionId)?.region_name ?? `Region ${regionId}`
    : 'All Regions';
  const visibleIncidentCount = typeDistribution?.reduce((sum, item) => sum + item.count, 0)
    ?? heatmap?.features.length
    ?? 0;
  const averageResponseTime = responseTime && responseTime.length > 0
    ? responseTime.reduce((sum, item) => sum + Number(item.avg_response_time || 0), 0) / responseTime.length
    : null;
  const dashboardTransferFilters = useMemo<AnalystIncidentListParams>(() => ({
    start_date: startDate || undefined,
    end_date: endDate || undefined,
    region_id: regionId ? parseInt(regionId, 10) : undefined,
    province: province || undefined,
    municipality: municipality || undefined,
    incident_type: incidentType || undefined,
    alarm_level: alarmLevel || undefined,
    casualty_severity: casualtySeverity ? casualtySeverity as 'high' | 'medium' | 'low' : undefined,
    damage_min: damageMin ? parseFloat(damageMin) : undefined,
    damage_max: damageMax ? parseFloat(damageMax) : undefined,
  }), [
    alarmLevel,
    casualtySeverity,
    damageMax,
    damageMin,
    endDate,
    incidentType,
    municipality,
    province,
    regionId,
    startDate,
  ]);
  const openWorkflow = (event: MouseEvent<HTMLAnchorElement>, workflow: AnalystWorkflowSlug) => {
    event.preventDefault();
    router.push(createAnalystWorkflowTransferUrl(workflow, { filters: dashboardTransferFilters }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-gray-500">
        Loading...
      </div>
    );
  }

  if (role && !ANALYST_ROLES.includes(role)) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-gray-500">
        Redirecting...
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="card p-8 text-center">
        <h2 className="text-lg font-semibold text-red-700 mb-2">Access Denied</h2>
        <p className="text-sm text-gray-600">You do not have permission to view the analyst dashboard.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-gray-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                National Analyst Dashboard
              </h1>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                Analytics ready
              </span>
            </div>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Verified incident intelligence for national trend review, geographic monitoring, and AFOR export.
            </p>
          </div>
          <button
            onClick={() => void loadData()}
            disabled={loadingData}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-70"
          >
            <RefreshCw className={`h-4 w-4 ${loadingData ? 'animate-spin' : ''}`} /> Refresh data
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            icon={<ListChecks className="h-4 w-4" />}
            label="Visible Incidents"
            value={visibleIncidentCount.toLocaleString()}
            detail="Count under the applied dashboard filters"
          />
          <StatTile
            icon={<MapPinned className="h-4 w-4" />}
            label="Scope"
            value={activeRegionName}
            detail={province || municipality ? [province, municipality].filter(Boolean).join(' / ') : 'National coverage'}
          />
          <StatTile
            icon={<Clock className="h-4 w-4" />}
            label="Avg Response"
            value={averageResponseTime == null ? 'N/A' : `${averageResponseTime.toFixed(1)} min`}
            detail="Mean of regional averages in the current result set"
          />
          <StatTile
            icon={<Filter className="h-4 w-4" />}
            label="Active Filters"
            value={String(activeFilterCount)}
            detail={activeFilterCount === 0 ? 'Showing all verified incidents' : 'Filters are limiting the dashboard'}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
        <PanelHeader
          icon={<BarChart3 className="h-5 w-5" />}
          title="Analyst Workflows"
          description="Open a dedicated workspace for calculations, export actions, and the matching incident table."
        />
        <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
          {WORKFLOW_LINKS.map((workflow) => (
            <Link
              key={workflow.href}
              href={workflow.href}
              onClick={(event) => openWorkflow(event, workflow.slug as AnalystWorkflowSlug)}
              className="group rounded-md border border-gray-200 bg-white p-4 transition-colors hover:border-red-200 hover:bg-red-50/40"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-700 group-hover:bg-white">
                  {workflow.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-gray-900">{workflow.title}</span>
                  <span className="mt-1 block text-sm text-gray-500">{workflow.description}</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
        <PanelHeader
          icon={<Filter className="h-5 w-5" />}
          title="Analysis Filters"
          description="Apply one shared filter contract across map, charts, exports, and the incident list."
          action={
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">
              {activeFilterCount} active
            </span>
          }
        />
        <div className="space-y-6 p-5">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase text-gray-500">
              Incident scope
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
              <FilterField label="Start Date">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-md py-2 px-3 text-sm border"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Start date"
                />
              </FilterField>
              <FilterField label="End Date">
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-md py-2 px-3 text-sm border"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="End date"
                />
              </FilterField>
              <FilterField label="Region">
                <select
                  value={regionId}
                  onChange={(e) => setRegionId(e.target.value)}
                  className="w-full rounded-md py-2 px-3 text-sm border cursor-pointer"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Region"
                >
                  <option value="">All Regions</option>
                  {regions.map((r) => (
                    <option key={r.region_id} value={String(r.region_id)}>
                      {r.region_name} ({r.region_code})
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Province">
                <select
                  value={province}
                  onChange={(e) => {
                    setProvince(e.target.value);
                    setMunicipality('');
                  }}
                  className="w-full rounded-md py-2 px-3 text-sm border cursor-pointer"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Province"
                >
                  <option value="">All Provinces</option>
                  {provinceOptions.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Municipality">
                <select
                  value={municipality}
                  onChange={(e) => setMunicipality(e.target.value)}
                  disabled={!province}
                  className="w-full rounded-md py-2 px-3 text-sm border cursor-pointer disabled:opacity-50"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Municipality"
                >
                  <option value="">All Municipalities</option>
                  {municipalityOptions.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </FilterField>
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-semibold uppercase text-gray-500">
              Classification and impact
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
              <FilterField label="Incident Type">
                <select
                  value={incidentType}
                  onChange={(e) => setIncidentType(e.target.value)}
                  className="w-full rounded-md py-2 px-3 text-sm border cursor-pointer"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Incident type"
                >
                  {INCIDENT_TYPES.map((o) => (
                    <option key={o.value || 'all'} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Alarm level">
                <select
                  value={alarmLevel}
                  onChange={(e) => setAlarmLevel(e.target.value)}
                  className="w-full rounded-md py-2 px-3 text-sm border cursor-pointer"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Alarm level"
                >
                  {ALARM_LEVELS.map((o) => (
                    <option key={o.value || 'all'} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Trend interval">
                <select
                  value={interval}
                  onChange={(e) => setInterval(e.target.value as 'daily' | 'weekly' | 'monthly')}
                  className="w-full rounded-md py-2 px-3 text-sm border cursor-pointer"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Interval"
                >
                  {INTERVALS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Casualty Severity">
                <select
                  value={casualtySeverity}
                  onChange={(e) => setCasualtySeverity(e.target.value)}
                  className="w-full rounded-md py-2 px-3 text-sm border cursor-pointer"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Casualty severity"
                >
                  <option value="">All</option>
                  <option value="high">High (deaths)</option>
                  <option value="medium">Medium (injuries)</option>
                  <option value="low">Low (none)</option>
                </select>
              </FilterField>
              <FilterField label="Damage Min">
                <input
                  type="number"
                  value={damageMin}
                  onChange={(e) => setDamageMin(e.target.value)}
                  placeholder="0"
                  min="0"
                  className="w-full rounded-md py-2 px-3 text-sm border"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Damage min"
                />
              </FilterField>
              <FilterField label="Damage Max">
                <input
                  type="number"
                  value={damageMax}
                  onChange={(e) => setDamageMax(e.target.value)}
                  placeholder="∞"
                  min="0"
                  className="w-full rounded-md py-2 px-3 text-sm border"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Damage max"
                />
              </FilterField>
              <div className="flex items-end gap-2 md:col-span-2 xl:col-span-6">
                <button
                  onClick={() => void loadData()}
                  disabled={loadingData}
                  aria-label="Apply"
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-bold text-white transition-colors disabled:opacity-70 sm:flex-none"
                  style={{ backgroundColor: 'var(--bfp-maroon)' }}
                >
                  <Search className="h-4 w-4" />
                  Apply filters
                </button>
                <button
                  onClick={() => {
                    const reset = initialComparativeRanges();
                    setStartDate('');
                    setEndDate('');
                    setRegionId('');
                    setProvince('');
                    setMunicipality('');
                    setIncidentType('');
                    setAlarmLevel('');
                    setCasualtySeverity('');
                    setDamageMin('');
                    setDamageMax('');
                    setInterval('daily');
                    setCmpRanges(reset);
                    loadData({
                      startDate: '',
                      endDate: '',
                      regionId: '',
                      province: '',
                      municipality: '',
                      incidentType: '',
                      alarmLevel: '',
                      interval: 'daily',
                      rangeAStart: reset.rangeAStart,
                      rangeAEnd: reset.rangeAEnd,
                      rangeBStart: reset.rangeBStart,
                      rangeBEnd: reset.rangeBEnd,
                      casualtySeverity: '',
                      damageMin: '',
                      damageMax: '',
                    });
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
                >
                  <RotateCcw className="h-4 w-4" />
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-semibold uppercase text-gray-500">
              Comparative periods (variance)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
              <FilterField label="Range A start">
                <input
                  type="date"
                  value={cmpRanges.rangeAStart}
                  onChange={(e) => setCmpRanges((prev) => ({ ...prev, rangeAStart: e.target.value }))}
                  className="w-full rounded-md py-2 px-3 text-sm border"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Range A start"
                />
              </FilterField>
              <FilterField label="Range A end">
                <input
                  type="date"
                  value={cmpRanges.rangeAEnd}
                  onChange={(e) => setCmpRanges((prev) => ({ ...prev, rangeAEnd: e.target.value }))}
                  className="w-full rounded-md py-2 px-3 text-sm border"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Range A end"
                />
              </FilterField>
              <FilterField label="Range B start">
                <input
                  type="date"
                  value={cmpRanges.rangeBStart}
                  onChange={(e) => setCmpRanges((prev) => ({ ...prev, rangeBStart: e.target.value }))}
                  className="w-full rounded-md py-2 px-3 text-sm border"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Range B start"
                />
              </FilterField>
              <FilterField label="Range B end">
                <input
                  type="date"
                  value={cmpRanges.rangeBEnd}
                  onChange={(e) => setCmpRanges((prev) => ({ ...prev, rangeBEnd: e.target.value }))}
                  className="w-full rounded-md py-2 px-3 text-sm border"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Range B end"
                />
              </FilterField>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="card overflow-hidden" style={{ borderLeft: '4px solid #dc2626' }}>
          <p className="p-3 text-sm font-medium text-red-700">{error}</p>
        </div>
      )}

      {loadingData && !heatmap && (
        <div className="flex items-center justify-center min-h-[200px] text-gray-500">
          <RefreshCw className="w-8 h-8 animate-spin" />
        </div>
      )}

      {!loadingData && heatmap !== null && (
        <>
          {/* Two-column layout: main content left, heatmap portrait on right */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
            <div className="space-y-6">
              <AnalystIncidentList
                filters={appliedIncidentFilters}
                prominent
                title="Incident Analysis Set"
                description="Select verified incidents across pages, then send that selected set to a dedicated analyst workflow."
              />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
                  <PanelHeader
                    icon={<TrendingUp className="h-5 w-5" />}
                    title="Trend Window"
                    description={`${interval.charAt(0).toUpperCase()}${interval.slice(1)} verified incident volume`}
                  />
                  <div className="p-5">
                    {trends && <TrendCharts data={trends} />}
                  </div>
                </div>

                {comparative && (
                  <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
                    <PanelHeader
                      icon={<AlertTriangle className="h-5 w-5" />}
                      title="Comparative Summary"
                      description="Variance between the selected review periods"
                    />
                    <div className="p-5">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="p-3 rounded border" style={{ borderColor: 'var(--border-color)' }}>
                          <div className="text-xs font-semibold uppercase text-gray-500 mb-1">Range A</div>
                          <div>{comparative.range_a.start} to {comparative.range_a.end}</div>
                          <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{comparative.range_a.count}</div>
                        </div>
                        <div className="p-3 rounded border" style={{ borderColor: 'var(--border-color)' }}>
                          <div className="text-xs font-semibold uppercase text-gray-500 mb-1">Range B</div>
                          <div>{comparative.range_b.start} to {comparative.range_b.end}</div>
                          <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{comparative.range_b.count}</div>
                        </div>
                        <div className="col-span-2 p-3 rounded bg-gray-50">
                          <span className="text-gray-600">Variance: </span>
                          <span className={`font-bold ${comparative.variance_percent >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {comparative.variance_percent >= 0 ? '+' : ''}{comparative.variance_percent}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Export buttons */}
              <div className="rounded-md border border-gray-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-red-50 text-red-700">
                      <FileDown className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-gray-900">Export AFOR Analytics</h2>
                      <p className="mt-0.5 text-sm text-gray-500">
                        Preview the active filters and selected columns before queueing the file.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={() => setExportModal({ format: 'csv', open: true })}
                      aria-label="Export CSV"
                      className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white"
                      style={{ backgroundColor: 'var(--bfp-maroon)' }}
                    >
                      <Download className="h-4 w-4" />
                      CSV
                    </button>
                    <button
                      onClick={() => setExportModal({ format: 'pdf', open: true })}
                      aria-label="Export PDF"
                      className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white"
                      style={{ backgroundColor: 'var(--bfp-maroon)' }}
                    >
                      <Download className="h-4 w-4" />
                      PDF
                    </button>
                    <button
                      onClick={() => setExportModal({ format: 'excel', open: true })}
                      aria-label="Export Excel"
                      className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white"
                      style={{ backgroundColor: 'var(--bfp-maroon)' }}
                    >
                      <Download className="h-4 w-4" />
                      Excel
                    </button>
                  </div>
                </div>
              </div>

              {/* Charts grid: two summary widgets without reserving an unused third column */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* AQ-06: Type distribution donut chart */}
                <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
                  <PanelHeader
                    icon={<BarChart3 className="h-5 w-5" />}
                    title="Incident Types"
                    description="Distribution by general category"
                  />
                  <div className="p-5">
                    <TypeDistributionChart data={typeDistribution ?? []} />
                  </div>
                </div>

                {/* AQ-08: Response time by region bar chart */}
                <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
                  <PanelHeader
                    icon={<Clock className="h-5 w-5" />}
                    title="Response Time"
                    description="Average, minimum, and maximum by region"
                  />
                  <div className="p-5">
                    <ResponseTimeChart data={responseTime ?? []} />
                  </div>
                </div>
              </div>

              {/* AQ-13: Cross-region comparison */}
              {compareRegions && (
                <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
                  <PanelHeader
                    icon={<BarChart3 className="h-5 w-5" />}
                    title="Cross-Region Comparison"
                    description="Compare incident volume, response time, and top type by region"
                  />
                  <div className="p-5">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b" style={{ borderColor: 'var(--border-color)' }}>
                          <th className="text-left py-2">Region</th>
                          <th className="text-right py-2">Total Incidents</th>
                          <th className="text-right py-2">Avg Response Time</th>
                          <th className="text-right py-2">Top Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compareRegions.map((r) => (
                          <tr key={r.region_id} className="border-b" style={{ borderColor: 'var(--border-color)' }}>
                            <td className="py-2">{getShortRegionName(r.region_id)}</td>
                            <td className="text-right py-2 font-bold">{r.total_incidents}</td>
                            <td className="text-right py-2">{r.avg_response_time ?? '—'}</td>
                            <td className="text-right py-2">{r.top_type ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* AQ-14: Top-N configurable analysis */}
              <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
                <PanelHeader
                  icon={<ListChecks className="h-5 w-5" />}
                  title="Top-N Analysis"
                  description="Switch metric and dimension to inspect hotspots without leaving the dashboard"
                />
                <div className="space-y-4 p-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
                        Metric
                      </label>
                      <select
                        value={topNMetric}
                        onChange={(e) => setTopNMetric(e.target.value)}
                        className="w-full rounded-md py-2.5 px-3 text-sm border cursor-pointer"
                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                        aria-label="Metric"
                      >
                        <option value="incidents">Incidents</option>
                        <option value="response_time">Response Time</option>
                        <option value="casualties">Casualties</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
                        Dimension
                      </label>
                      <select
                        value={topNDimension}
                        onChange={(e) => setTopNDimension(e.target.value)}
                        className="w-full rounded-md py-2.5 px-3 text-sm border cursor-pointer"
                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                        aria-label="Dimension"
                      >
                        <option value="fire_station">Fire Station</option>
                        <option value="region">Region</option>
                        <option value="municipality">Municipality</option>
                      </select>
                    </div>
                  </div>
                  {topNData && topNData.length > 0 ? (
                    <div data-testid="bar-chart">
                      {topNData.map((d) => (
                        <div key={d.name} className="flex justify-between py-1 text-sm border-b" style={{ borderColor: 'var(--border-color)' }}>
                          <span>{d.name}</span>
                          <span className="font-bold">{typeof d.value === 'number' ? d.value.toFixed(1) : d.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No top-N data.</p>
                  )}
                </div>
              </div>

            </div>

            {/* Heatmap: portrait side column on desktop */}
            <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm lg:sticky lg:top-4 lg:self-start">
              <PanelHeader
                icon={<MapPinned className="h-5 w-5" />}
                title="Incident Heatmap"
                description="Geographic clustering of verified incidents"
              />
              <div className="p-0">
                <HeatmapViewer geojson={heatmap} className="h-[520px] lg:h-[calc(100vh-7rem)] lg:min-h-[600px] lg:max-h-[920px]" />
              </div>
            </div>
          </div>
        </>
      )}

      {exportModal?.open && (
        <ExportPreviewModal
          format={exportModal.format}
          filters={appliedIncidentFilters as Record<string, unknown>}
          filtersSummary={
            [
              startDate && `From: ${startDate}`,
              endDate && `To: ${endDate}`,
              regionId && `Region: ${regions.find(r => String(r.region_id) === regionId)?.region_name ?? regionId}`,
              province && `Province: ${province}`,
              municipality && `Municipality: ${municipality}`,
              incidentType && `Type: ${incidentType}`,
              alarmLevel && `Alarm: ${alarmLevel}`,
              casualtySeverity && `Casualty: ${casualtySeverity}`,
              damageMin && `Damage Min: ₱${Number(damageMin).toLocaleString()}`,
              damageMax && `Damage Max: ₱${Number(damageMax).toLocaleString()}`,
            ].filter(Boolean).join(' | ') || 'No filters (all data)'
          }
          onClose={() => setExportModal(null)}
        />
      )}
    </div>
  );
}
