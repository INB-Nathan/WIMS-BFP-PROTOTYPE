'use client';

import { AlertTriangle, Info, Loader2, Send } from 'lucide-react';
import type { StatusUpdateStage } from '@/lib/api';

export interface StatusUpdatePanelProps {
  stage: StatusUpdateStage;
  setStage: (s: StatusUpdateStage) => void;
  stationName: string;
  setStationName: (s: string) => void;
  jurisdiction: string;
  setJurisdiction: (s: string) => void;
  eta: string;
  setEta: (s: string) => void;
  arrivedAt: string;
  setArrivedAt: (s: string) => void;
  outcomeSummary: string;
  setOutcomeSummary: (s: string) => void;
  duplicateOf: string;
  setDuplicateOf: (s: string) => void;
  reason: string;
  setReason: (s: string) => void;
  /** Opens the two-step confirm dialog in the parent modal. */
  onRequestConfirm: () => void;
  busy: boolean;
}

interface StageSpec {
  value: StatusUpdateStage;
  label: string;
  hint: string;
  tone: 'standard' | 'caution' | 'destructive';
}

/** Confirmation tone per stage — terminal stages escalate the confirm dialog. */
export const STAGE_TONE: Record<StatusUpdateStage, 'standard' | 'caution' | 'destructive'> = {
  RECEIVED: 'standard',
  UNDER_REVIEW: 'standard',
  HELP_DISPATCHED: 'standard',
  ON_SCENE: 'standard',
  RESOLVED: 'caution',
  CLOSED_DUPLICATE: 'caution',
  CLOSED_INSUFFICIENT: 'caution',
};

/** Whether a stage is terminal (no further status updates allowed after it). */
export const STAGE_TERMINAL: Record<StatusUpdateStage, boolean> = {
  RECEIVED: false,
  UNDER_REVIEW: false,
  HELP_DISPATCHED: false,
  ON_SCENE: false,
  RESOLVED: true,
  CLOSED_DUPLICATE: true,
  CLOSED_INSUFFICIENT: true,
};

/** Fixed forward-only lifecycle stages for validator-to-civilian updates.
 * Order mirrors the backend _STAGE_ORDER. Terminal stages are visually de-emphasised. */
const STAGES: StageSpec[] = [
  { value: 'RECEIVED', label: 'Received', hint: 'Report received by the system.', tone: 'standard' },
  { value: 'UNDER_REVIEW', label: 'Under Review', hint: 'A validator is actively reviewing the report.', tone: 'standard' },
  { value: 'HELP_DISPATCHED', label: 'Help Dispatched', hint: 'Responders are en route. Provide station, jurisdiction, and ETA.', tone: 'standard' },
  { value: 'ON_SCENE', label: 'On Scene', hint: 'Responders have arrived. Provide arrival time.', tone: 'standard' },
  { value: 'RESOLVED', label: 'Resolved', hint: 'Situation resolved. Provide an outcome summary.', tone: 'caution' },
  { value: 'CLOSED_DUPLICATE', label: 'Closed — Duplicate', hint: 'Closed as a duplicate of another report.', tone: 'caution' },
  { value: 'CLOSED_INSUFFICIENT', label: 'Closed — Insufficient', hint: 'Closed due to insufficient information.', tone: 'caution' },
];

/**
 * Right rail: validator-to-civilian dynamic status update ("Send Update").
 * - Stage dropdown with the 5 fixed lifecycle stages + 2 terminal closes.
 * - Stage-specific structured metadata fields appear per the selected stage.
 * - Commit is gated behind a two-step confirm (handled by the parent modal).
 * - No commit keyboard shortcut — deliberate UI click only.
 */
