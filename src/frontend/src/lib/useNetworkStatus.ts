/**
 * useNetworkStatus — verified network state detection hook (FR-3A).
 *
 * Browser online/offline events are hints only. The app remains offline until a
 * same-origin /health probe succeeds, which prevents tab changes from falsely
 * flipping the indicator back to online.
 */

import { useEffect, useSyncExternalStore } from 'react';
import {
  getConnectivitySnapshot,
  startConnectivityMonitor,
  subscribeConnectivity,
  type ConnectivityState,
  type ConnectivitySnapshot,
} from './connectivity';

export interface NetworkStatus {
  state: ConnectivityState;
  isOnline: boolean;
  isChecking: boolean;
  isReconnecting: boolean;
  lastCheckedAt: number | null;
}

// Stable snapshot used during SSR and hydration.
// Always reports 'checking' so server-rendered HTML matches the client's
// first-pass render regardless of navigator.onLine. Without this, React 19
// throws a hydration mismatch because navigator is undefined on the server
// (giving isOnline=true) while an offline client gives isOnline=false.
function getServerConnectivitySnapshot(): ConnectivitySnapshot {
  return {
    state: 'checking',
    isOnline: false,
    isChecking: true,
    isReconnecting: false,
    lastCheckedAt: null,
  };
}

export function useNetworkStatus(): NetworkStatus {
  const status = useSyncExternalStore(
    subscribeConnectivity,
    getConnectivitySnapshot,
    getServerConnectivitySnapshot,
  );

  // Ensure the single global monitor is running. Idempotent — only the first
  // mount wires up listeners and the recheck loop (see connectivity.ts), so
  // having many components call this does not create duplicate /health probes.
  useEffect(() => {
    startConnectivityMonitor();
  }, []);

  return status;
}
