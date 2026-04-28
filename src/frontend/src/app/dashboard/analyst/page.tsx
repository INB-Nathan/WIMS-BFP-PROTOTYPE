'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import type { Region } from '@/types/api';
import {
  fetchHeatmapData,
  fetchTrendData,
  fetchComparativeData,
  fetchRegions,
  fetchTypeDistribution,
  fetchTopBarangays,
  fetchResponseTimeByRegion,
  fetchCompareRegions,
  fetchTopN,
  type HeatmapGeoJSON,
  type TrendsResponse,
  type ComparativeResponse,
  type TypeDistributionItem,
  type TopBarangayItem,
  type ResponseTimeRegionItem,
  type CompareRegionItem,
  type TopNItem,
} from '@/lib/api';
import { TrendCharts } from '@/components/analytics/TrendCharts';
import { RefreshCw, Download } from 'lucide-react';

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

  const [cmpRanges, setCmpRanges] = useState(() => initialComparativeRanges());

  // AQ-04: Casualty severity filter
  const [casualtySeverity, setCasualtySeverity] = useState('');
  // AQ-05: Damage range filter
  const [damageMin, setDamageMin] = useState('');
  const [damageMax, setDamageMax] = useState('');
  // AQ-06: Type distribution
  const [typeDistribution, setTypeDistribution] = useState<TypeDistributionItem[] | null>(null);
  // AQ-07: Top barangays
  const [topBarangays, setTopBarangays] = useState<TopBarangayItem[] | null>(null);
  // AQ-08: Response time by region
  const [responseTime, setResponseTime] = useState<ResponseTimeRegionItem[] | null>(null);
  // AQ-13: Cross-region comparison
  const [compareRegions, setCompareRegions] = useState<CompareRegionItem[] | null>(null);
  // AQ-14: Top-N
  const [topNData, setTopNData] = useState<TopNItem[] | null>(null);
  const [topNMetric, setTopNMetric] = useState('incidents');
  const [topNDimension, setTopNDimension] = useState('barangay');

  type FilterOverrides = {
    startDate?: string;
    endDate?: string;
    regionId?: string;
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
      const filters = {
        start_date: sd || undefined,
        end_date: ed || undefined,
        region_id: rid ? parseInt(rid, 10) : undefined,
        incident_type: it || undefined,
        alarm_level: al || undefined,
        casualty_severity: cs || undefined,
        damage_min: dm ? parseFloat(dm) : undefined,
        damage_max: dx ? parseFloat(dx) : undefined,
      };
      const [heatmapRes, trendsRes, comparativeRes, typeDistRes, topBgyRes, respTimeRes, cmpRegionsRes, topNRes] = await Promise.all([
        fetchHeatmapData(filters),
        fetchTrendData({ ...filters, interval: iv }),
        fetchComparativeData({
          range_a_start: raS,
          range_a_end: raE,
          range_b_start: rbS,
          range_b_end: rbE,
          region_id: rid ? parseInt(rid, 10) : undefined,
          incident_type: it || undefined,
          alarm_level: al || undefined,
        }),
        fetchTypeDistribution({ start_date: sd || undefined, end_date: ed || undefined, region_id: rid ? parseInt(rid, 10) : undefined }),
        fetchTopBarangays({ start_date: sd || undefined, end_date: ed || undefined, incident_type: it || undefined }),
        fetchResponseTimeByRegion({ start_date: sd || undefined, end_date: ed || undefined }),
        rid ? fetchCompareRegions({ region_ids: rid, start_date: sd || undefined, end_date: ed || undefined }).catch(() => []) : Promise.resolve([]),
        fetchTopN({ metric: topNMetric, dimension: topNDimension, start_date: sd || undefined, end_date: ed || undefined }),
      ]);
      setHeatmap(heatmapRes);
      setTrends(trendsRes);
      setComparative(comparativeRes);
      setTypeDistribution(typeDistRes);
      setTopBarangays(topBgyRes);
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
    incidentType,
    alarmLevel,
    interval,
    cmpRanges,
    casualtySeverity,
    damageMin,
    damageMax,
    topNMetric,
    topNDimension,
  ]);

  useEffect(() => {
    if (loading) return;
    fetchRegions().then((r) => setRegions(Array.isArray(r) ? r : []));
  }, [loading]);

  useEffect(() => {
    if (ANALYST_ROLES.includes(role ?? '')) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only; Apply button triggers refresh
  }, [role]);

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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            National Analyst Dashboard
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Geospatial heatmap and trend analytics for verified incidents.
          </p>
        </div>
        <button
          onClick={() => void loadData()}
          disabled={loadingData}
          className="card flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-70"
        >
          <RefreshCw className={`w-4 h-4 ${loadingData ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Filter bar */}
      <div className="card">
        <div className="card-header">Filters</div>
        <div className="card-body space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
              Heatmap &amp; trends window
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-8 gap-4 items-end">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-md py-2 px-3 text-sm border"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Start date"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-md py-2 px-3 text-sm border"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="End date"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Region
                </label>
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
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Incident Type
                </label>
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
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Alarm level
                </label>
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
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Interval
                </label>
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
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Casualty Severity
                </label>
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
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Damage Min
                </label>
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
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Damage Max
                </label>
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
              </div>
              <div className="flex gap-2 md:col-span-2">
                <button
                  onClick={() => void loadData()}
                  disabled={loadingData}
                  className="flex-1 text-sm font-bold py-2 px-3 rounded-md text-white transition-colors"
                  style={{ backgroundColor: 'var(--bfp-maroon)' }}
                >
                  Apply
                </button>
                <button
                  onClick={() => {
                    const reset = initialComparativeRanges();
                    setStartDate('');
                    setEndDate('');
                    setRegionId('');
                    setIncidentType('');
                    setAlarmLevel('');
                    setInterval('daily');
                    setCmpRanges(reset);
                    loadData({
                      startDate: '',
                      endDate: '',
                      regionId: '',
                      incidentType: '',
                      alarmLevel: '',
                      interval: 'daily',
                      rangeAStart: reset.rangeAStart,
                      rangeAEnd: reset.rangeAEnd,
                      rangeBStart: reset.rangeBStart,
                      rangeBEnd: reset.rangeBEnd,
                    });
                  }}
                  className="text-sm py-2 px-3 rounded-md border hover:bg-gray-50"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
              Comparative periods (variance)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Range A start
                </label>
                <input
                  type="date"
                  value={cmpRanges.rangeAStart}
                  onChange={(e) => setCmpRanges((prev) => ({ ...prev, rangeAStart: e.target.value }))}
                  className="w-full rounded-md py-2 px-3 text-sm border"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Range A start"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Range A end
                </label>
                <input
                  type="date"
                  value={cmpRanges.rangeAEnd}
                  onChange={(e) => setCmpRanges((prev) => ({ ...prev, rangeAEnd: e.target.value }))}
                  className="w-full rounded-md py-2 px-3 text-sm border"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Range A end"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Range B start
                </label>
                <input
                  type="date"
                  value={cmpRanges.rangeBStart}
                  onChange={(e) => setCmpRanges((prev) => ({ ...prev, rangeBStart: e.target.value }))}
                  className="w-full rounded-md py-2 px-3 text-sm border"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Range B start"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Range B end
                </label>
                <input
                  type="date"
                  value={cmpRanges.rangeBEnd}
                  onChange={(e) => setCmpRanges((prev) => ({ ...prev, rangeBEnd: e.target.value }))}
                  className="w-full rounded-md py-2 px-3 text-sm border"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  aria-label="Range B end"
                />
              </div>
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
          <div className="card">
            <div className="card-header">Heatmap</div>
            <div className="card-body p-0">
              <HeatmapViewer geojson={heatmap} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <div className="card-header">Trends</div>
              <div className="card-body">
                {trends && <TrendCharts data={trends} />}
              </div>
            </div>

            {comparative && (
              <div className="card">
                <div className="card-header">Comparative Summary</div>
                <div className="card-body">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="p-3 rounded border" style={{ borderColor: 'var(--border-color)' }}>
                      <div className="text-xs font-semibold uppercase text-gray-500 mb-1">Range A</div>
                      <div>{comparative.range_a.start} — {comparative.range_a.end}</div>
                      <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{comparative.range_a.count}</div>
                    </div>
                    <div className="p-3 rounded border" style={{ borderColor: 'var(--border-color)' }}>
                      <div className="text-xs font-semibold uppercase text-gray-500 mb-1">Range B</div>
                      <div>{comparative.range_b.start} — {comparative.range_b.end}</div>
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
          <div className="flex gap-3">
            <button
              onClick={() => {
                fetch('/api/analytics/export/pdf', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ filters: {}, columns: ['incident_id', 'notification_dt', 'alarm_level', 'general_category'] }),
                }).then(r => r.json()).then(d => { if (d.task_id) alert('PDF export queued: ' + d.task_id); });
              }}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white"
              style={{ backgroundColor: 'var(--bfp-maroon)' }}
            >
              <Download className="w-4 h-4" /> Export PDF
            </button>
            <button
              onClick={() => {
                fetch('/api/analytics/export/excel', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ filters: {}, columns: ['incident_id', 'notification_dt', 'alarm_level', 'general_category'] }),
                }).then(r => r.json()).then(d => { if (d.task_id) alert('Excel export queued: ' + d.task_id); });
              }}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white"
              style={{ backgroundColor: 'var(--bfp-maroon)' }}
            >
              <Download className="w-4 h-4" /> Export Excel
            </button>
          </div>

          {/* Charts grid: pie, top barangays, response time */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* AQ-06: Type distribution pie chart */}
            <div className="card">
              <div className="card-header">Incident Type Distribution</div>
              <div className="card-body">
                {typeDistribution && typeDistribution.length > 0 ? (
                  <div data-testid="pie-chart">
                    {typeDistribution.map((d) => (
                      <div key={d.type} className="flex justify-between py-1 text-sm border-b" style={{ borderColor: 'var(--border-color)' }} data-testid={`pie-segment-${d.type}`}>
                        <span>{d.type}</span>
                        <span className="font-bold">{d.count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No distribution data.</p>
                )}
              </div>
            </div>

            {/* AQ-07: Top barangays */}
            <div className="card">
              <div className="card-header">Top Barangays</div>
              <div className="card-body">
                {topBarangays && topBarangays.length > 0 ? (
                  <div data-testid="bar-chart">
                    {topBarangays.map((d) => (
                      <div key={d.barangay} className="flex justify-between py-1 text-sm border-b" style={{ borderColor: 'var(--border-color)' }}>
                        <span>{d.barangay}</span>
                        <span className="font-bold">{d.count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No barangay data.</p>
                )}
              </div>
            </div>

            {/* AQ-08: Response time by region */}
            <div className="card">
              <div className="card-header">Response Time by Region</div>
              <div className="card-body">
                {responseTime && responseTime.length > 0 ? (
                  <div>
                    {responseTime.map((d) => (
                      <div key={d.region_id} className="py-2 text-sm border-b" style={{ borderColor: 'var(--border-color)' }}>
                        <div className="font-medium">Region {d.region_id}</div>
                        <div className="text-gray-500">
                          Avg: <span className="font-bold text-gray-700">{d.avg_response_time}</span> min
                          &nbsp;|&nbsp; Min: {d.min_response_time} / Max: {d.max_response_time}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No response time data.</p>
                )}
              </div>
            </div>
          </div>

          {/* AQ-13: Cross-region comparison */}
          {compareRegions && (
            <div className="card">
              <div className="card-header">Cross-Region Comparison</div>
              <div className="card-body">
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
                        <td className="py-2">Region {r.region_name}</td>
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
          <div className="card">
            <div className="card-header">Top-N Analysis</div>
            <div className="card-body space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                    Metric
                  </label>
                  <select
                    value={topNMetric}
                    onChange={(e) => setTopNMetric(e.target.value)}
                    className="w-full rounded-md py-2 px-3 text-sm border cursor-pointer"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                    aria-label="Metric"
                  >
                    <option value="incidents">Incidents</option>
                    <option value="response_time">Response Time</option>
                    <option value="casualties">Casualties</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                    Dimension
                  </label>
                  <select
                    value={topNDimension}
                    onChange={(e) => setTopNDimension(e.target.value)}
                    className="w-full rounded-md py-2 px-3 text-sm border cursor-pointer"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                    aria-label="Dimension"
                  >
                    <option value="barangay">Barangay</option>
                    <option value="fire_station">Fire Station</option>
                    <option value="region">Region</option>
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
        </>
      )}
    </div>
  );
}
