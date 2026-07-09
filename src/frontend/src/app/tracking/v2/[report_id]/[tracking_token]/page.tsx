'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, CheckCircle, Clock, MapPin, PhoneCall, RefreshCw, ChevronRight } from 'lucide-react';
import { EmergencyReferenceCard } from '@/components/EmergencyReferenceCard';
import { ApiRequestError } from '@/lib/api/errors';
import { publicApiFetch } from '@/lib/api/public-transport';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TrackingData {
  report_id: number;
  latitude: number;
  longitude: number;
  category: string | null;
  sub_category: string | null;
  safety_status: string | null;
  trust_score: number;
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
  badgeColor: string;
  heading: string;
  headingSub: string;
  cardBg: string;
  cardBorder: string;
  headingColor: string;
  iconColor: string;
}> = {
  PENDING: {
    icon: Clock,
    badge: 'PENDING',
    badgeColor: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    heading: 'Report Received',
    headingSub: 'Nakatanggap kami ng iyong report.',
    cardBg: 'bg-yellow-50',
    cardBorder: 'border-yellow-200',
    headingColor: 'text-yellow-900',
    iconColor: 'text-yellow-600',
  },
  UNDER_REVIEW: {
    icon: Clock,
    badge: 'UNDER REVIEW',
    badgeColor: 'bg-blue-100 text-blue-800 border-blue-300',
    heading: 'Under Review',
    headingSub: 'Ang iyong report ay kasalukuyang sinusuri.',
    cardBg: 'bg-blue-50',
    cardBorder: 'border-blue-200',
    headingColor: 'text-blue-900',
    iconColor: 'text-blue-600',
  },
  LINKED: {
    icon: Clock,
    badge: 'LINKED',
    badgeColor: 'bg-blue-100 text-blue-800 border-blue-300',
    heading: 'Linked to Active BFP Operation',
    headingSub: 'Your report has been linked to an active BFP operation.',
    cardBg: 'bg-blue-50',
    cardBorder: 'border-blue-200',
    headingColor: 'text-blue-900',
    iconColor: 'text-blue-600',
  },
  ACTIONED: {
    icon: CheckCircle,
    badge: 'ACTIONED',
    badgeColor: 'bg-green-100 text-green-800 border-green-300',
    heading: 'Response Dispatched',
    headingSub: 'Na-deploy na ang responder.',
    cardBg: 'bg-green-50',
    cardBorder: 'border-green-200',
    headingColor: 'text-green-900',
    iconColor: 'text-green-600',
  },
  REJECTED_BOGUS: {
    icon: AlertTriangle,
    badge: 'REJECTED — BOGUS',
    badgeColor: 'bg-red-100 text-red-800 border-red-300',
    heading: 'Report Not Actionable',
    headingSub: 'Hindi maisasagawa ang iyong report.',
    cardBg: 'bg-red-50',
    cardBorder: 'border-red-200',
    headingColor: 'text-red-900',
    iconColor: 'text-red-600',
  },
  REJECTED_DUPLICATE: {
    icon: AlertTriangle,
    badge: 'REJECTED — DUPLICATE',
    badgeColor: 'bg-red-100 text-red-800 border-red-300',
    heading: 'Duplicate Report',
    headingSub: 'Umiiral na ang insidenteng ito.',
    cardBg: 'bg-red-50',
    cardBorder: 'border-red-200',
    headingColor: 'text-red-900',
    iconColor: 'text-red-600',
  },
  REJECTED_INSUFFICIENT: {
    icon: AlertTriangle,
    badge: 'REJECTED — INSUFFICIENT',
    badgeColor: 'bg-red-100 text-red-800 border-red-300',
    heading: 'Insufficient Information',
    headingSub: 'Hindi sapat ang datos para magsagawa.',
    cardBg: 'bg-red-50',
    cardBorder: 'border-red-200',
    headingColor: 'text-red-900',
    iconColor: 'text-red-600',
  },
  REJECTED_TIMEOUT: {
    icon: AlertTriangle,
    badge: 'REJECTED — TIMEOUT',
    badgeColor: 'bg-red-100 text-red-800 border-red-300',
    heading: 'Report Expired',
    headingSub: 'Ang report ay nag-expire na.',
    cardBg: 'bg-red-50',
    cardBorder: 'border-red-200',
    headingColor: 'text-red-900',
    iconColor: 'text-red-600',
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

  const status = data ? parseStatus(data.status) : null;
  const meta = status ? STATUS_META[status] : null;

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ background: 'var(--content-bg)' }}>
      {/* Hero */}
      <div className="text-center py-8 px-4" style={{ background: 'var(--bfp-gradient)' }}>
        <div className="relative w-16 h-16 mx-auto mb-3">
          <Image src="/bfp-logo.svg" alt="BFP Logo" fill className="object-contain" />
        </div>
        <h1 className="text-xl font-bold text-white">Track Emergency Report</h1>
        <p className="text-xs text-white/60 mt-1">Sundin ang status ng iyong report</p>
      </div>

      {/* Emergency hotlines */}
      <div className="max-w-lg mx-auto px-4 -mt-4">
        <EmergencyReferenceCard compact />
      </div>

      {/* Main card */}
      <div className="max-w-lg mx-auto px-4 mt-4 pb-8">
        <div className="card overflow-hidden">
          <div className="card-body p-6 space-y-6">

            {/* Loading state */}
            {loading && (
              <div className="flex flex-col items-center py-8 space-y-3">
                <RefreshCw className="w-8 h-8 animate-spin" style={{ color: 'var(--bfp-maroon)' }} />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Loading your report…
                </p>
              </div>
            )}

            {/* Error state */}
            {error && !loading && (
              <div className="flex flex-col items-center py-8 space-y-3">
                <AlertTriangle className="w-8 h-8" style={{ color: 'var(--text-secondary)' }} />
                <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
                  {error}
                </p>
                <Link
                  href="/"
                  className="text-sm font-medium text-red-600 hover:text-red-800 transition-colors"
                >
                  &larr; Submit a New Emergency Report
                </Link>
              </div>
            )}

            {/* Results */}
            {data && meta && (
              <div className="border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                {/* Status banner */}
                <div className={`p-4 ${meta.cardBg} border-b ${meta.cardBorder}`}>
                  <div className="flex items-start gap-3">
                    <meta.icon className={`w-6 h-6 mt-0.5 flex-shrink-0 ${meta.iconColor}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${meta.badgeColor}`}>
                          {meta.badge}
                        </span>
                        {data.related_cluster_status && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-purple-100 text-purple-700 border-purple-200">
                            Cluster: {data.related_cluster_status}
                          </span>
                        )}
                      </div>
                      <h2 className={`text-base font-bold mt-2 ${meta.headingColor}`}>{meta.heading}</h2>
                      <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        {meta.headingSub}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4 bg-white">
                  {/* Guidance */}
                  {data.guidance && (
                    <div className="text-sm p-3 rounded-lg" style={{ backgroundColor: 'var(--content-bg)', color: 'var(--text-primary)' }}>
                      {data.guidance}
                    </div>
                  )}

                  {/* Status explanation */}
                  {(status === 'ACTIONED' || status?.startsWith('REJECTED_')) && data.status_explanation && (
                    <div className="text-sm p-3 rounded-lg border" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--content-bg)', color: 'var(--text-secondary)' }}>
                      <span className="font-medium">Reason: </span>{data.status_explanation}
                    </div>
                  )}

                  {/* Nearest station */}
                  {data.nearest_station_name && (
                    <div className="flex items-start gap-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border-color)' }}>
                      <PhoneCall className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--bfp-red, #dc2626)' }} />
                      <div>
                        <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Nearest BFP Station</p>
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{data.nearest_station_name}</p>
                        {data.nearest_station_phone && (
                          <a
                            href={`tel:${data.nearest_station_phone}`}
                            className="text-sm font-medium mt-1 inline-flex items-center gap-1"
                            style={{ color: 'var(--bfp-red, #dc2626)' }}
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
                    <div className="flex items-start gap-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border-color)' }}>
                      <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--bfp-maroon)' }} />
                      <div>
                        <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                          Estimated Travel Time if Dispatched
                        </p>
                        <p className="text-sm font-medium mt-1" style={{ color: 'var(--text-primary)' }}>
                          {formatDistance(data.routing_distance_m)} &middot; {formatTravelTime(data.routing_duration_s)}
                        </p>
                        {data.routing_data_source && (
                          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                            Source: {data.routing_data_source === 'osrm' ? 'Road data' : 'Estimated'}
                          </p>
                        )}
                        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                          Actual BFP dispatch may differ.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Photo evidence count */}
                  {data.photo_count > 0 && (
                    <div className="flex items-start gap-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border-color)' }}>
                      <div>
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          {data.photo_count} photo{data.photo_count !== 1 ? 's' : ''} attached
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 911 boundary */}
                  {status === 'ACTIONED' && (
                    <div className="flex items-start gap-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--content-bg)', border: '1px solid var(--border-color)' }}>
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--text-secondary)' }} />
                      <div>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          For immediate danger, call 911. Ang report na ito ay hindi kapalit ng agarang tawag sa 911.
                        </p>
                      </div>
                    </div>
                  )}
                  {(status === 'PENDING' || status === 'UNDER_REVIEW' || status === 'LINKED') && (
                    <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50">
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600" />
                      <div>
                        <p className="text-sm font-semibold text-red-700">For urgent emergencies, call 911.</p>
                        <p className="text-xs text-red-600 mt-0.5">Kung kailangan mo ng agarang tulong, tumawag sa 911.</p>
                        <p className="text-xs text-red-600 mt-1">
                          This report helps BFP review signals — it does not replace an emergency call.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Metadata footer */}
                  <div className="pt-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <span>Report #{data.report_id}</span>
                      {data.category && (
                        <span className="ml-2">· {getCategoryLabel(data.category)}</span>
                      )}
                    </div>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {new Date(data.created_at).toLocaleString('en-PH', { timeStyle: 'short', dateStyle: 'medium' })}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Submit new report link */}
            <div className="pt-4 border-t text-center" style={{ borderColor: 'var(--border-color)' }}>
              <Link
                href="/"
                className="text-sm font-medium text-red-600 hover:text-red-800 transition-colors"
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
