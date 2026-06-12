/**
 * useNetworkStatus tests — network state detection (3A).
 *
 * Expected behavior:
 * - Treats browser online as a hint and verifies with /health
 * - Stays offline when focus/visibility changes but the probe fails
 * - Exposes isReconnecting state (true when transitioning offline->online)
 * - Cleanup: removes event listeners on unmount
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNetworkStatus } from '../useNetworkStatus';
import { __resetConnectivityForTests, __stopConnectivityMonitorForTests } from '../connectivity';

// Save original
const originalNavigator = globalThis.navigator;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  // The connectivity monitor is a singleton; tear it down so each test starts
  // with a fresh probe and freshly-registered listeners.
  __stopConnectivityMonitorForTests();
  __resetConnectivityForTests('checking');
  // Default: online
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  __stopConnectivityMonitorForTests();
  __resetConnectivityForTests('checking');
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    writable: true,
    configurable: true,
  });
  vi.restoreAllMocks();
});

describe('useNetworkStatus', () => {
  it('switches online only after the reachability probe succeeds', async () => {
    const { result } = renderHook(() => useNetworkStatus());
    await waitFor(() => {
      expect(result.current.isOnline).toBe(true);
      expect(result.current.state).toBe('online');
    });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/health'), expect.any(Object));
  });

  it('treats navigator.onLine=false as a hint and recovers when the probe succeeds', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useNetworkStatus());
    await waitFor(() => {
      expect(result.current.isOnline).toBe(true);
      expect(result.current.state).toBe('online');
    });
  });

  it('sets isOnline=false when window fires offline event', async () => {
    const { result } = renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current.isOnline).toBe(true));

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.isOnline).toBe(false);
  });

  it('remains offline after online/focus hints when the probe fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current.isOnline).toBe(false));

    act(() => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: true },
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(result.current.isOnline).toBe(false);
      expect(result.current.state).toBe('offline');
    });
  });

  it('periodically retries while offline and recovers after a later successful probe', async () => {
    vi.useFakeTimers();
vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const { result } = renderHook(() => useNetworkStatus());

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.state).toBe('offline');

    // The singleton backoff loop schedules its first recheck at 2s.
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isOnline).toBe(true);
    vi.useRealTimers();
  });

  it('sets isReconnecting=true after verified offline-to-online recovery', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(new Response('{}', { status: 200 }));
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current.isOnline).toBe(false));

    act(() => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: true },
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(result.current.isReconnecting).toBe(true);
      expect(result.current.state).toBe('reconnecting');
    });
  });

  it('rechecks after reconnecting and settles online after timeout', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(new Response('{}', { status: 200 }));
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useNetworkStatus());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isOnline).toBe(false);

    act(() => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: true },
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('online'));
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isReconnecting).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(result.current.state).toBe('online');
    vi.useRealTimers();
  });

  it('does NOT set isReconnecting when already online (online event while already online)', async () => {
    const { result } = renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current.isOnline).toBe(true));
    expect(result.current.isReconnecting).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current.isReconnecting).toBe(false);
  });

  it('starts the global monitor once and does not duplicate listeners across mounts', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => useNetworkStatus());
    expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('offline', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('focus', expect.any(Function));

    const onlineListenerCount = addSpy.mock.calls.filter((c) => c[0] === 'online').length;

    // A second hook instance must NOT register another set of listeners — the
    // monitor is a singleton (this is the fix for N parallel /health probes).
    renderHook(() => useNetworkStatus());
    const onlineListenerCountAfter = addSpy.mock.calls.filter((c) => c[0] === 'online').length;

    expect(onlineListenerCountAfter).toBe(onlineListenerCount);
  });
});
