/**
 * AFOR Shared Utilities — FIX 2, 4, 5, 6, 7
 * Used by both the import preview page and the incident detail view.
 */

// ── AFOR Incident Type Codes ─────────────────────────────────────────────────

export interface IncidentTypeOption {
  name: string;
  code: string;
}

export const STRUCTURAL_TYPE_OPTIONS: IncidentTypeOption[] = [
  { name: 'Apartment Building', code: 'APT' },
  { name: 'Condominiums', code: 'CON' },
  { name: 'Dormitory', code: 'DOR' },
  { name: 'Hotel', code: 'HOT' },
  { name: 'Lodging and Rooming Houses', code: 'LRH' },
  { name: 'Single and Two Family Dwelling', code: 'SFD' },
  { name: 'Informal Settlement', code: 'INF' },
  { name: 'Assembly', code: 'ASM' },
  { name: 'Business', code: 'BUS' },
  { name: 'Detention and Correctional', code: 'DET' },
  { name: 'Educational', code: 'EDU' },
  { name: 'Health Care', code: 'HLC' },
  { name: 'Residential Board and Care', code: 'RBC' },
  { name: 'Industrial', code: 'IND' },
  { name: 'Mercantile', code: 'MER' },
  { name: 'Mixed Occupancies', code: 'MIX' },
  { name: 'Storage', code: 'STO' },
  { name: 'Day Care', code: 'DAY' },
];

export const NON_STRUCTURAL_TYPE_OPTIONS: IncidentTypeOption[] = [
  { name: 'Miscellaneous', code: 'MSC' },
  { name: 'Electrical / Pole', code: 'ELE' },
  { name: 'Rubbish', code: 'RUB' },
  { name: 'Mobile Shop', code: 'MOB' },
  { name: 'Appliance / Equipment', code: 'APP' },
  { name: 'Gas Cylinder', code: 'GCR' },
];

export const WILDLAND_TYPE_OPTIONS: IncidentTypeOption[] = [
  { name: 'Brush', code: 'BRU' },
  { name: 'Agricultural Land', code: 'AGR' },
  { name: 'Forest', code: 'FOR' },
  { name: 'Grass', code: 'GRS' },
  { name: 'Peatland', code: 'PEA' },
];

export const TRANSPORTATION_TYPE_OPTIONS: IncidentTypeOption[] = [
  { name: 'E-Bike', code: 'EBK' },
  { name: 'Motorcycle', code: 'MOT' },
  { name: 'Automobile', code: 'AUT' },
  { name: 'Public Utility Vehicle', code: 'PUV' },
  { name: 'Truck', code: 'TRK' },
  { name: 'Bus', code: 'BUSV' },
  { name: 'Heavy Equipment', code: 'HVY' },
  { name: 'Locomotive', code: 'LOC' },
  { name: 'Non-Motorized', code: 'NMT' },
  { name: 'Customized Vehicle', code: 'CUS' },
  { name: 'Vessel', code: 'VES' },
  { name: 'Ship', code: 'SHP' },
  { name: 'Aircraft', code: 'AIR' },
  { name: 'Recreational Vehicle', code: 'REC' },
];

/** Returns the dropdown options for a given classification value. */
export function getTypeOptionsForClassification(classification: string): IncidentTypeOption[] {
  switch (classification) {
    case 'STRUCTURAL': return STRUCTURAL_TYPE_OPTIONS;
    case 'NON_STRUCTURAL': return NON_STRUCTURAL_TYPE_OPTIONS;
    case 'WILDLAND': return WILDLAND_TYPE_OPTIONS;
    case 'VEHICULAR': return TRANSPORTATION_TYPE_OPTIONS;
    default: return [];
  }
}

/** Returns the 3-4 letter AFOR code for a given classification + type name combo. */
export function getTypeCode(classification: string, typeName: string): string {
  const options = getTypeOptionsForClassification(classification);
  return options.find((o) => o.name === typeName)?.code ?? '';
}

/** Returns the full type name from a code + classification (for display). */
export function getTypeNameFromCode(classification: string, code: string): string {
  const options = getTypeOptionsForClassification(classification);
  return options.find((o) => o.code === code)?.name ?? code;
}

// ── Reference Number Utilities ────────────────────────────────────────────────

const MONTH_CODES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

/**
 * Converts a DB region_code (e.g. 'NCR', '4A') to the AFOR reference format ('RGN-NCR', 'RGN-4A').
 */