export function StatusUpdatePanel(props: StatusUpdatePanelProps) {
  const stageSpec = STAGES.find((s) => s.value === props.stage) ?? STAGES[1];

  // Pre-confirm validation: required metadata per stage must be filled before
  // the review dialog opens, so the user is never bounced after confirming.
  let formError: string | null = null;
  switch (props.stage) {
    case 'HELP_DISPATCHED':
      if (!props.stationName.trim() || !props.jurisdiction.trim()) {
        formError = 'Station name and jurisdiction are required.';
      }
      break;
    case 'ON_SCENE':
      if (!props.arrivedAt.trim()) formError = 'Arrival time is required.';
      break;
    case 'RESOLVED':
      if (!props.outcomeSummary.trim()) formError = 'An outcome summary is required.';
      break;
    case 'CLOSED_DUPLICATE':
      if (!/^\d+$/.test(props.duplicateOf.trim()) || Number(props.duplicateOf) <= 0) {
        formError = 'Duplicate-of report id must be a positive integer.';
      }
      break;
    case 'CLOSED_INSUFFICIENT':
      if (!props.reason.trim()) formError = 'A closure reason is required.';
      break;
    default:
      break;
  }
  const canApply = !props.busy && formError === null;

  return (
    <section className="triage-panel" data-testid="triage-panel-update">
      <header className="triage-panel__head">
        <span className="triage-panel__eyebrow">ACTION 6</span>
        <h3 className="triage-panel__title">Send status update</h3>
        <p className="triage-panel__desc">
          Push a structured lifecycle update to the civilian who filed this report. The tracking
          page receives it as a timeline event.
        </p>
      </header>

      <div className="triage-field">
        <label className="triage-field__label" htmlFor="update-stage">
          Lifecycle stage
        </label>
        <select
          id="update-stage"
          className="triage-select"
          data-testid="update-stage-select"
          value={props.stage}
          onChange={(e) => props.setStage(e.target.value as StatusUpdateStage)}
          disabled={props.busy}
        >
          {STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <p className="triage-field__hint">{stageSpec.hint}</p>
      </div>

      {props.stage === 'HELP_DISPATCHED' && (
        <>
          <div className="triage-field">
            <label className="triage-field__label" htmlFor="update-station">
              Station name <span className="triage-field__required">required</span>
            </label>
            <input
              id="update-station"
              className="triage-input"
              data-testid="update-station-input"
              value={props.stationName}
              onChange={(e) => props.setStationName(e.target.value)}
              placeholder="e.g. BFP East Station"
              disabled={props.busy}
            />
          </div>
          <div className="triage-field">
            <label className="triage-field__label" htmlFor="update-jurisdiction">
              Jurisdiction <span className="triage-field__required">required</span>
            </label>
            <input
              id="update-jurisdiction"
              className="triage-input"
              data-testid="update-jurisdiction-input"
              value={props.jurisdiction}
              onChange={(e) => props.setJurisdiction(e.target.value)}
              placeholder="e.g. Province / City"
              disabled={props.busy}
            />
          </div>
          <div className="triage-field">
            <label className="triage-field__label" htmlFor="update-eta">
              ETA <span className="triage-field__optional">(optional)</span>
            </label>
            <input
              id="update-eta"
              className="triage-input"
              data-testid="update-eta-input"
              value={props.eta}
              onChange={(e) => props.setEta(e.target.value)}
              placeholder="e.g. 10 minutes"
              disabled={props.busy}
            />
          </div>
        </>
      )}

      {props.stage === 'ON_SCENE' && (
        <div className="triage-field">
          <label className="triage-field__label" htmlFor="update-arrived">
            Arrival time <span className="triage-field__required">required</span>
          </label>
          <input
            id="update-arrived"
            className="triage-input"
            data-testid="update-arrived-input"
            value={props.arrivedAt}
            onChange={(e) => props.setArrivedAt(e.target.value)}
            placeholder="e.g. 14:35 or 2026-07-16 14:35"
            disabled={props.busy}
          />
        </div>
      )}

      {props.stage === 'RESOLVED' && (
        <div className="triage-field">
          <label className="triage-field__label" htmlFor="update-outcome">
            Outcome summary <span className="triage-field__required">required</span>
          </label>
          <textarea
            id="update-outcome"
            className="triage-textarea"
            data-testid="update-outcome-input"
            rows={3}
            value={props.outcomeSummary}
            onChange={(e) => props.setOutcomeSummary(e.target.value)}
            placeholder="What happened and how the situation resolved."
            disabled={props.busy}
          />
        </div>
      )}

      {props.stage === 'CLOSED_DUPLICATE' && (
        <div className="triage-field">
          <label className="triage-field__label" htmlFor="update-duplicate">
            Duplicate of report id <span className="triage-field__required">required</span>
          </label>
          <input
            id="update-duplicate"
            className="triage-input"
            data-testid="update-duplicate-input"
            inputMode="numeric"
            value={props.duplicateOf}
            onChange={(e) => props.setDuplicateOf(e.target.value)}
            placeholder="e.g. 1024"
            disabled={props.busy}
          />
        </div>
      )}

      {props.stage === 'CLOSED_INSUFFICIENT' && (
        <div className="triage-field">
          <label className="triage-field__label" htmlFor="update-reason">
            Reason <span className="triage-field__required">required</span>
          </label>
          <textarea
            id="update-reason"
            className="triage-textarea"
            data-testid="update-reason-input"
            rows={3}
            value={props.reason}
            onChange={(e) => props.setReason(e.target.value)}
            placeholder="Why the report could not be verified or acted on."
            disabled={props.busy}
          />
        </div>
      )}

      {props.stage === 'RECEIVED' || props.stage === 'UNDER_REVIEW' ? (
        <p className="triage-update__note" data-testid="update-note-basic">
          <Info className="h-3 w-3" />
          This stage carries no extra metadata. The civilian sees the stage change on their
          tracking page.
        </p>
      ) : null}

      {STAGE_TERMINAL[props.stage] ? (
        <p className="triage-update__warn" data-testid="update-note-terminal">
          <AlertTriangle className="h-3 w-3" />
          This is a terminal update. After sending, no further status updates can be published
          for this report.
        </p>
      ) : null}

      {formError && (
        <p className="triage-update__error" data-testid="update-form-error" role="alert">
          {formError}
        </p>
      )}

      <button
        type="button"
        className="triage-action-btn triage-action-btn--primary"
        data-testid="update-send-button"
        onClick={props.onRequestConfirm}
        disabled={!canApply}
        aria-disabled={!canApply}
      >
        {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Review &amp; send update
      </button>
    </section>
  );
}
