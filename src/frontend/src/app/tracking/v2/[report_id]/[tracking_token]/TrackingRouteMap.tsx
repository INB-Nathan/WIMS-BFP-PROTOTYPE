'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import type { TrackingRouteMapInnerProps } from './TrackingRouteMapInner';

// SSR guard: react-leaflet breaks without window.
const MapInner = dynamic(
  () =>
    import('./TrackingRouteMapInner').then(
      (m) => m.TrackingRouteMapInner,
    ) as Promise<ComponentType<TrackingRouteMapInnerProps>>,
  {
    ssr: false,
    loading: () => (
      <div
        className="flex items-center justify-center rounded-lg text-xs"
        style={{ height: '220px', background: '#18181d', color: 'rgba(232,232,237,0.38)' }}
      >
        Loading route map…
      </div>
    ),
  },
);

export interface TrackingRouteMapProps {
  /** GeoJSON LineString geometry from `routing_geometry`. `null`/`undefined` renders nothing. */
  geometry: Record<string, unknown> | null | undefined;
}

/**
 * Public-facing wrapper for the tracking route map. Renders nothing when no
 * usable route geometry is present, so callers can mount it unconditionally
 * once `routing_geometry` is truthy.
 */
export function TrackingRouteMap({ geometry }: TrackingRouteMapProps) {
  if (!geometry) return null;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
      <MapInner geometry={geometry} />
    </div>
  );
}
