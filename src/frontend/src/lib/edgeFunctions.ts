import { apiFetch } from './api';

// DTOs
export interface Incident {
    incident_id?: number;
    region_id: number;
    incident_nonsensitive_details: {
        alarm_level: string;
        general_category: string;
        incident_type: string;
        notification_dt: string;
        barangay: string;
        barangay_id?: number;
        city_id: number;
        district_id: number;
        province_id: number;
        fire_station_name?: string;
        responder_type?: string;
        fire_origin?: string;
        extent_of_damage?: string;
        stage_of_fire?: string;
        structures_affected?: number;
        households_affected?: number;
        families_affected?: number;
        individuals_affected?: number;
        vehicles_affected?: number;
        total_response_time_minutes?: number;
        total_gas_consumed_liters?: number;
        extent_total_floor_area_sqm?: number;
        extent_total_land_area_hectares?: number;
        resources_deployed?: any;
        alarm_timeline?: any;
        problems_encountered?: string[];
        recommendations?: string;
    };
    incident_sensitive_details: {
        occupancy?: string;
        casualties_count?: number;
        estimated_damage?: number;
        receiver_name?: string;
        caller_name?: string;
        caller_number?: string;
        establishment_name?: string;
        owner_name?: string;
        occupant_name?: string;
        icp_location?: string;
        is_icp_present?: boolean;
        personnel_on_duty?: any;
        other_personnel?: any;
        casualty_details?: any;
        narrative_report?: string;
        sketch_of_fire_scene?: string;
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

export const edgeFunctions = {
    uploadBundle: (payload: { region_id: number; incidents: Incident[] }) =>
        apiFetch<UploadBundleResponse>('/incidents/upload-bundle', {
            method: 'POST',
            body: JSON.stringify(payload),
        }),

    runConflictDetection: (incidentId: number) =>
        apiFetch<ConflictDetectionResponse>('/incidents/conflict-detection', {
            method: 'POST',
            body: JSON.stringify({ incident_id: incidentId }),
        }),

    commitIncident: (payload: {
        incident_id: number;
        decision: 'VERIFY' | 'REJECT' | 'MERGE';
        comments?: string;
    }) => apiFetch<CommitIncidentResponse>('/incidents/commit', {
        method: 'POST',
        body: JSON.stringify(payload),
    }),

    getAnalyticsSummary: (filters: {
        from_date?: string;
        to_date?: string;
        region_id?: number;
        province_id?: number;
        city_id?: number;
    }) => apiFetch<AnalyticsSummaryResponse>('/analytics-summary', {
        method: 'POST',
        body: JSON.stringify(filters),
    }),

    securityEventAction: (payload: {
        log_id: number;
        admin_action_taken: string;
    }) => apiFetch<{ status: string; log_id: number }>('/security-event-action', {
        method: 'POST',
        body: JSON.stringify(payload),
    }),
};
