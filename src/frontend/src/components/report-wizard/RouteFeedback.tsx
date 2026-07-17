'use client';

import { Loader2, CheckCircle2, XCircle, Navigation, MapPin } from 'lucide-react';
import RouteMap from '@/components/map/RouteMap';
import { parseLineStringToLatLng } from '@/components/map/RoutePolyline';
import type { PublicTrackingData } from '@/lib/api/tracking';

export type RouteState = 'PENDING' | 'SUCCESS' | 'FAILED';

export interface RouteFeedbackProps {
  reportLat: number;
  reportLng: number;
  /** Nearest station target for the route. */
  station?: { name: string; lat: number; lng: number } | null;
  /** Tracking data once fetched; null while loading. */
  tracking?: PublicTrackingData | null;
  /** True while bounded tracking polling is active. */
  loading: boolean;
}

/**
 * Derive route state from loading status and tracking data.
 *
 * RouteState flow (spec 2026-07-17):
 *   loading + no data     => PENDING  (Calculating — map with dashed estimate)
 *   data + valid geometry => SUCCESS  (Routed — road polyline)
 *   data + no geometry    => FAILED   (Estimated — dashed line, labeled estimate)
 *
 * Gap fixed: `routing_data_source` alone no longer drives SUCCESS.
 * Valid road geometry (parseLineStringToLatLng) is the deciding condition.
 */
function deriveRouteState(
  loading: boolean,
  tracking: PublicTrackingData | null | undefined,
): RouteState {
  if (loading) return 'PENDING';
  if (!tracking) return 'FAILED';
  if (parseLineStringToLatLng(tracking.routing_geometry)) return 'SUCCESS';
  return 'FAILED';
}

/**
 * Report Wizard receipt routing feedback.
 *
 * Renders a geographic Leaflet map (via RouteMap) with report and station
 * markers. When valid road geometry exists the route line is a solid green
 * polyline; otherwise a dashed amber estimated line is shown.
 */
export function RouteFeedback({
  reportLat,
  reportLng,
  station,
  tracking,
  loading,
}: RouteFeedbackProps) {
  const state = deriveRouteState(loading, tracking);

  const stationName = station?.name;
  const stationLat = station?.lat;
  const stationLng = station?.lng;

  // Missing station: do not invent a second endpoint.
  const stationKnown = stationLat != null && stationLng != null;

  return (
    <div
      data-testid="route-feedback"
      data-state={state}
      className="rounded-lg border p-3"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-base)' }}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
          Route to nearest station
        </p>
        <RouteStateBadge state={state} />
      </div>

      {/* Map area */}
      <div data-testid="route-map-container" className="rounded-lg overflow-hidden">
        {stationKnown ? (
          <RouteMap
            reportLat={reportLat}
            reportLng={reportLng}
            stationLat={stationLat}
            stationLng={stationLng}
            stationName={stationName}
            geometry={tracking?.routing_geometry}
            height={200}
            accessibleLabel={
              state === 'SUCCESS'
                ? `Road route to ${stationName ?? 'nearest station'}`
                : `Estimated route to ${stationName ?? 'nearest station'}`
            }
          />
        ) : (
          <div
            className="flex items-center justify-center rounded-lg text-xs"
            style={{ height: '200px', background: '#f8fafc', color: '#64748b' }}
          >
            <MapPin className="w-4 h-4 mr-2" />
            Station location unavailable
          </div>
        )}
      </div>

      <div className="mt-2 space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <div className="flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" />
          <span>Nearest: {stationName ?? '—'}</span>
        </div>
        {state === 'PENDING' && (
          <div className="flex items-center gap-1.5" style={{ color: '#d97706' }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Calculating route…
          </div>
        )}
        {state === 'SUCCESS' && (
          <div className="flex items-center gap-1.5" style={{ color: '#16a34a' }}>
            <CheckCircle2 className="w-3.5 h-3.5" />
            {tracking?.routing_distance_m != null
              ? `Distance: ${formatDistance(tracking.routing_distance_m)}`
              : 'Route available.'}
            {tracking?.routing_duration_s != null
              ? ` · ETA ${Math.round(tracking.routing_duration_s / 60)} min`
              : ''}
          </div>
        )}
        {state === 'FAILED' && (
          <div className="flex items-center gap-1.5" style={{ color: '#dc2626' }}>
            <XCircle className="w-3.5 h-3.5" />
            Route unavailable — showing estimated distance.
          </div>
        )}
        {tracking?.routing_data_source && (
          <div className="flex items-center gap-1.5">
            <Navigation className="w-3.5 h-3.5" />
            <span>Source: {tracking.routing_data_source}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function RouteStateBadge({ state }: { state: RouteState }) {
  const config = {
    PENDING: {
      label: 'Calculating',
      color: '#d97706',
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
    },
    SUCCESS: {
      label: 'Routed',
      color: '#16a34a',
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    FAILED: {
      label: 'Estimated',
      color: '#dc2626',
      icon: <XCircle className="w-3 h-3" />,
    },
  }[state];

  return (
    <span
      data-testid="route-state-badge"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ backgroundColor: `${config.color}1a`, color: config.color }}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}
