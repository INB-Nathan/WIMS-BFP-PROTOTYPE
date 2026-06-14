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
  cacheAnalyticsResponse,
  getCachedAnalyticsResponse,
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
  const cached = await getCachedAnalyticsResponse<T>(key);
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

// ── Cache write helper ─────────────────────────────────────────────

/**
 * Best-effort cache write — failures are silently swallowed so a
 * successful online fetch is never broken by a failing IndexedDB write.
 */
export async function writeCache<T>(key: string, response: T): Promise<void> {
  try {
    await cacheAnalyticsResponse<T>(key, response);
  } catch {
    // noop
  }
}

// ── Core offline-aware read fetcher ────────────────────────────────

/**
 * Generic offline-first wrapper for read-oriented API calls.
 *
 * 1. When offline → serve from cache (throw if absent).
 * 2. When online → fetch, cache the result, return fresh.
 * 3. On network error → mark connectivity offline, fall back to cache.
 * 4. Non-network errors are re-thrown.
 *
 * @param cacheKey    Logical name (e.g. 'system-health')
 * @param args        Distinguishing arguments (used in cache key)
 * @param prefix      Domain prefix for the cache key
 * @param ttlMs       Cache TTL in milliseconds
 * @param fetcher     Async function that performs the network request
 * @param errorMessage Thrown when offline and no cache is available
 */
export async function offlineAware<T>(
  cacheKey: string,
  args: unknown[],
  prefix: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  errorMessage: string,
): Promise<OfflineResult<T>> {
  const key = buildCacheKey(prefix, cacheKey, args);

  if (shouldServeOffline()) {
    return readFreshCacheOrThrow<T>(key, ttlMs, errorMessage);
  }

  try {
    const response = await fetcher();
    await writeCache(key, response);
    return { response, fromCache: false };
  } catch (err) {
    if (isNetworkError(err)) {
      markConnectivityOffline();
      return readFreshCacheOrThrow<T>(key, ttlMs, errorMessage);
    }
    throw err;
  }
}
