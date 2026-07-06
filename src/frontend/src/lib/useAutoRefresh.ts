/**
 * useAutoRefresh — event-driven auto-refresh hook.
 *
 * Subscribes to SSE event types and triggers a debounced refresh when any
 * matching event arrives. Skips refresh when the tab is hidden to avoid
 * waking dormant views.
 *
 * Usage:
 *   const { refreshing, lastRefreshed } = useAutoRefresh({
 *     eventTypes: ['incident.updated', 'incident.verified'],
 *     onRefresh: fetchQueue,
 *   });
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEventStream, type SSEEvent } from './useEventStream';

// ─── Channel derivation ────────────────────────────────────────────────────

const CHANNEL_BY_PREFIX: Record<string, string> = {
  'incident': 'incident',
  'verification': 'verification',
  'security': 'security',
  'system': 'system',
  'civilian': 'verification', // civilian events travel on the verification channel
};

function deriveChannels(eventTypes: string[]): string[] {
  const channels = new Set<string>();
  for (const et of eventTypes) {
    const prefix = et.split('.')[0];
    const ch = CHANNEL_BY_PREFIX[prefix];
    if (ch) channels.add(ch);
  }
  return channels.size > 0 ? Array.from(channels) : ['incident'];
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface UseAutoRefreshOptions {
  /** SSE event types that should trigger a refresh. */
  eventTypes: string[];
  /** Async function that re-fetches the view data. */
  onRefresh: () => Promise<void>;
  /** Toast text shown while refreshing. */
  notification?: string;
  /** Debounce window in ms to coalesce burst events (default 2000). */
  debounceMs?: number;
}

export interface UseAutoRefreshResult {
  /** True while the debounce window is open (event received, refresh pending). */
  pending: boolean;
  /** True while onRefresh() is in flight. */
  refreshing: boolean;
  /** True for ~2 s after a successful refresh completes (for "Refreshed!" confirmation). */
  justRefreshed: boolean;
  lastRefreshed: Date | null;
  notificationText: string;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

// Duration in ms to keep the "Data refreshed" confirmation toast visible.
const CONFIRMATION_HOLD_MS = 2500;

export function useAutoRefresh({
  eventTypes,
  onRefresh,
  notification = 'New data available — refreshing…',
  debounceMs = 2000,
}: UseAutoRefreshOptions): UseAutoRefreshResult {
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [justRefreshed, setJustRefreshed] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const channels = useMemo(() => deriveChannels(eventTypes), [eventTypes.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerRefresh = useCallback(() => {
    // Skip refreshes while the tab is hidden to avoid unnecessary network calls.
    if (typeof document !== 'undefined' && document.hidden) return;

    if (timerRef.current !== null) clearTimeout(timerRef.current);

    // Show the "pending" state immediately so users see a notification as soon
    // as the event arrives, before the debounce window elapses.
    setPending(true);

    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      setPending(false);
      setRefreshing(true);
      try {
        await onRefreshRef.current();
        const now = new Date();
        setLastRefreshed(now);

        // Show a brief "Data refreshed" confirmation.
        setJustRefreshed(true);
        if (confirmTimerRef.current !== null) clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = setTimeout(() => {
          setJustRefreshed(false);
        }, CONFIRMATION_HOLD_MS);
      } finally {
        setRefreshing(false);
      }
    }, debounceMs);
  }, [debounceMs]);

  // Clean up timers on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (confirmTimerRef.current !== null) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const eventTypeSet = useMemo(() => new Set(eventTypes), [eventTypes.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEvent = useCallback(
    (event: SSEEvent) => {
      if (eventTypeSet.has(event.event_type)) triggerRefresh();
    },
    [eventTypeSet, triggerRefresh],
  );

  useEventStream({
    channels,
    onEvent: handleEvent,
    watchTypes: eventTypes,
  });

  return { pending, refreshing, justRefreshed, lastRefreshed, notificationText: notification };
}
