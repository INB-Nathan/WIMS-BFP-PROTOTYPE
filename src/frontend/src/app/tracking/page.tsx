'use client';

import { useCallback, useEffect, useState } from 'react';
import { registerNotification, submitFollowup, type CivilianFollowupItem, type CivilianReportTimelineItem, type CivilianReportTrackingResponse, type MyReportItem } from '@/lib/api';
import {
  fetchMyReportsOfflineAware,
  fetchReportStatusOfflineAware,
  fetchReportTimelineOfflineAware,
} from '@/lib/api/offlineCivilianReads';
import { getMessagingToken } from '@/lib/firebase';
import Image from 'next/image';
import Link from 'next/link';
import { AlertTriangle, CheckCircle, Clock, MessageSquare, PhoneCall, RefreshCw, Link2, ChevronRight, Send } from 'lucide-react';
import { EmergencyReferenceCard } from '@/components/EmergencyReferenceCard';

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
    icon: Link2,
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

// ─── Unknown status fallback ────────────────────────────────────────────────
// If backend adds new statuses not yet known to the frontend, render them
// with a neutral warning rather than silently mapping to PENDING.

// ─── Notification helpers ─────────────────────────────────────────────────────

type NotifyStatus = 'idle' | 'enabling' | 'enabled' | 'denied' | 'error';

const notifyKey = (id: number) => `bfp_notify_registered_${id}`;

// ─── Component ───────────────────────────────────────────────────────────────

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

