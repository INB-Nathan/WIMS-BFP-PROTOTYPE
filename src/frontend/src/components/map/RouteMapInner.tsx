'use client';

import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { RoutePolyline, parseLineStringToLatLng } from './RoutePolyline';
import { firePinIcon } from './leafletIcons';

/**
 * Station marker — blue pin matching the codebase divIcon pattern.
 * Self-contained, no external CDN requests.
 */
const stationIcon = L.divIcon({
  className: 'leaflet-station-pin',
  html: `<svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
    <path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0z" fill="#1d4ed8"/>
    <circle cx="12.5" cy="12.5" r="5" fill="#fff"/>
  </svg>`,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

// ── FitBounds with safe coincident-endpoint handling ───────────────────────

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;

    try {
      if (points.length === 1) {
        map.setView(points[0], 14);
        return;
      }
      const bounds = L.latLngBounds(points);
      if (bounds.isValid() && !bounds.getNorthEast().equals(bounds.getSouthWest())) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      } else {
        map.setView(points[0], 14);
      }
    } catch {
      map.setView(points[0], 13);
    }
  }, [map, points]);

  return null;
}

// ── Public interface ────────────────────────────────────────────────────────

export interface RouteMapInnerProps {
  reportLat: number;
  reportLng: number;
  stationLat: number;
  stationLng: number;
  stationName?: string;
  /** Optional GeoJSON LineString geometry for road route. */
  geometry?: Record<string, unknown> | null;
  /** Map height in px. Default 200. */
  height?: number;
  /** Accessible label for the map. */
  accessibleLabel?: string;
}

/**
 * RouteMapInner — Leaflet map that always renders report and station markers,
 * with a road polyline when `geometry` is valid, otherwise a dashed straight
 * line as estimated route.
 *
 * Client-only: loaded via next/dynamic from RouteMap.tsx (SSR-safe).
 */
export function RouteMapInner({
  reportLat,
  reportLng,
  stationLat,
  stationLng,
  stationName,
  geometry,
  height = 200,
  accessibleLabel = 'Map showing route to nearest station',
}: RouteMapInnerProps) {
  const reportPos = useMemo<[number, number]>(() => [reportLat, reportLng], [reportLat, reportLng]);
  const stationPos = useMemo<[number, number]>(() => [stationLat, stationLng], [stationLat, stationLng]);

  const routePositions = useMemo(
    () => parseLineStringToLatLng(geometry ?? null),
    [geometry],
  );

  const isValidRoute = routePositions !== null && routePositions.length >= 2;

  // Build fit-bounds points: route positions when valid, else endpoints.
  const fitPoints: [number, number][] = useMemo(() => {
    if (isValidRoute && routePositions) return routePositions;
    return [reportPos, stationPos];
  }, [isValidRoute, routePositions, reportPos, stationPos]);

  return (
    <div role="img" aria-label={accessibleLabel}>
      <MapContainer
        center={reportPos}
        zoom={13}
        style={{ height: `${height}px`, width: '100%' }}
        className="z-0 rounded-lg"
        scrollWheelZoom={false}
        dragging
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={fitPoints} />
        <Marker position={reportPos} icon={firePinIcon} title="Reported location" alt="Reported location" />
        <Marker
          position={stationPos}
          icon={stationIcon}
          title={stationName ?? 'Nearest station'}
          alt={stationName ?? 'Nearest station'}
        />
        {isValidRoute ? (
          <RoutePolyline geometry={geometry!} color="#16a34a" weight={4} />
        ) : (
          <Polyline
            positions={[reportPos, stationPos]}
            pathOptions={{ color: '#d97706', weight: 3, opacity: 0.8, dashArray: '8 6' }}
          />
        )}
      </MapContainer>
    </div>
  );
}
