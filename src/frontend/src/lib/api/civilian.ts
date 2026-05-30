export {
  appendCivilianReport,
  fetchCivilianDuplicateSuggestions,
  fetchMyReports,
  fetchReportStatus,
  fetchReportTimeline,
  registerNotification,
  submitCivilianReport,
  submitCivilianReportV2,
} from './legacy';

export type {
  CivilianCategory,
  CivilianDuplicateSuggestion,
  CivilianReportTimelineItem,
  CivilianReportTrackingResponse,
  CivilianReportV2Payload,
  CivilianReportV2Response,
  MyReportItem,
  MyReportResponse,
  ReportingContext,
  SafetyStatus,
} from './legacy';
import { publicApiFetch } from './public-transport';

export interface ReportClusterCenter {
  latitude: number;
  longitude: number;
}

export interface ReportClusterArea {
  area_id: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  count_bucket: string;
  age_bucket: string;
}

export interface ReportClusterResponse {
  mode: 'local' | 'national';
  center: ReportClusterCenter | null;
  radius_m: number | null;
  window_minutes: number;
  min_reports: number;
  truncated: boolean;
  stale: boolean;
  degraded: boolean;
  areas: ReportClusterArea[];
}

export async function fetchReportClusters(lat?: number, lon?: number): Promise<ReportClusterResponse> {
  const params = new URLSearchParams();
  if (lat !== undefined && lon !== undefined) {
    params.set('lat', lat.toString());
    params.set('lon', lon.toString());
  }
  const qs = params.toString();
  return publicApiFetch<ReportClusterResponse>(`/civilian/report-clusters${qs ? `?${qs}` : ''}`);
}
