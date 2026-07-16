'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, CheckCircle, Clock, MapPin, PhoneCall, RefreshCw } from 'lucide-react';
import { EmergencyReferenceCard } from '@/components/EmergencyReferenceCard';
import { ApiRequestError } from '@/lib/api/errors';
import { publicApiFetch } from '@/lib/api/public-transport';
import { TrackingRouteMap } from './TrackingRouteMap';

const TRACKING_LINKS_BY_REPORT_KEY = 'wims_tracking_links_by_report';

function storeTrackingLink(reportId: string, trackingUrl: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(TRACKING_LINKS_BY_REPORT_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') next[key] = value;
    }
    next[reportId] = trackingUrl;
    localStorage.setItem(TRACKING_LINKS_BY_REPORT_KEY, JSON.stringify(next));
  } catch {}
}

// ─── Locked dark design tokens ────────────────────────────────────────────
// Matches PublicHeader.tsx (#609) and prototypes/public-surface/index.html:
// near-black base, blue chrome, red reserved for emergency/alert accents.

const T = {
  bgBase: '#111116',
  bgElevated: '#18181d',
  bgSurface: '#202026',
  textPrimary: '#e8e8ed',
  textSecondary: 'rgba(232,232,237,0.65)',
  textMuted: 'rgba(232,232,237,0.38)',
  border: 'rgba(255,255,255,0.06)',
  borderStrong: 'rgba(255,255,255,0.12)',
  blue: '#3b82f6',
  blueBg: 'rgba(59,130,246,0.12)',
  red: '#dc2626',
  redLight: '#ef4444',
  redBg: 'rgba(220,38,38,0.15)',
  green: '#059669',
  greenLight: '#34d399',
  greenBg: 'rgba(5,150,105,0.12)',
  yellow: '#d97706',
  yellowLight: '#fbbf24',
  yellowBg: 'rgba(217,119,6,0.12)',
  purple: '#a78bfa',
  purpleBg: 'rgba(167,139,250,0.14)',
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

interface TrackingData {
  report_id: number;
  category: string | null;
  sub_category: string | null;
  reporting_context: string | null;
  safety_status: string | null;
  status: string;
  status_explanation: string | null;
  guidance: string | null;
  escalation_guidance: string | null;
  related_cluster_status: string | null;
  nearest_station_name: string | null;
  nearest_station_phone: string | null;
  routing_distance_m: number | null;
  routing_duration_s: number | null;
  routing_data_source: string | null;
  // Backend CivilianTrackingResponse (schemas/civilian.py) returns this GeoJSON
  // LineString dict when OSRM routing succeeded at submission time (#611). Null
  // for pre-migration rows or when OSRM was unreachable — must render gracefully.
  routing_geometry: Record<string, unknown> | null;
  photo_count: number;
  submitter_type: string;
  link_count: number;
  created_at: string;
}

// ─── Status helpers ─────────────────────────────────────────────────────────

type TrackingStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'LINKED'
  | 'ACTIONED'
  | 'REJECTED_BOGUS'
  | 'REJECTED_DUPLICATE'
  | 'REJECTED_INSUFFICIENT'
  | 'REJECTED_TIMEOUT';

const STATUS_META: Record<TrackingStatus, {
  icon: React.ElementType;
  badge: string;
  accent: string;
  accentBg: string;
  heading: string;
  headingSub: string;
}> = {
  PENDING: {
    icon: Clock,
    badge: 'PENDING',
    accent: T.yellowLight,
    accentBg: T.yellowBg,
    heading: 'Report Received',
    headingSub: 'Nakatanggap kami ng iyong report.',
  },
  UNDER_REVIEW: {
    icon: Clock,
    badge: 'UNDER REVIEW',
    accent: T.blue,
    accentBg: T.blueBg,
    heading: 'Under Review',
    headingSub: 'Ang iyong report ay kasalukuyang sinusuri.',
  },
  LINKED: {
    icon: Clock,
    badge: 'LINKED',
    accent: T.blue,
    accentBg: T.blueBg,
    heading: 'Linked to Active BFP Operation',
    headingSub: 'Your report has been linked to an active BFP operation.',
  },
  ACTIONED: {
    icon: CheckCircle,
    badge: 'ACTIONED',
    accent: T.greenLight,
    accentBg: T.greenBg,
    heading: 'Response Dispatched',
    headingSub: 'Na-deploy na ang responder.',
  },
  REJECTED_BOGUS: {
    icon: AlertTriangle,
    badge: 'REJECTED — BOGUS',
    accent: T.redLight,
    accentBg: T.redBg,
    heading: 'Report Not Actionable',
    headingSub: 'Hindi maisasagawa ang iyong report.',
  },
  REJECTED_DUPLICATE: {
    icon: AlertTriangle,
    badge: 'REJECTED — DUPLICATE',
    accent: T.redLight,
    accentBg: T.redBg,
    heading: 'Duplicate Report',
    headingSub: 'Umiiral na ang insidenteng ito.',
  },
  REJECTED_INSUFFICIENT: {
    icon: AlertTriangle,
    badge: 'REJECTED — INSUFFICIENT',
    accent: T.redLight,
    accentBg: T.redBg,
    heading: 'Insufficient Information',
    headingSub: 'Hindi sapat ang datos para magsagawa.',
  },
  REJECTED_TIMEOUT: {
    icon: AlertTriangle,
    badge: 'REJECTED — TIMEOUT',
    accent: T.redLight,
    accentBg: T.redBg,
    heading: 'Report Expired',
    headingSub: 'Ang report ay nag-expire na.',
  },
};

function parseStatus(raw: string): TrackingStatus {
  const upper = (raw ?? '').toUpperCase().trim() as TrackingStatus;
  if (upper in STATUS_META) return upper;
  return 'PENDING';
}

function formatTravelTime(duration_s: number | null): string {
  if (duration_s === null) return 'Pending…';
  if (duration_s < 180) return 'Under 5 minutes';
  if (duration_s > 1800) return '30+ minutes';

  // ±30% traffic buffer
  const lower = Math.max(1, Math.round(duration_s * 0.7 / 60));
  const upper = Math.ceil(duration_s * 1.3 / 60);
  return `${lower}–${upper} minutes`;
}

function formatDistance(meters: number | null): string {
  if (meters === null) return 'Pending…';
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

const CATEGORY_LABELS: Record<string, string> = {
  STRUCTURAL: 'Structural fire',
  NON_STRUCTURAL: 'Non-structural fire',
  TRANSPORTATION: 'Vehicle fire',
  UNSURE: 'Unsure',
};

function getCategoryLabel(category: string | null): string {
  if (!category) return 'Unknown';
  return CATEGORY_LABELS[category] ?? category;
}

// ─── Page Component ──────────────────────────────────────────────────────────

export default function TrackingV2Page() {
  const params = useParams();
  const report_id = params.report_id as string;
  const tracking_token = params.tracking_token as string;

  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTracking = useCallback(async () => {
    if (!report_id || !tracking_token) {
      setError('Missing tracking information.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await publicApiFetch<TrackingData>(
        `/civilian/reports/${report_id}/track/${tracking_token}`,
      );
      setData(result);
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && err.status === 404) {
        setError('Report not found. The link may be invalid or expired.');
      } else {
        setError(
          err instanceof Error ? err.message : 'Failed to fetch report status.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [report_id, tracking_token]);

  useEffect(() => {
    fetchTracking();
  }, [fetchTracking]);

  useEffect(() => {
    if (!report_id || !tracking_token) return;
    storeTrackingLink(report_id, `/tracking/v2/${report_id}/${tracking_token}`);
  }, [report_id, tracking_token]);

  const status = data ? parseStatus(data.status) : null;
  const meta = status ? STATUS_META[status] : null;

  // ─── Render ─────────────────────────────────────────────────────────────
  // Note: the shared PublicHeader (#609) already renders the BFP brand/logo
  // above this page for the `/tracking` route (see routeUtils.ts
  // PUBLIC_ROUTE_PREFIXES). This page intentionally does NOT render its own
  // hero/logo banner to avoid a duplicate header (previously a
  // "Track Emergency Report" gradient hero lived here) — just a compact
  // section title below the shared header.

  return (
    <div className="min-h-screen" style={{ background: T.bgBase }}>
      {/* Page title (compact — PublicHeader above provides the BFP brand block) */}
      <div className="text-center pt-6 pb-4 px-4">
        <h1 className="text-lg font-bold" style={{ color: T.textPrimary }}>Track Emergency Report</h1>
        <p className="text-xs mt-1" style={{ color: T.textSecondary }}>Sundin ang status ng iyong report</p>
      </div>

      {/* Emergency hotlines */}
      <div className="max-w-lg mx-auto px-4">
        <EmergencyReferenceCard compact dark />
      </div>

      {/* Main card */}
      <div className="max-w-lg mx-auto px-4 mt-4 pb-8">
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: T.bgElevated, border: `1px solid ${T.border}` }}
        >
          <div className="p-6 space-y-6">

            {/* Loading state */}
            {loading && (
              <div className="flex flex-col items-center py-8 space-y-3">
                <RefreshCw className="w-8 h-8 animate-spin" style={{ color: T.blue }} />
                <p className="text-sm" style={{ color: T.textSecondary }}>
                  Loading your report…
                </p>
              </div>
            )}

            {/* Error state */}
            {error && !loading && (
              <div className="flex flex-col items-center py-8 space-y-3">
                <AlertTriangle className="w-8 h-8" style={{ color: T.textSecondary }} />
                <p className="text-sm text-center" style={{ color: T.textSecondary }}>
                  {error}
                </p>
                <Link
                  href="/"
                  className="text-sm font-medium transition-colors"
                  style={{ color: T.redLight }}
                >
                  &larr; Submit a New Emergency Report
                </Link>
              </div>
            )}

            {/* Results */}
            {data && meta && (
              <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
                {/* Status banner */}
                <div
                  className="p-4"
                  style={{ background: meta.accentBg, borderBottom: `1px solid ${T.border}` }}
                >
                  <div className="flex items-start gap-3">
                    <meta.icon className="w-6 h-6 mt-0.5 flex-shrink-0" style={{ color: meta.accent }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-xs font-bold px-2 py-0.5 rounded-full border"
                          style={{ color: meta.accent, borderColor: meta.accent, background: T.bgBase }}
                        >
                          {meta.badge}
                        </span>
                        {data.related_cluster_status && (
                          <span
                            className="text-xs font-medium px-2 py-0.5 rounded-full border"
                            style={{ color: T.purple, borderColor: T.purple, background: T.purpleBg }}
                          >
                            Cluster: {data.related_cluster_status}
                          </span>
                        )}
                      </div>
                      <h2 className="text-base font-bold mt-2" style={{ color: T.textPrimary }}>{meta.heading}</h2>
                      <p className="text-sm mt-0.5" style={{ color: T.textSecondary }}>
                        {meta.headingSub}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4" style={{ background: T.bgSurface }}>
                  {/* Guidance */}
                  {data.guidance && (
                    <div className="text-sm p-3 rounded-lg" style={{ background: T.bgBase, color: T.textPrimary }}>
                      {data.guidance}
                    </div>
                  )}

                  {/* Status explanation */}
                  {(status === 'ACTIONED' || status?.startsWith('REJECTED_')) && data.status_explanation && (
                    <div className="text-sm p-3 rounded-lg border" style={{ borderColor: T.border, background: T.bgBase, color: T.textSecondary }}>
                      <span className="font-medium" style={{ color: T.textPrimary }}>Reason: </span>{data.status_explanation}
                    </div>
                  )}

                  {/* Nearest station */}
                  {data.nearest_station_name && (
                    <div className="flex items-start gap-3 p-3 rounded-lg border" style={{ borderColor: T.border }}>
                      <PhoneCall className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: T.red }} />
                      <div>
                        <p className="text-xs font-semibold" style={{ color: T.textSecondary }}>Nearest BFP Station</p>
                        <p className="text-sm font-medium" style={{ color: T.textPrimary }}>{data.nearest_station_name}</p>
                        {data.nearest_station_phone && (
                          <a
                            href={`tel:${data.nearest_station_phone}`}
                            className="text-sm font-medium mt-1 inline-flex items-center gap-1"
                            style={{ color: T.red }}
                          >
                            <PhoneCall className="w-3.5 h-3.5" />
                            {data.nearest_station_phone}
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Routing information */}
                  {(data.routing_distance_m !== null || data.routing_duration_s !== null) && (
                    <div className="flex items-start gap-3 p-3 rounded-lg border" style={{ borderColor: T.border }}>
                      <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: T.blue }} />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div>
                          <p className="text-xs font-semibold" style={{ color: T.textSecondary }}>
                            Estimated Travel Time if Dispatched
                          </p>
                          <p className="text-sm font-medium mt-1" style={{ color: T.textPrimary }}>
                            {formatDistance(data.routing_distance_m)} &middot; {formatTravelTime(data.routing_duration_s)}
                          </p>
                          {data.routing_data_source && (
                            <p className="text-xs mt-1" style={{ color: T.textSecondary }}>
                              Source: {data.routing_data_source === 'osrm' ? 'Road data' : 'Estimated'}
                            </p>
                          )}
                          <p className="text-xs mt-1" style={{ color: T.textSecondary }}>
                            Actual BFP dispatch may differ.
                          </p>
                        </div>

                        {/* Route map — only rendered when routing_geometry is present (#611/B1) */}
                        <TrackingRouteMap geometry={data.routing_geometry} />
                      </div>
                    </div>
                  )}

                  {/* Photo evidence count */}
                  {data.photo_count > 0 && (
                    <div className="flex items-start gap-3 p-3 rounded-lg border" style={{ borderColor: T.border }}>
                      <div>
                        <p className="text-sm font-medium" style={{ color: T.textPrimary }}>
                          {data.photo_count} photo{data.photo_count !== 1 ? 's' : ''} attached
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 911 boundary */}
                  {status === 'ACTIONED' && (
                    <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: T.bgBase, border: `1px solid ${T.border}` }}>
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: T.textSecondary }} />
                      <div>
                        <p className="text-xs" style={{ color: T.textSecondary }}>
                          For immediate danger, call 911. Ang report na ito ay hindi kapalit ng agarang tawag sa 911.
                        </p>
                      </div>
                    </div>
                  )}
                  {(status === 'PENDING' || status === 'UNDER_REVIEW' || status === 'LINKED') && (
                    <div className="flex items-start gap-2 p-3 rounded-lg border" style={{ borderColor: 'rgba(220,38,38,0.3)', background: T.redBg }}>
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: T.redLight }} />
                      <div>
                        <p className="text-sm font-semibold" style={{ color: T.redLight }}>For urgent emergencies, call 911.</p>
                        <p className="text-xs mt-0.5" style={{ color: T.textSecondary }}>Kung kailangan mo ng agarang tulong, tumawag sa 911.</p>
                        <p className="text-xs mt-1" style={{ color: T.textSecondary }}>
                          This report helps BFP review signals — it does not replace an emergency call.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Metadata footer */}
                  <div className="pt-3 border-t flex items-center justify-between" style={{ borderColor: T.border }}>
                    <div className="text-xs" style={{ color: T.textSecondary }}>
                      <span>Report #{data.report_id}</span>
                      {data.category && (
                        <span className="ml-2">· {getCategoryLabel(data.category)}</span>
                      )}
                    </div>
                    <span className="text-xs" style={{ color: T.textSecondary }}>
                      {new Date(data.created_at).toLocaleString('en-PH', { timeStyle: 'short', dateStyle: 'medium' })}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Submit new report link */}
            <div className="pt-4 border-t text-center" style={{ borderColor: T.border }}>
              <Link
                href="/"
                className="text-sm font-medium transition-colors"
                style={{ color: T.redLight }}
              >
                &larr; Submit a New Emergency Report
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
