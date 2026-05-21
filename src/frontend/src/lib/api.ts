/**
 * Fetch-based API client for FastAPI backend.
 * Uses credentials: 'include' for cookie-based auth.
 */
import type {
  Region,
  Province,
  City,
  Barangay,
  IncidentListItem,
  SecurityLog,
  AuditLogEntry,
  PaginatedResponse,
} from '@/types/api';
import {
  buildRegionalIncidentsQueryString,
  type RegionalIncidentsQueryParams,
} from './regional-incidents';
import { refreshToken } from './auth-refresh';

const API_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL || '/api')
  : process.env.NEXT_PUBLIC_API_URL || 'http://localhost/api';

export class ApiRequestError extends Error {
  status: number;
  detail?: unknown;

  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.detail = detail;
  }
}

function errorMessageFromJson(json: unknown, fallback: string): string {
  if (!json || typeof json !== 'object') return fallback;
  const asObj = json as { message?: unknown; detail?: unknown };
  if (typeof asObj.message === 'string' && asObj.message.trim()) {
    return asObj.message;
  }
  if (typeof asObj.detail === 'string' && asObj.detail.trim()) {
    return asObj.detail;
  }
  if (asObj.detail && typeof asObj.detail === 'object') {
    if (Array.isArray(asObj.detail)) {
      const first = asObj.detail[0] as { msg?: unknown; loc?: unknown } | undefined;
      if (first) {
        const msg = typeof first.msg === 'string' ? first.msg : 'Validation failed';
        const loc = Array.isArray(first.loc) ? first.loc.join('.') : '';
        return loc ? `${loc}: ${msg}` : msg;
      }
      return 'Validation failed';
    }
    const detailObj = asObj.detail as { message?: unknown; code?: unknown };
    if (typeof detailObj.message === 'string' && detailObj.message.trim()) {
      return detailObj.message;
    }
    if (typeof detailObj.code === 'string' && detailObj.code.trim()) {
      return detailObj.code;
    }
  }
  return fallback;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { _retried?: boolean; skipAuthRedirect?: boolean } = {}
): Promise<T> {
  const normalizedPath =
    path === '/api' ? '/' : path.startsWith('/api/') ? path.slice(4) : path;
  const url = normalizedPath.startsWith('http')
    ? normalizedPath
    : `${API_BASE.replace(/\/$/, '')}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
  const headers = new Headers(options.headers ?? {});
  const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (!isFormDataBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const { _retried, skipAuthRedirect, ...fetchOptions } = options;
  const res = await fetch(url, {
    ...fetchOptions,
    credentials: 'include',
    headers,
  });
  if (res.status === 401 && !_retried) {
    try {
      const refreshed = await refreshToken();
      if (refreshed) {
        return apiFetch<T>(path, { ...options, _retried: true });
      }
    } catch { /* ignore, fall through to throw */ }
    // M4 Bug 8-A: callers like AFOR commit can opt out of the global redirect
    // so that a 401 from a single endpoint does not yank the user to /login
    // mid-flow. The caller is then responsible for surfacing the error.
    if (!skipAuthRedirect && typeof window !== 'undefined') {
      window.location.href = '/login';
    } else if (typeof window !== 'undefined') {
      // Signal auth.tsx to re-check the OIDC session (mirrors what F5 does),
      // so the page recovers without a manual refresh.
      window.dispatchEvent(new Event('wims:auth-failed'));
    }
    throw new ApiRequestError('Session expired. Please log in again.', 401);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(
      errorMessageFromJson(json, `Request failed: ${res.status}`),
      res.status,
      (json as { detail?: unknown }).detail,
    );
  }
  return json as T;
}

/** Fetch incidents list - returns [] on error or 404 */
export async function fetchIncidents(params?: { region_id?: number; category?: string; from?: string; to?: string; type?: string }): Promise<IncidentListItem[]> {
  try {
    const search = new URLSearchParams();
    if (params?.region_id) search.set('region_id', String(params.region_id));
    if (params?.category) search.set('category', params.category);
    if (params?.from) search.set('from', params.from);
    if (params?.to) search.set('to', params.to);
    if (params?.type) search.set('type', params.type);
    const qs = search.toString();
    const data = await apiFetch<{ data?: IncidentListItem[]; items?: IncidentListItem[] } | IncidentListItem[]>(`/incidents${qs ? `?${qs}` : ''}`);
    return Array.isArray(data) ? data : (data?.data ?? data?.items ?? []);
  } catch {
    return [];
  }
}

/** Fetch single incident - returns null on error */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchIncident(id: number): Promise<any | null> {
  try {
    return await apiFetch<Record<string, unknown>>(`/incidents/${id}`);
  } catch {
    return null;
  }
}

/** Fetch reference regions - returns [] on error */
export async function fetchRegions(): Promise<Region[]> {
  try {
    const data = await apiFetch<Region[] | { data?: Region[] }>('/ref/regions');
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

/** Fetch provinces by region - returns [] on error */
export async function fetchProvinces(regionId: string | number): Promise<Province[]> {
  try {
    const data = await apiFetch<Province[] | { data?: Province[] }>(`/ref/provinces?region_id=${regionId}`);
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

/** Fetch cities by province - returns [] on error */
export async function fetchCities(provinceId: string | number): Promise<City[]> {
  try {
    const data = await apiFetch<City[] | { data?: City[] }>(`/ref/cities?province_id=${provinceId}`);
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

/** Fetch cities by multiple province IDs - returns [] on error */
export async function fetchCitiesByProvinces(provinceIds: number[]): Promise<City[]> {
  if (provinceIds.length === 0) return [];
  try {
    const data = await apiFetch<City[] | { data?: City[] }>(`/ref/cities?province_ids=${provinceIds.join(',')}`);
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

/** Fetch barangays by city IDs - returns [] on error */
export async function fetchBarangays(cityIds: number[]): Promise<Barangay[]> {
  if (cityIds.length === 0) return [];
  try {
    const data = await apiFetch<Barangay[] | { data?: Barangay[] }>(`/ref/barangays?city_ids=${cityIds.join(',')}`);
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

/** Fetch regions filtered by region_id - returns [] on error */
export async function fetchRegionsByRegionId(regionId: number): Promise<Region[]> {
  try {
    const data = await apiFetch<Region[] | { data?: Region[] }>(`/ref/regions?region_id=${regionId}`);
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

/** Fetch security threat logs - returns [] on error */
export async function fetchSecurityLogs(): Promise<SecurityLog[]> {
  try {
    const data = await apiFetch<SecurityLog[] | { data?: SecurityLog[] }>('/security-threat-logs');
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Admin API (SYSTEM_ADMIN only)
// ---------------------------------------------------------------------------

/** Fetch all users (admin) - returns [] on error */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAdminUsers(): Promise<any[]> {
  try {
    const data = await apiFetch<Record<string, unknown>[] | { data?: Record<string, unknown>[] }>('/admin/users');
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

/** Fetch all active sessions (admin) - returns [] on error */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchActiveSessions(): Promise<any[]> {
  try {
    const data = await apiFetch<Record<string, unknown>[] | { data?: Record<string, unknown>[] }>('/admin/active-sessions');
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

/** Fetch system health (admin) - GET /admin/health */
export async function fetchSystemHealth(): Promise<unknown> {
  return apiFetch('/admin/health');
}

/** Revoke user's sessions (admin) - POST /admin/users/{userId}/logout */
export async function revokeUserSessions(userId: string): Promise<{ status: string }> {
  return apiFetch(`/admin/users/${userId}/logout`, { method: 'POST' });
}

/** Update user (admin) - role, assigned_region_id, is_active */
export async function updateAdminUser(
  userId: string,
  payload: { role?: string; assigned_region_id?: number; is_active?: boolean }
): Promise<{ status: string; user_id: string }> {
  return apiFetch(`/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** Create a new user (admin onboarding) - POST /admin/users */
export async function createAdminUser(payload: {
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  username?: string;
  contact_number?: string;
  assigned_region_id?: number;
}): Promise<{
  status: string;
  keycloak_id: string;
  username: string;
  role: string;
  temporary_password: string;
  note: string;
}> {
  return apiFetch('/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Fetch current user's profile details */
export async function fetchMyProfile(): Promise<{ first_name: string; last_name: string; contact_number: string }> {
  return apiFetch('/user/me/profile');
}

/** Update current user's own profile - PATCH /user/me */
export async function updateMyProfile(payload: {
  first_name?: string;
  last_name?: string;
  // NOTE: email intentionally excluded — government email is SYSADMIN-controlled only.
  // Display-only read is handled separately via GET /user/me/profile (future).
  contact_number?: string;
}): Promise<{ status: string; message: string }> {
  return apiFetch('/user/me', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** Change current user's own password - PATCH /user/me/password */
export async function changeMyPassword(payload: {
  current_password: string;
  new_password: string;
  otp_code?: string;
}): Promise<{ status: string; message: string }> {
  return apiFetch('/user/me/password', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** Fetch security logs (admin) - ordered by timestamp desc */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAdminSecurityLogs(): Promise<any[]> {
  try {
    const data = await apiFetch<Record<string, unknown>[] | { data?: Record<string, unknown>[] }>('/admin/security-logs');
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

/** Analyze security log with AI (admin) - POST /admin/security-logs/{logId}/analyze */
export async function analyzeSecurityLog(logId: number): Promise<{
  log_id: number;
  xai_narrative: string | null;
  xai_confidence: number | null;
  [key: string]: unknown;
}> {
  return apiFetch(`/admin/security-logs/${logId}/analyze`, { method: 'POST' });
}

/** Update security log (admin) - admin_action_taken, resolved_at */
export async function updateAdminSecurityLog(
  logId: number,
  payload: { admin_action_taken?: string; resolved_at?: string }
): Promise<{ status: string; log_id: number }> {
  return apiFetch(`/admin/security-logs/${logId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** Fetch audit logs (admin) - paginated */
export async function fetchAuditLogs(params?: {
  limit?: number;
  offset?: number;
}): Promise<PaginatedResponse<AuditLogEntry>> {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.offset != null) search.set('offset', String(params.offset));
  const qs = search.toString();
  return apiFetch<PaginatedResponse<AuditLogEntry>>(`/admin/audit-logs${qs ? `?${qs}` : ''}`);
}

/** Create incident (geospatial intake) - POST /api/incidents */
export async function createIncident(payload: {
  latitude: number;
  longitude: number;
  description: string;
  verification_status?: string;
}): Promise<{ incident_id: number; latitude: number; longitude: number; status: string; created_at: string }> {
  return apiFetch('/incidents', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      verification_status: payload.verification_status ?? 'PENDING',
    }),
  });
}

// ---------------------------------------------------------------------------
// Triage API (ENCODER/VALIDATOR only)
// ---------------------------------------------------------------------------

/** Fetch pending citizen reports for triage queue — returns [] on error */
export async function fetchPendingReports(): Promise<{
  report_id: number;
  latitude: number;
  longitude: number;
  description: string;
  created_at: string | null;
  status: string;
}[]> {
  try {
    const data = await apiFetch<{
      report_id: number;
      latitude: number;
      longitude: number;
      description: string;
      created_at: string | null;
      status: string;
    }[]>('/triage/pending');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Promote a citizen report to official fire incident. Returns { report_id, incident_id }. */
export async function promoteReport(reportId: number): Promise<{ report_id: number; incident_id: number }> {
  return apiFetch(`/triage/${reportId}/promote`, { method: 'POST' });
}

/** Bulk promote multiple pending citizen reports. Returns { promoted: {report_id, incident_id}[], failed: number[] } */
export async function bulkPromoteReports(reportIds: number[]): Promise<{ promoted: Array<{ report_id: number; incident_id: number }>; failed: number[] }> {
  return apiFetch('/triage/bulk-promote', {
    method: 'POST',
    body: JSON.stringify({ report_ids: reportIds }),
  });
}

/** Submit civilian emergency report — Zero-Trust, NO auth. POST /api/civilian/reports */
export async function submitCivilianReport(payload: {
  latitude: number;
  longitude: number;
  description: string;
}): Promise<{ report_id: number; latitude: number; longitude: number; description: string; trust_score: number; status: string; created_at: string }> {
  const url = `${(typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL || '/api') : process.env.NEXT_PUBLIC_API_URL || 'http://localhost/api').replace(/\/$/, '')}/civilian/reports`;
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as { message?: string; detail?: string }).message ?? (json as { detail?: string }).detail ?? `Request failed: ${res.status}`);
  }
  return json as { report_id: number; latitude: number; longitude: number; description: string; trust_score: number; status: string; created_at: string };
}

/** Track civilian emergency report status — Zero-Trust, NO auth. GET /api/civilian/reports/{id} */
export async function fetchReportStatus(reportId: string | number): Promise<{ report_id: number; latitude: number; longitude: number; description: string; trust_score: number; status: string; created_at: string }> {
  const url = `${(typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL || '/api') : process.env.NEXT_PUBLIC_API_URL || 'http://localhost/api').replace(/\/$/, '')}/civilian/reports/${reportId}`;
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'omit',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as { message?: string; detail?: string }).message ?? (json as { detail?: string }).detail ?? `Request failed: ${res.status}`);
  }
  return json as { report_id: number; latitude: number; longitude: number; description: string; trust_score: number; status: string; created_at: string };
}

export interface FireStation {
  station_id: number;
  station_name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  distance_m: number | null;
}

/** Nearest BFP fire stations — Zero-Trust, NO auth. GET /api/ref/fire-stations */
export async function fetchNearbyStations(lat: number, lon: number): Promise<FireStation[]> {
  const base = (typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL || '/api') : process.env.NEXT_PUBLIC_API_URL || 'http://localhost/api').replace(/\/$/, '');
  const url = `${base}/ref/fire-stations?lat=${lat}&lon=${lon}`;
  const res = await fetch(url, { method: 'GET', credentials: 'omit' });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<FireStation[]>;
}

/** Register FCM token for push notifications on report status change — Zero-Trust, NO auth. POST /api/civilian/reports/{reportId}/notify */
export async function registerNotification(
  reportId: number,
  fcmToken: string,
): Promise<{ status: string; report_id: number }> {
  const base = (typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL || '/api') : process.env.NEXT_PUBLIC_API_URL || 'http://localhost/api').replace(/\/$/, '');
  const url = `${base}/civilian/reports/${reportId}/notify`;
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fcm_token: fcmToken }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as { message?: string; detail?: string }).message ?? (json as { detail?: string }).detail ?? `Request failed: ${res.status}`);
  }
  return json as { status: string; report_id: number };
}

// ---------------------------------------------------------------------------
// Regional API (REGIONAL_ENCODER only)
// ---------------------------------------------------------------------------

export type { RegionalIncidentsQueryParams };

export interface RegionalIncidentListItem {
  incident_id: number;
  verification_status: string;
  created_at: string | null;
  updated_at: string | null;
  notification_dt: string | null;
  general_category: string | null;
  alarm_level: string | null;
  fire_station_name: string | null;
  structures_affected: number | null;
  households_affected: number | null;
  individuals_affected: number | null;
  responder_type: string | null;
  fire_origin: string | null;
  extent_of_damage: string | null;
  owner_name: string | null;
  establishment_name: string | null;
  caller_name: string | null;
  is_wildland: boolean;
  location_display: string | null;
}

export interface RegionalIncidentsListResponse {
  items: RegionalIncidentListItem[];
  total: number;
  limit: number;
  offset: number;
}

/** Single incident detail: nonsensitive/sensitive blocks as returned by the regional endpoint. */
export interface RegionalIncidentDetailResponse {
  incident_id: number;
  verification_status: string;
  created_at: string | null;
  updated_at: string | null;
  region_id: number;
  latitude: number | null;
  longitude: number | null;
  reference_number: string | null;
  incident_type_code: string | null;
  parent_incident_id: number | null;
  is_duplicate: boolean;
  duplicate_of: number | null;
  is_wildland: boolean;
  wildland_fire_type: string | null;
  wildland_area_hectares: number | null;
  wildland_area_display: string | null;
  nonsensitive: Record<string, unknown>;
  sensitive: Record<string, unknown>;
  rejection_reason: string | null;
  rejection_at: string | null;
  attachments?: Array<{
    attachment_id: number;
    file_name: string;
    mime_type: string | null;
    url: string | null;
  }>;
}

export async function fetchRegionalIncidents(
  params?: RegionalIncidentsQueryParams
): Promise<RegionalIncidentsListResponse> {
  const qs = buildRegionalIncidentsQueryString(params ?? {});
  return apiFetch<RegionalIncidentsListResponse>(`/regional/incidents${qs ? `?${qs}` : ''}`);
}

export async function fetchRegionalIncident(
  incidentId: number
): Promise<RegionalIncidentDetailResponse> {
  return apiFetch<RegionalIncidentDetailResponse>(`/regional/incidents/${incidentId}`);
}

export async function createRegionalIncident(
  body: Record<string, unknown>,
  options?: { skipAuthRedirect?: boolean }
): Promise<{ status: string; incident_id: number; verification_status: string }> {
  return apiFetch('/regional/incidents', {
    method: 'POST',
    body: JSON.stringify(body),
    skipAuthRedirect: options?.skipAuthRedirect,
  });
}

export async function updateRegionalIncident(
  incidentId: number,
  body: Record<string, unknown>
): Promise<{ status: string; incident_id: number }> {
  return apiFetch(`/regional/incidents/${incidentId}`, { method: 'PUT', body: JSON.stringify(body) });
}

export async function submitIncidentForReview(
  incidentId: number,
  options?: { skipAuthRedirect?: boolean; ackDuplicate?: boolean; force?: boolean }
): Promise<{ status: string; incident_id: number; verification_status: string; matched_incident_id?: number }> {
  const params = new URLSearchParams();
  if (options?.ackDuplicate) params.set('ack_duplicate', 'true');
  if (options?.force) params.set('force', 'true');
  const qs = params.toString() ? `?${params.toString()}` : '';
  const url = `/regional/incidents/${incidentId}/submit${qs}`;
  return apiFetch(url, {
    method: 'PATCH',
    skipAuthRedirect: options?.skipAuthRedirect,
  });
}

export async function archiveIncident(
  incidentId: number
): Promise<{ status: string; incident_id: number }> {
  return apiFetch(`/regional/validator/incidents/${incidentId}/archive`, { method: 'PATCH' });
}

export async function unpendIncident(
  incidentId: number
): Promise<{ status: string; incident_id: number }> {
  return apiFetch(`/regional/incidents/${incidentId}/unpend`, { method: 'PATCH' });
}

// ── Reference-number based duplicate detection ─────────────────────────────

export interface RefDuplicateIncident {
  incident_id: number;
  reference_number: string | null;
  verification_status: string;
  notification_dt: string | null;
  alarm_level: string | null;
  general_category: string | null;
  incident_type_code: string | null;
  type_of_involved: string | null;
  fire_station_name: string | null;
  station_code: string | null;
  city_municipality: string | null;
  province_district: string | null;
  region_name: string | null;
  street_address: string | null;
}

/**
 * Check whether an incident with the same region + type/category + fire date already exists.
 * Checks reference number space (same month+year+type) and exact-date matches.
 * Returns [] if none found or on error.
 */
export async function checkIncidentDuplicate(params: {
  regionId: number;
  fireDate: string; // YYYY-MM-DD
  incidentTypeCode?: string;
  generalCategory?: string;
}): Promise<RefDuplicateIncident[]> {
  try {
    const qs = new URLSearchParams({ region_id: String(params.regionId), fire_date: params.fireDate });
    if (params.incidentTypeCode) qs.set('incident_type_code', params.incidentTypeCode);
    if (params.generalCategory) qs.set('general_category', params.generalCategory);
    const result = await apiFetch<{ duplicates: RefDuplicateIncident[] }>(
      `/regional/incidents/check-duplicate?${qs.toString()}`
    );
    return result.duplicates ?? [];
  } catch {
    return [];
  }
}

/** Soft-delete a DRAFT, PENDING, or REJECTED incident (sets is_archived = TRUE). */
export async function deleteIncident(incidentId: number): Promise<{ status: string; incident_id: number }> {
  return apiFetch(`/regional/incidents/${incidentId}`, { method: 'DELETE' });
}

/**
 * Replace a PENDING incident's data without withdrawing it first.
 * Used when duplicate detection identifies a PENDING incident that the encoder
 * wants to overwrite directly from the duplicate resolution modal.
 */
export async function forceReplaceIncident(
  incidentId: number,
  payload: Record<string, unknown>,
): Promise<{ status: string; incident_id: number }> {
  return apiFetch(`/regional/incidents/${incidentId}/force-replace`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── M4-E: Dedicated draft endpoints ─────────────────────────────────────────

export interface DraftSummary {
  incident_id: number;
  region_id: number;
  created_at: string | null;
  updated_at: string | null;
  notification_dt: string | null;
  general_category: string | null;
  alarm_level: string | null;
  fire_station_name: string | null;
}

export async function listEncoderDrafts(
  limit = 20,
  offset = 0
): Promise<{ items: DraftSummary[]; total: number; limit: number; offset: number }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return apiFetch(`/regional/incidents/drafts?${params.toString()}`);
}

export async function updateDraft(
  incidentId: number,
  body: Record<string, unknown>
): Promise<{ status: string; incident_id: number }> {
  return apiFetch(`/regional/incidents/draft/${incidentId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteDraft(
  incidentId: number
): Promise<{ status: string; incident_id: number }> {
  return apiFetch(`/regional/incidents/draft/${incidentId}`, { method: 'DELETE' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchRegionalStats(): Promise<any> {
  return apiFetch<Record<string, unknown>>('/regional/stats');
}

export async function fetchValidatorStats(): Promise<{
  total_verified: number;
  pending_validation: number;
  by_category: { category: string; count: number }[];
}> {
  return apiFetch('/regional/validator/stats');
}

export type AforFormKind = 'STRUCTURAL_AFOR' | 'WILDLAND_AFOR';

export interface AforImportPreviewResponse {
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  form_kind: AforFormKind;
  /** When true, the file did not supply reliable coordinates; set WGS84 lat/lon before commit. */
  requires_location?: boolean;
  rows: Array<{
    row_index: number;
    status: string;
    errors: string[];
    data: Record<string, unknown>;
  }>;
}

export async function importAforFile(file: File): Promise<AforImportPreviewResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const url = `${API_BASE.replace(/\/$/, '')}/regional/afor/import`;
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as { message?: string; detail?: string }).message ?? (json as { detail?: string }).detail ?? `Request failed: ${res.status}`);
  }
  return json as AforImportPreviewResponse;
}

export type WildlandRowSource = 'AFOR_IMPORT' | 'MANUAL';

export type DuplicateAction = 'skip' | 'merge' | 'force';

export interface RowResolution {
  row_index: number;
  action: DuplicateAction;
  existing_incident_id?: number | null;
}

export interface DuplicateInfo {
  row_index: number;
  existing_incident_id: number;
  distance_m: number;
  matched_fields: string[];
  incoming_values: Record<string, string | null>;
  existing_values: Record<string, string | null>;
}

export type AforCommitResult =
  | { status: 'ok'; batch_id: number; incident_ids: number[]; total_committed: number }
  | {
      status: 'DUPLICATE_CHECK_REQUIRED';
      duplicates: DuplicateInfo[];
      radius_meters: number;
      min_matching_fields: number;
    };

export async function commitAforImport(
  rows: Record<string, unknown>[],
  formKind: AforFormKind,
  options?: {
    wildlandRowSource?: WildlandRowSource;
    resolutions?: RowResolution[];
    /** WGS84 decimal degrees. PostGIS stores POINT(longitude latitude); not GeoJSON [lat, lon]. */
    latitude?: number;
    longitude?: number;
  }
): Promise<AforCommitResult> {
  const body: Record<string, unknown> = { form_kind: formKind, rows };
  if (options?.wildlandRowSource != null) {
    body.wildland_row_source = options.wildlandRowSource;
  }
  if (options?.resolutions != null) {
    body.resolutions = options.resolutions;
  }
  if (typeof options?.latitude === 'number' && typeof options?.longitude === 'number') {
    body.latitude = options.latitude;
    body.longitude = options.longitude;
  }
  return apiFetch('/regional/afor/commit', {
    method: 'POST',
    body: JSON.stringify(body),
    // M4 Bug 8-A: handle errors locally on the import page; do not force /login
    skipAuthRedirect: true,
  });
}

// ---------------------------------------------------------------------------
// Analytics API (NATIONAL_ANALYST, SYSTEM_ADMIN only)
// ---------------------------------------------------------------------------

export interface HeatmapFeatureProperties {
  incident_id: number;
  alarm_level: string | null;
  general_category: string | null;
  notification_dt: string | null;
}

export interface HeatmapGeoJSON {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: HeatmapFeatureProperties;
  }>;
}

export interface TrendsResponse {
  data: Array<{ bucket: string | null; count: number }>;
}

export interface ComparativeResponse {
  range_a: { start: string; end: string; count: number };
  range_b: { start: string; end: string; count: number };
  variance_percent: number;
}

export interface HeatmapFilters {
  start_date?: string;
  end_date?: string;
  region_id?: number;
  province?: string;
  municipality?: string;
  alarm_level?: string;
  /** API query `incident_type` filters `general_category` in analytics_incident_facts */
  incident_type?: string;
  casualty_severity?: 'high' | 'medium' | 'low' | string;
  damage_min?: number;
  damage_max?: number;
}

export interface TrendFilters extends HeatmapFilters {
  interval?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
}

export interface ComparativeFilters {
  range_a_start: string;
  range_a_end: string;
  range_b_start: string;
  range_b_end: string;
  region_id?: number;
  province?: string;
  municipality?: string;
  incident_type?: string;
  alarm_level?: string;
  casualty_severity?: 'high' | 'medium' | 'low' | string;
  damage_min?: number;
  damage_max?: number;
}

function buildAnalyticsParams(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, String(v));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/** Fetch heatmap GeoJSON for verified incidents. Requires NATIONAL_ANALYST or SYSTEM_ADMIN. */
export async function fetchHeatmapData(filters: HeatmapFilters = {}): Promise<HeatmapGeoJSON> {
  const qs = buildAnalyticsParams({
    start_date: filters.start_date,
    end_date: filters.end_date,
    region_id: filters.region_id,
    province: filters.province,
    municipality: filters.municipality,
    alarm_level: filters.alarm_level,
    incident_type: filters.incident_type,
    casualty_severity: filters.casualty_severity,
    damage_min: filters.damage_min,
    damage_max: filters.damage_max,
  });
  return apiFetch<HeatmapGeoJSON>(`/analytics/heatmap${qs}`);
}

/** Fetch trends time-series data. Requires NATIONAL_ANALYST or SYSTEM_ADMIN. */
export async function fetchTrendData(filters: TrendFilters = {}): Promise<TrendsResponse> {
  const qs = buildAnalyticsParams({
    start_date: filters.start_date,
    end_date: filters.end_date,
    region_id: filters.region_id,
    province: filters.province,
    municipality: filters.municipality,
    incident_type: filters.incident_type,
    alarm_level: filters.alarm_level,
    casualty_severity: filters.casualty_severity,
    damage_min: filters.damage_min,
    damage_max: filters.damage_max,
    interval: filters.interval ?? 'daily',
  });
  return apiFetch<TrendsResponse>(`/analytics/trends${qs}`);
}

/** Fetch comparative counts for two date ranges. Requires NATIONAL_ANALYST or SYSTEM_ADMIN. */
export async function fetchComparativeData(filters: ComparativeFilters): Promise<ComparativeResponse> {
  const qs = buildAnalyticsParams({
    range_a_start: filters.range_a_start,
    range_a_end: filters.range_a_end,
    range_b_start: filters.range_b_start,
    range_b_end: filters.range_b_end,
    region_id: filters.region_id,
    province: filters.province,
    municipality: filters.municipality,
    incident_type: filters.incident_type,
    alarm_level: filters.alarm_level,
    casualty_severity: filters.casualty_severity,
    damage_min: filters.damage_min,
    damage_max: filters.damage_max,
  });
  return apiFetch<ComparativeResponse>(`/analytics/comparative${qs}`);
}

// ---------------------------------------------------------------------------
// AQ-06 / AQ-07 / AQ-08 / AQ-13 / AQ-14 — New analytics types and functions
// ---------------------------------------------------------------------------

export interface TypeDistributionItem {
  type: string;
  count: number;
}

export interface ResponseTimeRegionItem {
  region_id: number;
  region_name: string;
  avg_response_time: number;
  min_response_time: number;
  max_response_time: number;
}

export interface CompareRegionItem {
  region_id: number;
  region_name: string;
  total_incidents: number;
  avg_response_time: number | null;
  top_type: string | null;
}

export interface TopNItem {
  name: string;
  value: number;
}

export type AnalyticsFilterOptionsField = 'province' | 'municipality';

export interface AnalyticsGlobalFilters extends HeatmapFilters {
  interval?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
}

export async function fetchTypeDistribution(filters: AnalyticsGlobalFilters = {}): Promise<TypeDistributionItem[]> {
  const qs = buildAnalyticsParams({
    start_date: filters.start_date,
    end_date: filters.end_date,
    region_id: filters.region_id,
    province: filters.province,
    municipality: filters.municipality,
    alarm_level: filters.alarm_level,
    casualty_severity: filters.casualty_severity,
    damage_min: filters.damage_min,
    damage_max: filters.damage_max,
  });
  return apiFetch<TypeDistributionItem[]>(`/analytics/type-distribution${qs}`);
}

export async function fetchResponseTimeByRegion(filters: AnalyticsGlobalFilters = {}): Promise<ResponseTimeRegionItem[]> {
  const qs = buildAnalyticsParams({
    start_date: filters.start_date,
    end_date: filters.end_date,
    region_id: filters.region_id,
    province: filters.province,
    municipality: filters.municipality,
    incident_type: filters.incident_type,
    alarm_level: filters.alarm_level,
    casualty_severity: filters.casualty_severity,
    damage_min: filters.damage_min,
    damage_max: filters.damage_max,
  });
  return apiFetch<ResponseTimeRegionItem[]>(`/analytics/response-time-by-region${qs}`);
}

export async function fetchCompareRegions(filters: AnalyticsGlobalFilters & { region_ids: string }): Promise<CompareRegionItem[]> {
  const qs = buildAnalyticsParams({
    region_ids: filters.region_ids,
    start_date: filters.start_date,
    end_date: filters.end_date,
    province: filters.province,
    municipality: filters.municipality,
    incident_type: filters.incident_type,
    alarm_level: filters.alarm_level,
    casualty_severity: filters.casualty_severity,
    damage_min: filters.damage_min,
    damage_max: filters.damage_max,
  });
  return apiFetch<CompareRegionItem[]>(`/analytics/compare-regions${qs}`);
}

export async function fetchTopN(filters: AnalyticsGlobalFilters & { metric: string; dimension: string; limit?: number }): Promise<TopNItem[]> {
  const qs = buildAnalyticsParams({
    metric: filters.metric,
    dimension: filters.dimension,
    limit: filters.limit,
    start_date: filters.start_date,
    end_date: filters.end_date,
    region_id: filters.region_id,
    province: filters.province,
    municipality: filters.municipality,
    incident_type: filters.incident_type,
    alarm_level: filters.alarm_level,
    casualty_severity: filters.casualty_severity,
    damage_min: filters.damage_min,
    damage_max: filters.damage_max,
  });
  return apiFetch<TopNItem[]>(`/analytics/top-n${qs}`);
}

export async function fetchAnalyticsFilterOptions(
  field: AnalyticsFilterOptionsField,
  filters: Pick<AnalyticsGlobalFilters, 'region_id' | 'province' | 'start_date' | 'end_date'> = {}
): Promise<string[]> {
  const qs = buildAnalyticsParams({
    field,
    region_id: filters.region_id,
    province: filters.province,
    start_date: filters.start_date,
    end_date: filters.end_date,
  });
  return apiFetch<string[]>(`/analytics/filter-options${qs}`);
}

// ---------------------------------------------------------------------------
// National Analyst — Incident List & Detail (p5a / p5e)
// ---------------------------------------------------------------------------

export interface AnalystIncidentListItem {
  incident_id: number;
  notification_dt: string | null;
  province_name: string;
  municipality_name: string;
  barangay_name: string;
  general_category: string;
  sub_category: string;
  alarm_level: string;
  estimated_damage_php: number | null;
  total_response_time_minutes: number | null;
  region: string;
  verification_status: string;
  reference_number: string | null;
  created_at: string | null;
}

export interface AnalystIncidentListResponse {
  incidents: AnalystIncidentListItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface AnalystIncidentDetailResponse extends AnalystIncidentListItem {
  encoder_id: string;
  encoder_username: string | null;
  casualty_severity: string | null;
  data_hash: string | null;
  sync_status: string | null;
  has_wildland_afor: boolean;
  form_kind: 'STRUCTURAL_AFOR' | 'WILDLAND_AFOR';
  // Full nonsensitive detail
  fire_origin: string | null;
  extent_of_damage: string | null;
  structures_affected: number | null;
  households_affected: number | null;
  individuals_affected: number | null;
  vehicles_affected: number | null;
  resources_deployed: Record<string, unknown> | null;
  alarm_timeline: Array<{
    alarm_level: string;
    time: string;
    commander: string;
  }> | null;
  problems_encountered: string[] | null;
  stage_of_fire: string | null;
  extent_total_floor_area_sqm: number | null;
  extent_total_land_area_hectares: number | null;
  water_tankers_used: number | null;
  breathing_apparatus_used: number | null;
  total_gas_consumed_liters: number | null;
  families_affected: number | null;
  responder_type: string | null;
  fire_station_name: string | null;
  distance_from_station_km: number | null;
  // Inline wildland — present when has_wildland_afor = true
  wildland?: Record<string, unknown>;
  alarm_statuses?: Array<{
    sort_order: number;
    alarm_status: string;
    time_declared: string | null;
    ground_commander: string | null;
  }>;
  assistance_rows?: Array<{
    sort_order: number;
    organization_or_unit: string;
    detail: string | null;
  }>;
}

export interface AnalystIncidentSensitiveResponse {
  incident_id: number;
  fire_origin: string | null;
  extent_of_damage: string | null;
  narrative_report: string | null;
  prepared_by_officer: string | null;
  noted_by_officer: string | null;
  disposition: string | null;
  caller_name: string | null;
  caller_number: string | null;
  owner_name: string | null;
  establishment_name: string | null;
  occupant_name: string | null;
  alarm_timeline: Array<{
    alarm_level: string;
    time: string;
    commander: string;
  }> | null;
}

export interface AnalystIncidentWildlandDetailResponse {
  incident_id: number;
  reference_number: string | null;
  wildland: Record<string, unknown>;
  alarm_statuses: Array<{
    sort_order: number;
    alarm_status: string;
    time_declared: string | null;
    ground_commander: string | null;
  }>;
  assistance_rows: Array<{
    sort_order: number;
    organization_or_unit: string;
    detail: string | null;
  }>;
}

export type AnalystListSortField =
  | 'notification_dt'
  | 'region'
  | 'municipality_name'
  | 'barangay_name'
  | 'general_category'
  | 'sub_category'
  | 'alarm_level'
  | 'estimated_damage_php'
  | 'total_response_time_minutes';

export type SortDirection = 'asc' | 'desc';

export interface AnalystIncidentListParams {
  start_date?: string;
  end_date?: string;
  region_id?: number;
  province?: string;
  municipality?: string;
  incident_type?: string;
  alarm_level?: string;
  casualty_severity?: 'high' | 'medium' | 'low';
  damage_min?: number;
  damage_max?: number;
  incident_ids?: number[];
  page?: number;
  page_size?: number;
  sort_by?: AnalystListSortField;
  sort_dir?: SortDirection;
}

function buildAnalystIncidentListParams(params: AnalystIncidentListParams): string {
  const parts: string[] = [];
  if (params.start_date) parts.push(`start_date=${encodeURIComponent(params.start_date)}`);
  if (params.end_date) parts.push(`end_date=${encodeURIComponent(params.end_date)}`);
  if (params.region_id) parts.push(`region_id=${params.region_id}`);
  if (params.province) parts.push(`province=${encodeURIComponent(params.province)}`);
  if (params.municipality) parts.push(`municipality=${encodeURIComponent(params.municipality)}`);
  if (params.incident_type) parts.push(`incident_type=${encodeURIComponent(params.incident_type)}`);
  if (params.alarm_level) parts.push(`alarm_level=${encodeURIComponent(params.alarm_level)}`);
  if (params.casualty_severity) parts.push(`casualty_severity=${params.casualty_severity}`);
  if (params.damage_min !== undefined) parts.push(`damage_min=${params.damage_min}`);
  if (params.damage_max !== undefined) parts.push(`damage_max=${params.damage_max}`);
  if (params.incident_ids && params.incident_ids.length > 0) parts.push(`incident_ids=${encodeURIComponent(params.incident_ids.join(','))}`);
  if (params.page !== undefined) parts.push(`page=${params.page}`);
  if (params.page_size !== undefined) parts.push(`page_size=${params.page_size}`);
  if (params.sort_by) parts.push(`sort_by=${params.sort_by}`);
  if (params.sort_dir) parts.push(`sort_dir=${params.sort_dir}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export async function fetchAnalystIncidentList(
  params: AnalystIncidentListParams = {}
): Promise<AnalystIncidentListResponse> {
  const qs = buildAnalystIncidentListParams(params);
  return apiFetch<AnalystIncidentListResponse>(`/incidents/analyst-list${qs}`);
}

export async function fetchAnalystIncidentDetail(
  incidentId: number
): Promise<AnalystIncidentDetailResponse> {
  return apiFetch<AnalystIncidentDetailResponse>(`/incidents/analyst/${incidentId}`);
}

export async function fetchAnalystIncidentSensitive(
  incidentId: number
): Promise<AnalystIncidentSensitiveResponse> {
  return apiFetch<AnalystIncidentSensitiveResponse>(`/incidents/analyst/${incidentId}/sensitive`);
}

export async function fetchAnalystIncidentWildlandDetail(
  incidentId: number
): Promise<AnalystIncidentWildlandDetailResponse> {
  return apiFetch<AnalystIncidentWildlandDetailResponse>(`/incidents/analyst/${incidentId}/wildland`);
}

export interface QueueAnalyticsExportRequest {
  format: 'csv' | 'pdf' | 'excel';
  filters: Record<string, unknown>;
  columns: string[];
}

export async function queueAnalyticsExport(request: QueueAnalyticsExportRequest): Promise<{ task_id: string }> {
  const { format, filters, columns } = request;
  return apiFetch<{ task_id: string }>(`/analytics/export/${format}`, {
    method: 'POST',
    body: JSON.stringify({ filters, columns }),
  });
}

export async function downloadAnalyticsExport(taskId: string): Promise<Blob> {
  const path = `/analytics/export/${encodeURIComponent(taskId)}`;
  const normalizedPath = path.startsWith('/api/') ? path.slice(4) : path;
  const url = `${API_BASE.replace(/\/$/, '')}${normalizedPath}`;
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      errorMessageFromJson(json, `Export download failed: ${response.status}`),
      response.status,
      (json as { detail?: unknown }).detail,
    );
  }
  return response.blob();
}

// ---------------------------------------------------------------------------
// Sessions API (SYSTEM_ADMIN only)
// ---------------------------------------------------------------------------

export interface KeycloakSession {
  id: string;
  ipAddress: string;
  start: number;
  lastAccess: number;
  username?: string;
}

/** List all active Keycloak sessions for a user by internal WIMS user_id. */
export async function fetchUserSessions(
  userId: string
): Promise<{ sessions: KeycloakSession[] }> {
  return apiFetch<{ sessions: KeycloakSession[] }>(`/admin/sessions/${userId}`);
}

/** Terminate all active sessions for a user; Keycloak adapter revokes all sessions. */
export async function terminateUserSessions(
  userId: string,
  sessionId: string
): Promise<{ status: string; user_id: string }> {
  return apiFetch<{ status: string; user_id: string }>(
    `/admin/sessions/${userId}/${sessionId}`,
    { method: 'DELETE' }
  );
}
