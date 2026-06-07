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
  markConnectivityOffline,
  probeConnectivity,
  subscribeConnectivity,
  type ConnectivityState,
} from './connectivity';

export interface NetworkStatus {
  state: ConnectivityState;
  isOnline: boolean;
  isChecking: boolean;
  isReconnecting: boolean;
  lastCheckedAt: number | null;
}

export function useNetworkStatus(): NetworkStatus {
  const status = useSyncExternalStore(
    subscribeConnectivity,
    getConnectivitySnapshot,
    getConnectivitySnapshot,
  );

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const verifyOnlineHint = () => {
      void probeConnectivity().then((result) => {
        if (result.state === 'reconnecting') {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            void probeConnectivity();
          }, 3000);
        }
      });
    };

    const handleOffline = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      markConnectivityOffline();
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') verifyOnlineHint();
    };

    window.addEventListener('online', verifyOnlineHint);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    verifyOnlineHint();

    return () => {
      window.removeEventListener('online', verifyOnlineHint);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  return status;
}
