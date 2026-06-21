'use client';

import { Info, Loader2, RotateCcw } from 'lucide-react';
import type { TerminalCitizenStatus } from '@/lib/api';
import { CitizenMessagePreview } from './CitizenMessagePreview';
import { TERMINAL_OPTIONS } from './useTriageModalState';

export interface CorrectionActionPanelProps {
  correctionReportId: number | null;
  terminalStatus: TerminalCitizenStatus;
  setTerminalStatus: (s: TerminalCitizenStatus) => void;
  explanation: string;
  setExplanation: (s: string) => void;
  correctionReason: string;
  setCorrectionReason: (s: string) => void;
  onApply: () => void;
  busy: boolean;
}

/**
 * Right rail: correction form.
 * - Two-step: select terminal report (in main list), then provide new status + audit reason.
 * - CitizenMessagePreview shows the corrected message.
 * - Audit-reason field is required and explicitly labeled as audit-visible.
 */
export function CorrectionActionPanel({
  correctionReportId,
  terminalStatus,
  setTerminalStatus,
  explanation,
  setExplanation,
  correctionReason,
  setCorrectionReason,
  onApply,
  busy,
}: CorrectionActionPanelProps) {
  const canApply =
    !busy && correctionReportId !== null && explanation.trim().length > 0 && correctionReason.trim().length > 0;
  const tone = TERMINAL_OPTIONS.find((o) => o.value === terminalStatus)?.tone ?? 'standard';

  return (
    <section className="triage-panel" data-testid="triage-panel-correct">
      <header className="triage-panel__head">
        <span className="triage-panel__eyebrow triage-panel__eyebrow--warn">ACTION 2</span>
        <h3 className="triage-panel__title">Correct an already-terminal report</h3>
        <p className="triage-panel__desc">
          Replaces the explanation visible to the citizen on a report that was previously
          marked terminal, and writes an audit event with the operator&apos;s reason.
        </p>
      </header>

      <div className="triage-target">
        <div className="triage-target__label">Target report</div>
        {correctionReportId !== null ? (
          <div className="triage-target__row">
            <span className="triage-target__id">#{correctionReportId}</span>
            <span className="triage-target__hint">from the list on the left</span>
          </div>
        ) : (
          <div className="triage-target__row triage-target__row--empty">
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Click <strong>Correct</strong> on any terminal row in the list to select it.</span>
          </div>
        )}
      </div>

      <fieldset className="triage-status-grid">
        <legend className="triage-status-grid__legend">Replacement status</legend>
        {TERMINAL_OPTIONS.map((option) => {
          const active = option.value === terminalStatus;
          return (
            <label
              key={option.value}
              className={`triage-status-card triage-status-card--${option.tone} ${active ? 'triage-status-card--active' : ''}`}
            >
              <input
                type="radio"
                name="triage-correct-status"
                value={option.value}
                checked={active}
                onChange={() => {
                  setTerminalStatus(option.value);
                  setExplanation(option.template);
                }}
                className="triage-status-card__input"
              />
              <span className="triage-status-card__icon" aria-hidden="true">●</span>
              <span className="triage-status-card__label">{option.label}</span>
              <span className="triage-status-card__value">{option.value}</span>
            </label>
          );
        })}
      </fieldset>

      <div className="triage-field">
        <label className="triage-field__label" htmlFor="triage-correct-explanation">
          Replacement citizen explanation
        </label>
        <textarea
          id="triage-correct-explanation"
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          rows={3}
          className="triage-textarea"
        />
        <div className="triage-field__counter">{explanation.length} chars</div>
      </div>

      <div className="triage-field">
        <label className="triage-field__label" htmlFor="triage-correct-reason">
          Audit reason <span className="triage-field__required">required</span>
        </label>
        <p className="triage-field__hint">
          Free-text justification. Recorded permanently in the audit log. Visible to admins and
          validators, not the citizen.
        </p>
        <textarea
          id="triage-correct-reason"
          value={correctionReason}
          onChange={(e) => setCorrectionReason(e.target.value)}
          rows={3}
          placeholder="e.g. reporter called back, original rejection was premature"
          className="triage-textarea triage-textarea--audit"
        />
      </div>

      <details className="triage-why">
        <summary>
          <Info className="h-3.5 w-3.5" />
          What gets recorded?
        </summary>
        <p>
          A <code>CORRECTION</code> audit event is written with the previous status, new status,
          the replacement explanation, and the reason you typed above. The citizen sees the
          new explanation; the previous one is preserved in the audit trail.
        </p>
      </details>

      {correctionReportId !== null && (
        <CitizenMessagePreview status={terminalStatus} message={explanation} reportCount={1} />
      )}

      <button
        type="button"
        disabled={!canApply}
        onClick={onApply}
        className={`triage-commit triage-commit--${tone}`}
        data-testid="triage-commit-correct"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        <span>
          Apply correction to <strong>#{correctionReportId ?? '—'}</strong>
        </span>
        <span className="triage-commit__hint">click to confirm</span>
      </button>
    </section>
  );
}
