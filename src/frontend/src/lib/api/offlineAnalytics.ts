import {
  fetchAnalyticsFilterOptions as legacyFetchAnalyticsFilterOptions,
  fetchAnalystIncidentDetail as legacyFetchAnalystIncidentDetail,
  fetchAnalystIncidentSensitive as legacyFetchAnalystIncidentSensitive,
  fetchComparativeData as legacyFetchComparativeData,
  fetchHeatmapData as legacyFetchHeatmapData,
  fetchResponseTimeByRegion as legacyFetchResponseTimeByRegion,
  fetchTopN as legacyFetchTopN,
  fetchTrendData as legacyFetchTrendData,
  fetchTypeDistribution as legacyFetchTypeDistribution,
} from './legacy';
import type {
  AnalystIncidentDetailResponse,
  AnalystIncidentSensitiveResponse,
  AnalyticsFilterOptionsField,
  AnalyticsGlobalFilters,
  ComparativeFilters,
  ComparativeResponse,
  HeatmapFilters,
  HeatmapGeoJSON,
  ResponseTimeRegionItem,
  TopNItem,
  TrendFilters,
  TrendsResponse,
  TypeDistributionItem,
} from './legacy';
import {
  cacheAnalyticsResponse,
  getCachedAnalyticsResponse,
} from '../offlineStore';
import {
  getConnectivitySnapshot,
  markConnectivityOffline,
} from '../connectivity';

const ANALYTICS_CACHE_TTL_MS = 30 * 60 * 1000;
const OFFLINE_ANALYTICS_ERROR = 'Analytics data is unavailable offline. Reconnect to refresh this view.';

export interface OfflineAnalyticsResult<T> {
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

function analyticsKey(cacheKey: string, args: unknown[]): string {
  return `analytics:${cacheKey}:${encodeURIComponent(stableStringify(args))}`;
}

function isNavigatorOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function shouldServeOffline(): boolean {
  const snapshot = getConnectivitySnapshot();
  return snapshot.state === 'offline' || isNavigatorOffline();
}

function isFresh(cachedAt: number): boolean {
  return Date.now() - cachedAt <= ANALYTICS_CACHE_TTL_MS;
}

async function getFreshCache<T>(key: string): Promise<OfflineAnalyticsResult<T> | null> {
  const cached = await getCachedAnalyticsResponse<T>(key);
  if (!cached || !isFresh(cached.cachedAt)) return null;
  return {
    response: cached.data,
    fromCache: true,
    cachedAt: cached.cachedAt,
  };
}

async function readFreshCacheOrThrow<T>(key: string): Promise<OfflineAnalyticsResult<T>> {
  const cached = await getFreshCache<T>(key);
  if (cached) return cached;
  throw new Error(OFFLINE_ANALYTICS_ERROR);
}

async function writeCache<T>(key: string, response: T): Promise<void> {
  try {
    await cacheAnalyticsResponse<T>(key, response);
  } catch {
    // Cache writes must not break an otherwise successful online analyst read.
  }
}

async function offlineAware<T>(
  cacheKey: string,
  args: unknown[],
  fetcher: () => Promise<T>,
): Promise<OfflineAnalyticsResult<T>> {
  const key = analyticsKey(cacheKey, args);

  if (shouldServeOffline()) {
    return readFreshCacheOrThrow<T>(key);
  }

  try {
    const response = await fetcher();
    await writeCache(key, response);
    return { response, fromCache: false };
  } catch (err) {
    if (isNetworkError(err)) {
      markConnectivityOffline();
      return readFreshCacheOrThrow<T>(key);
    }
    throw err;
  }
}

export async function fetchHeatmapDataOfflineAware(
  filters: HeatmapFilters = {},
): Promise<OfflineAnalyticsResult<HeatmapGeoJSON>> {
  return offlineAware('heatmap', [filters], () => legacyFetchHeatmapData(filters));
}

export async function fetchTrendDataOfflineAware(
  filters: TrendFilters = {},
): Promise<OfflineAnalyticsResult<TrendsResponse>> {
  return offlineAware('trends', [filters], () => legacyFetchTrendData(filters));
}

export async function fetchComparativeDataOfflineAware(
  filters: ComparativeFilters,
): Promise<OfflineAnalyticsResult<ComparativeResponse>> {
  return offlineAware('comparative', [filters], () => legacyFetchComparativeData(filters));
}

export async function fetchTypeDistributionOfflineAware(
  filters: AnalyticsGlobalFilters = {},
): Promise<OfflineAnalyticsResult<TypeDistributionItem[]>> {
  return offlineAware('type-distribution', [filters], () => legacyFetchTypeDistribution(filters));
}

export async function fetchResponseTimeByRegionOfflineAware(
  filters: AnalyticsGlobalFilters = {},
): Promise<OfflineAnalyticsResult<ResponseTimeRegionItem[]>> {
  return offlineAware('response-time-by-region', [filters], () => legacyFetchResponseTimeByRegion(filters));
}

export async function fetchTopNOfflineAware(
  filters: AnalyticsGlobalFilters & { metric: string; dimension: string; limit?: number },
): Promise<OfflineAnalyticsResult<TopNItem[]>> {
  return offlineAware('top-n', [filters], () => legacyFetchTopN(filters));
}

export async function fetchAnalyticsFilterOptionsOfflineAware(
  field: AnalyticsFilterOptionsField,
  filters: Pick<AnalyticsGlobalFilters, 'region_id' | 'province' | 'start_date' | 'end_date'> = {},
): Promise<OfflineAnalyticsResult<string[]>> {
  return offlineAware('filter-options', [field, filters], () => legacyFetchAnalyticsFilterOptions(field, filters));
}

export const fetchFilterOptionsOfflineAware = fetchAnalyticsFilterOptionsOfflineAware;

export async function fetchAnalystIncidentDetailOfflineAware(
  incidentId: number,
): Promise<OfflineAnalyticsResult<AnalystIncidentDetailResponse>> {
  return offlineAware('analyst-detail', [incidentId], () => legacyFetchAnalystIncidentDetail(incidentId));
}

export async function fetchAnalystIncidentSensitiveOfflineAware(
  incidentId: number,
): Promise<OfflineAnalyticsResult<AnalystIncidentSensitiveResponse>> {
  return offlineAware('analyst-sensitive', [incidentId], () => legacyFetchAnalystIncidentSensitive(incidentId));
}
