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

const API_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL || '/api')
  : process.env.NEXT_PUBLIC_API_URL || 'http://localhost/api';

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as { message?: string; detail?: string }).message ?? (json as { detail?: string }).detail ?? `Request failed: ${res.status}`);
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

// ---------------------------------------------------------------------------
// Regional API (REGIONAL_ENCODER only)
// ---------------------------------------------------------------------------

export type { RegionalIncidentsQueryParams };

export interface RegionalIncidentListItem {
  incident_id: number;
  verification_status: string;
  created_at: string | null;
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
  region_id: number;
  nonsensitive: Record<string, unknown>;
  sensitive: Record<string, unknown>;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchRegionalStats(): Promise<any> {
  return apiFetch<Record<string, unknown>>('/regional/stats');
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

export async function commitAforImport(
  rows: Record<string, unknown>[],
  formKind: AforFormKind,
  options?: {
    wildlandRowSource?: WildlandRowSource;
    /** WGS84 decimal degrees. PostGIS stores POINT(longitude latitude); not GeoJSON [lat, lon]. */
    latitude?: number;
    longitude?: number;
  }
): Promise<{ status: string; batch_id: number; incident_ids: number[]; total_committed: number }> {
  const body: Record<string, unknown> = { form_kind: formKind, rows };
  if (options?.wildlandRowSource != null) {
    body.wildland_row_source = options.wildlandRowSource;
  }
  if (typeof options?.latitude === 'number' && typeof options?.longitude === 'number') {
    body.latitude = options.latitude;
    body.longitude = options.longitude;
  }
  return apiFetch('/regional/afor/commit', {
    method: 'POST',
    body: JSON.stringify(body),
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
  alarm_level?: string;
  /** API query `incident_type` filters `general_category` in analytics_incident_facts */
  incident_type?: string;
}

export interface TrendFilters {
  start_date?: string;
  end_date?: string;
  region_id?: number;
  /** API query `incident_type` filters `general_category` */
  incident_type?: string;
  alarm_level?: string;
  interval?: 'daily' | 'weekly' | 'monthly';
}

export interface ComparativeFilters {
  range_a_start: string;
  range_a_end: string;
  range_b_start: string;
  range_b_end: string;
  region_id?: number;
  incident_type?: string;
  alarm_level?: string;
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
    alarm_level: filters.alarm_level,
    incident_type: filters.incident_type,
  });
  return apiFetch<HeatmapGeoJSON>(`/analytics/heatmap${qs}`);
}

/** Fetch trends time-series data. Requires NATIONAL_ANALYST or SYSTEM_ADMIN. */
export async function fetchTrendData(filters: TrendFilters = {}): Promise<TrendsResponse> {
  const qs = buildAnalyticsParams({
    start_date: filters.start_date,
    end_date: filters.end_date,
    region_id: filters.region_id,
    incident_type: filters.incident_type,
    alarm_level: filters.alarm_level,
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
    incident_type: filters.incident_type,
    alarm_level: filters.alarm_level,
  });
  return apiFetch<ComparativeResponse>(`/analytics/comparative${qs}`);
}

