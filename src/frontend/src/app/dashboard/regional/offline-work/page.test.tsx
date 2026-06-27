/**
 * OfflineWorkPage tests — covers section tabs, counts, empty states,
 * and conflict links.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuth } from '@/context/AuthContext';
import { useAutoSync } from '@/lib/useAutoSync';
import * as offlineStore from '@/lib/offlineStore';
import * as syncEngine from '@/lib/syncEngine';
import * as offlineOpActions from '@/lib/offlineOpActions';
import OfflineWorkPage from './page';

// ── Mocks ──

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/useAutoSync', () => ({
  useAutoSync: vi.fn(),
}));

vi.mock('@/lib/offlineStore', () => ({
  getDraftOps: vi.fn(),
  getPendingOps: vi.fn(),
  getConflictOps: vi.fn(),
  getFailedOps: vi.fn(),
}));

vi.mock('@/lib/syncEngine', () => ({
  syncPendingIncidents: vi.fn(),
}));

vi.mock('@/lib/offlineOpActions', () => ({
  cancelOfflineOperation: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

const ENCODER_ID = 'test-encoder-1';

function makeOp(overrides: Partial<ReturnType<typeof offlineStore.getDraftOps> extends Promise<infer T> ? T[number] : never> = {}) {
  return {
    localId: `local-${Math.random().toString(36).slice(2, 8)}`,
    operation: 'create' as const,
    serverId: null,
    linkedLocalId: null,
    serverUpdatedAt: null,
    regionId: 1,
    encoderId: ENCODER_ID,
    payload: {
      incident_nonsensitive_details: {
        general_category: 'STRUCTURAL',
        city_municipality: 'Quezon City',
      },
      incident_sensitive_details: {
        street_address: '123 Rizal Ave',
      },
    },
    createdAt: Date.now(),
    syncStatus: 'pending' as const,
    errorCode: null as string | null,
    errorMessage: null as string | null,
    serverVersion: null,
    retryCount: 0,
    lastAttemptAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    user: { id: ENCODER_ID, role: 'REGIONAL_ENCODER' },
    loading: false,
  });

  (useAutoSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    syncing: false,
    pendingCount: 0,
    conflictCount: 0,
    failedCount: 0,
    lastSyncedAt: null,
    authFailed: false,
    syncNow: vi.fn(),
  });
});

// ── Tests ──

describe('OfflineWorkPage', () => {
  it('redirects non-encoders to dashboard', async () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { id: 'other', role: 'NATIONAL_VALIDATOR' },
      loading: false,
    });
    (offlineStore.getDraftOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getPendingOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getConflictOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getFailedOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<OfflineWorkPage />);
    await waitFor(() => {
      // Non-encoder renders null after the redirect effect
      expect(container.innerHTML).toBe('');
    });
  });

  it('renders all four section tabs with zero counts', async () => {
    (offlineStore.getDraftOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getPendingOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getConflictOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getFailedOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<OfflineWorkPage />);

    await waitFor(() => {
      expect(screen.getByText('Drafts')).toBeInTheDocument();
      expect(screen.getByText('Queued')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByText('Conflicts')).toBeInTheDocument();
    });

    // Active section should be Drafts by default — shows empty state
    await waitFor(() => {
      expect(screen.getByText(/No drafts to show/)).toBeInTheDocument();
    });
  });

  it('shows counts in section tabs', async () => {
    (offlineStore.getDraftOps as ReturnType<typeof vi.fn>).mockResolvedValue([makeOp()]);
    (offlineStore.getPendingOps as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeOp({ operation: 'update', serverId: 42, syncStatus: 'pending' }),
      makeOp({ operation: 'submit', serverId: 42, syncStatus: 'pending' }),
    ]);
    (offlineStore.getConflictOps as ReturnType<typeof vi.fn>).mockResolvedValue([makeOp({ syncStatus: 'conflict', serverId: 43 })]);
    (offlineStore.getFailedOps as ReturnType<typeof vi.fn>).mockResolvedValue([makeOp({ syncStatus: 'failed', serverId: 44 })]);

    render(<OfflineWorkPage />);

    await waitFor(() => {
      // Each tab button should show its count badge
      const draftsTab = screen.getByRole('tab', { name: /Drafts/i });
      expect(within(draftsTab).getByText('1')).toBeInTheDocument();

      const queuedTab = screen.getByRole('tab', { name: /Queued/i });
      expect(within(queuedTab).getByText('2')).toBeInTheDocument();

      const failedTab = screen.getByRole('tab', { name: /Failed/i });
      expect(within(failedTab).getByText('1')).toBeInTheDocument();

      const conflictsTab = screen.getByRole('tab', { name: /Conflicts/i });
      expect(within(conflictsTab).getByText('1')).toBeInTheDocument();
    });
  });

  it('renders empty states for each section', async () => {
    (offlineStore.getDraftOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getPendingOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getConflictOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getFailedOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<OfflineWorkPage />);

    await waitFor(() => {
      expect(screen.getByText(/No drafts to show/)).toBeInTheDocument();
    });

    // Switch to Queued tab
    await userEvent.click(screen.getByRole('tab', { name: /Queued/i }));
    await waitFor(() => {
      expect(screen.getByText(/No queued to show/)).toBeInTheDocument();
    });

    // Switch to Failed tab
    await userEvent.click(screen.getByRole('tab', { name: /Failed/i }));
    await waitFor(() => {
      expect(screen.getByText(/No failed to show/)).toBeInTheDocument();
    });

    // Switch to Conflicts tab
    await userEvent.click(screen.getByRole('tab', { name: /Conflicts/i }));
    await waitFor(() => {
      expect(screen.getByText(/No conflicts to show/)).toBeInTheDocument();
    });
  });

  it('shows conflict operations and links to conflicts page', async () => {
    (offlineStore.getDraftOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getPendingOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getConflictOps as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeOp({
        operation: 'update',
        serverId: 55,
        syncStatus: 'conflict',
      }),
    ]);
    (offlineStore.getFailedOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<OfflineWorkPage />);

    // Click Conflicts tab
    await userEvent.click(screen.getByRole('tab', { name: /Conflicts/i }));

    await waitFor(() => {
      // The Resolve link should exist and point to /dashboard/regional/conflicts
      const resolveLink = screen.getByRole('link', { name: /Resolve/i });
      expect(resolveLink).toBeInTheDocument();
      expect(resolveLink).toHaveAttribute('href', '/dashboard/regional/conflicts');
    });
  });

  it('shows a draft create op, queued update, and failed op', async () => {
    (offlineStore.getDraftOps as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeOp({ syncStatus: 'draft' }),
    ]);
    (offlineStore.getPendingOps as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeOp({
        operation: 'update',
        serverId: 42,
        syncStatus: 'pending',
      }),
    ]);
    (offlineStore.getConflictOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getFailedOps as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeOp({
        operation: 'submit',
        serverId: 99,
        syncStatus: 'failed',
        errorMessage: 'Server rejected',
        retryCount: 5,
      }),
    ]);

    render(<OfflineWorkPage />);

    // Draft section: shows "Open Draft" link for create ops
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Open Draft/i })).toBeInTheDocument();
    });

    // Switch to Queued tab
    await userEvent.click(screen.getByRole('tab', { name: /Queued/i }));
    await waitFor(() => {
      expect(screen.getByText(/Update incident/)).toBeInTheDocument();
    });

    // Switch to Failed tab
    await userEvent.click(screen.getByRole('tab', { name: /Failed/i }));
    await waitFor(() => {
      expect(screen.getByText(/Submit for review/)).toBeInTheDocument();
      expect(screen.getByText(/Error:/)).toBeInTheDocument();
      expect(screen.getByText(/Server rejected/)).toBeInTheDocument();
      expect(screen.getByText(/Retry #5/)).toBeInTheDocument();
    });

    // Failed section has a "Retry All" button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Retry All/i })).toBeInTheDocument();
    });
  });

  it('queued section shows Sync Now button and retries', async () => {
    (offlineStore.getDraftOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getPendingOps as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeOp({ operation: 'create', syncStatus: 'pending' }),
    ]);
    (offlineStore.getConflictOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getFailedOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (syncEngine.syncPendingIncidents as ReturnType<typeof vi.fn>).mockResolvedValue({
      synced: 1,
      conflicts: 0,
      failed: 0,
      errors: [],
    });

    render(<OfflineWorkPage />);

    await userEvent.click(screen.getByRole('tab', { name: /Queued/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Sync Now/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /Sync Now/i }));
    await waitFor(() => {
      expect(syncEngine.syncPendingIncidents).toHaveBeenCalledWith(ENCODER_ID, { bypassBackoff: true });
    });
  });

  it('shows cancel button for queued ops and confirms before cancelling', async () => {
    (offlineStore.getDraftOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getPendingOps as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeOp({ operation: 'update', serverId: 42, syncStatus: 'pending' }),
    ]);
    (offlineStore.getConflictOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getFailedOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineOpActions.cancelOfflineOperation as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(<OfflineWorkPage />);

    // Switch to Queued tab
    await userEvent.click(screen.getByRole('tab', { name: /Queued/i }));
    await waitFor(() => {
      expect(screen.getByText(/Update incident/)).toBeInTheDocument();
    });

    // Cancel button should be visible
    const cancelBtn = screen.getByRole('button', { name: /Cancel Update incident/i });
    expect(cancelBtn).toBeInTheDocument();
    expect(cancelBtn).not.toBeDisabled();

    // Click cancel — confirmation dialog should appear
    await userEvent.click(cancelBtn);
    await waitFor(() => {
      expect(screen.getByText(/Cancel Update incident\?/)).toBeInTheDocument();
      expect(screen.getByText(/permanently delete/)).toBeInTheDocument();
    });

    // Confirm cancellation
    await userEvent.click(screen.getByRole('button', { name: /Yes, Cancel/i }));
    await waitFor(() => {
      expect(offlineOpActions.cancelOfflineOperation).toHaveBeenCalledWith(
        expect.objectContaining({ localId: expect.any(String), operation: 'update' }),
      );
    });
  });

  it('shows cancel button for failed ops', async () => {
    (offlineStore.getDraftOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getPendingOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getConflictOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getFailedOps as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeOp({ operation: 'submit', serverId: 99, syncStatus: 'failed', errorMessage: 'Timeout' }),
    ]);
    (offlineOpActions.cancelOfflineOperation as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(<OfflineWorkPage />);

    await userEvent.click(screen.getByRole('tab', { name: /Failed/i }));

    // Wait for the cancel button to appear (operation matches 'submit')
    const cancelBtn = await screen.findByRole('button', { name: /Cancel Submit for review/i });
    expect(cancelBtn).toBeInTheDocument();
    expect(cancelBtn).not.toBeDisabled();

    // Click cancel to show confirmation
    await userEvent.click(cancelBtn);

    // After clicking cancel, the confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    // Dialog should mention the operation
    expect(screen.getByText(/Cancel Submit for review\?/)).toBeInTheDocument();
    // Confirmation should show failed-specific messaging (unique to dialog only)
    expect(screen.getByText(/will not retry automatically/)).toBeInTheDocument();
  });

  it('disables cancel buttons when syncing is active', async () => {
    (useAutoSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      syncing: true,
      pendingCount: 1,
      conflictCount: 0,
      failedCount: 0,
      lastSyncedAt: null,
      authFailed: false,
      syncNow: vi.fn(),
    });

    (offlineStore.getDraftOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getPendingOps as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeOp({ operation: 'update', serverId: 42, syncStatus: 'pending' }),
    ]);
    (offlineStore.getConflictOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getFailedOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<OfflineWorkPage />);

    await userEvent.click(screen.getByRole('tab', { name: /Queued/i }));
    await waitFor(() => {
      const cancelBtn = screen.getByRole('button', { name: /Cancel Update incident/i });
      expect(cancelBtn).toBeDisabled();
    });
  });

  it('does not show cancel button for conflicts section', async () => {
    (offlineStore.getDraftOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getPendingOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getConflictOps as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeOp({ operation: 'update', serverId: 55, syncStatus: 'conflict' }),
    ]);
    (offlineStore.getFailedOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<OfflineWorkPage />);

    await userEvent.click(screen.getByRole('tab', { name: /Conflicts/i }));
    await waitFor(() => {
      // The Resolve link should be present
      expect(screen.getByRole('link', { name: /Resolve/i })).toBeInTheDocument();
      // No cancel button for conflicts
      expect(screen.queryByRole('button', { name: /Cancel/i })).not.toBeInTheDocument();
    });
  });

  it('shows back link to dashboard', async () => {
    (offlineStore.getDraftOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getPendingOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getConflictOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (offlineStore.getFailedOps as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<OfflineWorkPage />);

    await waitFor(() => {
      const backLink = screen.getByRole('link', { name: /Back to Dashboard/i });
      expect(backLink).toBeInTheDocument();
      expect(backLink).toHaveAttribute('href', '/dashboard/regional');
    });
  });
});
