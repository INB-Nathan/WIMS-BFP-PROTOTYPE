/**
 * useAutoSync — auto-sync on reconnect (FR-3C).
 *
 * Listens to network reconnect events and triggers syncPendingIncidents
 * after a 2s debounce. Exposes manual syncNow() for immediate sync.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNetworkStatus } from './useNetworkStatus';
import { syncPendingIncidents } from './syncEngine';
import { getPendingIncidents } from './offlineStore';

export interface AutoSyncState {
  syncing: boolean;
  lastSyncedAt: Date | null;
  pendingCount: number;
  syncNow: () => Promise<void>;
}

export function useAutoSync(): AutoSyncState {
  const { isReconnecting } = useNetworkStatus();
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const syncMutex = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();

  const refreshPendingCount = useCallback(async () => {
    const pending = await getPendingIncidents();
    setPendingCount(pending.length);
  }, []);

  const doSync = useCallback(async () => {
    // Mutex: prevent concurrent syncs
    if (syncMutex.current) return;
    syncMutex.current = true;
    setSyncing(true);

    try {
      await syncPendingIncidents();
      setLastSyncedAt(new Date());
    } finally {
      setSyncing(false);
      syncMutex.current = false;
      await refreshPendingCount();
    }
  }, [refreshPendingCount]);

  const syncNow = useCallback(async () => {
    // Cancel any pending debounce
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    await doSync();
  }, [doSync]);

  // Auto-sync on reconnect with 2s debounce
  useEffect(() => {
    if (isReconnecting) {
      debounceTimer.current = setTimeout(() => {
        doSync();
      }, 2000);
    }

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [isReconnecting, doSync]);

  // Fetch pending count on mount
  useEffect(() => {
    refreshPendingCount();
  }, [refreshPendingCount]);

  return { syncing, lastSyncedAt, pendingCount, syncNow };
}
