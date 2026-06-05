'use client';

/**
 * /dashboard/validator/map — Operational map for NATIONAL_VALIDATOR.
 *
 * Shows a full-page map with all incidents visible to the user's role/region,
 * with status filters and popup details.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { apiFetch } from '@/lib/api';
import type { MapClusterItem } from '@/lib/api';

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

// ── Main page ───────────────────────────────────────────────────────────────

export default function ValidatorOperationalMapPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [clusters, setClusters] = useState<MapClusterItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBoundsRef = useRef<{ sw: [number, number]; ne: [number, number] } | null>(null);
  const lastZoomRef = useRef<number>(10);

  const fetchOperationalClusters = useCallback(
    async (bounds: { sw: [number, number]; ne: [number, number] }, zoom: number, status: string) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        sw_lat: bounds.sw[0].toFixed(6),
        sw_lng: bounds.sw[1].toFixed(6),
        ne_lat: bounds.ne[0].toFixed(6),
        ne_lng: bounds.ne[1].toFixed(6),
        zoom: String(zoom),
      });
      if (status) params.set('status_filter', status);
      try {
        const data = await apiFetch<{ clusters?: MapClusterItem[] }>(`/api/validator/operational-map?${params}`);
        setClusters(data.clusters ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load map data');
      } finally {
        setLoading(false);
      }
    },
    [],
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

      {/* Error banner */}
      {error && (
        <div className="px-6 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Map */}
      <div className="flex-1 relative">
        <ValidatorMapInner
          onViewportChange={handleViewportChange}
          clusters={clusters}
        />
      </div>
    </div>
  );
}
