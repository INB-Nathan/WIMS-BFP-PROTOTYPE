'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
    fetchAdminUsers,
    updateAdminUser,
    fetchAdminSecurityLogs,
    updateAdminSecurityLog,
    fetchAuditLogs,
    analyzeSecurityLog,
} from '@/lib/api';
import {
    BarChart3,
    Users,
    ShieldAlert,
    FileText,
    RefreshCw,
    ChevronDown,
    ChevronUp,
    CheckCircle,
    XCircle,
    Sparkles,
} from 'lucide-react';

interface AdminUser {
    user_id: string;
    keycloak_id_masked: string | null;
    username: string;
    role: string;
    assigned_region_id: number | null;
    is_active: boolean;
    created_at: string | null;
}

interface SecurityLog {
    log_id: number;
    timestamp: string | null;
    source_ip: string | null;
    destination_ip: string | null;
    suricata_sid: number | null;
    severity_level: string | null;
    raw_payload: string | null;
    xai_narrative: string | null;
    xai_confidence: number | null;
    admin_action_taken: string | null;
    resolved_at: string | null;
    reviewed_by: string | null;
}

interface AuditItem {
    audit_id: number;
    user_id: string | null;
    action_type: string | null;
    table_affected: string | null;
    record_id: number | null;
    ip_address: string | null;
    user_agent: string | null;
    timestamp: string | null;
}

