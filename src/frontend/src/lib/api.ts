/**
 * Fetch-based API client for FastAPI backend.
 * Uses credentials: 'include' for cookie-based auth.
 */
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
export async function fetchIncidents(params?: { region_id?: number; category?: string; from?: string; to?: string; type?: string }): Promise<any[]> {
  try {
    const search = new URLSearchParams();
    if (params?.region_id) search.set('region_id', String(params.region_id));
    if (params?.category) search.set('category', params.category);
    if (params?.from) search.set('from', params.from);
    if (params?.to) search.set('to', params.to);
    if (params?.type) search.set('type', params.type);
    const qs = search.toString();
    const data = await apiFetch<{ data?: any[]; items?: any[] } | any[]>(`/incidents${qs ? `?${qs}` : ''}`);
    return Array.isArray(data) ? data : (data?.data ?? data?.items ?? []);
  } catch {
    return [];
  }
}

/** Fetch single incident - returns null on error */
export async function fetchIncident(id: number): Promise<any | null> {
  try {
    return await apiFetch<any>(`/incidents/${id}`);
  } catch {
    return null;
  }
}

/** Fetch reference regions - returns [] on error */
export async function fetchRegions(): Promise<any[]> {
  try {
    const data = await apiFetch<any[] | { data?: any[] }>('/ref/regions');
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

/** Fetch provinces by region - returns [] on error */
export async function fetchProvinces(regionId: string | number): Promise<any[]> {
  try {
    const data = await apiFetch<any[] | { data?: any[] }>(`/ref/provinces?region_id=${regionId}`);
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

/** Fetch cities by province - returns [] on error */
export async function fetchCities(provinceId: string | number): Promise<any[]> {
  try {
    const data = await apiFetch<any[] | { data?: any[] }>(`/ref/cities?province_id=${provinceId}`);
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

/** Fetch cities by multiple province IDs - returns [] on error */
export async function fetchCitiesByProvinces(provinceIds: number[]): Promise<any[]> {
  if (provinceIds.length === 0) return [];
  try {
    const data = await apiFetch<any[] | { data?: any[] }>(`/ref/cities?province_ids=${provinceIds.join(',')}`);
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

/** Fetch barangays by city IDs - returns [] on error */
export async function fetchBarangays(cityIds: number[]): Promise<any[]> {
  if (cityIds.length === 0) return [];
  try {
    const data = await apiFetch<any[] | { data?: any[] }>(`/ref/barangays?city_ids=${cityIds.join(',')}`);
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

/** Fetch regions filtered by region_id - returns [] on error */
export async function fetchRegionsByRegionId(regionId: number): Promise<any[]> {
  try {
    const data = await apiFetch<any[] | { data?: any[] }>(`/ref/regions?region_id=${regionId}`);
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

/** Fetch security threat logs - returns [] on error */
export async function fetchSecurityLogs(): Promise<any[]> {
  try {
    const data = await apiFetch<any[] | { data?: any[] }>('/security-threat-logs');
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Admin API (SYSTEM_ADMIN only)
// ---------------------------------------------------------------------------

/** Fetch all users (admin) - returns [] on error */
export async function fetchAdminUsers(): Promise<any[]> {
  try {
    const data = await apiFetch<any[] | { data?: any[] }>('/admin/users');
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
export async function fetchAdminSecurityLogs(): Promise<any[]> {
  try {
    const data = await apiFetch<any[] | { data?: any[] }>('/admin/security-logs');
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
}): Promise<{ items: any[]; total: number; limit: number; offset: number }> {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.offset != null) search.set('offset', String(params.offset));
  const qs = search.toString();
  return apiFetch(`/admin/audit-logs${qs ? `?${qs}` : ''}`);
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
    const data = await apiFetch<any[]>('/triage/pending');
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
