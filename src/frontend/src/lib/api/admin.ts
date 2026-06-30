export {
  analyzeSecurityLog,
  changeMyPassword,
  createAdminUser,
  createIncidentFromAlert,
  createScheduledReport,
  deleteScheduledReport,
  deleteSyncOp,
  fetchActiveSessions,
  fetchAdminSecurityLogs,
  fetchAdminUsers,
  fetchAuditLogs,
  fetchFailedSyncOps,
  fetchMyProfile,
  fetchRateLimits,
  fetchRelatedAuditLogs,
  fetchScheduledReports,
  fetchSecurityLogs,
  fetchSystemHealth,
  fetchSystemMetrics,
  fetchWorkerStatus,
  fetchUserSessions,
  pruneWorkers,
  retrySyncOp,
  revokeUserSessions,
  terminateUserSessions,
  updateAdminSecurityLog,
  updateAdminUser,
  updateMyProfile,
  updateRateLimits,
  updateScheduledReport,
} from './legacy';

export type {
  FailedSyncOp,
  KeycloakSession,
  RateLimitConfig,
  RelatedAlertItem,
  RelatedAuditItem,
  RelatedAuditResponse,
  WorkerStatusPaginatedResponse,
} from './legacy';
export type { ScheduledReport } from './legacy';

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

// Issue #7: OfflineAdminResult identity alias deleted. Consumers use
// OfflineResult<T> from './offlineBase' directly.
