'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  MapPin,
  PhoneCall,
  RefreshCw,
  Route,
} from 'lucide-react';
import { EmergencyReferenceCard } from '@/components/EmergencyReferenceCard';
import { parseLineStringToLatLng } from '@/components/map/RoutePolyline';
import { ApiRequestError } from '@/lib/api/errors';
import {
  fetchPublicTracking,
  type PublicTrackingData,
  type PublicTrackingStatusUpdate,
} from '@/lib/api/tracking';
import { TrackingRouteMap } from './TrackingRouteMap';

const TRACKING_LINKS_BY_REPORT_KEY = 'wims_tracking_links_by_report';

const STAGE_LABELS: Record<string, string> = {
  RECEIVED: 'Received',
  UNDER_REVIEW: 'Under Review',
  HELP_DISPATCHED: 'Help Dispatched',
  ON_SCENE: 'On Scene',
  RESOLVED: 'Resolved',
  CLOSED_DUPLICATE: 'Closed — Duplicate',
  CLOSED_INSUFFICIENT: 'Closed — Insufficient',
};

const OPEN_STATUSES = new Set(['PENDING', 'UNDER_REVIEW', 'LINKED']);

function storeTrackingLink(reportId: string, trackingUrl: string): void {
  try {
    const raw = localStorage.getItem(TRACKING_LINKS_BY_REPORT_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const links = Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'string'),
    ) as Record<string, string>;
    links[reportId] = trackingUrl;
    localStorage.setItem(TRACKING_LINKS_BY_REPORT_KEY, JSON.stringify(links));
  } catch {}
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Time unavailable'
    : date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDistance(meters: number | null): string {
  if (meters === null) return 'Distance pending';
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatTravelTime(seconds: number | null): string {
  if (seconds === null) return 'ETA pending';
  return `${Math.max(1, Math.round(seconds / 60))} min estimated`;
}

function metadataText(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function TimelineEntry({ update, fallbackPhone }: {
  update: PublicTrackingStatusUpdate;
  fallbackPhone: string | null;
}) {
  const metadata = update.metadata;
  const stage = STAGE_LABELS[update.stage] ?? update.stage.replaceAll('_', ' ');
  const station = metadataText(metadata, 'station_name');
  const phone = metadataText(metadata, 'station_phone') ?? fallbackPhone;
  const jurisdiction = metadataText(metadata, 'jurisdiction');
  const arrivedAt = metadataText(metadata, 'arrived_at');
  const outcome = metadataText(metadata, 'outcome_summary') ?? metadataText(metadata, 'reason');

  return (
    <li className="relative border-l-2 border-slate-200 pb-5 pl-5 last:pb-0" data-testid="tracking-timeline-entry">
      <span className="absolute -left-[6px] top-1 h-2.5 w-2.5 rounded-full bg-[#991B1B]" aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
          {stage}
        </span>
        <time className="text-xs text-slate-500">{formatTimestamp(update.created_at)}</time>
      </div>
      {station && (
        <div className="mt-2 text-sm text-slate-700">
          <p className="font-medium text-slate-800">{station}</p>
          {jurisdiction && <p className="text-xs text-slate-500">{jurisdiction}</p>}
          {phone && <a className="text-xs font-medium text-[#991B1B]" href={`tel:${phone}`}>{phone}</a>}
        </div>
      )}
      {arrivedAt && <p className="mt-2 text-sm text-slate-700">Arrived: {formatTimestamp(arrivedAt)}</p>}
      {outcome && <p className="mt-2 text-sm text-slate-700">{outcome}</p>}
    </li>
  );
}

export default function TrackingV2Page() {
  const params = useParams();
  const reportId = params.report_id as string;
  const trackingToken = params.tracking_token as string;
  const [data, setData] = useState<PublicTrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTracking = useCallback(async () => {
    if (!reportId || !trackingToken) {
      setError('Missing tracking information.');
      setLoading(false);
      return;
    }
    setData(null);
    setLoading(true);
    setError(null);
    try {
      setData(await fetchPublicTracking(Number(reportId), trackingToken));
    } catch (err: unknown) {
      setError(
        err instanceof ApiRequestError && err.status === 404
          ? 'Report not found. The link may be invalid or expired.'
          : err instanceof Error ? err.message : 'Failed to fetch report status.',
      );
    } finally {
      setLoading(false);
    }
  }, [reportId, trackingToken]);

  useEffect(() => { void fetchTracking(); }, [fetchTracking]);
  useEffect(() => {
    if (reportId && trackingToken) storeTrackingLink(reportId, `/tracking/v2/${reportId}/${trackingToken}`);
  }, [reportId, trackingToken]);

  const timeline = data?.status_updates?.length
    ? data.status_updates
    : data ? [{ stage: 'RECEIVED', metadata: null, created_at: data.created_at }] : [];
  const routeGeometry = data && parseLineStringToLatLng(data.routing_geometry)
    ? data.routing_geometry
    : null;

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-800 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Civilian report tracking</p>
            <h1 className="mt-1 text-xl font-bold">Track Emergency Report</h1>
          </div>
          <EmergencyReferenceCard compact />
        </header>

        {loading && <div className="flex min-h-64 items-center justify-center gap-3 rounded-lg bg-white text-slate-600 shadow-sm"><RefreshCw className="h-5 w-5 animate-spin" /> Loading your report…</div>}
        {error && !loading && <div className="rounded-lg bg-white p-8 text-center shadow-sm"><AlertTriangle className="mx-auto h-8 w-8 text-amber-600" /><p className="mt-3 text-sm text-slate-600">{error}</p><Link className="mt-4 inline-block text-sm font-semibold text-[#991B1B]" href="/">Submit a new emergency report</Link></div>}

        {data && !loading && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:grid lg:grid-cols-[minmax(0,1fr)_23rem]">
            <section className="min-h-[420px] border-b border-slate-200 lg:border-b-0 lg:border-r">
              {routeGeometry ? (
                <TrackingRouteMap geometry={routeGeometry} />
              ) : (
                <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 bg-slate-50 p-8 text-center" data-testid="routing-text-fallback">
                  <Route className="h-8 w-8 text-slate-400" />
                  <p className="font-medium text-slate-700">Road route unavailable</p>
                  <p className="max-w-sm text-sm text-slate-500">Route information will appear here when it becomes available.</p>
                </div>
              )}
            </section>

            <aside className="max-h-[calc(100vh-8rem)] overflow-y-auto">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Emergency report</p><h2 className="mt-1 text-base font-bold">Report #{data.report_id}</h2></div>
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800">{STAGE_LABELS[timeline.at(-1)?.stage ?? ''] ?? data.status.replaceAll('_', ' ')}</span>
                </div>
                {data.guidance && <p className="mt-3 text-sm leading-5 text-slate-600">{data.guidance}</p>}
              </div>

              <div className="grid grid-cols-2 border-b border-slate-200">
                <div className="border-r border-slate-200 px-5 py-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Distance</p><p className="mt-1 text-lg font-bold">{formatDistance(data.routing_distance_m)}</p></div>
                <div className="px-5 py-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Travel time</p><p className="mt-1 text-lg font-bold">{formatTravelTime(data.routing_duration_s)}</p></div>
              </div>

              {data.nearest_station_name && <div className="flex gap-2 border-b border-slate-200 px-5 py-3"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#991B1B]" /><div className="text-sm"><p className="font-medium">{data.nearest_station_name}</p>{data.nearest_station_phone && <a className="inline-flex items-center gap-1 text-xs font-medium text-[#991B1B]" href={`tel:${data.nearest_station_phone}`}><PhoneCall className="h-3 w-3" />{data.nearest_station_phone}</a>}</div></div>}

              <div className="p-5"><h3 className="mb-4 text-sm font-bold">Status timeline</h3><ol>{timeline.map((update, index) => <TimelineEntry key={`${update.stage}-${update.created_at}-${index}`} update={update} fallbackPhone={data.nearest_station_phone} />)}</ol></div>
            </aside>
          </div>
        )}

        {data && OPEN_STATUSES.has(data.status) && <div className="mx-auto mt-4 flex max-w-6xl gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"><AlertTriangle className="h-4 w-4 shrink-0" />For immediate danger, call 911. This report does not replace an emergency call.</div>}
        {data?.status === 'ACTIONED' && <div className="mx-auto mt-4 flex max-w-6xl gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 className="h-4 w-4 shrink-0" />A response has been dispatched. Call 911 if the situation becomes immediately dangerous.</div>}
        <div className="mt-5 text-center"><Link href="/" className="text-sm font-semibold text-[#991B1B]">← Submit a new emergency report</Link></div>
      </div>
    </main>
  );
}
