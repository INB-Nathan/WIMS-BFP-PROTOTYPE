'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';
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
  turnstileEnabled: boolean;
  turnstileExpired: boolean;
  siteKey: string;
  onTurnstileSuccess: (token: string) => void;
  onTurnstileExpire: () => void;
  onTurnstileError: () => void;
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
  turnstileEnabled,
  turnstileExpired,
  siteKey,
  onTurnstileSuccess,
  onTurnstileExpire,
  onTurnstileError,
  onBack,
  onSubmit,
  onQueueOffline,
}: StepReviewProps) {
  const observableLabels = OBSERVABLES.filter((o) => draft.observables.includes(o.value)).map((o) => o.label);

  if (queuedOffline) {
    return (
      <div className="text-center space-y-3 py-4">
        <div className="mx-auto w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--green-bg)' }}>
          <CheckCircle2 className="w-8 h-8" style={{ color: 'var(--green)' }} />
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
        <div className="ps-warning">
          <AlertTriangle className="w-5 h-5 ps-warning-icon" />
          <p className="font-semibold">For immediate danger, call 911 now.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Review your report</p>

      <div className="space-y-2 text-sm rounded-lg p-3" style={{ backgroundColor: 'var(--bg-base)' }}>
        <Row label="Location" value={draft.latitude !== null ? `${draft.latitude.toFixed(5)}, ${draft.longitude?.toFixed(5)}` : 'Not provided'} />
        {draft.landmark && <Row label="Landmark" value={draft.landmark} />}
        {draft.photoPresent && <Row label="Photo" value="Attached" />}
        <Row label="Observations" value={observableLabels.length ? observableLabels.join(', ') : 'None selected'} />
        <Row label="Description" value={draft.description || '—'} />
        {draft.contactName && <Row label="Contact" value={`${draft.contactName}${draft.contactPhone ? ` · ${draft.contactPhone}` : ''}`} />}
      </div>

      {duplicates.length > 0 && (
        <div className="ps-warning" data-testid="duplicate-results">
          <AlertTriangle className="w-5 h-5 ps-warning-icon" />
          <div>
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
        </div>
      )}

      {submitError && (
        <div className="flex items-start gap-2 p-3 rounded-lg ps-warning" role="alert">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 ps-warning-icon" />
          <span>{submitError}</span>
        </div>
      )}

      {turnstileEnabled && (
        <div data-testid="turnstile-wrapper">
          <Turnstile
            siteKey={siteKey}
            onSuccess={onTurnstileSuccess}
            onExpire={onTurnstileExpire}
            onError={onTurnstileError}
          />
          {turnstileExpired && (
            <p className="text-xs text-amber-600 mt-1">
              ⚠ Security check expired. Please complete it again.
            </p>
          )}
        </div>
      )}

      <div className="ps-warning">
        <AlertTriangle className="w-5 h-5 ps-warning-icon" />
        <p className="font-semibold">
          For immediate danger, call 911 now. This report does not replace an emergency call.
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="ps-btn ps-btn-outline disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          data-testid="submit-report"
          className="ps-btn ps-btn-primary flex-1 justify-center disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit Report'}
        </button>
      </div>

      <button
        type="button"
        onClick={onQueueOffline}
        data-testid="queue-offline"
        className="ps-btn ps-btn-outline w-full justify-center"
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
