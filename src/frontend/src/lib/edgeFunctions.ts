import { createClient } from './supabaseClient';

const FUNCTION_BASE_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;

async function callEdgeFunction<T>(
    functionName: string,
    body: any,
    method: 'POST' | 'GET' = 'POST'
): Promise<T> {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token) {
        throw new Error('Not authenticated');
    }

    const res = await fetch(`${FUNCTION_BASE_URL}/${functionName}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: method === 'POST' ? JSON.stringify(body) : undefined,
    });

    const json = await res.json();
    if (!res.ok) {
        throw new Error(json.message || json.error || json.error_code || 'Edge Function Error');
    }
    return json as T;
}

// DTOs
export interface Incident {
    incident_id?: number; // Optional if new
    region_id: number;
    incident_nonsensitive_details: {
        alarm_level: string;
        general_category: string;
        incident_type: string;
        notification_dt: string;
        barangay: string;
        barangay_id?: number; // Added to match schema
        city_id: number;
        district_id: number;
        province_id: number;
        // AFOR Fields (Section A)
        fire_station_name?: string;
        responder_type?: string;
        fire_origin?: string;
        extent_of_damage?: string; // radio selection
        stage_of_fire?: string; // radio selection
        structures_affected?: number;
        households_affected?: number;
        families_affected?: number; // Added
        individuals_affected?: number;
        vehicles_affected?: number; // Added
        total_response_time_minutes?: number; // Added
        total_gas_consumed_liters?: number; // Added
        extent_total_floor_area_sqm?: number; // Added
        extent_total_land_area_hectares?: number; // Added

        resources_deployed?: any; // JSONB: { engines: number, ambulances: number, ..specific breakdowns.. }
        alarm_timeline?: any; // JSONB: { first_alarm: dt, ... }
        problems_encountered?: string[]; // JSONB Array or { problem: boolean }
        recommendations?: string;
    };
    incident_sensitive_details: {
        occupancy?: string;
        casualties_count?: number; // derived or sum
        estimated_damage?: number;

        // AFOR Fields
        receiver_name?: string;
        caller_name?: string;
        caller_number?: string;
        establishment_name?: string;
        owner_name?: string;
        occupant_name?: string;

        icp_location?: string; // Added
        is_icp_present?: boolean; // Added

        personnel_on_duty?: any; // JSONB
        other_personnel?: any; // JSONB array
        casualty_details?: any; // JSONB breaking down Male/Female etc.
        narrative_report?: string;
        sketch_of_fire_scene?: string; // URL or path

        // AFOR Section L
        disposition?: string;
        disposition_prepared_by?: string;
        disposition_noted_by?: string;
    };
}

export interface UploadBundleResponse {
    status: string;
    batch_id: number;
    incident_ids: number[];
    message: string;
}

export interface ConflictDetectionResponse {
    status: string;
    incident_id: number;
    potential_duplicates: Array<{
        incident_id: number;
        notification_dt: string;
        city_name: string;
        barangay: string;
        status: string;
    }>;
}

export interface CommitIncidentResponse {
    status: string;
    incident_id: number;
    new_status: string;
    message: string;
}

export interface AnalyticsSummaryResponse {
    status: string;
    total_incidents: number;
    by_region: Array<{ region_name: string; count: number }>;
    by_alarm_level: Array<{ alarm_level: string; count: number }>;
    by_general_category: Array<{ general_category: string; count: number }>;
}

// API Methods
export const edgeFunctions = {
    uploadBundle: (payload: { region_id: number; incidents: Incident[] }) =>
        callEdgeFunction<UploadBundleResponse>('upload-bundle', payload),

    runConflictDetection: (incidentId: number) =>
        callEdgeFunction<ConflictDetectionResponse>('conflict-detection', {
            incident_id: incidentId,
        }),

    commitIncident: (payload: {
        incident_id: number;
        decision: 'VERIFY' | 'REJECT' | 'MERGE';
        comments?: string;
    }) => callEdgeFunction<CommitIncidentResponse>('commit-incident', payload),

    getAnalyticsSummary: (filters: {
        from_date?: string;
        to_date?: string;
        region_id?: number;
        province_id?: number;
        city_id?: number;
    }) => callEdgeFunction<AnalyticsSummaryResponse>('analytics-summary', filters),

    securityEventAction: (payload: {
        log_id: number;
        admin_action_taken: string;
    }) => callEdgeFunction<{ status: string; log_id: number }>('security-event-action', payload),
};
