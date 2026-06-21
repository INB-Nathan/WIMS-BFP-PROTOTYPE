/**
 * Tests for GH #273 / Task 4: Reference offline-aware wrappers.
 *
 * Covers the 3 unencrypted reference wrappers:
 *   fetchRegionsOfflineAware, fetchProvincesOfflineAware, fetchCitiesOfflineAware
 *
 * Reference data is plaintext and userId-namespaced in the unencrypted
 * REFERENCE_STORE (pushback P1 from plan). The wrappers must:
 *   - use the `reference` prefix + userId in cache keys (per-user isolation)
 *   - write/read via cacheReferenceData / getCachedReferenceData (unencrypted)
 *   - apply a 7-day TTL
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks (mirrors offlineAdmin.test.ts pattern, but unencrypted store)
// ---------------------------------------------------------------------------
const refMocks = vi.hoisted(() => ({
  fetchRegions: vi.fn(),
  fetchProvinces: vi.fn(),
  fetchCities: vi.fn(),
  getCachedReferenceData: vi.fn(),
  cacheReferenceData: vi.fn(),
  markConnectivityOffline: vi.fn(),
  isReachable: vi.fn(),
  connectivitySnapshot: {
    state: 'offline' as const,
    isOnline: false,
    isChecking: false,
    isReconnecting: false,
    lastCheckedAt: null as number | null,
  },
}));

vi.mock('../legacy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../legacy')>();
  return {
    ...actual,
    fetchRegions: refMocks.fetchRegions,
    fetchProvinces: refMocks.fetchProvinces,
    fetchCities: refMocks.fetchCities,
  };
});

vi.mock('../../offlineStore', () => ({
  getCachedReferenceData: refMocks.getCachedReferenceData,
  cacheReferenceData: refMocks.cacheReferenceData,
}));

vi.mock('../../connectivity', () => ({
  getConnectivitySnapshot: () => refMocks.connectivitySnapshot,
  isReachable: refMocks.isReachable,
  markConnectivityOffline: refMocks.markConnectivityOffline,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function goOnline() {
  refMocks.connectivitySnapshot.state = 'online';
  refMocks.connectivitySnapshot.isOnline = true;
}

function goOffline() {
  refMocks.connectivitySnapshot.state = 'offline';
  refMocks.connectivitySnapshot.isOnline = false;
}

const REF_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const mockRegions = [
  { region_id: 1, region_name: 'NCR', region_code: 'NCR' },
  { region_id: 2, region_name: 'Region I', region_code: 'R1' },
];
const mockProvinces = [
  { province_id: 10, province_name: 'Metro Manila', region_id: 1 },
];
const mockCities = [
  { city_id: 100, city_name: 'Manila', province_id: 10 },
];

// ---------------------------------------------------------------------------
// Table-driven matrix over the 3 wrappers × 5 cases (15 tests)
// ---------------------------------------------------------------------------
const cases: Array<
  [
    name: string,
    userId: string,
    callArgs: () => [userId: string, id: string | number],
    legacyName: keyof typeof refMocks,
    legacyResp: unknown,
    cacheKeySubstr: string,
  ]
> = [
  [
    'regions',
    'userA',
    () => ['userA', 0],
    'fetchRegions',
    mockRegions,
    'reference:userA:regions:',
  ],
  [
    'provinces',
    'userA',
    () => ['userA', 1],
    'fetchProvinces',
    mockProvinces,
    'reference:userA:provinces:',
  ],
  [
    'cities',
    'userA',
    () => ['userA', 1],
    'fetchCities',
    mockCities,
    'reference:userA:cities:',
  ],
];

describe.each(cases)(
  '%s wrapper — online fresh',
  (_name, _userId, callArgs, legacyName, legacyResp, cacheKeySubstr) => {
    beforeEach(() => {
      vi.clearAllMocks();
      goOnline();
    });

    it('returns { response, fromCache: false } and writes unencrypted cache with userId-namespaced key', async () => {
      (refMocks[legacyName] as ReturnType<typeof vi.fn>).mockResolvedValue(legacyResp);
      refMocks.cacheReferenceData.mockResolvedValue(undefined);

      const mod = await import('../offlineReference');
      const fnName = `fetch${_name.charAt(0).toUpperCase() + _name.slice(1)}OfflineAware` as
        | 'fetchRegionsOfflineAware'
        | 'fetchProvincesOfflineAware'
        | 'fetchCitiesOfflineAware';
      const [userId, id] = callArgs();
      const result = await (mod[fnName] as (u: string, i: string | number) => Promise<{
        response: unknown;
        fromCache: boolean;
      }>)(userId, id);

      expect(result).toEqual({ response: legacyResp, fromCache: false });
      expect(refMocks[legacyName]).toHaveBeenCalledTimes(1);
      expect(refMocks.cacheReferenceData).toHaveBeenCalledTimes(1);
      // cacheReferenceData(key, data, ttlMs, cachedAt) — 4 args
      expect(refMocks.cacheReferenceData).toHaveBeenCalledWith(
        expect.stringContaining(cacheKeySubstr),
        legacyResp,
        REF_TTL_MS,
        expect.any(Number),
      );
    });
  },
);

describe.each(cases)(
  '%s wrapper — offline, fresh cache',
  (_name, _userId, callArgs, legacyName, legacyResp, cacheKeySubstr) => {
    beforeEach(() => {
      vi.clearAllMocks();
      goOffline();
    });

    it('serves { response, fromCache: true, cachedAt } from the unencrypted store', async () => {
      const cachedAt = Date.now() - 60_000; // 1 minute old
      refMocks.getCachedReferenceData.mockImplementation(async (key: string) => {
        if (key.includes(cacheKeySubstr)) {
          return { key, data: legacyResp, cachedAt, ttlMs: REF_TTL_MS };
        }
        return undefined;
      });

      const mod = await import('../offlineReference');
      const fnName = `fetch${_name.charAt(0).toUpperCase() + _name.slice(1)}OfflineAware` as
        | 'fetchRegionsOfflineAware'
        | 'fetchProvincesOfflineAware'
        | 'fetchCitiesOfflineAware';
      const [userId, id] = callArgs();
      const result = await (mod[fnName] as (u: string, i: string | number) => Promise<{
        response: unknown;
        fromCache: boolean;
        cachedAt: number;
      }>)(userId, id);

      expect(result).toEqual({ response: legacyResp, fromCache: true, cachedAt });
      expect(refMocks[legacyName] as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
      expect(refMocks.getCachedReferenceData).toHaveBeenCalledWith(
        expect.stringContaining(cacheKeySubstr),
      );
    });
  },
);

describe.each(cases)(
  '%s wrapper — offline, no cache',
  (_name, _userId, callArgs, legacyName) => {
    beforeEach(() => {
      vi.clearAllMocks();
      goOffline();
    });

    it('throws the reference offline error when offline and no cache exists', async () => {
      refMocks.getCachedReferenceData.mockResolvedValue(undefined);

      const mod = await import('../offlineReference');
      const fnName = `fetch${_name.charAt(0).toUpperCase() + _name.slice(1)}OfflineAware` as
        | 'fetchRegionsOfflineAware'
        | 'fetchProvincesOfflineAware'
        | 'fetchCitiesOfflineAware';
      const [userId, id] = callArgs();

      await expect(
        (mod[fnName] as (u: string, i: string | number) => Promise<unknown>)(userId, id),
      ).rejects.toThrow('Reference data is unavailable offline. Reconnect to refresh.');

      expect(refMocks[legacyName] as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });
  },
);

describe.each(cases)(
  '%s wrapper — online network error, cache fallback',
  (_name, _userId, callArgs, legacyName, legacyResp, cacheKeySubstr) => {
    beforeEach(() => {
      vi.clearAllMocks();
      goOnline();
    });

    it('falls back to fresh cache and marks connectivity offline on network error', async () => {
      (refMocks[legacyName] as ReturnType<typeof vi.fn>).mockRejectedValue(
        new TypeError('Failed to fetch'),
      );
      const cachedAt = Date.now() - 30_000;
      refMocks.getCachedReferenceData.mockImplementation(async (key: string) => {
        if (key.includes(cacheKeySubstr)) {
          return { key, data: legacyResp, cachedAt, ttlMs: REF_TTL_MS };
        }
        return undefined;
      });

      const mod = await import('../offlineReference');
      const fnName = `fetch${_name.charAt(0).toUpperCase() + _name.slice(1)}OfflineAware` as
        | 'fetchRegionsOfflineAware'
        | 'fetchProvincesOfflineAware'
        | 'fetchCitiesOfflineAware';
      const [userId, id] = callArgs();
      const result = await (mod[fnName] as (u: string, i: string | number) => Promise<{
        response: unknown;
        fromCache: boolean;
        cachedAt: number;
      }>)(userId, id);

      expect(result).toEqual({ response: legacyResp, fromCache: true, cachedAt });
      expect(refMocks[legacyName]).toHaveBeenCalledTimes(1);
      expect(refMocks.markConnectivityOffline).toHaveBeenCalled();
    });
  },
);

describe.each(cases)(
  '%s wrapper — online, stale cache beyond 7d TTL',
  (_name, _userId, callArgs, legacyName, legacyResp, cacheKeySubstr) => {
    beforeEach(() => {
      vi.clearAllMocks();
      goOnline();
    });

    it('re-fetches online when cached entry is older than 7d TTL', async () => {
      // Cached but 8 days old — beyond 7d TTL
      const cachedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
      refMocks.getCachedReferenceData.mockImplementation(async (key: string) => {
        if (key.includes(cacheKeySubstr)) {
          return { key, data: legacyResp, cachedAt, ttlMs: REF_TTL_MS };
        }
        return undefined;
      });
      (refMocks[legacyName] as ReturnType<typeof vi.fn>).mockResolvedValue(legacyResp);
      refMocks.cacheReferenceData.mockResolvedValue(undefined);

      const mod = await import('../offlineReference');
      const fnName = `fetch${_name.charAt(0).toUpperCase() + _name.slice(1)}OfflineAware` as
        | 'fetchRegionsOfflineAware'
        | 'fetchProvincesOfflineAware'
        | 'fetchCitiesOfflineAware';
      const [userId, id] = callArgs();
      const result = await (mod[fnName] as (u: string, i: string | number) => Promise<{
        response: unknown;
        fromCache: boolean;
      }>)(userId, id);

      expect(result.fromCache).toBe(false);
      expect(refMocks[legacyName]).toHaveBeenCalledTimes(1);
      expect(refMocks.cacheReferenceData).toHaveBeenCalledTimes(1);
    });
  },
);

// ---------------------------------------------------------------------------
// Isolation: userA's cache must NOT be served to userB (pushback P1)
// ---------------------------------------------------------------------------
describe('reference wrapper — per-user isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    goOffline();
  });

  it('userA cached regions is not returned when fetching as userB offline', async () => {
    // Pre-populate the mock so that ONLY keys containing userA would resolve.
    const userACachedAt = Date.now() - 5_000;
    refMocks.getCachedReferenceData.mockImplementation(async (key: string) => {
      if (key.includes('reference:userA:')) {
        return { key, data: mockRegions, cachedAt: userACachedAt, ttlMs: REF_TTL_MS };
      }
      return undefined; // userB's key is missing
    });

    const mod = await import('../offlineReference');

    // userA → returns cached data
    const resultA = await mod.fetchRegionsOfflineAware('userA');
    expect(resultA).toEqual({ response: mockRegions, fromCache: true, cachedAt: userACachedAt });

    // userB → must NOT see userA's data → throws
    await expect(mod.fetchRegionsOfflineAware('userB')).rejects.toThrow(
      'Reference data is unavailable offline. Reconnect to refresh.',
    );
  });
});
