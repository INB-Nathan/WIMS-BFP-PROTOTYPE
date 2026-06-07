/**
 * SyncStatusBar — sync status UI component (FR-3E).
 *
 * Displays: pending count, sync spinner, last synced time,
 * offline/reconnecting indicator, manual sync button.
 * When session has expired with pending ops, shows a persistent
 * "Log In to sync" call-to-action instead of silently failing.
 */

'use client';

import { useAutoSync } from '@/lib/useAutoSync';
import { useNetworkStatus } from '@/lib/useNetworkStatus';

export function SyncStatusBar() {
  const { syncing, lastSyncedAt, pendingCount, conflictCount, authFailed, syncNow } = useAutoSync();
  const { isOnline, isChecking, isReconnecting } = useNetworkStatus();

  if (isChecking) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"
        role="status"
      >
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-slate-500" />
        <span>Checking connection...</span>
        {pendingCount > 0 && (
          <span className="ml-auto font-medium">{pendingCount} queued</span>
        )}
      </div>
    );
  }

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

  // Session expired with queued incidents — most prominent state
  if (authFailed && pendingCount > 0) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
        role="alert"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
        <span>
          Session expired — {pendingCount} incident{pendingCount !== 1 ? 's' : ''} waiting to sync
        </span>
        <a
          href="/login"
          className="ml-auto rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
        >
          Log In to Sync
        </a>
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

  // All synced — but show conflict callout if any ops need resolution
  if (pendingCount === 0) {
    if (conflictCount > 0) {
      return (
        <div
          className="flex items-center gap-2 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-800"
          role="alert"
        >
          <span className="inline-block h-2 w-2 rounded-full bg-orange-500" />
          <span>{conflictCount} item{conflictCount !== 1 ? 's' : ''} need your attention</span>
          <a
            href="/dashboard/regional?tab=conflicts"
            className="ml-auto rounded-md bg-orange-600 px-3 py-1 text-xs font-medium text-white hover:bg-orange-700"
          >
            Review
          </a>
        </div>
      );
    }
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
