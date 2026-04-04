'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { commitAforImport } from '@/lib/api';
import { MapPicker } from '@/components/MapPicker';

function isValidWgs84(lat: number, lng: number): boolean {
    return (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180
    );
}

/** Match `IncidentForm` AFOR Report Entry field styling */
const fieldClass = 'w-full border border-gray-300 rounded p-2 text-gray-900 font-medium';
const labelClass = 'block text-sm font-bold text-gray-900 mb-1';
const sectionClass = 'space-y-4 border-b pb-4';
const sectionTitleClass = 'font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2';

/** Values must satisfy DB + `_normalize_wildland_fire_type` (lowercase). */
const WILDLAND_FIRE_TYPES: { value: string; label: string }[] = [
    { value: '', label: '— Select —' },
    { value: 'fire', label: 'Fire' },
    { value: 'agricultural land fire', label: 'Agricultural land fire' },
    { value: 'brush fire', label: 'Brush fire' },
    { value: 'forest fire', label: 'Forest fire' },
    { value: 'grassland fire', label: 'Grassland fire' },
    { value: 'grazing land fire', label: 'Grazing land fire' },
    { value: 'mineral land fire', label: 'Mineral land fire' },
    { value: 'peatland fire', label: 'Peatland fire' },
];

/** Matches `wims.wildland_afor_alarm_statuses` CHECK and backend insert filter. */
const WILDLAND_ALARM_STATUSES = [
    '1st Alarm',
    '2nd Alarm',
    '3rd Alarm',
    '4th Alarm',
    'Task Force Alpha',
    'Task Force Bravo',
    'General Alarm',
    'Ongoing',
    'Fire Out',
    'Fire Under Control',
    'Fire Out Upon Arrival',
    'Fire Under Investigation',
    'Late Reported',
    'Unresponded',
    'No Firefighting Conducted',
] as const;

export type WildlandAlarmRow = {
    alarm_status: string;
    time_declared: string;
    ground_commander: string;
};

export type WildlandAssistRow = {
    organization_or_unit: string;
    detail: string;
};

export type WildlandFormState = {
    call_received_at: string;
    fire_started_at: string;
    fire_arrival_at: string;
    fire_controlled_at: string;
    caller_transmitted_by: string;
    caller_office_address: string;
    call_received_by_personnel: string;
    engine_dispatched: string;
    incident_location_description: string;
    distance_to_fire_station_km: string;
    primary_action_taken: string;
    assistance_combined_summary: string;
    buildings_involved: string;
    buildings_threatened: string;
    ownership_and_property_notes: string;
    total_area_burned_display: string;
    wildland_fire_type: string;
    narration: string;
    problems_text: string;
    recommendations_text: string;
    prepared_by: string;
    prepared_by_title: string;
    noted_by: string;
    noted_by_title: string;
    fire_behavior_elevation_ft: string;
    fire_behavior_flame_length_ft: string;
    fire_behavior_ros: string;
    alarmRows: WildlandAlarmRow[];
    assistRows: WildlandAssistRow[];
};

const emptyAlarmRow = (): WildlandAlarmRow => ({
    alarm_status: '',
    time_declared: '',
    ground_commander: '',
});

const emptyAssistRow = (): WildlandAssistRow => ({
    organization_or_unit: '',
    detail: '',
});

const defaultState = (): WildlandFormState => ({
    call_received_at: '',
    fire_started_at: '',
    fire_arrival_at: '',
    fire_controlled_at: '',
    caller_transmitted_by: '',
    caller_office_address: '',
    call_received_by_personnel: '',
    engine_dispatched: '',
    incident_location_description: '',
    distance_to_fire_station_km: '',
    primary_action_taken: '',
    assistance_combined_summary: '',
    buildings_involved: '',
    buildings_threatened: '',
    ownership_and_property_notes: '',
    total_area_burned_display: '',
    wildland_fire_type: '',
    narration: '',
    problems_text: '',
    recommendations_text: '',
    prepared_by: '',
    prepared_by_title: '',
    noted_by: '',
    noted_by_title: '',
    fire_behavior_elevation_ft: '',
    fire_behavior_flame_length_ft: '',
    fire_behavior_ros: '',
    alarmRows: [emptyAlarmRow()],
    assistRows: [emptyAssistRow()],
});

