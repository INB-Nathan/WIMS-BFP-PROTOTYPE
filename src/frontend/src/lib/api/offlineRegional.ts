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
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

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

  const response = await _fetchRegionalIncidents(params);

  // Fire-and-forget cache write — cache failures must not block the UI
  void Promise.allSettled(
    response.items.map((item) =>
      cacheIncident(
        item.incident_id,
        item as unknown as Record<string, unknown>,
        encoderId,
      ),
    ),
  );

  return { response, fromCache: false };
}

/**
 * Fetch a single incident detail. When offline, reads from IndexedDB cache.
 * On success, overwrites the cache entry with the richer detail payload.
 */
export async function fetchRegionalIncidentOfflineAware(
  incidentId: number,
  encoderId: string,
): Promise<OfflineAwareDetailResult> {
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

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

  const response = await _fetchRegionalIncident(incidentId);
  void cacheIncident(incidentId, response as unknown as Record<string, unknown>, encoderId);
  return { response, fromCache: false };
}
