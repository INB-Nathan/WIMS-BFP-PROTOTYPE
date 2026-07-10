/**
 * usePublicAutoSync tests — Pattern C (vi.hoisted + Notification mock).
 *
 * The civilian auto-sync hook mirrors useAutoSync for the public queue but:
 *   - does NOT depend on useAuth (civilians are anonymous)
 *   - identifies via deviceId from localStorage
 *   - on failure, prompts the user to enable desktop notifications and
 *     fires a Notification with a short report summary
 *
 * These tests verify:
 *   1. syncPublicOfflineOps fires on reconnect (with debounce)
 *   2. syncPublicOfflineOps fires on mount when there are pending ops
 *   3. Notification.requestPermission() is called when sync fails AND
 *      Notification.permission === 'default'
 *   4. A desktop Notification is fired when permission === 'granted'
 *   5. syncNow() bypasses the backoff window
 *   6. The hook returns { syncing, lastSyncedAt, pendingCount, syncNow }
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mock Notification API ──────────────────────────────────────────
const notificationMocks = vi.hoisted(() => ({
  permission: 'default' as NotificationPermission,
  requestPermission: vi.fn(),
  notificationInstances: [] as Array<{ title: string; options?: NotificationOptions }>,
}));

class MockNotification {
  title: string;
  options?: NotificationOptions;
  static get permission(): NotificationPermission {
    return notificationMocks.permission;
  }
  static async requestPermission(): Promise<NotificationPermission> {
    notificationMocks.requestPermission();
    // Default to 'granted' on user acceptance in this test; the test can
    // also set permission directly via the helper below.
    return notificationMocks.permission === 'default' ? 'granted' : notificationMocks.permission;
  }
  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    this.options = options;
    notificationMocks.notificationInstances.push({ title, options });
  }
  static setPermission(p: NotificationPermission) {
    notificationMocks.permission = p;
  }
}

vi.stubGlobal('Notification', MockNotification);

// ── Mock syncEngine ────────────────────────────────────────────────
const syncMocks = vi.hoisted(() => ({
  syncPublicOfflineOps: vi.fn(),
}));

vi.mock('../syncEngine', () => ({
  syncPublicOfflineOps: syncMocks.syncPublicOfflineOps,
}));

// ── Mock offlineStore ──────────────────────────────────────────────
const storeMocks = vi.hoisted(() => ({
  getPendingPublicOpsCount: vi.fn(),
  getPendingPhotoCount: vi.fn(),
}));

vi.mock('../offlineStore', () => ({
  getPendingPublicOpsCount: storeMocks.getPendingPublicOpsCount,
  getPendingPhotoCount: storeMocks.getPendingPhotoCount,
}));

// ── Mock useNetworkStatus ──────────────────────────────────────────
const networkMocks = vi.hoisted(() => ({
  isOnline: true,
  isReconnecting: false,
  isChecking: false,
}));

vi.mock('../useNetworkStatus', () => ({
  useNetworkStatus: () => ({
    state: networkMocks.isOnline ? 'online' : 'offline',
    isOnline: networkMocks.isOnline,
    isReconnecting: networkMocks.isReconnecting,
    isChecking: networkMocks.isChecking,
    lastCheckedAt: null,
  }),
}));

// ── Mock sonner ────────────────────────────────────────────────────
const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: toastMocks,
}));

// Import AFTER all mocks
const { usePublicAutoSync } = await import('../usePublicAutoSync');

const DEVICE_ID = 'test-device-uuid';

const OK_RESULT = {
  synced: 0,
  failed: 0,
  errors: [],
  syncedIncidents: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  notificationMocks.notificationInstances = [];
  notificationMocks.permission = 'default';
  notificationMocks.requestPermission = vi.fn();
  networkMocks.isOnline = true;
  networkMocks.isReconnecting = false;
  storeMocks.getPendingPublicOpsCount.mockResolvedValue(0);
  storeMocks.getPendingPhotoCount.mockResolvedValue(0);
  syncMocks.syncPublicOfflineOps.mockResolvedValue(OK_RESULT);
  try { localStorage.setItem('wims_civilian_device_id', DEVICE_ID); } catch {}
});

afterEach(() => {
  try { localStorage.removeItem('wims_civilian_device_id'); } catch {}
});

// ── Reconnect trigger ─────────────────────────────────────────────

describe('usePublicAutoSync — reconnect trigger', () => {
  it('fires syncPublicOfflineOps after debounce when isReconnecting becomes true', async () => {
    vi.useFakeTimers();
    networkMocks.isReconnecting = true;
    networkMocks.isOnline = true;

    renderHook(() => usePublicAutoSync());

    expect(syncMocks.syncPublicOfflineOps).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(syncMocks.syncPublicOfflineOps).toHaveBeenCalledTimes(1);
    expect(syncMocks.syncPublicOfflineOps).toHaveBeenCalledWith(DEVICE_ID);

    vi.useRealTimers();
  });
});

// ── On-mount sync ────────────────────────────────────────────────

describe('usePublicAutoSync — on-mount sync', () => {
  it('fires sync after 1.5s when there are pending ops and is online', async () => {
    storeMocks.getPendingPublicOpsCount.mockResolvedValue(3);
    syncMocks.syncPublicOfflineOps.mockResolvedValue(OK_RESULT);

    renderHook(() => usePublicAutoSync());

    // Allow the mount useEffect to fire and the on-mount setTimeout to elapse.
    // Real timers keep this simple — we don't depend on the fake-timer microtask
    // flushing that the previous test relied on.
    await new Promise((r) => setTimeout(r, 1700));

    expect(syncMocks.syncPublicOfflineOps).toHaveBeenCalledTimes(1);
    expect(syncMocks.syncPublicOfflineOps).toHaveBeenCalledWith(DEVICE_ID);
  });
});

// ── Notification prompt ─────────────────────────────────────────

describe('usePublicAutoSync — notification prompt on failure', () => {
  it('calls Notification.requestPermission when sync fails AND permission=default', async () => {
    syncMocks.syncPublicOfflineOps.mockResolvedValue({
      synced: 0,
      failed: 2,
      errors: [
        { localId: 'a', operation: 'submit', error: 'network' },
        { localId: 'b', operation: 'submit', error: 'network' },
      ],
      syncedIncidents: [],
    });
    notificationMocks.permission = 'default';

    const { result } = renderHook(() => usePublicAutoSync());

    await act(async () => {
      await result.current.syncNow();
    });

    expect(notificationMocks.requestPermission).toHaveBeenCalled();
  });

  it('fires a desktop Notification when permission=granted', async () => {
    syncMocks.syncPublicOfflineOps.mockResolvedValue({
      synced: 1,
      failed: 0,
      errors: [],
      syncedIncidents: [
        {
          localId: 'a',
          serverId: 42,
          operation: 'submit',
          category: 'STRUCTURAL',
          location: '14.50000, 121.00000',
          result: 'Report received',
        },
      ],
    });
    notificationMocks.permission = 'granted';
    MockNotification.setPermission('granted');

    const { result } = renderHook(() => usePublicAutoSync());

    await act(async () => {
      await result.current.syncNow();
    });

    expect(notificationMocks.notificationInstances.length).toBeGreaterThan(0);
    const n = notificationMocks.notificationInstances[0];
    expect(n.title).toMatch(/report|fire|received/i);
  });
});

// ── syncNow bypasses backoff ────────────────────────────────────

describe('usePublicAutoSync — syncNow', () => {
  it('calls syncPublicOfflineOps with bypassBackoff=true', async () => {
    syncMocks.syncPublicOfflineOps.mockResolvedValue(OK_RESULT);
    const { result } = renderHook(() => usePublicAutoSync());

    await act(async () => {
      await result.current.syncNow();
    });

    expect(syncMocks.syncPublicOfflineOps).toHaveBeenCalledTimes(1);
    expect(syncMocks.syncPublicOfflineOps).toHaveBeenCalledWith(DEVICE_ID, { bypassBackoff: true });
  });
});

// ── Return shape ───────────────────────────────────────────────

describe('usePublicAutoSync — return shape', () => {
  it('exposes { syncing, lastSyncedAt, pendingCount, syncNow }', async () => {
    const { result } = renderHook(() => usePublicAutoSync());

    // Let the initial render settle so the returned object is stable.
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current.syncing).toBe(false);
    expect(result.current.lastSyncedAt).toBeNull();
    expect(typeof result.current.pendingCount).toBe('number');
    expect(typeof result.current.syncNow).toBe('function');
  });
});
