/**
 * Domain API slices with compatibility exports.
 *
 * `legacy.ts` retains implementation during migration; domain files are the
 * stable import surface for new code.
 */

export { API_BASE, ApiRequestError, apiFetch, errorMessageFromJson } from './transport';
export { publicApiFetch } from './public-transport';

export * from './admin';
export * from './analytics';
export { fetchAnalystIncidentWildlandDetailOfflineAware } from './analytics';
export * from './breach';
export * from './civilian';
export * from './reference';
export {
  fetchRegionsOfflineAware,
  fetchProvincesOfflineAware,
  fetchCitiesOfflineAware,
} from './offlineReference';
export * from './regional';
export * from './triage';
export * from './map';
export * from './operations';
export * from './validator';
export {
  fetchOperationalMapOfflineAware,
  fetchValidatorAuditLogsOfflineAware,
} from './offlineValidator';

// Issue #14: api/index.ts re-export coverage was partial. admin/analytics/
// offlineAdmin/offlineAnalytics were not re-exported — consumers reached
// into the deep paths (admin.ts:18-22 imports the admin wrappers directly).
// Add the missing re-exports so the barrel boundary is the canonical
// surface and consumers don't have to know the deep path.
export {
  fetchSystemHealthOfflineAware,
  fetchSystemMetricsOfflineAware,
  fetchWorkerStatusOfflineAware,
  fetchActiveSessionsOfflineAware,
  fetchAuditLogsOfflineAware,
  fetchAdminSecurityLogsOfflineAware,
  fetchSecurityLogsSummaryOfflineAware,
  fetchAnomaliesOfflineAware,
  fetchBreachesOfflineAware,
  fetchAdminConfigOfflineAware,
  fetchRateLimitsOfflineAware,
} from './offlineAdmin';

export {
  fetchAnalyticsFilterOptionsOfflineAware,
  fetchAnalystIncidentDetailOfflineAware,
  fetchAnalystIncidentSensitiveOfflineAware,
  fetchComparativeDataOfflineAware,
  fetchFilterOptionsOfflineAware,
  fetchHeatmapDataOfflineAware,
  fetchResponseTimeByRegionOfflineAware,
  fetchTopNOfflineAware,
  fetchTrendDataOfflineAware,
  fetchTypeDistributionOfflineAware,
} from './offlineAnalytics';
