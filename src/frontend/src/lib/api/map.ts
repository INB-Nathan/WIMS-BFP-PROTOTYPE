/**
 * Public map API slice — cluster markers, emergency services.
 *
 * These endpoints are PUBLIC (no auth) and use publicApiFetch which
 * omits credentials. All endpoints are read-only.
 */
import { publicApiFetch } from './public-transport';

// ── Types ──────────────────────────────────────────────────────────────────

export interface MapClusterItem {
  lat: number;
  lng: number;
  count: number;
  severity: 'low' | 'medium' | 'high';
  latest_at: string | null;
  status_breakdown?: Record<string, number>;
  category_mix?: string[];
  total_damage_php?: number;
  total_casualties?: number;
  earliest_at?: string | null;
  region_id?: number;
}

export interface ClusterResponse {
  clusters: MapClusterItem[];
  cached_at: string | null;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  description: string;
}

export interface NearbyStation {
  name: string;
  address: string;
  region: string;
  lat: number;
  lng: number;
  distance_m: number;
}

export interface StationItem {
  station_id: number;
  station_name: string;
  address: string | null;
  region_name: string | null;
  latitude: number;
  longitude: number;
}

export interface EmergencyServicesResponse {
  national: EmergencyContact[];
  stations: NearbyStation[];
  cached_at: string | null;
}

/**
 * Fetch BFP fire stations nearest to a coordinate. Public (zero-trust, no
 * auth) GET /ref/fire-stations?lat=...&lon=... returns stations sorted by
 * distance. The receipt uses the nearest station as the straight-line
 * routing target. Returns StationItem[] (id, name, address, region, lat, lng).
 */
export async function fetchStations(
  lat: number,
  lon: number,
): Promise<StationItem[]> {
  const params = new URLSearchParams({
    lat: lat.toFixed(6),
    lon: lon.toFixed(6),
  });
  // Public backend route serves stations nearest to the given coordinates.
  const data = await publicApiFetch<{
    stations?: Array<{
      station_id: number;
      station_name: string;
      address: string | null;
      region_name: string | null;
      latitude: number;
      longitude: number;
    }>;
  }>(`/ref/fire-stations?${params}`);
  return (data.stations ?? []).map((s) => ({
    station_id: s.station_id,
    station_name: s.station_name,
    address: s.address,
    region_name: s.region_name,
    latitude: s.latitude,
    longitude: s.longitude,
  }));
}

// ── API calls ───────────────────────────────────────────────────────────────

/**
 * Fetch clustered fire incident markers within a bounding box.
 *
 * @param sw - South-west corner [lat, lng]
 * @param ne - North-east corner [lat, lng]
 * @param zoom - Map zoom level (4-18) controls clustering resolution
 */
export async function fetchClusters(
  sw: [number, number],
  ne: [number, number],
  zoom: number = 10,
): Promise<ClusterResponse> {
  const params = new URLSearchParams({
    sw_lat: sw[0].toFixed(6),
    sw_lng: sw[1].toFixed(6),
    ne_lat: ne[0].toFixed(6),
    ne_lng: ne[1].toFixed(6),
    zoom: String(zoom),
  });
  return publicApiFetch<ClusterResponse>(`/api/public/clusters?${params}`);
}
