'use client';

import { useEffect, useMemo, useState, useCallback, type MouseEvent, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import type { Region } from '@/types/api';
import {
  fetchHeatmapDataOfflineAware,
  fetchTrendDataOfflineAware,
  fetchComparativeDataOfflineAware,
  fetchRegions,
  fetchTypeDistributionOfflineAware,
  fetchResponseTimeByRegionOfflineAware,
  fetchCompareRegions,
  fetchTopNOfflineAware,
  fetchAnalyticsFilterOptionsOfflineAware,
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
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { ExportPreviewModal, type ExportFormat } from '@/components/analytics/ExportPreviewModal';
import {
  createAnalystWorkflowTransferUrl,
  type AnalystWorkflowSlug,
} from '@/lib/analyst-workflow-transfer';
import { getShortRegionName, PH_REGIONS } from '@/lib/ph-regions';
import { useAutoSync } from '@/lib/useAutoSync';
import { useNetworkStatus } from '@/lib/useNetworkStatus';
import { WidgetGrid, AddWidgetDropdown, FreshnessDot, FilterChips, type FilterChip } from '@/components/dashboard';
import { useDashboardWidgets } from '@/hooks/useDashboardWidgets';

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
    accentBorder: 'border-t-blue-500',
    iconBg: 'bg-blue-50 text-blue-700',
    hoverBorder: 'hover:border-blue-300',
  },
  {
    slug: 'heatmap',
    href: '/dashboard/analyst/heatmap',
    title: 'Heatmap',
    description: 'Map-first geographic review with filtered records',
    icon: <MapPinned className="h-5 w-5" />,
    accentBorder: 'border-t-emerald-500',
    iconBg: 'bg-emerald-50 text-emerald-700',
    hoverBorder: 'hover:border-emerald-300',
  },
  {
    slug: 'trends',
    href: '/dashboard/analyst/trends',
    title: 'Trends',
    description: 'Interval controls, bucket totals, and incident table',
    icon: <TrendingUp className="h-5 w-5" />,
    accentBorder: 'border-t-purple-500',
    iconBg: 'bg-purple-50 text-purple-700',
    hoverBorder: 'hover:border-purple-300',
  },
  {
    slug: 'response-time',
    href: '/dashboard/analyst/response-time',
    title: 'Response Time',
    description: 'Regional min, max, average detail, and export',
    icon: <Clock className="h-5 w-5" />,
    accentBorder: 'border-t-amber-500',
    iconBg: 'bg-amber-50 text-amber-700',
    hoverBorder: 'hover:border-amber-300',
  },
  {
    slug: 'top-n',
    href: '/dashboard/analyst/top-n',
    title: 'Top-N Hotspots',
    description: 'Metric and dimension controls for hotspot ranking',
    icon: <ListChecks className="h-5 w-5" />,
    accentBorder: 'border-t-[#991B1B]',
    iconBg: 'bg-red-50 text-red-700',
    hoverBorder: 'hover:border-red-300',
  },
  {
    slug: 'incident-explorer',
    href: '/dashboard/analyst/incident-explorer',
    title: 'Incident Explorer',
    description: 'Dedicated verified incident table and detail drawer',
    icon: <Search className="h-5 w-5" />,
    accentBorder: 'border-t-slate-500',
    iconBg: 'bg-slate-50 text-slate-700',
    hoverBorder: 'hover:border-slate-300',
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
      <span className="mb-1 block text-sm font-semibold text-gray-700">
        {label}
      </span>
      {children}
    </label>
  );
}

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function PanelHeader({
  icon,
  title,
  description,
  action,
  freshness,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  freshness?: { cachedAt?: number; isOnline: boolean };
}) {
  const now = useNow();
  const minutesAgo =
    freshness?.cachedAt != null
      ? Math.max(0, Math.floor((now - freshness.cachedAt) / 60_000))
      : undefined;

  return (
    <div className="flex flex-col gap-3 border-b border-gray-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-700">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-gray-900">{title}</h2>
            {freshness && <FreshnessDot minutesAgo={minutesAgo} isOnline={freshness.isOnline} />}
          </div>
          {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

type DashboardCacheMeta = Partial<Record<
  'heatmap' | 'trends' | 'comparative' | 'typeDistribution' | 'responseTime' | 'topN',
  number
>>;

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
  const networkStatus = useNetworkStatus();
  useAutoSync();
  const role = (user as { role?: string })?.role ?? null;

  useEffect(() => {
    if (!loading && role && !ANALYST_ROLES.includes(role)) {
      router.replace('/dashboard');
    }
  }, [loading, role, router]);

  const widgetConfig = useDashboardWidgets(role);

  const [heatmap, setHeatmap] = useState<HeatmapGeoJSON | null>(null);
  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [comparative, setComparative] = useState<ComparativeResponse | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [cacheMeta, setCacheMeta] = useState<DashboardCacheMeta>({});

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

  // Progressive disclosure: advanced filters collapsed by default
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

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
        fetchHeatmapDataOfflineAware(filters),
        fetchTrendDataOfflineAware({ ...filters, interval: iv }),
        fetchComparativeDataOfflineAware({
          range_a_start: raS,
          range_a_end: raE,
          range_b_start: rbS,
          range_b_end: rbE,
          ...filters,
        }),
        fetchTypeDistributionOfflineAware(filters),
        fetchResponseTimeByRegionOfflineAware(filters),
        comparisonRegionIds.length >= 2
          ? fetchCompareRegions({
              ...filters,
              region_id: undefined,
              region_ids: comparisonRegionIds.join(','),
            }).catch(() => [])
          : Promise.resolve([]),
        fetchTopNOfflineAware({ metric: topNMetric, dimension: topNDimension, ...filters }),
      ]);
      setHeatmap(heatmapRes.response);
      setTrends(trendsRes.response);
      setComparative(comparativeRes.response);
      setTypeDistribution(typeDistRes.response);
      setResponseTime(respTimeRes.response);
      setCompareRegions(cmpRegionsRes.length >= 2 ? cmpRegionsRes : null);
      setTopNData(topNRes.response);
      setCacheMeta({
        heatmap: heatmapRes.fromCache ? heatmapRes.cachedAt : undefined,
        trends: trendsRes.fromCache ? trendsRes.cachedAt : undefined,
        comparative: comparativeRes.fromCache ? comparativeRes.cachedAt : undefined,
        typeDistribution: typeDistRes.fromCache ? typeDistRes.cachedAt : undefined,
        responseTime: respTimeRes.fromCache ? respTimeRes.cachedAt : undefined,
        topN: topNRes.fromCache ? topNRes.cachedAt : undefined,
      });
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
    fetchAnalyticsFilterOptionsOfflineAware('province', {
      region_id: regionId ? parseInt(regionId, 10) : undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
    }).then((result) => setProvinceOptions(result.response)).catch(() => setProvinceOptions([]));
  }, [loading, regionId, startDate, endDate, role]);

  // Cascade: load municipality options when province changes
  useEffect(() => {
    if (!ANALYST_ROLES.includes(role ?? '')) return;
    if (!province) {
      setMunicipalityOptions([]);
      return;
    }
    fetchAnalyticsFilterOptionsOfflineAware('municipality', {
      region_id: regionId ? parseInt(regionId, 10) : undefined,
      province,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
    }).then((result) => setMunicipalityOptions(result.response)).catch(() => setMunicipalityOptions([]));
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

  const exportUnavailableOffline = !networkStatus.isOnline;

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

  // Active filter chips for progressive disclosure
  const activeChips: FilterChip[] = useMemo(() => {
    const chips: FilterChip[] = [];
    if (startDate) chips.push({ key: 'startDate', label: `From: ${startDate}`, onRemove: () => setStartDate('') });
    if (endDate) chips.push({ key: 'endDate', label: `To: ${endDate}`, onRemove: () => setEndDate('') });
    if (regionId) {
      const name = regions.find((r) => String(r.region_id) === regionId)?.region_name ?? `Region ${regionId}`;
      chips.push({ key: 'regionId', label: `Region: ${name}`, onRemove: () => setRegionId('') });
    }
    if (province) chips.push({ key: 'province', label: `Province: ${province}`, onRemove: () => { setProvince(''); setMunicipality(''); } });
    if (municipality) chips.push({ key: 'municipality', label: `Municipality: ${municipality}`, onRemove: () => setMunicipality('') });
    if (incidentType) chips.push({ key: 'incidentType', label: `Type: ${incidentType}`, onRemove: () => setIncidentType('') });
    if (alarmLevel) chips.push({ key: 'alarmLevel', label: `Alarm: ${alarmLevel}`, onRemove: () => setAlarmLevel('') });
    if (casualtySeverity) chips.push({ key: 'casualtySeverity', label: `Casualty: ${casualtySeverity}`, onRemove: () => setCasualtySeverity('') });
    if (damageMin) chips.push({ key: 'damageMin', label: `Damage ≥ ₱${Number(damageMin).toLocaleString()}`, onRemove: () => setDamageMin('') });
    if (damageMax) chips.push({ key: 'damageMax', label: `Damage ≤ ₱${Number(damageMax).toLocaleString()}`, onRemove: () => setDamageMax('') });
    return chips;
  }, [startDate, endDate, regionId, regions, province, municipality, incidentType, alarmLevel, casualtySeverity, damageMin, damageMax]);

  const handleClearFilters = useCallback(() => {
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
    setShowAdvancedFilters(false);
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
  }, [loadData]);

  const handleApplyFilters = useCallback(() => {
    void loadData();
  }, [loadData]);

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
      {/* ── Offline banner ── */}
      {exportUnavailableOffline && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          You are offline. Cached analyst reads are available; analytics exports are unavailable until reconnect.
        </div>
      )}

      {/* ── Phase 1: Redesigned maroon header with integrated KPI strip ── */}
      <div className="rounded-lg bg-[#991B1B] px-5 py-5 shadow-md sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-white sm:text-2xl">
                National Analyst Dashboard
              </h1>
              <FreshnessDot cachedAt={cacheMeta.heatmap || cacheMeta.trends} isOnline={networkStatus.isOnline} />
            </div>
            <p className="mt-1 text-sm text-white/70">
              Bureau of Fire Protection &mdash; Nationwide verified incident intelligence for trend review, geographic monitoring, and AFOR export.
            </p>
          </div>
          <button
            onClick={handleApplyFilters}
            disabled={loadingData}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loadingData ? 'animate-spin' : ''}`} /> Refresh data
          </button>
        </div>

        {/* ── KPI strip inside header ── */}
        <div className="mt-5 flex flex-wrap items-stretch divide-x divide-white/20 rounded-lg bg-black/15 overflow-hidden">
          <div className="flex-1 min-w-[130px] px-4 py-3">
            <div className="flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5 text-white/60" />
              <span className="text-xs font-medium uppercase tracking-wide text-white/60">Incidents</span>
            </div>
            <div className="mt-1 text-2xl font-bold text-white">{visibleIncidentCount.toLocaleString()}</div>
            <div className="mt-0.5 text-xs text-white/50">Under applied filters</div>
          </div>
          <div className="flex-1 min-w-[130px] px-4 py-3">
            <div className="flex items-center gap-1.5">
              <MapPinned className="h-3.5 w-3.5 text-white/60" />
              <span className="text-xs font-medium uppercase tracking-wide text-white/60">Scope</span>
            </div>
            <div className="mt-1 text-2xl font-bold text-white">{activeRegionName}</div>
            <div className="mt-0.5 text-xs text-white/50">
              {province || municipality ? [province, municipality].filter(Boolean).join(' / ') : 'National coverage'}
            </div>
          </div>
          <div className="flex-1 min-w-[130px] px-4 py-3">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-white/60" />
              <span className="text-xs font-medium uppercase tracking-wide text-white/60">Avg Response</span>
            </div>
            <div className="mt-1 text-2xl font-bold text-white">
              {averageResponseTime == null ? 'N/A' : `${averageResponseTime.toFixed(1)} min`}
            </div>
            <div className="mt-0.5 text-xs text-white/50">Mean of regional averages</div>
          </div>
          <div className="flex-1 min-w-[130px] px-4 py-3">
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-white/60" />
              <span className="text-xs font-medium uppercase tracking-wide text-white/60">Filters</span>
            </div>
            <div className="mt-1 text-2xl font-bold text-white">{activeFilterCount}</div>
            <div className="mt-0.5 text-xs text-white/50">
              {activeFilterCount === 0 ? 'Showing all incidents' : 'Active'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Customizable widget grid ── */}
      {ANALYST_ROLES.includes(role ?? '') && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Dashboard Widgets
            </span>
            <div className="flex items-center gap-2">
              {widgetConfig.widgets.length > 0 && (
                <button
                  type="button"
                  onClick={widgetConfig.resetToDefaults}
                  className="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                >
                  Reset
                </button>
              )}
              <AddWidgetDropdown availableAdditions={widgetConfig.availableAdditions} onAddWidget={widgetConfig.addWidget} />
            </div>
          </div>
          <WidgetGrid
            widgetIds={widgetConfig.widgets}
            role={role}
            onRemoveWidget={widgetConfig.removeWidget}
          />
        </>
      )}

      {/* ── Phase 1: Filter bar with progressive disclosure ── */}
      <div className="overflow-hidden rounded-md border border-gray-200 bg-gray-50">
        <PanelHeader
          icon={<Filter className="h-5 w-5" />}
          title="Analysis Filters"
          description="Apply one shared filter contract across map, charts, exports, and the incident list."
          action={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600">
              {activeFilterCount} active
            </span>
          }
        />
        <div className="space-y-4 p-5">
          {/* Active filter chips */}
          {activeChips.length > 0 && (
            <div className="pb-3 border-b border-gray-200">
              <FilterChips
                chips={activeChips}
                onClearAll={handleClearFilters}
              />
            </div>
          )}

          {/* Primary filters: always visible */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FilterField label="Start Date">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900"
                aria-label="Start date"
              />
            </FilterField>
            <FilterField label="End Date">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900"
                aria-label="End date"
              />
            </FilterField>
            <FilterField label="Region">
              <select
                value={regionId}
                onChange={(e) => setRegionId(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900 cursor-pointer"
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
            <FilterField label="Incident Type">
              <select
                value={incidentType}
                onChange={(e) => setIncidentType(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900 cursor-pointer"
                aria-label="Incident type"
              >
                {INCIDENT_TYPES.map((o) => (
                  <option key={o.value || 'all'} value={o.value}>{o.label}</option>
                ))}
              </select>
            </FilterField>
          </div>

          {/* Advanced filters toggle */}
          <button
            type="button"
            onClick={() => setShowAdvancedFilters((v) => !v)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
          >
            {showAdvancedFilters ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Advanced filters
            <span className="text-xs text-gray-400">(province, alarm, casualty, damage, comparative)</span>
          </button>

          {/* Advanced filters: collapsible */}
          {showAdvancedFilters && (
            <div className="space-y-5 border-t border-gray-200 pt-4">
              <div>
                <p className="mb-3 text-xs font-semibold uppercase text-gray-500">
                  Location details
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FilterField label="Province">
                    <select
                      value={province}
                      onChange={(e) => {
                        setProvince(e.target.value);
                        setMunicipality('');
                      }}
                      className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900 cursor-pointer"
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
                      className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900 cursor-pointer disabled:opacity-50"
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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <FilterField label="Alarm level">
                    <select
                      value={alarmLevel}
                      onChange={(e) => setAlarmLevel(e.target.value)}
                      className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900 cursor-pointer"
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
                      className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900 cursor-pointer"
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
                      className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900 cursor-pointer"
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
                      className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900"
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
                      className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900"
                      aria-label="Damage max"
                    />
                  </FilterField>
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
                      className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900"
                      aria-label="Range A start"
                    />
                  </FilterField>
                  <FilterField label="Range A end">
                    <input
                      type="date"
                      value={cmpRanges.rangeAEnd}
                      onChange={(e) => setCmpRanges((prev) => ({ ...prev, rangeAEnd: e.target.value }))}
                      className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900"
                      aria-label="Range A end"
                    />
                  </FilterField>
                  <FilterField label="Range B start">
                    <input
                      type="date"
                      value={cmpRanges.rangeBStart}
                      onChange={(e) => setCmpRanges((prev) => ({ ...prev, rangeBStart: e.target.value }))}
                      className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900"
                      aria-label="Range B start"
                    />
                  </FilterField>
                  <FilterField label="Range B end">
                    <input
                      type="date"
                      value={cmpRanges.rangeBEnd}
                      onChange={(e) => setCmpRanges((prev) => ({ ...prev, rangeBEnd: e.target.value }))}
                      className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900"
                      aria-label="Range B end"
                    />
                  </FilterField>
                </div>
              </div>
            </div>
          )}

          {/* Apply / Clear buttons — always visible */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              onClick={handleApplyFilters}
              disabled={loadingData}
              aria-label="Apply filters"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-[#991B1B] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#7f1d1d] disabled:opacity-70"
            >
              <Search className="h-4 w-4" />
              Apply filters
            </button>
            <button
              onClick={handleClearFilters}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <RotateCcw className="h-4 w-4" />
              Clear
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="card overflow-hidden border-l-4 border-l-red-600">
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
          {/* ── Phase 1: Charts BEFORE incident list (reorganized) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
            <div className="space-y-6">
              {/* Charts: Trend + Comparative */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
                  <PanelHeader
                    icon={<TrendingUp className="h-5 w-5" />}
                    title="Trend Window"
                    description={`${interval.charAt(0).toUpperCase()}${interval.slice(1)} verified incident volume`}
                    freshness={{ cachedAt: cacheMeta.trends, isOnline: networkStatus.isOnline }}
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
                      freshness={{ cachedAt: cacheMeta.comparative, isOnline: networkStatus.isOnline }}
                    />
                    <div className="p-5">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="rounded border border-gray-200 p-3">
                          <div className="text-xs font-semibold uppercase text-gray-500 mb-1">Range A</div>
                          <div>{comparative.range_a.start} to {comparative.range_a.end}</div>
                          <div className="text-xl font-bold text-gray-900">{comparative.range_a.count}</div>
                        </div>
                        <div className="rounded border border-gray-200 p-3">
                          <div className="text-xs font-semibold uppercase text-gray-500 mb-1">Range B</div>
                          <div>{comparative.range_b.start} to {comparative.range_b.end}</div>
                          <div className="text-xl font-bold text-gray-900">{comparative.range_b.count}</div>
                        </div>
                        <div className="col-span-2 rounded bg-gray-50 p-3">
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
                      disabled={exportUnavailableOffline}
                      title={exportUnavailableOffline ? 'Unavailable offline' : undefined}
                      aria-label="Export CSV"
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-[#991B1B] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      <Download className="h-4 w-4" />
                      CSV
                    </button>
                    <button
                      onClick={() => setExportModal({ format: 'pdf', open: true })}
                      disabled={exportUnavailableOffline}
                      title={exportUnavailableOffline ? 'Unavailable offline' : undefined}
                      aria-label="Export PDF"
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-[#991B1B] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      <Download className="h-4 w-4" />
                      PDF
                    </button>
                    <button
                      onClick={() => setExportModal({ format: 'excel', open: true })}
                      disabled={exportUnavailableOffline}
                      title={exportUnavailableOffline ? 'Unavailable offline' : undefined}
                      aria-label="Export Excel"
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-[#991B1B] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      <Download className="h-4 w-4" />
                      Excel
                    </button>
                  </div>
                </div>
              </div>

              {/* Charts: Type Distribution + Response Time */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
                  <PanelHeader
                    icon={<BarChart3 className="h-5 w-5" />}
                    title="Incident Types"
                    description="Distribution by general category"
                    freshness={{ cachedAt: cacheMeta.typeDistribution, isOnline: networkStatus.isOnline }}
                  />
                  <div className="p-5">
                    <TypeDistributionChart data={typeDistribution ?? []} />
                  </div>
                </div>

                <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
                  <PanelHeader
                    icon={<Clock className="h-5 w-5" />}
                    title="Response Time"
                    description="Average, minimum, and maximum by region"
                    freshness={{ cachedAt: cacheMeta.responseTime, isOnline: networkStatus.isOnline }}
                  />
                  <div className="p-5">
                    <ResponseTimeChart data={responseTime ?? []} />
                  </div>
                </div>
              </div>

              {/* Cross-Region Comparison */}
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
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2">Region</th>
                          <th className="text-right py-2">Total Incidents</th>
                          <th className="text-right py-2">Avg Response Time</th>
                          <th className="text-right py-2">Top Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compareRegions.map((r) => (
                          <tr key={r.region_id} className="border-b border-gray-200">
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

              {/* Top-N Analysis */}
              <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
                <PanelHeader
                  icon={<ListChecks className="h-5 w-5" />}
                  title="Top-N Analysis"
                  description="Switch metric and dimension to inspect hotspots without leaving the dashboard"
                  freshness={{ cachedAt: cacheMeta.topN, isOnline: networkStatus.isOnline }}
                />
                <div className="space-y-4 p-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-500 mb-1">
                        Metric
                      </label>
                      <select
                        value={topNMetric}
                        onChange={(e) => setTopNMetric(e.target.value)}
                        className="w-full rounded-md border border-gray-300 bg-white py-2.5 px-3 text-sm text-gray-900 cursor-pointer"
                        aria-label="Metric"
                      >
                        <option value="incidents">Incidents</option>
                        <option value="response_time">Response Time</option>
                        <option value="casualties">Casualties</option>
                        <option value="damage_cost">Damage Cost (PHP)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-500 mb-1">
                        Dimension
                      </label>
                      <select
                        value={topNDimension}
                        onChange={(e) => setTopNDimension(e.target.value)}
                        className="w-full rounded-md border border-gray-300 bg-white py-2.5 px-3 text-sm text-gray-900 cursor-pointer"
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
                      {topNData.map((d) => {
                        let displayValue: string;
                        if (typeof d.value !== 'number') {
                          displayValue = String(d.value ?? '—');
                        } else if (topNMetric === 'damage_cost') {
                          displayValue = `₱${d.value.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                        } else if (topNMetric === 'response_time') {
                          displayValue = `${d.value.toFixed(1)} min`;
                        } else {
                          displayValue = d.value.toLocaleString('en-PH', { maximumFractionDigits: 0 });
                        }
                        return (
                          <div key={d.name} className="flex justify-between py-1 text-sm border-b border-gray-200">
                            <span>{d.name}</span>
                            <span className="font-bold">{displayValue}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No top-N data.</p>
                  )}
                </div>
              </div>

              {/* ── Phase 1: Incident list MOVED BELOW charts ── */}
              <AnalystIncidentList
                filters={appliedIncidentFilters}
                prominent
                title="Incident Analysis Set"
                description="Select verified incidents across pages, then send that selected set to a dedicated analyst workflow."
              />
            </div>

            {/* Heatmap: portrait side column on desktop */}
            <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm lg:sticky lg:top-4 lg:self-start">
              <PanelHeader
                icon={<MapPinned className="h-5 w-5" />}
                title="Incident Heatmap"
                description="Geographic clustering of verified incidents"
                freshness={{ cachedAt: cacheMeta.heatmap, isOnline: networkStatus.isOnline }}
              />
              <div className="p-0">
                <HeatmapViewer geojson={heatmap} className="h-[520px] lg:h-[calc(100vh-7rem)] lg:min-h-[600px] lg:max-h-[920px]" />
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Phase 1: Workflow cards — color-coded, larger icons, hover lift ── */}
      <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
        <PanelHeader
          icon={<BarChart3 className="h-5 w-5" />}
          title="Analyst Workflows"
          description="Open a dedicated workspace for calculations, export actions, and the matching incident table."
        />
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {WORKFLOW_LINKS.map((workflow) => (
            <Link
              key={workflow.href}
              href={workflow.href}
              onClick={(event) => openWorkflow(event, workflow.slug as AnalystWorkflowSlug)}
              className={`group rounded-md border border-gray-200 bg-white p-4 border-t-[3px] ${workflow.accentBorder} ${workflow.hoverBorder} shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5`}
            >
              <div className="flex flex-col items-center gap-2 text-center">
                <span className={`flex h-12 w-12 items-center justify-center rounded-full ${workflow.iconBg} group-hover:scale-110 transition-transform`}>
                  {workflow.icon}
                </span>
                <span className="text-sm font-bold text-gray-900">{workflow.title}</span>
                <span className="text-xs text-gray-500 leading-snug">{workflow.description}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

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
