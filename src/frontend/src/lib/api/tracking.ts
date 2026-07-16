/**
 * Token-gated public tracking fetch for the Report Wizard receipt route
 * feedback. Uses the SAME zero-trust transport as the dedicated tracking page
 * (GET /civilian/reports/{report_id}/track/{tracking_token}). No cookies, no
 * auth — the tracking token is the capability secret.
 *
 * Issue #613: the receipt uses this to drive the PENDING/SUCCESS/FAILED
 * routing state machine. The backend does NOT return a road polyline; the
 * frontend renders a straight line for all states (see RouteFeedback.tsx).
 */
import { publicApiFetch } from './public-transport';
import { ApiRequestError } from './errors';

export interface PublicTrackingData {
  report_id: number;
  category: string | null;
  sub_category: string | null;
  reporting_context: string | null;
  safety_status: string | null;
  status: string;
  status_explanation: string | null;
  guidance: string | null;
  escalation_guidance: string | null;
  related_cluster_status: string | null;
  nearest_station_name: string | null;
  nearest_station_phone: string | null;
  routing_distance_m: number | null;
  routing_duration_s: number | null;
  // Backend CivilianTrackingResponse exposes routing_geometry (dict | None).
  // FE-613 renders a straight line for all states; this field is captured for
  // completeness but not used for rendering. See RouteFeedback gap comment.
  routing_geometry: Record<string, unknown> | null;
  routing_data_source: string | null;
  photo_count: number;
  submitter_type: string;
  link_count: number;
  created_at: string;
}

/**
 * Fetch public tracking data for a submitted report by its tracking token.
 * Throws ApiRequestError on 404 (invalid/expired token) like the tracking page.
 */
export async function fetchPublicTracking(
  reportId: number,
  trackingToken: string,
): Promise<PublicTrackingData> {
  return publicApiFetch<PublicTrackingData>(
    `/civilian/reports/${reportId}/track/${encodeURIComponent(trackingToken)}`,
  );
}

export type { ApiRequestError };
