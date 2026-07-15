/**
 * TDD: BlockedIpsPanel component
 *
 * Verifies:
 * 1. Renders blocked IPs from listBlockedIps
 * 2. "Confirmed Attacker" badge when block_count >= 3
 * 3. "Permanent" label when is_permanent === true
 * 4. Unblock button calls unblockIp with correct IP
 * 5. Refetches list after unblock
 * 6. Empty state when blocks === []
 * 7. Loading state on initial mount
 * 8. Error state when listBlockedIps rejects
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlockedIpsPanel } from './BlockedIpsPanel';
import type { BlockedIp, BlockedDevice } from '@/types/api';

const mockListBlockedIps = vi.fn();
const mockUnblockIp = vi.fn();
const mockListBlockedDevices = vi.fn();
const mockUnblockDevice = vi.fn();

vi.mock('@/lib/api/securityActions', () => ({
  listBlockedIps: () => mockListBlockedIps(),
  unblockIp: (ip: string) => mockUnblockIp(ip),
  listBlockedDevices: () => mockListBlockedDevices(),
  unblockDevice: (hash: string) => mockUnblockDevice(hash),
}));

const MOCK_BLOCKS: BlockedIp[] = [
  {
    source_ip: '192.168.1.100',
    blocked_at: '2026-06-22T10:00:00Z',
    expires_at: '2026-06-23T10:00:00Z',
    is_permanent: false,
    block_count: 1,
    blocked_by: 'admin-uuid',
    block_reason: 'manual row block',
  },
  {
    source_ip: '10.0.0.50',
    blocked_at: '2026-06-20T08:00:00Z',
    expires_at: null,
    is_permanent: true,
    block_count: 3,
    blocked_by: 'admin-uuid',
    block_reason: 'repeat offender — 3 episodes',
  },
  {
    source_ip: '203.0.113.99',
    blocked_at: '2026-06-21T14:00:00Z',
    expires_at: '2026-06-22T14:00:00Z',
    is_permanent: false,
    block_count: 4,
    blocked_by: 'admin-uuid',
    block_reason: 'HIGH threat filter',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BlockedIpsPanel', () => {
  // ── Loading state ───────────────────────────────────────────────────────

  it('renders loading state on initial mount', () => {
    // Keep the promise pending so we stay in loading state
    mockListBlockedIps.mockReturnValue(new Promise(() => {}));
    render(<BlockedIpsPanel />);
    expect(screen.getByText(/Loading blocked IPs/i)).toBeInTheDocument();
  });

  // ── Empty state ─────────────────────────────────────────────────────────

  it('renders empty state when listBlockedIps returns empty array', async () => {
    mockListBlockedIps.mockResolvedValue([]);
    render(<BlockedIpsPanel />);

    await waitFor(() => {
      expect(screen.getByText(/No IPs currently blocked/i)).toBeInTheDocument();
    });
  });

  // ── Error state ─────────────────────────────────────────────────────────

  it('renders error state when listBlockedIps rejects', async () => {
    mockListBlockedIps.mockRejectedValue(new Error('Network failure'));
    render(<BlockedIpsPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Network failure/i)).toBeInTheDocument();
    });

    // Retry button should be present
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  // ── Blocked IP list rendering ───────────────────────────────────────────

  it('renders all blocked IPs from listBlockedIps', async () => {
    mockListBlockedIps.mockResolvedValue(MOCK_BLOCKS);
    render(<BlockedIpsPanel />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });
    expect(screen.getByText('10.0.0.50')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.99')).toBeInTheDocument();
  });

  it('renders panel header with block count', async () => {
    mockListBlockedIps.mockResolvedValue(MOCK_BLOCKS);
    render(<BlockedIpsPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Blocked IPs/i)).toBeInTheDocument();
    });
    // Panel header shows repeat-offender summary
    expect(
      screen.getByText((content) => content.includes('repeat offender'))
    ).toBeInTheDocument();
  });

  // ── Confirmed Attacker badge ────────────────────────────────────────────

  it('shows Confirmed Attacker badge for repeat offenders (block_count >= 3)', async () => {
    mockListBlockedIps.mockResolvedValue(MOCK_BLOCKS);
    render(<BlockedIpsPanel />);

    await waitFor(() => {
      // Use getAllByText since there are 2 repeat-offenders
      const badges = screen.getAllByText('Confirmed Attacker');
      expect(badges.length).toBe(2);
    });

    // Should appear for 10.0.0.50 (block_count: 3) and 203.0.113.99 (block_count: 4)
    const badges = screen.getAllByText('Confirmed Attacker');
    expect(badges.length).toBe(2);
  });

  it('does NOT show Confirmed Attacker badge for first-time blocked IP', async () => {
    mockListBlockedIps.mockResolvedValue(MOCK_BLOCKS);
    render(<BlockedIpsPanel />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });
    // First-time offender should NOT have the badge — only 2 repeat-offenders
    const badges = screen.queryAllByText('Confirmed Attacker');
    expect(badges.length).toBe(2);
  });

  // ── Permanent label ─────────────────────────────────────────────────────

  it('shows Permanent label when is_permanent is true', async () => {
    mockListBlockedIps.mockResolvedValue(MOCK_BLOCKS);
    render(<BlockedIpsPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Permanent/i)).toBeInTheDocument();
    });
  });

  // ── Unblock action ──────────────────────────────────────────────────────

  it('renders Unblock button for each blocked IP', async () => {
    mockListBlockedIps.mockResolvedValue(MOCK_BLOCKS);
    render(<BlockedIpsPanel />);

    await waitFor(() => {
      const unblockButtons = screen.getAllByRole('button', { name: /Unblock/i });
      expect(unblockButtons).toHaveLength(3);
    });
  });

  it('calls unblockIp with correct IP on Unblock click after confirm', async () => {
    mockListBlockedIps.mockResolvedValue(MOCK_BLOCKS);
    mockUnblockIp.mockResolvedValue({ status: 'ok', ip: '192.168.1.100' });

    // Auto-accept confirm dialog
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<BlockedIpsPanel />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    // Click the Unblock button for the first IP
    const unblockButtons = screen.getAllByRole('button', { name: /Unblock/i });
    fireEvent.click(unblockButtons[0]);

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
      // Verify the confirm dialog mentions the IP and block count
      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringContaining('192.168.1.100')
      );
      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringContaining('1 block episodes')
      );
    });

    await waitFor(() => {
      expect(mockUnblockIp).toHaveBeenCalledWith('192.168.1.100');
    });

    confirmSpy.mockRestore();
  });

  it('refetches blocked IPs list after unblock', async () => {
    mockListBlockedIps.mockResolvedValue(MOCK_BLOCKS);
    mockUnblockIp.mockResolvedValue({ status: 'ok', ip: '192.168.1.100' });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<BlockedIpsPanel />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    // Clear initial call count
    mockListBlockedIps.mockClear();

    // Update mock for refetch return
    mockListBlockedIps.mockResolvedValue(MOCK_BLOCKS.slice(1));

    const unblockButtons = screen.getAllByRole('button', { name: /Unblock/i });
    fireEvent.click(unblockButtons[0]);

    await waitFor(() => {
      // listBlockedIps should have been called again (refetch)
      expect(mockListBlockedIps).toHaveBeenCalledTimes(1);
    });

    confirmSpy.mockRestore();
  });

  it('calls onUnblocked callback after unblock completes', async () => {
    mockListBlockedIps.mockResolvedValue(MOCK_BLOCKS);
    mockUnblockIp.mockResolvedValue({ status: 'ok', ip: '192.168.1.100' });

    // Refetch returns same data
    mockListBlockedIps.mockResolvedValue(MOCK_BLOCKS);

    const onUnblockedSpy = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<BlockedIpsPanel onUnblocked={onUnblockedSpy} />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    const unblockButtons = screen.getAllByRole('button', { name: /Unblock/i });
    fireEvent.click(unblockButtons[0]);

    await waitFor(() => {
      expect(onUnblockedSpy).toHaveBeenCalled();
    });

    confirmSpy.mockRestore();
  });

  it('does NOT call unblockIp when confirm dialog is cancelled', async () => {
    mockListBlockedIps.mockResolvedValue(MOCK_BLOCKS);

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<BlockedIpsPanel />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    const unblockButtons = screen.getAllByRole('button', { name: /Unblock/i });
    fireEvent.click(unblockButtons[0]);

    // unblockIp should NOT have been called
    expect(mockUnblockIp).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  // ── Unblock confirm dialog content ──────────────────────────────────────

  it('shows permanent label in unblock confirm dialog for permanent blocks', async () => {
    mockListBlockedIps.mockResolvedValue(MOCK_BLOCKS);
    mockUnblockIp.mockResolvedValue({ status: 'ok', ip: '10.0.0.50' });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<BlockedIpsPanel />);

    await waitFor(() => {
      expect(screen.getByText('10.0.0.50')).toBeInTheDocument();
    });

    const unblockButtons = screen.getAllByRole('button', { name: /Unblock/i });
    // Second IP (10.0.0.50) is permanent
    fireEvent.click(unblockButtons[1]);

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('permanent')
    );
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('3 block episodes')
    );

    confirmSpy.mockRestore();
  });

  // ── Severity differentiation (repeat-offender row) ──────────────────────

  it('repeat-offender rows have different styling from normal rows', async () => {
    mockListBlockedIps.mockResolvedValue(MOCK_BLOCKS);
    render(<BlockedIpsPanel />);

    await waitFor(() => {
      const rows = screen.getAllByTestId('blocked-ip-row');
      expect(rows.length).toBe(3);
    });

    // First row (192.168.1.100, block_count=1) should NOT have the repeat-offender class
    // Third row (203.0.113.99, block_count=4) should have it
    const rows = screen.getAllByTestId('blocked-ip-row');
    // Use data attribute to differentiate
    const repeatOffenderRows = rows.filter(
      (row) => row.getAttribute('data-repeat-offender') === 'true'
    );
    expect(repeatOffenderRows.length).toBe(2);

    const normalRows = rows.filter(
      (row) => row.getAttribute('data-repeat-offender') !== 'true'
    );
    expect(normalRows.length).toBe(1);
  });
});

// =============================================================================
// Blocked Devices tab (Wayfinder — issue #571)
// =============================================================================

const MOCK_DEVICE_BLOCKS: BlockedDevice[] = [
  {
    device_token_hash: 'abcdef0123456789',
    blocked_at: '2026-07-15T10:00:00Z',
    expires_at: '2026-07-16T10:00:00Z',
    is_permanent: false,
    block_count: 1,
    blocked_by: 'admin-uuid',
    block_reason: 'manual row block',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TestBrowser/1.0',
    authenticated_user_id: null,
  },
  {
    device_token_hash: 'fedcba9876543210',
    blocked_at: '2026-07-10T08:00:00Z',
    expires_at: null,
    is_permanent: true,
    block_count: 3,
    blocked_by: 'admin-uuid',
    block_reason: 'repeat offender — 3 episodes',
    user_agent: 'curl/8.0',
    authenticated_user_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  },
];

describe('BlockedIpsPanel — tabs', () => {
  it('defaults to the Blocked IPs tab', async () => {
    mockListBlockedIps.mockResolvedValue([]);
    render(<BlockedIpsPanel />);

    await waitFor(() => {
      expect(screen.getByText(/No IPs currently blocked/i)).toBeInTheDocument();
    });
    expect(mockListBlockedDevices).not.toHaveBeenCalled();
  });

  it('switches to the Blocked Devices tab and loads devices', async () => {
    mockListBlockedIps.mockResolvedValue([]);
    mockListBlockedDevices.mockResolvedValue(MOCK_DEVICE_BLOCKS);

    render(<BlockedIpsPanel />);

    await waitFor(() => {
      expect(screen.getByText(/No IPs currently blocked/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('tab-blocked-devices'));

    await waitFor(() => {
      expect(screen.getByTitle('abcdef0123456789')).toBeInTheDocument();
    });
    expect(screen.getByTitle('fedcba9876543210')).toBeInTheDocument();
  });

  it('shows truncated user agent and Confirmed Attacker badge for repeat-offender devices', async () => {
    mockListBlockedIps.mockResolvedValue([]);
    mockListBlockedDevices.mockResolvedValue(MOCK_DEVICE_BLOCKS);

    render(<BlockedIpsPanel />);
    fireEvent.click(screen.getByTestId('tab-blocked-devices'));

    await waitFor(() => {
      const badges = screen.getAllByText('Confirmed Attacker');
      expect(badges.length).toBe(1);
    });
    expect(screen.getByText('curl/8.0')).toBeInTheDocument();
  });

  it('shows empty state when no devices are blocked', async () => {
    mockListBlockedIps.mockResolvedValue([]);
    mockListBlockedDevices.mockResolvedValue([]);

    render(<BlockedIpsPanel />);
    fireEvent.click(screen.getByTestId('tab-blocked-devices'));

    await waitFor(() => {
      expect(screen.getByText(/No devices blocked/i)).toBeInTheDocument();
    });
  });

  it('unblocks a device on confirm and refetches', async () => {
    mockListBlockedIps.mockResolvedValue([]);
    mockListBlockedDevices.mockResolvedValue(MOCK_DEVICE_BLOCKS);
    mockUnblockDevice.mockResolvedValue({ status: 'ok', device_token_hash: 'abcdef0123456789' });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onUnblockedSpy = vi.fn();

    render(<BlockedIpsPanel onUnblocked={onUnblockedSpy} />);
    fireEvent.click(screen.getByTestId('tab-blocked-devices'));

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Unblock/i }).length).toBe(2);
    });

    mockListBlockedDevices.mockResolvedValue([MOCK_DEVICE_BLOCKS[1]]);
    fireEvent.click(screen.getAllByRole('button', { name: /Unblock/i })[0]);

    await waitFor(() => {
      expect(mockUnblockDevice).toHaveBeenCalledWith('abcdef0123456789');
      expect(onUnblockedSpy).toHaveBeenCalled();
    });

    confirmSpy.mockRestore();
  });

  it('does NOT unblock a device when confirm is cancelled', async () => {
    mockListBlockedIps.mockResolvedValue([]);
    mockListBlockedDevices.mockResolvedValue(MOCK_DEVICE_BLOCKS);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<BlockedIpsPanel />);
    fireEvent.click(screen.getByTestId('tab-blocked-devices'));

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Unblock/i }).length).toBe(2);
    });

    fireEvent.click(screen.getAllByRole('button', { name: /Unblock/i })[0]);
    expect(mockUnblockDevice).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('switching back to Blocked IPs tab preserves IP tab content', async () => {
    mockListBlockedIps.mockResolvedValue([]);
    mockListBlockedDevices.mockResolvedValue([]);

    render(<BlockedIpsPanel />);
    fireEvent.click(screen.getByTestId('tab-blocked-devices'));
    await waitFor(() => {
      expect(screen.getByText(/No devices blocked/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('tab-blocked-ips'));
    await waitFor(() => {
      expect(screen.getByText(/No IPs currently blocked/i)).toBeInTheDocument();
    });
  });
});
