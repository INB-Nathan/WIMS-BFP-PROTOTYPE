import { apiFetch, ApiRequestError } from './transport';
import {
  cacheAnalyticsResponse,
  getCachedAnalyticsResponse,
  queueIncident,
  type VerifyAction,
} from '../offlineStore';
import {
  getConnectivitySnapshot,
  markConnectivityOffline,
} from '../connectivity';


export interface OfflineQueueResult {
  queued: boolean;
  localId: string;
}

const VALIDATOR_CACHE_TTL_MS = 30 * 60 * 1000;

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof Error) {
    const msg = err.message;
    return (
      /ERR_/i.test(msg) ||
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('net::ERR')
    );
  }
  return false;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined && record[key] !== '')
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

function queueCacheKey(userId: string | null | undefined, params: Record<string, unknown>): string {
  return `validator:queue:${userId || 'anonymous'}:${encodeURIComponent(stableStringify(params))}`;
}

function isNavigatorOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function shouldServeOffline(): boolean {
  const snapshot = getConnectivitySnapshot();
  return snapshot.state === 'offline' || isNavigatorOffline();
}

function isFresh(cachedAt: number): boolean {
  return Date.now() - cachedAt <= VALIDATOR_CACHE_TTL_MS;
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

export interface OfflineValidatorQueueResult<T> {
  response: T;
  fromCache: boolean;
  cachedAt?: number;
}

export async function fetchValidatorQueueOfflineAware<T>(
  params: Record<string, unknown>,
  fetcher: () => Promise<T>,
  userId?: string | null,
): Promise<OfflineValidatorQueueResult<T>> {
  const key = queueCacheKey(userId, params);

  if (shouldServeOffline()) {
    const cached = await getCachedAnalyticsResponse<T>(key);
    if (!cached || !isFresh(cached.cachedAt)) {
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
      await cacheAnalyticsResponse<T>(key, response);
    } catch {
      // Cache writes must not break an otherwise successful response.
    }
    return { response, fromCache: false };
  } catch (err) {
    if (isNetworkError(err)) {
      markConnectivityOffline();
      const cached = await getCachedAnalyticsResponse<T>(key);
      if (!cached || !isFresh(cached.cachedAt)) {
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
