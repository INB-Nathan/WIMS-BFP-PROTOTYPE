/**
 * Offline Work page tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OfflineWorkPage from './page';

// ── Mocks ───────────────────────────────────────────────────────────────────
// All vi.mock factories use vi.hoisted's closure so hoisting does not
// break variable references.

const mockRouter = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => mockRouter),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/offlineStore', () => ({
  getDraftOps: vi.fn(),
  getPendingOps: vi.fn(),
  getConflictOps: vi.fn(),
  getFailedOps: vi.fn(),
  deleteOfflineOp: vi.fn(),
  deleteOfflineOpCascade: vi.fn(),
}));

vi.mock('@/lib/syncEngine', () => ({
  syncPendingIncidents: vi.fn(),
}));

vi.mock('@/lib/useAutoSync', () => ({
  useAutoSync: vi.fn(),
}));

vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: vi.fn(),
}));

// Import mocks after vi.mock to get the hoisted mock functions
import * as offlineStore from '@/lib/offlineStore';
import * as syncEngine from '@/lib/syncEngine';
import { useAuth } from '@/context/AuthContext';
import { useAutoSync } from '@/lib/useAutoSync';
import { useNetworkStatus } from '@/lib/useNetworkStatus';
import { useRouter } from 'next/navigation';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeOp(overrides: Record<string, unknown> = {}) {
  return {
    localId: `op-${Math.random().toString(36).slice(2, 8)}`,
    operation: 'create',
    serverId: null,
    linkedLocalId: null,
    serverUpdatedAt: null,
    regionId: 1,
    encoderId: 'enc-1',
    payload: {
      general_category: 'STRUCTURAL',
      fire_station_name: 'Station 1',
      city_municipality: 'Manila',
      province_district: 'Metro Manila',
      incident_nonsensitive_details: {
        general_category: 'STRUCTURAL',
        fire_station_name: 'Station 1',
        city_municipality: 'Manila',
        province_district: 'Metro Manila',
      },
    },
    createdAt: Date.now() - 60000,
    syncStatus: 'pending',
    errorCode: null,
    errorMessage: null,
    serverVersion: null,
    retryCount: 0,
    lastAttemptAt: null,
    ...overrides,
  };
}

// ── Default mocks ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'enc-1', role: 'REGIONAL_ENCODER', assignedRegionId: 1 },
    role: 'REGIONAL_ENCODER',
    loading: false,
  } as never);
  vi.mocked(useNetworkStatus).mockReturnValue({ isOnline: true, isChecking: false, isReconnecting: false });
  vi.mocked(useAutoSync).mockReturnValue({ syncing: false, syncNow: vi.fn() } as never);
  vi.mocked(offlineStore.getDraftOps).mockResolvedValue([]);
  vi.mocked(offlineStore.getPendingOps).mockResolvedValue([]);
  vi.mocked(offlineStore.getConflictOps).mockResolvedValue([]);
  vi.mocked(offlineStore.getFailedOps).mockResolvedValue([]);
  vi.mocked(offlineStore.deleteOfflineOp).mockResolvedValue(undefined);
  vi.mocked(offlineStore.deleteOfflineOpCascade).mockResolvedValue(undefined);
  vi.mocked(syncEngine.syncPendingIncidents).mockResolvedValue({ synced: 0, failed: 0, conflicts: 0, errors: [] });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('OfflineWorkPage', () => {
  it('shows "all caught up" when all buckets are empty', async () => {
    render(<OfflineWorkPage />);

    await waitFor(() => {
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    });
  });

  it('shows summary cards with correct labels', async () => {
    vi.mocked(offlineStore.getDraftOps).mockResolvedValue([makeOp()]);
    vi.mocked(offlineStore.getPendingOps).mockResolvedValue([makeOp({ operation: 'update', serverId: 42 }), makeOp({ operation: 'update', serverId: 43 })]);
    vi.mocked(offlineStore.getConflictOps).mockResolvedValue([makeOp({ syncStatus: 'conflict', operation: 'update', serverId: 55 })]);
    vi.mocked(offlineStore.getFailedOps).mockResolvedValue([makeOp({ syncStatus: 'failed', operation: 'update', serverId: 66 })]);

    render(<OfflineWorkPage />);

    await waitFor(() => {
      expect(screen.getByText('Drafts')).toBeInTheDocument();
      expect(screen.getByText('Queued')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByText('Conflicts')).toBeInTheDocument();
    });
  });

  it('shows only non-empty tabs', async () => {
    vi.mocked(offlineStore.getDraftOps).mockResolvedValue([]);
    vi.mocked(offlineStore.getPendingOps).mockResolvedValue([makeOp({ operation: 'update', serverId: 42 })]);

    render(<OfflineWorkPage />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /queued/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('tab', { name: /drafts/i })).not.toBeInTheDocument();
  });

  it('conflict row links to /dashboard/regional/conflicts', async () => {
    vi.mocked(offlineStore.getConflictOps).mockResolvedValue([makeOp({ syncStatus: 'conflict', operation: 'update', serverId: 55 })]);

    render(<OfflineWorkPage />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /conflicts/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: /conflicts/i }));

    await waitFor(() => {
      const resolveLink = screen.getByRole('link', { name: /resolve/i });
      expect(resolveLink).toHaveAttribute('href', '/dashboard/regional/conflicts');
    });
  });

  it('redirects non-encoders', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'validator-1', role: 'NATIONAL_VALIDATOR' },
      role: 'NATIONAL_VALIDATOR',
      loading: false,
    } as never);

    render(<OfflineWorkPage />);

    await waitFor(() => {
      // The page calls useRouter().replace() on mount for non-encoders
      expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith('/dashboard/regional');
    });
  });

  it('shows confirm dialog and executes cancel for non-create ops', async () => {
    const op = makeOp({ operation: 'update', serverId: 42 });
    vi.mocked(offlineStore.getPendingOps).mockResolvedValue([op]);

    render(<OfflineWorkPage />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /queued/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: /queued/i }));

    await waitFor(() => {
      const cancelBtn = screen.getByRole('button', { name: /cancel update incident/i });
      fireEvent.click(cancelBtn);
    });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));

    await waitFor(() => {
      expect(offlineStore.deleteOfflineOp).toHaveBeenCalledWith(op.localId);
      expect(offlineStore.deleteOfflineOpCascade).not.toHaveBeenCalled();
    });
  });

  it('uses cascade delete for create ops', async () => {
    const op = makeOp({ operation: 'create' });
    vi.mocked(offlineStore.getPendingOps).mockResolvedValue([op]);

    render(<OfflineWorkPage />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /queued/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: /queued/i }));

    await waitFor(() => {
      const cancelBtn = screen.getByRole('button', { name: /cancel new incident/i });
      fireEvent.click(cancelBtn);
    });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));

    await waitFor(() => {
      expect(offlineStore.deleteOfflineOpCascade).toHaveBeenCalledWith(op.localId);
      expect(offlineStore.deleteOfflineOp).not.toHaveBeenCalled();
    });
  });

  it('retries failed operations', async () => {
    const op = makeOp({ syncStatus: 'failed', operation: 'update', serverId: 42 });
    vi.mocked(offlineStore.getFailedOps).mockResolvedValue([op]);

    render(<OfflineWorkPage />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /failed/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: /failed/i }));

    await waitFor(() => {
      const retryBtn = screen.getByRole('button', { name: /retry update incident/i });
      fireEvent.click(retryBtn);
    });

    await waitFor(() => {
      expect(syncEngine.syncPendingIncidents).toHaveBeenCalledWith('enc-1', { bypassBackoff: true });
    });
  });
});
