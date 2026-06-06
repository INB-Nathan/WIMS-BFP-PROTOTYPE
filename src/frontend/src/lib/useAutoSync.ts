/**
 * useAutoSync — auto-sync on reconnect (FR-3C).
 *
 * Listens to network reconnect events and triggers syncPendingIncidents
 * after a 2s debounce. Exposes manual syncNow() for immediate sync.
 * Surfaces conflict count so the encoder dashboard can prompt resolution.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNetworkStatus } from './useNetworkStatus';
import { syncPendingIncidents, type SyncResult } from './syncEngine';
import { getPendingOpsCount } from './offlineStore';
import { useUserProfile } from './auth';
import { toast } from 'sonner';

export interface AutoSyncState {
  syncing: boolean;
  lastSyncedAt: Date | null;
  pendingCount: number;
  conflictCount: number;
  syncNow: () => Promise<void>;
}

export function useAutoSync(): AutoSyncState {
  const { isReconnecting } = useNetworkStatus();
  const { user } = useUserProfile();
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const syncMutex = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshPendingCount = useCallback(async () => {
    if (!user?.id) return;
    const count = await getPendingOpsCount(user.id);
    setPendingCount(count);
  }, [user?.id]);

  const doSync = useCallback(async () => {
    if (!user?.id) return;
    // Mutex: prevent concurrent syncs
    if (syncMutex.current) return;
    syncMutex.current = true;
    setSyncing(true);

    try {
      const result: SyncResult = await syncPendingIncidents(user.id);

      setLastSyncedAt(new Date());

      if (result.abortReason === 'auth') {
        toast.error('Session expired — please log in again to sync offline data');
        return;
      }

      if (result.abortReason === 'offline') return; // silently skip

      if (result.synced > 0 && result.failed === 0 && result.conflicts === 0) {
        toast.success(
          `Synced ${result.synced} incident${result.synced === 1 ? '' : 's'}`
        );
      } else if (result.conflicts > 0) {
        toast.warning(
          `Synced ${result.synced}. ${result.conflicts} item${result.conflicts === 1 ? '' : 's'} need your attention.`
        );
        setConflictCount((prev) => prev + result.conflicts);
      } else if (result.failed > 0 && result.synced > 0) {
        toast.warning(
          `Synced ${result.synced}, ${result.failed} failed — will retry`
        );
      } else if (result.failed > 0) {
        toast.error(
          `${result.failed} item${result.failed === 1 ? '' : 's'} failed to sync`
        );
      }
    } finally {
      setSyncing(false);
      syncMutex.current = false;
      await refreshPendingCount();
    }
  }, [user?.id, refreshPendingCount]);

  const syncNow = useCallback(async () => {
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

  // Fetch pending count on mount and when user changes
  useEffect(() => {
    refreshPendingCount();
  }, [refreshPendingCount]);

  return { syncing, lastSyncedAt, pendingCount, conflictCount, syncNow };
}
