/**
 * SyncStatusBar — sync status UI component (FR-3E).
 *
 * Displays: pending count, sync spinner, last synced time,
 * offline/reconnecting indicator, manual sync button.
 */

'use client';

import { useAutoSync } from '@/lib/useAutoSync';
import { useNetworkStatus } from '@/lib/useNetworkStatus';

export function SyncStatusBar() {
  const { syncing, lastSyncedAt, pendingCount, syncNow } = useAutoSync();
  const { isOnline, isReconnecting } = useNetworkStatus();

  // Offline state
  if (!isOnline) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        role="status"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
        <span>Offline</span>
        {pendingCount > 0 && (
          <span className="ml-auto font-medium">{pendingCount} incident{pendingCount !== 1 ? 's' : ''} queued</span>
        )}
      </div>
    );
  }

  // Reconnecting state
  if (isReconnecting) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-800"
        role="status"
      >
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
        <span>Reconnecting...</span>
        {pendingCount > 0 && (
          <span className="ml-auto font-medium">{pendingCount} queued</span>
        )}
      </div>
    );
  }

  // Actively syncing
  if (syncing) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-800"
        role="status"
      >
        <span
          data-testid="sync-spinner"
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700"
        />
        <span>Syncing {pendingCount} incident{pendingCount !== 1 ? 's' : ''}...</span>
      </div>
    );
  }

  // All synced
  if (pendingCount === 0) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800"
        role="status"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
        <span>All synced</span>
        {lastSyncedAt && (
          <span className="ml-auto text-xs text-green-600">
            Last synced {formatTime(lastSyncedAt)}
          </span>
        )}
      </div>
    );
  }

  // Pending items, online, not syncing
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700"
      role="status"
    >
      <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
      <span>{pendingCount} incident{pendingCount !== 1 ? 's' : ''} queued</span>
      {lastSyncedAt && (
        <span className="text-xs text-gray-500">
          Last synced {formatTime(lastSyncedAt)}
        </span>
      )}
      <button
        onClick={syncNow}
        disabled={syncing}
        className="ml-auto rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Sync Now
      </button>
    </div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
