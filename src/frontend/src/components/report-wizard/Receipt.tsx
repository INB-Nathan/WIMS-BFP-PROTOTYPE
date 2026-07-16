'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { CheckCircle2, Copy, PhoneCall, ChevronDown, UserPlus, MapPin, Clock, AlertTriangle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { RouteFeedback } from './RouteFeedback';
import type { RouteState } from './RouteFeedback';
import { SafetyBanner } from './SafetyBanner';
import type { PublicTrackingData } from '@/lib/api/tracking';

export interface ReceiptData {
  reportId: number;
  trackingUrl: string;
  trackingToken: string;
  createdAt: string;
  category: string | null;
  description: string;
  latitude: number;
  longitude: number;
  landmark?: string;
  nearestStation?: { name: string; phone: string | null; lat: number; lng: number } | null;
}

export interface ReceiptProps {
  data: ReceiptData;
  tracking?: PublicTrackingData | null;
  trackingLoading: boolean;
  trackingState: RouteState;
}

/**
 * Post-submit receipt — official BFP-style acknowledgment (Issue #613).
 * Includes QR (tracking URL), copy-to-clipboard token, timestamp, and an
 * additive registration incentive (progressive disclosure).
 */
export function Receipt({ data, tracking, trackingLoading, trackingState }: ReceiptProps) {
  const [copied, setCopied] = useState(false);
  const [showIncentive, setShowIncentive] = useState(false);

  const absoluteTrackingUrl =
    typeof window !== 'undefined'
      ? new URL(data.trackingUrl, window.location.origin).toString()
      : data.trackingUrl;

  async function copyToken() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(data.trackingToken);
      } else {
        // Fallback for non-secure contexts / older browsers.
        const el = document.createElement('textarea');
        el.value = data.trackingToken;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore copy failures
    }
  }

  const when = formatTimestamp(data.createdAt);

  return (
    <div className="ps-has-mesh min-h-screen">
      <SafetyBanner />
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="ps-intent-bg" aria-hidden />
        <div className="relative z-10 text-center py-6 px-4" style={{ background: 'linear-gradient(135deg, var(--red-deep) 0%, var(--red) 100%)' }}>
          <div className="relative w-14 h-14 mx-auto mb-3">
            <Image src="/bfp-logo.svg" alt="BFP Logo" fill className="object-contain" />
          </div>
          <p className="text-xs text-white/50 uppercase tracking-widest mb-1">
            Bureau of Fire Protection
          </p>
          <h1 className="text-xl font-bold text-white">Report Received</h1>
          <p className="text-xs text-white/60 mt-0.5">
            Natanggap ang iyong report
          </p>
        </div>
      </div>

      <div className="relative z-10 max-w-lg mx-auto px-4 mt-4 pb-8">
        <div
          className="ps-card"
        >
          {/* Official receipt header */}
          <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2" style={{ color: 'var(--red)' }}>
              <CheckCircle2 className="w-5 h-5" />
              <span className="text-sm font-bold">Official Acknowledgment</span>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Reference No. <span className="font-mono font-semibold">#{data.reportId}</span>
            </p>
          </div>

          {/* 911 boundary — required on all submissions */}
          <div className="px-5 py-3 ps-warning">
            <AlertTriangle className="w-5 h-5 ps-warning-icon" />
            <div>
              <p className="text-xs font-semibold">
                For immediate danger, call 911 now. This report does not replace an emergency call.
              </p>
              <p className="text-[11px] mt-0.5">
                Kung may agarang peligro, tumawag sa 911 ngayon. Ang report na ito ay hindi kapalit ng agarang tawag sa 911.
              </p>
            </div>
          </div>

          {/* Summary: what / where / when */}
          <div className="px-5 py-4 space-y-3 text-sm">
            <SummaryRow icon={<CheckCircle2 className="w-4 h-4" />} label="What" value={data.category ?? 'Fire report'} />
            {data.description && (
              <div>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Description</p>
                <p className="text-sm mt-0.5" style={{ color: 'var(--text-primary)' }}>{data.description}</p>
              </div>
            )}
            <SummaryRow
              icon={<MapPin className="w-4 h-4" />}
              label="Where"
              value={
                data.latitude != null
                  ? `${data.latitude.toFixed(5)}, ${data.longitude.toFixed(5)}${data.landmark ? ` · ${data.landmark}` : ''}`
                  : '—'
              }
            />
            <SummaryRow icon={<Clock className="w-4 h-4" />} label="When" value={when} />
            {data.nearestStation?.name && (
              <div>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Nearest station</p>
                <p className="text-sm mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                  {data.nearestStation.name}
                  {data.nearestStation.phone && (
                    <a href={`tel:${data.nearestStation.phone}`} className="inline-flex items-center gap-1" style={{ color: 'var(--red)' }}>
                      <PhoneCall className="w-3.5 h-3.5" /> {data.nearestStation.phone}
                    </a>
                  )}
                </p>
              </div>
            )}
          </div>

          {/* Routing feedback (straight-line, 3-state) */}
          <div className="px-5 pb-4">
            <RouteFeedback
              reportLat={data.latitude}
              reportLng={data.longitude}
              station={data.nearestStation ?? null}
              tracking={tracking}
              loading={trackingLoading}
              state={trackingState}
            />
          </div>

          {/* QR + token */}
          <div className="px-5 pb-4 flex gap-4 items-center">
            <div className="p-2 bg-white rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <QRCodeSVG value={absoluteTrackingUrl} size={120} title={`Track report ${data.reportId}`} aria-label={`Track report QR code for ${data.reportId}`} data-testid="qr-code" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                Tracking token
              </p>
              <div className="flex items-center gap-2 mt-1">
                <code
                  data-testid="tracking-token"
                  className="text-xs font-mono break-all flex-1"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {data.trackingToken}
                </code>
                <button
                  type="button"
                  onClick={() => void copyToken()}
                  data-testid="copy-token"
                  aria-label="Copy tracking token"
                  className="ps-btn ps-btn-outline flex-shrink-0"
                  style={{ color: 'var(--red)' }}
                >
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <Link
                href={data.trackingUrl}
                data-testid="tracking-link"
                className="inline-block mt-2 text-xs font-semibold underline break-all"
                style={{ color: 'var(--red)' }}
              >
                {absoluteTrackingUrl}
              </Link>
            </div>
          </div>

          {/* Timestamp */}
          <div className="px-5 pb-4">
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Issued: <span data-testid="receipt-timestamp">{when}</span>
            </p>
          </div>

          {/* Additive registration incentive (progressive disclosure) */}
          <div className="px-5 pb-5">
            <button
              type="button"
              onClick={() => setShowIncentive((v) => !v)}
              data-testid="registration-incentive-toggle"
              aria-expanded={showIncentive}
              className="flex items-center gap-1.5 text-xs font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              <ChevronDown
                className="w-4 h-4 transition-transform"
                style={{ transform: showIncentive ? 'rotate(180deg)' : 'none' }}
              />
              Track all your reports — register as a reporter
            </button>
            {showIncentive && (
              <div
                data-testid="registration-incentive"
                className="mt-2 rounded-lg p-3 text-xs"
                style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-secondary)' }}
              >
                <ul className="space-y-1 mb-2">
                  <li>• Track all your reports in one place</li>
                  <li>• Get status updates</li>
                  <li>• Contribute verified reports</li>
                </ul>
                <p className="mb-2">Your token keeps working even without an account — registering is optional.</p>
                <Link
                  href="/register"
                  className="ps-btn ps-btn-primary inline-flex items-center gap-1.5"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Register to unlock full tracking
                </Link>
              </div>
            )}
          </div>
        </div>

        <Link
          href="/"
          className="ps-btn ps-btn-primary w-full justify-center mt-4"
        >
          Done
        </Link>
      </div>
    </div>
  );
}

function SummaryRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5" style={{ color: 'var(--text-secondary)' }}>{icon}</span>
      <div className="min-w-0">
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</p>
        <p className="text-sm mt-0.5 break-words" style={{ color: 'var(--text-primary)' }}>{value}</p>
      </div>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
