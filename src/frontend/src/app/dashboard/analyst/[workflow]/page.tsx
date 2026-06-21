'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
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
import { useAuth } from '@/context/AuthContext';
import {
  fetchAnalyticsFilterOptionsOfflineAware,
  fetchComparativeDataOfflineAware,
  fetchHeatmapDataOfflineAware,
  fetchRegions,
  fetchResponseTimeByRegionOfflineAware,
  fetchTopNOfflineAware,
  fetchTrendDataOfflineAware,
  type AnalystIncidentListParams,
  type ComparativeResponse,
  type HeatmapGeoJSON,
  type ResponseTimeRegionItem,
  type TopNItem,
  type TrendsResponse,
} from '@/lib/api';
import type { Region } from '@/types/api';
import { AnalystIncidentList } from '@/components/analytics/AnalystIncidentList';
import { ExportPreviewModal, type ExportFormat } from '@/components/analytics/ExportPreviewModal';
import { MetricTile } from '@/components/analytics/MetricTile';
import { ResponseTimeChart } from '@/components/analytics/ResponseTimeChart';
import { TopNTable } from '@/components/analytics/TopNTable';
import { TrendCharts } from '@/components/analytics/TrendCharts';
import { readAnalystWorkflowTransfer } from '@/lib/analyst-workflow-transfer';
import { useAutoSync } from '@/lib/useAutoSync';
import { useNetworkStatus } from '@/lib/useNetworkStatus';

const HeatmapViewer = dynamic(
  () => import('@/components/analytics/HeatmapViewer').then((m) => m.HeatmapViewer),
  { ssr: false, loading: () => <div className="flex h-[520px] items-center justify-center text-gray-500">Loading map...</div> }
);

const ANALYST_ROLES = ['NATIONAL_ANALYST', 'SYSTEM_ADMIN'];

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
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
] as const;

const WORKFLOWS = {
  comparative: {
    title: 'Comparative Analysis',
    kicker: 'Period variance',
    description: 'Compare verified incident counts between two review windows and inspect the matching incident table.',
    icon: BarChart3,
  },
  heatmap: {
    title: 'Heatmap And Geospatial Review',
    kicker: 'Location intelligence',
    description: 'Use a map-first view for geographic clustering, then drill into the filtered incident records.',
    icon: MapPinned,
  },
  trends: {
    title: 'Trend Analysis',
    kicker: 'Time series',
    description: 'Review incident volume by interval with calculation context and filtered incident evidence.',
    icon: TrendingUp,
  },
  'response-time': {
    title: 'Response Time Analysis',
    kicker: 'Operational timing',
    description: 'Compare regional response-time averages with minimum and maximum bounds.',
    icon: Clock,
  },
  'top-n': {
    title: 'Top-N Hotspot Analysis',
    kicker: 'Ranked hotspots',
    description: 'Switch metric and dimension to rank hotspots by incident volume, response time, or casualties.',
    icon: ListChecks,
  },
  'incident-explorer': {
    title: 'Incident Explorer',
    kicker: 'Record hub',
    description: 'Browse, sort, export, and open verified incidents from one dedicated table surface.',
    icon: ListChecks,
  },
} as const;

type WorkflowSlug = keyof typeof WORKFLOWS;
type Interval = (typeof INTERVALS)[number]['value'];

function isWorkflowSlug(value: string): value is WorkflowSlug {
  return value in WORKFLOWS;
}

function initialComparativeRanges() {
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

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-gray-800">{label}</span>
      {children}
    </label>
  );
}

function Panel({
  title,
  icon,
  children,
  action,
  description,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  description?: string;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
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
      <div className="p-5">{children}</div>
    </section>
  );
}

function formatCachedAt(cachedAt?: number): string | null {
  if (!cachedAt) return null;
  return `Last updated ${new Date(cachedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}`;
}

function CacheMetaText({ cachedAt }: { cachedAt?: number }) {
  const label = formatCachedAt(cachedAt);
  if (!label) return null;
  return <p className="mb-3 text-xs font-medium text-amber-700">Showing cached data — {label}</p>;
}

