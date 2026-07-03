/**
 * offlineOperations — offline-aware cached wrapper for the Operations
 * Board (fetchOperations). Used by multiple roles across HomePage.
 *
 * Operations don't change frequently (minute-scale), so a 5-minute TTL
 * keeps repeat PWA visits snappy without risk of stale data.
 */

import { offlineAware, type OfflineResult } from './offlineBase';
import { apiFetch } from './transport';
import type { Operation, FireStatus } from './operations';

export type { OfflineResult };

const OPS_TTL_MS = 5 * 60 * 1000; // 5 minutes

const OFFLINE_OPS_MSG =
  'Operations board is unavailable offline. Reconnect to refresh this view.';

/**
 * Fetch all operations, served from IndexedDB cache on repeat visits or
 * when offline.
 */
export function fetchOperationsOfflineAware(
  status?: FireStatus[],
  archived = false,
): Promise<OfflineResult<Operation[]>> {
  return offlineAware<Operation[]>(
    'operations',
    [archived ? 'archived' : 'active', (status?.sort() ?? [])],
    'operations',
    OPS_TTL_MS,
    async () => {
      const params = new URLSearchParams();
      if (archived) params.set('archived', 'true');
      status?.forEach((s) => params.append('status', s));
      const qs = params.toString();
      return apiFetch<Operation[]>(`/operations${qs ? `?${qs}` : ''}`);
    },
    OFFLINE_OPS_MSG,
  );
}
