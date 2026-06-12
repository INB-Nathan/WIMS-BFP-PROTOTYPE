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
  getOfflineOpByServerId,
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

/**
 * Build a list result from the per-user IndexedDB cache, applying the SAME
 * filters the online list would (item #7 fix). Without this, the offline
 * dashboard showed every cached incident — including ones from previous days or
 * unrelated to the active filter — as "ghost" cards.
 *
 * `cachedAt` reports the MOST RECENT cache write (item #4 fix), i.e. when the
 * data was last refreshed online — not the oldest entry.
 */
async function buildCachedListResult(
  encoderId: string,
  params: RegionalIncidentsQueryParams | undefined,
): Promise<OfflineAwareListResult> {
  const cached = await getCachedIncidents(encoderId);
  const all = cached.map((c) => c.data as unknown as RegionalIncidentListItem);

  const toTime = (v: unknown): number | null => {
    if (!v) return null;
    const t = new Date(String(v)).getTime();
    return Number.isNaN(t) ? null : t;
  };
  const fromTime = toTime(params?.date_from);
  const toEndTime = toTime(params?.date_to);
  const wantArchived = params?.archived === true;

  const items = all.filter((item) => {
    // Archive view vs active view: cached items only belong to the active list
    // unless explicitly archived. Treat a truthy is_archived/archived as archived.
    const rec = item as unknown as Record<string, unknown>;
    const isArchived = Boolean(rec.is_archived ?? rec.archived);
    if (wantArchived !== isArchived) return false;

    if (params?.status && item.verification_status !== params.status) return false;
    if (params?.category && item.general_category !== params.category) return false;

    if (fromTime !== null || toEndTime !== null) {
      const itemTime = toTime(item.notification_dt) ?? toTime(item.created_at);
      if (itemTime === null) return false;
      if (fromTime !== null && itemTime < fromTime) return false;
      if (toEndTime !== null && itemTime > toEndTime) return false;
    }
    return true;
  });

  const newestCachedAt =
    cached.length > 0 ? Math.max(...cached.map((c) => c.cachedAt)) : undefined;

  return {
    response: { items, total: items.length, limit: items.length, offset: 0 },
    fromCache: true,
    cachedAt: newestCachedAt,
  };
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
    return buildCachedListResult(encoderId, params);
  }

  try {
    const response = await _fetchRegionalIncidents(params);

    // Fire-and-forget: cache flat list-item fields immediately so the offline
    // dashboard always has card data. Detail caching happens separately when
    // the user visits the incident detail page (fetchRegionalIncidentOfflineAware).
    void Promise.allSettled(
      response.items.map((item) =>
        cacheIncident(item.incident_id, item as unknown as Record<string, unknown>, encoderId)
          .catch(() => {}),
      ),
    );

    return { response, fromCache: false };
  } catch (err) {
    if (isNetworkError(err)) {
      markConnectivityOffline();
      // Connection dropped after the online check — fall back to IndexedDB cache.
      return buildCachedListResult(encoderId, params);
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

    // Fallback: the incident may have been created offline and synced, but
    // the full detail was never fetched from the server into cachedIncidents.
    // Reconstruct a detail response from the offlineOps create payload so
    // the encoder can still view their own incident while offline.
    const op = await getOfflineOpByServerId(incidentId, encoderId);
    if (op) {
      const p = op.payload as {
        incident_nonsensitive_details?: Record<string, unknown>;
        incident_sensitive_details?: Record<string, unknown>;
        latitude?: number | null;
        longitude?: number | null;
      };
      const syntheticDetail = {
        incident_id: incidentId,
        region_id: op.regionId,
        latitude: p.latitude ?? null,
        longitude: p.longitude ?? null,
        verification_status: op.syncStatus === 'synced' ? 'DRAFT' : 'DRAFT',
        nonsensitive: p.incident_nonsensitive_details ?? {},
        sensitive: p.incident_sensitive_details ?? {},
        created_at: new Date(op.createdAt).toISOString(),
        updated_at: new Date(op.createdAt).toISOString(),
        reference_number: null,
        rejection_reason: null,
        rejection_at: null,
        is_duplicate: false,
        duplicate_of: null,
        incident_type_code: null,
        is_wildland: false,
        wildland_fire_type: null,
        wildland_area_display: null,
        wildland_area_hectares: null,
      } as unknown as RegionalIncidentDetailResponse;
      return { response: syntheticDetail, fromCache: true, cachedAt: op.createdAt };
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
      const op = await getOfflineOpByServerId(incidentId, encoderId);
      if (op) {
        const p = op.payload as {
          incident_nonsensitive_details?: Record<string, unknown>;
          incident_sensitive_details?: Record<string, unknown>;
          latitude?: number | null;
          longitude?: number | null;
        };
        const syntheticDetail = {
          incident_id: incidentId,
          region_id: op.regionId,
          latitude: p.latitude ?? null,
          longitude: p.longitude ?? null,
          verification_status: 'DRAFT',
          nonsensitive: p.incident_nonsensitive_details ?? {},
          sensitive: p.incident_sensitive_details ?? {},
          created_at: new Date(op.createdAt).toISOString(),
          updated_at: new Date(op.createdAt).toISOString(),
          reference_number: null,
          rejection_reason: null,
          rejection_at: null,
          is_duplicate: false,
          duplicate_of: null,
          incident_type_code: null,
          is_wildland: false,
          wildland_fire_type: null,
          wildland_area_display: null,
          wildland_area_hectares: null,
        } as unknown as RegionalIncidentDetailResponse;
        return { response: syntheticDetail, fromCache: true, cachedAt: op.createdAt };
      }
      throw new Error(
        'This incident is not saved on this device. Reconnect to load it.',
      );
    }
    throw err;
  }
}
