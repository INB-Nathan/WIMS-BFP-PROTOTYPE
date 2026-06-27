import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useOfflineWorkCounts } from '../useOfflineWorkCounts';
import { getDraftOps, getOfflineOpsCounts } from '../offlineStore';
import { useAuth } from '@/context/AuthContext';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../offlineStore', () => ({
  getOfflineOpsCounts: vi.fn(),
  getDraftOps: vi.fn(),
}));

const ENCODER_ID = 'encoder-123';

describe('useOfflineWorkCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ user: { id: ENCODER_ID }, loading: false } as never);
    vi.mocked(getOfflineOpsCounts).mockResolvedValue({
      pendingCount: 0,
      failedCount: 0,
      conflictCount: 0,
      totalActionableCount: 0,
    });
    vi.mocked(getDraftOps).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns zero counts and does not read IndexedDB when there is no user', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false } as never);

    const { result } = renderHook(() => useOfflineWorkCounts());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalActionableCount).toBe(0);
    expect(result.current.draftCount).toBe(0);
    expect(getOfflineOpsCounts).not.toHaveBeenCalled();
    expect(getDraftOps).not.toHaveBeenCalled();
  });

  it('aggregates pending, failed, conflict, and draft counts for the current encoder', async () => {
    vi.mocked(getOfflineOpsCounts).mockResolvedValue({
      pendingCount: 2,
      failedCount: 1,
      conflictCount: 3,
      totalActionableCount: 6,
    });
    vi.mocked(getDraftOps).mockResolvedValue([
      { localId: 'draft-1' },
      { localId: 'draft-2' },
    ] as never);

    const { result } = renderHook(() => useOfflineWorkCounts());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getOfflineOpsCounts).toHaveBeenCalledWith(ENCODER_ID);
    expect(getDraftOps).toHaveBeenCalledWith(ENCODER_ID);
    expect(result.current).toMatchObject({
      pendingCount: 2,
      failedCount: 1,
      conflictCount: 3,
      draftCount: 2,
      totalActionableCount: 6,
      loading: false,
    });
  });

  it('stops loading and preserves zero counts when IndexedDB reads fail', async () => {
    vi.mocked(getOfflineOpsCounts).mockRejectedValue(new Error('IndexedDB unavailable'));

    const { result } = renderHook(() => useOfflineWorkCounts());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalActionableCount).toBe(0);
    expect(result.current.draftCount).toBe(0);
  });
});
