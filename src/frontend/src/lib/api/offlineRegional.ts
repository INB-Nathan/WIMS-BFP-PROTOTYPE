/**
 * Offline-aware wrappers for regional encoder API calls.
 * These wrap the legacy API functions with IndexedDB cache read/write
 * so encoders can view their incidents while offline.
 */

import {
  fetchRegionalIncidents as _fetchRegionalIncidents,
  fetchRegionalIncident as _fetchRegionalIncident,
} from './legacy';
import type {
  RegionalIncidentsListResponse,
  RegionalIncidentDetailResponse,
  RegionalIncidentsQueryParams,
  RegionalIncidentListItem,
} from './legacy';
import {
  cacheIncident,
  getCachedIncidents,
  getCachedIncident,
} from '../offlineStore';
import { getConnectivitySnapshot, isReachable, markConnectivityOffline } from '../connectivity';

// navigator.onLine can be true during a flaky / just-dropped connection.
// Treat TypeError ("Failed to fetch") and any status-0 / ERR_INTERNET_* errors
// as "effectively offline" so the cache fallback fires regardless.
function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof Error) {
    const msg = err.message;
    return (
      msg.includes('ERR_INTERNET_DISCONNECTED') ||
      msg.includes('ERR_NETWORK_CHANGED') ||
      msg.includes('ERR_CONNECTION_RESET') ||
      msg.includes('NetworkError') ||
      msg.includes('Failed to fetch') ||
      msg.includes('net::ERR')
    );
  }
  return false;
}

export interface OfflineAwareListResult {
  response: RegionalIncidentsListResponse;
  fromCache: boolean;
  cachedAt?: number;
}

export interface OfflineAwareDetailResult {
  response: RegionalIncidentDetailResponse;
  fromCache: boolean;
  cachedAt?: number;
}

/**
 * Fetch the incident list. When offline, reads from IndexedDB cache.
 * On success, writes all returned items to the cache for later offline reads.
 *
 * NOTE: offline reads ignore all filter/pagination params — the full cached
 * set is returned and the caller should display a stale-data banner.
 */
export async function fetchRegionalIncidentsOfflineAware(
  params: RegionalIncidentsQueryParams | undefined,
  encoderId: string,
): Promise<OfflineAwareListResult> {
  // Only treat as offline when the last probe confirmed it.
  // 'checking' (probe in flight) is ambiguous — fall through to the API so a
  // racing probeConnectivity() transition doesn't falsely serve stale cache.
  const isOffline = getConnectivitySnapshot().state === 'offline';

  if (isOffline) {
    const cached = await getCachedIncidents(encoderId);
    const items = cached.map((c) => c.data as unknown as RegionalIncidentListItem);
    const oldestCachedAt =
      cached.length > 0 ? Math.min(...cached.map((c) => c.cachedAt)) : undefined;
    return {
      response: { items, total: items.length, limit: items.length, offset: 0 },
      fromCache: true,
      cachedAt: oldestCachedAt,
    };
  }

  try {
    const response = await _fetchRegionalIncidents(params);

    // Fire-and-forget: cache list items AND proactively fetch + cache full details
    // so offline detail-page viewing works without a prior individual visit.
    void Promise.allSettled(
      response.items.map((item) =>
        cacheIncident(
          item.incident_id,
          item as unknown as Record<string, unknown>,
          encoderId,
        ).then(() =>
          _fetchRegionalIncident(item.incident_id)
            .then((detail) =>
              cacheIncident(
                item.incident_id,
                detail as unknown as Record<string, unknown>,
                encoderId,
              ),
            )
            .catch(() => {}),
        ),
      ),
    );

    return { response, fromCache: false };
  } catch (err) {
    if (isNetworkError(err)) {
      markConnectivityOffline();
      // Connection dropped after the online check — fall back to IndexedDB cache.
      const cached = await getCachedIncidents(encoderId);
      const items = cached.map((c) => c.data as unknown as RegionalIncidentListItem);
      const oldestCachedAt =
        cached.length > 0 ? Math.min(...cached.map((c) => c.cachedAt)) : undefined;
      return {
        response: { items, total: items.length, limit: items.length, offset: 0 },
        fromCache: true,
        cachedAt: oldestCachedAt,
      };
    }
    throw err;
  }
}

/**
 * Fetch a single incident detail. When offline, reads from IndexedDB cache.
 * On success, overwrites the cache entry with the richer detail payload.
 */
export async function fetchRegionalIncidentOfflineAware(
  incidentId: number,
  encoderId: string,
): Promise<OfflineAwareDetailResult> {
  // Resolve connectivity precisely before fetching a detail record:
  //   'offline'            → last probe confirmed offline, serve cache immediately
  //   'online'/'reconnect' → confirmed online, go straight to API
  //   'checking'           → probe in flight, wait for its result
  // This prevents the transient 'checking' window (set by probeConnectivity())
  // from falsely triggering the cache path and showing the stale-data banner.
  const snap = getConnectivitySnapshot();
  let isOffline: boolean;
  if (snap.state === 'offline') {
    isOffline = true;
  } else if (snap.state === 'online' || snap.state === 'reconnecting') {
    isOffline = false;
  } else {
    isOffline = !(await isReachable());
  }

  if (isOffline) {
    const cached = await getCachedIncident(incidentId);
    if (cached) {
      return {
        response: cached.data as unknown as RegionalIncidentDetailResponse,
        fromCache: true,
        cachedAt: cached.cachedAt,
      };
    }
    throw new Error(
      'This incident is not available offline. Connect to the internet to view it.',
    );
  }

  try {
    const response = await _fetchRegionalIncident(incidentId);
    void cacheIncident(incidentId, response as unknown as Record<string, unknown>, encoderId);
    return { response, fromCache: false };
  } catch (err) {
    if (isNetworkError(err)) {
      markConnectivityOffline();
      // Connection dropped mid-request — serve from cache if available.
      const cached = await getCachedIncident(incidentId);
      if (cached) {
        return {
          response: cached.data as unknown as RegionalIncidentDetailResponse,
          fromCache: true,
          cachedAt: cached.cachedAt,
        };
      }
      throw new Error(
        'This incident is not saved on this device. Reconnect to load it.',
      );
    }
    throw err;
  }
}
