'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  MapPin,
  PhoneCall,
  RefreshCw,
  Route,
} from 'lucide-react';
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
    <li className="ps-tracking-timeline-entry" data-testid="tracking-timeline-entry">
      <span className="ps-tracking-timeline-dot" aria-hidden />
      <div className="flex flex-wrap items-center gap-2">
        <span className="ps-pill ps-pill-slate">{stage}</span>
        <time className="ps-muted text-xs">{formatTimestamp(update.created_at)}</time>
      </div>
      {station && (
        <div className="mt-2 text-sm ps-secondary">
          <p className="font-medium text-[var(--text-primary)]">{station}</p>
          {jurisdiction && <p className="ps-muted text-xs">{jurisdiction}</p>}
          {phone && <a className="ps-tracking-link text-xs font-medium" href={`tel:${phone}`}>{phone}</a>}
        </div>
      )}
      {arrivedAt && <p className="mt-2 text-sm ps-secondary">Arrived: {formatTimestamp(arrivedAt)}</p>}
      {outcome && <p className="mt-2 text-sm ps-secondary">{outcome}</p>}
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
  const [copied, setCopied] = useState(false);

  const trackingUrl = `/tracking/v2/${reportId}/${trackingToken}`;
  const absoluteTrackingUrl = typeof window === 'undefined'
    ? trackingUrl
    : new URL(trackingUrl, window.location.origin).toString();

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
    if (reportId && trackingToken) storeTrackingLink(reportId, trackingUrl);
  }, [reportId, trackingToken, trackingUrl]);

  const copyToken = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(trackingToken);
      } else {
        const input = document.createElement('textarea');
        input.value = trackingToken;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const timeline = data?.status_updates?.length
    ? data.status_updates
    : data ? [{ stage: 'RECEIVED', metadata: null, created_at: data.created_at }] : [];
  const routeGeometry = data && parseLineStringToLatLng(data.routing_geometry)
    ? data.routing_geometry
    : null;

  return (
    <div className="ps-tracking-receipt ps-has-mesh">
      <div className="ps-tracking-hero">
        <div className="ps-intent-bg" aria-hidden />
        <div className="ps-tracking-hero-content">
          <p className="ps-tracking-eyebrow">Official incident receipt</p>
          <h1>Track emergency report</h1>
          <p className="ps-secondary">Keep this secure link or scan the QR code to return to your report.</p>
        </div>
      </div>

      <div className="ps-tracking-inner">
        {loading && (
          <div className="ps-card ps-tracking-state" role="status">
            <RefreshCw className="h-5 w-5 animate-spin" /> Loading your report…
          </div>
        )}
        {error && !loading && (
          <div className="ps-card ps-tracking-state" role="alert">
            <AlertTriangle className="h-8 w-8 text-[var(--orange)]" />
            <p>{error}</p>
            <Link className="ps-btn ps-btn-primary" href="/">Submit a new emergency report</Link>
          </div>
        )}

        {data && !loading && (
          <>
            <section className="ps-card ps-tracking-receipt-card">
              <header className="ps-tracking-receipt-header">
                <p className="ps-tracking-eyebrow">Bureau of Fire Protection</p>
                <h2>Report #{data.report_id}</h2>
                <p className="ps-muted text-xs">Republic of the Philippines · Submitted {formatTimestamp(data.created_at)}</p>
              </header>

              <div className="ps-tracking-receipt-summary">
                <div>
                  <p className="ps-muted text-xs">Current status</p>
                  <span className="ps-pill ps-pill-orange">{STAGE_LABELS[timeline.at(-1)?.stage ?? ''] ?? data.status.replaceAll('_', ' ')}</span>
                </div>
                <div>
                  <p className="ps-muted text-xs">Distance</p>
                  <p className="font-semibold">{formatDistance(data.routing_distance_m)}</p>
                </div>
                <div>
                  <p className="ps-muted text-xs">Travel time</p>
                  <p className="font-semibold">{formatTravelTime(data.routing_duration_s)}</p>
                </div>
              </div>

              <div className="ps-receipt-split">
                <div className="ps-receipt-info">
                  {data.guidance && <p className="ps-secondary text-sm leading-5">{data.guidance}</p>}
                  {data.nearest_station_name && (
                    <div className="ps-tracking-station">
                      <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                      <div>
                        <p className="font-medium">{data.nearest_station_name}</p>
                        {data.nearest_station_phone && <a className="ps-tracking-link text-xs font-medium" href={`tel:${data.nearest_station_phone}`}><PhoneCall className="h-3 w-3" />{data.nearest_station_phone}</a>}
                      </div>
                    </div>
                  )}
                  <p className="ps-muted text-xs">Tracking token</p>
                  <div className="ps-tracking-token-row">
                    <code data-testid="tracking-token" className="ps-receipt-token">{trackingToken}</code>
                    <button type="button" className="ps-btn ps-btn-outline" onClick={() => void copyToken()} aria-label="Copy tracking token">
                      <Copy className="h-3.5 w-3.5" aria-hidden />{copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <div className="ps-receipt-qr-col">
                  <div className="ps-receipt-qr">
                    <QRCodeSVG value={absoluteTrackingUrl} size={120} title={`Track report ${data.report_id}`} aria-label={`Track report QR code for ${data.report_id}`} data-testid="qr-code" />
                  </div>
                  <p className="ps-muted text-xs">Scan to track</p>
                </div>
              </div>
            </section>

            <section className="ps-card ps-tracking-workspace">
              <div className="ps-tracking-map">
                {routeGeometry ? <TrackingRouteMap geometry={routeGeometry} /> : (
                  <div className="ps-tracking-map-fallback" data-testid="routing-text-fallback">
                    <Route className="h-8 w-8" aria-hidden />
                    <p className="font-medium">Road route unavailable</p>
                    <p className="ps-secondary text-sm">Route information will appear here when it becomes available.</p>
                  </div>
                )}
              </div>
              <aside className="ps-tracking-timeline">
                <h3>Status timeline</h3>
                <ol>{timeline.map((update, index) => <TimelineEntry key={`${update.stage}-${update.created_at}-${index}`} update={update} fallbackPhone={data.nearest_station_phone} />)}</ol>
              </aside>
            </section>
          </>
        )}

        {data && OPEN_STATUSES.has(data.status) && <div className="ps-warning"><AlertTriangle className="ps-warning-icon h-5 w-5" />For immediate danger, call 911. This report does not replace an emergency call.</div>}
        {data?.status === 'ACTIONED' && <div className="ps-tracking-success"><CheckCircle2 className="h-5 w-5" />A response has been dispatched. Call 911 if the situation becomes immediately dangerous.</div>}
        <div className="text-center"><Link href="/" className="ps-btn ps-btn-outline">Submit a new emergency report</Link></div>
      </div>
    </div>
  );
}
