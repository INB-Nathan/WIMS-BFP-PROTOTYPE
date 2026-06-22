/**
 * Tests for Task 2 of the offline-cache-every-role plan: the
 * `offlineAwareReference` orchestrator (unencrypted, userId-namespaced).
 *
 * Mirrors the existing `offlineAware` control flow but uses
 * `cacheReferenceData`/`getCachedReferenceData` (REFERENCE_STORE,
 * unencrypted) and bakes `userId` into the cache key prefix for
 * per-user isolation in the plaintext store.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const refMocks = vi.hoisted(() => ({
  getCachedReferenceData: vi.fn(),
  cacheReferenceData: vi.fn(),
  fetcher: vi.fn(),
  markConnectivityOffline: vi.fn(),
  snapshot: {
    state: 'online' as 'online' | 'offline' | 'checking' | 'reconnecting',
    isOnline: true,
    isChecking: false,
    isReconnecting: false,
    lastCheckedAt: null as number | null,
  },
}));

vi.mock('../../offlineStore', () => ({
  getCachedReferenceData: refMocks.getCachedReferenceData,
  cacheReferenceData: refMocks.cacheReferenceData,
}));

vi.mock('../../connectivity', () => ({
  getConnectivitySnapshot: () => refMocks.snapshot,
  markConnectivityOffline: refMocks.markConnectivityOffline,
}));

import { offlineAwareReference } from '../offlineBase';

describe('offlineAwareReference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refMocks.snapshot.state = 'online';
  });

  it('online: fetches, caches with ttlMs + userId-namespaced key, returns fromCache:false', async () => {
    refMocks.fetcher.mockResolvedValue([{ region_id: 1 }]);
    const res = await offlineAwareReference(
      'regions',
      [],
      'reference',
      7 * 24 * 60 * 60 * 1000,
      'userA',
      refMocks.fetcher,
      'err',
    );
    expect(res).toEqual({ response: [{ region_id: 1 }], fromCache: false });
    expect(refMocks.cacheReferenceData).toHaveBeenCalledWith(
      'reference:userA:regions:%5B%5D',
      [{ region_id: 1 }],
      7 * 24 * 60 * 60 * 1000,
      expect.any(Number),
    );
    // Defensive: ensure userId is in the key exactly once and not in the payload
    const calledWith = refMocks.cacheReferenceData.mock.calls[0]!;
    const key = calledWith[0] as string;
    expect(key).toContain(':userA:');
    expect((calledWith[1] as unknown[]).toString()).not.toContain('userA');
  });

  it('offline + fresh cache: returns cached (fromCache:true)', async () => {
    refMocks.snapshot.state = 'offline';
    refMocks.getCachedReferenceData.mockResolvedValue({
      data: [{ region_id: 1 }],
      cachedAt: Date.now(),
      ttlMs: 7 * 24 * 60 * 60 * 1000,
    });
    const res = await offlineAwareReference(
      'regions',
      [],
      'reference',
      7 * 24 * 60 * 60 * 1000,
      'userA',
      refMocks.fetcher,
      'err',
    );
    expect(res.fromCache).toBe(true);
    expect(res.response).toEqual([{ region_id: 1 }]);
    // Must not fetch from network when offline
    expect(refMocks.fetcher).not.toHaveBeenCalled();
  });

  it('offline + miss: throws errorMessage', async () => {
    refMocks.snapshot.state = 'offline';
    refMocks.getCachedReferenceData.mockResolvedValue(undefined);
    await expect(
      offlineAwareReference(
        'regions',
        [],
        'reference',
        7 * 24 * 60 * 60 * 1000,
        'userA',
        refMocks.fetcher,
        'unavailable',
      ),
    ).rejects.toThrow('unavailable');
  });

  it('online + cache write throws: does not propagate the write error (issue #1)', async () => {
    refMocks.fetcher.mockResolvedValue([{ region_id: 1 }]);
    // Simulate an IndexedDB write failure (quota exceeded, schema mismatch, etc.)
    refMocks.cacheReferenceData.mockRejectedValue(new Error('IDB write failed: quota'));
    const res = await offlineAwareReference(
      'regions',
      [],
      'reference',
      7 * 24 * 60 * 60 * 1000,
      'userA',
      refMocks.fetcher,
      'err',
    );
    // Online fetch succeeded; the cache write failure must be swallowed so
    // the caller still receives the fresh response (mirrors writeCache's
    // try/catch for the encrypted read path).
    expect(res).toEqual({ response: [{ region_id: 1 }], fromCache: false });
  });

  it('network error: marks offline + falls back to fresh cache', async () => {
    refMocks.fetcher.mockRejectedValue(new TypeError('Failed to fetch'));
    refMocks.getCachedReferenceData.mockResolvedValue({
      data: [{ region_id: 1 }],
      cachedAt: Date.now(),
      ttlMs: 7 * 24 * 60 * 60 * 1000,
    });
    const res = await offlineAwareReference(
      'regions',
      [],
      'reference',
      7 * 24 * 60 * 60 * 1000,
      'userA',
      refMocks.fetcher,
      'err',
    );
    expect(refMocks.markConnectivityOffline).toHaveBeenCalled();
    expect(res.fromCache).toBe(true);
    expect(res.response).toEqual([{ region_id: 1 }]);
  });
});
