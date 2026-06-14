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
  updateScheduledReport,
} from './legacy';

export type { KeycloakSession } from './legacy';
export type { ScheduledReport } from './legacy';

export {
  fetchSystemHealthOfflineAware,
  fetchSystemMetricsOfflineAware,
  fetchWorkerStatusOfflineAware,
  fetchActiveSessionsOfflineAware,
  fetchAuditLogsOfflineAware,
} from './offlineAdmin';

export type { OfflineAdminResult } from './offlineAdmin';
