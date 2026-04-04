'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUserProfile } from '@/lib/auth';
import { fetchIncident } from '@/lib/api';
import { edgeFunctions, ConflictDetectionResponse } from '@/lib/edgeFunctions';
import { CheckCircle, XCircle, ShieldAlert } from 'lucide-react';

export default function IncidentDetailPage() {
    const params = useParams();
    const id = parseInt(params.id as string);
    const router = useRouter();
    const { role, loading: authLoading } = useUserProfile();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [incident, setIncident] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [conflictData, setConflictData] = useState<ConflictDetectionResponse | null>(null);
    const [processing, setProcessing] = useState(false);

    const loadIncident = useCallback(async () => {
        setLoading(true);
        const data = await fetchIncident(id);
        setIncident(data);
        setLoading(false);
    }, [id]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (!isNaN(id)) loadIncident();
    }, [id, loadIncident]);

    const handleConflictCheck = async () => {
        setProcessing(true);
        try {
            const res = await edgeFunctions.runConflictDetection(id);
            setConflictData(res);
        } catch (e: unknown) {
            alert('Error checking conflicts: ' + (e as Error).message);
        }
        setProcessing(false);
    };

    const handleCommit = async (decision: 'VERIFY' | 'REJECT') => {
        if (!confirm(`Are you sure you want to ${decision} this incident?`)) return;
        setProcessing(true);
        try {
            await edgeFunctions.commitIncident({ incident_id: id, decision });
            alert(`Incident ${decision}ED successfully!`);
            router.push('/incidents');
        } catch (e: unknown) {
            alert('Error committing incident: ' + (e as Error).message);
        }
        setProcessing(false);
    };

    if (loading || authLoading) return <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading...</div>;
    if (!incident) return <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>Incident not found</div>;

    const isValidator = role === 'VALIDATOR';

    return (
        <div className="space-y-6">
            {/* Incident Header Card */}
            <div className="card overflow-hidden">
                <div className="card-header flex justify-between items-center" style={{ borderLeft: '4px solid var(--bfp-maroon)' }}>
                    <span className="text-base font-bold">Incident #{id}</span>
                    <span className={`px-2.5 py-1 rounded text-xs font-bold ${
                        incident.verification_status === 'VERIFIED' ? 'bg-green-100 text-green-800' :
                        incident.verification_status === 'REJECTED' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                    }`}>
                        {incident.verification_status}
                    </span>
                </div>
                <div className="card-body">
                    <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                        Reported: {new Date(incident.incident_nonsensitive_details.notification_dt).toLocaleString()}
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Location & Type */}
                        <div>
                            <h3 className="text-sm font-bold mb-3 pb-2" style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)' }}>Location & Type</h3>
                            <dl className="space-y-3">
                                <InfoRow label="Barangay" value={incident.incident_nonsensitive_details.barangay} />
                                <InfoRow label="Category" value={incident.incident_nonsensitive_details.general_category} />
                                <InfoRow label="Alarm Level" value={incident.incident_nonsensitive_details.alarm_level} />
                            </dl>
                        </div>

                        {/* Sensitive Details */}
                        <div>
                            <h3 className="text-sm font-bold mb-3 pb-2" style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)' }}>Sensitive Details</h3>
                            {incident.incident_sensitive_details ? (
                                <dl className="space-y-3">
                                    <InfoRow label="Occupancy" value={incident.incident_sensitive_details.occupancy ?? 'N/A'} />
                                    <InfoRow label="Casualties" value={incident.incident_sensitive_details.casualties_count ?? 'N/A'} />
                                    <InfoRow label="Est. Damage" value={incident.incident_sensitive_details.estimated_damage ?? 'N/A'} />
                                </dl>
                            ) : (
                                <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>Restricted or not available.</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Validator Actions */}
            {isValidator && incident.verification_status === 'PENDING' && (
                <div className="card overflow-hidden">
                    <div className="card-header flex items-center gap-2" style={{ borderLeft: '4px solid #3b82f6' }}>
                        <ShieldAlert className="w-4 h-4 text-blue-500" />
                        <span>Validation Actions</span>
                    </div>
                    <div className="card-body space-y-4">
                        <button onClick={handleConflictCheck} disabled={processing}
                            className="px-4 py-2 rounded-md text-sm font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors disabled:opacity-50">
                            {processing ? 'Checking...' : 'Run Conflict Detection'}
                        </button>

                        {conflictData && (
                            <div className="p-4 rounded-lg" style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}>
                                <h4 className="text-sm font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Conflict Detection Results</h4>
                                {conflictData.potential_duplicates.length === 0 ? (
                                    <p className="text-sm text-green-600">No duplicates found within time window.</p>
                                ) : (
                                    <ul className="space-y-2">
                                        {conflictData.potential_duplicates.map(dup => (
                                            <li key={dup.incident_id} className="text-sm p-2 rounded border bg-white" style={{ borderColor: 'var(--border-color)' }}>
                                                Duplicate ID: {dup.incident_id} | {new Date(dup.notification_dt).toLocaleString()} | {dup.status}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}

                        <div className="flex gap-4 pt-2">
                            <button onClick={() => handleCommit('VERIFY')} disabled={processing}
                                className="flex-1 py-3 rounded-md text-white font-bold text-sm bg-green-600 hover:bg-green-700 flex justify-center items-center gap-2 disabled:opacity-50 transition-colors">
                                <CheckCircle className="w-5 h-5" /> Verify Incident
                            </button>
                            <button onClick={() => handleCommit('REJECT')} disabled={processing}
                                className="flex-1 py-3 rounded-md text-white font-bold text-sm bg-red-600 hover:bg-red-700 flex justify-center items-center gap-2 disabled:opacity-50 transition-colors">
                                <XCircle className="w-5 h-5" /> Reject Incident
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
            <dt className="text-sm" style={{ color: 'var(--text-secondary)' }}>{label}</dt>
            <dd className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</dd>
        </div>
    );
}
