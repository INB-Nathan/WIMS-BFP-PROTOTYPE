import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockRouter = vi.hoisted(() => ({ push: vi.fn(), prefetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => mockRouter }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Default auth — encoder role
let mockRole = 'REGIONAL_ENCODER';
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    loading: false,
    user: { id: 'test-encoder', role: mockRole },
  }),
}));

vi.mock('@/lib/offlineModeFlags', () => ({
  isOfflineModeEnabled: vi.fn().mockReturnValue(false),
  clearOfflineModeEnabled: vi.fn(),
}));

vi.mock('@/lib/connectivity', () => ({
  getConnectivitySnapshot: vi.fn().mockReturnValue({ isOnline: true }),
}));

let enableOfflineResolve: ((value: unknown) => void) | null = null;
let enableOfflineCallback: ((p: Record<string, unknown>) => void) | null = null;

vi.mock('@/lib/offlineEnable', () => ({
  enableOfflineMode: vi.fn().mockImplementation(
    async (_encoderId: string, opts: Record<string, unknown>) => {
      enableOfflineCallback = opts.onProgress as typeof enableOfflineCallback;
      const signal = opts.signal as AbortSignal | undefined;
      return new Promise((resolve) => {
        enableOfflineResolve = resolve;
        // If already aborted before we return, resolve cancelled
        if (signal?.aborted) {
          resolve({ ok: false, cachedDetails: 0, cachedList: 0, error: 'Offline setup cancelled.' });
        }
      });
    },
  ),
}));

vi.mock('@/lib/offlineStore', () => ({
  clearAllOfflineData: vi.fn().mockResolvedValue(undefined),
  setActiveOfflineUser: vi.fn().mockResolvedValue(undefined),
  getCachedIncidents: vi.fn().mockResolvedValue([]),
  getPendingOps: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isChecking: false, isReconnecting: false }),
}));

import { OfflineModeManager } from '../OfflineModeManager';

describe('OfflineModeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableOfflineResolve = null;
    enableOfflineCallback = null;
    mockRole = 'REGIONAL_ENCODER';
  });

  it('renders Update offline data button', () => {
    render(<OfflineModeManager variant="panel" />);
    expect(screen.getByText('Update offline data')).toBeInTheDocument();
  });

  it('shows progress during setup', async () => {
    const user = userEvent.setup();
    render(<OfflineModeManager variant="panel" />);

    await user.click(screen.getByText('Update offline data'));

    // Simulate progress updates via the callback captured by the mock
    await waitFor(() => {
      expect(enableOfflineCallback).not.toBeNull();
    });

    enableOfflineCallback!({ step: 'Caching incident details…', phase: 'details', currentLabel: 'Incident #1', done: 1, total: 5 });

    await waitFor(() => {
      expect(screen.getByText('Details')).toBeInTheDocument();
    });
    expect(screen.getByText('(1/5)')).toBeInTheDocument();
    expect(screen.getByText('Incident #1')).toBeInTheDocument();
    // Should show Cancel button while busy
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('cancellation aborts the update and restores button', async () => {
    const user = userEvent.setup();
    render(<OfflineModeManager variant="panel" />);

    // Click update — the mock doesn't resolve yet, so we stay in busy state
    await user.click(screen.getByText('Update offline data'));

    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    // Click cancel
    await user.click(screen.getByText('Cancel'));

    await waitFor(() => {
      expect(screen.getByText('Update offline data')).toBeInTheDocument();
    });
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });

  it('renders nothing for non-encoder roles', () => {
    mockRole = 'NATIONAL_ANALYST';
    const { container } = render(<OfflineModeManager variant="panel" />);
    expect(container.innerHTML).toBe('');
  });

  it('shows banner variant when no incidents are cached', async () => {
    // cachedCount starts null (loading), then resolves to 0 → banner shows
    render(<OfflineModeManager variant="banner" />);
    await waitFor(() => {
      expect(screen.getByText(/Download incidents for offline viewing/)).toBeInTheDocument();
    });
    expect(screen.getByText('Set up in My Profile')).toBeInTheDocument();
  });

  it('hides banner variant when incidents are already cached', async () => {
    const { getCachedIncidents } = await import('@/lib/offlineStore');
    vi.mocked(getCachedIncidents).mockResolvedValue([{ serverId: 1, cachedAt: Date.now(), encoderId: 'test-encoder' } as never]);
    const { container } = render(<OfflineModeManager variant="banner" />);
    await waitFor(() => {
      expect(container.innerHTML).toBe('');
    });
  });
});
