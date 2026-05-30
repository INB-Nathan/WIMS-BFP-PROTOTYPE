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

export interface EmergencyServicesResponse {
  national: EmergencyContact[];
  stations: NearbyStation[];
  cached_at: string | null;
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
