/**
 * useEventStream — React hook for real-time SSE notifications.
 *
 * Connects to GET /api/events/stream (cookie-based auth) and dispatches
 * typed events to callbacks.  The browser EventSource API handles
 * reconnection automatically; this hook just manages lifecycle and
 * channel subscription.
 *
 * Usage:
 *   useEventStream({
 *     channels: ['incident', 'verification'],
 *     onIncidentVerified: (e) => showToast(`Incident #${e.payload.incident_id} verified`),
 *     onVerificationClaim: (e) => refreshQueue(),
 *   });
 */

import { useEffect, useRef } from 'react';

// ─── Event type definitions ────────────────────────────────────────────────

export interface SSEEvent {
  channel: string;
  event_type: string;
  payload: Record<string, unknown>;
  actor_id: string | null;
  actor_role: string | null;
  timestamp: string;
}

export type EventCallback = (event: SSEEvent) => void;

export interface EventStreamOptions {
  /** Channels to subscribe to. Defaults to ['incident']. */
  channels?: string[];
  /** Called on every event (firehose). */
  onEvent?: EventCallback;
  /** Called when the connection opens. */
  onOpen?: () => void;
  /** Called on connection error. */
  onError?: (error: Event) => void;

  // ── Per-event-type callbacks ──────────────────────────────────────────
  onIncidentUpdated?: EventCallback;
  onIncidentVerified?: EventCallback;
  onIncidentRejected?: EventCallback;
  onIncidentCorrected?: EventCallback;
  onVerificationClaim?: EventCallback;
  onVerificationTerminal?: EventCallback;
  onSecurityThreat?: EventCallback;
  onSecurityAnalysis?: EventCallback;
  onSecurityHITL?: EventCallback;
}

/** Map of event_type prefixes → callback keys in EventStreamOptions */
const EVENT_CALLBACK_MAP: Record<string, keyof EventStreamOptions> = {
  'incident.updated': 'onIncidentUpdated',
  'incident.verified': 'onIncidentVerified',
  'incident.rejected': 'onIncidentRejected',
  'incident.corrected': 'onIncidentCorrected',
  'incident.accept': 'onIncidentVerified',
  'incident.reject': 'onIncidentRejected',
  'incident.pending': 'onIncidentUpdated',
  'verification.cluster_claimed': 'onVerificationClaim',
  'verification.terminal_action': 'onVerificationTerminal',
  'security.threat_detected': 'onSecurityThreat',
  'security.ai_analysis_complete': 'onSecurityAnalysis',
  'security.hitl_confirmed': 'onSecurityHITL',
};

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useEventStream(options: EventStreamOptions) {
  const {
    channels,
    onEvent,
    onOpen,
    onError,
    ...callbacks
  } = options;

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const channelList = channels?.length ? channels : ['incident'];
    const url = `/api/events/stream?channels=${channelList.join(',')}`;

    const es = new EventSource(url, { withCredentials: true });

    es.onopen = () => {
      optionsRef.current.onOpen?.();
    };

    es.onerror = (err) => {
      optionsRef.current.onError?.(err);
    };

    // Generic handler — dispatches to the right callback based on event_type
    es.onmessage = (msg) => {
      try {
        const event: SSEEvent = JSON.parse(msg.data);
        const current = optionsRef.current;

        // Firehose callback
        current.onEvent?.(event);

        // Type-specific callback
        const callbackKey = EVENT_CALLBACK_MAP[event.event_type];
        if (callbackKey) {
          (current[callbackKey] as EventCallback | undefined)?.(event);
        }
      } catch {
        // Ignore malformed events
      }
    };

    return () => {
      es.close();
    };
    // Only reconnect when channels change; callbacks use refs so they stay fresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels?.join(',')]);
}
