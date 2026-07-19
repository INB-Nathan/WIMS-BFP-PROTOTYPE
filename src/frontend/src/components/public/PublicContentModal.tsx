'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { IconX } from '@tabler/icons-react';

/**
 * PublicContentModal — accessible, reusable dialog for expanding public-surface
 * content (e.g. Reporting Guide entries) into a focused reading view with room
 * for richer text and media.
 *
 * Behavior:
 *  - role="dialog" + aria-modal, labelled by the provided title id.
 *  - Closes on Escape, overlay click, or the close button.
 *  - Traps focus inside the dialog and restores it to the trigger on close.
 *  - Locks body scroll while open.
 *
 * Scoped under .public-surface so it inherits the shared public theme tokens.
 */
export interface PublicContentModalProps {
  open: boolean;
  title: string;
  titleId?: string;
  onClose: () => void;
  children: ReactNode;
}

export function PublicContentModal({
  open,
  title,
  titleId = 'ps-modal-title',
  onClose,
  children,
}: PublicContentModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // Focus the dialog container so screen readers announce it.
    const t = window.setTimeout(() => dialogRef.current?.focus(), 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      // Restore focus after React commits the post-close render.
      const el = previouslyFocused.current;
      if (el) window.setTimeout(() => el.focus(), 0);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ps-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="ps-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="ps-modal-header">
          <h2 id={titleId} className="ps-modal-title">
            {title}
          </h2>
          <button
            type="button"
            className="ps-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <IconX size={20} aria-hidden />
          </button>
        </div>
        <div className="ps-modal-body">{children}</div>
      </div>
    </div>
  );
}
