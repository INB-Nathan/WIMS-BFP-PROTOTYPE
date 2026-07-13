'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ChevronRight, Link2 } from 'lucide-react';
import { EmergencyReferenceCard } from '@/components/EmergencyReferenceCard';

type LastReportRecord = {
  id?: unknown;
  category?: unknown;
  tracking_url?: unknown;
};

const LAST_REPORT_KEY = 'wims_last_report';
const TRACKING_LINKS_BY_REPORT_KEY = 'wims_tracking_links_by_report';

function readStoredTrackingUrl(reportId: string | null): string | null {
  if (typeof window === 'undefined') return null;
  try {
    if (reportId) {
      const indexedRaw = localStorage.getItem(TRACKING_LINKS_BY_REPORT_KEY);
      if (indexedRaw) {
        const indexed = JSON.parse(indexedRaw) as Record<string, unknown>;
        const candidate = indexed[reportId];
        if (typeof candidate === 'string' && candidate.startsWith('/tracking/v2/')) {
          return candidate;
        }
      }
    }

    const raw = localStorage.getItem(LAST_REPORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastReportRecord;
    return typeof parsed.tracking_url === 'string' && parsed.tracking_url.startsWith('/tracking/v2/')
      ? parsed.tracking_url
      : null;
  } catch {
    return null;
  }
}

export default function ReportTrackerCompatibilityPage() {
  const searchParams = useSearchParams();
  const reportId = searchParams.get('report_id');
  const [trackingUrl] = useState<string | null>(() => readStoredTrackingUrl(reportId));

  return (
    <div className="min-h-screen" style={{ background: 'var(--content-bg)' }}>
      <div className="text-center py-8 px-4" style={{ background: 'var(--bfp-gradient)' }}>
        <div className="relative w-16 h-16 mx-auto mb-3">
          <Image src="/bfp-logo.svg" alt="BFP Logo" fill className="object-contain" />
        </div>
        <h1 className="text-xl font-bold text-white">Track Emergency Report</h1>
        <p className="text-xs text-white/60 mt-1">Use the secure tracking link for your report</p>
      </div>

      <div className="max-w-lg mx-auto px-4 -mt-4">
        <EmergencyReferenceCard compact />
      </div>

      <div className="max-w-lg mx-auto px-4 mt-4 pb-8">
        <div className="card overflow-hidden">
          <div className="card-body p-6 space-y-5">
            <div className="rounded-xl border p-4 bg-amber-50 border-amber-200">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">
                    Legacy tracking by report ID is no longer supported.
                  </p>
                  <p className="text-xs text-amber-800 mt-1">
                    Use the secure tracking link issued when the report was submitted. Invalid,
                    expired, revoked, or mismatched links all fail the same way.
                  </p>
                </div>
              </div>
            </div>

            {trackingUrl ? (
              <Link
                href={trackingUrl}
                className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-bold"
                style={{
                  background: 'var(--bfp-gradient)',
                  boxShadow: '0 2px 8px rgba(153,27,34,0.3)',
                }}
              >
                <Link2 className="w-4 h-4" />
                Open my latest secure tracking link
              </Link>
            ) : (
              <div
                className="rounded-xl border p-4 text-sm"
                style={{
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-secondary)',
                  backgroundColor: 'var(--content-bg)',
                }}
              >
                No stored secure tracking link was found on this device. Submit a new report or
                reopen the exact tracking link you received earlier.
              </div>
            )}

            <Link
              href="/"
              className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-semibold"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
            >
              Return to report page
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
