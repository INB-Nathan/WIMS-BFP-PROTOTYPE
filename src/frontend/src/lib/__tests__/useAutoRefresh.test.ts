/**
 * useAutoRefresh tests — event-driven auto-refresh via SSE (PR #518).
 *
 * Expected behavior:
 * - deriveChannels maps eventType prefixes to SSE channels; civilian.* -> 'verification'
 *   (not a 'civilian' channel), verified indirectly via the constructed EventSource URL.
 * - Matching SSE events (event_type in eventTypes) schedule a debounced refresh.
 * - A burst of matching events within the debounce window coalesces into a single
 *   onRefresh() call.
 * - Refreshes are skipped while document.hidden is true, and the missed refresh is
 *   replayed once the tab becomes visible again (visibilitychange catch-up).
 * - After a successful refresh, justRefreshed stays true for CONFIRMATION_HOLD_MS
 *   (2500ms) before reverting to false.
 * - Events whose event_type is not in the hook's eventTypes option are ignored, even
 *   when delivered on the same channel.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoRefresh } from '../useAutoRefresh';
import type { SSEEvent } from '../useEventStream';
import { EventSourceStub } from '../../../vitest.setup';

function makeEvent(eventType: string, overrides: Partial<SSEEvent> = {}): SSEEvent {
  return {
    channel: 'incident',
    event_type: eventType,
    payload: {},
    actor_id: null,
    actor_role: null,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function lastInstance(): EventSourceStub {
  const instance = EventSourceStub.instances[EventSourceStub.instances.length - 1];
  if (!instance) throw new Error('No live EventSource instance — did the hook connect?');
  return instance;
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
}

beforeEach(() => {
  // Close out any EventSource instances left over from a prior test.
  [...EventSourceStub.instances].forEach((i) => i.close());
  setDocumentHidden(false);
});

afterEach(() => {
  [...EventSourceStub.instances].forEach((i) => i.close());
  setDocumentHidden(false);
  vi.useRealTimers();
});

describe('useAutoRefresh', () => {
  describe('channel derivation', () => {
    it('subscribes on the verification channel for a civilian.* event type (not "civilian")', () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const { unmount } = renderHook(() =>
        useAutoRefresh({ eventTypes: ['civilian.report_submitted'], onRefresh }),
      );

      const es = lastInstance();
      const params = new URLSearchParams(es.url.split('?')[1]);
      const channels = (params.get('channels') ?? '').split(',');

      expect(channels).toContain('verification');
      expect(channels).not.toContain('civilian');

      unmount();
    });

    it('derives and dedupes channels for mixed-prefix event types', () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const { unmount } = renderHook(() =>
        useAutoRefresh({
          eventTypes: ['incident.updated', 'incident.verified', 'civilian.report_submitted'],
          onRefresh,
        }),
      );

      const es = lastInstance();
      const params = new URLSearchParams(es.url.split('?')[1]);
      const channels = (params.get('channels') ?? '').split(',');

      expect([...channels].sort()).toEqual(['incident', 'verification']);

      unmount();
    });
  });

  describe('debounce coalescing', () => {
    it('coalesces a burst of matching events into a single onRefresh call', async () => {
      vi.useFakeTimers();
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const { unmount } = renderHook(() =>
        useAutoRefresh({ eventTypes: ['incident.updated'], onRefresh, debounceMs: 2000 }),
      );
      const es = lastInstance();

      act(() => {
        es.emit('incident.updated', makeEvent('incident.updated'));
        es.emit('incident.updated', makeEvent('incident.updated'));
        es.emit('incident.updated', makeEvent('incident.updated'));
      });

      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onRefresh).toHaveBeenCalledTimes(1);

      unmount();
    });
  });

  describe('document.hidden skip', () => {
    it('does not schedule or fire a refresh when the tab is hidden', async () => {
      vi.useFakeTimers();
      setDocumentHidden(true);
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const { result, unmount } = renderHook(() =>
        useAutoRefresh({ eventTypes: ['incident.updated'], onRefresh, debounceMs: 2000 }),
      );
      const es = lastInstance();

      act(() => {
        es.emit('incident.updated', makeEvent('incident.updated'));
      });

      // No debounce window should have opened while hidden.
      expect(result.current.pending).toBe(false);

      await act(async () => {
        vi.advanceTimersByTime(5000);
        await Promise.resolve();
      });

      expect(onRefresh).not.toHaveBeenCalled();

      unmount();
    });
  });

  describe('visibility catch-up', () => {
    it('replays a missed refresh once the tab becomes visible again', async () => {
      vi.useFakeTimers();
      setDocumentHidden(true);
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const { unmount } = renderHook(() =>
        useAutoRefresh({ eventTypes: ['incident.updated'], onRefresh, debounceMs: 2000 }),
      );
      const es = lastInstance();

      act(() => {
        es.emit('incident.updated', makeEvent('incident.updated'));
      });

      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
      });
      expect(onRefresh).not.toHaveBeenCalled();

      // Tab becomes visible again — the dropped refresh should be replayed.
      act(() => {
        setDocumentHidden(false);
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onRefresh).toHaveBeenCalledTimes(1);

      unmount();
    });
  });

  describe('CONFIRMATION_HOLD_MS', () => {
    it('sets justRefreshed after a successful refresh and clears it after ~2500ms', async () => {
      vi.useFakeTimers();
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const { result, unmount } = renderHook(() =>
        useAutoRefresh({ eventTypes: ['incident.updated'], onRefresh, debounceMs: 100 }),
      );
      const es = lastInstance();

      act(() => {
        es.emit('incident.updated', makeEvent('incident.updated'));
      });

      await act(async () => {
        vi.advanceTimersByTime(100);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(result.current.justRefreshed).toBe(true);
      expect(result.current.lastRefreshed).toBeInstanceOf(Date);

      await act(async () => {
        vi.advanceTimersByTime(2500);
      });

      expect(result.current.justRefreshed).toBe(false);

      unmount();
    });
  });

  describe('event type filtering', () => {
    it('ignores an event whose event_type is not in the eventTypes option, even on the same channel', async () => {
      vi.useFakeTimers();
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const { unmount } = renderHook(() =>
        useAutoRefresh({ eventTypes: ['incident.updated'], onRefresh, debounceMs: 2000 }),
      );
      const es = lastInstance();

      // 'incident.verified' shares the 'incident' channel but isn't in eventTypes.
      act(() => {
        es.emit('incident.verified', makeEvent('incident.verified'));
      });

      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
      });

      expect(onRefresh).not.toHaveBeenCalled();

      unmount();
    });
  });
});
