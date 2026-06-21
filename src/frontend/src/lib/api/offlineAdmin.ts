import {
  fetchSystemHealth as legacyFetchSystemHealth,
  fetchSystemMetrics as legacyFetchSystemMetrics,
  fetchWorkerStatus as legacyFetchWorkerStatus,
  fetchActiveSessions as legacyFetchActiveSessions,
  fetchAuditLogs as legacyFetchAuditLogs,
  fetchAdminSecurityLogs as legacyFetchAdminSecurityLogs,
  fetchSecurityLogsSummary as legacyFetchSecurityLogsSummary,
  fetchAnomalies as legacyFetchAnomalies,
  fetchAdminConfig as legacyFetchAdminConfig,
  fetchRateLimits as legacyFetchRateLimits,
} from './legacy';
import { fetchBreaches as breachFetchBreaches } from './breach';

import type {
  SystemHealthResponse,
  SystemMetricsResponse,
  WorkerStatusPaginatedResponse,
  SecurityLogsSummary,
  AnomalyAggregateResponse,
  SystemConfigEntry,
  RateLimitConfig,
} from './legacy';
import type { Breach } from './breach';
import type { ActiveSession, AuditLogEntry, PaginatedResponse } from '@/types/api';
import {
  OfflineResult,
  offlineAware,
} from './offlineBase';

const ADMIN_CACHE_TTL_MS = 60_000;
const SESSIONS_CACHE_TTL_MS = 30_000;
const CONFIG_CACHE_TTL_MS = 30 * 60 * 1000;
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

export async function fetchAdminSecurityLogsOfflineAware(
  params?: { q?: string; severity?: string; classification?: string; limit?: number; offset?: number; source_ip?: string; date_from?: string; date_to?: string },
): Promise<OfflineAdminResult<{ items: any[]; total: number }>> {
  return offlineAware('security-logs', [params ?? {}], 'admin', ADMIN_CACHE_TTL_MS, () => legacyFetchAdminSecurityLogs(params), OFFLINE_ADMIN_ERROR);
}

export async function fetchSecurityLogsSummaryOfflineAware(): Promise<OfflineAdminResult<SecurityLogsSummary>> {
  return offlineAware('security-logs-summary', [], 'admin', ADMIN_CACHE_TTL_MS, () => legacyFetchSecurityLogsSummary(), OFFLINE_ADMIN_ERROR);
}

export async function fetchAnomaliesOfflineAware(
  params?: { status?: string; severity?: string; anomaly_type?: string; limit?: number; offset?: number },
): Promise<OfflineAdminResult<AnomalyAggregateResponse>> {
  return offlineAware('anomalies', [params ?? {}], 'admin', ADMIN_CACHE_TTL_MS, () => legacyFetchAnomalies(params), OFFLINE_ADMIN_ERROR);
}

export async function fetchBreachesOfflineAware(): Promise<OfflineAdminResult<Breach[]>> {
  return offlineAware('breaches', [], 'admin', ADMIN_CACHE_TTL_MS, () => breachFetchBreaches(), OFFLINE_ADMIN_ERROR);
}

export async function fetchAdminConfigOfflineAware(): Promise<OfflineAdminResult<SystemConfigEntry[]>> {
  return offlineAware('system-config', [], 'admin', CONFIG_CACHE_TTL_MS, () => legacyFetchAdminConfig(), OFFLINE_ADMIN_ERROR);
}

export async function fetchRateLimitsOfflineAware(): Promise<OfflineAdminResult<RateLimitConfig>> {
  return offlineAware('rate-limits', [], 'admin', CONFIG_CACHE_TTL_MS, () => legacyFetchRateLimits(), OFFLINE_ADMIN_ERROR);
}
