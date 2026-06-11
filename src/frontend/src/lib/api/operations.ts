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
