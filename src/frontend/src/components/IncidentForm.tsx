'use client';

import { useState, useEffect } from 'react';
import { edgeFunctions, Incident } from '@/lib/edgeFunctions';
import { queueIncident, getPendingIncidents, markSynced } from '@/lib/offlineStore';
import { useUserProfile } from '@/lib/auth';
import { Loader2, Save, Upload } from 'lucide-react';

export function IncidentForm() {
    const { assignedRegionId } = useUserProfile();
    const [loading, setLoading] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);

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
    });

    // Dynamic Lists
    const [otherPersonnel, setOtherPersonnel] = useState<{ name: string, designation: string, remarks: string }[]>([
        { name: '', designation: '', remarks: '' },
        { name: '', designation: '', remarks: '' },
        { name: '', designation: '', remarks: '' }
    ]);

    const handleOtherPersonnelChange = (index: number, field: string, value: string) => {
        const newPersonnel = [...otherPersonnel];
        // @ts-ignore
        newPersonnel[index][field] = value;
        setOtherPersonnel(newPersonnel);
    };

    // Check pending
    useEffect(() => {
        checkPending();
        const handleOnline = () => syncPending();
        window.addEventListener('online', handleOnline);
        return () => window.removeEventListener('online', handleOnline);
    }, []);

    const checkPending = async () => {
        const pending = await getPendingIncidents();
        setPendingCount(pending.length);
    };

    const syncPending = async () => {
        if (!navigator.onLine) return;
        const pending = await getPendingIncidents();
        if (pending.length === 0) return;
        console.log('Syncing pending...', pending.length);
        for (const item of pending) {
            try {
                await edgeFunctions.uploadBundle(item.payload);
                await markSynced(item.id!);
            } catch (e) {
                console.error('Failed to sync item', item.id, e);
            }
        }
        await checkPending();
    };

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

        if (!assignedRegionId) {
            alert("No region assigned.");
            return;
        }

        setLoading(true);

        try {
            // Map Form State to Incident Interface
            const incident: Incident = {
                region_id: assignedRegionId,
                incident_nonsensitive_details: {
                    notification_dt: formState.notification_dt_date && formState.notification_dt_time ? `${formState.notification_dt_date}T${formState.notification_dt_time}:00` : new Date().toISOString(),
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
                        trucks: {
                            bfp: parseInt(formState.resources_bfp_trucks) || 0,
                            lgu: parseInt(formState.resources_lgu_trucks) || 0,
                            non_bfp: parseInt(formState.resources_non_bfp_trucks) || 0,
                        },
                        ambulance: {
                            bfp: parseInt(formState.resources_bfp_ambulance) || 0,
                            non_bfp: parseInt(formState.resources_non_bfp_ambulance) || 0,
                        },
                        rescue: {
                            bfp: parseInt(formState.resources_bfp_rescue) || 0,
                            non_bfp: parseInt(formState.resources_non_bfp_rescue) || 0,
                        },
                        others: formState.resources_others,
                        tools: {
                            scba: parseInt(formState.tools_scba) || 0,
                            rope: formState.tools_rope,
                            ladder: parseInt(formState.tools_ladder) || 0,
                            hoseline: formState.tools_hoseline,
                            hydraulic: parseInt(formState.tools_hydraulic) || 0,
                            others: formState.tools_others
                        },
                        hydrant_distance: formState.hydrant_location_distance
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
                    problems_encountered: formState.problems_encountered ? [...(formState.problems_encountered || []), formState.problems_others].filter(Boolean) : [],
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

                    other_personnel: otherPersonnel,

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
                region_id: assignedRegionId,
                incidents: [incident]
            };

            if (navigator.onLine) {
                const res = await edgeFunctions.uploadBundle(payload);
                alert(`Uploaded successfully! Batch ID: ${res.batch_id}`);
                // Optional: Reset form here
            } else {
                await queueIncident(payload);
                await checkPending();
                alert('Offline: Incident queued for sync.');
            }
        } catch (err: any) {
            console.error('Submission failed', err);
            alert(`Error: ${err.message}`);
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
                                <option>General Alarm</option>
                            </select>
                        </div>
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
                                    <input type="number" name={`${item.toLowerCase()}_affected`} className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" value={(formState as any)[`${item.toLowerCase()}_affected`]} onChange={handleChange} />
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
                                <input type="number" name={f} className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" value={(formState as any)[f]} onChange={handleChange} />
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
                                <input type="datetime-local" name={f} className="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-xs" value={(formState as any)[f]} onChange={handleChange} />
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
                                    <td className="border px-1 py-1"><input type="number" name={`${cat}_m`} className="w-full border rounded p-1" value={(formState as any)[`${cat}_m`]} onChange={handleChange} /></td>
                                    <td className="border px-1 py-1"><input type="number" name={`${cat}_f`} className="w-full border rounded p-1" value={(formState as any)[`${cat}_f`]} onChange={handleChange} /></td>
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

                {/* H. SKETCH (Placeholder) */}
                <div className="space-y-4 border-b pb-4">
                    <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">H. Sketch of Fire Scene</h3>
                    <div className="border-2 border-dashed border-gray-300 rounded p-8 text-center bg-gray-50">
                        <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
                        <span className="text-sm text-gray-500">Upload Sketch Image (Not fully connected in MVP)</span>
                        <input type="file" className="hidden" />
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
                        {[
                            "Inaccurate address / no landmarks", "Geographically challenged", "Road conditions", "Road under construction",
                            "Traffic congestion", "Road accidents", "Vehicles failure to yield", "Natural disasters",
                            "Civil disturbance", "Uncooperative / panicked residents", "Safety and security threats", "Response delays (security/owner)",
                            "Engine failure / mechanical problems", "Uncooperative fire auxiliary", "Poor water supply", "Intense heat and smoke",
                            "Structural hazards", "Equipment malfunction", "Lack of coordination", "Breakdown in radio communication",
                            "HazMat contamination", "Physical exhaustion", "Emotional/psychological effects", "Community complaints"
                        ].map(prob => (
                            <label key={prob} className="flex items-start gap-2">
                                <input type="checkbox" className="mt-1 h-4 w-4" checked={(formState.problems_encountered || []).includes(prob)}
                                    onChange={(e) => {
                                        const current = formState.problems_encountered || [];
                                        const updated = e.target.checked ? [...current, prob] : current.filter(p => p !== prob);
                                        // @ts-ignore
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
