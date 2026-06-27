/**
 * Shared hook for offline work counts across nav, dashboard, and badge widgets.
 *
 * Returns per-encoder counts of pending, failed, conflict, draft ops.
 * Fetches from IndexedDB on mount and on a periodic refresh interval.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getOfflineOpsCounts, getDraftOps } from './offlineStore';

export interface OfflineWorkCounts {
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  draftCount: number;
  totalActionableCount: number;
  loading: boolean;
}

const REFRESH_INTERVAL_MS = 10_000;

const EMPTY_COUNTS: OfflineWorkCounts = {
  pendingCount: 0,
  failedCount: 0,
  conflictCount: 0,
  draftCount: 0,
  totalActionableCount: 0,
  loading: true,
};

export function useOfflineWorkCounts(): OfflineWorkCounts {
  const { user } = useAuth();
  const encoderId = (user as { id?: string } | null)?.id ?? null;
  const [counts, setCounts] = useState<OfflineWorkCounts>(EMPTY_COUNTS);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!encoderId) {
      setCounts((prev) => ({ ...prev, loading: false }));
      return;
    }
    try {
      const [opsCounts, draftOps] = await Promise.all([
        getOfflineOpsCounts(encoderId),
        getDraftOps(encoderId),
      ]);
      setCounts({
        pendingCount: opsCounts.pendingCount,
        failedCount: opsCounts.failedCount,
        conflictCount: opsCounts.conflictCount,
        draftCount: draftOps.length,
        totalActionableCount: opsCounts.totalActionableCount,
        loading: false,
      });
    } catch {
      // IndexedDB unavailable — remain on last known counts or zero
    }
  }, [encoderId]);

  useEffect(() => {
    void refresh();

    intervalRef.current = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh]);

  return counts;
}
