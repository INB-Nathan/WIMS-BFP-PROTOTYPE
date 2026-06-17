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
  WorkerStatusPaginatedResponse,
} from './legacy';
import type { ActiveSession, AuditLogEntry, PaginatedResponse } from '@/types/api';
import {
  OfflineResult,
  offlineAware,
} from './offlineBase';

const ADMIN_CACHE_TTL_MS = 60_000;
const SESSIONS_CACHE_TTL_MS = 30_000;
const OFFLINE_ADMIN_ERROR = 'System health data is unavailable offline. Reconnect to refresh this view.';

// Re-export the shared result type under the domain-specific name
// so existing consumers (admin.ts, components) are unaffected.
export type OfflineAdminResult<T> = OfflineResult<T>;

export async function fetchSystemHealthOfflineAware(): Promise<OfflineAdminResult<SystemHealthResponse>> {
  return offlineAware('system-health', [], 'admin', ADMIN_CACHE_TTL_MS, () => legacyFetchSystemHealth(), OFFLINE_ADMIN_ERROR);
}

export async function fetchSystemMetricsOfflineAware(): Promise<OfflineAdminResult<SystemMetricsResponse>> {
  return offlineAware('system-metrics', [], 'admin', ADMIN_CACHE_TTL_MS, () => legacyFetchSystemMetrics(), OFFLINE_ADMIN_ERROR);
}

export async function fetchWorkerStatusOfflineAware(
  params?: { limit?: number; offset?: number }
): Promise<OfflineAdminResult<WorkerStatusPaginatedResponse>> {
  return offlineAware(
    'worker-status',
    [params ?? {}],
    'admin',
    ADMIN_CACHE_TTL_MS,
    () => legacyFetchWorkerStatus(params),
    OFFLINE_ADMIN_ERROR
  );
}

export async function fetchActiveSessionsOfflineAware(): Promise<OfflineAdminResult<ActiveSession[]>> {
  return offlineAware('active-sessions', [], 'admin', SESSIONS_CACHE_TTL_MS, () => legacyFetchActiveSessions(), OFFLINE_ADMIN_ERROR);
}

export async function fetchAuditLogsOfflineAware(
  params?: { limit?: number; offset?: number; q?: string; user_id?: string; action_type?: string; table_affected?: string; ip_address?: string; date_from?: string; date_to?: string },
): Promise<OfflineAdminResult<PaginatedResponse<AuditLogEntry>>> {
  return offlineAware('audit-logs', [params ?? {}], 'admin', ADMIN_CACHE_TTL_MS, () => legacyFetchAuditLogs(params), OFFLINE_ADMIN_ERROR);
}
