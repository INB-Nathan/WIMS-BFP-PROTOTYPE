'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ChevronRight, Link2 } from 'lucide-react';
import { EmergencyReferenceCard } from '@/components/EmergencyReferenceCard';
import { PublicThemeProvider } from '@/components/public/PublicThemeProvider';
import '@/styles/public-surface.css';

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
    <PublicThemeProvider>
      <div className="ps-has-mesh ps-tracking-page">
        <div className="ps-tracking-hero">
          <div className="ps-intent-bg" aria-hidden />
          <div className="relative z-10 flex flex-col items-center text-center py-8 px-4">
            <div className="relative w-16 h-16 mb-3">
              <Image src="/bfp-logo.svg" alt="BFP Logo" fill className="object-contain" />
            </div>
            <h1 className="text-xl font-bold text-[var(--text-primary)]">Track Emergency Report</h1>
            <p className="text-xs ps-secondary mt-1">Use the secure tracking link for your report</p>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4 -mt-4">
          <EmergencyReferenceCard compact />
        </div>

        <div className="max-w-lg mx-auto px-4 mt-4 pb-12">
          <div className="ps-card space-y-5">
            <div className="ps-warning">
              <AlertTriangle className="w-5 h-5 ps-warning-icon" />
              <div>
                <p className="font-semibold">Legacy tracking by report ID is no longer supported.</p>
                <p className="ps-secondary">
                  Use the secure tracking link issued when the report was submitted. Invalid,
                  expired, revoked, or mismatched links all fail the same way.
                </p>
              </div>
            </div>

            {trackingUrl ? (
              <Link
                href={trackingUrl}
                className="ps-btn ps-btn-primary w-full justify-center"
                data-testid="open-tracking-link"
              >
                <Link2 className="w-4 h-4" />
                Open my latest secure tracking link
              </Link>
            ) : (
              <div className="ps-card-section ps-muted text-sm">
                No stored secure tracking link was found on this device. Submit a new report or
                reopen the exact tracking link you received earlier.
              </div>
            )}

            <Link
              href="/"
              className="ps-btn ps-btn-outline w-full justify-center"
            >
              Return to report page
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </PublicThemeProvider>
  );
}
