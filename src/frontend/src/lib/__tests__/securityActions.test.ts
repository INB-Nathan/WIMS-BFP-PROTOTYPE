import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/transport', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../api/transport';
import {
  blockSourceIp,
  deleteSecurityLog,
  blockByFilter,
  bulkActionSecurityLogs,
  listBlockedIps,
  unblockIp,
} from '../api/securityActions';

const mockedApiFetch = apiFetch as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('securityActions', () => {
  it('blockSourceIp POSTs to /admin/security-logs/{id}/block-source-ip with default 24h', async () => {
    mockedApiFetch.mockResolvedValue({ ip: '1.2.3.4', is_permanent: false });
    const r = await blockSourceIp(1);
    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/admin/security-logs/1/block-source-ip',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ ttl_hours: 24 }) })
    );
    expect(r.ip).toBe('1.2.3.4');
  });

  it('blockSourceIp accepts "permanent"', async () => {
    mockedApiFetch.mockResolvedValue({ is_permanent: true });
    await blockSourceIp(1, { ttl_hours: 'permanent' });
    expect(mockedApiFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ ttl_hours: 'permanent' }) })
    );
  });

  it('deleteSecurityLog DELETEs', async () => {
    mockedApiFetch.mockResolvedValue({ status: 'ok', log_id: 1 });
    await deleteSecurityLog(1);
    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/admin/security-logs/1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('blockByFilter with preview=true appends ?preview=true', async () => {
    mockedApiFetch.mockResolvedValue({ dry_run: true, total_distinct_ips: 5, skipped_self: 0, skipped_allowlist: 0 });
    await blockByFilter({ severity: 'HIGH' }, { preview: true });
    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/admin/security-logs/block-by-filter?preview=true',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('blockByFilter without preview does NOT append ?preview', async () => {
    mockedApiFetch.mockResolvedValue({ dry_run: false, total_distinct_ips: 5, blocked_count: 5, skipped_self: 0, skipped_allowlist: 0, capped: false });
    await blockByFilter({ severity: 'HIGH' }, { preview: false });
    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/admin/security-logs/block-by-filter',
      expect.anything()
    );
  });

  it('bulkActionSecurityLogs POSTs the body', async () => {
    mockedApiFetch.mockResolvedValue({ results: [{ log_id: 1, status: 'dismissed' }] });
    await bulkActionSecurityLogs({ log_ids: [1, 2, 3], action: 'dismiss' });
    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/admin/security-logs/bulk-action',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ log_ids: [1, 2, 3], action: 'dismiss' }) })
    );
  });

  it('listBlockedIps GETs', async () => {
    mockedApiFetch.mockResolvedValue([{ source_ip: '1.2.3.4', block_count: 3 }]);
    const r = await listBlockedIps();
    expect(mockedApiFetch).toHaveBeenCalledWith('/admin/ip-blocklist');
    expect(r).toHaveLength(1);
  });

  it('unblockIp DELETEs with URL-encoded IP', async () => {
    mockedApiFetch.mockResolvedValue({ status: 'ok', ip: '1.2.3.4' });
    await unblockIp('1.2.3.4');
    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/admin/ip-blocklist/1.2.3.4',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});
