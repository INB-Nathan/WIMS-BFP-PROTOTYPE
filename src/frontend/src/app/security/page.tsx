'use client';

import { useEffect, useState } from 'react';
import { useUserProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabaseClient';
import { edgeFunctions } from '@/lib/edgeFunctions';
import { ShieldAlert, CheckCircle, XCircle, AlertTriangle, Eye, Search } from 'lucide-react';
import Link from 'next/link';

// Types matching DB
interface SecurityThreatLog {
    log_id: number;
    timestamp: string;
    source_ip: string;
    destination_ip: string;
    suricata_sid: number;
    severity_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    raw_payload: string; // JSON string
    xai_narrative: string;
    xai_confidence: number;
    admin_action_taken: string | null;
    reviewed_by: string | null;
}

const getActionBadge = (action: string | null) => {
    if (!action) return <span className="text-gray-400 italic">Unreviewed</span>;
    switch (action) {
        case 'RESOLVED':
            return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-green-50 text-green-700 border border-green-200 text-xs font-bold"><CheckCircle className="w-3.5 h-3.5" /> RESOLVED</span>;
        case 'FALSE_POSITIVE':
            return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 text-gray-700 border border-gray-300 text-xs font-bold"><XCircle className="w-3.5 h-3.5" /> FALSE POSITIVE</span>;
        case 'ESCALATED':
            return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-50 text-red-700 border border-red-200 text-xs font-bold"><AlertTriangle className="w-3.5 h-3.5" /> ESCALATED</span>;
        default:
            return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold"><CheckCircle className="w-3.5 h-3.5" /> {action}</span>;
    }
};

export default function SecurityPage() {
    const { user, role, loading } = useUserProfile();
    const [logs, setLogs] = useState<SecurityThreatLog[]>([]);
    const [selectedLog, setSelectedLog] = useState<SecurityThreatLog | null>(null);
    const [actionNote, setActionNote] = useState('');
    const [isActionSubmitting, setIsActionSubmitting] = useState(false);
    const supabase = createClient();

    useEffect(() => {
        if (role === 'ANALYST' || role === 'ADMIN' || role === 'SYSTEM_ADMIN') {
            fetchLogs();
        }
    }, [role]);

    const fetchLogs = async () => {
        const { data, error } = await supabase
            .from('security_threat_logs')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(50);

        if (error) console.error("Error fetching logs:", error);
        if (data) setLogs(data as SecurityThreatLog[]);
    };

    const handleAction = async (action: string) => {
        if (!selectedLog) return;
        setIsActionSubmitting(true);
        try {
            await edgeFunctions.securityEventAction({
                log_id: selectedLog.log_id,
                admin_action_taken: action
            });
            // Refresh logs and close modal
            await fetchLogs();
            setSelectedLog(null);
        } catch (err: any) {
            alert(`Failed to perform action: ${err.message}`);
        } finally {
            setIsActionSubmitting(false);
        }
    };

    if (loading) return <div className="p-8 text-center text-gray-500">Checking authorization...</div>;

    if (!role || (role !== 'ANALYST' && role !== 'ADMIN' && role !== 'SYSTEM_ADMIN')) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
                <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
                <h1 className="text-2xl font-bold text-gray-800">Access Denied</h1>
                <p className="text-gray-600 mb-4">You do not have permission to view security logs.</p>
                <Link href="/dashboard" className="text-blue-600 hover:underline">Return to Dashboard</Link>
            </div>
        );
    }

    const canTakeAction = role === 'ADMIN' || role === 'SYSTEM_ADMIN';

    return (
        <div className="container mx-auto p-6 max-w-full">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                        <ShieldAlert className="text-red-600" />
                        Security Threat Logs
                    </h1>
                    <p className="text-sm text-gray-500">
                        Real-time monitoring of system threats and anomalies.
                        {canTakeAction ? ' (Admin Mode)' : ' (Read-Only)'}
                    </p>
                </div>
                <button onClick={fetchLogs} className="px-4 py-2 bg-white border rounded hover:bg-gray-50 text-sm">
                    Refresh Logs
                </button>
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden border">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Severity</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source / Dest</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Signature (SID)</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">AI Confidence</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {logs.map((log) => (
                            <tr key={log.log_id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full 
                                        ${log.severity_level === 'CRITICAL' ? 'bg-red-100 text-red-800' :
                                            log.severity_level === 'HIGH' ? 'bg-orange-100 text-orange-800' :
                                                log.severity_level === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' :
                                                    'bg-blue-100 text-blue-800'}`}>
                                        {log.severity_level}
                                    </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {new Date(log.timestamp).toLocaleString()}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    <div className="font-mono text-xs text-gray-700">{log.source_ip} &rarr;</div>
                                    <div className="font-mono text-xs text-gray-400">{log.destination_ip}</div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    SID: {log.suricata_sid}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    <div className="flex items-center gap-1">
                                        <div className="w-16 bg-gray-200 rounded-full h-2">
                                            <div
                                                className="bg-purple-600 h-2 rounded-full"
                                                style={{ width: `${log.xai_confidence * 100}%` }}
                                            />
                                        </div>
                                        <span className="text-xs">{(log.xai_confidence * 100).toFixed(0)}%</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                    {getActionBadge(log.admin_action_taken)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <button
                                        onClick={() => setSelectedLog(log)}
                                        className="text-blue-600 hover:text-blue-900 flex items-center gap-1 ml-auto"
                                    >
                                        <Eye className="w-4 h-4" /> View
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {logs.length === 0 && (
                    <div className="p-8 text-center text-gray-500">No security logs found.</div>
                )}
            </div>

            {/* Detail Modal */}
            {selectedLog && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b flex justify-between items-center bg-gray-50">
                            <h3 className="text-lg font-bold text-gray-900">Security Event Details #{selectedLog.log_id}</h3>
                            <button onClick={() => setSelectedLog(null)} className="text-gray-400 hover:text-gray-600">
                                <XCircle className="w-6 h-6" />
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* AI Narrative Section */}
                            <div className="bg-purple-50 p-4 rounded-lg border border-purple-100">
                                <h4 className="text-xs font-bold text-purple-800 uppercase mb-2 flex items-center gap-2">
                                    <span className="w-2 h-2 bg-purple-600 rounded-full animate-pulse"></span>
                                    AI Security Narrative
                                </h4>
                                <p className="text-sm text-gray-800 leading-relaxed">
                                    {selectedLog.xai_narrative}
                                </p>
                                <div className="mt-2 text-xs text-purple-600 font-medium text-right">
                                    Confidence: {(selectedLog.xai_confidence * 100).toFixed(1)}%
                                </div>
                            </div>

                            {/* Technical Details */}
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="block text-gray-500 text-xs uppercase">Source IP</span>
                                    <span className="font-mono font-medium text-black">{selectedLog.source_ip}</span>
                                </div>
                                <div>
                                    <span className="block text-gray-500 text-xs uppercase">Destination IP</span>
                                    <span className="font-mono font-medium text-black">{selectedLog.destination_ip}</span>
                                </div>
                                <div>
                                    <span className="block text-gray-500 text-xs uppercase">Suricata SID</span>
                                    <span className="font-mono font-medium text-black">{selectedLog.suricata_sid}</span>
                                </div>
                                <div>
                                    <span className="block text-gray-500 text-xs uppercase">Timestamp</span>
                                    <span className="font-medium text-black">{new Date(selectedLog.timestamp).toLocaleString()}</span>
                                </div>
                            </div>

                            {/* Raw Payload */}
                            <div>
                                <span className="block text-gray-500 text-xs uppercase mb-1">Raw Payload</span>
                                <pre className="bg-gray-900 text-green-400 p-3 rounded text-xs overflow-x-auto font-mono">
                                    {selectedLog.raw_payload}
                                </pre>
                            </div>

                            {/* Admin Actions */}
                            {canTakeAction && !selectedLog.admin_action_taken && (
                                <div className="border-t pt-6 mt-2">
                                    <h4 className="text-sm font-bold text-gray-800 mb-3">Admin Actions</h4>
                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => handleAction('RESOLVED')}
                                            disabled={isActionSubmitting}
                                            className="flex-1 bg-green-600 text-white py-2 rounded font-bold hover:bg-green-700 disabled:opacity-50"
                                        >
                                            Mark Resolved
                                        </button>
                                        <button
                                            onClick={() => handleAction('FALSE_POSITIVE')}
                                            disabled={isActionSubmitting}
                                            className="flex-1 bg-gray-600 text-white py-2 rounded font-bold hover:bg-gray-700 disabled:opacity-50"
                                        >
                                            Mark False Positive
                                        </button>
                                        <button
                                            onClick={() => handleAction('ESCALATED')}
                                            disabled={isActionSubmitting}
                                            className="flex-1 bg-red-600 text-white py-2 rounded font-bold hover:bg-red-700 disabled:opacity-50"
                                        >
                                            Escalate
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2 text-center">
                                        Action will be logged to system audit trail.
                                    </p>
                                </div>
                            )}

                            {selectedLog.admin_action_taken && (
                                <div className="border-t pt-6 mt-2">
                                    <h4 className="text-sm font-bold text-gray-800 mb-2">Resolution Status</h4>
                                    <div className="bg-gray-100 p-3 rounded-lg text-sm flex justify-between items-center border border-gray-200">
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-600 font-medium">Action Taken:</span>
                                            {getActionBadge(selectedLog.admin_action_taken)}
                                        </div>
                                        {/* In a real app we'd fetch the user email who reviewed it */}
                                        <span className="text-gray-500 text-xs bg-white px-2 py-1 flex items-center rounded border shadow-sm">Reviewed by: {selectedLog.reviewed_by}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
