/**
 * usePublicAutoSync — auto-sync on reconnect for the civilian anonymous queue.
 *
 * Mirrors useAutoSync (the encoder hook) but:
 *   - does NOT depend on useAuth (civilians are anonymous)
 *   - identifies via deviceId from localStorage
 *   - on a failed sync with no successes, prompts the user to enable desktop
 *     notifications and, when granted, fires a brief Notification summarising
 *     what was received (handoff decision #5: prompt after failed sync).
 *
 * The Notification prompt is intentionally separate from the toast so the
 * user has a persistent reminder even if the toast times out. We only ask
 * once per page load (track via a ref) to avoid nagging.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNetworkStatus } from './useNetworkStatus';
import { syncPublicOfflineOps, type PublicSyncResult, type PublicSyncedIncidentSummary } from './syncEngine';
import { getPendingPublicOpsCount, getPendingPhotoCount, recoverStalePublicSyncingOps } from './offlineStore';
import { toast } from 'sonner';

export type { PublicSyncedIncidentSummary };

export interface PublicAutoSyncState {
  syncing: boolean;
  lastSyncedAt: Date | null;
  pendingCount: number;
  failedCount: number;
  syncNow: () => Promise<void>;
}

const DEVICE_ID_KEY = 'wims_civilian_device_id';
const RECONNECT_DEBOUNCE_MS = 2000;
const MOUNT_SYNC_DELAY_MS = 1500;
const OFFLINE_TOAST_ID = 'wims-civilian-connection-offline';

function getDeviceId(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(DEVICE_ID_KEY) : null;
  } catch {
    return null;
  }
}

function getNotificationCtor(): typeof Notification | null {
  if (typeof window === 'undefined') return null;
  if (typeof Notification === 'undefined') return null;
  return Notification;
}

export function usePublicAutoSync(): PublicAutoSyncState {
  const { isOnline, isReconnecting } = useNetworkStatus();
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [pendingPhotoCount, setPendingPhotoCount] = useState(0);
  const syncMutex = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMountSynced = useRef(false);
  const notificationPromptShownRef = useRef(false);
  const offlineToastShownRef = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    const deviceId = getDeviceId();
    if (!deviceId) return;
    const count = await getPendingPublicOpsCount(deviceId);
    const photoCount = await getPendingPhotoCount(deviceId);
    setPendingCount(count + photoCount);
    setPendingPhotoCount(photoCount);
  }, []);

  const promptForNotifications = useCallback(async (): Promise<void> => {
    const NotificationCtor = getNotificationCtor();
    if (!NotificationCtor) return;
    if (NotificationCtor.permission !== 'default') return;
    if (notificationPromptShownRef.current) return;
    notificationPromptShownRef.current = true;
    try {
      await NotificationCtor.requestPermission();
    } catch {
      // ignore — some browsers throw on insecure origins
    }
  }, []);

  const fireDesktopNotification = useCallback((summaries: PublicSyncedIncidentSummary[]): void => {
    const NotificationCtor = getNotificationCtor();
    if (!NotificationCtor || NotificationCtor.permission !== 'granted') return;
    if (summaries.length === 0) return;
    const top = summaries[0];
    const remaining = summaries.length - 1;
    const body =
      remaining > 0
        ? `${top.category || 'Report'} — and ${remaining} more ${remaining === 1 ? 'item' : 'items'} synced`
        : `${top.category || 'Report'} received`;
    try {
      new NotificationCtor('BFP report sync', { body, tag: 'wims-public-sync' });
    } catch {
      // Some browsers throw on construction in non-secure contexts.
    }
  }, []);

  const doSync = useCallback(
    async (options: { bypassBackoff?: boolean } = {}) => {
      const deviceId = getDeviceId();
      if (!deviceId) return;
      if (syncMutex.current) return;
      syncMutex.current = true;
      setSyncing(true);
      try {
        // The public sync engine currently has no backoff window (every retryable
        // op is replayed), so the bypassBackoff flag is accepted for API parity
        // with the encoder hook but does not change behaviour.
        const result: PublicSyncResult = options.bypassBackoff
          ? await syncPublicOfflineOps(deviceId, { bypassBackoff: true })
          : await syncPublicOfflineOps(deviceId);

        setLastSyncedAt(new Date());

        if (result.abortReason === 'offline') {
          // Still offline — silent. The reconnect listener will retry.
          return;
        }

        setFailedCount(result.failed);

        // Build photo sync summary
        let photoMsg = '';
        if (result.photoSynced > 0) {
          photoMsg += `, ${result.photoSynced} photo${result.photoSynced === 1 ? '' : 's'} uploaded`;
        }
        if (result.photoFailed > 0) {
          photoMsg += `, ${result.photoFailed} photo${result.photoFailed === 1 ? '' : 's'} failed`;
        }
        if (result.photoKeyLost > 0) {
          photoMsg += `, ${result.photoKeyLost} photo${result.photoKeyLost === 1 ? '' : 's'} unrecoverable`;
        }

        if (result.synced > 0 && result.failed === 0) {
          toast.success(
            `Synced ${result.synced} ${result.synced === 1 ? 'report' : 'reports'}${photoMsg}`,
            { duration: 4000 },
          );
          fireDesktopNotification(result.syncedIncidents);
        } else if (result.synced > 0 && result.failed > 0) {
          toast.warning(
            `Synced ${result.synced}, ${result.failed} failed${photoMsg} — will retry`,
          );
          // Part-success with failures: still fire the desktop notification
          // for the successful part, and prompt for notifications if not done.
          fireDesktopNotification(result.syncedIncidents);
          void promptForNotifications();
        } else if (result.failed > 0) {
          toast.error(`${result.failed} ${result.failed === 1 ? 'report' : 'reports'} failed to sync${photoMsg}`);
          void promptForNotifications();
        }
      } finally {
        setSyncing(false);
        syncMutex.current = false;
        await refreshPendingCount();
      }
    },
    [refreshPendingCount, fireDesktopNotification, promptForNotifications],
  );

  const syncNow = useCallback(async () => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    await doSync({ bypassBackoff: true });
  }, [doSync]);

  // Persistent offline toast (mirror of useAutoSync's behaviour)
  useEffect(() => {
    if (isOnline) {
      if (offlineToastShownRef.current) {
        toast.dismiss(OFFLINE_TOAST_ID);
        offlineToastShownRef.current = false;
      }
      return;
    }
    if (!offlineToastShownRef.current) {
      toast.warning('You are offline — your report will be sent when you reconnect.', {
        id: OFFLINE_TOAST_ID,
        duration: Infinity,
      });
      offlineToastShownRef.current = true;
    }
  }, [isOnline]);

  // Reconnect → debounce → sync
  useEffect(() => {
    if (!isReconnecting) return;
    toast.dismiss(OFFLINE_TOAST_ID);
    if (pendingCount > 0) {
      toast.success('Back online. Syncing your report…', { duration: 4000 });
    } else {
      toast.success('Back online.', { duration: 2000 });
    }
    debounceTimer.current = setTimeout(() => {
      doSync();
    }, RECONNECT_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
  }, [isReconnecting]); // eslint-disable-line react-hooks/exhaustive-deps

  // On-mount sync: handles the re-login-less case where reconnect event never fires
  // Triggers on both pending reports and pending photos
  useEffect(() => {
    if (hasMountSynced.current) return;
    if (!isOnline) return;
    const deviceId = getDeviceId();
    if (!deviceId) return;
    if (pendingCount === 0 && pendingPhotoCount === 0) return;
    hasMountSynced.current = true;
    const t = setTimeout(() => { doSync(); }, MOUNT_SYNC_DELAY_MS);
    return () => clearTimeout(t);
  }, [isOnline, pendingCount, pendingPhotoCount, doSync]);

  // On mount: recover any public ops stranded in 'syncing' (tab closed or
  // page crashed mid-sync), then refresh the pending count so the badge
  // reflects the full queue. Mirrors useAutoSync's recovery-then-refresh
  // ordering for the authenticated queue.
  useEffect(() => {
    const deviceId = getDeviceId();
    if (!deviceId) return;
    void recoverStalePublicSyncingOps(deviceId).then(() => refreshPendingCount());
  }, [refreshPendingCount]);

  return { syncing, lastSyncedAt, pendingCount, failedCount, syncNow };
}