export default function AdminSystemPage() {
    const router = useRouter();
    const { user, loading } = useAuth();
    const role = (user as { role?: string })?.role ?? null;

    const [users, setUsers] = useState<AdminUser[]>([]);
    const [securityLogs, setSecurityLogs] = useState<SecurityLog[]>([]);
    const [auditLogs, setAuditLogs] = useState<{ items: AuditItem[]; total: number }>({ items: [], total: 0 });
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [loadingAudit, setLoadingAudit] = useState(false);
    const [selectedLog, setSelectedLog] = useState<SecurityLog | null>(null);
    const [actionNote, setActionNote] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [analyzingLogId, setAnalyzingLogId] = useState<number | null>(null);

    useEffect(() => {
        if (!loading && role !== 'SYSTEM_ADMIN') {
            router.replace('/dashboard');
        }
    }, [loading, role, router]);

    useEffect(() => {
        if (role === 'SYSTEM_ADMIN') {
            loadUsers();
            loadSecurityLogs();
            loadAuditLogs();
        }
    }, [role]);

    const loadUsers = async () => {
        setLoadingUsers(true);
        try {
            const data = await fetchAdminUsers();
            setUsers(data as AdminUser[]);
        } catch {
            setUsers([]);
        } finally {
            setLoadingUsers(false);
        }
    };

    const loadSecurityLogs = async () => {
        setLoadingLogs(true);
        try {
            const data = await fetchAdminSecurityLogs();
            setSecurityLogs(data as SecurityLog[]);
        } catch {
            setSecurityLogs([]);
        } finally {
            setLoadingLogs(false);
        }
    };

    const loadAuditLogs = async () => {
        setLoadingAudit(true);
        try {
            const data = await fetchAuditLogs({ limit: 50, offset: 0 });
            setAuditLogs(data);
        } catch {
            setAuditLogs({ items: [], total: 0 });
        } finally {
            setLoadingAudit(false);
        }
    };

    const handleUpdateUser = async (
        userId: string,
        payload: { role?: string; assigned_region_id?: number; is_active?: boolean }
    ) => {
        try {
            await updateAdminUser(userId, payload);
            await loadUsers();
        } catch (e: any) {
            alert(e?.message ?? 'Update failed');
        }
    };

    const handleUpdateSecurityLog = async () => {
        if (!selectedLog || !actionNote) return;
        setIsSubmitting(true);
        try {
            await updateAdminSecurityLog(selectedLog.log_id, { admin_action_taken: actionNote });
            setSelectedLog(null);
            setActionNote('');
            await loadSecurityLogs();
        } catch (e: any) {
            alert(e?.message ?? 'Update failed');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleAnalyze = async (log: SecurityLog) => {
        if (log.xai_narrative) return;
        setAnalyzingLogId(log.log_id);
        try {
            const updated = await analyzeSecurityLog(log.log_id);
            setSecurityLogs((prev) =>
                prev.map((l) =>
                    l.log_id === log.log_id
                        ? { ...l, xai_narrative: updated.xai_narrative, xai_confidence: updated.xai_confidence }
                        : l
                )
            );
            if (selectedLog?.log_id === log.log_id) {
                setSelectedLog((s) => (s && s.log_id === log.log_id ? { ...s, ...updated } : s));
            }
        } catch (e: any) {
            alert(e?.message ?? 'Failed to analyze');
        } finally {
            setAnalyzingLogId(null);
        }
    };

    if (loading || role !== 'SYSTEM_ADMIN') {
        return (
            <div className="flex items-center justify-center min-h-[50vh] text-gray-500">
                {loading ? 'Loading...' : 'Redirecting...'}
            </div>
        );
    }

    const systemStats = [
        { label: 'Total Users', value: users.length.toString(), icon: Users },
        { label: 'Active Sessions', value: '—', icon: BarChart3 },
        { label: 'Total API Requests', value: '—', icon: BarChart3 },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>System Admin Hub</h1>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Identity governance, threat telemetry, and system audit.</p>
            </div>

            <section id="analytics" className="card overflow-hidden">
                <div className="card-header flex items-center gap-2" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <BarChart3 className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    <span>System Analytics / Flow</span>
                </div>
                <div className="card-body grid grid-cols-1 md:grid-cols-3 gap-4">
                    {systemStats.map(({ label, value, icon: Icon }) => (
                        <div key={label} className="p-4 rounded-lg flex items-center gap-4" style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}>
                            <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(60,75,100,0.1)', color: 'var(--sidebar-bg)' }}>
                                <Icon className="w-6 h-6" />
                            </div>
                            <div>
                                <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</div>
                                <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section id="governance" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <Users className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>Identity Governance</span>
                    </div>
                    <button onClick={loadUsers} disabled={loadingUsers} className="flex items-center gap-1 text-sm font-medium disabled:opacity-50" style={{ color: 'var(--bfp-maroon)' }}>
                        <RefreshCw className={`w-4 h-4 ${loadingUsers ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Username</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Region</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Active</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {users.map((u) => (
                                <UserRow key={u.user_id} user={u} onUpdate={handleUpdateUser} />
                            ))}
                        </tbody>
                    </table>
                    {users.length === 0 && !loadingUsers && <div className="p-8 text-center text-gray-500">No users found.</div>}
                </div>
            </section>

            <section id="telemetry" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>Threat Telemetry</span>
                    </div>
                    <button onClick={loadSecurityLogs} disabled={loadingLogs} className="flex items-center gap-1 text-sm font-medium disabled:opacity-50" style={{ color: 'var(--bfp-maroon)' }}>
                        <RefreshCw className={`w-4 h-4 ${loadingLogs ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Severity</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source → Dest</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SID</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">View</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {securityLogs.map((log) => (
                                <tr key={log.log_id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${log.severity_level === 'CRITICAL' ? 'bg-red-100 text-red-800' : log.severity_level === 'HIGH' ? 'bg-orange-100 text-orange-800' : log.severity_level === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}`}>
                                            {log.severity_level ?? '—'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">{log.source_ip ?? '—'} → {log.destination_ip ?? '—'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{log.suricata_sid ?? '—'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm">{log.admin_action_taken ? <span className="text-green-700 font-medium">{log.admin_action_taken}</span> : <span className="text-gray-400 italic">Unreviewed</span>}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {!log.xai_narrative && (
                                                <button
                                                    onClick={() => handleAnalyze(log)}
                                                    disabled={analyzingLogId === log.log_id}
                                                    className="text-purple-600 hover:text-purple-800 text-sm font-medium flex items-center gap-1 disabled:opacity-50"
                                                >
                                                    <Sparkles className="w-4 h-4" />
                                                    {analyzingLogId === log.log_id ? 'Analyzing…' : 'Analyze with AI'}
                                                </button>
                                            )}
                                            <button onClick={() => setSelectedLog(log)} className="text-blue-600 hover:text-blue-800 text-sm font-medium">View</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {securityLogs.length === 0 && !loadingLogs && <div className="p-8 text-center text-gray-500">No Suricata alerts.</div>}
                </div>
            </section>

            <section id="audit" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>System Audit</span>
                    </div>
                    <button onClick={loadAuditLogs} disabled={loadingAudit} className="flex items-center gap-1 text-sm font-medium disabled:opacity-50" style={{ color: 'var(--bfp-maroon)' }}>
                        <RefreshCw className={`w-4 h-4 ${loadingAudit ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Table</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Record ID</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {auditLogs.items.map((a) => (
                                <tr key={a.audit_id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{a.timestamp ? new Date(a.timestamp).toLocaleString() : '—'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">{a.user_id ?? '—'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{a.action_type ?? '—'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{a.table_affected ?? '—'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{a.record_id ?? '—'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">{a.ip_address ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {auditLogs.items.length === 0 && !loadingAudit && <div className="p-8 text-center text-gray-500">No audit entries.</div>}
                </div>
                {auditLogs.total > 0 && <div className="px-6 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">Showing {auditLogs.items.length} of {auditLogs.total}</div>}
            </section>

            {selectedLog && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto bg-[var(--background)] text-[var(--foreground)]">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800">
                            <h3 className="text-lg font-bold text-[var(--foreground)]">Suricata Alert #{selectedLog.log_id}</h3>
                            <button onClick={() => { setSelectedLog(null); setActionNote(''); }} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"><XCircle className="w-6 h-6" /></button>
                        </div>
                        <div className="p-6 space-y-4 text-[var(--foreground)]">
                            <div className="bg-purple-50 dark:bg-purple-950/40 p-4 rounded-lg border border-purple-100 dark:border-purple-800">
                                <h4 className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase mb-2">AI Narrative</h4>
                                {selectedLog.xai_narrative ? (
                                    <>
                                        <p className="text-sm text-[var(--foreground)]">{selectedLog.xai_narrative}</p>
                                        {selectedLog.xai_confidence != null && (
                                            <div className="mt-2 text-xs text-purple-600 dark:text-purple-300 font-medium text-right">
                                                Confidence: {((selectedLog.xai_confidence ?? 0) * 100).toFixed(1)}%
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleAnalyze(selectedLog)}
                                            disabled={analyzingLogId === selectedLog.log_id}
                                            className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                                        >
                                            <Sparkles className="w-4 h-4" />
                                            {analyzingLogId === selectedLog.log_id ? 'Analyzing…' : 'Analyze with AI'}
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div><span className="text-gray-600 dark:text-gray-400">Source</span><div className="font-mono text-[var(--foreground)]">{selectedLog.source_ip ?? '—'}</div></div>
                                <div><span className="text-gray-600 dark:text-gray-400">Destination</span><div className="font-mono text-[var(--foreground)]">{selectedLog.destination_ip ?? '—'}</div></div>
                                <div><span className="text-gray-600 dark:text-gray-400">SID</span><div className="text-[var(--foreground)]">{selectedLog.suricata_sid ?? '—'}</div></div>
                                <div><span className="text-gray-600 dark:text-gray-400">Severity</span><div className="text-[var(--foreground)]">{selectedLog.severity_level ?? '—'}</div></div>
                            </div>
                            {selectedLog.raw_payload && (
                                <div>
                                    <span className="text-gray-600 dark:text-gray-400 text-xs uppercase">Raw Payload</span>
                                    <pre className="mt-1 bg-gray-100 dark:bg-gray-950 text-gray-800 dark:text-gray-200 p-2 rounded text-xs overflow-x-auto font-mono max-h-40 overflow-y-auto">{selectedLog.raw_payload}</pre>
                                </div>
                            )}
                            {!selectedLog.admin_action_taken && (
                                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Admin action note</label>
                                    <textarea value={actionNote} onChange={(e) => setActionNote(e.target.value)} placeholder="e.g. RESOLVED, FALSE_POSITIVE, ESCALATED" className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm text-[var(--foreground)] bg-[var(--background)]" rows={2} />
                                    <div className="mt-2 flex gap-2">
                                        <button onClick={handleUpdateSecurityLog} disabled={!actionNote.trim() || isSubmitting} className="px-4 py-2 bg-red-600 text-white rounded font-medium hover:bg-red-700 disabled:opacity-50">{isSubmitting ? 'Saving...' : 'Save'}</button>
                                        <button onClick={() => { setSelectedLog(null); setActionNote(''); }} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 rounded font-medium hover:bg-gray-300 dark:hover:bg-gray-500">Cancel</button>
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

function UserRow({ user, onUpdate }: { user: AdminUser; onUpdate: (id: string, p: { role?: string; assigned_region_id?: number; is_active?: boolean }) => void }) {
    const [expanded, setExpanded] = useState(false);
    const [editRole, setEditRole] = useState(user.role);
    const [editRegion, setEditRegion] = useState(user.assigned_region_id?.toString() ?? '');
    const [editActive, setEditActive] = useState(user.is_active);
    const hasChanges = editRole !== user.role || editRegion !== (user.assigned_region_id?.toString() ?? '') || editActive !== user.is_active;
    const handleSave = () => {
        if (!hasChanges) return;
        onUpdate(user.user_id, { role: editRole, assigned_region_id: editRegion ? parseInt(editRegion, 10) : undefined, is_active: editActive });
        setExpanded(false);
    };
    const ROLES = ['ENCODER', 'VALIDATOR', 'ANALYST', 'ADMIN', 'SYSTEM_ADMIN'];
    return (
        <>
            <tr className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{user.username}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{user.role}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{user.assigned_region_id ?? '—'}</td>
                <td className="px-6 py-4 whitespace-nowrap">{user.is_active ? <CheckCircle className="w-5 h-5 text-green-600" /> : <XCircle className="w-5 h-5 text-red-500" />}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                    <button onClick={() => setExpanded(!expanded)} className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1 ml-auto">
                        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />} Edit
                    </button>
                </td>
            </tr>
            {expanded && (
                <tr className="bg-gray-50">
                    <td colSpan={6} className="px-6 py-4">
                        <div className="flex flex-wrap gap-4 items-end">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                                <select value={editRole} onChange={(e) => setEditRole(e.target.value)} className="border border-gray-300 rounded px-3 py-1.5 text-sm">
                                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Region ID</label>
                                <input type="number" value={editRegion} onChange={(e) => setEditRegion(e.target.value)} placeholder="—" className="border border-gray-300 rounded px-3 py-1.5 text-sm w-24" />
                            </div>
                            <div className="flex items-center gap-2">
                                <input type="checkbox" id={`active-${user.user_id}`} checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                                <label htmlFor={`active-${user.user_id}`} className="text-sm text-gray-700">Active</label>
                            </div>
                            <button onClick={handleSave} disabled={!hasChanges} className="px-4 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-50">Save</button>
                            <button onClick={() => { setEditRole(user.role); setEditRegion(user.assigned_region_id?.toString() ?? ''); setEditActive(user.is_active); setExpanded(false); }} className="px-4 py-2 bg-gray-200 text-gray-800 rounded text-sm font-medium hover:bg-gray-300">Cancel</button>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