export default function ReportTrackerPage() {
  // Initialize from localStorage wims_last_report: { id: number, category: string }
  const [lastReport, setLastReport] = useState<{ id: number; category: string } | null>(null);
  const [reportIdInput, setReportIdInput] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      const raw = localStorage.getItem('wims_last_report');
      if (!raw) return '';
      const parsed = JSON.parse(raw) as { id?: unknown; category?: unknown };
      if (typeof parsed?.id === 'number' && typeof parsed?.category === 'string') {
        return String(parsed.id);
      }
      return '';
    } catch {
      return '';
    }
  });
  const [data, setData] = useState<CivilianReportTrackingResponse | null>(null);
  const [timeline, setTimeline] = useState<CivilianReportTimelineItem[]>([]);
  const [followups, setFollowups] = useState<CivilianFollowupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [notifyStatus, setNotifyStatus] = useState<NotifyStatus>('idle');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [myReports, setMyReports] = useState<MyReportItem[]>([]);
  const [followupText, setFollowupText] = useState('');
  const [followupSubmitting, setFollowupSubmitting] = useState(false);
  const [followupSuccess, setFollowupSuccess] = useState(false);
  const [followupError, setFollowupError] = useState<string | null>(null);

  // Resolve device ID on mount — used to verify ownership
  useEffect(() => {
    const stored = localStorage.getItem('wims_civilian_device_id');
    if (stored) setDeviceId(stored);
  }, []);

  const searchReport = useCallback(async (id: string) => {
    setFetchError(null);
    setNotifyStatus('idle');
    setFollowupSuccess(false);
    setFollowupError(null);
    if (!id.trim()) {
      setFetchError('Please enter a Report ID.');
      return;
    }
    const currentDeviceId = deviceId ?? localStorage.getItem('wims_civilian_device_id');
    if (!currentDeviceId) {
      setFetchError('This report can only be viewed from the device that submitted it.');
      return;
    }
    setLoading(true);
    setData(null);
    setTimeline([]);
    setFollowups([]);
    try {
      const result = await fetchReportStatusOfflineAware(id.trim(), currentDeviceId);
      setData(result.response);
      if (result.fromCache) {
        setFetchError(null); // clear any stale error when serving from cache
      }
      try {
        const timelineResult = await fetchReportTimelineOfflineAware(id.trim(), currentDeviceId);
        setTimeline(timelineResult.response.timeline);
        setFollowups(timelineResult.response.followups);
      } catch {
        setTimeline([]);
        setFollowups([]);
      }
      if (localStorage.getItem(notifyKey(result.response.report_id)) === 'true') {
        setNotifyStatus('enabled');
      }
    } catch (err: unknown) {
      setFetchError(
        err instanceof Error ? err.message : 'Failed to fetch report status.',
      );
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  // Load last report from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('wims_last_report');
      if (!raw) return;
      const parsed = JSON.parse(raw) as { id?: unknown; category?: unknown };
      if (typeof parsed?.id === 'number' && typeof parsed?.category === 'string') {
        setLastReport({ id: parsed.id, category: parsed.category });
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id?.trim()) return;
    setReportIdInput(id.trim());
    void searchReport(id);
  }, [searchReport]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await searchReport(reportIdInput);
  };

  const handleEnableNotifications = async () => {
    if (!data) return;
    setNotifyStatus('enabling');
    try {
      const token = await getMessagingToken();
      if (!token) { setNotifyStatus('denied'); return; }
      const currentDeviceId = deviceId ?? localStorage.getItem('wims_civilian_device_id');
      if (!currentDeviceId) throw new Error('Missing device token');
      await registerNotification(data.report_id, token, currentDeviceId);
      localStorage.setItem(notifyKey(data.report_id), 'true');
      setNotifyStatus('enabled');
    } catch {
      setNotifyStatus('error');
    }
  };

  const status = data ? parseStatus(data.status) : null;
  const meta = status ? STATUS_META[status] : null;

  // Fetch this device's report history on mount — used to determine ownership
  useEffect(() => {
    if (!deviceId) return;
    fetchMyReportsOfflineAware(deviceId!)
      .then((res) => setMyReports(res.response.reports))
      .catch(() => setMyReports([]));
  }, [deviceId]);

  const handleSubmitFollowup = async () => {
    if (!data || !followupText.trim()) return;
    setFollowupSubmitting(true);
    setFollowupError(null);
    setFollowupSuccess(false);
    try {
      const currentDeviceId = deviceId ?? localStorage.getItem('wims_civilian_device_id');
      if (!currentDeviceId) throw new Error('Missing device token');
      await submitFollowup(data.report_id, followupText.trim(), currentDeviceId);
      setFollowupText('');
      setFollowupSuccess(true);
      // Refresh timeline to show the new follow-up
      try {
        const timelineResult = await fetchReportTimelineOfflineAware(data.report_id, currentDeviceId);
        setTimeline(timelineResult.response.timeline);
        setFollowups(timelineResult.response.followups);
      } catch {
        // Timeline refresh is best-effort
      }
    } catch (err: unknown) {
      setFollowupError(
        err instanceof Error ? err.message : 'Failed to submit follow-up.',
      );
    } finally {
      setFollowupSubmitting(false);
    }
  };

  const isOwner = data ? myReports.some((r) => r.report_id === data.report_id) : false;
  const canUpdate = isOwner && (status === 'PENDING' || status === 'UNDER_REVIEW');

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ background: 'var(--content-bg)' }}>
      {/* Hero — matches /fire-stations style */}
      <div className="text-center py-8 px-4" style={{ background: 'var(--bfp-gradient)' }}>
        <div className="relative w-16 h-16 mx-auto mb-3">
          <Image src="/bfp-logo.svg" alt="BFP Logo" fill className="object-contain" />
        </div>
        <h1 className="text-xl font-bold text-white">Track Emergency Report</h1>
        <p className="text-xs text-white/60 mt-1">Sundin ang status ng iyong report</p>
      </div>

      {/* Emergency hotlines — like /fire-stations */}
      <div className="max-w-lg mx-auto px-4 -mt-4">
        <EmergencyReferenceCard compact />
      </div>

      {/* Main card */}
      <div className="max-w-lg mx-auto px-4 mt-4 pb-8">
        <div className="card overflow-hidden">

        <div className="card-body p-6 space-y-6">

          {/* Search form */}
          <form onSubmit={handleSearch} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                Report ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={reportIdInput}
                  onChange={(e) => setReportIdInput(e.target.value)}
                  className="form-input flex-1"
                  style={{ fontSize: '0.875rem' }}
                  placeholder="e.g., 1024"
                  required
                />
                <button
                  type="submit"
                  disabled={loading || !reportIdInput.trim()}
                  className="px-5 py-3 rounded-xl text-white font-bold text-sm disabled:opacity-50 transition-all flex items-center gap-2"
                  style={{ background: 'var(--bfp-gradient)', boxShadow: '0 2px 8px rgba(153,27,34,0.3)' }}
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    'Track'
                  )}
                </button>
              </div>
            </div>
              {lastReport && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Last report: #{lastReport.id} — {getCategoryLabel(lastReport.category)}
                </p>
              )}

            {fetchError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {fetchError}
              </div>
            )}
          </form>

          {/* ── Results card ──────────────────────────────────────────────── */}
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

                {/* Guidance block — deterministic per status */}
                {data.guidance && (
                  <div className="text-sm p-3 rounded-lg" style={{ backgroundColor: 'var(--content-bg)', color: 'var(--text-primary)' }}>
                    {data.guidance}
                  </div>
                )}

                {/* Status explanation for ACTIONED + rejected states */}
                {(status === 'ACTIONED' || status?.startsWith('REJECTED_')) && data.status_explanation && (
                  <div className="text-sm p-3 rounded-lg border" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--content-bg)', color: 'var(--text-secondary)' }}>
                    <span className="font-medium">Reason: </span>{data.status_explanation}
                  </div>
                )}

                {/* Nearest station — conditional display for 911 vs real station */}
                {(status === 'ACTIONED' || status?.startsWith('REJECTED_')) && data.nearest_station_name && (
                  data.nearest_station_phone === '911' ? (
                    <div className="flex items-start gap-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border-color)' }}>
                      <PhoneCall className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--text-secondary)' }} />
                      <div>
                        <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Emergency Number</p>
                        <a
                          href="tel:911"
                          className="text-sm font-medium mt-1 inline-flex items-center gap-1"
                          style={{ color: 'var(--bfp-red, #dc2626)' }}
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                          911
                        </a>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                          For follow-up, contact your nearest BFP station. For immediate danger, call 911.
                        </p>
                      </div>
                    </div>
                  ) : (
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
                  )
                )}

                {/* 911 boundary — ALL statuses, prominence varies */}
                {(status === 'PENDING' || status === 'UNDER_REVIEW' || status === 'LINKED') && (
                  <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50">
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600" />
                    <div>
                      <p className="text-sm font-semibold text-red-700">For urgent emergencies, call 911.</p>
                      <p className="text-xs text-red-600 mt-0.5">Kung kailangan mo ng agarang tulong, tumawag sa 911.</p>
                      <p className="text-xs text-red-600 mt-1">
                        This report helps BFP review signals — it does not replace an emergency call.
                      </p>
                      <p className="text-xs text-red-600 mt-0.5">
                        Ang report na ito ay tumutulong sa BFP na suriin ang mga signal — hindi ito kapalit ng agarang tawag sa 911.
                      </p>
                    </div>
                  </div>
                )}

                {status === 'ACTIONED' && (
                  <div className="flex items-start gap-2 p-2 rounded-lg" style={{ backgroundColor: 'var(--content-bg)', border: '1px solid var(--border-color)' }}>
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--text-secondary)' }} />
                    <div>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        For immediate danger, call 911. Ang report na ito ay hindi kapalit ng agarang tawag sa 911.
                      </p>
                    </div>
                  </div>
                )}

                {status?.startsWith('REJECTED_') && (
                  <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50">
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600" />
                    <div>
                      <p className="text-sm font-semibold text-red-700">For urgent emergencies, call 911.</p>
                      <p className="text-xs text-red-600 mt-0.5">Kung kailangan mo ng agarang tulong, tumawag sa 911.</p>
                    </div>
                  </div>
                )}

                {/* Timeline */}
                {timeline.length > 0 && (
                  <div className="border rounded-lg p-3 mb-2" style={{ borderColor: 'var(--border-color)' }}>
                    <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                      Timeline
                    </p>
                    <div className="space-y-2">
                      {[...timeline].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map((item) => {
                        const itemStatus = parseStatus(item.status);
                        const itemMeta = STATUS_META[itemStatus];
                        return (
                          <div key={item.report_id} className="border rounded-lg p-3 mb-2" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--content-bg)' }}>
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                                  #{item.report_id}
                                </span>
                                {itemMeta && (
                                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${itemMeta.badgeColor}`}>
                                    {itemMeta.badge}
                                  </span>
                                )}
                                {item.status === 'LINKED' && (
                                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">
                                    Update
                                  </span>
                                )}
                              </div>
                              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                {new Date(item.created_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                              </span>
                            </div>
                            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                              {getCategoryLabel(item.category)} {item.sub_category ? `/ ${item.sub_category}` : ''}
                            </p>
                            {item.status_explanation && (
                              <p className="text-sm text-gray-700">{item.status_explanation}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Follow-up entries */}
                    {followups.length > 0 && (
                      <div className="mt-3 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
                        <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                          Follow-ups
                        </p>
                        <div className="space-y-2">
                          {followups.map((f) => (
                            <div key={f.followup_id} className="border rounded-lg p-3" style={{ borderColor: 'var(--bfp-red, #dc2626)', backgroundColor: '#fef2f2' }}>
                              <div className="flex items-center gap-2 mb-1">
                                <MessageSquare className="w-3.5 h-3.5" style={{ color: 'var(--bfp-red, #dc2626)' }} />
                                <span className="text-xs font-medium" style={{ color: 'var(--bfp-red, #dc2626)' }}>
                                  Your update
                                </span>
                                <span className="text-xs ml-auto" style={{ color: 'var(--text-secondary)' }}>
                                  {new Date(f.created_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                                </span>
                              </div>
                              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{f.followup_text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Follow-up submission form — PENDING / UNDER_REVIEW / LINKED only */}
                {(status === 'PENDING' || status === 'UNDER_REVIEW' || status === 'LINKED') && (
                  <div className="border rounded-lg p-3 mb-2" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <MessageSquare className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        Add Follow-up Information
                      </p>
                    </div>
                    <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                      Provide additional details about this report. Do not include personal information beyond what you&apos;ve already shared.
                    </p>
                    <textarea
                      value={followupText}
                      onChange={(e) => setFollowupText(e.target.value)}
                      className="form-input w-full mb-2"
                      style={{ fontSize: '0.875rem', minHeight: '80px', resize: 'vertical' }}
                      placeholder="Describe new developments, corrections, or additional details…"
                      maxLength={2000}
                      rows={3}
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {followupText.length}/2000
                      </span>
                      <button
                        onClick={handleSubmitFollowup}
                        disabled={followupSubmitting || !followupText.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-xs font-semibold disabled:opacity-50 transition-all"
                        style={{ background: 'var(--bfp-gradient)' }}
                      >
                        {followupSubmitting ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Send className="w-3.5 h-3.5" />
                        )}
                        Submit Update
                      </button>
                    </div>
                    {followupSuccess && (
                      <div className="flex items-center gap-2 mt-2 p-2 rounded-lg bg-green-50 text-green-700 text-xs">
                        <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        Follow-up submitted successfully.
                      </div>
                    )}
                    {followupError && (
                      <div className="flex items-center gap-2 mt-2 p-2 rounded-lg bg-red-50 text-red-700 text-xs">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        {followupError}
                      </div>
                    )}
                  </div>
                )}

                {/* Notification opt-in — PENDING only */}
                {status === 'PENDING' && notifyStatus !== 'enabled' && (
                  <div className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: 'var(--border-color)' }}>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Get notified when your report is reviewed
                    </p>
                    <button
                      onClick={handleEnableNotifications}
                      disabled={notifyStatus === 'enabling'}
                      className="ml-4 px-4 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-50"
                      style={{ background: 'var(--bfp-gradient)' }}
                    >
                      {notifyStatus === 'enabling' ? 'Enabling…' : 'Enable'}
                    </button>
                  </div>
                )}
                {notifyStatus === 'enabled' && status === 'PENDING' && (
                  <div className="p-3 rounded-lg border border-green-200 bg-green-50 text-green-700 text-sm flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    Notifications enabled — you&apos;ll be alerted when this report is reviewed.
                  </div>
                )}
                {notifyStatus === 'denied' && (
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Notification permission denied. Enable it in your browser settings to get updates.
                  </p>
                )}
                {notifyStatus === 'error' && (
                  <p className="text-xs text-red-500">Failed to enable notifications. Please try again.</p>
                )}

                {/* ── Update Report (owner only, PENDING/UNDER_REVIEW) ── */}
                {canUpdate && (
                  <Link
                    href={`/?update_report_id=${data.report_id}`}
                    className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl border text-sm font-semibold transition-colors"
                    style={{ borderColor: 'var(--bfp-maroon)', color: 'var(--bfp-maroon)', backgroundColor: 'transparent' }}
                  >
                    Update This Report
                  </Link>
                )}

                {/* Metadata footer */}
                <div className="pt-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span>Report #{data.report_id}</span>
                    {data.category && (
                      <span className="ml-2">· {data.category}{data.sub_category ? ` / ${data.sub_category}` : ''}</span>
                    )}
                  </div>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {new Date(data.created_at).toLocaleString('en-PH', { timeStyle: 'short', dateStyle: 'medium' })}
                  </span>
                </div>

                {/* Submit new report referencing current — terminal/rejected states only.
                    ACTIONED means responders were dispatched — that is a positive outcome,
                    not a terminal dead-end. Follow-up is only appropriate after rejection. */}
                {(status === 'ACTIONED' || status?.startsWith('REJECTED_')) && (
                  <Link
                    href={`/?previous_report_id=${data.report_id}`}
                    className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
                    style={{ background: 'var(--bfp-gradient)' }}
                  >
                    Submit Follow-up Report
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                )}

              </div>
            </div>
          )}

          {/* Initial prompt — shown only when no search has been done yet */}
          {!data && !fetchError && !loading && (
            <div className="text-center py-4 space-y-1">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Enter your Report ID to check its status.
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Your Report ID is in the confirmation message after submission.
              </p>
            </div>
          )}

          {/* Footer nav */}
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
