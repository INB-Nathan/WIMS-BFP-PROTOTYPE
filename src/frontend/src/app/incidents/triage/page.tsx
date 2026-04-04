'use client';

import { useState, useEffect } from 'react';
import { useUserProfile } from '@/lib/auth';
import { fetchPendingReports, promoteReport } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { Loader2, MapPin, Clock, FileText, CheckCircle, ClipboardList } from 'lucide-react';

interface PendingReport {
    report_id: number;
    latitude: number;
    longitude: number;
    description: string;
    created_at: string | null;
    status: string;
}

export default function TriagePage() {
    const { role, loading: authLoading } = useUserProfile();
    const router = useRouter();
    const [reports, setReports] = useState<PendingReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [promotingId, setPromotingId] = useState<number | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const canAccess = role === 'ENCODER' || role === 'VALIDATOR';

    useEffect(() => {
        if (!authLoading && !canAccess) router.push('/dashboard');
    }, [role, authLoading, canAccess, router]);

    useEffect(() => {
        if (canAccess && !authLoading) loadReports();
    }, [canAccess, authLoading]);

    const loadReports = async () => {
        setLoading(true);
        try {
            const data = await fetchPendingReports();
            setReports(data);
        } catch (err) {
            console.error('Failed to load pending reports:', err);
            setReports([]);
        } finally {
            setLoading(false);
        }
    };

    const handlePromote = async (reportId: number) => {
        setPromotingId(reportId);
        setSuccessMessage(null);
        try {
            await promoteReport(reportId);
            setReports((prev) => prev.filter((r) => r.report_id !== reportId));
            setSuccessMessage('Report promoted to official incident successfully.');
            setTimeout(() => setSuccessMessage(null), 4000);
        } catch (err) {
            console.error('Promote failed:', err);
        } finally {
            setPromotingId(null);
        }
    };

    if (authLoading) return (
        <div className="p-8 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
    );
    if (!canAccess) return null;

    return (
        <div className="space-y-6">
            {successMessage && (
                <div className="card overflow-hidden">
                    <div className="flex items-center gap-2 p-4" style={{ borderLeft: '4px solid #16a34a' }}>
                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                        <span className="text-sm text-green-800">{successMessage}</span>
                    </div>
                </div>
            )}

            <div className="card overflow-hidden">
                <div className="card-header flex items-center gap-2" style={{ borderLeft: '4px solid #f59e0b' }}>
                    <ClipboardList className="w-4 h-4 text-amber-600" />
                    <span>Triage Queue</span>
                </div>

                {loading ? (
                    <div className="p-12 flex justify-center">
                        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--text-muted)' }} />
                    </div>
                ) : reports.length === 0 ? (
                    <div className="p-12 text-center">
                        <FileText className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--border-color)' }} />
                        <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>No pending reports</p>
                        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>All citizen reports have been triaged.</p>
                    </div>
                ) : (
                    <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                        {reports.map((r) => (
                            <div key={r.report_id}
                                className="p-4 hover:bg-gray-50 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start gap-2">
                                        <FileText className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                                        <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{r.description || 'No description'}</p>
                                    </div>
                                    <div className="flex flex-wrap gap-4 mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                                        <span className="flex items-center gap-1">
                                            <Clock className="w-3.5 h-3.5" />
                                            {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <MapPin className="w-3.5 h-3.5" />
                                            {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}
                                        </span>
                                    </div>
                                </div>
                                <button onClick={() => handlePromote(r.report_id)} disabled={promotingId === r.report_id}
                                    className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                                    style={{ backgroundColor: 'var(--bfp-maroon)' }}>
                                    {promotingId === r.report_id ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" /> Promoting…</>
                                    ) : (
                                        <><CheckCircle className="w-4 h-4" /> Promote</>
                                    )}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
