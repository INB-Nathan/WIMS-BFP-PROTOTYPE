/**
 * offlineValidatorStats — offline-aware cached wrapper for the national
 * validator dashboard stats (fetchValidatorStats).
 *
 * Stats are cached with a 5-minute TTL. First fetch populates IndexedDB;
 * subsequent loads (including PWA reopens) serve instantly from cache.
 */

import { offlineAware, type OfflineResult } from './offlineBase';
import { apiFetch } from './transport';

export type { OfflineResult };

interface ValidatorStatsPayload {
  total_verified: number;
  pending_validation: number;
  wildland_total: number;
  by_category: Array<{ category: string; count: number }>;
  structures_affected: number;
  households_affected: number;
  families_affected: number;
  individuals_affected: number;
  vehicles_affected: number;
}

const STATS_TTL_MS = 5 * 60 * 1000; // 5 minutes

const OFFLINE_STATS_MSG =
  'Validator stats are unavailable offline. Reconnect to refresh this view.';

/**
 * Fetch national validator dashboard statistics, served from IndexedDB cache
 * on repeat visits or when offline.
 */
export function fetchValidatorStatsOfflineAware(
  params?: { date_from?: string; date_to?: string },
): Promise<OfflineResult<ValidatorStatsPayload>> {
  return offlineAware<ValidatorStatsPayload>(
    'validator-stats',
    [params?.date_from ?? '', params?.date_to ?? ''],
    'validator',
    STATS_TTL_MS,
    async () => {
      const qs = new URLSearchParams();
      if (params?.date_from) qs.set('date_from', params.date_from);
      if (params?.date_to) qs.set('date_to', params.date_to);
      const query = qs.toString() ? `?${qs.toString()}` : '';
      return apiFetch<ValidatorStatsPayload>(`/regional/validator/stats${query}`);
    },
    OFFLINE_STATS_MSG,
  );
}
