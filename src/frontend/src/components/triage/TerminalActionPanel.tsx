'use client';

import { Info, Loader2 } from 'lucide-react';
import type { TerminalCitizenStatus } from '@/lib/api';
import { CitizenMessagePreview } from './CitizenMessagePreview';
import { TERMINAL_OPTIONS, selectedReportIds } from './useTriageWorkflowState';
import type { TriageClusterEntry } from '@/lib/api';

export interface TerminalActionPanelProps {
  cluster: TriageClusterEntry;
  selected: Set<number>;
  terminalStatus: TerminalCitizenStatus;
  setTerminalStatus: (s: TerminalCitizenStatus) => void;
  explanation: string;
  setExplanation: (s: string) => void;
  internalNote: string;
  setInternalNote: (s: string) => void;
  onApply: () => void;
  busy: boolean;
}

const TONE_ORDER: Record<'standard' | 'caution' | 'destructive', number> = {
  standard: 0,
  caution: 1,
  destructive: 2,
};

const TONE_ICON: Record<'standard' | 'caution' | 'destructive', string> = {
  standard: '◯',
  caution: '△',
  destructive: '✕',
};

/**
 * Right rail: terminal action form.
 * - Status is a stack of radio-cards with tone (standard/caution/destructive).
 * - "Why this status" guidance is shown next to the currently-selected option.
 * - CitizenMessagePreview renders exactly what the citizen will see.
 */
export function TerminalActionPanel({
  cluster,
  selected,
  terminalStatus,
  setTerminalStatus,
  explanation,
  setExplanation,
  internalNote,
  setInternalNote,
  onApply,
  busy,
}: TerminalActionPanelProps) {
  const reportIds = selectedReportIds(cluster, selected);
  const canApply = !busy && !!cluster.cluster_id && reportIds.length > 0 && explanation.trim().length > 0;
  const ordered = [...TERMINAL_OPTIONS].sort(
    (a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone],
  );

  return (
    <section className="triage-panel" data-testid="triage-panel-terminal">
      <header className="triage-panel__head">
        <span className="triage-panel__eyebrow">ACTION 1</span>
        <h3 className="triage-panel__title">Apply terminal status</h3>
        <p className="triage-panel__desc">
          Selects a non-terminal report, then sets its status to one of the four options below.
          The citizen receives a status update on their report; this does not create an official
          incident.
        </p>
      </header>

      <div className="triage-panel__selection">
        <span className="triage-panel__selection-num">{reportIds.length}</span>
        <span className="triage-panel__selection-label">
          {reportIds.length === 1 ? 'report' : 'reports'} selected
        </span>
        {!cluster.cluster_id && (
          <span className="triage-panel__selection-hint">Requires a durable cluster</span>
        )}
      </div>

      <fieldset className="triage-status-grid">
        <legend className="triage-status-grid__legend">Status</legend>
        {ordered.map((option) => {
          const active = option.value === terminalStatus;
          return (
            <label
              key={option.value}
              className={`triage-status-card triage-status-card--${option.tone} ${active ? 'triage-status-card--active' : ''}`}
            >
              <input
                type="radio"
                name="triage-terminal-status"
                value={option.value}
                checked={active}
                onChange={() => {
                  setTerminalStatus(option.value);
                  setExplanation(option.template);
                }}
                className="triage-status-card__input"
              />
              <span className="triage-status-card__icon" aria-hidden="true">{TONE_ICON[option.tone]}</span>
              <span className="triage-status-card__label">{option.label}</span>
              <span className="triage-status-card__value">{option.value}</span>
            </label>
          );
        })}
      </fieldset>

      <div className="triage-field">
        <label className="triage-field__label" htmlFor="triage-explanation">
          Citizen-visible explanation
        </label>
        <p className="triage-field__hint">
          The text the citizen will see attached to their report. Be specific, factual, and free
          of internal jargon.
        </p>
        <textarea
          id="triage-explanation"
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          rows={4}
          className="triage-textarea"
          placeholder="BFP has received and actioned this civilian signal. Call 911 for urgent updates."
        />
        <div className="triage-field__counter">{explanation.length} chars</div>
      </div>

      <div className="triage-field">
        <label className="triage-field__label" htmlFor="triage-internal-note">
          Internal note <span className="triage-field__optional">optional</span>
        </label>
        <p className="triage-field__hint">Visible to validators and admins only. Not sent to the citizen.</p>
        <textarea
          id="triage-internal-note"
          value={internalNote}
          onChange={(e) => setInternalNote(e.target.value)}
          rows={2}
          className="triage-textarea"
          placeholder="e.g. cross-referenced with cluster #42, no further action"
        />
      </div>

      <details className="triage-why">
        <summary>
          <Info className="h-3.5 w-3.5" />
          Why this status?
        </summary>
        <p>{TERMINAL_OPTIONS.find((o) => o.value === terminalStatus)?.hint}</p>
      </details>

      <CitizenMessagePreview
        status={terminalStatus}
        message={explanation}
        reportCount={reportIds.length}
      />

      <button
        type="button"
        disabled={!canApply}
        onClick={onApply}
        className={`triage-commit triage-commit--${TERMINAL_OPTIONS.find((o) => o.value === terminalStatus)?.tone ?? 'standard'}`}
        data-testid="triage-commit-terminal"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        <span>
          Apply <strong>{TERMINAL_OPTIONS.find((o) => o.value === terminalStatus)?.label}</strong> to {reportIds.length} report{reportIds.length === 1 ? '' : 's'}
        </span>
        <span className="triage-commit__hint">click to confirm</span>
      </button>
    </section>
  );
}
