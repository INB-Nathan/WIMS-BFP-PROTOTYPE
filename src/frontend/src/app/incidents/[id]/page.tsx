'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUserProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabaseClient';
import { edgeFunctions, ConflictDetectionResponse } from '@/lib/edgeFunctions';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

export default function IncidentDetailPage() {
    const params = useParams();
    const id = parseInt(params.id as string);
    const router = useRouter();
    const { role, loading: authLoading } = useUserProfile();
    const [incident, setIncident] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [conflictData, setConflictData] = useState<ConflictDetectionResponse | null>(null);
    const [processing, setProcessing] = useState(false);

    const supabase = createClient();

    useEffect(() => {
        if (!isNaN(id)) fetchIncident();
    }, [id]);

    const fetchIncident = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('fire_incidents')
            .select(`
              *,
              incident_nonsensitive_details (*),
              incident_sensitive_details (*)
          `)
            .eq('incident_id', id)
            .single();

        if (error) {
            console.error("Error fetching incident", error);
        } else {
            setIncident(data);
        }
        setLoading(false);
    };

    const handleConflictCheck = async () => {
        setProcessing(true);
        try {
            const res = await edgeFunctions.runConflictDetection(id);
            setConflictData(res);
        } catch (e: any) {
            alert('Error checking conflicts: ' + e.message);
        }
        setProcessing(false);
    };

    const handleCommit = async (decision: 'VERIFY' | 'REJECT') => {
        if (!confirm(`Are you sure you want to ${decision} this incident?`)) return;
        setProcessing(true);
        try {
            await edgeFunctions.commitIncident({
                incident_id: id,
                decision,
            });
            alert(`Incident ${decision}ED successfully!`);
            router.push('/incidents');
        } catch (e: any) {
            alert('Error committing incident: ' + e.message);
        }
        setProcessing(false);
    };

    if (loading || authLoading) return <div className="p-8 text-center">Loading...</div>;
    if (!incident) return <div className="p-8 text-center">Incident not found</div>;

    const isValidator = role === 'VALIDATOR';

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded shadow border border-gray-300">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h1 className="text-4xl font-black text-black mb-2">Incident #{id}</h1>
                        <div className="text-gray-900 font-bold text-sm">
                            Reported: {new Date(incident.incident_nonsensitive_details.notification_dt).toLocaleString()}
                        </div>
                    </div>
                    <div className={`px-3 py-1 rounded font-bold ${incident.verification_status === 'VERIFIED' ? 'bg-green-100 text-green-800' :
                        incident.verification_status === 'REJECTED' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                        }`}>
                        {incident.verification_status}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                        <h3 className="font-semibold text-xl text-black border-b border-gray-300 pb-2 mb-3">Location & Type</h3>
                        <dl className="space-y-3">
                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
                                <dt className="text-gray-900 font-bold max-sm:mb-1">Barangay:</dt>
                                <dd className="font-black text-black">{incident.incident_nonsensitive_details.barangay}</dd>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
                                <dt className="text-gray-900 font-bold max-sm:mb-1">Category:</dt>
                                <dd className="font-black text-black">{incident.incident_nonsensitive_details.general_category}</dd>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
                                <dt className="text-gray-900 font-bold max-sm:mb-1">Alarm Level:</dt>
                                <dd className="font-black text-black">{incident.incident_nonsensitive_details.alarm_level}</dd>
                            </div>
                        </dl>
                    </div>

                    <div>
                        <h3 className="font-semibold text-xl text-black border-b border-gray-300 pb-2 mb-3">Sensitive Details</h3>
                        {/* Sensitive details might be null/empty if RLS hides them?
                         Actually RLS mirrors access, so Validator should see them for their region.
                         Wait, RLS "Strict data minimization": "Analyst sees aggregates" but Validator needs specific privs?
                         Validators insert/read sensitive details? 
                         Let's assume they can see them if RLS allows.
                      */}
                        {incident.incident_sensitive_details ? (
                            <dl className="space-y-3">
                                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
                                    <dt className="text-gray-900 font-bold max-sm:mb-1">Occupancy:</dt>
                                    <dd className="font-black text-black">{incident.incident_sensitive_details.occupancy ?? 'N/A'}</dd>
                                </div>
                                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
                                    <dt className="text-gray-900 font-bold max-sm:mb-1">Casualties:</dt>
                                    <dd className="font-black text-black">{incident.incident_sensitive_details.casualties_count ?? 'N/A'}</dd>
                                </div>
                                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
                                    <dt className="text-gray-900 font-bold max-sm:mb-1">Est. Damage:</dt>
                                    <dd className="font-black text-black">{incident.incident_sensitive_details.estimated_damage ?? 'N/A'}</dd>
                                </div>
                            </dl>
                        ) : (
                            <div className="text-gray-900 font-bold italic">Restricted or not available.</div>
                        )}
                    </div>
                </div>
            </div>

            {/* VALIDATOR ACTIONS */}
            {isValidator && incident.verification_status === 'PENDING' && (
                <div className="bg-white p-6 rounded shadow border border-blue-100">
                    <h3 className="font-semibold text-lg mb-4">Validation Actions</h3>
                    <div className="flex flex-wrap gap-4 mb-6">
                        <button
                            onClick={handleConflictCheck}
                            disabled={processing}
                            className="bg-purple-100 text-purple-700 px-4 py-2 rounded hover:bg-purple-200"
                        >
                            {processing ? 'Checking...' : 'Run Conflict Detection'}
                        </button>
                    </div>

                    {conflictData && (
                        <div className="bg-gray-50 p-4 rounded mb-6 border">
                            <h4 className="font-bold mb-2">Conflict Detection Results</h4>
                            {conflictData.potential_duplicates.length === 0 ? (
                                <p className="text-green-600">No duplicates found within time window.</p>
                            ) : (
                                <ul className="space-y-2">
                                    {conflictData.potential_duplicates.map(dup => (
                                        <li key={dup.incident_id} className="text-sm bg-white p-2 border rounded">
                                            Duplicate ID: {dup.incident_id} | {new Date(dup.notification_dt).toLocaleString()} | {dup.status}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}

                    <div className="flex gap-4">
                        <button
                            onClick={() => handleCommit('VERIFY')}
                            disabled={processing}
                            className="flex-1 bg-green-600 text-white py-3 rounded hover:bg-green-700 flex justify-center items-center gap-2"
                        >
                            <CheckCircle /> Verify Incident
                        </button>
                        <button
                            onClick={() => handleCommit('REJECT')}
                            disabled={processing}
                            className="flex-1 bg-red-600 text-white py-3 rounded hover:bg-red-700 flex justify-center items-center gap-2"
                        >
                            <XCircle /> Reject Incident
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
