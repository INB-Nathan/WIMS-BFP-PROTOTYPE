'use client';

import { Polyline } from 'react-leaflet';
import type { PolylineProps } from 'react-leaflet';

/**
 * RoutePolyline — generic Leaflet polyline renderer for GeoJSON LineString
 * geometry, i.e. the shape PostGIS `ST_AsGeoJSON()` produces for a routed
 * path: `{ type: "LineString", coordinates: [[lng, lat], [lng, lat], ...] }`.
 *
 * This component is intentionally domain-agnostic — it knows nothing about
 * incidents, tracking tokens, or fire stations. It exists so that any
 * consumer holding GeoJSON LineString geometry (typically a backend
 * `routing_geometry` field) can render it as a Leaflet polyline without
 * re-implementing the coordinate-order conversion (GeoJSON is `[lng, lat]`;
 * Leaflet/react-leaflet's `<Polyline positions={...}>` wants `[lat, lng]`).
 *
 * Must be rendered inside a react-leaflet `<MapContainer>` (client-only —
 * see other `*MapInner` components in this codebase for the `next/dynamic`
 * `{ ssr: false }` pattern).
 *
 * Props: `{ geometry: Record<string, unknown> | null | undefined, ...rest }`
 * where `rest` is any standard react-leaflet `Polyline` styling prop
 * (`color`, `weight`, `opacity`, `dashArray`, etc.) — all pass through.
 *
 * Renders `null` when `geometry` is missing, not a `LineString`, or
 * otherwise malformed (fewer than 2 coordinate pairs, non-numeric
 * coordinates, etc.) — callers do not need to guard against absent or
 * partial routing data themselves.
 *
 * Consumers:
 * - Report Tracking (#617): route from an incident to the responding
 *   station when `routing_geometry` is present on the tracking response.
 * - Fire Stations (#616, planned): import this component rather than
 *   re-implementing GeoJSON-to-Leaflet parsing.
 */
export interface RoutePolylineProps extends Omit<PolylineProps, 'positions'> {
  /** GeoJSON-ish geometry payload, typically the backend's `routing_geometry` field. */
  geometry: Record<string, unknown> | null | undefined;
}

/**
 * Parse a GeoJSON LineString (`{ type: "LineString", coordinates: [[lng, lat], ...] }`)
 * into the `[lat, lng][]` tuple array react-leaflet's `<Polyline positions={...}>`
 * expects. Returns `null` if `geometry` is missing, not a `LineString`, has
 * fewer than 2 coordinate pairs, or contains non-numeric/non-finite values.
 */
export function parseLineStringToLatLng(
  geometry: Record<string, unknown> | null | undefined,
): [number, number][] | null {
  if (!geometry || typeof geometry !== 'object') return null;
  if (geometry.type !== 'LineString') return null;

  const coordinates = (geometry as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  const positions: [number, number][] = [];
  for (const pair of coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const [lng, lat] = pair;
    if (typeof lng !== 'number' || typeof lat !== 'number') return null;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    positions.push([lat, lng]);
  }

  return positions;
}

const DEFAULT_PATH_STYLE = {
  color: '#3b82f6',
  weight: 4,
  opacity: 0.85,
} as const;

export function RoutePolyline({ geometry, ...polylineProps }: RoutePolylineProps) {
  const positions = parseLineStringToLatLng(geometry);
  if (!positions) return null;

  return <Polyline positions={positions} {...DEFAULT_PATH_STYLE} {...polylineProps} />;
}
