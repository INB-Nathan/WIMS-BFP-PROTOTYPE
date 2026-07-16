'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { CivilianDuplicateSuggestion } from '@/lib/api';
import type { ReportDraft } from './DraftManager';
import { OBSERVABLES } from './StepCategory';

export interface StepReviewProps {
  draft: ReportDraft;
  duplicates: CivilianDuplicateSuggestion[];
  submitting: boolean;
  submitError: string | null;
  queuedOffline: boolean;
  queuedLocalId: string | null;
  onBack: () => void;
  onSubmit: () => void;
  onQueueOffline: () => void;
}

/**
 * Step 5 — Review. Full summary of all steps + duplicate detection results +
 * submit / offline-queue. Duplicate detection reuses the existing civilian
 * suggest endpoint result shape (no separate modal in the public flow).
 */
export function StepReview({
  draft,
  duplicates,
  submitting,
  submitError,
  queuedOffline,
  queuedLocalId,
  onBack,
  onSubmit,
  onQueueOffline,
}: StepReviewProps) {
  const observableLabels = OBSERVABLES.filter((o) => draft.observables.includes(o.value)).map((o) => o.label);

  if (queuedOffline) {
    return (
      <div className="text-center space-y-3 py-4">
        <div className="mx-auto w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(34,197,94,0.1)' }}>
          <CheckCircle2 className="w-8 h-8 text-green-600" />
        </div>
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Report saved offline</h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Your report will be sent automatically when you reconnect.
        </p>
        {queuedLocalId && (
          <code data-testid="queued-local-id" className="block break-all text-xs" style={{ color: 'var(--text-secondary)' }}>
            {queuedLocalId}
          </code>
        )}
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-left">
          <p className="text-sm font-semibold text-red-700">For immediate danger, call 911 now.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Review your report</p>

      <div className="space-y-2 text-sm rounded-lg p-3" style={{ backgroundColor: 'var(--content-bg)' }}>
        <Row label="Location" value={draft.latitude !== null ? `${draft.latitude.toFixed(5)}, ${draft.longitude?.toFixed(5)}` : 'Not provided'} />
        {draft.landmark && <Row label="Landmark" value={draft.landmark} />}
        {draft.photoPresent && <Row label="Photo" value="Attached" />}
        <Row label="Observations" value={observableLabels.length ? observableLabels.join(', ') : 'None selected'} />
        <Row label="Description" value={draft.description || '—'} />
        {draft.contactName && <Row label="Contact" value={`${draft.contactName}${draft.contactPhone ? ` · ${draft.contactPhone}` : ''}`} />}
      </div>

      {duplicates.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="duplicate-results">
          <p className="font-semibold">Similar nearby report found</p>
          <p className="mt-1 text-xs">You may still submit — validators will use it as another signal.</p>
          <ul className="mt-2 space-y-1">
            {duplicates.map((d) => (
              <li key={d.report_id} className="flex justify-between gap-3 text-xs">
                <span>Report #{d.report_id} · {Math.round(d.distance_m)}m away</span>
                <span>{d.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {submitError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm" role="alert">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{submitError}</span>
        </div>
      )}

      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
        <p className="text-sm font-semibold text-red-700">
          For immediate danger, call 911 now. This report does not replace an emergency call.
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="flex items-center gap-1 px-4 py-3 rounded-xl border text-sm font-medium transition-colors disabled:opacity-50"
          style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', backgroundColor: 'var(--card-bg)' }}
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          data-testid="submit-report"
          className="flex-1 py-3.5 rounded-xl text-white text-sm font-bold disabled:opacity-50 transition-all"
          style={{ background: 'var(--bfp-gradient)', boxShadow: '0 2px 8px rgba(153,27,34,0.3)' }}
        >
          {submitting ? 'Submitting…' : 'Submit Report'}
        </button>
      </div>

      <button
        type="button"
        onClick={onQueueOffline}
        data-testid="queue-offline"
        className="w-full py-2.5 rounded-xl border text-xs font-medium transition-colors"
        style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
      >
        Save offline & send later
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="text-right" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}
