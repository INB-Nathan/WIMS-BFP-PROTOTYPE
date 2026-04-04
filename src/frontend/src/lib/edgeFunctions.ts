import { apiFetch } from './api';

// DTOs
export interface Incident {
    incident_id?: number;
    region_id: number;
    _city_text?: string;
    incident_type?: string; 
    narrative_report?: string;
    recommendations?: string;
    disposition?: string;
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
        region?: string;
        province_district?: string;
        city_municipality?: string;
        incident_address?: string;
        nearest_landmark?: string;
        receiver_name?: string;
        engine_dispatched?: string;
        time_engine_dispatched?: string;
        time_arrived_at_scene?: string;
        fire_origin?: string;
        extent_of_damage?: string;
        stage_of_fire?: string;
        stage_of_fire_upon_arrival?: string;
        classification_of_involved?: string;
        type_of_involved_general_category?: string;
        owner_name?: string;
        establishment_name?: string;
        general_description_of_involved?: string;
        area_of_origin?: string;
        structures_affected?: number;
        households_affected?: number;
        families_affected?: number;
        individuals_affected?: number;
        vehicles_affected?: number;
        total_response_time_minutes?: number;
        total_gas_consumed_liters?: number;
        distance_to_fire_scene_km?: number;
        time_returned_to_base?: string;
        extent_total_floor_area_sqm?: number;
        extent_total_land_area_hectares?: number;
        resources_deployed?: Record<string, unknown>;
        alarm_timeline?: Record<string, unknown>;
        casualty_details?: Record<string, unknown>;
        problems_encountered?: string[];
        recommendations?: string;
        other_personnel?: Array<{ name: string; designation: string; remarks: string }>;
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
        personnel_on_duty?: Record<string, unknown>;
        other_personnel?: Record<string, unknown>;
        casualty_details?: Record<string, unknown>;
        narrative_report?: string;
        sketch_of_fire_scene?: string;
        disposition?: string;
        disposition_prepared_by?: string;
        disposition_noted_by?: string;
        sketch_base64?: string; // For PWA Offline Base64 storage
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
    
    uploadAttachment: (incidentId: number, file: File | Blob) => {
        const formData = new FormData();
        formData.append('file', file);
        return apiFetch<{ status: string; message: string }>((`/incidents/${incidentId}/attachments`), {
            method: 'POST',
            body: formData,
            headers: {}, // Let fetch set boundary for FormData
        });
    }
};
