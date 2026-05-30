/**
 * useAutoSync tests — auto-sync on reconnect (3C).
 *
 * Expected behavior:
 * - When network reconnects (isReconnecting=true), triggers syncPendingIncidents
 * - Debounces: waits 2s after reconnect before syncing
 * - Exposes { syncing, lastSyncedAt, pendingCount, syncNow }
 * - syncNow() triggers immediate sync (bypasses debounce)
 * - Does not sync while already syncing (mutex)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock syncEngine
vi.mock('../syncEngine', () => ({
  syncPendingIncidents: vi.fn(),
}));

// Mock offlineStore
vi.mock('../offlineStore', () => ({
  getPendingIncidents: vi.fn(),
}));

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

// Mock useNetworkStatus
const mockNetworkStatus = { isOnline: true, isReconnecting: false };
vi.mock('../useNetworkStatus', () => ({
  useNetworkStatus: () => mockNetworkStatus,
}));

import { useAutoSync } from '../useAutoSync';
import { syncPendingIncidents } from '../syncEngine';
import { getPendingIncidents } from '../offlineStore';
import { toast } from 'sonner';

beforeEach(() => {
  vi.clearAllMocks();
  mockNetworkStatus.isOnline = true;
  mockNetworkStatus.isReconnecting = false;
  vi.mocked(getPendingIncidents).mockResolvedValue([]);
  vi.mocked(syncPendingIncidents).mockResolvedValue({ synced: 0, failed: 0, errors: [] });
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

  it('fetches pendingCount on mount', async () => {
    vi.mocked(getPendingIncidents).mockResolvedValue([
      { id: 1, payload: {}, createdAt: Date.now(), status: 'pending' },
      { id: 2, payload: {}, createdAt: Date.now(), status: 'pending' },
    ]);

    const { result } = renderHook(() => useAutoSync());

    await waitFor(() => {
      expect(result.current.pendingCount).toBe(2);
    });
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

    // Should not have synced yet (debounce)
    expect(syncPendingIncidents).not.toHaveBeenCalled();

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(2000);
      // Flush microtasks
      await Promise.resolve();
    });

    expect(syncPendingIncidents).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('syncNow() triggers immediate sync without waiting for debounce', async () => {
    vi.mocked(syncPendingIncidents).mockResolvedValue({
      synced: 3, failed: 0, errors: [],
    });
    vi.mocked(getPendingIncidents).mockResolvedValue([]);

    const { result } = renderHook(() => useAutoSync());

    await act(async () => {
      await result.current.syncNow();
    });

    expect(syncPendingIncidents).toHaveBeenCalledTimes(1);
    expect(result.current.lastSyncedAt).toBeInstanceOf(Date);
  });

  it('syncNow() updates pendingCount after sync', async () => {
    vi.mocked(syncPendingIncidents).mockResolvedValue({
      synced: 2, failed: 0, errors: [],
    });
    // Initial: 2 pending. After sync: 0 pending.
    vi.mocked(getPendingIncidents).mockResolvedValue([
      { id: 1, payload: {}, createdAt: Date.now(), status: 'pending' },
      { id: 2, payload: {}, createdAt: Date.now(), status: 'pending' },
    ]);

    const { result } = renderHook(() => useAutoSync());

    // Wait for initial pendingCount
    await act(async () => {});

    // Now mock empty after sync
    vi.mocked(getPendingIncidents).mockResolvedValue([]);

    await act(async () => {
      await result.current.syncNow();
    });

    expect(result.current.pendingCount).toBe(0);
  });

  it('does not sync while already syncing (mutex)', async () => {
    let resolveSync!: (value: { synced: number; failed: number; errors: unknown[] }) => void;
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
      resolveSync({ synced: 1, failed: 0, errors: [] });
    });

    expect(result.current.syncing).toBe(false);
  });

  it('clears debounce timer on unmount', () => {
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
      synced: 2, failed: 0, errors: [],
    });
    vi.mocked(getPendingIncidents).mockResolvedValue([]);

    const { result } = renderHook(() => useAutoSync());

    await act(async () => {
      await result.current.syncNow();
    });

    expect(toast.success).toHaveBeenCalledWith('Synced 2 incidents');
  });

  it('fires toast.error when sync fails with no successes', async () => {
    vi.mocked(syncPendingIncidents).mockResolvedValue({
      synced: 0, failed: 1, errors: [{ id: 1, error: 'Network error' }],
    });
    vi.mocked(getPendingIncidents).mockResolvedValue([]);

    const { result } = renderHook(() => useAutoSync());

    await act(async () => {
      await result.current.syncNow();
    });

    expect(toast.error).toHaveBeenCalledWith('1 incident failed to sync');
  });

  it('fires no toast when nothing to sync', async () => {
    vi.mocked(syncPendingIncidents).mockResolvedValue({
      synced: 0, failed: 0, errors: [],
    });
    vi.mocked(getPendingIncidents).mockResolvedValue([]);

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
      synced: 1, failed: 1, errors: [{ id: 1, error: 'Network error' }],
    });
    vi.mocked(getPendingIncidents).mockResolvedValue([]);

    const { result } = renderHook(() => useAutoSync());

    await act(async () => {
      await result.current.syncNow();
    });

    expect(toast.warning).toHaveBeenCalledWith('Synced 1, 1 failed — will retry');
  });
});
