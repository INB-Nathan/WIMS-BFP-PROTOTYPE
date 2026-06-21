'use client';

/**
 * /dashboard/validator/map — Operational map for NATIONAL_VALIDATOR.
 *
 * Shows a full-page map with all incidents visible to the user's role/region,
 * with status filters and popup details.
 *
 * Read path is offline-aware (T12): clusters come through
 * `fetchOperationalMapOfflineAware` and the StaleCacheBanner surfaces
 * whenever the response was served from the encrypted offline cache.
 * When the page is offline and the cache is empty, we render a friendly
 * "unavailable offline" state instead of crashing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { WifiOff } from 'lucide-react';
import {
  fetchOperationalMapOfflineAware,
  type MapClusterItem,
} from '@/lib/api';
import { useNetworkStatus } from '@/lib/useNetworkStatus';
import { StaleCacheBanner } from '@/components/ui/StaleCacheBanner';

// ── SSR guard ──────────────────────────────────────────────────────────────

const ValidatorMapInner = dynamic(
  () => import('./ValidatorMapInner'),
  { ssr: false, loading: () => (
    <div className="flex h-full w-full items-center justify-center text-slate-400 text-sm">
      Loading operational map...
    </div>
  ),
});

// ── Constants ───────────────────────────────────────────────────────────────

const VIEWPORT_DEBOUNCE_MS = 400;

const STATUS_OPTIONS = [
  { value: '', label: 'All (excl. Draft)' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PENDING_VALIDATION', label: 'Pending Validation' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'REJECTED', label: 'Rejected' },
];

const OFFLINE_UNAVAILABLE_MESSAGE =
  'The operational map is unavailable offline. Reconnect to refresh this view.';

// ── Main page ───────────────────────────────────────────────────────────────

export default function ValidatorOperationalMapPage() {
  const networkStatus = useNetworkStatus();
  const [statusFilter, setStatusFilter] = useState('');
  const [clusters, setClusters] = useState<MapClusterItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stale cache metadata — only set when the offline-aware wrapper reports
  // that the response was served from the encrypted cache.
  const [cacheMeta, setCacheMeta] = useState<{ cachedAt: number } | null>(null);
  // Set when offline + cache miss — page renders a friendly unavailable state.
  const [unavailableOffline, setUnavailableOffline] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBoundsRef = useRef<{ sw: [number, number]; ne: [number, number] } | null>(null);
  const lastZoomRef = useRef<number>(10);

  const fetchOperationalClusters = useCallback(
    async (bounds: { sw: [number, number]; ne: [number, number] }, zoom: number, status: string) => {
      setLoading(true);
      setError(null);
      setUnavailableOffline(false);
      try {
        const result = await fetchOperationalMapOfflineAware({
          sw: bounds.sw,
          ne: bounds.ne,
          zoom,
          status: status || undefined,
        });
        setClusters(result.response);
        if (result.fromCache && result.cachedAt != null) {
          setCacheMeta({ cachedAt: result.cachedAt });
        } else {
          setCacheMeta(null);
        }
      } catch (err) {
        // The wrapper throws a friendly message when offline + cache miss.
        // Treat that as the "unavailable offline" state so we can render a
        // purpose-built screen rather than the red error banner.
        const message = err instanceof Error ? err.message : 'Failed to load map data';
        if (
          !networkStatus.isOnline &&
          message === 'Validator operational map is unavailable offline. Reconnect to refresh this view.'
        ) {
          setUnavailableOffline(true);
          setError(null);
        } else {
          setError(message);
        }
        setCacheMeta(null);
      } finally {
        setLoading(false);
      }
    },
    [networkStatus.isOnline],
  );

  const handleViewportChange = useCallback(
    (bounds: L.LatLngBounds, zoom: number) => {
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const b = { sw: [sw.lat, sw.lng] as [number, number], ne: [ne.lat, ne.lng] as [number, number] };
      lastBoundsRef.current = b;
      lastZoomRef.current = zoom;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        fetchOperationalClusters(b, zoom, statusFilter);
      }, VIEWPORT_DEBOUNCE_MS);
    },
    [fetchOperationalClusters, statusFilter],
  );

  // Refetch when status filter changes
  useEffect(() => {
    if (lastBoundsRef.current) {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      fetchOperationalClusters(lastBoundsRef.current, lastZoomRef.current, statusFilter);
    }
  }, [statusFilter, fetchOperationalClusters]);

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Header bar */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-slate-200 bg-white shrink-0">
        <Link
          href="/dashboard/validator"
          className="text-sm font-medium text-blue-700 hover:text-blue-900"
        >
          ← Queue
        </Link>
        <h1 className="text-lg font-bold text-slate-800">Operational Map</h1>

        {!networkStatus.isOnline && (
          <span
            data-testid="offline-indicator"
            className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800"
          >
            Offline
          </span>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-slate-500 font-medium">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-sm rounded-md border border-slate-300 px-3 py-1.5 bg-white"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {loading && (
          <span className="text-xs text-slate-400 animate-pulse">Loading...</span>
        )}
      </div>

      {/* Stale cache banner — only when the wrapper served cached clusters */}
      {cacheMeta && (
        <StaleCacheBanner
          freshness={{ cachedAt: cacheMeta.cachedAt, isOnline: networkStatus.isOnline }}
          message="Showing cached clusters"
        />
      )}

      {/* Error banner */}
      {error && (
        <div className="px-6 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Cache-miss while offline → render purpose-built unavailable screen
          instead of the empty map, so the validator understands why the map
          is blank. */}
      {unavailableOffline ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8 bg-slate-50">
          <WifiOff className="w-12 h-12 text-slate-300" />
          <h2 className="text-lg font-semibold text-slate-600">
            Operational Map Unavailable Offline
          </h2>
          <p className="text-sm text-slate-400 max-w-sm">
            {OFFLINE_UNAVAILABLE_MESSAGE}
          </p>
          <Link
            href="/dashboard/validator"
            className="text-sm font-medium text-blue-700 hover:text-blue-900"
          >
            ← Back to queue
          </Link>
        </div>
      ) : (
        /* Map */
        <div className="flex-1 relative">
          <ValidatorMapInner
            onViewportChange={handleViewportChange}
            clusters={clusters}
          />
        </div>
      )}
    </div>
  );
}
