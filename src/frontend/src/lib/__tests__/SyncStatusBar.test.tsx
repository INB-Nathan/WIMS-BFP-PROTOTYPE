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
      syncNow: vi.fn(),
    });

    render(<SyncStatusBar />);

    expect(screen.getByText(/all synced/i)).toBeInTheDocument();
  });

  it('shows pending count when items are queued', () => {
    mockUseAutoSync.mockReturnValue({
      syncing: false,
      lastSyncedAt: null,
      pendingCount: 3,
      syncNow: vi.fn(),
    });

    render(<SyncStatusBar />);

    expect(screen.getByText(/3.*queued/i)).toBeInTheDocument();
  });

  it('shows spinner during active sync', () => {
    mockUseAutoSync.mockReturnValue({
      syncing: true,
      lastSyncedAt: null,
      pendingCount: 2,
      syncNow: vi.fn(),
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
      syncNow: vi.fn(),
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
      syncNow: syncNowMock,
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
      syncNow: vi.fn(),
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
      syncNow: vi.fn(),
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
      syncNow: vi.fn(),
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
      syncNow: vi.fn(),
    });

    render(<SyncStatusBar />);

    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
  });
});
