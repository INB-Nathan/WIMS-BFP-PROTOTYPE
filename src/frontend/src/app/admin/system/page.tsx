'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
    fetchAdminUsers,
    updateAdminUser,
    createAdminUser,
    fetchAdminSecurityLogs,
    updateAdminSecurityLog,
    fetchAuditLogs,
    analyzeSecurityLog,
    fetchRegions,
    fetchUserSessions,
    terminateUserSessions,
    KeycloakSession,
    fetchActiveSessions,
    revokeUserSessions,
    fetchSystemHealth,
} from '@/lib/api';
import { Region } from '@/types/api';
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
    UserPlus,
    Copy,
    Eye,
    EyeOff,
    LogOut,
    Monitor,
    Activity,
    Server,
    Database,
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

interface ActiveSession {
    session_id: string;
    user_id: string;
    username: string;
    role: string;
    ip_address: string;
    start: number;
    last_access: number;
}

export default function AdminSystemPage() {
    const router = useRouter();
    const { user, loading } = useAuth();
    const role = (user as { role?: string })?.role ?? null;

    const [users, setUsers] = useState<AdminUser[]>([]);
    const [securityLogs, setSecurityLogs] = useState<SecurityLog[]>([]);
    const [auditLogs, setAuditLogs] = useState<{ items: AuditItem[]; total: number }>({ items: [], total: 0 });
    const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
    const [health, setHealth] = useState<{ status: string; components: Record<string, { status: string; latency_ms: number }> } | null>(null);
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [loadingAudit, setLoadingAudit] = useState(false);
    const [loadingSessions, setLoadingSessions] = useState(false);
    const [regions, setRegions] = useState<Region[]>([]);
    const [selectedLog, setSelectedLog] = useState<SecurityLog | null>(null);
    const [actionNote, setActionNote] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [analyzingLogId, setAnalyzingLogId] = useState<number | null>(null);
    const [isRevoking, setIsRevoking] = useState<string | null>(null);

    // Sessions state
    const [sessionsByUser, setSessionsByUser] = useState<Record<string, KeycloakSession[]>>({});
    const [selectedSessionUser, setSelectedSessionUser] = useState<AdminUser | null>(null);
    const [terminatingUser, setTerminatingUser] = useState<string | null>(null);

    // Create User modal state
    const [showCreateUser, setShowCreateUser] = useState(false);
    const [createForm, setCreateForm] = useState({
        first_name: '',
        last_name: '',
        email: '',
        username: '',
        role: 'REGIONAL_ENCODER',
        assigned_region_id: '',
        contact_number: '',
    });
    const [isCreating, setIsCreating] = useState(false);
    const [createdUser, setCreatedUser] = useState<{ username: string; temporary_password: string } | null>(null);
    const [showTempPassword, setShowTempPassword] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);

    useEffect(() => {
        if (!loading && role !== 'SYSTEM_ADMIN') {
            router.replace('/dashboard');
        }
    }, [loading, role, router]);

    useEffect(() => {
        if (role === 'SYSTEM_ADMIN') {
            loadUsers().then(async () => {
                const data = await fetchAdminUsers().catch(() => []);
                await loadAllUserSessions(data as AdminUser[]);
            });
            loadSecurityLogs();
            loadAuditLogs();
            loadRegions();
            loadSessions();
            loadHealth();
        }
    }, [role]);

    const loadHealth = async () => {
        try {
            const data = await fetchSystemHealth();
            setHealth(data);
        } catch {
            setHealth({ status: 'ERROR', components: {} });
        }
    };

    const loadSessions = async () => {
        setLoadingSessions(true);
        try {
            const data = await fetchActiveSessions();
            setActiveSessions(data as ActiveSession[]);
        } catch {
            setActiveSessions([]);
        } finally {
            setLoadingSessions(false);
        }
    };

    const loadRegions = async () => {
        try {
            const data = await fetchRegions();
            setRegions(data);
        } catch {
            setRegions([]);
        }
    };

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

    const loadAllUserSessions = async (userList: AdminUser[]) => {
        setLoadingSessions(true);
        const results: Record<string, KeycloakSession[]> = {};
        await Promise.allSettled(
            userList.map(async (u) => {
                try {
                    const res = await fetchUserSessions(u.user_id);
                    results[u.user_id] = res.sessions ?? [];
                } catch {
                    results[u.user_id] = [];
                }
            })
        );
        setSessionsByUser(results);
        setLoadingSessions(false);
    };

    const handleTerminateSessions = async (u: AdminUser) => {
        setTerminatingUser(u.user_id);
        try {
            await terminateUserSessions(u.user_id, 'all');
            setSessionsByUser((prev) => ({ ...prev, [u.user_id]: [] }));
            setSelectedSessionUser(null);
        } catch (e: unknown) {
            alert((e as { message?: string })?.message ?? 'Failed to terminate sessions');
        } finally {
            setTerminatingUser(null);
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
            setAuditLogs({
                items: data.items.map((item: Record<string, unknown>): AuditItem => ({
                    audit_id: item.audit_id,
                    user_id: item.user_id,
                    action_type: item.action_type,
                    table_affected: item.table_affected,
                    record_id: item.record_id,
                    ip_address: item.ip_address,
                    user_agent: item.user_agent,
                    timestamp: item.timestamp,
                })),
                total: data.total,
            });
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
            if (payload.is_active === false) {
                await loadSessions();
            }
        } catch (e: unknown) {
            alert((e as { message?: string })?.message ?? 'Update failed');
        }
    };

    const handleCreateUser = async () => {
        const payload = {
            ...createForm,
            assigned_region_id: createForm.role === 'REGIONAL_ENCODER' ? Number(createForm.assigned_region_id) : undefined,
            first_name: createForm.first_name.trim(),
            last_name: createForm.last_name.trim(),
        };
        if (!payload.first_name || !payload.last_name || !payload.email || !payload.role || !payload.username?.trim()) {
            alert('First name, last name, email, username, and role are required.');
            return;
        }
        setIsCreating(true);
        try {
            const result = await createAdminUser({
                email: payload.email,
                first_name: payload.first_name,
                last_name: payload.last_name,
                role: payload.role,
                username: payload.username.trim(),
                contact_number: payload.contact_number || undefined,
                assigned_region_id: payload.assigned_region_id,
            });
            setCreatedUser({ username: result.username, temporary_password: result.temporary_password });
            setCreateForm({ first_name: '', last_name: '', email: '', username: '', role: 'REGIONAL_ENCODER', contact_number: '', assigned_region_id: '' });
            await loadUsers();
        } catch (e: unknown) {
            alert((e as { message?: string })?.message ?? 'Failed to create user');
        } finally {
            setIsCreating(false);
        }
    };

    const handleCopyPassword = () => {
        if (!createdUser) return;
        navigator.clipboard.writeText(createdUser.temporary_password);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
    };

    const handleUpdateSecurityLog = async () => {
        if (!selectedLog || !actionNote) return;
        setIsSubmitting(true);
        try {
            await updateAdminSecurityLog(selectedLog.log_id, { admin_action_taken: actionNote });
            setSelectedLog(null);
            setActionNote('');
            await loadSecurityLogs();
        } catch (e: unknown) {
            alert((e as { message?: string })?.message ?? 'Update failed');
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
        } catch (e: unknown) {
            alert((e as { message?: string })?.message ?? 'Failed to analyze');
        } finally {
            setAnalyzingLogId(null);
        }
    };

    const handleRevokeSession = async (userId: string) => {
        setIsRevoking(userId);
        try {
            await revokeUserSessions(userId);
            await loadSessions();
        } catch (e: unknown) {
            alert((e as { message?: string })?.message ?? 'Failed to revoke session');
        } finally {
            setIsRevoking(null);
        }
    };

    if (loading || role !== 'SYSTEM_ADMIN') {
        return (
            <div className="flex items-center justify-center min-h-[50vh] text-gray-500">
                {loading ? 'Loading...' : 'Redirecting...'}
            </div>
        );
    }

    const totalActiveSessions = loadingSessions
        ? '…'
        : Object.values(sessionsByUser).reduce((sum, s) => sum + s.length, 0).toString();

    const systemStats = [
        { label: 'Total Users', value: users.length.toString(), icon: Users },
        { label: 'Active Sessions', value: totalActiveSessions, icon: Monitor },
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

            {health && (
                <section id="health" className="card overflow-hidden">
                    <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                        <div className="flex items-center gap-2">
                            <Activity className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                            <span>System Health</span>
                            <span className={`ml-2 px-2 py-0.5 rounded text-xs font-bold text-white ${health.status === 'HEALTHY' ? 'bg-green-600' : 'bg-red-600'}`}>
                                {health.status}
                            </span>
                        </div>
                        <button onClick={loadHealth} className="flex items-center gap-1 text-sm font-medium hover:opacity-80 transition-opacity" style={{ color: 'var(--bfp-maroon)' }}>
                            <RefreshCw className="w-4 h-4" /> Refresh
                        </button>
                    </div>
                    <div className="card-body grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 rounded-lg flex items-center justify-between" style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}>
                            <div className="flex items-center gap-3">
                                <Database className="w-5 h-5 text-gray-500" />
                                <div>
                                    <div className="text-sm font-semibold">PostgreSQL</div>
                                    <div className="text-xs text-gray-500">{health.components.database?.latency_ms ?? 0}ms</div>
                                </div>
                            </div>
                            <span className={`w-3 h-3 rounded-full ${health.components.database?.status === 'HEALTHY' ? 'bg-green-500' : 'bg-red-500'}`} />
                        </div>
                        <div className="p-4 rounded-lg flex items-center justify-between" style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}>
                            <div className="flex items-center gap-3">
                                <Server className="w-5 h-5 text-gray-500" />
                                <div>
                                    <div className="text-sm font-semibold">Redis</div>
                                    <div className="text-xs text-gray-500">{health.components.redis?.latency_ms ?? 0}ms</div>
                                </div>
                            </div>
                            <span className={`w-3 h-3 rounded-full ${health.components.redis?.status === 'HEALTHY' ? 'bg-green-500' : 'bg-red-500'}`} />
                        </div>
                        <div className="p-4 rounded-lg flex items-center justify-between" style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}>
                            <div className="flex items-center gap-3">
                                <Server className="w-5 h-5 text-gray-500" />
                                <div>
                                    <div className="text-sm font-semibold">Keycloak</div>
                                    <div className="text-xs text-gray-500">{health.components.keycloak?.latency_ms ?? 0}ms</div>
                                </div>
                            </div>
                            <span className={`w-3 h-3 rounded-full ${health.components.keycloak?.status === 'HEALTHY' ? 'bg-green-500' : 'bg-red-500'}`} />
                        </div>
                    </div>
                </section>
            )}

            <section id="governance" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <Users className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>Identity Governance</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => { setShowCreateUser(true); setCreatedUser(null); }}
                            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md text-white"
                            style={{ backgroundColor: 'var(--bfp-maroon)' }}
                        >
                            <UserPlus className="w-4 h-4" /> Create User
                        </button>
                        <button onClick={loadUsers} disabled={loadingUsers} className="flex items-center gap-1 text-sm font-medium disabled:opacity-50" style={{ color: 'var(--bfp-maroon)' }}>
                            <RefreshCw className={`w-4 h-4 ${loadingUsers ? 'animate-spin' : ''}`} /> Refresh
                        </button>
                    </div>
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
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sessions</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {users.map((u) => (
                                <UserRow
                                    key={u.user_id}
                                    user={u}
                                    onUpdate={handleUpdateUser}
                                    sessionCount={sessionsByUser[u.user_id]?.length ?? 0}
                                    onViewSessions={() => setSelectedSessionUser(u)}
                                />
                            ))}
                        </tbody>
                    </table>
                    {users.length === 0 && !loadingUsers && <div className="p-8 text-center text-gray-500">No users found.</div>}
                </div>
            </section>

            <section id="sessions" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <BarChart3 className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>Active Sessions</span>
                    </div>
                    <button onClick={loadSessions} disabled={loadingSessions} className="flex items-center gap-1 text-sm font-medium disabled:opacity-50" style={{ color: 'var(--bfp-maroon)' }}>
                        <RefreshCw className={`w-4 h-4 ${loadingSessions ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Username</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Access</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {activeSessions.map((s) => (
                                <tr key={s.session_id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{s.username}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{s.role}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">{s.ip_address}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(s.last_access).toLocaleString()}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right">
                                        <button 
                                            onClick={() => handleRevokeSession(s.user_id)} 
                                            disabled={isRevoking === s.user_id}
                                            className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50"
                                        >
                                            {isRevoking === s.user_id ? 'Revoking...' : 'Force Logout'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {activeSessions.length === 0 && !loadingSessions && <div className="p-8 text-center text-gray-500">No active sessions found.</div>}
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
                            <h3 className="text-lg font-bold text-[var(--foreground)] text-white">Suricata Alert #{selectedLog.log_id}</h3>
                            <button onClick={() => { setSelectedLog(null); setActionNote(''); }} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"><XCircle className="w-6 h-6" /></button>
                        </div>
                        <div className="p-6 space-y-4 text-[var(--foreground)]">
                            <div className="bg-purple-50 dark:bg-purple-950/40 p-4 rounded-lg border border-purple-100 dark:border-purple-800">
                                <h4 className="text-xs font-bold text-white dark:text-white uppercase mb-2">AI Narrative</h4>
                                {selectedLog.xai_narrative ? (
                                    <>
                                        <p className="text-sm text-[var(--foreground)]">{selectedLog.xai_narrative}</p>
                                        {selectedLog.xai_confidence != null && (
                                            <div className="mt-2 text-xs text-purple-800 dark:text-purple600 font-medium text-right">
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

            {/* Sessions Modal */}
            {selectedSessionUser && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="rounded-lg shadow-xl max-w-lg w-full bg-[var(--background)] text-[var(--foreground)] overflow-hidden">
                        <div className="p-5 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                            <div className="flex items-center gap-2">
                                <Monitor className="w-4 h-4 text-gray-500" />
                                <h3 className="text-base font-bold">Active Sessions — {selectedSessionUser.username}</h3>
                            </div>
                            <button onClick={() => setSelectedSessionUser(null)} className="text-gray-500 hover:text-gray-700">
                                <XCircle className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-5 space-y-3">
                            {(sessionsByUser[selectedSessionUser.user_id] ?? []).length === 0 ? (
                                <p className="text-sm text-gray-500 text-center py-4">No active sessions.</p>
                            ) : (
                                <ul className="divide-y divide-gray-100">
                                    {(sessionsByUser[selectedSessionUser.user_id] ?? []).map((s) => (
                                        <li key={s.id} className="py-2.5 text-sm">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <div className="font-mono text-gray-700">{s.ipAddress ?? '—'}</div>
                                                    <div className="text-xs text-gray-400 mt-0.5">
                                                        Started: {s.start ? new Date(s.start).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—'} &middot; Last access: {s.lastAccess ? new Date(s.lastAccess).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—'}
                                                    </div>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <div className="pt-2 border-t border-gray-100 flex justify-between items-center">
                                <span className="text-xs text-gray-400">Terminating ends all active sessions for this user.</span>
                                <button
                                    onClick={() => handleTerminateSessions(selectedSessionUser)}
                                    disabled={terminatingUser === selectedSessionUser.user_id || (sessionsByUser[selectedSessionUser.user_id] ?? []).length === 0}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 disabled:opacity-50"
                                >
                                    <LogOut className="w-4 h-4" />
                                    {terminatingUser === selectedSessionUser.user_id ? 'Terminating…' : 'Terminate All'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Create User Modal */}
            {showCreateUser && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="rounded-xl shadow-2xl w-full max-w-lg bg-white overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center" style={{ backgroundColor: 'var(--sidebar-bg)' }}>
                            <div className="flex items-center gap-2">
                                <UserPlus className="w-5 h-5 text-white" />
                                <h3 className="text-base font-bold text-white">Onboard New User</h3>
                            </div>
                            <button onClick={() => { setShowCreateUser(false); setCreatedUser(null); }} className="text-white/70 hover:text-white">
                                <XCircle className="w-5 h-5" />
                            </button>
                        </div>

                        {createdUser ? (
                            /* Success state — show the temporary password */
                            <div className="p-6 space-y-4">
                                <div className="flex items-center gap-2 text-green-700 font-semibold">
                                    <CheckCircle className="w-5 h-5" />
                                    <span>User created successfully!</span>
                                </div>
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                                    <p className="text-sm text-amber-800 font-medium">⚠ Distribute this temporary password to the user securely. They must change it on first login.</p>
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">Username</p>
                                        <p className="text-sm bg-white border border-gray-200 rounded px-3 py-1.5">{createdUser.username}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">Temporary Password</p>
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm bg-white border border-gray-200 rounded px-3 py-1.5 flex-1 tracking-widest">
                                                {showTempPassword ? createdUser.temporary_password : '••••••••••••••'}
                                            </p>
                                            <button onClick={() => setShowTempPassword(!showTempPassword)} className="p-2 text-gray-500 hover:text-gray-700">
                                                {showTempPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                            <button onClick={handleCopyPassword} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md font-medium" style={{ backgroundColor: copySuccess ? '#16a34a' : 'var(--sidebar-bg)', color: 'white' }}>
                                                <Copy className="w-4 h-4" />{copySuccess ? 'Copied!' : 'Copy'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => { setShowCreateUser(false); setCreatedUser(null); setShowTempPassword(false); }}
                                    className="w-full py-2 rounded-md text-white font-medium"
                                    style={{ backgroundColor: 'var(--sidebar-bg)' }}
                                >
                                    Done
                                </button>
                            </div>
                        ) : (
                            /* Form state */
                            <div className="p-6 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-1">
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">First Name <span className="text-red-500">*</span></label>
                                        <input
                                            type="text"
                                            value={createForm.first_name}
                                            onChange={(e) => setCreateForm(p => ({ ...p, first_name: e.target.value }))}
                                            placeholder="First Name"
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                        />
                                    </div>
                                    <div className="col-span-1">
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Last Name <span className="text-red-500">*</span></label>
                                        <input
                                            type="text"
                                            value={createForm.last_name}
                                            onChange={(e) => setCreateForm(p => ({ ...p, last_name: e.target.value }))}
                                            placeholder="Last Name"
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Email Address <span className="text-red-500">*</span></label>
                                        <input
                                            type="email"
                                            value={createForm.email}
                                            onChange={(e) => setCreateForm(p => ({ ...p, email: e.target.value }))}
                                            placeholder="juan@bfp.gov.ph"
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Username <span className="text-red-500">*</span></label>
                                        <input
                                            type="text"
                                            value={createForm.username}
                                            onChange={(e) => setCreateForm(p => ({ ...p, username: e.target.value }))}
                                            placeholder="e.g. encoder_juan"
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                        />
                                        <p className="text-xs text-gray-400 mt-1">3–50 characters: letters, numbers, underscores, hyphens. Used to log in via Keycloak.</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Role <span className="text-red-500">*</span></label>
                                        <select
                                            value={createForm.role}
                                            onChange={(e) => setCreateForm(p => ({ ...p, role: e.target.value }))}
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                        >
                                            <option value="REGIONAL_ENCODER">Regional Encoder</option>
                                            <option value="NATIONAL_VALIDATOR">National Validator</option>
                                            <option value="NATIONAL_ANALYST">National Analyst</option>
                                        </select>
                                    </div>
                                    {createForm.role === 'REGIONAL_ENCODER' && (
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Assigned Region <span className="text-red-500">*</span></label>
                                            <select
                                                value={createForm.assigned_region_id}
                                                onChange={(e) => setCreateForm(p => ({ ...p, assigned_region_id: e.target.value }))}
                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                            >
                                                <option value="">Select Region</option>
                                                {regions.map((region) => (
                                                    <option key={region.region_id} value={region.region_id}>
                                                        {region.region_name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    <div className="col-span-2">
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Contact Number</label>
                                        <input
                                            type="tel"
                                            value={createForm.contact_number}
                                            onChange={(e) => setCreateForm(p => ({ ...p, contact_number: e.target.value }))}
                                            placeholder="e.g. 09171234567"
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                        />
                                    </div>
                                </div>
                                <p className="text-xs text-gray-500">A temporary password will be automatically generated and shown to you after creation. The user will be required to change it on first login.</p>
                                <div className="flex gap-3 pt-2">
                                    <button
                                        onClick={handleCreateUser}
                                        disabled={isCreating || !createForm.email || !createForm.first_name || !createForm.last_name || !createForm.username}
                                        className="flex-1 py-2.5 rounded-lg text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                                        style={{ backgroundColor: 'var(--sidebar-bg)' }}
                                    >
                                        {isCreating ? <><RefreshCw className="w-4 h-4 animate-spin" /> Creating…</> : <><UserPlus className="w-4 h-4" /> Create User</>}
                                    </button>
                                    <button
                                        onClick={() => { setShowCreateUser(false); setCreatedUser(null); }}
                                        className="px-5 py-2.5 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function UserRow({ user, onUpdate, sessionCount, onViewSessions }: {
    user: AdminUser;
    onUpdate: (id: string, p: { role?: string; assigned_region_id?: number; is_active?: boolean }) => void;
    sessionCount: number;
    onViewSessions: () => void;
}) {
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
    const ROLES = ['CIVILIAN_REPORTER', 'REGIONAL_ENCODER', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST', 'SYSTEM_ADMIN'];
    return (
        <>
            <tr className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{user.username}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{user.role}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{user.assigned_region_id ?? '—'}</td>
                <td className="px-6 py-4 whitespace-nowrap">{user.is_active ? <CheckCircle className="w-5 h-5 text-green-600" /> : <XCircle className="w-5 h-5 text-red-500" />}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                    <button
                        onClick={onViewSessions}
                        className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
                    >
                        <Monitor className="w-4 h-4" />
                        {sessionCount > 0 ? (
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">{sessionCount}</span>
                        ) : (
                            <span className="text-gray-400">0</span>
                        )}
                    </button>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                    <button onClick={() => setExpanded(!expanded)} className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1 ml-auto">
                        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />} Edit
                    </button>
                </td>
            </tr>
            {expanded && (
                <tr className="bg-gray-50">
                    <td colSpan={7} className="px-6 py-4">
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
