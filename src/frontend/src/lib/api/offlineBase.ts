/**
 * Shared offline API helpers — extracted from offlineAdmin.ts, offlineAnalytics.ts,
 * and offlineValidator.ts to reduce copy-paste (GH #273).
 *
 * Provides:
 *   - OfflineResult<T> — shared cache-backed result type
 *   - Utility helpers: isNetworkError, stableStringify, isNavigatorOffline,
 *     shouldServeOffline, isFresh
 *   - Cache key builder: buildCacheKey
 *   - Cache operations: getFreshCache, readFreshCacheOrThrow, writeCache
 *   - Core orchestrator: offlineAware
 *
 * All three domain modules import from here instead of duplicating the logic.
 */
import {
  cacheReadResponse,
  cacheReferenceData,
  getCachedReferenceData,
  getReadCachedResponse,
  incrementCacheWriteCount,
} from '../offlineStore';
import {
  getConnectivitySnapshot,
  markConnectivityOffline,
} from '../connectivity';

// ── Shared result type ─────────────────────────────────────────────

export interface OfflineResult<T> {
  response: T;
  fromCache: boolean;
  cachedAt?: number;
}

// ── Network / connectivity helpers ─────────────────────────────────

export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof Error) {
    const msg = err.message;
    return (
      /ERR_/i.test(msg) ||
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('net::ERR')
    );
  }
  return false;
}

/**
 * Deterministic stable serialisation for cache keys.
 * Filters out undefined / empty values and sorts keys so
 * {a:1,b:2} and {b:2,a:1} produce the same string.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined && record[key] !== '')
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

export function isNavigatorOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function shouldServeOffline(): boolean {
  const snapshot = getConnectivitySnapshot();
  return snapshot.state === 'offline' || isNavigatorOffline();
}

export function isFresh(cachedAt: number, ttlMs: number): boolean {
  return Date.now() - cachedAt <= ttlMs;
}

// ── Cache key builder ──────────────────────────────────────────────

/**
 * Build a prefixed, deterministic cache key for a given domain.
 *
 * @param prefix  Domain prefix (e.g. 'admin', 'analytics')
 * @param cacheKey Logical operation name (e.g. 'system-health')
 * @param args    Arguments that distinguish different queries
 */
export function buildCacheKey(prefix: string, cacheKey: string, args: unknown[]): string {
  return `${prefix}:${cacheKey}:${encodeURIComponent(stableStringify(args))}`;
}

// ── Cache read helpers ─────────────────────────────────────────────

/**
 * Return a fresh cached result, or null when the cache is missing / stale.
 */
export async function getFreshCache<T>(
  key: string,
  ttlMs: number,
): Promise<OfflineResult<T> | null> {
  const cached = await getReadCachedResponse<T>(key);
  if (!cached || !isFresh(cached.cachedAt, ttlMs)) return null;
  return {
    response: cached.data,
    fromCache: true,
    cachedAt: cached.cachedAt,
  };
}

/**
 * Return a fresh cached result or throw the given error message.
 */
export async function readFreshCacheOrThrow<T>(
  key: string,
  ttlMs: number,
  errorMessage: string,
): Promise<OfflineResult<T>> {
  const cached = await getFreshCache<T>(key, ttlMs);
  if (cached) return cached;
  throw new Error(errorMessage);
}

/**
 * Sibling of `readFreshCacheOrThrow` for the UNENCRYPTED reference store.
 * Returns a fresh cached result or throws the given error message.
 *
 * Reference data is plaintext and userId-namespaced (per pushback P1), so
 * callers must build the key with their userId baked in
 * (`buildCacheKey(\`${prefix}:${userId}\`, ...)`) before invoking this helper.
 */
export async function readFreshReferenceCacheOrThrow<T>(
  key: string,
  ttlMs: number,
  errorMessage: string,
): Promise<OfflineResult<T>> {
  const cached = await getCachedReferenceData<T>(key);
  if (!cached || !isFresh(cached.cachedAt, ttlMs)) {
    throw new Error(errorMessage);
  }
  return {
    response: cached.data,
    fromCache: true,
    cachedAt: cached.cachedAt,
  };
}

// ── Cache write helper ─────────────────────────────────────────────

/**
 * Best-effort cache write — failures are silently swallowed so a
 * successful online fetch is never broken by a failing IndexedDB write.
 *
 * Task 1: the per-record ttlMs is persisted alongside the encrypted payload
 * so eviction can prune by the record's own expiry (pushback P3).
 */
