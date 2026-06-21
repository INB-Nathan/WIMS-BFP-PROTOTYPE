import { apiFetch, ApiRequestError } from './transport';
import {
  cacheReadResponse,
  getReadCachedResponse,
  queueIncident,
  type VerifyAction,
} from '../offlineStore';
import { markConnectivityOffline } from '../connectivity';
import {
  OfflineResult,
  isNetworkError,
  isFresh,
  shouldServeOffline,
  stableStringify,
} from './offlineBase';

export interface OfflineQueueResult {
  queued: boolean;
  localId: string;
}

export type OfflineValidatorQueueResult<T> = OfflineResult<T>;

const VALIDATOR_CACHE_TTL_MS = 30 * 60 * 1000;

function queueCacheKey(userId: string | null | undefined, params: Record<string, unknown>): string {
  return `validator:queue:${userId || 'anonymous'}:${encodeURIComponent(stableStringify(params))}`;
}

// ── Verification (Accept / Reject) offline-aware ─────────────────

export async function submitVerificationOfflineAware(
  incidentId: number,
  action: VerifyAction,
  notes: string | null,
  originalIncidentId?: number,
): Promise<OfflineQueueResult> {
  if (shouldServeOffline()) {
    const localId = crypto.randomUUID();
    await queueIncident(
      {
        incident_id: incidentId,
        action,
        notes,
        ...(originalIncidentId !== undefined ? { original_incident_id: originalIncidentId } : {}),
      },
      { opType: 'verify', localId },
    );
    return { queued: true, localId };
  }

  try {
    await apiFetch(`/api/regional/incidents/${incidentId}/verification`, {
      method: 'PATCH',
      body: JSON.stringify({
        action,
        notes: notes ?? null,
        client_id: crypto.randomUUID(),
        ...(originalIncidentId !== undefined ? { original_incident_id: originalIncidentId } : {}),
      }),
    });
    return { queued: false, localId: '' };
  } catch (err) {
    // 409 DUPLICATE_DETECTED — surface to the page so the user can decide
    if (err instanceof ApiRequestError && err.status === 409) {
      throw err;
    }
    // Network error — fall back to offline queue
    if (isNetworkError(err)) {
      markConnectivityOffline();
      const localId = crypto.randomUUID();
      await queueIncident(
        {
          incident_id: incidentId,
          action,
          notes,
          ...(originalIncidentId !== undefined ? { original_incident_id: originalIncidentId } : {}),
        },
        { opType: 'verify', localId },
      );
      return { queued: true, localId };
    }
    throw err;
  }
}

// ── Archive / Unarchive offline-aware ────────────────────────────

export async function submitArchiveActionOfflineAware(
  incidentId: number,
  action: 'archive' | 'unarchive',
): Promise<OfflineQueueResult> {
  if (shouldServeOffline()) {
    const localId = crypto.randomUUID();
    await queueIncident(
      { incident_id: incidentId, action },
      { opType: 'archive_action', localId },
    );
    return { queued: true, localId };
  }

  const endpoint = action === 'archive'
    ? `/api/regional/validator/incidents/${incidentId}/archive`
    : `/api/regional/validator/incidents/${incidentId}/unarchive`;

  try {
    await apiFetch(endpoint, {
      method: 'PATCH',
      body: JSON.stringify({ client_id: crypto.randomUUID() }),
    });
    return { queued: false, localId: '' };
  } catch (err) {
    // 409 DUPLICATE_DETECTED — surface to the page
    if (err instanceof ApiRequestError && err.status === 409) {
      throw err;
    }
    // Network error — fall back to offline queue
    if (isNetworkError(err)) {
      markConnectivityOffline();
      const localId = crypto.randomUUID();
      await queueIncident(
        { incident_id: incidentId, action },
        { opType: 'archive_action', localId },
      );
      return { queued: true, localId };
    }
    throw err;
  }
}

// Convenience aliases
export async function archiveIncidentOfflineAware(
  incidentId: number,
): Promise<OfflineQueueResult> {
  return submitArchiveActionOfflineAware(incidentId, 'archive');
}

export async function unarchiveIncidentOfflineAware(
  incidentId: number,
): Promise<OfflineQueueResult> {
  return submitArchiveActionOfflineAware(incidentId, 'unarchive');
}

// ── Queue fetch offline-aware ────────────────────────────────────

export async function fetchValidatorQueueOfflineAware<T>(
  params: Record<string, unknown>,
  fetcher: () => Promise<T>,
  userId?: string | null,
): Promise<OfflineValidatorQueueResult<T>> {
  const key = queueCacheKey(userId, params);

  if (shouldServeOffline()) {
    const cached = await getReadCachedResponse<T>(key);
    if (!cached || !isFresh(cached.cachedAt, VALIDATOR_CACHE_TTL_MS)) {
      throw new Error(
        'Validator queue is unavailable offline. Reconnect to refresh this view.',
      );
    }
    return {
      response: cached.data,
      fromCache: true,
      cachedAt: cached.cachedAt,
    };
  }

  try {
    const response = await fetcher();
    // Best-effort cache write
    try {
      await cacheReadResponse<T>(key, response, VALIDATOR_CACHE_TTL_MS);
    } catch {
      // Cache writes must not break an otherwise successful response.
    }
    return { response, fromCache: false };
  } catch (err) {
    if (isNetworkError(err)) {
      markConnectivityOffline();
      const cached = await getReadCachedResponse<T>(key);
      if (!cached || !isFresh(cached.cachedAt, VALIDATOR_CACHE_TTL_MS)) {
        throw err;
      }
      return {
        response: cached.data,
        fromCache: true,
        cachedAt: cached.cachedAt,
      };
    }
    throw err;
  }
}
