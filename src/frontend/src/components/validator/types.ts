export interface ValidatorIncident {
  incident_id: number;
  verification_status: string;
  encoder_id: string | null;
  region_id: number;
  created_at: string | null;
  submitted_at: string | null;
  updated_at: string | null;
  notification_dt: string | null;
  general_category: string | null;
  alarm_level: string | null;
  fire_station_name: string | null;
  structures_affected: number | null;
  households_affected: number | null;
  responder_type: string | null;
  fire_origin: string | null;
  extent_of_damage: string | null;
  parent_incident_id: number | null;
  is_duplicate: boolean;
  duplicate_of: number | null;
  reference_number: string | null;
  is_resubmitted: boolean;
}

export type ActionType = "accept" | "accept_replace" | "reject";
