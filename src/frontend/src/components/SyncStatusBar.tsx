/**
 * SyncStatusBar — sync status UI component (FR-3E).
 *
 * Displays: pending count, sync spinner, last synced time,
 * offline/reconnecting indicator, manual sync button.
 * When session has expired with pending ops, shows a persistent
 * "Log In to sync" call-to-action instead of silently failing.
 */

'use client';

import Link from 'next/link';
import { useAutoSync } from '@/lib/useAutoSync';
import { useNetworkStatus } from '@/lib/useNetworkStatus';

export function SyncStatusBar() {
  const { syncing, lastSyncedAt, pendingCount, conflictCount, failedCount, authFailed, syncNow, syncProgress } = useAutoSync();
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
    const showProgress = syncProgress && syncProgress.total > 0;
    return (
      <div
        className="flex flex-col gap-1 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-800"
        role="status"
      >
        <div className="flex items-center gap-2">
          <span
            data-testid="sync-spinner"
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700"
          />
          {showProgress ? (
            <span data-testid="sync-progress-text">
              Syncing {syncProgress!.done} of {syncProgress!.total}...
            </span>
          ) : (
            <span>Syncing {pendingCount} incident{pendingCount !== 1 ? 's' : ''}...</span>
          )}
        </div>
        {showProgress && (
          <div
            data-testid="sync-progress-bar"
            className="h-1.5 w-full overflow-hidden rounded-full bg-blue-200"
            role="progressbar"
            aria-valuenow={syncProgress!.done}
            aria-valuemin={0}
            aria-valuemax={syncProgress!.total}
            aria-label={`Syncing ${syncProgress!.done} of ${syncProgress!.total}`}
          >
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300 ease-out"
              style={{ width: `${(syncProgress!.done / syncProgress!.total) * 100}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  // Show conflict and failed callouts independently — both can be present.
  if (conflictCount > 0 || failedCount > 0) {
    return (
      <div className="flex flex-col gap-2" role="alert">
        {conflictCount > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-800">
            <span className="inline-block h-2 w-2 rounded-full bg-orange-500" />
            <span>{conflictCount} item{conflictCount !== 1 ? 's' : ''} need your attention</span>
            {pendingCount > 0 && (
              <span className="text-xs text-orange-600">
                ({pendingCount} queued)
              </span>
            )}
            <a
              href="/dashboard/regional/conflicts"
              className="ml-auto w-full sm:w-auto rounded-md bg-orange-600 px-3 py-1 text-xs font-medium text-white hover:bg-orange-700 text-center min-h-[44px] flex items-center justify-center"
            >
              Review
            </a>
          </div>
        )}

        {failedCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            <span>{failedCount} item{failedCount !== 1 ? 's' : ''} failed to sync</span>
            {pendingCount > 0 && (
              <span className="text-xs text-red-600">
                ({pendingCount} queued)
              </span>
            )}
            <button
              onClick={syncNow}
              disabled={syncing}
              className="ml-auto w-full sm:w-auto rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-center min-h-[44px] flex items-center justify-center"
            >
              Retry All
            </button>
            <Link
              href="/dashboard/regional/offline-work"
              className="text-xs text-red-600 underline hover:text-red-800 min-h-[44px] flex items-center"
            >
              Details
            </Link>
          </div>
        )}
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

  // Pending items, online, not syncing, no conflicts or failures
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
