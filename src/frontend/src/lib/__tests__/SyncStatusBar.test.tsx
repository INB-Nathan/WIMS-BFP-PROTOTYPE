/**
 * SyncStatusBar tests — sync status UI (3E).
 *
 * Expected behavior:
 * - Shows pending count badge ("N incidents queued")
 * - Shows spinner during active sync
 * - Shows "Last synced" timestamp after successful sync
 * - "Sync Now" button calls syncNow()
 * - Shows error state for failed items
 * - Shows offline indicator when isOnline=false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SyncStatusBar } from '../../components/SyncStatusBar';

// Mock useAutoSync
const mockUseAutoSync = vi.fn();
vi.mock('../useAutoSync', () => ({
  useAutoSync: () => mockUseAutoSync(),
}));

// Mock useNetworkStatus
const mockUseNetworkStatus = vi.fn();
vi.mock('../useNetworkStatus', () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockUseNetworkStatus.mockReturnValue({ isOnline: true, isReconnecting: false });
});

describe('SyncStatusBar', () => {
  it('shows "All synced" when pendingCount=0 and not syncing', () => {
    mockUseAutoSync.mockReturnValue({
      syncing: false,
      lastSyncedAt: new Date('2026-04-12T10:00:00Z'),
      pendingCount: 0,
      conflictCount: 0,
      failedCount: 0,
      syncNow: vi.fn(),
      syncProgress: null,
    });

    render(<SyncStatusBar />);

    expect(screen.getByText(/all synced/i)).toBeInTheDocument();
  });

  it('shows pending count when items are queued (no conflicts or failures)', () => {
    mockUseAutoSync.mockReturnValue({
      syncing: false,
      lastSyncedAt: null,
      pendingCount: 3,
      conflictCount: 0,
      failedCount: 0,
      syncNow: vi.fn(),
      syncProgress: null,
    });

    render(<SyncStatusBar />);

    expect(screen.getByText(/3.*queued/i)).toBeInTheDocument();
  });

  it('shows spinner during active sync', () => {
    mockUseAutoSync.mockReturnValue({
      syncing: true,
      lastSyncedAt: null,
      pendingCount: 2,
      conflictCount: 0,
      failedCount: 0,
      syncNow: vi.fn(),
      syncProgress: null,
    });

    render(<SyncStatusBar />);

    expect(screen.getByText(/syncing/i)).toBeInTheDocument();
    // Spinner element should exist
    expect(screen.getByTestId('sync-spinner')).toBeInTheDocument();
  });

  it('shows last synced timestamp after successful sync', () => {
    mockUseAutoSync.mockReturnValue({
      syncing: false,
      lastSyncedAt: new Date('2026-04-12T14:30:00Z'),
      pendingCount: 0,
      conflictCount: 0,
      failedCount: 0,
      syncNow: vi.fn(),
      syncProgress: null,
    });

    render(<SyncStatusBar />);

    expect(screen.getByText(/last synced/i)).toBeInTheDocument();
  });

  it('calls syncNow() when "Sync Now" button is clicked', () => {
    const syncNowMock = vi.fn();
    mockUseAutoSync.mockReturnValue({
      syncing: false,
      lastSyncedAt: null,
      pendingCount: 5,
      conflictCount: 0,
      failedCount: 0,
      syncNow: syncNowMock,
      syncProgress: null,
    });

    render(<SyncStatusBar />);

    const button = screen.getByRole('button', { name: /sync now/i });
    fireEvent.click(button);

    expect(syncNowMock).toHaveBeenCalledTimes(1);
  });

  it('hides Sync Now button while syncing', () => {
    mockUseAutoSync.mockReturnValue({
      syncing: true,
      lastSyncedAt: null,
      pendingCount: 2,
      conflictCount: 0,
      failedCount: 0,
      syncNow: vi.fn(),
      syncProgress: null,
    });

    render(<SyncStatusBar />);

    // During active sync, the Sync Now button is replaced by spinner + "Syncing..."
    expect(screen.queryByRole('button', { name: /sync now/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('sync-spinner')).toBeInTheDocument();
  });

  it('shows offline indicator when isOnline=false', () => {
    mockUseNetworkStatus.mockReturnValue({ isOnline: false, isReconnecting: false });
    mockUseAutoSync.mockReturnValue({
      syncing: false,
      lastSyncedAt: null,
      pendingCount: 1,
      conflictCount: 0,
      failedCount: 0,
      syncNow: vi.fn(),
      syncProgress: null,
    });

    render(<SyncStatusBar />);

    expect(screen.getByText(/offline/i)).toBeInTheDocument();
  });

  it('hides Sync Now button when offline', () => {
    mockUseNetworkStatus.mockReturnValue({ isOnline: false, isReconnecting: false });
    mockUseAutoSync.mockReturnValue({
      syncing: false,
      lastSyncedAt: null,
      pendingCount: 1,
      conflictCount: 0,
      failedCount: 0,
      syncNow: vi.fn(),
      syncProgress: null,
    });

    render(<SyncStatusBar />);

    expect(screen.queryByRole('button', { name: /sync now/i })).not.toBeInTheDocument();
  });

  it('shows reconnecting state', () => {
    mockUseNetworkStatus.mockReturnValue({ isOnline: true, isReconnecting: true });
    mockUseAutoSync.mockReturnValue({
      syncing: false,
      lastSyncedAt: null,
      pendingCount: 3,
      conflictCount: 0,
      failedCount: 0,
      syncNow: vi.fn(),
      syncProgress: null,
    });

    render(<SyncStatusBar />);

    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
  });

  it('shows conflict callout when conflictCount > 0 even when pendingCount > 0', () => {
    mockUseAutoSync.mockReturnValue({
      syncing: false,
      lastSyncedAt: null,
      pendingCount: 2,
      conflictCount: 1,
      failedCount: 0,
      syncNow: vi.fn(),
      syncProgress: null,
    });

    render(<SyncStatusBar />);

    expect(screen.getByText(/1 item.*need your attention/i)).toBeInTheDocument();
    // Conflict callout shows pending count in subtext
    expect(screen.getByText(/2 queued/i)).toBeInTheDocument();
    // Review link should exist
    expect(screen.getByRole('link', { name: /review/i })).toHaveAttribute('href', '/dashboard/regional/conflicts');
  });

  it('shows conflict callout when conflictCount > 0 with pending=0', () => {
    mockUseAutoSync.mockReturnValue({
      syncing: false,
      lastSyncedAt: null,
      pendingCount: 0,
      conflictCount: 2,
      failedCount: 0,
      syncNow: vi.fn(),
      syncProgress: null,
    });

    render(<SyncStatusBar />);

    expect(screen.getByText(/2 items.*need your attention/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /review/i })).toHaveAttribute('href', '/dashboard/regional/conflicts');
  });

  it('shows failed callout when failedCount > 0', () => {
    mockUseAutoSync.mockReturnValue({
      syncing: false,
      lastSyncedAt: null,
      pendingCount: 3,
      conflictCount: 0,
      failedCount: 1,
      syncNow: vi.fn(),
      syncProgress: null,
    });

    render(<SyncStatusBar />);

    expect(screen.getByText(/1 item.*failed to sync/i)).toBeInTheDocument();
    expect(screen.getByText(/3 queued/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry all/i })).toBeInTheDocument();
  });

  it('shows failed callout before normal pending bar when both present', () => {
    mockUseAutoSync.mockReturnValue({
      syncing: false,
      lastSyncedAt: null,
      pendingCount: 5,
      conflictCount: 0,
      failedCount: 2,
      syncNow: vi.fn(),
      syncProgress: null,
    });

    render(<SyncStatusBar />);

    // Failed callout takes priority over normal queued bar
    expect(screen.getByText(/2 items.*failed to sync/i)).toBeInTheDocument();
    // The normal queued bar has a Sync Now button — should not appear
    expect(screen.queryByRole('button', { name: /sync now/i })).not.toBeInTheDocument();
    // Retry All button replaces Sync Now in the failed callout
    expect(screen.getByRole('button', { name: /retry all/i })).toBeInTheDocument();
  });

  it('prioritises conflict over failed when both present', () => {
    mockUseAutoSync.mockReturnValue({
      syncing: false,
      lastSyncedAt: null,
      pendingCount: 1,
      conflictCount: 3,
      failedCount: 2,
      syncNow: vi.fn(),
      syncProgress: null,
    });

    render(<SyncStatusBar />);

    // Conflict takes priority because the check comes first
    expect(screen.getByText(/3 items.*need your attention/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /review/i })).toBeInTheDocument();
  });

  it('shows determinate progress during active sync when syncProgress.total > 0', () => {
    mockUseAutoSync.mockReturnValue({
      syncing: true,
      lastSyncedAt: null,
      pendingCount: 5,
      conflictCount: 0,
      failedCount: 0,
      syncNow: vi.fn(),
      syncProgress: { done: 2, total: 5 },
    });

    render(<SyncStatusBar />);

    expect(screen.getByText(/syncing 2 of 5/i)).toBeInTheDocument();
    expect(screen.getByTestId('sync-progress-bar')).toBeInTheDocument();
    expect(screen.getByTestId('sync-progress-text')).toBeInTheDocument();
  });

  it('falls back to pendingCount text when syncing without progress', () => {
    mockUseAutoSync.mockReturnValue({
      syncing: true,
      lastSyncedAt: null,
      pendingCount: 5,
      conflictCount: 0,
      failedCount: 0,
      syncNow: vi.fn(),
      syncProgress: null,
    });

    render(<SyncStatusBar />);

    // Should show the fallback text when no progress is available
    expect(screen.getByText(/syncing 5 incidents/i)).toBeInTheDocument();
    expect(screen.queryByTestId('sync-progress-bar')).not.toBeInTheDocument();
  });
});
