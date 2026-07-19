import { apiFetch } from './transport';

export type PerimeterGeometry = {
  type: 'Polygon';
  coordinates: number[][][];
};

export interface PerimeterIncidentOption {
  incident_id: number;
  reference_number: string | null;
  general_category: string | null;
  location: string;
  notification_dt: string | null;
  applied_at: string | null;
  civilian_report_count: number;
}

export interface PerimeterResponse {
  type: 'Feature';
  geometry: PerimeterGeometry;
  properties: Record<string, unknown>;
  perimeter_id: number;
  incident_id: number;
  gis_acres: number | null;
  map_method: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  linked_reports: Array<{ report_id: number; category: string | null; status: string | null; created_at: string | null }>;
}

export function fetchPerimeterIncidentOptions(): Promise<PerimeterIncidentOption[]> {
  return apiFetch('/regional/perimeter-incidents');
}

export function fetchPerimeter(incidentId: number): Promise<PerimeterResponse> {
  return apiFetch(`/regional/incidents/${incidentId}/perimeter`);
}

export function saveManualPerimeter(
  incidentId: number,
  geometry: PerimeterGeometry,
  exists: boolean,
): Promise<PerimeterResponse> {
  return apiFetch(`/regional/incidents/${incidentId}/perimeter`, {
    method: exists ? 'PUT' : 'POST',
    body: JSON.stringify({ geometry, map_method: 'MANUAL_DRAW' }),
  });
}
