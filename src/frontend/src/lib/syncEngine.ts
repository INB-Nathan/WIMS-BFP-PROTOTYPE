/**
 * syncEngine — core sync logic (FR-3B) + conflict resolution (FR-3F).
 *
 * Reads pending items from IndexedDB, dispatches each to the correct API
 * endpoint based on opType, and marks successful items as synced.
 * Handles partial failures, network errors (batch abort), and 409 Conflict
 * with last-write-wins resolution for create ops.
 *
 * Supported opTypes:
 *  - create (default/legacy) → POST /api/v1/public/report
 *  - verify               → PATCH /api/regional/incidents/{id}/verification
 *  - archive_action       → PATCH /api/regional/validator/incidents/{id}/archive|unarchive
 */

import {
  getPendingIncidents,
  markSynced,
  type ArchiveActionPayload,
  type OfflineOpType,
  type VerifyPayload,
} from './offlineStore';
import { apiFetch, ApiRequestError } from './api';

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
  opType?: OfflineOpType;
  localId?: string;
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
 * Process a verify op: PATCH /api/regional/incidents/{id}/verification
 * with cookie-based auth (apiFetch).
 *
 * Body includes client_id from localId for server-side idempotency (#267).
 * 409 DUPLICATE_DETECTED keeps the op pending (conflict, don't overwrite).
 */
async function processVerify(item: PendingItem): Promise<{ ok: boolean; status?: number; error?: string }> {
  const payload = item.payload as unknown as VerifyPayload;
  try {
    await apiFetch(`/api/regional/incidents/${payload.incident_id}/verification`, {
      method: 'PATCH',
      body: JSON.stringify({
        action: payload.action,
        notes: payload.notes ?? null,
        client_id: item.localId ?? null,
        ...(payload.original_incident_id !== undefined
          ? { original_incident_id: payload.original_incident_id }
          : {}),
      }),
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiRequestError) {
      // 409 DUPLICATE_DETECTED — keep pending, don't overwrite
      if (err.status === 409) {
        return { ok: false, status: 409, error: 'Conflict: DUPLICATE_DETECTED' };
      }
      return { ok: false, status: err.status, error: err.message };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Process an archive_action op: PATCH /api/regional/validator/incidents/{id}/archive
 * or /unarchive with cookie-based auth (apiFetch).
 *
 * Body includes client_id from localId for server-side idempotency (#267).
 */
async function processArchiveAction(item: PendingItem): Promise<{ ok: boolean; status?: number; error?: string }> {
  const payload = item.payload as unknown as ArchiveActionPayload;
  const endpoint = payload.action === 'archive'
    ? `/api/regional/validator/incidents/${payload.incident_id}/archive`
    : `/api/regional/validator/incidents/${payload.incident_id}/unarchive`;
  try {
    await apiFetch(endpoint, {
      method: 'PATCH',
      body: JSON.stringify({ client_id: item.localId ?? null }),
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiRequestError) {
      // 409 DUPLICATE_DETECTED — keep pending, don't overwrite
      if (err.status === 409) {
        return { ok: false, status: 409, error: 'Conflict: DUPLICATE_DETECTED' };
      }
      return { ok: false, status: err.status, error: err.message };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Sync all pending incidents to the server.
 *
 * Processes items sequentially to avoid overwhelming the API.
 * Dispatches to the correct endpoint based on opType:
 *   - verify → processVerify (PATCH /regional/incidents/{id}/verification)
 *   - archive_action → processArchiveAction (PATCH .../archive or /unarchive)
 *   - default/create → syncItem (POST /api/v1/public/report, legacy)
 *
 * HTTP failures (4xx/5xx) keep the item pending and continue.
 * Network errors (no HTTP status) abort the remaining batch to
 * preserve ordering and avoid cascading timeouts.
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
    let result: { ok: boolean; status?: number; error?: string };

    switch (item.opType) {
      case 'verify':
        result = await processVerify(item);
        break;
      case 'archive_action':
        result = await processArchiveAction(item);
        break;
      default:
        result = await syncItem(item);
        break;
    }

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

      // Network error (no HTTP status) — abort remaining batch
      if (!result.status) {
        break;
      }
    }
  }

  return { synced, failed, errors };
}
