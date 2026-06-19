/**
 * useAutoSync tests — auto-sync on reconnect (FR-3C).
 *
 * Expected behavior:
 * - When network reconnects (isReconnecting=true), triggers syncPendingIncidents
 * - Debounces: waits 2s after reconnect before syncing
 * - Exposes { syncing, lastSyncedAt, pendingCount, conflictCount, syncNow }
 * - syncNow() triggers immediate sync (bypasses debounce)
 * - Does not sync while already syncing (mutex)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { SyncResult } from '../syncEngine';

// Mock syncEngine
vi.mock('../syncEngine', () => ({
  syncPendingIncidents: vi.fn(),
}));

// Mock offlineStore (new ops API)
vi.mock('../offlineStore', () => ({
  getPendingOpsCount: vi.fn(),
  recoverStaleSyncingOps: vi.fn().mockResolvedValue(0),
}));

// Mock auth
vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// Mock useNetworkStatus
const mockNetworkStatus = { isOnline: true, isReconnecting: false };
vi.mock('../useNetworkStatus', () => ({
  useNetworkStatus: () => mockNetworkStatus,
}));

import { useAutoSync } from '../useAutoSync';
import { syncPendingIncidents } from '../syncEngine';
import { getPendingOpsCount, recoverStaleSyncingOps } from '../offlineStore';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

const ENCODER_ID = 'test-encoder-uuid';
const OK_RESULT: SyncResult = { synced: 0, conflicts: 0, failed: 0, errors: [], syncedIncidents: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mockNetworkStatus.isOnline = true;
  mockNetworkStatus.isReconnecting = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAuth).mockReturnValue({ user: { id: ENCODER_ID } as any, loading: false } as any);
  vi.mocked(getPendingOpsCount).mockResolvedValue(0);
  vi.mocked(recoverStaleSyncingOps).mockResolvedValue(0);
  vi.mocked(syncPendingIncidents).mockResolvedValue(OK_RESULT);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.warning).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAutoSync', () => {
  it('exposes initial state: not syncing, no lastSyncedAt, pendingCount=0', async () => {
    const { result } = renderHook(() => useAutoSync());

    await waitFor(() => {
      expect(result.current.syncing).toBe(false);
    });
    expect(result.current.lastSyncedAt).toBeNull();
    expect(result.current.pendingCount).toBe(0);
  });

  it('fetches pendingCount on mount via getPendingOpsCount', async () => {
    vi.mocked(getPendingOpsCount).mockResolvedValue(3);

    const { result } = renderHook(() => useAutoSync());

    await waitFor(() => {
      expect(result.current.pendingCount).toBe(3);
    });
    expect(getPendingOpsCount).toHaveBeenCalledWith(ENCODER_ID);
  });

  it('auto-syncs after debounce when network reconnects', async () => {
    vi.useFakeTimers();
    mockNetworkStatus.isOnline = false;
    mockNetworkStatus.isReconnecting = false;

    const { rerender } = renderHook(() => useAutoSync());

    // Simulate reconnect
    mockNetworkStatus.isOnline = true;
    mockNetworkStatus.isReconnecting = true;
    rerender();

    // Sync should not fire immediately
    expect(syncPendingIncidents).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(syncPendingIncidents).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('syncNow() triggers immediate sync without waiting for debounce', async () => {
    vi.mocked(syncPendingIncidents).mockResolvedValue({
      synced: 3, conflicts: 0, failed: 0, errors: [],
    });

    const { result } = renderHook(() => useAutoSync());

    await act(async () => {
      await result.current.syncNow();
    });

    expect(syncPendingIncidents).toHaveBeenCalledTimes(1);
    expect(syncPendingIncidents).toHaveBeenCalledWith(ENCODER_ID);
    expect(result.current.lastSyncedAt).toBeInstanceOf(Date);
  });

  it('syncNow() updates pendingCount after sync', async () => {
    vi.mocked(syncPendingIncidents).mockResolvedValue({
      synced: 2, conflicts: 0, failed: 0, errors: [],
    });
    vi.mocked(getPendingOpsCount).mockResolvedValueOnce(2).mockResolvedValue(0);

    const { result } = renderHook(() => useAutoSync());

    await act(async () => {});

    await act(async () => {
      await result.current.syncNow();
    });

    expect(result.current.pendingCount).toBe(0);
  });

  it('does not sync while already syncing (mutex)', async () => {
    let resolveSync!: (value: SyncResult) => void;
    vi.mocked(syncPendingIncidents).mockImplementation(
      () => new Promise((resolve) => { resolveSync = resolve; })
    );

    const { result } = renderHook(() => useAutoSync());

    // Start first sync
    act(() => {
      result.current.syncNow();
    });

    expect(result.current.syncing).toBe(true);

    // Try second sync while first is in-flight
    await act(async () => {
      await result.current.syncNow();
    });

    // syncPendingIncidents should only be called once (mutex)
    expect(syncPendingIncidents).toHaveBeenCalledTimes(1);

    // Resolve first sync
    await act(async () => {
      resolveSync({ synced: 1, conflicts: 0, failed: 0, errors: [] });
    });
  });

  it('does not sync after component unmount', async () => {
    vi.useFakeTimers();
    mockNetworkStatus.isReconnecting = true;
    const { unmount } = renderHook(() => useAutoSync());

    // Unmount before debounce fires
    unmount();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // Should not have synced after unmount
    expect(syncPendingIncidents).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('fires toast.success when sync succeeds with no failures', async () => {
    vi.mocked(syncPendingIncidents).mockResolvedValue({
      synced: 2, conflicts: 0, failed: 0, errors: [],
    });

    const { result } = renderHook(() => useAutoSync());

    await act(async () => {
      await result.current.syncNow();
    });

    expect(toast.success).toHaveBeenCalledWith('Synced 2 incidents');
  });

  it('fires toast.error when sync fails with no successes', async () => {
    vi.mocked(syncPendingIncidents).mockResolvedValue({
      synced: 0, conflicts: 0, failed: 1, errors: [{ localId: 'op-1', operation: 'create', error: 'Network error' }],
    });

    const { result } = renderHook(() => useAutoSync());

    await act(async () => {
      await result.current.syncNow();
    });

    expect(toast.error).toHaveBeenCalledWith('1 item failed to sync');
  });

  it('fires no toast when nothing to sync', async () => {
    vi.mocked(syncPendingIncidents).mockResolvedValue({
      synced: 0, conflicts: 0, failed: 0, errors: [], syncedIncidents: [],
    });

    const { result } = renderHook(() => useAutoSync());

    await act(async () => {
      await result.current.syncNow();
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('fires toast.warning when sync has mixed success and failure', async () => {
    vi.mocked(syncPendingIncidents).mockResolvedValue({
      synced: 1, conflicts: 0, failed: 1, errors: [{ localId: 'op-2', operation: 'create', error: 'Network error' }],
    });

    const { result } = renderHook(() => useAutoSync());

    await act(async () => {
      await result.current.syncNow();
    });

    expect(toast.warning).toHaveBeenCalledWith('Synced 1, 1 failed — will retry');
  });
});
