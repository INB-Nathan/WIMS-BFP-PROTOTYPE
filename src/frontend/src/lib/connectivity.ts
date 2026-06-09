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
  setConnectivityState('checking');

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

export function __resetConnectivityForTests(state: ConnectivityState = 'checking'): void {
  probeInFlight = null;
  snapshot = toSnapshot(state, null);
  emit();
}
