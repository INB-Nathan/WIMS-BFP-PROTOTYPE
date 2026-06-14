import {
  fetchSystemHealth as legacyFetchSystemHealth,
  fetchSystemMetrics as legacyFetchSystemMetrics,
  fetchWorkerStatus as legacyFetchWorkerStatus,
  fetchActiveSessions as legacyFetchActiveSessions,
  fetchAuditLogs as legacyFetchAuditLogs,
} from './legacy';
import type {
  SystemHealthResponse,
  SystemMetricsResponse,
  WorkerStatusResponse,
} from './legacy';
import type { ActiveSession, AuditLogEntry, PaginatedResponse } from '@/types/api';
import {
  cacheAnalyticsResponse,
  getCachedAnalyticsResponse,
} from '../offlineStore';
import {
  getConnectivitySnapshot,
  markConnectivityOffline,
} from '../connectivity';

const ADMIN_CACHE_TTL_MS = 60_000;
const SESSIONS_CACHE_TTL_MS = 30_000;
const OFFLINE_ADMIN_ERROR = 'System health data is unavailable offline. Reconnect to refresh this view.';

export interface OfflineAdminResult<T> {
  response: T;
  fromCache: boolean;
  cachedAt?: number;
}

function isNetworkError(err: unknown): boolean {
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

function stableStringify(value: unknown): string {
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

function adminKey(cacheKey: string, args: unknown[]): string {
  return `admin:${cacheKey}:${encodeURIComponent(stableStringify(args))}`;
}

function isNavigatorOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function shouldServeOffline(): boolean {
  const snapshot = getConnectivitySnapshot();
  return snapshot.state === 'offline' || isNavigatorOffline();
}

function isFresh(cachedAt: number, ttlMs: number): boolean {
  return Date.now() - cachedAt <= ttlMs;
}

async function getFreshCache<T>(key: string, ttlMs: number): Promise<OfflineAdminResult<T> | null> {
  const cached = await getCachedAnalyticsResponse<T>(key);
  if (!cached || !isFresh(cached.cachedAt, ttlMs)) return null;
  return {
    response: cached.data,
    fromCache: true,
    cachedAt: cached.cachedAt,
  };
}

async function readFreshCacheOrThrow<T>(key: string, ttlMs: number): Promise<OfflineAdminResult<T>> {
  const cached = await getFreshCache<T>(key, ttlMs);
  if (cached) return cached;
  throw new Error(OFFLINE_ADMIN_ERROR);
}

async function writeCache<T>(key: string, response: T): Promise<void> {
  try {
    await cacheAnalyticsResponse<T>(key, response);
  } catch {
    // Cache writes must not break an otherwise successful online admin read.
  }
}

async function offlineAware<T>(
  cacheKey: string,
  args: unknown[],
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<OfflineAdminResult<T>> {
  const key = adminKey(cacheKey, args);

  if (shouldServeOffline()) {
    return readFreshCacheOrThrow<T>(key, ttlMs);
  }

  try {
    const response = await fetcher();
    await writeCache(key, response);
    return { response, fromCache: false };
  } catch (err) {
    if (isNetworkError(err)) {
      markConnectivityOffline();
      return readFreshCacheOrThrow<T>(key, ttlMs);
    }
    throw err;
  }
}

export async function fetchSystemHealthOfflineAware(): Promise<OfflineAdminResult<SystemHealthResponse>> {
  return offlineAware('system-health', [], ADMIN_CACHE_TTL_MS, () => legacyFetchSystemHealth());
}

export async function fetchSystemMetricsOfflineAware(): Promise<OfflineAdminResult<SystemMetricsResponse>> {
  return offlineAware('system-metrics', [], ADMIN_CACHE_TTL_MS, () => legacyFetchSystemMetrics());
}

export async function fetchWorkerStatusOfflineAware(): Promise<OfflineAdminResult<WorkerStatusResponse[]>> {
  return offlineAware('worker-status', [], ADMIN_CACHE_TTL_MS, () => legacyFetchWorkerStatus());
}

export async function fetchActiveSessionsOfflineAware(): Promise<OfflineAdminResult<ActiveSession[]>> {
  return offlineAware('active-sessions', [], SESSIONS_CACHE_TTL_MS, () => legacyFetchActiveSessions());
}

export async function fetchAuditLogsOfflineAware(
  params?: { limit?: number; offset?: number; q?: string },
): Promise<OfflineAdminResult<PaginatedResponse<AuditLogEntry>>> {
  return offlineAware('audit-logs', [params ?? {}], ADMIN_CACHE_TTL_MS, () => legacyFetchAuditLogs(params));
}
