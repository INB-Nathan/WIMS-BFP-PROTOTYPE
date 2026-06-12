/**
 * T5: connectivity.ts singleton/probe/subscriber tests.
 *
 * Covers:
 *  - getConnectivitySnapshot() returns current snapshot
 *  - subscribeConnectivity() notifies on state change
 *  - Unsubscribe return function removes listener
 *  - markConnectivityOffline() sets state to offline + notifies
 *  - probeConnectivity():
 *      * Returns current snapshot in server context (no window)
 *      * Deduplicates in-flight probes
 *      * Sets 'checking' state while probing
 *      * Transitions to 'online' on successful /health fetch
 *      * Transitions to 'reconnecting' when previously offline
 *      * Transitions to 'offline' on fetch failure / non-ok status
 *      * Clears timeout on completion
 *  - isReachable() delegates to probeConnectivity
 *  - __resetConnectivityForTests() resets internal state and clears probeInFlight
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getConnectivitySnapshot,
  subscribeConnectivity,
  markConnectivityOffline,
  probeConnectivity,
  isReachable,
  __resetConnectivityForTests,
} from '../connectivity';

// --------------------------------------------------------------------------
// Save/restore navigator
// --------------------------------------------------------------------------
const savedNavigator = globalThis.navigator;

function setNavigatorOnline(online: boolean) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: online },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  __resetConnectivityForTests('checking');
  setNavigatorOnline(true);

  // Ensure window is present
  if (typeof window === 'undefined') {
    (globalThis as Record<string, unknown>).window = { clearTimeout, setTimeout, fetch };
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'navigator', {
    value: savedNavigator,
    writable: true,
    configurable: true,
  });
});

// --------------------------------------------------------------------------
// Helper: stub fetch with a response
// --------------------------------------------------------------------------
function stubFetchOk(status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status })),
  );
}

function stubFetchError() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
}

// --------------------------------------------------------------------------
// getConnectivitySnapshot
// --------------------------------------------------------------------------
describe('getConnectivitySnapshot', () => {
  it('returns a snapshot with expected shape', () => {
    const snap = getConnectivitySnapshot();
    expect(snap).toHaveProperty('state');
    expect(snap).toHaveProperty('isOnline');
    expect(snap).toHaveProperty('isChecking');
    expect(snap).toHaveProperty('isReconnecting');
    expect(snap).toHaveProperty('lastCheckedAt');
  });
});

// --------------------------------------------------------------------------
// subscribeConnectivity / unsubscribe
// --------------------------------------------------------------------------
describe('subscribeConnectivity', () => {
  it('calls listener when state changes', () => {
    __resetConnectivityForTests('online');
    const cb = vi.fn();
    subscribeConnectivity(cb);

    markConnectivityOffline();

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('notifies listener when markConnectivityOffline refreshes timestamp', () => {
    // markConnectivityOffline always updates lastCheckedAt, so even when
    // already offline it counts as a new snapshot and notifies listeners.
    __resetConnectivityForTests('offline');
    const cb = vi.fn();
    subscribeConnectivity(cb);
    cb.mockClear();

    markConnectivityOffline();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('returns an unsubscribe function that removes the listener', () => {
    __resetConnectivityForTests('online');
    const cb = vi.fn();
    const unsubscribe = subscribeConnectivity(cb);

    markConnectivityOffline();
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    cb.mockClear();

    __resetConnectivityForTests('online');
    expect(cb).toHaveBeenCalledTimes(0); // not called after unsubscribe
  });
});

// --------------------------------------------------------------------------
// markConnectivityOffline
// --------------------------------------------------------------------------
describe('markConnectivityOffline', () => {
  it('sets state to offline and records timestamp', () => {
    // Reset to online first so the transition is meaningful
    __resetConnectivityForTests('online');

    const before = Date.now();
    markConnectivityOffline();
    const after = Date.now();

    const snap = getConnectivitySnapshot();
    expect(snap.state).toBe('offline');
    expect(snap.isOnline).toBe(false);
    expect(snap.isReconnecting).toBe(false);
    expect(snap.lastCheckedAt).toBeGreaterThanOrEqual(before);
    expect(snap.lastCheckedAt).toBeLessThanOrEqual(after);
  });
});

// --------------------------------------------------------------------------
// probeConnectivity
// --------------------------------------------------------------------------
describe('probeConnectivity', () => {
  it('returns current snapshot when window is undefined (SSR/server)', async () => {
    delete (globalThis as Record<string, unknown>).window;

    const snap = await probeConnectivity();
    // Should return the current snapshot unchanged
    expect(snap).toEqual(getConnectivitySnapshot());

    // Restore window
    (globalThis as Record<string, unknown>).window = { clearTimeout, setTimeout, fetch };
  });

  it('deduplicates in-flight probes — fetch called only once', async () => {
    // Create a fetch that resolves after a brief delay so we can observe dedup
    let resolveFetch: (r: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchStub = vi.fn().mockReturnValue(fetchPromise);
    vi.stubGlobal('fetch', fetchStub);

    const p1 = probeConnectivity();
    const p2 = probeConnectivity();

    // Both calls hit the same probeInFlight, so fetch was only invoked once
    expect(fetchStub).toHaveBeenCalledTimes(1);

    resolveFetch!(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
  });

  it('sets state to "checking" while probing', async () => {
    let resolveFetch: (r: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(fetchPromise));

    const probePromise = probeConnectivity();

    // State should be 'checking' immediately after calling probeConnectivity
    // (setConnectivityState runs synchronously before the first await)
    const snapDuring = getConnectivitySnapshot();
    expect(snapDuring.state).toBe('checking');
    expect(snapDuring.isChecking).toBe(true);

    resolveFetch!(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    await probePromise;
  });

  it('transitions to "online" on a successful /health fetch', async () => {
    stubFetchOk(200);

    const snap = await probeConnectivity();

    expect(snap.state).toBe('online');
    expect(snap.isOnline).toBe(true);
    expect(snap.isReconnecting).toBe(false);
    expect(snap.lastCheckedAt).toBeGreaterThan(0);
  });

  it('transitions to "reconnecting" when previously offline and fetch succeeds', async () => {
    // First, go offline
    markConnectivityOffline();
    expect(getConnectivitySnapshot().state).toBe('offline');

    // Now probe — should go to reconnecting since we were offline
    stubFetchOk(200);

    const snap = await probeConnectivity();

    expect(snap.state).toBe('reconnecting');
    expect(snap.isOnline).toBe(true);
    expect(snap.isReconnecting).toBe(true);
  });

  it('transitions to "offline" on non-ok response status', async () => {
    stubFetchOk(500);

    const snap = await probeConnectivity();

    expect(snap.state).toBe('offline');
    expect(snap.isOnline).toBe(false);
  });

  it('transitions to "offline" on fetch error', async () => {
    stubFetchError();

    const snap = await probeConnectivity();

    expect(snap.state).toBe('offline');
    expect(snap.isOnline).toBe(false);
  });

  it('clears probe timeout after success', async () => {
    const clearSpy = vi.spyOn(window, 'clearTimeout');
    stubFetchOk(200);

    await probeConnectivity();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('fetches /health with no-store cache, same-origin credentials, and unique query param', async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchStub);

    await probeConnectivity();

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^\/health\?_=\d+$/);
    expect(init.cache).toBe('no-store');
    expect(init.credentials).toBe('same-origin');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

// --------------------------------------------------------------------------
// isReachable
// --------------------------------------------------------------------------
describe('isReachable', () => {
  it('returns true when probe reports online', async () => {
    stubFetchOk(200);
    const reachable = await isReachable();
    expect(reachable).toBe(true);
  });

  it('returns false when probe reports offline', async () => {
    stubFetchError();
    const reachable = await isReachable();
    expect(reachable).toBe(false);
  });
});

// --------------------------------------------------------------------------
// __resetConnectivityForTests
// --------------------------------------------------------------------------
describe('__resetConnectivityForTests', () => {
  it('resets snapshot to the given state', () => {
    markConnectivityOffline();
    expect(getConnectivitySnapshot().state).toBe('offline');

    __resetConnectivityForTests('online');

    const snap = getConnectivitySnapshot();
    expect(snap.state).toBe('online');
    expect(snap.isOnline).toBe(true);
    expect(snap.isReconnecting).toBe(false);
    expect(snap.lastCheckedAt).toBeNull();
  });

  it('emits notification so subscribers refresh', () => {
    __resetConnectivityForTests('online');
    const cb = vi.fn();
    subscribeConnectivity(cb);
    cb.mockClear();

    __resetConnectivityForTests('reconnecting');
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
