/**
 * useNetworkStatus — network state detection hook (FR-3A).
 *
 * Wraps navigator.onLine + window online/offline events.
 * Exposes isReconnecting flag for auto-sync triggering.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface NetworkStatus {
  isOnline: boolean;
  isReconnecting: boolean;
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isReconnecting, setIsReconnecting] = useState(false);
  const wasOffline = useRef(!isOnline);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleOnline = useCallback(() => {
    setIsOnline(true);
    if (wasOffline.current) {
      setIsReconnecting(true);
      // Reset reconnecting state after 3s
      reconnectTimer.current = setTimeout(() => {
        setIsReconnecting(false);
      }, 3000);
      wasOffline.current = false;
    }
  }, []);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
    wasOffline.current = true;
    // Clear any pending reconnect timer
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
    }
    setIsReconnecting(false);
  }, []);

  useEffect(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
    };
  }, [handleOnline, handleOffline]);

  return { isOnline, isReconnecting };
}
