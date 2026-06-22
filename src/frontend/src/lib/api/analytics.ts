export {
  fetchAnalyticsFilterOptionsOfflineAware,
  fetchAnalystIncidentDetailOfflineAware,
  fetchAnalystIncidentSensitiveOfflineAware,
  fetchAnalystIncidentWildlandDetailOfflineAware,
  fetchComparativeDataOfflineAware,
  fetchFilterOptionsOfflineAware,
  fetchHeatmapDataOfflineAware,
  fetchResponseTimeByRegionOfflineAware,
  fetchTopNOfflineAware,
  fetchTrendDataOfflineAware,
  fetchTypeDistributionOfflineAware,
} from './offlineAnalytics';

// Issue #7: OfflineAnalyticsResult identity alias deleted. Consumers use
// OfflineResult<T> from './offlineBase' directly.

export {
  downloadAnalyticsExport,
  fetchAnalyticsFilterOptions,
  fetchAnalystIncidentDetail,
  fetchAnalystIncidentList,
  fetchAnalystIncidentSensitive,
  fetchAnalystIncidentWildlandDetail,
  fetchComparativeData,
  fetchCompareRegions,
  fetchHeatmapData,
  fetchResponseTimeByRegion,
  fetchTopN,
  fetchTrendData,
  fetchTypeDistribution,
  queueAnalyticsExport,
} from './legacy';

export type {
  AnalystIncidentDetailResponse,
  AnalystIncidentListItem,
  AnalystIncidentListParams,
  AnalystIncidentListResponse,
  AnalystIncidentSensitiveResponse,
  AnalystIncidentWildlandDetailResponse,
  AnalystListSortField,
  AnalyticsFilterOptionsField,
  AnalyticsGlobalFilters,
  ComparativeFilters,
  ComparativeResponse,
  CompareRegionItem,
  HeatmapFeatureProperties,
  HeatmapFilters,
  HeatmapGeoJSON,
  QueueAnalyticsExportRequest,
  ResponseTimeRegionItem,
  SortDirection,
  TopNItem,
  TrendFilters,
  TrendsResponse,
  TypeDistributionItem,
} from './legacy';

export interface TopBarangayItem {
  barangay: string;
  municipality_name?: string | null;
  count: number;
}