export function formatAforRegionCode(regionCode: string): string {
  if (!regionCode) return '';
  return `RGN-${regionCode.trim().toUpperCase()}`;
}

/**
 * Generates a preview reference number with XXXX as the sequence placeholder.
 * The real sequence is generated server-side on save.
 */
export function generateReferenceNumberPreview(params: {
  regionCode: string;
  stationCode: string;
  typeCode: string;
  notificationDate: string; // YYYY-MM-DD
}): string {
  const { regionCode, stationCode, typeCode, notificationDate } = params;
  if (!regionCode || !typeCode || !notificationDate) return '';
  const d = new Date(`${notificationDate}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  const month = MONTH_CODES[d.getMonth()];
  const year = d.getFullYear();
  const aforRegion = formatAforRegionCode(regionCode);
  const station = (stationCode || 'TBA').trim() || 'TBA';
  return `AFOR-${aforRegion}-${station}-${typeCode}-${month}-${year}-XXXX`;
}

/**
 * Extracts the duplicate-detection key from a reference number or its components.
 * Key = region_code + type_code + year + month (day is checked separately via notification_dt).
 */
export function buildDuplicateKey(regionCode: string, typeCode: string, notificationDate: string): string {
  if (!regionCode || !typeCode || !notificationDate) return '';
  const d = new Date(`${notificationDate}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  const month = MONTH_CODES[d.getMonth()];
  const year = d.getFullYear();
  const day = String(d.getDate()).padStart(2, '0');
  return `${regionCode}-${typeCode}-${year}-${month}-${day}`;
}

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
  alarm_foua: "1st Alarm – FOUA",
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
  // Wildland AFOR fields
  call_received_at: "Call received",
  fire_started_at: "Fire started",
  fire_arrival_at: "Fire arrival",
  fire_controlled_at: "Fire controlled",
  caller_transmitted_by: "Transmitted by",
  caller_office_address: "Office / address",
  call_received_by_personnel: "Call received by",
  engine_dispatched: "Engine dispatched",
  incident_location_description: "Incident location description",
  distance_to_fire_station_km: "Distance to fire station (km)",
  primary_action_taken: "Primary action taken",
  assistance_combined_summary: "Assistance summary",
  buildings_involved: "Buildings involved",
  buildings_threatened: "Buildings threatened",
  ownership_and_property_notes: "Ownership / property notes",
  total_area_burned_display: "Total area burned (display)",
  wildland_fire_type: "Wildland fire type",
  narration: "Narration",
  recommendations_list: "Recommendations",
  fire_behavior: "Fire behavior",
  elevation_ft: "Elevation (ft)",
  flame_length_ft: "Flame length (ft)",
  rate_of_spread_chains_per_hour: "Rate of spread (ch/hr)",
  wildland_alarm_statuses: "Alarm status timeline",
  wildland_assistance_rows: "Assistance",
  organization_or_unit: "Organization / unit",
  detail: "Detail",
  alarm_status: "Status",
  time_declared: "Time declared",
  ground_commander: "Ground commander",
  prepared_by: "Prepared by",
  prepared_by_title: "Prepared by title",
  noted_by: "Noted by",
  noted_by_title: "Noted by title",
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
  // Legacy labels from IncidentForm (old wording → canonical ALL_PROBLEM_OPTIONS label)
  "inaccurate address / no landmarks": "Inaccurate address",
  "inaccurate address/no landmarks": "Inaccurate address",
  "inaccurate address no landmarks": "Inaccurate address",
  "natural disasters / phenomenon": "Natural Disasters",
  "natural disasters/phenomenon": "Natural Disasters",
  "natural disasters phenomenon": "Natural Disasters",
  "civil disturbance (riots/rallies)": "Civil Disturbance",
  "civil disturbance (riots rallies)": "Civil Disturbance",
  "civil disturbance riots/rallies": "Civil Disturbance",
  "response delays (security/owner)": "Property security or owner delays",
  "response delays (security owner)": "Property security or owner delays",
  "response delays security/owner": "Property security or owner delays",
  "engine / mechanical failure": "Engine failure",
  "engine/mechanical failure": "Engine failure",
  "engine mechanical failure": "Engine failure",
  "lack of coordination": "Poor inter-agency coordination",
  "hazmat contamination": "HazMat risks",
  "hazmat risks": "HazMat risks",
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
