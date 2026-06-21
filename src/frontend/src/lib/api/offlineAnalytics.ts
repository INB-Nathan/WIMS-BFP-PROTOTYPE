import {
  fetchAnalyticsFilterOptions as legacyFetchAnalyticsFilterOptions,
  fetchAnalystIncidentDetail as legacyFetchAnalystIncidentDetail,
  fetchAnalystIncidentSensitive as legacyFetchAnalystIncidentSensitive,
  fetchAnalystIncidentWildlandDetail as legacyFetchAnalystIncidentWildlandDetail,
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
  AnalystIncidentWildlandDetailResponse,
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
  OfflineResult,
  offlineAware,
} from './offlineBase';

const ANALYTICS_CACHE_TTL_MS = 30 * 60 * 1000;
const OFFLINE_ANALYTICS_ERROR = 'Analytics data is unavailable offline. Reconnect to refresh this view.';

// Re-export the shared result type under the domain-specific name
// so existing consumers (analytics.ts, components) are unaffected.
export type OfflineAnalyticsResult<T> = OfflineResult<T>;

export async function fetchHeatmapDataOfflineAware(
  filters: HeatmapFilters = {},
): Promise<OfflineAnalyticsResult<HeatmapGeoJSON>> {
  return offlineAware('heatmap', [filters], 'analytics', ANALYTICS_CACHE_TTL_MS, () => legacyFetchHeatmapData(filters), OFFLINE_ANALYTICS_ERROR);
}

export async function fetchTrendDataOfflineAware(
  filters: TrendFilters = {},
): Promise<OfflineAnalyticsResult<TrendsResponse>> {
  return offlineAware('trends', [filters], 'analytics', ANALYTICS_CACHE_TTL_MS, () => legacyFetchTrendData(filters), OFFLINE_ANALYTICS_ERROR);
}

export async function fetchComparativeDataOfflineAware(
  filters: ComparativeFilters,
): Promise<OfflineAnalyticsResult<ComparativeResponse>> {
  return offlineAware('comparative', [filters], 'analytics', ANALYTICS_CACHE_TTL_MS, () => legacyFetchComparativeData(filters), OFFLINE_ANALYTICS_ERROR);
}

export async function fetchTypeDistributionOfflineAware(
  filters: AnalyticsGlobalFilters = {},
): Promise<OfflineAnalyticsResult<TypeDistributionItem[]>> {
  return offlineAware('type-distribution', [filters], 'analytics', ANALYTICS_CACHE_TTL_MS, () => legacyFetchTypeDistribution(filters), OFFLINE_ANALYTICS_ERROR);
}

export async function fetchResponseTimeByRegionOfflineAware(
  filters: AnalyticsGlobalFilters = {},
): Promise<OfflineAnalyticsResult<ResponseTimeRegionItem[]>> {
  return offlineAware('response-time-by-region', [filters], 'analytics', ANALYTICS_CACHE_TTL_MS, () => legacyFetchResponseTimeByRegion(filters), OFFLINE_ANALYTICS_ERROR);
}

export async function fetchTopNOfflineAware(
  filters: AnalyticsGlobalFilters & { metric: string; dimension: string; limit?: number },
): Promise<OfflineAnalyticsResult<TopNItem[]>> {
  return offlineAware('top-n', [filters], 'analytics', ANALYTICS_CACHE_TTL_MS, () => legacyFetchTopN(filters), OFFLINE_ANALYTICS_ERROR);
}

export async function fetchAnalyticsFilterOptionsOfflineAware(
  field: AnalyticsFilterOptionsField,
  filters: Pick<AnalyticsGlobalFilters, 'region_id' | 'province' | 'start_date' | 'end_date'> = {},
): Promise<OfflineAnalyticsResult<string[]>> {
  return offlineAware('filter-options', [field, filters], 'analytics', ANALYTICS_CACHE_TTL_MS, () => legacyFetchAnalyticsFilterOptions(field, filters), OFFLINE_ANALYTICS_ERROR);
}

export const fetchFilterOptionsOfflineAware = fetchAnalyticsFilterOptionsOfflineAware;

export async function fetchAnalystIncidentDetailOfflineAware(
  incidentId: number,
): Promise<OfflineAnalyticsResult<AnalystIncidentDetailResponse>> {
  return offlineAware('analyst-detail', [incidentId], 'analytics', ANALYTICS_CACHE_TTL_MS, () => legacyFetchAnalystIncidentDetail(incidentId), OFFLINE_ANALYTICS_ERROR);
}

export async function fetchAnalystIncidentSensitiveOfflineAware(
  incidentId: number,
): Promise<OfflineAnalyticsResult<AnalystIncidentSensitiveResponse>> {
  return offlineAware('analyst-sensitive', [incidentId], 'analytics', ANALYTICS_CACHE_TTL_MS, () => legacyFetchAnalystIncidentSensitive(incidentId), OFFLINE_ANALYTICS_ERROR);
}

export async function fetchAnalystIncidentWildlandDetailOfflineAware(
  incidentId: number,
): Promise<OfflineAnalyticsResult<AnalystIncidentWildlandDetailResponse>> {
  return offlineAware('analyst-wildland-detail', [incidentId], 'analytics', ANALYTICS_CACHE_TTL_MS, () => legacyFetchAnalystIncidentWildlandDetail(incidentId), OFFLINE_ANALYTICS_ERROR);
}
