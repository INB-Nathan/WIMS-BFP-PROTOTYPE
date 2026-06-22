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

export interface SecurityThreatLog {
  log_id: number;
  timestamp: string | null;
  source_ip: string | null;
  destination_ip: string | null;
  suricata_sid: number | null;
  severity_level: string | null;
  raw_payload: string | null;
  xai_narrative: string | null;
  xai_confidence: number | null;
  admin_action_taken: string | null;
  resolved_at: string | null;
  reviewed_by: string | null;
  hitl_decision?: { action?: string; note?: string | null; reviewed_at?: string | null; reviewed_by?: string | null } | null;
  classification: string | null;
  suricata_signature: string | null;
  suricata_category: string | null;
}

export interface AuditLogEntry {
  audit_id: number;
  user_id: string | null;
  action_type: string | null;
  table_affected: string | null;
  record_id: number | null;
  ip_address: string | null;
  user_agent: string | null;
  timestamp: string | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export interface ActiveSession {
  session_id: string;
  user_id: string;
  username: string;
  role: string;
  ip_address: string;
  start: number;
  last_access: number;
  clients?: Record<string, unknown>;
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

// ── IP Blocklist (admin threat-response) ────────────────────────────────────

export interface BlockedIp {
  source_ip: string;
  blocked_at: string | null;
  expires_at: string | null;
  is_permanent: boolean;
  block_count: number;
  blocked_by: string | null;
  block_reason: string | null;
}

export interface BlockResult {
  ip: string;
  is_permanent: boolean;
  expires_at: string | null;
  block_count: number;
  repeat_offender: boolean;
  already_active: boolean;
}

export interface BlockByFilterResult {
  dry_run: boolean;
  total_distinct_ips: number;
  blocked_count?: number;
  permanent_count?: number;
  skipped_self: number;
  skipped_allowlist: number;
  already_blocked?: number;
  capped?: boolean;
  would_block?: number;
  repeat_offenders?: number;
  capped_at?: number;
}

export interface BulkResult {
  results: Array<{ log_id: number; status?: string; error?: string; [k: string]: unknown }>;
}

export interface SecurityLogFilter {
  severity?: string;
  source_ip?: string;
  date_from?: string;
  date_to?: string;
  q?: string;
  classification?: string;
}
