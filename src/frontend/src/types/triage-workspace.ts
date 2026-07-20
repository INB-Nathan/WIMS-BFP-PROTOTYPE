import type { TriageClusterActivityEntry } from '@/lib/api/legacy';

export interface EvidenceLocation {
  source: string;
  available: boolean;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  approximate: boolean;
  distance_to_report_m: number | null;
}

export interface WorkspacePhoto {
  photo_id: string;
  content_url: string;
  media_type: 'image/jpeg' | 'image/png';
  image_width: number;
  image_height: number;
  capture_time: string | null;
  exif_available: boolean;
  gps_consensus: string | null;
  evidence_source: string | null;
  image_to_report_distance_m: number | null;
  device_to_exif_distance_m: number | null;
  exif_location: EvidenceLocation;
}

export interface ContributorCredibility {
  authenticated: boolean;
  trust_score: number | null;
  badge: string | null;
  total_reports: number | null;
  actioned_reports: number | null;
  pending_reports: number | null;
  evidence_quality: number | null;
  active_months: number | null;
}

export interface WorkspaceFollowup {
  followup_id: number;
  followup_text: string;
  created_at: string;
}

export interface WorkspaceStatusUpdate {
  update_id: number;
  stage: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WorkspaceReport {
  report_id: number;
  category: string | null;
  sub_category: string | null;
  reporting_context: string | null;
  safety_status: string | null;
  status: string;
  status_explanation: string | null;
  description: string | null;
  trust_score: number;
  created_at: string;
  reported_at: string | null;
  previous_report_id: number | null;
  report_location: EvidenceLocation;
  device_location: EvidenceLocation;
  ip_location: EvidenceLocation;
  photos: WorkspacePhoto[];
  contributor: ContributorCredibility;
  followups: WorkspaceFollowup[];
  feedback: WorkspaceStatusUpdate[];
  contact_reveal_url: string;
}

export interface WorkspaceCluster {
  cluster_id: number;
  anchor_report_id: number;
  status: string;
  status_note: string | null;
  assigned_to_user_id: string | null;
  assigned_to: string | null;
  review_started_at: string | null;
  updated_at: string | null;
}

export interface TriageWorkspaceResponse {
  cluster: WorkspaceCluster;
  reports: WorkspaceReport[];
  activity: TriageClusterActivityEntry[];
  loaded_at: string;
}

export interface ContactRevealResponse {
  report_id: number;
  reporter_name: string;
  reporter_phone: string | null;
}
