import { apiFetch } from './transport';
import type {
  BlockedIp,
  BlockResult,
  BlockByFilterResult,
  BulkResult,
  SecurityLogFilter,
  BlockedDevice,
  DeviceBlockResult,
  BulkBlockPreviewResult,
} from '@/types/api';

export async function blockSourceIp(
  logId: number,
  opts?: { ttl_hours?: number | 'permanent' }
): Promise<BlockResult> {
  return apiFetch<BlockResult>(`/admin/security-logs/${logId}/block-source-ip`, {
    method: 'POST',
    body: JSON.stringify({ ttl_hours: opts?.ttl_hours ?? 24 }),
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function deleteSecurityLog(
  logId: number
): Promise<{ status: 'ok'; log_id: number }> {
  return apiFetch(`/admin/security-logs/${logId}`, { method: 'DELETE' });
}

export async function blockByFilter(
  filters: SecurityLogFilter,
  opts: { preview: boolean }
): Promise<BlockByFilterResult> {
  const qs = opts.preview ? '?preview=true' : '';
  return apiFetch<BlockByFilterResult>(`/admin/security-logs/block-by-filter${qs}`, {
    method: 'POST',
    body: JSON.stringify(filters),
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function bulkActionSecurityLogs(
  body: {
    log_ids: number[];
    action: 'block_ip' | 'block_device' | 'dismiss' | 'false_positive';
    ttl_hours?: number | 'permanent';
  }
): Promise<BulkResult> {
  return apiFetch<BulkResult>('/admin/security-logs/bulk-action', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function listBlockedIps(): Promise<BlockedIp[]> {
  return apiFetch<BlockedIp[]>('/admin/ip-blocklist');
}

export async function unblockIp(ip: string): Promise<{ status: 'ok'; ip: string }> {
  return apiFetch(`/admin/ip-blocklist/${encodeURIComponent(ip)}`, { method: 'DELETE' });
}

export async function listBlockedDevices(): Promise<BlockedDevice[]> {
  return apiFetch<BlockedDevice[]>('/admin/device-blocklist');
}

export async function unblockDevice(
  tokenHash: string
): Promise<{ status: 'ok'; device_token_hash: string }> {
  return apiFetch(`/admin/device-blocklist/${encodeURIComponent(tokenHash)}`, {
    method: 'DELETE',
  });
}

export async function blockSecurityLog(
  logId: number,
  opts: { type: 'device' | 'ip'; ttl_hours?: number | 'permanent' }
): Promise<BlockResult | DeviceBlockResult> {
  return apiFetch(`/admin/security-logs/${logId}/block`, {
    method: 'POST',
    body: JSON.stringify({ type: opts.type, ttl_hours: opts.ttl_hours ?? 24 }),
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function bulkBlockPreview(logIds: number[]): Promise<BulkBlockPreviewResult> {
  return apiFetch<BulkBlockPreviewResult>('/admin/security-logs/bulk-block-preview', {
    method: 'POST',
    body: JSON.stringify({ log_ids: logIds }),
    headers: { 'Content-Type': 'application/json' },
  });
}
