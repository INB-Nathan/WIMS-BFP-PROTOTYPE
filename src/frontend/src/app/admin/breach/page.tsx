'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { fetchBreaches, updateBreach, Breach, BreachStatus } from '@/lib/api/breach';
import Link from 'next/link';
import { ShieldX, Clock, CheckCircle, AlertTriangle } from 'lucide-react';

const STATUS_LABELS: Record<BreachStatus, string> = {
    DETECTED: 'Detected',
    DPO_NOTIFIED: 'DPO Notified',
    NPC_SUBMITTED: 'NPC Submitted',
    CLOSED: 'Closed',
};

const STATUS_BADGE_STYLE: Record<BreachStatus, string> = {
    DETECTED: 'bg-red-100 text-red-800',
    DPO_NOTIFIED: 'bg-orange-100 text-orange-800',
    NPC_SUBMITTED: 'bg-yellow-100 text-yellow-800',
    CLOSED: 'bg-green-100 text-green-800',
};

const NEXT_STATUS: Partial<Record<BreachStatus, BreachStatus>> = {
    DETECTED: 'DPO_NOTIFIED',
    DPO_NOTIFIED: 'NPC_SUBMITTED',
    NPC_SUBMITTED: 'CLOSED',
};

function formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function DeadlineCell({ npcDeadlineAt }: { npcDeadlineAt: string }) {
    const deadline = new Date(npcDeadlineAt);
    const now = new Date();
    const overdue = now > deadline;
    const diffMs = deadline.getTime() - now.getTime();
    const diffHours = Math.floor(Math.abs(diffMs) / 3_600_000);
    const diffMins = Math.floor((Math.abs(diffMs) % 3_600_000) / 60_000);

    return (
        <div>
            <div className={`font-medium text-sm ${overdue ? 'text-red-600' : 'text-gray-900'}`}>
                {formatDate(npcDeadlineAt)}
            </div>
            <div className={`text-xs mt-0.5 ${overdue ? 'text-red-500 font-semibold' : 'text-gray-500'}`}>
                {overdue
                    ? `${diffHours}h ${diffMins}m overdue`
                    : `${diffHours}h ${diffMins}m remaining`}
            </div>
        </div>
    );
}

export default function BreachNotificationsPage() {
    const { user, loading: authLoading } = useAuth();
    const role = (user as { role?: string })?.role ?? null;
    const isAdmin = role === 'SYSTEM_ADMIN';

    const [breaches, setBreaches] = useState<Breach[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updating, setUpdating] = useState<number | null>(null);

    const loadBreaches = useCallback(async () => {
        if (!isAdmin) return;
        setLoading(true);
        setError(null);
        try {
            const data = await fetchBreaches();
            setBreaches(data);
        } catch (err) {
            setError('Failed to load breach records.');
            console.error('fetchBreaches error', err);
        } finally {
            setLoading(false);
        }
    }, [isAdmin]);

    useEffect(() => {
        loadBreaches();
    }, [loadBreaches]);

    const handleStatusAdvance = async (breach: Breach) => {
        const next = NEXT_STATUS[breach.status];
        if (!next) return;
        setUpdating(breach.breach_id);
        try {
            const updated = await updateBreach(breach.breach_id, { status: next });
            setBreaches((prev) =>
                prev.map((b) => (b.breach_id === updated.breach_id ? updated : b))
            );
        } catch (err) {
            console.error('updateBreach error', err);
        } finally {
            setUpdating(null);
        }
    };

    if (authLoading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh] text-gray-500">
                Loading…
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
                Access restricted to System Administrators.
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="card">
                <div className="card-body flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <ShieldX className="w-6 h-6 text-red-600" />
                        <div>
                            <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                                Breach Notifications
                            </h1>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                RA 10173 — NPC 72-hour tracking
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={loadBreaches}
                        className="text-sm px-4 py-2 rounded-lg font-medium transition-colors"
                        style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="card overflow-hidden">
                {loading ? (
                    <div className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>
                        Loading breach records…
                    </div>
                ) : error ? (
                    <div className="p-10 text-center text-red-600">{error}</div>
                ) : breaches.length === 0 ? (
                    <div className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>
                        <CheckCircle className="w-10 h-10 mx-auto mb-3 text-green-500" />
                        No breach records found.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr style={{ backgroundColor: 'var(--table-header-bg)', borderBottom: '1px solid var(--border-color)' }}>
                                    <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Breach #</th>
                                    <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Threat Log</th>
                                    <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Detected</th>
                                    <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>NPC Deadline</th>
                                    <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                                    {isAdmin && (
                                        <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Action</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {breaches.map((breach) => {
                                    const overdue = new Date() > new Date(breach.npc_deadline_at) && breach.status !== 'CLOSED';
                                    const nextStatus = NEXT_STATUS[breach.status];
                                    return (
                                        <tr
                                            key={breach.breach_id}
                                            style={{
                                                borderBottom: '1px solid var(--border-color)',
                                                backgroundColor: overdue ? '#fff5f5' : undefined,
                                            }}
                                        >
                                            <td className="px-4 py-3 font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                {overdue && <AlertTriangle className="w-3.5 h-3.5 text-red-500 inline mr-1" />}
                                                #{breach.breach_id}
                                            </td>
                                            <td className="px-4 py-3">
                                                <Link
                                                    href={`/admin/system#telemetry`}
                                                    className="text-blue-600 hover:underline font-mono text-xs"
                                                >
                                                    Log #{breach.threat_log_id}
                                                </Link>
                                            </td>
                                            <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>
                                                {formatDate(breach.detected_at)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <DeadlineCell npcDeadlineAt={breach.npc_deadline_at} />
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_BADGE_STYLE[breach.status]}`}>
                                                    {breach.status === 'DETECTED' && <Clock className="w-3 h-3" />}
                                                    {breach.status === 'CLOSED' && <CheckCircle className="w-3 h-3" />}
                                                    {STATUS_LABELS[breach.status]}
                                                </span>
                                            </td>
                                            {isAdmin && (
                                                <td className="px-4 py-3">
                                                    {nextStatus && (
                                                        <button
                                                            onClick={() => handleStatusAdvance(breach)}
                                                            disabled={updating === breach.breach_id}
                                                            className="text-xs px-3 py-1.5 rounded-md font-medium transition-colors disabled:opacity-50"
                                                            style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
                                                            data-testid={`advance-breach-${breach.breach_id}`}
                                                        >
                                                            {updating === breach.breach_id
                                                                ? 'Updating…'
                                                                : `→ ${STATUS_LABELS[nextStatus]}`}
                                                        </button>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