export async function writeCache<T>(key: string, response: T, ttlMs: number): Promise<void> {
  try {
    await cacheReadResponse<T>(key, response, ttlMs);
  } catch {
    // noop
  }
}

// ── Core offline-aware read fetcher ────────────────────────────────

/**
 * Cache backend pair (read + write). The unified orchestrator below takes
 * one of these as a parameter; the only difference between the encrypted
 * and reference code paths is which backend they use.
 *
 * Issue #8: collapses the two near-duplicate orchestrators (offlineAware,
 * offlineAwareReference) into a single implementation parameterised on the
 * backend.
 */
interface CacheBackend {
  readFresh<T>(key: string, ttlMs: number, errorMessage: string): Promise<OfflineResult<T>>;
  write<T>(key: string, data: T, ttlMs: number): Promise<void>;
}

const encryptedBackend: CacheBackend = {
  readFresh: readFreshCacheOrThrow,
  write: writeCache,
};

const referenceBackend: CacheBackend = {
  readFresh: readFreshReferenceCacheOrThrow,
  // writeCache-style wrapper: failures are silently swallowed so a
  // successful online fetch is never broken by a failing IndexedDB write.
  write: async (key, data, ttlMs) => {
    try {
      await cacheReferenceData(key, data, ttlMs, Date.now());
    } catch {
      // noop
    }
  },
};

/**
 * Unified offline-first read orchestrator. Issue #8: replaces the two
 * near-duplicate offlineAware / offlineAwareReference functions with a
 * single implementation that takes a cache backend.
 *
 * 1. When offline → serve from cache (throw if absent).
 * 2. When online → fetch, cache the result, return fresh.
 * 3. On network error → mark connectivity offline, fall back to cache.
 * 4. Non-network errors are re-thrown.
 * 5. The write counter advances ONLY on an actual online write (issue #6),
 *    so its semantics match its name.
 */
async function offlineAwareImpl<T>(
  backend: CacheBackend,
  cacheKey: string,
  args: unknown[],
  prefix: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  errorMessage: string,
): Promise<OfflineResult<T>> {
  const key = buildCacheKey(prefix, cacheKey, args);

  if (shouldServeOffline()) {
    return backend.readFresh<T>(key, ttlMs, errorMessage);
  }

  try {
    const response = await fetcher();
    await backend.write(key, response, ttlMs);
    // Issue #6: increment the write counter on actual writes only.
    // The `finally`-block pattern in the previous implementation counted
    // reads (offline hits + network-error fallbacks), which inflated the
    // counter and triggered evictions on read-heavy workloads. Move the
    // increment here so its semantics match the name.
    try {
      await incrementCacheWriteCount();
    } catch (writeCountErr) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[offlineBase] incrementCacheWriteCount failed:', writeCountErr);
      }
    }
    return { response, fromCache: false };
  } catch (err) {
    if (isNetworkError(err)) {
      markConnectivityOffline();
      return backend.readFresh<T>(key, ttlMs, errorMessage);
    }
    throw err;
  }
}

/**
 * Generic offline-first wrapper for read-oriented API calls.
 *
 * Uses the encrypted READ_CACHE_STORE backend (per-user key encryption).
 * See `offlineAwareReference` for the plaintext reference data variant.
 */
export function offlineAware<T>(
  cacheKey: string,
  args: unknown[],
  prefix: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  errorMessage: string,
): Promise<OfflineResult<T>> {
  return offlineAwareImpl<T>(
    encryptedBackend,
    cacheKey,
    args,
    prefix,
    ttlMs,
    fetcher,
    errorMessage,
  );
}

/**
 * Offline-first wrapper for **unencrypted reference data** reads.
 *
 * Uses the plaintext REFERENCE_STORE backend. `userId` is REQUIRED and
 * baked into the cache key prefix so that per-user isolation is preserved
 * in the unencrypted store (pushback P1).
 */
export function offlineAwareReference<T>(
  cacheKey: string,
  args: unknown[],
  prefix: string,
  ttlMs: number,
  userId: string,
  fetcher: () => Promise<T>,
  errorMessage: string,
): Promise<OfflineResult<T>> {
  return offlineAwareImpl<T>(
    referenceBackend,
    cacheKey,
    args,
    `${prefix}:${userId}`,
    ttlMs,
    fetcher,
    errorMessage,
  );
}
