'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { edgeFunctions, Incident } from '@/lib/edgeFunctions';
import { fetchRegions } from '@/lib/api';
import { queueIncident, getPendingIncidents, markSynced } from '@/lib/offlineStore';
import { useUserProfile } from '@/lib/auth';
import { Loader2, Save, MapPin } from 'lucide-react';
import type { Region } from '@/types/api';
import { MapPicker } from '@/components/MapPicker';

const PROBLEM_OPTIONS = [
    'Inaccurate address / no landmarks', 'Geographically challenged', 'Road conditions', 'Road under construction',
    'Traffic congestion', 'Road accidents', 'Vehicles failure to yield', 'Natural disasters',
    'Civil disturbance', 'Uncooperative / panicked residents', 'Safety and security threats', 'Response delays (security/owner)',
    'Engine failure / mechanical problems', 'Uncooperative fire auxiliary', 'Poor water supply', 'Intense heat and smoke',
    'Structural hazards', 'Equipment malfunction', 'Lack of coordination', 'Breakdown in radio communication',
    'HazMat contamination', 'Physical exhaustion', 'Emotional/psychological effects', 'Community complaints'
];

const normalizeProblemLabel = (value: string): string =>
    value
        .toLowerCase()
        .replace(/[()]/g, ' ')
        .replace(/[\/-]/g, ' ')
        .replace(/\b(or|and)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

export function IncidentForm({ initialData }: { initialData?: Incident }) {
    const router = useRouter();
    const { assignedRegionId } = useUserProfile();
    const [loading, setLoading] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);
    const [regions, setRegions] = useState<Region[]>([]);

    // Initial State - Flattened for Form, Mapped to Incident on Submit
    const [formState, setFormState] = useState({
        // A. Response Details
        responder_type: '',
        fire_station_name: '',
        notification_dt_date: '',
        notification_dt_time: '',
        region: '',
        province_district: '',
        city_municipality: '',
        incident_address: '',
        nearest_landmark: '',
        caller_name: '',
        caller_number: '',
        receiver_name: '',
        engine_dispatched: '',
        time_engine_dispatched: '',
        time_arrived_at_scene: '',
        total_response_time_minutes: '',
        distance_to_fire_scene_km: '',
        alarm_level: '',
        time_returned_to_base: '',
        total_gas_consumed_liters: '',

        // B. Nature and Classification
        classification_of_involved: '',
        type_of_involved_general_category: '',
        owner_name: '',
        establishment_name: '',
        general_description_of_involved: '',
        area_of_origin: '',
        stage_of_fire_upon_arrival: '',
        extent_of_damage: '', // Radio selection
        extent_total_floor_area_sqm: '',
        extent_total_land_area_hectares: '',
        extent_affected_count: '', // For "Extended Beyond Structure"

        // Counts
        structures_affected: '',
        households_affected: '',
        families_affected: '',
        individuals_affected: '',
        vehicles_affected: '',

        // C. Assets (JSONB mapped)
        resources_bfp_trucks: '',
        resources_lgu_trucks: '',
        resources_non_bfp_trucks: '',
        resources_bfp_ambulance: '',
        resources_non_bfp_ambulance: '',
        resources_bfp_rescue: '',
        resources_non_bfp_rescue: '',
        resources_others: '',

        // Tools (JSONB mapped)
        tools_scba: '',
        tools_rope: '',
        tools_ladder: '',
        tools_hoseline: '',
        tools_hydraulic: '',
        tools_others: '',

        hydrant_location_distance: '',

        // D. Alarm Level (JSONB mapped)
        alarm_1st: '', alarm_2nd: '', alarm_3rd: '',
        alarm_4th: '', alarm_5th: '',
        alarm_tf_alpha: '', alarm_tf_bravo: '', alarm_tf_charlie: '', alarm_tf_delta: '',
        alarm_general: '', alarm_fuc: '', alarm_fo: '',

        incident_commander: '',
        ground_commander: '',
        icp_present: '', // 'with' | 'without'
        icp_location: '',

        // E. Casualties (JSONB mapped)
        injured_civilian_m: '', injured_civilian_f: '',
        injured_firefighter_m: '', injured_firefighter_f: '',
        injured_auxiliary_m: '', injured_auxiliary_f: '',
        fatal_civilian_m: '', fatal_civilian_f: '',
        fatal_firefighter_m: '', fatal_firefighter_f: '',
        fatal_auxiliary_m: '', fatal_auxiliary_f: '',

        // F. Personnel On Duty (JSONB mapped)
        pod_engine_commander: '', pod_shift_in_charge: '',
        pod_nozzleman: '', pod_lineman: '',
        pod_engine_crew: '', pod_driver: '',
        pod_pump_operator: '',
        pod_safety_officer: '', pod_safety_officer_contact: '',
        pod_inv_name: '', pod_inv_contact: '',

        // I. Narrative
        narrative_report: '',

        // K. Recommendations
        recommendations: '',

        // J. Problems
        problems_encountered: [] as string[],
        problems_others: '',

        // L. Disposition
        disposition: '',
        disposition_prepared_by: '',
        disposition_noted_by: '',

        // Location (WGS-84)
        latitude: '' as string,
        longitude: '' as string,
    });

    // Dynamic Lists
    const [otherPersonnel, setOtherPersonnel] = useState<{ name: string, designation: string, remarks: string }[]>([
        { name: '', designation: '', remarks: '' },
        { name: '', designation: '', remarks: '' },
        { name: '', designation: '', remarks: '' }
    ]);

    const toDateTimeLocalValue = (raw: unknown): string => {
        if (!raw) return '';
        const value = String(raw).trim();
        const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
        if (match) return `${match[1]}T${match[2]}`;

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
    };

    const alarmEntryToDateTimeLocal = (entry: unknown): string => {
        if (!entry) return '';
        if (typeof entry === 'string' || typeof entry === 'number') {
            return toDateTimeLocalValue(entry);
        }
        if (typeof entry === 'object') {
            const obj = entry as Record<string, unknown>;
            return toDateTimeLocalValue(obj.time ?? obj.value ?? obj.datetime ?? '');
        }
        return '';
    };

    const normalizeRegionLabel = (value: unknown): string =>
        String(value ?? '')
            .toLowerCase()
            .replace(/region/gi, ' ')
            .replace(/[^a-z0-9]/g, '')
            .trim();

    const resolveRegionId = (): number | null => {
        if (typeof assignedRegionId === 'number' && assignedRegionId > 0) {
            return assignedRegionId;
        }

        if (typeof initialData?.region_id === 'number' && initialData.region_id > 0) {
            return initialData.region_id;
        }

        const raw = formState.region?.trim();
        if (!raw) return null;

        const numeric = Number(raw);
        if (Number.isInteger(numeric) && numeric > 0) {
            return numeric;
        }

        const norm = normalizeRegionLabel(raw);
        const match = regions.find((r) => normalizeRegionLabel(r.region_name) === norm);
        return match?.region_id ?? null;
    };

    useEffect(() => {
        let active = true;
        void fetchRegions()
            .then((items) => {
                if (active) setRegions(items);
            })
            .catch(() => {
                if (active) setRegions([]);
            });
        return () => {
            active = false;
        };
    }, []);

    // Handle initialData pre-fill
    useEffect(() => {
        if (initialData) {
            const ns = initialData.incident_nonsensitive_details || {};
            const sen = initialData.incident_sensitive_details || {};
            // Support both flat (new) and nested (legacy) resources_deployed structures
            const rdRaw = (ns.resources_deployed || {}) as Record<string, unknown>;
            const tRes = ((rdRaw.trucks as Record<string, unknown>) || {});
            const mRes = ((rdRaw.medical as Record<string, unknown>) || {});
            const saRes = ((rdRaw.special_assets as Record<string, unknown>) || {});
            const tlRes = ((rdRaw.tools as Record<string, unknown>) || {});
            // Helper: flat key wins over legacy nested key; returns '' for missing/null/undefined
            const _rdv = (flatK: string, nested: Record<string, unknown>, nestK: string): string => {
                const v = rdRaw[flatK] ?? nested[nestK];
                return v != null && String(v) !== 'undefined' ? String(v) : '';
            };
            const timeline = ns.alarm_timeline || {};
            const casualties = ((sen.casualty_details as { injured?: Record<string, unknown>; fatalities?: Record<string, unknown> }) || { injured: {}, fatalities: {} });
            const injured = (casualties.injured || {}) as Record<string, unknown>;
            const fatalities = (casualties.fatalities || {}) as Record<string, unknown>;
            const civilianInjured = (injured.civilian as Record<string, unknown>) || {};
            const firefighterInjured = ((injured.firefighter || injured.bfp) as Record<string, unknown>) || {};
            const auxiliaryInjured = (injured.auxiliary as Record<string, unknown>) || {};
            const civilianFatalities = (fatalities.civilian as Record<string, unknown>) || {};
            const firefighterFatalities = ((fatalities.firefighter || fatalities.bfp) as Record<string, unknown>) || {};
            const auxiliaryFatalities = (fatalities.auxiliary as Record<string, unknown>) || {};
            const incomingProblems = Array.isArray(ns.problems_encountered)
                ? ns.problems_encountered.map((p: unknown) => String(p)).filter(Boolean)
                : [];
            const normalizedOptionMap = new Map(
                PROBLEM_OPTIONS.map((option) => [normalizeProblemLabel(option), option])
            );
            const selectedProblems: string[] = [];
            const extraProblems: string[] = [];
            for (const problem of incomingProblems) {
                const normalized = normalizeProblemLabel(problem);
                const matched = normalizedOptionMap.get(normalized);
                if (matched) {
                    selectedProblems.push(matched);
                } else {
                    extraProblems.push(problem);
                }
            }
            const explicitOthers = typeof ns.problems_others === 'string' ? ns.problems_others : '';
            const combinedOthers = Array.from(new Set([explicitOthers, ...extraProblems].map((p) => p.trim()).filter(Boolean))).join(', ');

            // @ts-expect-error -- prev spread preserves all fields; type checker cannot verify exhaustive return
            setFormState((prev) => ({
                ...prev,
                responder_type: ns.responder_type || '',
                fire_station_name: ns.fire_station_name || '',
                notification_dt_date: ns.notification_dt ? ns.notification_dt.split('T')[0] : '',
                notification_dt_time: ns.notification_dt ? ns.notification_dt.split('T')[1]?.substring(0, 5) : '',
                region: ns.region || (initialData as Record<string, unknown>)._region_text as string || '',
                province_district: ns.province_district || (initialData as Record<string, unknown>)._province_text as string || '',
                city_municipality: initialData._city_text || ns.city_municipality || '',
                incident_address: ns.incident_address || '',
                nearest_landmark: ns.nearest_landmark || '',
                caller_name: sen.caller_name || '',
                caller_number: sen.caller_number || '',
                receiver_name: sen.receiver_name || ns.receiver_name || '',
                engine_dispatched: ns.engine_dispatched || '',
                time_engine_dispatched: ns.time_engine_dispatched || '',
                time_arrived_at_scene: ns.time_arrived_at_scene || '',
                total_response_time_minutes: ns.total_response_time_minutes?.toString() || '',
                distance_to_fire_scene_km: ns.distance_to_fire_scene_km?.toString() || '',
                alarm_level: ns.alarm_level || '',
                time_returned_to_base: ns.time_returned_to_base || '',
                total_gas_consumed_liters: ns.total_gas_consumed_liters?.toString() || '',

                classification_of_involved: ns.classification_of_involved || ns.general_category || '',
                type_of_involved_general_category: ns.type_of_involved_general_category || ns.sub_category || '',
                owner_name: initialData.incident_sensitive_details?.owner_name || ns.owner_name || '',
                establishment_name: initialData.incident_sensitive_details?.establishment_name || ns.establishment_name || '',
                general_description_of_involved: ns.general_description_of_involved || '',
                area_of_origin: ns.area_of_origin || '',
                stage_of_fire_upon_arrival: ns.stage_of_fire_upon_arrival || '',
                extent_of_damage: ns.extent_of_damage || '',
                extent_total_floor_area_sqm: ns.extent_total_floor_area_sqm?.toString() || '',
                extent_total_land_area_hectares: ns.extent_total_land_area_hectares?.toString() || '',

                structures_affected: ns.structures_affected?.toString() || '',
                households_affected: ns.households_affected?.toString() || '',
                families_affected: ns.families_affected?.toString() || '',
                individuals_affected: ns.individuals_affected?.toString() || '',
                vehicles_affected: ns.vehicles_affected?.toString() || '',

                resources_bfp_trucks: _rdv('bfp_fire_trucks', tRes, 'bfp'),
                resources_lgu_trucks: _rdv('lgu_owned_trucks', tRes, 'lgu'),
                resources_non_bfp_trucks: _rdv('non_bfp_trucks', tRes, 'volunteer'),
                resources_bfp_ambulance: _rdv('bfp_ambulance', mRes, 'bfp'),
                resources_non_bfp_ambulance: _rdv('non_bfp_ambulance', mRes, 'non_bfp'),
                resources_bfp_rescue: _rdv('bfp_rescue_trucks', saRes, 'rescue_bfp'),
                resources_non_bfp_rescue: _rdv('non_bfp_rescue_trucks', saRes, 'rescue_non_bfp'),
                resources_others: _rdv('other_vehicles', saRes, 'others'),
                tools_scba: _rdv('scba', tlRes, 'scba'),
                tools_rope: _rdv('rope', tlRes, 'rope'),
                tools_ladder: _rdv('ladder', tlRes, 'ladder'),
                tools_hoseline: _rdv('hoseline', tlRes, 'hoseline'),
                tools_hydraulic: _rdv('hydrolic_tools', tlRes, 'hydraulic'),
                tools_others: _rdv('other_tools', tlRes, 'others'),
                hydrant_location_distance: String(rdRaw.hydrant_distance ?? ''),

                alarm_1st: alarmEntryToDateTimeLocal(timeline.alarm_1st),
                alarm_2nd: alarmEntryToDateTimeLocal(timeline.alarm_2nd),
                alarm_3rd: alarmEntryToDateTimeLocal(timeline.alarm_3rd),
                alarm_4th: alarmEntryToDateTimeLocal(timeline.alarm_4th),
                alarm_5th: alarmEntryToDateTimeLocal(timeline.alarm_5th),
                alarm_tf_alpha: alarmEntryToDateTimeLocal(timeline.alarm_tf_alpha ?? timeline.tf_alpha),
                alarm_tf_bravo: alarmEntryToDateTimeLocal(timeline.alarm_tf_bravo ?? timeline.tf_bravo),
                alarm_tf_charlie: alarmEntryToDateTimeLocal(timeline.alarm_tf_charlie ?? timeline.tf_charlie),
                alarm_tf_delta: alarmEntryToDateTimeLocal(timeline.alarm_tf_delta ?? timeline.tf_delta),
                alarm_general: alarmEntryToDateTimeLocal(timeline.alarm_general ?? timeline.general),
                alarm_fuc: alarmEntryToDateTimeLocal(timeline.alarm_fuc ?? timeline.fuc),
                alarm_fo: alarmEntryToDateTimeLocal(timeline.alarm_fo ?? timeline.fo),

                injured_civilian_m: (civilianInjured.m as number | string | undefined)?.toString() || '',
                injured_civilian_f: (civilianInjured.f as number | string | undefined)?.toString() || '',
                injured_firefighter_m: (firefighterInjured.m as number | string | undefined)?.toString() || '',
                injured_firefighter_f: (firefighterInjured.f as number | string | undefined)?.toString() || '',
                injured_auxiliary_m: (auxiliaryInjured.m as number | string | undefined)?.toString() || '',
                injured_auxiliary_f: (auxiliaryInjured.f as number | string | undefined)?.toString() || '',
                fatal_civilian_m: (civilianFatalities.m as number | string | undefined)?.toString() || '',
                fatal_civilian_f: (civilianFatalities.f as number | string | undefined)?.toString() || '',
                fatal_firefighter_m: (firefighterFatalities.m as number | string | undefined)?.toString() || '',
                fatal_firefighter_f: (firefighterFatalities.f as number | string | undefined)?.toString() || '',
                fatal_auxiliary_m: (auxiliaryFatalities.m as number | string | undefined)?.toString() || '',
                fatal_auxiliary_f: (auxiliaryFatalities.f as number | string | undefined)?.toString() || '',
                
                incident_commander: initialData.incident_sensitive_details?.personnel_on_duty?.engine_commander || '',
                ground_commander: initialData.incident_sensitive_details?.personnel_on_duty?.shift_in_charge || '',
                pod_engine_commander: initialData.incident_sensitive_details?.personnel_on_duty?.engine_commander || '',
                pod_shift_in_charge: initialData.incident_sensitive_details?.personnel_on_duty?.shift_in_charge || '',

                narrative_report: (sen.narrative_report as string) || '',
                recommendations: (ns.recommendations as string) || '',
                problems_encountered: selectedProblems,
                problems_others: combinedOthers,
                disposition: (sen.disposition as string) || '',
                disposition_prepared_by: (sen.disposition_prepared_by as string) || '',
                disposition_noted_by: (sen.disposition_noted_by as string) || '',
                // Location — pre-fill from top-level Incident fields
                latitude: initialData.latitude != null ? String(initialData.latitude) : '',
                longitude: initialData.longitude != null ? String(initialData.longitude) : '',
            }));

            const people = (sen.other_personnel || ns.other_personnel) as Record<string, unknown>[] | undefined;
            if (people && Array.isArray(people)) {
                setOtherPersonnel(people.map((p: Record<string, unknown>) => ({
                    name: (p.name as string) || '',
                    designation: (p.designation as string) || '',
                    remarks: (p.remarks as string) || ''
                })));
            }
        }
    }, [initialData]);

    const handleOtherPersonnelChange = (index: number, field: string, value: string) => {
        const newPersonnel = [...otherPersonnel];
        // @ts-expect-error -- dynamic field assignment on typed array element
        newPersonnel[index][field] = value;
        setOtherPersonnel(newPersonnel);
    };

    const checkPending = useCallback(async () => {
        const pending = await getPendingIncidents();
        setPendingCount(pending.length);
    }, []);

    const syncPending = useCallback(async () => {
        if (!navigator.onLine) return;
        const pending = await getPendingIncidents();
        if (pending.length === 0) return;
        console.log('Syncing pending...', pending.length);
        for (const item of pending) {
            try {
                const payload = item.payload as { region_id: number; incidents: Incident[] };
                const res = await edgeFunctions.uploadBundle(payload);
                await markSynced(item.id!);
                console.log('Synced incident', res.incident_ids[0]);
            } catch (e) {
                console.error('Failed to sync item', item.id, e);
            }
        }
        await checkPending();
    }, [checkPending]);

    // Check pending - online sync listener (declared after callbacks to avoid TDZ)
    useEffect(() => {
        checkPending();
        const handleOnline = () => syncPending();
        window.addEventListener('online', handleOnline);
        return () => window.removeEventListener('online', handleOnline);
    }, [syncPending, checkPending]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
    };

    // Handle Radio Changes specifically to ensure only one is selected
    const handleRadioChange = (name: string, value: string) => {
        setFormState(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const effectiveRegionId = resolveRegionId();
        if (!effectiveRegionId) {
            alert("No region indicated. Please select a region or ensure the AFOR region was detected.");
            return;
        }

        setLoading(true);

        try {
            // Map Form State to Incident Interface
            const incident: Incident = {
                region_id: effectiveRegionId,
                latitude: formState.latitude ? parseFloat(formState.latitude) || undefined : undefined,
                longitude: formState.longitude ? parseFloat(formState.longitude) || undefined : undefined,
                incident_nonsensitive_details: {
                    notification_dt: formState.notification_dt_date && formState.notification_dt_time ? `${formState.notification_dt_date}T${formState.notification_dt_time}:00` : new Date().toISOString(),
                    region: formState.region,
                    province_district: formState.province_district,
                    city_municipality: formState.city_municipality,
                    fire_station_name: formState.fire_station_name,
                    responder_type: formState.responder_type,
                    alarm_level: formState.alarm_level,
                    barangay: formState.incident_address.split(',')[2] || 'Unknown', // Loose parsing or just use address
                    // Note: The original generic fields (barangay, city_id) need to be populated.
                    // For now we map strictly structured AFOR fields.

                    // Defaults for required legacy/schema fields
                    city_id: 1,
                    district_id: 1,
                    province_id: 1,
                    general_category: formState.type_of_involved_general_category,
                    incident_type: formState.classification_of_involved,

                    fire_origin: formState.area_of_origin,
                    extent_of_damage: formState.extent_of_damage,
                    stage_of_fire: formState.stage_of_fire_upon_arrival,

                    structures_affected: parseInt(formState.structures_affected) || 0,
                    households_affected: parseInt(formState.households_affected) || 0,
                    families_affected: parseInt(formState.families_affected) || 0,
                    individuals_affected: parseInt(formState.individuals_affected) || 0,
                    vehicles_affected: parseInt(formState.vehicles_affected) || 0,

                    total_response_time_minutes: parseInt(formState.total_response_time_minutes) || 0,
                    total_gas_consumed_liters: parseFloat(formState.total_gas_consumed_liters) || 0,
                    extent_total_floor_area_sqm: parseFloat(formState.extent_total_floor_area_sqm) || 0,
                    extent_total_land_area_hectares: parseFloat(formState.extent_total_land_area_hectares) || 0,

                    resources_deployed: {
                        // Response Vehicles — flat keys matching spreadsheet labels
                        bfp_fire_trucks: parseInt(formState.resources_bfp_trucks) || 0,
                        lgu_owned_trucks: parseInt(formState.resources_lgu_trucks) || 0,
                        non_bfp_trucks: parseInt(formState.resources_non_bfp_trucks) || 0,
                        bfp_ambulance: parseInt(formState.resources_bfp_ambulance) || 0,
                        non_bfp_ambulance: parseInt(formState.resources_non_bfp_ambulance) || 0,
                        bfp_rescue_trucks: parseInt(formState.resources_bfp_rescue) || 0,
                        non_bfp_rescue_trucks: parseInt(formState.resources_non_bfp_rescue) || 0,
                        other_vehicles: formState.resources_others,
                        // Tools and Equipment
                        scba: parseInt(formState.tools_scba) || 0,
                        rope: parseInt(formState.tools_rope) || 0,
                        ladder: parseInt(formState.tools_ladder) || 0,
                        hoseline: parseInt(formState.tools_hoseline) || 0,
                        hydrolic_tools: parseInt(formState.tools_hydraulic) || 0,
                        other_tools: formState.tools_others,
                        hydrant_distance: formState.hydrant_location_distance,
                    },

                    alarm_timeline: {
                        alarm_1st: formState.alarm_1st,
                        alarm_2nd: formState.alarm_2nd,
                        alarm_3rd: formState.alarm_3rd,
                        alarm_4th: formState.alarm_4th,
                        alarm_5th: formState.alarm_5th,
                        tf_alpha: formState.alarm_tf_alpha,
                        tf_bravo: formState.alarm_tf_bravo,
                        tf_charlie: formState.alarm_tf_charlie,
                        tf_delta: formState.alarm_tf_delta,
                        general: formState.alarm_general,
                        fuc: formState.alarm_fuc,
                        fo: formState.alarm_fo
                    },

                    recommendations: formState.recommendations,
                    problems_encountered: [
                        ...(formState.problems_encountered || []),
                        ...String(formState.problems_others || '').split(',').map((s) => s.trim()).filter(Boolean),
                    ],
                    other_personnel: otherPersonnel,
                },
                incident_sensitive_details: {
                    caller_name: formState.caller_name,
                    caller_number: formState.caller_number,
                    receiver_name: formState.receiver_name,
                    owner_name: formState.owner_name,
                    establishment_name: formState.establishment_name,
                    occupancy: formState.type_of_involved_general_category, // reuse

                    // Address/Location
                    // street_address: formState.incident_address, // Removed to fix type error
                    icp_location: formState.icp_location,
                    is_icp_present: formState.icp_present === 'with',

                    personnel_on_duty: {
                        incident_commander: formState.incident_commander,
                        ground_commander: formState.ground_commander,
                        engine_commander: formState.pod_engine_commander,
                        shift_in_charge: formState.pod_shift_in_charge,
                        nozzleman: formState.pod_nozzleman,
                        lineman: formState.pod_lineman,
                        engine_crew: formState.pod_engine_crew,
                        driver: formState.pod_driver,
                        pump_operator: formState.pod_pump_operator,
                        safety_officer: { name: formState.pod_safety_officer, contact: formState.pod_safety_officer_contact },
                        investigator: { name: formState.pod_inv_name, contact: formState.pod_inv_contact }
                    },

                    casualty_details: {
                        injured: {
                            civilian: { m: parseInt(formState.injured_civilian_m) || 0, f: parseInt(formState.injured_civilian_f) || 0 },
                            firefighter: { m: parseInt(formState.injured_firefighter_m) || 0, f: parseInt(formState.injured_firefighter_f) || 0 },
                            auxiliary: { m: parseInt(formState.injured_auxiliary_m) || 0, f: parseInt(formState.injured_auxiliary_f) || 0 },
                        },
                        fatal: {
                            civilian: { m: parseInt(formState.fatal_civilian_m) || 0, f: parseInt(formState.fatal_civilian_f) || 0 },
                            firefighter: { m: parseInt(formState.fatal_firefighter_m) || 0, f: parseInt(formState.fatal_firefighter_f) || 0 },
                            auxiliary: { m: parseInt(formState.fatal_auxiliary_m) || 0, f: parseInt(formState.fatal_auxiliary_f) || 0 },
                        }
                    },

                    narrative_report: formState.narrative_report,

                    // New Fields
                    disposition: formState.disposition,
                    disposition_prepared_by: formState.disposition_prepared_by,
                    disposition_noted_by: formState.disposition_noted_by,
                }
            };

            const payload = {
                region_id: effectiveRegionId,
                incidents: [incident]
            };

            if (navigator.onLine) {
                const res = await edgeFunctions.uploadBundle(payload);
                const incidentId = res.incident_ids[0];
                if (!incidentId) {
                    throw new Error('Upload succeeded but no incident ID was returned.');
                }
                alert(`Uploaded successfully! Incident ID: ${incidentId}`);
                router.push('/dashboard/regional');
                router.refresh();
            } else {
                await queueIncident(payload);
                await checkPending();
                alert('Offline: Incident queued for sync.');
            }
        } catch (err: unknown) {
            console.error('Submission failed', err);
            alert(`Error: ${(err as Error).message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md max-w-4xl mx-auto space-y-6">
            {/* Header */}
            {/* Header Removed as per request */}

            {/* AFOR Header Bar */}
            <div className="flex justify-between items-center bg-red-800 -m-6 mb-4 p-4 rounded-t-lg text-white">
                <h2 className="text-xl font-bold">AFOR Report Entry</h2>
                {pendingCount > 0 && (
                    <button onClick={syncPending} className="text-xs bg-yellow-400 text-red-900 px-2 py-1 rounded font-bold hover:bg-yellow-300">
                        {pendingCount} Pending Sync
                    </button>
                )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-8 text-gray-900">
                {/* A. RESPONSE DETAILS */}
                <div className="space-y-4 border-b pb-4">
                    <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">A. Response Details</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">Type of Responder <span className="text-red-600">*</span></label>
                            <select name="responder_type" className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" value={formState.responder_type} onChange={handleChange}>
                                <option value="">Select Responder Type</option>
                                <option>First Responder</option>
                                <option>Augmenting Team</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">Name of Fire Station / Team</label>
                            <input name="fire_station_name" type="text" className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" value={formState.fire_station_name} onChange={handleChange} />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">Date Fire Notification Received</label>
                            <input name="notification_dt_date" type="date" className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" value={formState.notification_dt_date} onChange={handleChange} />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">Time Fire Notification Received</label>
                            <input name="notification_dt_time" type="time" className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" value={formState.notification_dt_time} onChange={handleChange} />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">Region</label>
                            <input
                                name="region"
                                list="afor-region-options"
                                type="text"
                                className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium"
                                placeholder="e.g. NCR / Region IV-A"
                                value={formState.region}
                                onChange={handleChange}
                            />
                            <datalist id="afor-region-options">
                                {regions.map((r) => (
                                    <option key={r.region_id} value={r.region_name} />
                                ))}
                            </datalist>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">Province / District</label>
                            <input
                                name="province_district"
                                type="text"
                                className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium"
                                value={formState.province_district}
                                onChange={handleChange}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">City / Municipality</label>
                            <input
                                name="city_municipality"
                                type="text"
                                className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium"
                                value={formState.city_municipality}
                                onChange={handleChange}
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-bold text-gray-900 mb-1">Complete Address of Fire Incident</label>
                            <input name="incident_address" type="text" className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium placeholder-gray-500" placeholder="House/Building No., Street Name, Barangay, City/Municipality, Province" value={formState.incident_address} onChange={handleChange} />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">Caller Name</label>
                            <input name="caller_name" type="text" className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" value={formState.caller_name} onChange={handleChange} />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">Caller Contact Number</label>
                            <input name="caller_number" type="tel" className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" value={formState.caller_number} onChange={handleChange} />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">Receiver Name</label>
                            <input name="receiver_name" type="text" className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" value={formState.receiver_name} onChange={handleChange} />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">Highest Alarm Level Tapped</label>
                            <select name="alarm_level" className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" value={formState.alarm_level} onChange={handleChange}>
                                <option value="">Select Alarm Level</option>
                                <option>First Alarm</option>
                                <option>Second Alarm</option>
                                <option>Third Alarm</option>
                                <option>Fourth Alarm</option>
                                <option>Fifth Alarm</option>
                                <option>Task Force Alpha</option>
                                <option>Task Force Bravo</option>
                                <option>Task Force Charlie</option>
                                <option>Task Force Delta</option>
                                <option>General Alarm</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* LOCATION — Incident Coordinates */}
                <div className="space-y-4 border-b pb-4">
                    <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2 flex items-center gap-2">
                        <MapPin className="w-5 h-5" /> Incident Location (WGS-84)
                    </h3>
                    <p className="text-xs text-gray-500">
                        Pin the fire incident location on the map or enter coordinates manually.
                        PostGIS stores POINT(longitude, latitude) — both values are required.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">Latitude (−90 to 90)</label>
                            <input
                                name="latitude"
                                type="number"
                                step="any"
                                className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium"
                                placeholder="e.g. 14.5547"
                                value={formState.latitude}
                                onChange={handleChange}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">Longitude (−180 to 180)</label>
                            <input
                                name="longitude"
                                type="number"
                                step="any"
                                className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium"
                                placeholder="e.g. 121.0244"
                                value={formState.longitude}
                                onChange={handleChange}
                            />
                        </div>
                    </div>
                    <div className="rounded-md overflow-hidden border border-gray-200" style={{ height: 320 }}>
                        <MapPicker
                            value={
                                formState.latitude && formState.longitude &&
                                Number.isFinite(parseFloat(formState.latitude)) &&
                                Number.isFinite(parseFloat(formState.longitude))
                                    ? { lat: parseFloat(formState.latitude), lng: parseFloat(formState.longitude) }
                                    : null
                            }
                            onChange={(lat, lng) =>
                                setFormState(prev => ({ ...prev, latitude: String(lat), longitude: String(lng) }))
                            }
                        />
                    </div>
                </div>

                {/* B. NATURE AND CLASSIFICATION */}
                <div className="space-y-4 border-b pb-4">
                    <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">B. Nature and Classification</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">Classification of Involved</label>
                            <select name="classification_of_involved" className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" value={formState.classification_of_involved} onChange={handleChange}>
                                <option value="">Select Classification</option>
                                <option>Structural</option>
                                <option>Non-Structural</option>
                                <option>Transportation</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">Type of Involved (General)</label>
                            <input name="type_of_involved_general_category" type="text" className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" placeholder="e.g. Residential" value={formState.type_of_involved_general_category} onChange={handleChange} />
                        </div>

                        {/* Extent of Damage Radios */}
                        <div className="md:col-span-2 space-y-2">
                            <label className="block text-sm font-bold text-gray-900">Extent of Damage</label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                                {['None / Minor', 'Confined to Object', 'Confined to Room', 'Confined to Structure', 'Total Loss', 'Extended Beyond Structure'].map(opt => (
                                    <label key={opt} className="flex items-center gap-2">
                                        <input type="radio" name="extent_of_damage" className="h-4 w-4" value={opt} checked={formState.extent_of_damage === opt} onChange={() => handleRadioChange('extent_of_damage', opt)} />
                                        <span>{opt}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Counts */}
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 md:col-span-2">
                            {['Structures', 'Households', 'Families', 'Individuals', 'Vehicles'].map(item => (
                                <div key={item}>
                                    <label className="block text-xs font-bold text-gray-900 mb-1">{item} Affected</label>
                                    <input type="number" name={`${item.toLowerCase()}_affected`} className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" value={(formState as Record<string, unknown>)[`${item.toLowerCase()}_affected`] as string ?? ''} onChange={handleChange} />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* C. ASSETS (Simplified for MVP view) */}
                <div className="space-y-4 border-b pb-4">
                    <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">C. Assets and Resources</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="col-span-2 md:col-span-4 font-bold text-gray-900">Vehicles</div>
                        {['resources_bfp_trucks', 'resources_lgu_trucks', 'resources_bfp_ambulance'].map(f => (
                            <div key={f}>
                                <label className="block text-xs font-bold text-gray-600 mb-1">{f.replace('resources_', '').replace(/_/g, ' ').toUpperCase()}</label>
                                <input type="number" name={f} className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" value={(formState as Record<string, unknown>)[f] as string ?? ''} onChange={handleChange} />
                            </div>
                        ))}
                    </div>
                </div>

                {/* D. FIRE ALARM LEVEL */}
                <div className="space-y-4 border-b pb-4">
                    <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">D. Fire Alarm Level</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        {['alarm_1st', 'alarm_2nd', 'alarm_3rd', 'alarm_general', 'alarm_fuc', 'alarm_fo'].map(f => (
                            <div key={f}>
                                <label className="block text-xs font-bold text-gray-600 mb-1">{f.replace('alarm_', '').toUpperCase()}</label>
                                <input type="datetime-local" name={f} className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-xs" value={(formState as Record<string, unknown>)[f] as string ?? ''} onChange={handleChange} />
                            </div>
                        ))}
                    </div>
                </div>

                {/* E. CASUALTIES (Simplified Table) */}
                <div className="space-y-4 border-b pb-4">
                    <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">E. Profile of Casualties</h3>
                    <table className="min-w-full text-xs border border-gray-300">
                        <thead className="bg-gray-100">
                            <tr>
                                <th className="border px-2 py-1 text-left">Category</th>
                                <th className="border px-2 py-1 text-center">Male</th>
                                <th className="border px-2 py-1 text-center">Female</th>
                            </tr>
                        </thead>
                        <tbody>
                            {['injured_civilian', 'injured_firefighter', 'fatal_civilian', 'fatal_firefighter'].map(cat => (
                                <tr key={cat}>
                                    <td className="border px-2 py-1 font-bold">{cat.replace(/_/g, ' ').toUpperCase()}</td>
                                    <td className="border px-1 py-1"><input type="number" name={`${cat}_m`} className="w-full border rounded p-1" value={(formState as Record<string, unknown>)[`${cat}_m`] as string ?? ''} onChange={handleChange} /></td>
                                    <td className="border px-1 py-1"><input type="number" name={`${cat}_f`} className="w-full border rounded p-1" value={(formState as Record<string, unknown>)[`${cat}_f`] as string ?? ''} onChange={handleChange} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* F. PERSONNEL */}
                <div className="space-y-4 border-b pb-4">
                    <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">F. Personnel On Duty</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">Incident Commander</label>
                            <input type="text" name="incident_commander" className="w-full border border-gray-300 rounded p-2" value={formState.incident_commander} onChange={handleChange} />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-1">Ground Commander</label>
                            <input type="text" name="ground_commander" className="w-full border border-gray-300 rounded p-2" value={formState.ground_commander} onChange={handleChange} />
                        </div>
                    </div>
                </div>

                {/* G. OTHER BFP PERSONNEL */}
                <div className="space-y-4 border-b pb-4">
                    <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">G. Other BFP Personnel and Significant Personalities</h3>
                    <p className="text-xs text-gray-600">Indicate others present (designation/agency).</p>
                    <div className="space-y-3">
                        {otherPersonnel.map((person, index) => (
                            <div key={index} className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                <input type="text" placeholder="Name" className="border border-gray-300 rounded p-2 text-gray-900 text-xs" value={person.name} onChange={(e) => handleOtherPersonnelChange(index, 'name', e.target.value)} />
                                <input type="text" placeholder="Designation / Agency" className="border border-gray-300 rounded p-2 text-gray-900 text-xs" value={person.designation} onChange={(e) => handleOtherPersonnelChange(index, 'designation', e.target.value)} />
                                <input type="text" placeholder="Remarks" className="border border-gray-300 rounded p-2 text-gray-900 text-xs" value={person.remarks} onChange={(e) => handleOtherPersonnelChange(index, 'remarks', e.target.value)} />
                            </div>
                        ))}
                        <button type="button" onClick={() => setOtherPersonnel([...otherPersonnel, { name: '', designation: '', remarks: '' }])} className="text-xs text-blue-600 hover:underline">+ Add Row</button>
                    </div>
                </div>

                {/* I. NARRATIVE */}
                <div className="space-y-4">
                    <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">I. Narrative Content</h3>
                    <textarea name="narrative_report" className="w-full border border-gray-300 rounded p-2 h-40 text-gray-900 font-medium placeholder-gray-500 text-sm" placeholder="On or about (time, date) call/report received, (Name of duty Floor watch/FCOS) received a call from (name of caller) with (telephone/CP number) regarding (description of type of involved) at (address) near (landmark)..." value={formState.narrative_report} onChange={handleChange}></textarea>
                </div>

                {/* J. PROBLEMS ENCOUNTERED */}
                <div className="space-y-4 border-b pb-4">
                    <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">J. Problems Encountered</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                        {PROBLEM_OPTIONS.map(prob => (
                            <label key={prob} className="flex items-start gap-2">
                                <input type="checkbox" className="mt-1 h-4 w-4" checked={(formState.problems_encountered || []).includes(prob)}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                        const current = formState.problems_encountered || [];
                                        const updated = e.target.checked ? [...current, prob] : current.filter((p: string) => p !== prob);
                                        setFormState(prev => ({ ...prev, problems_encountered: updated }));
                                    }} />
                                <span>{prob}</span>
                            </label>
                        ))}
                    </div>
                    <div className="mt-2">
                        <label className="block text-xs font-bold text-gray-900 mb-1">Others (specify)</label>
                        <input type="text" name="problems_others" className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm" value={formState.problems_others || ''} onChange={handleChange} />
                    </div>
                </div>

                {/* K. RECOMMENDATIONS */}
                <div className="space-y-4">
                    <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">K. Recommendations</h3>
                    <textarea name="recommendations" className="w-full border border-gray-300 rounded p-2 h-24 text-gray-900 font-medium placeholder-gray-500" placeholder="Provide clear and actionable recommendations..." value={formState.recommendations} onChange={handleChange}></textarea>
                </div>

                {/* L. DISPOSITION */}
                <div className="space-y-4 border-b pb-4">
                    <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">L. Disposition</h3>
                    <textarea name="disposition" className="w-full border border-gray-300 rounded p-2 h-28 text-gray-900 font-medium text-sm" placeholder="As of this date, no complaint has been filed..." value={formState.disposition || ''} onChange={handleChange}></textarea>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mt-2">
                        <div>
                            <label className="block font-bold mb-1">Prepared by (Shift-in-Charge)</label>
                            <input type="text" name="disposition_prepared_by" className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" value={formState.disposition_prepared_by || ''} onChange={handleChange} />
                        </div>
                        <div>
                            <label className="block font-bold mb-1">Noted by (Engine Company Commander)</label>
                            <input type="text" name="disposition_noted_by" className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" value={formState.disposition_noted_by || ''} onChange={handleChange} />
                        </div>
                    </div>
                </div>

                <button type="submit" disabled={loading} className="w-full bg-red-800 text-white py-3 rounded font-bold hover:bg-red-700 disabled:opacity-50 flex justify-center items-center gap-2 shadow-lg">
                    {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <Save className="w-5 h-5" />}
                    {loading ? 'Submitting Report...' : 'Submit AFOR Report'}
                </button>
            </form>
        </div>
    );
}