export default function AnalystWorkflowPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const transferId = searchParams.get('transfer');
  const params = useParams<{ workflow?: string | string[] }>();
  const workflowParam = Array.isArray(params.workflow) ? params.workflow[0] : params.workflow;
  const workflow = workflowParam && isWorkflowSlug(workflowParam) ? workflowParam : null;
  const config = workflow ? WORKFLOWS[workflow] : null;
  const WorkflowIcon = config?.icon ?? BarChart3;

  const { user, loading } = useAuth();
  const networkStatus = useNetworkStatus();
  useAutoSync();
  const role = (user as { role?: string })?.role ?? null;

  const [regions, setRegions] = useState<Region[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [regionId, setRegionId] = useState('');
  const [province, setProvince] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [incidentType, setIncidentType] = useState('');
  const [alarmLevel, setAlarmLevel] = useState('');
  const [casualtySeverity, setCasualtySeverity] = useState('');
  const [damageMin, setDamageMin] = useState('');
  const [damageMax, setDamageMax] = useState('');
  const [interval, setInterval] = useState<Interval>('daily');
  const [cmpRanges, setCmpRanges] = useState(() => initialComparativeRanges());
  const [topNMetric, setTopNMetric] = useState('incidents');
  const [topNDimension, setTopNDimension] = useState('municipality');
  const [provinceOptions, setProvinceOptions] = useState<string[]>([]);
  const [municipalityOptions, setMunicipalityOptions] = useState<string[]>([]);
  const [appliedFilters, setAppliedFilters] = useState<AnalystIncidentListParams>({});
  const [selectedIncidentIds, setSelectedIncidentIds] = useState<number[]>([]);
  const [selectedSetActive, setSelectedSetActive] = useState(false);
  const [transferLoaded, setTransferLoaded] = useState(false);
  const [hydratedTransferId, setHydratedTransferId] = useState<string | null>();

  const [heatmap, setHeatmap] = useState<HeatmapGeoJSON | null>(null);
  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [comparative, setComparative] = useState<ComparativeResponse | null>(null);
  const [responseTime, setResponseTime] = useState<ResponseTimeRegionItem[] | null>(null);
  const [topNData, setTopNData] = useState<TopNItem[] | null>(null);
  const [exportModal, setExportModal] = useState<{ format: ExportFormat; open: boolean } | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [cacheMeta, setCacheMeta] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!loading && role && !ANALYST_ROLES.includes(role)) {
      router.replace('/dashboard');
    }
  }, [loading, role, router]);

  useEffect(() => {
    const payload = readAnalystWorkflowTransfer(transferId);
    if (payload) {
      const filters = payload.filters;
      setStartDate(filters.start_date ?? '');
      setEndDate(filters.end_date ?? '');
      setRegionId(filters.region_id ? String(filters.region_id) : '');
      setProvince(filters.province ?? '');
      setMunicipality(filters.municipality ?? '');
      setIncidentType(filters.incident_type ?? '');
      setAlarmLevel(filters.alarm_level ?? '');
      setCasualtySeverity(filters.casualty_severity ?? '');
      setDamageMin(filters.damage_min != null ? String(filters.damage_min) : '');
      setDamageMax(filters.damage_max != null ? String(filters.damage_max) : '');
      setAppliedFilters(filters);
      setSelectedIncidentIds(payload.selectedIncidentIds ?? []);
      setSelectedSetActive((payload.selectedIncidentIds ?? []).length > 0);
    }
    setHydratedTransferId(transferId);
    setTransferLoaded(true);
  }, [transferId]);

  useEffect(() => {
    if (loading) return;
    fetchRegions().then((r) => setRegions(Array.isArray(r) ? r : []));
  }, [loading]);

  useEffect(() => {
    if (!ANALYST_ROLES.includes(role ?? '')) return;
    fetchAnalyticsFilterOptionsOfflineAware('province', {
      region_id: regionId ? parseInt(regionId, 10) : undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
    }).then((result) => setProvinceOptions(result.response)).catch(() => setProvinceOptions([]));
  }, [endDate, regionId, role, startDate]);

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
  }, [endDate, province, regionId, role, startDate]);

  useEffect(() => {
    if (!province && municipality) setMunicipality('');
  }, [municipality, province]);

  const activeFilters = useMemo<AnalystIncidentListParams>(() => ({
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
  }), [alarmLevel, casualtySeverity, damageMax, damageMin, endDate, incidentType, municipality, province, regionId, startDate]);

  const filtersSummary = useMemo(() => {
    const regionName = regionId ? regions.find((r) => String(r.region_id) === regionId)?.region_name ?? regionId : '';
    return [
      startDate && `From: ${startDate}`,
      endDate && `To: ${endDate}`,
      regionName && `Region: ${regionName}`,
      province && `Province: ${province}`,
      municipality && `Municipality: ${municipality}`,
      incidentType && `Type: ${incidentType}`,
      alarmLevel && `Alarm: ${alarmLevel}`,
      casualtySeverity && `Casualty: ${casualtySeverity}`,
      damageMin && `Damage Min: PHP ${Number(damageMin).toLocaleString()}`,
      damageMax && `Damage Max: PHP ${Number(damageMax).toLocaleString()}`,
    ].filter(Boolean).join(' | ') || 'No filters (all verified incidents)';
  }, [alarmLevel, casualtySeverity, damageMax, damageMin, endDate, incidentType, municipality, province, regionId, regions, startDate]);

  const loadData = useCallback(async () => {
    if (!workflow || !role || !ANALYST_ROLES.includes(role)) return;
    setLoadingData(true);
    setError(null);
    setAccessDenied(false);
    setAppliedFilters(activeFilters);
    try {
      setCacheMeta(undefined);
      if (workflow === 'heatmap') {
        const result = await fetchHeatmapDataOfflineAware(activeFilters);
        setHeatmap(result.response);
        setCacheMeta(result.fromCache ? result.cachedAt : undefined);
      } else if (workflow === 'trends') {
        const result = await fetchTrendDataOfflineAware({ ...activeFilters, interval });
        setTrends(result.response);
        setCacheMeta(result.fromCache ? result.cachedAt : undefined);
      } else if (workflow === 'comparative') {
        const result = await fetchComparativeDataOfflineAware({
          range_a_start: cmpRanges.rangeAStart,
          range_a_end: cmpRanges.rangeAEnd,
          range_b_start: cmpRanges.rangeBStart,
          range_b_end: cmpRanges.rangeBEnd,
          ...activeFilters,
        });
        setComparative(result.response);
        setCacheMeta(result.fromCache ? result.cachedAt : undefined);
      } else if (workflow === 'response-time') {
        const result = await fetchResponseTimeByRegionOfflineAware(activeFilters);
        setResponseTime(result.response);
        setCacheMeta(result.fromCache ? result.cachedAt : undefined);
      } else if (workflow === 'top-n') {
        const result = await fetchTopNOfflineAware({
          ...activeFilters,
          metric: topNMetric,
          dimension: topNDimension,
          limit: 10,
        });
        setTopNData(result.response);
        setCacheMeta(result.fromCache ? result.cachedAt : undefined);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/403|NATIONAL_ANALYST|SYSTEM_ADMIN|required|forbidden/i.test(msg)) {
        setAccessDenied(true);
      } else {
        setError(msg || 'Unable to load analyst workflow data.');
      }
    } finally {
      setLoadingData(false);
    }
  }, [activeFilters, cmpRanges, interval, role, topNDimension, topNMetric, workflow]);

  useEffect(() => {
    if (transferLoaded && ANALYST_ROLES.includes(role ?? '') && workflow) {
      void loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial workflow load only; Apply/Refresh buttons reload with current controls
  }, [role, workflow, transferLoaded]);

  const resetFilters = () => {
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
    setCmpRanges(initialComparativeRanges());
    setSelectedIncidentIds([]);
    setSelectedSetActive(false);
    setAppliedFilters({});
  };

  const activeFilterCount = Object.values(activeFilters).filter((value) => value !== undefined && value !== '').length;
  const exportUnavailableOffline = !networkStatus.isOnline;
  const transferReady = transferLoaded && hydratedTransferId === transferId;
  const evidenceFilters = useMemo<AnalystIncidentListParams>(() => (
    selectedIncidentIds.length > 0
      && selectedSetActive
      ? { ...appliedFilters, incident_ids: selectedIncidentIds }
      : appliedFilters
  ), [appliedFilters, selectedIncidentIds, selectedSetActive]);
  const totalTrendCount = trends?.data.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const peakTrend = trends?.data.reduce<{ bucket: string | null; count: number } | null>((best, item) => {
    if (!best || item.count > best.count) return item;
    return best;
  }, null);
  const avgResponse = responseTime && responseTime.length > 0
    ? responseTime.reduce((sum, item) => sum + Number(item.avg_response_time || 0), 0) / responseTime.length
    : null;
  const minResponse = responseTime && responseTime.length > 0
    ? Math.min(...responseTime.map((item) => Number(item.min_response_time || 0)))
    : null;
  const maxResponse = responseTime && responseTime.length > 0
    ? Math.max(...responseTime.map((item) => Number(item.max_response_time || 0)))
    : null;

  if (loading) {
    return <div className="flex min-h-[40vh] items-center justify-center text-gray-500">Loading...</div>;
  }

  if (!workflow || !config) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/analyst" className="inline-flex items-center gap-2 text-sm font-semibold text-red-700">
          <ArrowLeft className="h-4 w-4" /> Analyst dashboard
        </Link>
        <div className="rounded-md border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-bold text-gray-900">Analyst workflow not found</h1>
          <p className="mt-2 text-sm text-gray-500">Choose a workflow from the National Analyst dashboard.</p>
        </div>
      </div>
    );
  }

  if (role && !ANALYST_ROLES.includes(role)) {
    return <div className="flex min-h-[40vh] items-center justify-center text-gray-500">Redirecting...</div>;
  }

  if (accessDenied) {
    return (
      <div className="rounded-md border border-red-100 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-red-700">Access Denied</h1>
        <p className="mt-2 text-sm text-gray-600">You do not have permission to view this analyst workflow.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {exportUnavailableOffline && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          You are offline. Cached workflow reads are available; analytics exports are unavailable until reconnect.
        </div>
      )}
      <CacheMetaText cachedAt={cacheMeta} />
      <div className="rounded-md border border-gray-200 bg-white px-5 py-4 shadow-sm">
        <Link
          href="/dashboard/analyst"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-red-700 transition-colors hover:text-red-800"
        >
          <ArrowLeft className="h-4 w-4" /> Analyst dashboard
        </Link>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-700">
              <WorkflowIcon className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                {config.kicker}
              </div>
              <h1
                className="font-bold leading-tight"
                style={{ fontSize: "28px", color: "var(--text-primary)" }}
              >
                {config.title}
              </h1>
              <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                {config.description}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loadingData}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loadingData ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {selectedSetActive && selectedIncidentIds.length > 0 && (
        <div
          className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-5 py-4"
          role="status"
          aria-live="polite"
        >
          <ListChecks className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" aria-hidden="true" />
          <div className="text-sm text-amber-900">
            <div className="font-semibold">
              Selected set active &middot; {selectedIncidentIds.length.toLocaleString()} incidents
            </div>
            <p className="mt-1">
              Charts and calculations reflect the active filters. The selected set drives the evidence table and the selected-record export below.
            </p>
          </div>
        </div>
      )}

      <Panel
        title="Analysis Filters"
        icon={<Filter className="h-5 w-5" />}
        description="The same filter contract drives calculations, exports, and the incident evidence table."
        action={<span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">{activeFilterCount} active</span>}
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <FilterField label="Start Date">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
            </FilterField>
            <FilterField label="End Date">
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
            </FilterField>
            <FilterField label="Region">
              <select value={regionId} onChange={(e) => setRegionId(e.target.value)} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm">
                <option value="">All Regions</option>
                {regions.map((region) => (
                  <option key={region.region_id} value={String(region.region_id)}>{region.region_name} ({region.region_code})</option>
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
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">All Provinces</option>
                {provinceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </FilterField>
            <FilterField label="Municipality">
              <select
                value={municipality}
                onChange={(e) => setMunicipality(e.target.value)}
                disabled={!province}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">All Municipalities</option>
                {municipalityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </FilterField>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            <FilterField label="Incident Type">
              <select value={incidentType} onChange={(e) => setIncidentType(e.target.value)} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm">
                {INCIDENT_TYPES.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
              </select>
            </FilterField>
            <FilterField label="Alarm Level">
              <select value={alarmLevel} onChange={(e) => setAlarmLevel(e.target.value)} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm">
                {ALARM_LEVELS.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
              </select>
            </FilterField>
            <FilterField label="Casualty Severity">
              <select value={casualtySeverity} onChange={(e) => setCasualtySeverity(e.target.value)} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm">
                <option value="">All</option>
                <option value="high">High (deaths)</option>
                <option value="medium">Medium (injuries)</option>
                <option value="low">Low (none)</option>
              </select>
            </FilterField>
            <FilterField label="Damage Min">
              <input type="number" min="0" value={damageMin} onChange={(e) => setDamageMin(e.target.value)} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
            </FilterField>
            <FilterField label="Damage Max">
              <input type="number" min="0" value={damageMax} onChange={(e) => setDamageMax(e.target.value)} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
            </FilterField>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => void loadData()}
                disabled={loadingData}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
                style={{ backgroundColor: '#991B1B' }}
              >
                <Search className="h-4 w-4" /> Apply
              </button>
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                <RotateCcw className="h-4 w-4" /> Clear
              </button>
            </div>
          </div>

          {workflow === 'comparative' && (
            <div className="grid grid-cols-1 gap-4 border-t border-gray-100 pt-5 sm:grid-cols-2 lg:grid-cols-4">
              <FilterField label="Range A Start">
                <input type="date" value={cmpRanges.rangeAStart} onChange={(e) => setCmpRanges((current) => ({ ...current, rangeAStart: e.target.value }))} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
              </FilterField>
              <FilterField label="Range A End">
                <input type="date" value={cmpRanges.rangeAEnd} onChange={(e) => setCmpRanges((current) => ({ ...current, rangeAEnd: e.target.value }))} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
              </FilterField>
              <FilterField label="Range B Start">
                <input type="date" value={cmpRanges.rangeBStart} onChange={(e) => setCmpRanges((current) => ({ ...current, rangeBStart: e.target.value }))} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
              </FilterField>
              <FilterField label="Range B End">
                <input type="date" value={cmpRanges.rangeBEnd} onChange={(e) => setCmpRanges((current) => ({ ...current, rangeBEnd: e.target.value }))} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
              </FilterField>
            </div>
          )}

          {workflow === 'trends' && (
            <div className="max-w-xs border-t border-gray-100 pt-5">
              <FilterField label="Trend Interval">
                <select value={interval} onChange={(e) => setInterval(e.target.value as Interval)} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm">
                  {INTERVALS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </FilterField>
            </div>
          )}

          {workflow === 'top-n' && (
            <div className="grid grid-cols-1 gap-4 border-t border-gray-100 pt-5 sm:grid-cols-2 lg:grid-cols-4">
              <FilterField label="Metric">
                <select value={topNMetric} onChange={(e) => setTopNMetric(e.target.value)} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm">
                  <option value="incidents">Incidents</option>
                  <option value="response_time">Response Time</option>
                  <option value="casualties">Casualties</option>
                  <option value="damage_cost">Damage Cost (PHP)</option>
                </select>
              </FilterField>
              <FilterField label="Dimension">
                <select value={topNDimension} onChange={(e) => setTopNDimension(e.target.value)} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm">
                  <option value="municipality">Municipality</option>
                  <option value="fire_station">Fire Station</option>
                  <option value="region">Region</option>
                </select>
              </FilterField>
            </div>
          )}
        </div>
      </Panel>

      {error && (
        <div className="rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <Panel
        title="Export Workflow Results"
        icon={<FileDown className="h-5 w-5" />}
        description="Export the current filtered result, the selected incident set, or the full AFOR record. Each format previews scope, filters, and columns before download."
        action={
          <div className="flex flex-wrap gap-2">
            {(['csv', 'pdf', 'excel'] as ExportFormat[]).map((format) => (
              <button
                key={format}
                type="button"
                onClick={() => setExportModal({ format, open: true })}
                disabled={exportUnavailableOffline}
                title={exportUnavailableOffline ? 'Unavailable offline' : undefined}
                aria-label={`Export ${format === 'excel' ? 'Excel' : format.toUpperCase()}`}
                className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#991B1B' }}
                onMouseEnter={(e) => {
                  if (!exportUnavailableOffline) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#7f1d1d';
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = '#991B1B';
                }}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {format === 'excel' ? 'Excel' : format.toUpperCase()}
              </button>
            ))}
          </div>
        }
      >
        <dl className="space-y-3 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-gray-200 bg-white p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Current filtered result</dt>
              <dd className="mt-1 break-words text-gray-900">{filtersSummary}</dd>
            </div>
            <div className="rounded-md border border-gray-200 bg-white p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Selected incidents</dt>
              <dd className="mt-1 text-gray-900">
                <span className="text-base font-bold">{selectedIncidentIds.length.toLocaleString()}</span>
                <span className="ml-1.5 text-gray-500">
                  {selectedIncidentIds.length === 1 ? 'incident' : 'incidents'} on the evidence table
                </span>
              </dd>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Charts and calculations use the active filters. The selected set drives the evidence table and the selected-record export.
          </p>
        </dl>
      </Panel>

      {workflow === 'comparative' && (
        <Panel title="Calculation Detail" icon={<BarChart3 className="h-5 w-5" />} description="Variance = (Range B - Range A) / Range A, returned by the analytics API.">
          {comparative ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <MetricTile label="Range A" value={comparative.range_a.count.toLocaleString()} detail={`${comparative.range_a.start} to ${comparative.range_a.end}`} />
              <MetricTile label="Range B" value={comparative.range_b.count.toLocaleString()} detail={`${comparative.range_b.start} to ${comparative.range_b.end}`} />
              <MetricTile label="Difference" value={(comparative.range_b.count - comparative.range_a.count).toLocaleString()} detail="Range B minus Range A" />
              <MetricTile label="Variance" value={`${comparative.variance_percent >= 0 ? '+' : ''}${comparative.variance_percent}%`} detail="Percent change between periods" />
            </div>
          ) : (
            <p className="text-sm text-gray-500">{loadingData ? 'Loading comparative results...' : 'No comparative data loaded.'}</p>
          )}
        </Panel>
      )}

      {workflow === 'heatmap' && (
        <Panel title="Map View" icon={<MapPinned className="h-5 w-5" />} description="Each marker represents one verified incident with coordinates in the current filter result.">
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricTile label="Mapped Incidents" value={(heatmap?.features.length ?? 0).toLocaleString()} detail="Features returned by /analytics/heatmap" />
            <MetricTile label="Map Mode" value="Point" detail="GeoJSON incident locations" />
            <MetricTile label="Evidence" value="Table Below" detail="Same filters applied to incident records" />
          </div>
          <div className="overflow-hidden rounded-md border border-gray-200">
            {heatmap ? <HeatmapViewer geojson={heatmap} /> : <div className="flex h-[520px] items-center justify-center text-gray-500">No map data loaded.</div>}
          </div>
        </Panel>
      )}

      {workflow === 'trends' && (
        <Panel title="Trend Calculation" icon={<TrendingUp className="h-5 w-5" />} description="Incident counts are bucketed by the selected interval over verified analytics facts.">
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricTile label="Total In Window" value={totalTrendCount.toLocaleString()} detail="Sum of returned buckets" />
            <MetricTile label="Interval" value={interval.charAt(0).toUpperCase() + interval.slice(1)} detail="Selected bucket granularity" />
            <MetricTile label="Peak Bucket" value={peakTrend?.bucket ?? 'N/A'} detail={peakTrend ? `${peakTrend.count.toLocaleString()} incidents` : 'No buckets returned'} />
          </div>
          {trends ? <TrendCharts data={trends} /> : <p className="text-sm text-gray-500">No trend data loaded.</p>}
        </Panel>
      )}

      {workflow === 'response-time' && (
        <Panel title="Regional Response Detail" icon={<Clock className="h-5 w-5" />} description="Average, minimum, and maximum response times are grouped by region.">
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricTile label="Mean Regional Avg" value={avgResponse == null ? 'N/A' : `${avgResponse.toFixed(1)} min`} detail="Average of regional averages" />
            <MetricTile label="Fastest Minimum" value={minResponse == null ? 'N/A' : `${minResponse.toFixed(1)} min`} detail="Lowest regional minimum" />
            <MetricTile label="Slowest Maximum" value={maxResponse == null ? 'N/A' : `${maxResponse.toFixed(1)} min`} detail="Highest regional maximum" />
          </div>
          <ResponseTimeChart data={responseTime ?? []} />
        </Panel>
      )}

      {workflow === 'top-n' && (
        <Panel title="Ranked Results" icon={<ListChecks className="h-5 w-5" />} description="The ranked result uses /analytics/top-n with the selected metric and dimension.">
          <TopNTable data={topNData ?? []} metric={topNMetric} />
        </Panel>
      )}

      {transferReady && (
        <AnalystIncidentList
          filters={evidenceFilters}
          pageSize={workflow === 'incident-explorer' ? 100 : 25}
          prominent={workflow === 'incident-explorer'}
          title={workflow === 'incident-explorer' ? 'Incident Explorer' : 'Incident Evidence Table'}
          description={
            workflow === 'incident-explorer'
              ? 'Selected-set control center with 100 rows per page for dense review.'
              : 'Verified incidents matching this workflow’s local filters.'
          }
          initialSelectedIncidentIds={selectedIncidentIds}
          onSelectionChange={setSelectedIncidentIds}
        />
      )}

      {exportModal?.open && (
        <ExportPreviewModal
          format={exportModal.format}
          filters={appliedFilters as Record<string, unknown>}
          filtersSummary={filtersSummary}
          onClose={() => setExportModal(null)}
        />
      )}
    </div>
  );
}
