import { apiFetch } from './transport';

export type BreachStatus = 'DETECTED' | 'DPO_NOTIFIED' | 'NPC_SUBMITTED' | 'CLOSED';

export interface Breach {
    breach_id: number;
    threat_log_id: number;
    detected_at: string;
    npc_deadline_at: string;
    status: BreachStatus;
    affected_systems: string | null;
    data_scope: string | null;
    notes: string | null;
    reported_by: string | null;
    npc_submitted_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface BreachUpdate {
    status?: BreachStatus;
    affected_systems?: string;
    data_scope?: string;
    notes?: string;
}

export async function fetchBreaches(): Promise<Breach[]> {
    return apiFetch<Breach[]>('/api/admin/breach');
}

export async function updateBreach(id: number, payload: BreachUpdate): Promise<Breach> {
    return apiFetch<Breach>(`/api/admin/breach/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}
