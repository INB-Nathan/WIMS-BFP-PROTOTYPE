/**
 * offlineRegionalStats — offline-aware cached wrapper for regional encoder
 * dashboard stats (fetchRegionalStats).
 *
 * Stats are cached with a 5-minute TTL since they represent aggregate counts
 * that change slowly. On the first load the stats are fetched and cached;
 * subsequent loads (including PWA reopens within the TTL) serve instantly
 * from IndexedDB.
 */

import { offlineAware, type OfflineResult } from './offlineBase';
import { apiFetch } from './transport';

export type { OfflineResult };

interface RegionalStatsPayload {
  total_incidents?: number;
  total_incidents_this_week?: number;
  by_category?: Array<{ category: string | null; count: number }>;
  by_status?: Array<{ status: string; count: number }>;
  wildland_total?: number;
  by_wildland_type?: Array<{ fire_type: string | null; count: number }>;
  structures_affected?: number;
  households_affected?: number;
  families_affected?: number;
  individuals_affected?: number;
  vehicles_affected?: number;
}

const STATS_TTL_MS = 5 * 60 * 1000; // 5 minutes

const OFFLINE_STATS_MSG =
  'Regional stats are unavailable offline. Reconnect to refresh this view.';

/**
 * Fetch regional dashboard statistics, served from IndexedDB cache on repeat
 * visits or when offline.
 */
export function fetchRegionalStatsOfflineAware(
  params?: { date_from?: string; date_to?: string },
): Promise<OfflineResult<RegionalStatsPayload>> {
  return offlineAware<RegionalStatsPayload>(
    'regional-stats',
    [params?.date_from ?? '', params?.date_to ?? ''],
    'regional',
    STATS_TTL_MS,
    async () => {
      const qs = new URLSearchParams();
      if (params?.date_from) qs.set('date_from', params.date_from);
      if (params?.date_to) qs.set('date_to', params.date_to);
      const query = qs.toString() ? `?${qs.toString()}` : '';
      return apiFetch<RegionalStatsPayload>(`/regional/stats${query}`);
    },
    OFFLINE_STATS_MSG,
  );
}
