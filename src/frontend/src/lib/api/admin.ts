export {
  analyzeSecurityLog,
  changeMyPassword,
  createAdminUser,
  createIncidentFromAlert,
  createScheduledReport,
  deleteScheduledReport,
  fetchActiveSessions,
  fetchAdminSecurityLogs,
  fetchAdminUsers,
  fetchAuditLogs,
  fetchMyProfile,
  fetchRateLimits,
  fetchRelatedAuditLogs,
  fetchScheduledReports,
  fetchSecurityLogs,
  fetchSystemHealth,
  fetchSystemMetrics,
  fetchWorkerStatus,
  fetchUserSessions,
  revokeUserSessions,
  terminateUserSessions,
  updateAdminSecurityLog,
  updateAdminUser,
  updateMyProfile,
  updateRateLimits,
  updateScheduledReport,
} from './legacy';

export type { KeycloakSession, RateLimitConfig, RelatedAuditItem, RelatedAuditResponse } from './legacy';
export type { ScheduledReport } from './legacy';

export {
  fetchSystemHealthOfflineAware,
  fetchSystemMetricsOfflineAware,
  fetchWorkerStatusOfflineAware,
  fetchActiveSessionsOfflineAware,
  fetchAuditLogsOfflineAware,
} from './offlineAdmin';

export type { OfflineAdminResult } from './offlineAdmin';
