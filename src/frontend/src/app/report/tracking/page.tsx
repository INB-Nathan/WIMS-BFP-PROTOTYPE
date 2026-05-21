'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchReportStatus, registerNotification } from '@/lib/api';
import { getMessagingToken } from '@/lib/firebase';
import Image from 'next/image';
import { AlertTriangle, Search, CheckCircle, Clock } from 'lucide-react';
import Link from 'next/link';

type NotifyStatus = 'idle' | 'enabling' | 'enabled' | 'denied' | 'error';

const notifyKey = (id: string | number) => `bfp_notify_registered_${id}`;

export default function ReportTrackerPage() {
    const [reportId, setReportId] = useState('');
    const [statusData, setStatusData] = useState<{ report_id: number; status: string; description: string; created_at: string } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notifyStatus, setNotifyStatus] = useState<NotifyStatus>('idle');

    const searchReport = useCallback(async (id: string) => {
        setError(null);
        setNotifyStatus('idle');
        if (!id.trim()) {
            setError('Please enter a Report ID.');
            return;
        }

        setLoading(true);
        setStatusData(null);
        try {
            const data = await fetchReportStatus(id.trim());
            setStatusData(data);
            if (localStorage.getItem(notifyKey(data.report_id)) === 'true') {
                setNotifyStatus('enabled');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to fetch report status.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const id = new URLSearchParams(window.location.search).get('id');
        if (!id?.trim()) return;

        setReportId(id.trim());
        void searchReport(id);
    }, [searchReport]);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        await searchReport(reportId);
    };

    const handleEnableNotifications = async () => {
        if (!statusData) return;
        setNotifyStatus('enabling');
        try {
            const token = await getMessagingToken();
            if (!token) { setNotifyStatus('denied'); return; }
            await registerNotification(statusData.report_id, token);
            localStorage.setItem(notifyKey(statusData.report_id), 'true');
            setNotifyStatus('enabled');
        } catch {
            setNotifyStatus('error');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ backgroundColor: 'var(--content-bg)' }}>
            <div className="card max-w-lg w-full overflow-hidden shadow-2xl">
                {/* Header */}
                <div className="p-6 text-center" style={{ background: 'var(--bfp-gradient)' }}>
                    <div className="relative w-16 h-16 mx-auto mb-3">
                        <Image src="/bfp-logo.svg" alt="BFP Logo" fill className="object-contain" />
                    </div>
                    <h1 className="text-xl font-bold text-white">Track Emergency Report</h1>
                    <p className="text-sm text-white/70 mt-1">Check the status of your submitted report</p>
                </div>

                {/* Form */}
                <div className="card-body p-6 space-y-6">
                    <form onSubmit={handleSearch} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Report Tracking ID</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={reportId}
                                    onChange={(e) => setReportId(e.target.value)}
                                    className="flex-1 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                                    style={{ border: '1px solid var(--border-color)', backgroundColor: 'var(--background)', color: 'var(--text-primary)' }}
                                    placeholder="Enter Report ID (e.g., 1024)"
                                    required
                                />
                                <button type="submit" disabled={loading || !reportId.trim()}
                                    className="px-5 py-3 rounded-lg text-white font-bold text-sm disabled:opacity-50 transition-colors flex items-center gap-2"
                                    style={{ background: 'var(--bfp-gradient)' }}>
                                    {loading ? 'Searching...' : <><Search className="w-4 h-4" /> Track</>}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                                <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
                            </div>
                        )}
                    </form>

                    {statusData && (
                        <div className="border rounded-lg p-5 mt-6" style={{ backgroundColor: 'white', borderColor: 'var(--border-color)' }}>
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-1">Status</h3>
                                    <div className="flex items-center gap-2">
                                        {statusData.status === 'VERIFIED' ? <CheckCircle className="w-5 h-5 text-green-500" /> : <Clock className="w-5 h-5 text-orange-500" />}
                                        <span className={`text-lg font-bold ${statusData.status === 'VERIFIED' ? 'text-green-600' : 'text-orange-600'}`}>
                                            {statusData.status}
                                        </span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Date Submitted</h3>
                                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                        {new Date(statusData.created_at).toLocaleString()}
                                    </p>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Description</h3>
                                <p className="text-sm p-3 bg-gray-800 border rounded-md" style={{ color: 'white', borderColor: 'var(--border-color)' }}>
                                    {statusData.description}
                                </p>
                            </div>

                            {statusData.status === 'VERIFIED' && (
                                <div className="mt-4 p-3 bg-green-50 text-green-800 text-sm rounded-lg flex gap-2 border border-green-200">
                                    <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                    <p>Your report has been verified by the Regional Operations center and responders have been dispatched.</p>
                                </div>
                            )}

                            {statusData.status === 'PENDING' && notifyStatus !== 'enabled' && (
                                <div className="mt-4 p-3 border rounded-lg flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
                                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Get notified when this report is verified</p>
                                    <button
                                        onClick={handleEnableNotifications}
                                        disabled={notifyStatus === 'enabling'}
                                        className="ml-4 px-4 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-50"
                                        style={{ background: 'var(--bfp-gradient)' }}>
                                        {notifyStatus === 'enabling' ? 'Enabling…' : 'Enable'}
                                    </button>
                                </div>
                            )}
                            {notifyStatus === 'enabled' && statusData.status === 'PENDING' && (
                                <div className="mt-4 p-3 bg-green-50 text-green-700 text-sm rounded-lg border border-green-200">
                                    Notifications enabled. You&apos;ll be alerted when this report is verified.
                                </div>
                            )}
                            {notifyStatus === 'denied' && (
                                <p className="mt-2 text-xs text-orange-500">Notification permission denied. Enable it in your browser settings.</p>
                            )}
                            {notifyStatus === 'error' && (
                                <p className="mt-2 text-xs text-red-500">Failed to enable notifications. Please try again.</p>
                            )}
                        </div>
                    )}

                    <div className="pt-4 border-t text-center" style={{ borderColor: 'var(--border-color)' }}>
                        <Link href="/report" className="text-sm font-medium text-red-600 hover:text-red-800 transition-colors">
                            &larr; Submit a New Emergency Report
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
