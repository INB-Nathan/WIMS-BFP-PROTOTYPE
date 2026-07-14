export {
  appendCivilianReport,
  fetchCivilianDuplicateSuggestions,
  submitCivilianReport,
  submitCivilianReportV2,
  submitFollowup,
} from './legacy';

export type {
  CivilianCategory,
  CivilianDuplicateSuggestion,
  CivilianFollowupItem,
  CivilianFollowupResponse,
  CivilianReportTrackingResponse,
  CivilianReportV2Payload,
  CivilianReportV2Response,
  ReportingContext,
  SafetyStatus,
} from './legacy';
import { publicApiFetch, fetchWithOptionalAuth } from './public-transport';
import type { CivilianReportTrackingResponse } from './legacy';

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

export interface UploadPhotoResponse {
  photo_id: string | null;  // null when duplicate (idempotent retry)
  report_id: number;
  file_size_bytes: number;
  mime_type: string;
  image_width: number;
  image_height: number;
  exif_gps_status: string;
  browser_gps_status: string;
  gps_consensus: string | null;
  photo_reported_distance_m: number | null;
}

/**
 * Upload a civilian-report photo — supports optional_auth.
 * POST /api/civilian/reports/{reportId}/photos with multipart/form-data.
 * Browser GPS fields are included only when a complete sample is provided.
 * Do NOT set multipart Content-Type header manually.
 */
export async function uploadCivilianReportPhoto(
  reportId: number,
  file: File,
  deviceId: string,
  browserGps?: {
    latitude: number;
    longitude: number;
    accuracy: number;
    capturedAt: string;
  },
  exifGps?: {
    latitude: number;
    longitude: number;
    altitude: number | null;
    timestamp: string | null;
  },
  clientPhotoId?: string,
  /** Cloudflare Turnstile token for anonymous CAPTCHA verification. */
  turnstileToken?: string,
): Promise<UploadPhotoResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('device_id', deviceId);

  if (browserGps) {
    formData.append('browser_gps_lat', browserGps.latitude.toString());
    formData.append('browser_gps_lon', browserGps.longitude.toString());
    formData.append('browser_gps_accuracy', browserGps.accuracy.toString());
    formData.append('browser_gps_captured_at', browserGps.capturedAt);
  }

  if (exifGps) {
    formData.append('exif_gps_lat', exifGps.latitude.toString());
    formData.append('exif_gps_lon', exifGps.longitude.toString());
    if (exifGps.altitude !== null) {
      formData.append('exif_gps_altitude', exifGps.altitude.toString());
    }
    if (exifGps.timestamp !== null) {
      formData.append('exif_datetime_original', exifGps.timestamp);
    }
  }

  if (clientPhotoId) {
    formData.append('client_photo_id', clientPhotoId);
  }

  if (turnstileToken) {
    formData.append('turnstile_token', turnstileToken);
  }

  return fetchWithOptionalAuth<UploadPhotoResponse>(
    `/civilian/reports/${reportId}/photos`,
    {
      method: 'POST',
      body: formData,
    },
  );
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

export async function fetchReportStatus(
  reportId: string | number,
  deviceId: string,
): Promise<CivilianReportTrackingResponse> {
  return publicApiFetch<CivilianReportTrackingResponse>(
    `/civilian/reports/${reportId}?device_id=${encodeURIComponent(deviceId)}`,
  );
}

// ── Civilian self-service registration (PR4) ────────────────────────────────

export interface CivilianRegisterPayload {
  email: string;
  first_name: string;
  last_name: string;
  password: string;
  contact_number: string;
  dpa_consent: boolean;
  turnstile_token: string;
}

/** Response body for successful civilian registration (mirrors backend RegisterResponse). */
export interface RegisterResponse {
  status: string;
  message: string;
  email: string;
  user_id?: string | null;
}

/** Response body for successful email verification (mirrors backend VerifyRegistrationResponse). */
export interface VerifyRegistrationResponse {
  status: string;
  message: string;
}

/**
 * Public fetch for anonymous civilian endpoints. Zero-trust: never sends
 * cookies, never redirects to login. Use for self-service registration.
 */
export const apiFetch = publicApiFetch;

/**
 * POST /api/auth/register — civilian self-service signup.
 * Returns the backend RegisterResponse on HTTP 201. Throws ApiRequestError
 * on validation / rate-limit / server failures so the caller can surface a
 * message.
 */
export async function registerCivilian(
  payload: CivilianRegisterPayload,
): Promise<RegisterResponse> {
  return apiFetch<RegisterResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * POST /api/auth/verify-registration — finalize civilian self-service signup.
 * Verifies the 6-digit code emailed during /register and enables the account.
 * Returns the backend VerifyRegistrationResponse on HTTP 200. Throws
 * ApiRequestError on invalid/expired code or server failures so the caller can
 * surface a message.
 */
export async function verifyCivilianRegistration(
  payload: { email: string; code: string },
): Promise<VerifyRegistrationResponse> {
  return apiFetch<VerifyRegistrationResponse>('/auth/verify-registration', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
