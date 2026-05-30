export {
  fetchBarangays,
  fetchCities,
  fetchCitiesByProvinces,
  fetchNearbyStations,
  fetchProvinces,
  fetchRegions,
  fetchRegionsByRegionId,
} from './legacy';

export type { FireStation } from './legacy';
import { publicApiFetch } from './public-transport';

export interface EmergencyServiceStation {
  station_id: number;
  station_name: string;
  latitude: number;
  longitude: number;
  distance_m: number | null;
}

export interface EmergencyServiceResponse {
  emergency_number: string;
  nearest_station_ids: number[];
  stations: EmergencyServiceStation[];
  stale: boolean;
  degraded: boolean;
}

export async function fetchEmergencyServices(lat?: number, lon?: number): Promise<EmergencyServiceResponse> {
  const params = new URLSearchParams();
  if (lat !== undefined && lon !== undefined) {
    params.set('lat', lat.toString());
    params.set('lon', lon.toString());
  }
  const qs = params.toString();
  return publicApiFetch<EmergencyServiceResponse>(`/ref/emergency-services${qs ? `?${qs}` : ''}`);
}
