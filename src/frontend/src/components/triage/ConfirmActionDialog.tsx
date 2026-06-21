'use client';

import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useEffect } from 'react';

export type ConfirmTone = 'standard' | 'caution' | 'destructive';

export interface ConfirmActionDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  confirmTone: ConfirmTone;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional pre-commit preview panel rendered above the buttons. */
  preview?: React.ReactNode;
}

/**
 * Two-step confirmation dialog used before destructive triage actions
 * (REJECTED_*, merge, split, correction). Shows the impact, then waits for
 * a deliberate confirm. Escape cancels.
 */
export function ConfirmActionDialog({
  open,
  title,
  body,
  confirmLabel,
  confirmTone,
  busy,
  onConfirm,
  onCancel,
  preview,
}: ConfirmActionDialogProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    }
    // Use capture phase so we win the race against the parent modal's Escape handler.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="triage-confirm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="triage-confirm-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      data-testid="triage-confirm-dialog"
    >
      <div className="triage-confirm__panel" onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          aria-label="Cancel confirmation"
          onClick={onCancel}
          className="triage-confirm__close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className={`triage-confirm__icon triage-confirm__icon--${confirmTone}`}>
          <AlertTriangle className="h-5 w-5" />
        </div>

        <h3 id="triage-confirm-title" className="triage-confirm__title">
          {title}
        </h3>
        <p className="triage-confirm__body">{body}</p>

        {preview && <div className="triage-confirm__preview">{preview}</div>}

        <div className="triage-confirm__actions">
          <button type="button" onClick={onCancel} className="triage-button-ghost">
            Cancel
            <kbd>Esc</kbd>
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`triage-confirm__commit triage-confirm__commit--${confirmTone}`}
            data-testid="triage-confirm-commit"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
