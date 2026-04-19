/**
 * AFOR Shared Utilities — FIX 2, 4, 5, 6, 7
 * Used by both the import preview page and the incident detail view.
 */

// ── FIX 2: Canonical label map ───────────────────────────────────────────────
export const FIELD_LABELS: Record<string, string> = {
  // Core incident fields
  incident_id: "Incident ID",
  notification_dt: "Date & Time of Notification",
  alarm_level: "Highest Alarm Level",
  general_category: "Classification",
  sub_category: "Category / Type",
  fire_station_name: "Responding Fire Station",
  responder_type: "Type of Responder",
  fire_origin: "Area of Origin",
  extent_of_damage: "Extent of Damage",
  stage_of_fire: "Stage of Fire Upon Arrival",
  structures_affected: "No. of Structures Affected",
  households_affected: "No. of Households Affected",
  families_affected: "No. of Families Affected",
  individuals_affected: "No. of Individuals Affected",
  vehicles_affected: "No. of Vehicles Affected",
  distance_from_station_km: "Distance from Station (km)",
  total_response_time_minutes: "Total Response Time (minutes)",
  total_gas_consumed_liters: "Total Gas Consumed (liters)",
  extent_total_floor_area_sqm: "Total Floor Area Affected (sqm)",
  extent_total_land_area_hectares: "Total Land Area Affected (ha)",
  // Location / sensitive
  street_address: "Complete Address",
  landmark: "Nearest Landmark",
  caller_name: "Caller / Reporter Name",
  caller_number: "Caller Contact Number",
  receiver_name: "Personnel Who Received Call",
  owner_name: "Owner / Establishment Name",
  establishment_name: "Establishment Name",
  narrative_report: "Narrative Report",
  disposition: "Disposition",
  prepared_by_officer: "Prepared By",
  noted_by_officer: "Noted By",
  is_icp_present: "Incident Command Post Present",
  icp_location: "ICP Location",
  verification_status: "Status",
  created_at: "Date Created",
  region_id: "Region",
  city_id: "City / Municipality",
  // Personnel on duty sub-keys
  engine_commander: "Engine Commander",
  shift_in_charge: "Shift-in-Charge",
  nozzleman: "Nozzleman",
  lineman: "Lineman",
  engine_crew: "Engine Crew",
  driver: "Driver / Pump Operator (DPO)",
  pump_operator: "Driver / Pump Operator (DPO)",
  safety_officer: "Safety Officer",
  fire_arson_investigator: "Fire and Arson Investigator",
  // Resources sub-keys
  "trucks.bfp": "BFP Fire Trucks",
  "trucks.lgu": "LGU Fire Trucks",
  "trucks.volunteer": "Volunteer Fire Trucks",
  // Alarm timeline
  foua: "1st Alarm – FOUA (First On Upon Arrival)",
  alarm_1st: "1st Alarm",
  alarm_2nd: "2nd Alarm",
  alarm_3rd: "3rd Alarm",
  alarm_4th: "4th Alarm",
  alarm_5th: "5th Alarm",
  alarm_tf_alpha: "Task Force Alpha",
  alarm_tf_bravo: "Task Force Bravo",
  alarm_tf_charlie: "Task Force Charlie",
  alarm_tf_delta: "Task Force Delta",
  alarm_general: "General Alarm",
  alarm_fuc: "Fire Under Control (FUC)",
  alarm_fo: "Fire Out (FO)",
  // Casualties
  civilian_injured: "Civilian Injured",
  civilian_deaths: "Civilian Deaths",
  firefighter_injured: "Firefighter Injured",
  firefighter_deaths: "Firefighter Deaths",
  // Other
  recommendations: "Recommendations",
  problems_encountered: "Problems Encountered",
  resources_deployed: "Resources Deployed",
  alarm_timeline: "Alarm Timeline",
  personnel_on_duty: "Personnel on Duty",
  other_personnel: "Other Personnel at Scene",
  casualty_details: "Casualty Details",
};

/**
 * Returns a human-readable label for a field key.
 * Falls back to title-casing the raw key if not in the map.
 */
export function fieldLabel(key: string): string {
  return (
    FIELD_LABELS[key] ??
    key
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// ── FIX 7: displayValue utility ──────────────────────────────────────────────
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "string" && value.trim() === "") return "N/A";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && value === 0) return "0"; // 0 is valid data
  return String(value);
}

// ── FIX 6: Complete ordered list of 25 AFOR problem options ─────────────────
export const ALL_PROBLEM_OPTIONS: string[] = [
  "Inaccurate address",
  "Geographically challenged",
  "Road conditions",
  "Road under construction",
  "Traffic congestion",
  "Road accidents",
  "Vehicles failure to yield",
  "Natural Disasters",
  "Civil Disturbance",
  "Uncooperative or panicked residents",
  "Safety and security threats",
  "Property security or owner delays",
  "Engine failure",
  "Uncooperative fire auxiliary",
  "Poor water supply access",
  "Intense heat and smoke",
  "Structural hazards",
  "Equipment malfunction",
  "Poor inter-agency coordination",
  "Radio communication breakdown",
  "HazMat risks",
  "Physical exhaustion and injuries",
  "Emotional and psychological effects",
  "Community complaints",
  "Others",
];

const PROBLEM_LABEL_ALIASES: Record<string, string> = {
  "uncooperative/panicked residents": "Uncooperative or panicked residents",
  "uncooperative / panicked residents": "Uncooperative or panicked residents",
  "uncooperative or panic residents": "Uncooperative or panicked residents",
  "uncooperative & panicked residents": "Uncooperative or panicked residents",
  "uncooperative panicked residents": "Uncooperative or panicked residents",
};

/**
 * Normalize problem labels coming from parser/legacy records so checkbox rendering
 * remains stable despite minor wording differences.
 */
export function normalizeProblemLabel(label: string): string {
  const trimmed = String(label ?? "").trim();
  if (!trimmed) return "";

  const lowered = trimmed.toLowerCase();
  if (PROBLEM_LABEL_ALIASES[lowered]) {
    return PROBLEM_LABEL_ALIASES[lowered];
  }

  const canonical = ALL_PROBLEM_OPTIONS.find((opt) => opt.toLowerCase() === lowered);
  return canonical ?? trimmed;
}
