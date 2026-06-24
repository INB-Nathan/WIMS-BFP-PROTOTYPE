import { apiFetch } from './transport';

export type FireStatus = 'ACTIVE' | 'CONTAINED' | 'FIRE_OUT';

export interface Operation {
  operation_id: number;
  fire_status: FireStatus;
  start_time: string;
  location: string;
  size_hectares: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  linked_report_ids: number[];
  linked_reports: LinkedReportDetail[];
}

export interface OperationCreate {
  fire_status: FireStatus;
  start_time: string;
  location: string;
  size_hectares?: number;
  notes?: string;
  latitude?: number;
  longitude?: number;
  radius_meters?: number;
  linked_report_ids?: number[];
}

export interface OperationUpdate {
  fire_status?: FireStatus;
  start_time?: string;
  location?: string;
  size_hectares?: number;
  notes?: string;
  latitude?: number;
  longitude?: number;
  radius_meters?: number;
}

export async function fetchOperations(status?: FireStatus[]): Promise<Operation[]> {
  const params = new URLSearchParams();
  status?.forEach((s) => params.append('status', s));
  const qs = params.toString();
  return apiFetch<Operation[]>(`/operations${qs ? `?${qs}` : ''}`);
}

export async function createOperation(data: OperationCreate): Promise<Operation> {
  return apiFetch<Operation>('/operations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateOperation(id: number, data: OperationUpdate): Promise<Operation> {
  return apiFetch<Operation>(`/operations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteOperation(id: number): Promise<void> {
  return apiFetch<void>(`/operations/${id}`, { method: 'DELETE' });
}

export async function linkReport(operationId: number, reportId: number): Promise<Operation> {
  return apiFetch<Operation>(`/operations/${operationId}/link`, {
    method: 'POST',
    body: JSON.stringify({ report_id: reportId }),
  });
}

export async function unlinkReport(operationId: number, reportId: number): Promise<Operation> {
  return apiFetch<Operation>(`/operations/${operationId}/link/${reportId}`, {
    method: 'DELETE',
  });
}

export interface LinkedReportDetail {
  report_id: number;
  status: 'PENDING' | 'UNDER_REVIEW' | 'LINKED' | 'ACTIONED' | string;
  category: string;
  sub_category: string | null;
  reported_at: string | null;
  latitude: number | null;
  longitude: number | null;
  trust_score: number | null;
  safety_status: string | null;
  reporting_context: string | null;
  linked_operation_id: number | null;
  linked_operation_label: string | null;
  distance_meters: number | null;
}

export interface LinkableReportDetail extends LinkedReportDetail {
  link_disabled: boolean;
  disabled_reason: string | null;
}

export interface LinkableReportSearchParams {
  operation_id?: number;
  q?: string;
  status?: string[];
  category?: string;
  start?: string;
  end?: string;
  latitude?: number;
  longitude?: number;
}

export async function fetchLinkableReports(
  params: LinkableReportSearchParams = {},
): Promise<LinkableReportDetail[]> {
  const search = new URLSearchParams();
  if (params.operation_id != null) search.set('operation_id', String(params.operation_id));
  if (params.q) search.set('q', params.q);
  params.status?.forEach((s) => search.append('status', s));
  if (params.category) search.set('category', params.category);
  if (params.start) search.set('start', params.start);
  if (params.end) search.set('end', params.end);
  if (params.latitude != null) search.set('latitude', String(params.latitude));
  if (params.longitude != null) search.set('longitude', String(params.longitude));
  const qs = search.toString();
  return apiFetch<LinkableReportDetail[]>(`/operations/linkable-reports${qs ? `?${qs}` : ''}`);
}
