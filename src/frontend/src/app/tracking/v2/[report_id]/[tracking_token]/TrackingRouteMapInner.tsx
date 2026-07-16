'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { RoutePolyline, parseLineStringToLatLng } from '@/components/map/RoutePolyline';

/**
 * TrackingRouteMapInner — small read-only map showing the routed path to the
 * responding station for a public tracking record. Client-only (react-leaflet
 * needs `window`); always loaded via next/dynamic with `{ ssr: false }` from
 * `TrackingRouteMap.tsx`, matching the pattern used by the other `*MapInner`
 * components in this codebase (e.g. NearbyStationsMapInner).
 */

function FitToRoute({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], 14);
      return;
    }
    map.fitBounds(L.latLngBounds(positions), { padding: [24, 24] });
  }, [map, positions]);
  return null;
}

export interface TrackingRouteMapInnerProps {
  /** GeoJSON LineString geometry from `routing_geometry`, as returned by the tracking endpoint. */
  geometry: Record<string, unknown> | null | undefined;
}

export function TrackingRouteMapInner({ geometry }: TrackingRouteMapInnerProps) {
  const positions = parseLineStringToLatLng(geometry) ?? [];
  const center: [number, number] = positions[0] ?? [14.5995, 120.9842];

  return (
    <MapContainer
      center={center}
      zoom={13}
      style={{ height: '220px', width: '100%' }}
      className="z-0"
      scrollWheelZoom={false}
      dragging={false}
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {positions.length > 0 && <FitToRoute positions={positions} />}
      <RoutePolyline geometry={geometry} />
    </MapContainer>
  );
}
