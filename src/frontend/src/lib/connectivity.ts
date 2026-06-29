export type ConnectivityState = 'online' | 'offline' | 'checking' | 'reconnecting';

export interface ConnectivitySnapshot {
  state: ConnectivityState;
  isOnline: boolean;
  isChecking: boolean;
  isReconnecting: boolean;
  lastCheckedAt: number | null;
}

const HEALTH_ENDPOINT = '/health';
const PROBE_TIMEOUT_MS = 2500;

let snapshot: ConnectivitySnapshot = {
  state:
    typeof navigator !== 'undefined' && navigator.onLine === false
      ? 'offline'
      : 'checking',
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  isChecking: typeof navigator !== 'undefined' ? navigator.onLine !== false : false,
  isReconnecting: false,
  lastCheckedAt: null,
};

let probeInFlight: Promise<ConnectivitySnapshot> | null = null;
const listeners = new Set<() => void>();

function toSnapshot(state: ConnectivityState, lastCheckedAt = snapshot.lastCheckedAt): ConnectivitySnapshot {
  return {
    state,
    isOnline: state === 'online' || state === 'reconnecting',
    isChecking: state === 'checking',
    isReconnecting: state === 'reconnecting',
    lastCheckedAt,
  };
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function setConnectivityState(state: ConnectivityState, lastCheckedAt = snapshot.lastCheckedAt): void {
  const next = toSnapshot(state, lastCheckedAt);
  if (next.state === snapshot.state && next.lastCheckedAt === snapshot.lastCheckedAt) {
    return;
  }
  snapshot = next;
  emit();
}


export function getConnectivitySnapshot(): ConnectivitySnapshot {
  return snapshot;
}

export function subscribeConnectivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markConnectivityOffline(): void {
  setConnectivityState('offline', Date.now());
}

export async function probeConnectivity(): Promise<ConnectivitySnapshot> {
  if (typeof window === 'undefined') {
    return snapshot;
  }

  if (probeInFlight) return probeInFlight;

  const wasOffline = snapshot.state === 'offline';
  // Only show 'checking' (isOnline=false) when genuinely transitioning from offline.
  // Probes triggered while online (initial probe, focus/visibility recheck, reconnect
  // confirmation) must NOT flash the UI offline for the duration of the HTTP round-trip.
  if (wasOffline) {
    setConnectivityState('checking');
  }

  probeInFlight = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(`${HEALTH_ENDPOINT}?_=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      const checkedAt = Date.now();
      if (response.ok) {
        setConnectivityState(wasOffline ? 'reconnecting' : 'online', checkedAt);
        return snapshot;
      }
      setConnectivityState('offline', checkedAt);
      return snapshot;
    } catch {
      setConnectivityState('offline', Date.now());
      return snapshot;
    } finally {
      window.clearTimeout(timeout);
      probeInFlight = null;
    }
  })();

  return probeInFlight;
}

export async function isReachable(): Promise<boolean> {
  const result = await probeConnectivity();
  return result.isOnline;
}

// ── Singleton connectivity monitor (item G13) ────────────────────────────────
// Exactly ONE recheck loop + ONE set of event listeners runs for the whole app,
// regardless of how many components call useNetworkStatus(). Previously each hook
// instance owned its own 5s interval, so the /health endpoint was probed N times
// in parallel — the source of constant health-probe failures while offline.

const OFFLINE_RECHECK_MIN_MS = 2000;
const OFFLINE_RECHECK_MAX_MS = 30000;
const RECONNECT_CONFIRM_MS = 3000;

let monitorStarted = false;
let loopActive = false;
let recheckDelay = OFFLINE_RECHECK_MIN_MS;
let recheckTimer: ReturnType<typeof setTimeout> | null = null;
let confirmTimer: ReturnType<typeof setTimeout> | null = null;
// Teardown handles so tests (and, in principle, a full reset) can remove the
// singleton's listeners and subscription.
let monitorTeardown: (() => void) | null = null;

function stopLoop() {
  loopActive = false;
  recheckDelay = OFFLINE_RECHECK_MIN_MS;
  if (recheckTimer) {
    clearTimeout(recheckTimer);
    recheckTimer = null;
  }
}

function tick() {
  if (!loopActive || recheckTimer) return;
  recheckTimer = setTimeout(async () => {
    recheckTimer = null;
    if (!loopActive) return;
    await probeConnectivity();
    if (!loopActive) return;
    if (snapshot.state === 'offline') {
      // Exponential backoff so a long offline stretch doesn't hammer /health.
      recheckDelay = Math.min(recheckDelay * 2, OFFLINE_RECHECK_MAX_MS);
      tick();
    } else {
      stopLoop();
    }
  }, recheckDelay);
}

function startLoop() {
  if (loopActive) return;
  loopActive = true;
  recheckDelay = OFFLINE_RECHECK_MIN_MS;
  tick();
}

/**
 * Start the global connectivity monitor. Idempotent — safe to call from every
 * useNetworkStatus mount; only the first call wires anything up.
 */
export function startConnectivityMonitor() {
  if (monitorStarted || typeof window === 'undefined') return;
  monitorStarted = true;

  const verifyOnlineHint = () => { void probeConnectivity(); };
  const handleOffline = () => { markConnectivityOffline(); };
  const handleVisibilityOrFocus = () => {
    if (document.visibilityState === 'visible') verifyOnlineHint();
  };

  window.addEventListener('online', verifyOnlineHint);
  window.addEventListener('offline', handleOffline);
  window.addEventListener('focus', handleVisibilityOrFocus);
  document.addEventListener('visibilitychange', handleVisibilityOrFocus);

  // Drive the single recheck loop from state transitions.
  const unsubscribe = subscribeConnectivity(() => {
    const s = snapshot.state;
    if (s === 'offline') {
      startLoop();
    } else if (s === 'checking') {
      // Probe in flight — leave the loop running so backoff isn't reset.
    } else {
      stopLoop();
      if (s === 'reconnecting') {
        if (confirmTimer) clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => { void probeConnectivity(); }, RECONNECT_CONFIRM_MS);
      }
    }
  });

  monitorTeardown = () => {
    window.removeEventListener('online', verifyOnlineHint);
    window.removeEventListener('offline', handleOffline);
    window.removeEventListener('focus', handleVisibilityOrFocus);
    document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    unsubscribe();
  };

  void probeConnectivity();
}

/** Tear down the monitor (listeners, loop, timers). Primarily for tests. */
export function __stopConnectivityMonitorForTests() {
  stopLoop();
  if (confirmTimer) {
    clearTimeout(confirmTimer);
    confirmTimer = null;
  }
  if (monitorTeardown) {
    monitorTeardown();
    monitorTeardown = null;
  }
  monitorStarted = false;
}

export function __resetConnectivityForTests(state: ConnectivityState = 'checking') {
  probeInFlight = null;
  snapshot = toSnapshot(state, null);
  emit();
}
