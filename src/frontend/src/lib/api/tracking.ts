import { publicApiFetch } from './public-transport';
import { ApiRequestError } from './errors';

/** Public-safe validator event exposed through a report's tracking capability. */
export interface PublicTrackingStatusUpdate {
  stage: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Token-gated, public-safe tracking projection. */
export interface PublicTrackingData {
  report_id: number;
  category: string | null;
  sub_category: string | null;
  safety_status: string | null;
  status: string;
  guidance: string | null;
  escalation_guidance: string | null;
  nearest_station_name: string | null;
  nearest_station_phone: string | null;
  routing_distance_m: number | null;
  routing_duration_s: number | null;
  routing_geometry: Record<string, unknown> | null;
  routing_data_source: string | null;
  photo_count: number;
  status_updates: PublicTrackingStatusUpdate[];
  created_at: string;
}

/** Fetch public tracking data using the report's capability token. */
export async function fetchPublicTracking(
  reportId: number,
  trackingToken: string,
): Promise<PublicTrackingData> {
  return publicApiFetch<PublicTrackingData>(
    `/civilian/reports/${reportId}/track/${encodeURIComponent(trackingToken)}`,
  );
}

export type { ApiRequestError };
