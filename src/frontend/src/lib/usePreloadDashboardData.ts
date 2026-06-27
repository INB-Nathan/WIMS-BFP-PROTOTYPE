/**
 * usePreloadDashboardData — eagerly starts data fetches as soon as auth
 * resolves, so cached data is ready by the time the dashboard page mounts.
 *
 * Each role's fetch triggers the offlineAware() cache write. When the page
 * component later calls fetchRegionalIncidentsOfflineAware (etc.), the data
 * is already in IndexedDB — the ghost panels swap to real content instantly.
 * This fires from LayoutShell, which wraps every page, so preloading starts
 * before any page-specific mount effects.
 */

import { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { fetchRegionalIncidentsOfflineAware } from '@/lib/api/offlineRegional';
import { fetchRegionalStatsOfflineAware } from '@/lib/api/offlineRegionalStats';

export function usePreloadDashboardData(): void {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user?.id) return;

    const role = (user as { role?: string })?.role ?? '';

    // ── Regional encoder: preload incident list + stats ──
    if (role === 'REGIONAL_ENCODER' || role === 'ENCODER') {
      void fetchRegionalIncidentsOfflineAware(
        { limit: 10, offset: 0, archived: false },
        user.id,
      );
      void fetchRegionalStatsOfflineAware();
      return;
    }

    // ── National analyst / validator: preload charts + stats ──
    if (role === 'NATIONAL_ANALYST' || role === 'NATIONAL_VALIDATOR') {
      void import('@/lib/api').then((api) => {
        const filters = {};
        void api.fetchHeatmapDataOfflineAware(filters);
        void api.fetchTrendDataOfflineAware({ ...filters, interval: 'daily' });
        void api.fetchTypeDistributionOfflineAware(filters);
        void api.fetchResponseTimeByRegionOfflineAware(filters);
        void api.fetchTopNOfflineAware({ metric: 'incidents', dimension: 'municipality', ...filters });
      });
      void import('@/lib/api/offlineValidatorStats').then((m) => {
        void m.fetchValidatorStatsOfflineAware();
      });
      return;
    }

    // ── System admin: preload health + metrics + workers ──
    if (role === 'SYSTEM_ADMIN') {
      void import('@/lib/api').then((api) => {
        void api.fetchSystemHealthOfflineAware();
        void api.fetchSystemMetricsOfflineAware();
        void api.fetchWorkerStatusOfflineAware({ limit: 20, offset: 0 });
        void api.fetchActiveSessionsOfflineAware();
      });
      return;
    }
  }, [loading, user?.id]);
}
