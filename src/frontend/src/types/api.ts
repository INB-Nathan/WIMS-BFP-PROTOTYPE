/**
 * Shared TypeScript interfaces for API responses.
 * Use these instead of `any` to satisfy @typescript-eslint/no-explicit-any.
 */

// ── Reference Data ───────────────────────────────────────────────────────────

export interface Region {
  region_id: number;
  region_name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface Province {
  province_id: number;
  province_name: string;
  region_id: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface City {
  city_id: number;
  city_name: string;
  province_id: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface Barangay {
  barangay_id: number;
  barangay_name: string;
  city_id: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// ── Incidents ────────────────────────────────────────────────────────────────

export interface IncidentListItem {
  incident_id: number;
  region_id: number;
  verification_status: string;
  incident_nonsensitive_details: {
    notification_dt: string | null;
    barangay: string | null;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
  incident_sensitive_details?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface SecurityLog {
  log_id: number;
  timestamp: string;
  event_type: string;
  ip_address: string;
  user_agent: string;
  details: string | null;
  resolved_at: string | null;
  admin_action_taken: string | null;
  xai_narrative: string | null;
  xai_confidence: number | null;
}

export interface AuditLogEntry {
  id: number;
  user_id: string;
  action: string;
  resource: string;
  timestamp: string;
  details: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ── Analytics ────────────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  status: string;
  total_incidents: number;
  by_region: Array<{ region_name: string; count: number }>;
  by_alarm_level: Array<{ alarm_level: string; count: number }>;
  by_general_category: Array<{ general_category: string; count: number }>;
}

export interface AnalyticsFilters {
  from_date?: string;
  to_date?: string;
  region_id?: number;
  province_id?: number;
  city_id?: number;
}

// ── Error shape ──────────────────────────────────────────────────────────────

export interface ApiError {
  message?: string;
  detail?: string;
}