function toDatetimeLocalValue(iso: string | Date | null | undefined): string {
    if (iso == null || iso === '') return '';
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoFromLocal(dt: string): string | undefined {
    if (!dt?.trim()) return undefined;
    const d = new Date(dt);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function numOrUndef(s: string): number | undefined {
    if (!s?.trim()) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
}

function intOrZero(s: string): number {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
}

function wildlandFromInitial(wl: Record<string, unknown> | null | undefined): WildlandFormState {
    if (!wl || typeof wl !== 'object') return defaultState();
    const fb = (wl.fire_behavior as Record<string, unknown> | undefined) || {};
    const problems = wl.problems_encountered;
    let problems_text = '';
    if (Array.isArray(problems)) problems_text = problems.join('\n');
    else if (typeof problems === 'string') problems_text = problems;

    const recs = wl.recommendations_list ?? wl.recommendations;
    let recommendations_text = '';
    if (Array.isArray(recs)) recommendations_text = recs.join('\n');
    else if (typeof recs === 'string') recommendations_text = recs;

    const alarms = wl.wildland_alarm_statuses;
    const alarmRows: WildlandAlarmRow[] =
        Array.isArray(alarms) && alarms.length > 0
            ? alarms.map((a: Record<string, unknown>) => ({
                  alarm_status: String(a?.alarm_status ?? ''),
                  time_declared: String(a?.time_declared ?? ''),
                  ground_commander: String(a?.ground_commander ?? ''),
              }))
            : [emptyAlarmRow()];

    const assists = wl.wildland_assistance_rows;
    const assistRows: WildlandAssistRow[] =
        Array.isArray(assists) && assists.length > 0
            ? assists.map((a: Record<string, unknown>) => ({
                  organization_or_unit: String(a?.organization_or_unit ?? a?.organization ?? ''),
                  detail: String(a?.detail ?? ''),
              }))
            : [emptyAssistRow()];

    return {
        call_received_at: toDatetimeLocalValue(wl.call_received_at as string | Date | undefined),
        fire_started_at: toDatetimeLocalValue(wl.fire_started_at as string | Date | undefined),
        fire_arrival_at: toDatetimeLocalValue(wl.fire_arrival_at as string | Date | undefined),
        fire_controlled_at: toDatetimeLocalValue(wl.fire_controlled_at as string | Date | undefined),
        caller_transmitted_by: String(wl.caller_transmitted_by ?? ''),
        caller_office_address: String(wl.caller_office_address ?? ''),
        call_received_by_personnel: String(wl.call_received_by_personnel ?? ''),
        engine_dispatched: String(wl.engine_dispatched ?? ''),
        incident_location_description: String(wl.incident_location_description ?? ''),
        distance_to_fire_station_km:
            wl.distance_to_fire_station_km != null && wl.distance_to_fire_station_km !== ''
                ? String(wl.distance_to_fire_station_km)
                : '',
        primary_action_taken: String(wl.primary_action_taken ?? ''),
        assistance_combined_summary: String(wl.assistance_combined_summary ?? ''),
        buildings_involved: wl.buildings_involved != null ? String(wl.buildings_involved) : '',
        buildings_threatened: wl.buildings_threatened != null ? String(wl.buildings_threatened) : '',
        ownership_and_property_notes: String(wl.ownership_and_property_notes ?? ''),
        total_area_burned_display: String(wl.total_area_burned_display ?? ''),
        wildland_fire_type: typeof wl.wildland_fire_type === 'string' ? wl.wildland_fire_type : '',
        narration: String(wl.narration ?? ''),
        problems_text,
        recommendations_text,
        prepared_by: String(wl.prepared_by ?? ''),
        prepared_by_title: String(wl.prepared_by_title ?? ''),
        noted_by: String(wl.noted_by ?? ''),
        noted_by_title: String(wl.noted_by_title ?? ''),
        fire_behavior_elevation_ft: fb.elevation_ft != null ? String(fb.elevation_ft) : '',
        fire_behavior_flame_length_ft: fb.flame_length_ft != null ? String(fb.flame_length_ft) : '',
        fire_behavior_ros: fb.rate_of_spread_chains_per_hour != null ? String(fb.rate_of_spread_chains_per_hour) : '',
        alarmRows,
        assistRows,
    };
}

function buildWildlandPayload(s: WildlandFormState): Record<string, unknown> {
    const wl: Record<string, unknown> = {
        caller_transmitted_by: s.caller_transmitted_by,
        caller_office_address: s.caller_office_address,
        call_received_by_personnel: s.call_received_by_personnel,
        incident_location_description: s.incident_location_description,
        primary_action_taken: s.primary_action_taken,
        engine_dispatched: s.engine_dispatched,
        narration: s.narration,
        assistance_combined_summary: s.assistance_combined_summary || null,
        ownership_and_property_notes: s.ownership_and_property_notes,
        total_area_burned_display: s.total_area_burned_display,
        prepared_by: s.prepared_by,
        prepared_by_title: s.prepared_by_title,
        noted_by: s.noted_by,
        noted_by_title: s.noted_by_title,
        area_type_summary: {},
        causes_and_ignition_factors: {},
        suppression_factors: {},
        weather: {},
        peso_losses: {},
        casualties: {},
    };

    const cr = isoFromLocal(s.call_received_at);
    if (cr) wl.call_received_at = cr;
    const fs = isoFromLocal(s.fire_started_at);
    if (fs) wl.fire_started_at = fs;
    const fa = isoFromLocal(s.fire_arrival_at);
    if (fa) wl.fire_arrival_at = fa;
    const fc = isoFromLocal(s.fire_controlled_at);
    if (fc) wl.fire_controlled_at = fc;

    const dk = numOrUndef(s.distance_to_fire_station_km);
    if (dk !== undefined) wl.distance_to_fire_station_km = dk;

    if (s.buildings_involved.trim()) wl.buildings_involved = intOrZero(s.buildings_involved);
    else wl.buildings_involved = 0;
    if (s.buildings_threatened.trim()) wl.buildings_threatened = intOrZero(s.buildings_threatened);
    else wl.buildings_threatened = 0;

    if (s.wildland_fire_type) wl.wildland_fire_type = s.wildland_fire_type;

    const problems_lines = s.problems_text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    wl.problems_encountered = problems_lines;

    const rec_lines = s.recommendations_text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    wl.recommendations_list = rec_lines;

    const fb: Record<string, unknown> = {};
    const el = numOrUndef(s.fire_behavior_elevation_ft);
    if (el !== undefined) fb.elevation_ft = el;
    const fl = numOrUndef(s.fire_behavior_flame_length_ft);
    if (fl !== undefined) fb.flame_length_ft = fl;
    const ros = numOrUndef(s.fire_behavior_ros);
    if (ros !== undefined) fb.rate_of_spread_chains_per_hour = ros;
    wl.fire_behavior = fb;

    wl.wildland_alarm_statuses = s.alarmRows
        .filter((r) => r.alarm_status.trim())
        .map((r) => ({
            alarm_status: r.alarm_status.trim(),
            time_declared: r.time_declared.trim(),
            ground_commander: r.ground_commander.trim(),
        }));

    wl.wildland_assistance_rows = s.assistRows
        .filter((r) => r.organization_or_unit.trim())
        .map((r) => ({
            organization_or_unit: r.organization_or_unit.trim(),
            detail: r.detail.trim(),
        }));

    return wl;
}

export function WildlandAforManualForm({
    initialWildland,
    showDebugJson,
}: {
    initialWildland?: Record<string, unknown> | null;
    /** When true, show collapsible JSON from import handoff (debug). */
    showDebugJson?: boolean;
}) {
    const router = useRouter();
    const [state, setState] = useState<WildlandFormState>(defaultState);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [debugOpen, setDebugOpen] = useState(false);
    const [commitLatStr, setCommitLatStr] = useState('');
    const [commitLngStr, setCommitLngStr] = useState('');

    useEffect(() => {
        setState(wildlandFromInitial(initialWildland ?? undefined));
    }, [initialWildland]);

    const update = useCallback(
        <K extends keyof WildlandFormState>(key: K, value: WildlandFormState[K]) => {
            setState((prev) => ({ ...prev, [key]: value }));
        },
        []
    );

    const commitLat = parseFloat(commitLatStr);
    const commitLng = parseFloat(commitLngStr);
    const coordsReady = isValidWgs84(commitLat, commitLng);

    const onMapPick = useCallback((lat: number, lng: number) => {
        setCommitLatStr(String(lat));
        setCommitLngStr(String(lng));
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!coordsReady) return;
        setError(null);
        setLoading(true);
        try {
            const wildland = buildWildlandPayload(state);
            const row = {
                _form_kind: 'WILDLAND_AFOR',
                _city_text: '',
                region_id: 0,
                wildland,
            };
            await commitAforImport([row], 'WILDLAND_AFOR', {
                wildlandRowSource: 'MANUAL',
                latitude: commitLat,
                longitude: commitLng,
            });
            router.push('/dashboard/regional');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Commit failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md max-w-4xl mx-auto space-y-6">
            <div className="flex justify-between items-center bg-red-800 -m-6 mb-4 p-4 rounded-t-lg text-white">
                <div>
                    <h2 className="text-xl font-bold">AFOR Report Entry</h2>
                    <p className="text-sm font-normal text-red-100 mt-0.5">Wildland Fire Operations Report</p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-8 text-gray-900">
                {error && (
                    <div
                        className="border-l-4 border-red-800 bg-red-50 px-4 py-3 text-sm text-red-900"
                        role="alert"
                    >
                        {error}
                    </div>
                )}

                <div className="space-y-3 border-b pb-4">
                    <h3 className={sectionTitleClass}>Incident location (WGS84)</h3>
                    <p className="text-xs text-gray-600">
                        Required for regional commit. PostGIS stores POINT(longitude latitude); not GeoJSON [lat, lon].
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className={labelClass}>Latitude (-90 to 90)</label>
                            <input
                                type="number"
                                step="any"
                                value={commitLatStr}
                                onChange={(e) => setCommitLatStr(e.target.value)}
                                className={fieldClass}
                                placeholder="e.g. 14.5547"
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Longitude (-180 to 180)</label>
                            <input
                                type="number"
                                step="any"
                                value={commitLngStr}
                                onChange={(e) => setCommitLngStr(e.target.value)}
                                className={fieldClass}
                                placeholder="e.g. 121.0244"
                            />
                        </div>
                    </div>
                    <div className="w-full rounded-md overflow-hidden border border-gray-200">
                        <MapPicker
                            value={
                                isValidWgs84(commitLat, commitLng)
                                    ? { lat: commitLat, lng: commitLng }
                                    : null
                            }
                            onChange={onMapPick}
                        />
                    </div>
                </div>

                {showDebugJson && initialWildland && Object.keys(initialWildland).length > 0 && (
                    <div className="space-y-2 border-b pb-4">
                        <button
                            type="button"
                            onClick={() => setDebugOpen(!debugOpen)}
                            className="text-xs font-bold text-blue-600 hover:underline"
                        >
                            {debugOpen ? '▼' : '▶'} Advanced / import payload (debug)
                        </button>
                        {debugOpen && (
                            <pre className="text-xs bg-gray-50 p-3 rounded border border-gray-200 overflow-x-auto max-h-48 overflow-y-auto">
                                {JSON.stringify(initialWildland, null, 2)}
                            </pre>
                        )}
                    </div>
                )}

                <div className={sectionClass}>
                    <h3 className={sectionTitleClass}>A. Dates and Times</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className={labelClass}>Call received</label>
                            <input
                                type="datetime-local"
                                value={state.call_received_at}
                                onChange={(e) => update('call_received_at', e.target.value)}
                                className={`${fieldClass} text-xs`}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Fire started</label>
                            <input
                                type="datetime-local"
                                value={state.fire_started_at}
                                onChange={(e) => update('fire_started_at', e.target.value)}
                                className={`${fieldClass} text-xs`}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Fire arrival</label>
                            <input
                                type="datetime-local"
                                value={state.fire_arrival_at}
                                onChange={(e) => update('fire_arrival_at', e.target.value)}
                                className={`${fieldClass} text-xs`}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Fire controlled</label>
                            <input
                                type="datetime-local"
                                value={state.fire_controlled_at}
                                onChange={(e) => update('fire_controlled_at', e.target.value)}
                                className={`${fieldClass} text-xs`}
                            />
                        </div>
                    </div>
                </div>

                <div className={sectionClass}>
                    <h3 className={sectionTitleClass}>B. Caller / Report</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className={labelClass}>Transmitted by</label>
                            <input
                                type="text"
                                value={state.caller_transmitted_by}
                                onChange={(e) => update('caller_transmitted_by', e.target.value)}
                                className={fieldClass}
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className={labelClass}>Office / address</label>
                            <input
                                type="text"
                                value={state.caller_office_address}
                                onChange={(e) => update('caller_office_address', e.target.value)}
                                className={fieldClass}
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className={labelClass}>Call received by</label>
                            <input
                                type="text"
                                value={state.call_received_by_personnel}
                                onChange={(e) => update('call_received_by_personnel', e.target.value)}
                                className={fieldClass}
                            />
                        </div>
                    </div>
                </div>

                <div className={sectionClass}>
                    <h3 className={sectionTitleClass}>C. Location of Incident</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className={labelClass}>Incident location description</label>
                            <textarea
                                value={state.incident_location_description}
                                onChange={(e) => update('incident_location_description', e.target.value)}
                                rows={3}
                                className={`${fieldClass} text-sm`}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Distance to fire station (km)</label>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={state.distance_to_fire_station_km}
                                onChange={(e) => update('distance_to_fire_station_km', e.target.value)}
                                className={fieldClass}
                            />
                        </div>
                    </div>
                </div>

                <div className={sectionClass}>
                    <h3 className={sectionTitleClass}>D. Response</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className={labelClass}>Engine dispatched</label>
                            <input
                                type="text"
                                value={state.engine_dispatched}
                                onChange={(e) => update('engine_dispatched', e.target.value)}
                                className={fieldClass}
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className={labelClass}>Primary action taken</label>
                            <textarea
                                value={state.primary_action_taken}
                                onChange={(e) => update('primary_action_taken', e.target.value)}
                                rows={3}
                                className={`${fieldClass} text-sm`}
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className={labelClass}>Assistance summary</label>
                            <textarea
                                value={state.assistance_combined_summary}
                                onChange={(e) => update('assistance_combined_summary', e.target.value)}
                                rows={2}
                                className={`${fieldClass} text-sm`}
                            />
                        </div>
                    </div>
                </div>

                <div className={sectionClass}>
                    <h3 className={sectionTitleClass}>Property &amp; Area</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className={labelClass}>Buildings involved</label>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={state.buildings_involved}
                                onChange={(e) => update('buildings_involved', e.target.value)}
                                className={fieldClass}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Buildings threatened</label>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={state.buildings_threatened}
                                onChange={(e) => update('buildings_threatened', e.target.value)}
                                className={fieldClass}
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className={labelClass}>Ownership / property notes</label>
                            <textarea
                                value={state.ownership_and_property_notes}
                                onChange={(e) => update('ownership_and_property_notes', e.target.value)}
                                rows={2}
                                className={`${fieldClass} text-sm`}
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className={labelClass}>Total area burned (display)</label>
                            <input
                                type="text"
                                value={state.total_area_burned_display}
                                onChange={(e) => update('total_area_burned_display', e.target.value)}
                                className={fieldClass}
                                placeholder="e.g. 12 ha"
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Wildland fire type</label>
                            <select
                                value={state.wildland_fire_type}
                                onChange={(e) => update('wildland_fire_type', e.target.value)}
                                className={fieldClass}
                            >
                                {WILDLAND_FIRE_TYPES.map((o) => (
                                    <option key={o.label + o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                <div className={sectionClass}>
                    <h3 className={sectionTitleClass}>Narrative &amp; Notes</h3>
                    <div>
                        <label className={labelClass}>Narration</label>
                        <textarea
                            value={state.narration}
                            onChange={(e) => update('narration', e.target.value)}
                            rows={5}
                            className={`${fieldClass} h-40 text-sm placeholder-gray-500`}
                            placeholder="Describe the incident, actions taken, and outcomes..."
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Problems encountered (one per line)</label>
                        <textarea
                            value={state.problems_text}
                            onChange={(e) => update('problems_text', e.target.value)}
                            rows={3}
                            className={`${fieldClass} text-sm`}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Recommendations (one per line)</label>
                        <textarea
                            value={state.recommendations_text}
                            onChange={(e) => update('recommendations_text', e.target.value)}
                            rows={3}
                            className={`${fieldClass} text-sm`}
                            placeholder="Provide clear and actionable recommendations..."
                        />
                    </div>
                </div>

                <div className={sectionClass}>
                    <h3 className={sectionTitleClass}>Fire Behavior (optional)</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className={labelClass}>Elevation (ft)</label>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={state.fire_behavior_elevation_ft}
                                onChange={(e) => update('fire_behavior_elevation_ft', e.target.value)}
                                className={fieldClass}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Flame length (ft)</label>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={state.fire_behavior_flame_length_ft}
                                onChange={(e) => update('fire_behavior_flame_length_ft', e.target.value)}
                                className={fieldClass}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Rate of spread (ch/hr)</label>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={state.fire_behavior_ros}
                                onChange={(e) => update('fire_behavior_ros', e.target.value)}
                                className={fieldClass}
                            />
                        </div>
                    </div>
                </div>

                <div className={sectionClass}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className={sectionTitleClass}>Alarm Status Timeline</h3>
                        <button
                            type="button"
                            onClick={() => update('alarmRows', [...state.alarmRows, emptyAlarmRow()])}
                            className="text-xs text-blue-600 hover:underline font-bold"
                        >
                            + Add Row
                        </button>
                    </div>
                    <div className="space-y-3">
                        {state.alarmRows.map((row, i) => (
                            <div
                                key={i}
                                className="flex flex-wrap gap-2 items-end border-b border-gray-200 pb-3"
                            >
                                <div className="min-w-[160px]">
                                    <label className="block text-xs font-bold text-gray-600 mb-1">Status</label>
                                    <select
                                        value={row.alarm_status}
                                        onChange={(e) => {
                                            const next = [...state.alarmRows];
                                            next[i] = { ...row, alarm_status: e.target.value };
                                            update('alarmRows', next);
                                        }}
                                        className={`${fieldClass} text-xs`}
                                    >
                                        <option value="">—</option>
                                        {WILDLAND_ALARM_STATUSES.map((s) => (
                                            <option key={s} value={s}>
                                                {s}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="min-w-[120px] flex-1">
                                    <label className="block text-xs font-bold text-gray-600 mb-1">
                                        Time declared
                                    </label>
                                    <input
                                        type="text"
                                        value={row.time_declared}
                                        onChange={(e) => {
                                            const next = [...state.alarmRows];
                                            next[i] = { ...row, time_declared: e.target.value };
                                            update('alarmRows', next);
                                        }}
                                        className={`${fieldClass} text-xs`}
                                    />
                                </div>
                                <div className="min-w-[140px] flex-1">
                                    <label className="block text-xs font-bold text-gray-600 mb-1">
                                        Ground commander
                                    </label>
                                    <input
                                        type="text"
                                        value={row.ground_commander}
                                        onChange={(e) => {
                                            const next = [...state.alarmRows];
                                            next[i] = { ...row, ground_commander: e.target.value };
                                            update('alarmRows', next);
                                        }}
                                        className={`${fieldClass} text-xs`}
                                    />
                                </div>
                                {state.alarmRows.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            update(
                                                'alarmRows',
                                                state.alarmRows.filter((_, j) => j !== i)
                                            )
                                        }
                                        className="p-2 text-red-700 hover:bg-red-50 rounded border border-transparent hover:border-red-200"
                                        aria-label="Remove row"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                <div className={sectionClass}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className={sectionTitleClass}>Assistance</h3>
                        <button
                            type="button"
                            onClick={() => update('assistRows', [...state.assistRows, emptyAssistRow()])}
                            className="text-xs text-blue-600 hover:underline font-bold"
                        >
                            + Add Row
                        </button>
                    </div>
                    <div className="space-y-3">
                        {state.assistRows.map((row, i) => (
                            <div
                                key={i}
                                className="flex flex-wrap gap-2 items-end border-b border-gray-200 pb-3"
                            >
                                <div className="min-w-[200px] flex-1">
                                    <label className="block text-xs font-bold text-gray-600 mb-1">
                                        Organization / unit
                                    </label>
                                    <input
                                        type="text"
                                        value={row.organization_or_unit}
                                        onChange={(e) => {
                                            const next = [...state.assistRows];
                                            next[i] = { ...row, organization_or_unit: e.target.value };
                                            update('assistRows', next);
                                        }}
                                        className={`${fieldClass} text-xs`}
                                    />
                                </div>
                                <div className="min-w-[200px] flex-1">
                                    <label className="block text-xs font-bold text-gray-600 mb-1">Detail</label>
                                    <input
                                        type="text"
                                        value={row.detail}
                                        onChange={(e) => {
                                            const next = [...state.assistRows];
                                            next[i] = { ...row, detail: e.target.value };
                                            update('assistRows', next);
                                        }}
                                        className={`${fieldClass} text-xs`}
                                    />
                                </div>
                                {state.assistRows.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            update(
                                                'assistRows',
                                                state.assistRows.filter((_, j) => j !== i)
                                            )
                                        }
                                        className="p-2 text-red-700 hover:bg-red-50 rounded border border-transparent hover:border-red-200"
                                        aria-label="Remove row"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-4 border-b pb-4">
                    <h3 className={sectionTitleClass}>Prepared / Noted</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className={labelClass}>Prepared by</label>
                            <input
                                type="text"
                                value={state.prepared_by}
                                onChange={(e) => update('prepared_by', e.target.value)}
                                className={fieldClass}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Title</label>
                            <input
                                type="text"
                                value={state.prepared_by_title}
                                onChange={(e) => update('prepared_by_title', e.target.value)}
                                className={fieldClass}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Noted by</label>
                            <input
                                type="text"
                                value={state.noted_by}
                                onChange={(e) => update('noted_by', e.target.value)}
                                className={fieldClass}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Noted by title</label>
                            <input
                                type="text"
                                value={state.noted_by_title}
                                onChange={(e) => update('noted_by_title', e.target.value)}
                                className={fieldClass}
                            />
                        </div>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={loading || !coordsReady}
                    className="w-full bg-red-800 text-white py-3 rounded font-bold hover:bg-red-700 disabled:opacity-50 flex justify-center items-center gap-2 shadow-lg"
                >
                    {loading ? (
                        <Loader2 className="animate-spin w-5 h-5" />
                    ) : (
                        <Save className="w-5 h-5" />
                    )}
                    {loading ? 'Submitting Report...' : 'Submit Wildland AFOR'}
                </button>
            </form>
        </div>
    );
}
