/**
 * syncEngine — core sync logic (FR-3B) + conflict resolution (FR-3F).
 *
 * Reads pending items from IndexedDB, POSTs each to the API,
 * and marks successful items as synced. Handles partial failures,
 * network errors, and 409 Conflict with last-write-wins resolution.
 */

import { getPendingIncidents, markSynced } from './offlineStore';

const SYNC_ENDPOINT = '/api/v1/public/report';

export interface SyncError {
  id: number;
  status?: number;
  error?: string;
}

export interface SyncResult {
  synced: number;
  failed: number;
  errors: SyncError[];
}

interface PendingItem {
  id: number;
  payload: Record<string, unknown>;
  createdAt: number;
  status: 'pending' | 'synced';
}

/**
 * Attempt to sync a single pending item to the server.
 * Returns true if synced successfully, false otherwise.
 */
async function syncItem(item: PendingItem): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const response = await fetch(SYNC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item.payload),
    });

    if (response.ok) {
      return { ok: true };
    }

    // 409 Conflict — attempt last-write-wins resolution
    if (response.status === 409) {
      return handleConflict(item, response);
    }

    const data = await response.json().catch(() => ({}));
    return {
      ok: false,
      status: response.status,
      error: data.detail || `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Handle 409 Conflict with last-write-wins (LWW) resolution.
 *
 * If server_updated_at is newer than local createdAt → server wins (keep pending, no retry).
 * If local createdAt is newer → re-POST local data to force overwrite.
 */
async function handleConflict(
  item: PendingItem,
  response: Response
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const conflictData = await response.json().catch(() => ({}));
  const serverUpdatedAt = conflictData.server_updated_at;

  if (serverUpdatedAt) {
    const serverTime = new Date(serverUpdatedAt).getTime();
    if (serverTime > item.createdAt) {
      // Server is newer — server wins, keep pending
      return {
        ok: false,
        status: 409,
        error: 'Conflict: server version is newer',
      };
    }
  }

  // Local is newer or timestamps incomparable — force overwrite
  try {
    const retryResponse = await fetch(SYNC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Conflict-Resolution': 'overwrite',
      },
      body: JSON.stringify(item.payload),
    });

    if (retryResponse.ok) {
      return { ok: true };
    }

    return {
      ok: false,
      status: retryResponse.status,
      error: 'Conflict resolution retry failed',
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Conflict resolution network error',
    };
  }
}

/**
 * Sync all pending incidents to the server.
 *
 * Processes items sequentially to avoid overwhelming the API.
 * Partial failures do not block other items.
 */
export async function syncPendingIncidents(): Promise<SyncResult> {
  const pending = await getPendingIncidents();

  if (pending.length === 0) {
    return { synced: 0, failed: 0, errors: [] };
  }

  let synced = 0;
  let failed = 0;
  const errors: SyncError[] = [];

  for (const item of pending) {
    const result = await syncItem(item);

    if (result.ok) {
      await markSynced(item.id);
      synced++;
    } else {
      failed++;
      errors.push({
        id: item.id,
        status: result.status,
        error: result.error,
      });
    }
  }

  return { synced, failed, errors };
}
