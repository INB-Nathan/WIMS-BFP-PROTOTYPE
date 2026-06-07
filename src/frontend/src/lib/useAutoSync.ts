/**
 * useAutoSync — auto-sync on reconnect (FR-3C).
 *
 * Listens to network reconnect events and triggers syncPendingIncidents
 * after a 2s debounce. Exposes manual syncNow() for immediate sync.
 * Surfaces conflict count so the encoder dashboard can prompt resolution.
 *
 * On-mount sync: if the user has pending ops and is already online when
 * the component mounts (e.g. after a re-login), sync fires automatically
 * after a 1.5s stabilisation delay. This covers the "re-logged in but
 * sync never triggered" case where no offline→online transition occurred.
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
  authFailed: boolean;
  syncNow: () => Promise<void>;
}

export function useAutoSync(): AutoSyncState {
  const { isOnline, isReconnecting } = useNetworkStatus();
  const { user } = useUserProfile();
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [authFailed, setAuthFailed] = useState(false);
  const syncMutex = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMountSynced = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    if (!user?.id) return;
    const count = await getPendingOpsCount(user.id);
    setPendingCount(count);
  }, [user?.id]);

  const doSync = useCallback(async () => {
    if (!user?.id) return;
    if (syncMutex.current) return;
    syncMutex.current = true;
    setSyncing(true);

    try {
      const result: SyncResult = await syncPendingIncidents(user.id);

      setLastSyncedAt(new Date());

      if (result.abortReason === 'auth') {
        setAuthFailed(true);
        toast.error(
          `Session expired — ${pendingCount > 0 ? `${pendingCount} incident${pendingCount !== 1 ? 's' : ''} still queued. ` : ''}Log in again to sync.`,
          {
            duration: Infinity,
            action: {
              label: 'Log In',
              onClick: () => { window.location.href = '/login'; },
            },
          },
        );
        return;
      }

      // auth was OK — clear the failed flag
      setAuthFailed(false);

      if (result.abortReason === 'offline') return; // still offline — silent

      if (result.synced > 0 && result.failed === 0 && result.conflicts === 0) {
        toast.success(`Synced ${result.synced} incident${result.synced === 1 ? '' : 's'}`);
      } else if (result.conflicts > 0) {
        toast.warning(
          `Synced ${result.synced}. ${result.conflicts} item${result.conflicts === 1 ? '' : 's'} need your attention.`,
        );
        setConflictCount((prev) => prev + result.conflicts);
      } else if (result.failed > 0 && result.synced > 0) {
        toast.warning(`Synced ${result.synced}, ${result.failed} failed — will retry`);
      } else if (result.failed > 0) {
        toast.error(`${result.failed} item${result.failed === 1 ? '' : 's'} failed to sync`);
      }
    } finally {
      setSyncing(false);
      syncMutex.current = false;
      await refreshPendingCount();
    }
  }, [user?.id, pendingCount, refreshPendingCount]);

  const syncNow = useCallback(async () => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    await doSync();
  }, [doSync]);

  // Auto-sync on reconnect with 2s debounce + reconnect notification toast
  useEffect(() => {
    if (!isReconnecting) return;

    if (pendingCount > 0) {
      toast.info(
        `Connection restored — syncing ${pendingCount} queued incident${pendingCount !== 1 ? 's' : ''}`,
        { duration: 3000 },
      );
    } else {
      toast.success('Connection restored', { duration: 2000 });
    }

    debounceTimer.current = setTimeout(() => {
      doSync();
    }, 2000);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [isReconnecting]); // eslint-disable-line react-hooks/exhaustive-deps
  // intentionally omitting pendingCount/doSync: this runs once per reconnect event,
  // capturing the count at the moment the event fires is the desired behaviour.

  // On-mount sync: handles the re-login case where no offline→online transition
  // occurred so isReconnecting never becomes true. Fires once per mount if the
  // user is already online with pending ops.
  useEffect(() => {
    if (hasMountSynced.current) return;
    if (!isOnline || !user?.id || pendingCount === 0) return;
    hasMountSynced.current = true;
    const t = setTimeout(() => { doSync(); }, 1500);
    return () => clearTimeout(t);
  }, [isOnline, user?.id, pendingCount, doSync]);

  // Fetch pending count on mount and when user changes
  useEffect(() => {
    refreshPendingCount();
  }, [refreshPendingCount]);

  return { syncing, lastSyncedAt, pendingCount, conflictCount, authFailed, syncNow };
}
