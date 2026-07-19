'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchCivilianSignals,
  type CivilianSignalTimestampResponse,
  type EmergencyResponse,
} from '@/lib/api/information';
import { PublicContentModal } from '@/components/public/PublicContentModal';
import { IconRefresh, IconUsers } from '@tabler/icons-react';

interface CivilianSignalModalProps {
  /** The emergency whose civilian signals are shown, or null when closed. */
  emergency: EmergencyResponse | null;
  onClose: () => void;
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; signals: CivilianSignalTimestampResponse[] }
  | { kind: 'empty' }
  | { kind: 'error' };

function formatTimestamp(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * CivilianSignalModal — privacy-preserving read-only panel for one active fire.
 *
 * Shows ONLY the count and submission timestamps of unresolved civilian reports
 * associated with the verified incident perimeter. It deliberately never
 * reveals who reported, where, or any report text/IDs/images. Renders inside
 * the existing accessible PublicContentModal (role=dialog, aria-modal, Escape,
 * focus trap + restore, body scroll lock).
 */
export function CivilianSignalModal({ emergency, onClose }: CivilianSignalModalProps) {
  const [state, setState] = useState<LoadState>({ kind: 'idle' });

  const load = useCallback(() => {
    if (!emergency) return;
    setState({ kind: 'loading' });
    fetchCivilianSignals(emergency.id)
      .then((signals) => {
        if (signals === null) {
          // Public source unavailable (not published/verified): treat as no data.
          setState({ kind: 'empty' });
          return;
        }
        if (signals.length === 0) {
          setState({ kind: 'empty' });
          return;
        }
        setState({ kind: 'loaded', signals });
      })
      .catch(() => {
        setState({ kind: 'error' });
      });
  }, [emergency]);

  // (Re)fetch whenever a new emergency is opened; reset on close.
  useEffect(() => {
    if (emergency) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      load();
    } else {
      setState({ kind: 'idle' });
    }
  }, [emergency, load]);

  const open = emergency !== null;
  const count = emergency?.civilian_signal_count ?? 0;

  return (
    <div className="public-surface">
      <PublicContentModal
        open={open}
        title="Civilian reports"
        onClose={onClose}
      >
        {emergency && (
          <div className="cs-modal">
            <p className="cs-modal-sub">
              <IconUsers size={14} aria-hidden /> {count} report
              {count === 1 ? '' : 's'} associated with{' '}
              <strong>{emergency.title}</strong>. Times shown are when reports were
              submitted. No locations, names, or details are shared.
            </p>

            {state.kind === 'loading' && (
              <p className="cs-modal-status" role="status">
                Loading report times…
              </p>
            )}

            {state.kind === 'error' && (
              <div className="cs-modal-error" role="alert">
                <p>Unable to load civilian report times.</p>
                <button
                  type="button"
                  className="cs-modal-retry"
                  onClick={load}
                  data-testid="cs-modal-retry"
                >
                  <IconRefresh size={14} aria-hidden /> Retry
                </button>
              </div>
            )}

            {state.kind === 'empty' && (
              <p className="cs-modal-status">No civilian report times to show.</p>
            )}

            {state.kind === 'loaded' && (
              <ul className="cs-modal-list" data-testid="cs-modal-list">
                {state.signals.map((s, i) => (
                  <li key={`${s.submitted_at}-${i}`} className="cs-modal-item">
                    {formatTimestamp(s.submitted_at)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </PublicContentModal>
    </div>
  );
}
