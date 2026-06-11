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
import { syncPendingIncidents, type SyncResult, type SyncedIncidentSummary } from './syncEngine';
import { getPendingOpsCount, recoverStaleSyncingOps } from './offlineStore';
import { useUserProfile } from './auth';
import { toast } from 'sonner';

export type { SyncedIncidentSummary };

export interface AutoSyncState {
  syncing: boolean;
  lastSyncedAt: Date | null;
  pendingCount: number;
  conflictCount: number;
  authFailed: boolean;
  syncNow: () => Promise<void>;
}

const OFFLINE_TOAST_ID = 'wims-connection-offline';

export function useAutoSync(): AutoSyncState {
  const { isOnline, isChecking, isReconnecting } = useNetworkStatus();
  const { user } = useUserProfile();
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [authFailed, setAuthFailed] = useState(false);
  const syncMutex = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMountSynced = useRef(false);
  const authToastShownRef = useRef(false);

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
        if (!authToastShownRef.current) {
          authToastShownRef.current = true;
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
        }
        return;
      }

      // auth was OK — clear the failed flag
      setAuthFailed(false);
      authToastShownRef.current = false;

      if (result.abortReason === 'offline') return; // still offline — silent

      if (result.synced > 0 && result.failed === 0 && result.conflicts === 0) {
        toast.success(`Synced ${result.synced} incident${result.synced === 1 ? '' : 's'}`);
        window.dispatchEvent(new CustomEvent<{ incidents: SyncedIncidentSummary[] }>(
          'wims:sync-complete',
          { detail: { incidents: result.syncedIncidents ?? [] } },
        ));
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

  // Show a persistent "You're offline" toast when connection is lost; dismiss on recovery.
  // A fixed toast id prevents duplicate toasts during rapid online/offline flapping.
  useEffect(() => {
    if (!isOnline && !isChecking) {
      toast.warning("You're offline. Changes will sync when connection is restored.", {
        id: OFFLINE_TOAST_ID,
        duration: Infinity,
      });
    } else {
      toast.dismiss(OFFLINE_TOAST_ID);
    }
  }, [isOnline, isChecking]);

  // Auto-sync on reconnect with 2s debounce + reconnect notification toast
  useEffect(() => {
    if (!isReconnecting) return;

    // Dismiss the offline banner immediately so the user sees the "back online" message.
    toast.dismiss(OFFLINE_TOAST_ID);

    if (pendingCount > 0) {
      toast.success(
        `Back online. Syncing your changes…`,
        { duration: 4000 },
      );
    } else {
      toast.success('Back online.', { duration: 2000 });
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

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'run-sync') {
        void doSync();
      }
    };
    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage);
    };
  }, [doSync]);

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

  // On mount: recover any ops stuck in 'syncing' state (tab closed mid-sync),
  // then fetch the pending count so the badge reflects the full queue.
  useEffect(() => {
    if (!user?.id) return;
    const encoderId = user.id;
    void recoverStaleSyncingOps(encoderId).then(() => refreshPendingCount());
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // intentionally not listing refreshPendingCount — it's stable but capturing it
  // would add an extra mount call since it references user?.id transitively.

  return { syncing, lastSyncedAt, pendingCount, conflictCount, authFailed, syncNow };
}
