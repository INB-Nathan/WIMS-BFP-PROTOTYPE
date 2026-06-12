export {
  analyzeSecurityLog,
  changeMyPassword,
  createAdminUser,
  createIncidentFromAlert,
  fetchActiveSessions,
  fetchAdminSecurityLogs,
  fetchAdminUsers,
  fetchAuditLogs,
  fetchMyProfile,
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
} from './legacy';

export type { KeycloakSession } from './legacy';

export {
  fetchSystemHealthOfflineAware,
  fetchSystemMetricsOfflineAware,
  fetchWorkerStatusOfflineAware,
  fetchActiveSessionsOfflineAware,
  fetchAuditLogsOfflineAware,
} from './offlineAdmin';

export type { OfflineAnalyticsResult } from './offlineAdmin';
