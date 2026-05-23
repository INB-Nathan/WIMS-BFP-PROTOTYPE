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
    KeycloakSession,
    fetchActiveSessions,
    revokeUserSessions,
    fetchSystemHealth,
    triggerBackup,
    listBackups,
    downloadBackup,
    restoreBackup,
    fetchRateLimits,
    updateRateLimits,
    fetchWorkerStatus,
    fetchSystemMetrics,
    backfillAnalytics,
    fetchScheduledReports,
    createScheduledReport,
    updateScheduledReport,
    revokeIndividualSession,
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
    HardDrive,
    Upload,
    Download,
    Cpu,
    MemoryStick,
    Zap,
    ToggleLeft,
    ToggleRight,
    Clock,
    AlertTriangle,
    Filter,
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
    clients?: Record<string, string>;
}

interface BackupFile {
    filename: string;
    size_bytes: number;
    created_at: string;
}

interface RateLimitConfig {
    tier: string;
    login_window_seconds: number;
    login_threshold: number;
    updated_at: string | null;
}

interface WorkerStatus {
    worker_id: string;
    hostname: string;
    last_seen: string | null;
    active_tasks: number;
    status: string;
}

interface SystemMetrics {
    cpu_percent: number;
    memory: { total_mb: number; used_mb: number; percent: number };
    disk: { total_gb: number; used_gb: number; percent: number };
}

interface ScheduledReport {
    id: number;
    name: string;
    cron_expr: string;
    format: string;
    recipients: string[];
    enabled: boolean;
    created_at: string | null;
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
    const [copyUsernameSuccess, setCopyUsernameSuccess] = useState(false);

    // Backup state (#108)
    const [backups, setBackups] = useState<BackupFile[]>([]);
    const [loadingBackups, setLoadingBackups] = useState(false);
    const [triggeringBackup, setTriggeringBackup] = useState(false);
    const [backupError, setBackupError] = useState<string | null>(null);
    const [restoreFile, setRestoreFile] = useState<File | null>(null);
    const [restoreConfirmText, setRestoreConfirmText] = useState('');
    const [isRestoring, setIsRestoring] = useState(false);
    const [restoreError, setRestoreError] = useState<string | null>(null);
    const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);

    // Rate limits state (#109 GAP-A03)
    const [rateLimits, setRateLimits] = useState<RateLimitConfig | null>(null);
    const [editRateWindow, setEditRateWindow] = useState('');
    const [editRateThreshold, setEditRateThreshold] = useState('');
    const [savingRateLimits, setSavingRateLimits] = useState(false);
    const [rateLimitError, setRateLimitError] = useState<string | null>(null);

    // Monitoring state (#109 GAP-A03)
    const [workers, setWorkers] = useState<WorkerStatus[]>([]);
    const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
    const [loadingMonitoring, setLoadingMonitoring] = useState(false);

    // Scheduled reports state (#109 GAP-A03, GAP-A10)
    const [scheduledReports, setScheduledReports] = useState<ScheduledReport[]>([]);
    const [loadingReports, setLoadingReports] = useState(false);
    const [togglingReport, setTogglingReport] = useState<number | null>(null);
    const [showCreateReport, setShowCreateReport] = useState(false);
    const [createReportForm, setCreateReportForm] = useState({
        name: '',
        cron_expr: '0 8 * * 1',
        format: 'pdf',
        recipients: '',
    });
    const [creatingReport, setCreatingReport] = useState(false);
    const [reportError, setReportError] = useState<string | null>(null);

    // Backfill state (#109 GAP-A03)
    const [backfillingAnalytics, setBackfillingAnalytics] = useState(false);
    const [backfillResult, setBackfillResult] = useState<string | null>(null);

    // Health last-checked timestamp (#110 GAP-A23)
    const [healthLastChecked, setHealthLastChecked] = useState<Date | null>(null);

    // Audit log filters (#109 GAP-A07)
    const [auditFilterUser, setAuditFilterUser] = useState('');
    const [auditFilterAction, setAuditFilterAction] = useState('');

    // Security log pagination (#109 GAP-A08)
    const [securityPage, setSecurityPage] = useState(0);
    const SECURITY_PAGE_SIZE = 20;

    // Session termination confirmation (#110 GAP-A17)
    const [terminateConfirmUser, setTerminateConfirmUser] = useState<AdminUser | null>(null);

    // Individual session revocation (#110 GAP-A13)
    const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

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
            loadBackups();
            loadRateLimits();
            loadMonitoring();
            loadScheduledReports();
        }
    }, [role]);

    const loadHealth = async () => {
        try {
            const data = await fetchSystemHealth() as { status: string; components: Record<string, { status: string; latency_ms: number }> };
            setHealth(data);
            setHealthLastChecked(new Date());
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
            await revokeUserSessions(u.user_id);
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
        setSecurityPage(0);
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
            const data = await fetchAuditLogs({ limit: 50, offset: 0 }) as unknown as { items: Record<string, unknown>[]; total: number };
            setAuditLogs({
                items: data.items.map((item): AuditItem => ({
                    audit_id: item.audit_id as number,
                    user_id: item.user_id as string | null,
                    action_type: item.action_type as string | null,
                    table_affected: item.table_affected as string | null,
                    record_id: item.record_id as number | null,
                    ip_address: item.ip_address as string | null,
                    user_agent: item.user_agent as string | null,
                    timestamp: item.timestamp as string | null,
                })),
                total: data.total,
            });
        } catch {
            setAuditLogs({ items: [], total: 0 });
        } finally {
            setLoadingAudit(false);
        }
    };

    // Backup management
    const loadBackups = async () => {
        setLoadingBackups(true);
        setBackupError(null);
        try {
            const data = await listBackups();
            setBackups(data);
        } catch (e: unknown) {
            setBackupError((e as { message?: string })?.message ?? 'Failed to load backups');
        } finally {
            setLoadingBackups(false);
        }
    };

    const handleTriggerBackup = async () => {
        setTriggeringBackup(true);
        setBackupError(null);
        try {
            await triggerBackup();
            await loadBackups();
        } catch (e: unknown) {
            setBackupError((e as { message?: string })?.message ?? 'Backup failed');
        } finally {
            setTriggeringBackup(false);
        }
    };

    const handleDownloadBackup = async (filename: string) => {
        try {
            const blob = await downloadBackup(filename);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e: unknown) {
            setBackupError((e as { message?: string })?.message ?? 'Download failed');
        }
    };

    const handleRestoreBackup = async () => {
        if (!restoreFile || restoreConfirmText !== 'RESTORE') return;
        setIsRestoring(true);
        setRestoreError(null);
        setRestoreSuccess(null);
        try {
            const result = await restoreBackup(restoreFile);
            setRestoreSuccess(`Restored successfully from ${result.filename} at ${new Date(result.restored_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`);
            setRestoreFile(null);
            setRestoreConfirmText('');
        } catch (e: unknown) {
            setRestoreError((e as { message?: string })?.message ?? 'Restore failed');
        } finally {
            setIsRestoring(false);
        }
    };

    // Rate limits
    const loadRateLimits = async () => {
        try {
            const data = await fetchRateLimits();
            setRateLimits(data);
            setEditRateWindow(String(data.login_window_seconds));
            setEditRateThreshold(String(data.login_threshold));
        } catch {
            setRateLimits(null);
        }
    };

    const handleSaveRateLimits = async () => {
        setSavingRateLimits(true);
        setRateLimitError(null);
        try {
            await updateRateLimits({
                tier: 'login',
                limit: parseInt(editRateThreshold, 10),
                window: parseInt(editRateWindow, 10),
            });
            await loadRateLimits();
        } catch (e: unknown) {
            setRateLimitError((e as { message?: string })?.message ?? 'Failed to save');
        } finally {
            setSavingRateLimits(false);
        }
    };

    // Monitoring
    const loadMonitoring = async () => {
        setLoadingMonitoring(true);
        try {
            const [w, m] = await Promise.all([fetchWorkerStatus(), fetchSystemMetrics()]);
            setWorkers(w);
            setSystemMetrics(m);
        } catch {
            setWorkers([]);
            setSystemMetrics(null);
        } finally {
            setLoadingMonitoring(false);
        }
    };

    // Scheduled reports
    const loadScheduledReports = async () => {
        setLoadingReports(true);
        try {
            const data = await fetchScheduledReports();
            setScheduledReports(data);
        } catch {
            setScheduledReports([]);
        } finally {
            setLoadingReports(false);
        }
    };

    const handleToggleReport = async (id: number, enabled: boolean) => {
        setTogglingReport(id);
        try {
            await updateScheduledReport(id, { enabled });
            setScheduledReports((prev) =>
                prev.map((r) => (r.id === id ? { ...r, enabled } : r))
            );
        } catch (e: unknown) {
            setReportError((e as { message?: string })?.message ?? 'Toggle failed');
        } finally {
            setTogglingReport(null);
        }
    };

    const handleCreateReport = async () => {
        if (!createReportForm.name.trim() || !createReportForm.cron_expr.trim()) return;
        setCreatingReport(true);
        setReportError(null);
        try {
            const recipients = createReportForm.recipients
                .split(',')
                .map((r) => r.trim())
                .filter(Boolean);
            await createScheduledReport({
                name: createReportForm.name,
                cron_expr: createReportForm.cron_expr,
                format: createReportForm.format as 'pdf' | 'excel' | 'csv',
                recipients,
                enabled: true,
            });
            setShowCreateReport(false);
            setCreateReportForm({ name: '', cron_expr: '0 8 * * 1', format: 'pdf', recipients: '' });
            await loadScheduledReports();
        } catch (e: unknown) {
            setReportError((e as { message?: string })?.message ?? 'Failed to create report');
        } finally {
            setCreatingReport(false);
        }
    };

    // Backfill
    const handleBackfill = async () => {
        setBackfillingAnalytics(true);
        setBackfillResult(null);
        try {
            const result = await backfillAnalytics();
            setBackfillResult(`Synced ${result.synced_count} records.`);
            setTimeout(() => setBackfillResult(null), 4000);
        } catch (e: unknown) {
            setBackfillResult((e as { message?: string })?.message ?? 'Backfill failed');
            setTimeout(() => setBackfillResult(null), 4000);
        } finally {
            setBackfillingAnalytics(false);
        }
    };

    // Individual session revoke
    const handleRevokeIndividualSession = async (userId: string, sessionId: string) => {
        setRevokingSessionId(sessionId);
        try {
            await revokeIndividualSession(userId, sessionId);
            setSessionsByUser((prev) => ({
                ...prev,
                [userId]: (prev[userId] ?? []).filter((s) => s.id !== sessionId),
            }));
        } catch (e: unknown) {
            alert((e as { message?: string })?.message ?? 'Failed to revoke session');
        } finally {
            setRevokingSessionId(null);
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

    const handleCopyUsername = () => {
        if (!createdUser) return;
        navigator.clipboard.writeText(createdUser.username);
        setCopyUsernameSuccess(true);
        setTimeout(() => setCopyUsernameSuccess(false), 2000);
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

    const userIdToUsername = React.useMemo(
        () => Object.fromEntries(users.map((u) => [u.user_id, u.username])),
        [users]
    );

    const filteredAuditItems = auditLogs.items.filter((a) => {
        const username = a.user_id ? userIdToUsername[a.user_id] ?? '' : '';
        const matchUser =
            !auditFilterUser || username.toLowerCase().includes(auditFilterUser.toLowerCase());
        const matchAction =
            !auditFilterAction ||
            (a.action_type ?? '').toLowerCase().includes(auditFilterAction.toLowerCase());
        return matchUser && matchAction;
    });

    const pagedSecurityLogs = securityLogs.slice(
        securityPage * SECURITY_PAGE_SIZE,
        (securityPage + 1) * SECURITY_PAGE_SIZE
    );

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
        {
            label: 'Total API Requests',
            value: '—',
            icon: BarChart3,
            title: 'Metric not available — requires Prometheus scrape integration',
        },
    ];

    const formatBackupSize = (bytes: number): string => {
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    };

    const getResourceColor = (percent: number): string => {
        if (percent >= 90) return 'bg-red-500';
        if (percent >= 70) return 'bg-yellow-400';
        return 'bg-green-500';
    };

    const getWorkerStatusBadge = (status: string): { label: string; cls: string } => {
        if (status === 'ACTIVE') return { label: 'ACTIVE', cls: 'bg-green-100 text-green-800' };
        if (status === 'STALE') return { label: 'STALE', cls: 'bg-yellow-100 text-yellow-800' };
        return { label: 'OFFLINE', cls: 'bg-red-100 text-red-800' };
    };

    const getFormatBadge = (fmt: string): { cls: string } => {
        if (fmt === 'pdf') return { cls: 'bg-red-100 text-red-800' };
        if (fmt === 'excel') return { cls: 'bg-green-100 text-green-800' };
        return { cls: 'bg-blue-100 text-blue-800' };
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    System Admin Hub
                </h1>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Identity governance, threat telemetry, and system audit.
                </p>
            </div>

            <section id="analytics" className="card overflow-hidden">
                <div className="card-header flex items-center gap-2" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <BarChart3 className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    <span>System Analytics / Flow</span>
                </div>
                <div className="card-body grid grid-cols-1 md:grid-cols-3 gap-4">
                    {systemStats.map(({ label, value, icon: Icon, title }) => (
                        <div
                            key={label}
                            className="p-4 rounded-lg flex items-center gap-4"
                            style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}
                        >
                            <div
                                className="p-2 rounded-lg"
                                style={{ backgroundColor: 'rgba(60,75,100,0.1)', color: 'var(--sidebar-bg)' }}
                            >
                                <Icon className="w-6 h-6" />
                            </div>
                            <div>
                                <div
                                    className="text-[11px] font-semibold uppercase tracking-wider"
                                    style={{ color: 'var(--text-muted)' }}
                                >
                                    {label}
                                </div>
                                <div
                                    className="text-2xl font-bold"
                                    style={{ color: 'var(--text-primary)' }}
                                    title={title}
                                >
                                    {value}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {health && (
                <section id="health" className="card overflow-hidden">
                    <div
                        className="card-header flex items-center justify-between"
                        style={{ borderLeft: '4px solid var(--sidebar-bg)' }}
                    >
                        <div className="flex items-center gap-2">
                            <Activity className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                            <span>System Health</span>
                            <span
                                className={`ml-2 px-2 py-0.5 rounded text-xs font-bold text-white ${
                                    health.status === 'HEALTHY' ? 'bg-green-600' : 'bg-red-600'
                                }`}
                            >
                                {health.status}
                            </span>
                            {healthLastChecked && (
                                <span className="text-xs text-gray-400 ml-2">
                                    Last checked:{' '}
                                    {healthLastChecked.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila' })}
                                </span>
                            )}
                        </div>
                        <button
                            onClick={loadHealth}
                            className="flex items-center gap-1 text-sm font-medium hover:opacity-80 transition-opacity"
                            style={{ color: 'var(--bfp-maroon)' }}
                        >
                            <RefreshCw className="w-4 h-4" /> Refresh
                        </button>
                    </div>
                    <div className="card-body grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div
                            className="p-4 rounded-lg flex items-center justify-between"
                            style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}
                        >
                            <div className="flex items-center gap-3">
                                <Database className="w-5 h-5 text-gray-500" />
                                <div>
                                    <div className="text-sm font-semibold">PostgreSQL</div>
                                    <div className="text-xs text-gray-500">
                                        {health.components.database?.latency_ms ?? 0}ms
                                    </div>
                                </div>
                            </div>
                            <span
                                className={`w-3 h-3 rounded-full ${
                                    health.components.database?.status === 'HEALTHY' ? 'bg-green-500' : 'bg-red-500'
                                }`}
                            />
                        </div>
                        <div
                            className="p-4 rounded-lg flex items-center justify-between"
                            style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}
                        >
                            <div className="flex items-center gap-3">
                                <Server className="w-5 h-5 text-gray-500" />
                                <div>
                                    <div className="text-sm font-semibold">Redis</div>
                                    <div className="text-xs text-gray-500">
                                        {health.components.redis?.latency_ms ?? 0}ms
                                    </div>
                                </div>
                            </div>
                            <span
                                className={`w-3 h-3 rounded-full ${
                                    health.components.redis?.status === 'HEALTHY' ? 'bg-green-500' : 'bg-red-500'
                                }`}
                            />
                        </div>
                        <div
                            className="p-4 rounded-lg flex items-center justify-between"
                            style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}
                        >
                            <div className="flex items-center gap-3">
                                <Server className="w-5 h-5 text-gray-500" />
                                <div>
                                    <div className="text-sm font-semibold">Keycloak</div>
                                    <div className="text-xs text-gray-500">
                                        {health.components.keycloak?.latency_ms ?? 0}ms
                                    </div>
                                </div>
                            </div>
                            <span
                                className={`w-3 h-3 rounded-full ${
                                    health.components.keycloak?.status === 'HEALTHY' ? 'bg-green-500' : 'bg-red-500'
                                }`}
                            />
                        </div>
                    </div>
                </section>
            )}

            {/* 5A: System Monitoring */}
            <section id="monitoring" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <Cpu className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>System Monitoring</span>
                    </div>
                    <button
                        onClick={loadMonitoring}
                        disabled={loadingMonitoring}
                        className="flex items-center gap-1 text-sm font-medium disabled:opacity-50"
                        style={{ color: 'var(--bfp-maroon)' }}
                    >
                        <RefreshCw className={`w-4 h-4 ${loadingMonitoring ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                </div>
                <div className="card-body grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* System Resources */}
                    <div className="space-y-4">
                        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            System Resources
                        </h3>
                        {!systemMetrics && loadingMonitoring ? (
                            <div className="space-y-3">
                                {[100, 80, 60].map((h) => (
                                    <div key={h}>
                                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                                            <span>Loading…</span>
                                            <span>—</span>
                                        </div>
                                        <div className="w-full h-2 rounded-full bg-gray-200">
                                            <div className="h-2 rounded-full bg-gray-300 animate-pulse" style={{ width: '60%' }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : systemMetrics ? (
                            <div className="space-y-3">
                                {/* CPU */}
                                <div>
                                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                                        <span>CPU</span>
                                        <span>{systemMetrics.cpu_percent.toFixed(1)}%</span>
                                    </div>
                                    <div className="w-full h-2 rounded-full bg-gray-200">
                                        <div
                                            className={`h-2 rounded-full ${getResourceColor(systemMetrics.cpu_percent)}`}
                                            style={{ width: `${systemMetrics.cpu_percent}%` }}
                                        />
                                    </div>
                                </div>
                                {/* Memory */}
                                <div>
                                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                                        <span>Memory</span>
                                        <span>
                                            {systemMetrics.memory.used_mb}MB / {systemMetrics.memory.total_mb}MB (
                                            {systemMetrics.memory.percent.toFixed(1)}%)
                                        </span>
                                    </div>
                                    <div className="w-full h-2 rounded-full bg-gray-200">
                                        <div
                                            className={`h-2 rounded-full ${getResourceColor(systemMetrics.memory.percent)}`}
                                            style={{ width: `${systemMetrics.memory.percent}%` }}
                                        />
                                    </div>
                                </div>
                                {/* Disk */}
                                <div>
                                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                                        <span>Disk</span>
                                        <span>
                                            {systemMetrics.disk.used_gb}GB / {systemMetrics.disk.total_gb}GB (
                                            {systemMetrics.disk.percent.toFixed(1)}%)
                                        </span>
                                    </div>
                                    <div className="w-full h-2 rounded-full bg-gray-200">
                                        <div
                                            className={`h-2 rounded-full ${getResourceColor(systemMetrics.disk.percent)}`}
                                            style={{ width: `${systemMetrics.disk.percent}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm text-gray-400">No system metrics available.</p>
                        )}
                    </div>

                    {/* Celery Workers */}
                    <div className="space-y-4">
                        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            Celery Workers
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Worker ID</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Hostname</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Last Seen</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tasks</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {workers.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="px-3 py-4 text-center text-gray-400 text-sm">
                                                No worker data available.
                                            </td>
                                        </tr>
                                    ) : (
                                        workers.map((w) => {
                                            const badge = getWorkerStatusBadge(w.status);
                                            return (
                                                <tr key={w.worker_id} className="hover:bg-gray-50">
                                                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{w.worker_id}</td>
                                                    <td className="px-3 py-2 text-xs text-gray-600">{w.hostname}</td>
                                                    <td className="px-3 py-2 text-xs text-gray-500">
                                                        {w.last_seen
                                                            ? new Date(w.last_seen).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })
                                                            : '—'}
                                                    </td>
                                                    <td className="px-3 py-2 text-xs text-gray-600 text-center">{w.active_tasks}</td>
                                                    <td className="px-3 py-2">
                                                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${badge.cls}`}>
                                                            {badge.label}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </section>

            {/* 5B: Rate Limit Configuration */}
            <section id="rate-limits" className="card overflow-hidden">
                <div className="card-header flex items-center gap-2" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <Zap className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    <span>Rate Limit Configuration</span>
                </div>
                <div className="card-body">
                    {rateLimits === null ? (
                        <div className="space-y-3">
                            {[1, 2].map((k) => (
                                <div key={k} className="h-12 bg-gray-100 rounded animate-pulse" />
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Current values */}
                            <div className="space-y-2">
                                <div>
                                    <div className="text-xs font-semibold text-gray-500 uppercase">Login Window</div>
                                    <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                                        {rateLimits.login_window_seconds} seconds
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-gray-500 uppercase">Max Attempts</div>
                                    <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                                        {rateLimits.login_threshold} attempts
                                    </div>
                                </div>
                                <p className="text-xs text-gray-400 mt-2">
                                    Applied immediately to all login attempts via Redis.
                                </p>
                            </div>
                            {/* Edit form */}
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">
                                        Window (seconds)
                                    </label>
                                    <input
                                        type="number"
                                        min="60"
                                        max="3600"
                                        value={editRateWindow}
                                        onChange={(e) => setEditRateWindow(e.target.value)}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">
                                        Max attempts
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="100"
                                        value={editRateThreshold}
                                        onChange={(e) => setEditRateThreshold(e.target.value)}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                    />
                                </div>
                                <button
                                    onClick={handleSaveRateLimits}
                                    disabled={
                                        savingRateLimits ||
                                        !editRateWindow ||
                                        !editRateThreshold ||
                                        parseInt(editRateWindow, 10) < 1 ||
                                        parseInt(editRateThreshold, 10) < 1
                                    }
                                    className="px-4 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                                    style={{ backgroundColor: 'var(--bfp-maroon)' }}
                                >
                                    {savingRateLimits ? 'Saving…' : 'Save'}
                                </button>
                                {rateLimitError && (
                                    <p className="text-sm text-red-600 mt-1">{rateLimitError}</p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </section>

            {/* 5C: Scheduled Reports */}
            <section id="scheduled-reports" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>Scheduled Reports</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleBackfill}
                            disabled={backfillingAnalytics}
                            className="flex items-center gap-1 text-sm font-medium border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
                        >
                            <Zap className="w-4 h-4" />
                            {backfillingAnalytics ? 'Backfilling…' : 'Analytics Backfill'}
                        </button>
                        {backfillResult && (
                            <span className="text-xs text-green-700 font-medium">{backfillResult}</span>
                        )}
                        <button
                            onClick={() => setShowCreateReport(true)}
                            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md text-white"
                            style={{ backgroundColor: 'var(--bfp-maroon)' }}
                        >
                            <UserPlus className="w-4 h-4" /> New Report
                        </button>
                    </div>
                </div>
                {reportError && <p className="text-sm text-red-600 px-6 pb-4">{reportError}</p>}
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Format</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Schedule</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Recipients</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Enabled</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {scheduledReports.length === 0 && !loadingReports ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                                        No scheduled reports configured.
                                    </td>
                                </tr>
                            ) : (
                                scheduledReports.map((r) => {
                                    const fmtBadge = getFormatBadge(r.format);
                                    return (
                                        <tr key={r.id} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{r.name}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${fmtBadge.cls}`}>
                                                    {r.format.toUpperCase()}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                <code className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">
                                                    {r.cron_expr}
                                                </code>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 max-w-xs truncate">
                                                {r.recipients && r.recipients.length > 0
                                                  ? r.recipients.join(', ').slice(0, 40) + (r.recipients.join(', ').length > 40 ? '…' : '')
                                                  : <span className="text-gray-400 italic">None</span>}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <button
                                                    onClick={() => handleToggleReport(r.id, !r.enabled)}
                                                    disabled={togglingReport === r.id}
                                                    className="flex items-center gap-1 text-sm disabled:opacity-50"
                                                >
                                                    {r.enabled ? (
                                                        <ToggleRight className="w-5 h-5 text-green-600" />
                                                    ) : (
                                                        <ToggleLeft className="w-5 h-5 text-gray-400" />
                                                    )}
                                                </button>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                {r.created_at
                                                    ? new Date(r.created_at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })
                                                    : '—'}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* 5D: Backup Management */}
            <section id="backup" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <HardDrive className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>Backup Management</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={loadBackups}
                            disabled={loadingBackups}
                            className="flex items-center gap-1 text-sm font-medium disabled:opacity-50"
                            style={{ color: 'var(--bfp-maroon)' }}
                        >
                            <RefreshCw className={`w-4 h-4 ${loadingBackups ? 'animate-spin' : ''}`} /> Refresh
                        </button>
                        <button
                            onClick={handleTriggerBackup}
                            disabled={triggeringBackup}
                            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md text-white disabled:opacity-50"
                            style={{ backgroundColor: 'var(--bfp-maroon)' }}
                        >
                            <Database className="w-4 h-4" />
                            {triggeringBackup ? 'Backing up…' : 'Trigger Backup'}
                        </button>
                    </div>
                </div>
                {backupError && <p className="text-sm text-red-600 px-6 pb-4">{backupError}</p>}
                <div className="card-body space-y-6">
                    {/* Available Backups */}
                    <div>
                        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                            Available Backups
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Filename</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created At</th>
                                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Download</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {loadingBackups ? (
                                        [1, 2, 3].map((k) => (
                                            <tr key={k}>
                                                <td colSpan={4} className="px-6 py-3">
                                                    <div className="h-4 bg-gray-100 rounded animate-pulse" />
                                                </td>
                                            </tr>
                                        ))
                                    ) : backups.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                                                No backups found.
                                            </td>
                                        </tr>
                                    ) : (
                                        backups.map((b) => (
                                            <tr key={b.filename} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-700">
                                                    {b.filename}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                                    {formatBackupSize(b.size_bytes)}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                    {new Date(b.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                                    <button
                                                        onClick={() => handleDownloadBackup(b.filename)}
                                                        className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
                                                    >
                                                        <Download className="w-4 h-4" /> Download
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Danger Zone: Restore */}
                    <div className="border border-red-200 rounded-lg p-4 mt-4 mx-6 mb-4">
                        <h4 className="text-sm font-bold text-red-700 mb-1">⚠ Restore Database</h4>
                        <p className="text-xs text-gray-500 mb-4">
                            This will OVERWRITE the current database with the selected backup. All data created
                            after the backup timestamp will be permanently lost.
                        </p>

                        {/* Step 1 — File upload */}
                        <div className="mb-4">
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                                Select .sql.enc backup file
                            </label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="file"
                                    accept=".enc"
                                    id="restore-file-input"
                                    className="hidden"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0] ?? null;
                                        if (file && !/^wims_\d{8}_\d{6}\.sql\.enc$/.test(file.name)) {
                                            setRestoreError('File must be a WIMS backup (.sql.enc)');
                                            setRestoreFile(null);
                                        } else {
                                            setRestoreFile(file);
                                            setRestoreError(null);
                                        }
                                    }}
                                />
                                <label
                                    htmlFor="restore-file-input"
                                    className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded cursor-pointer hover:bg-gray-50"
                                >
                                    <Upload className="w-4 h-4" /> Choose File
                                </label>
                                {restoreFile && (
                                    <span className="text-sm text-gray-600 font-mono">{restoreFile.name}</span>
                                )}
                            </div>
                        </div>

                        {/* Step 2 — Confirmation */}
                        {restoreFile && (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                        Type &quot;RESTORE&quot; to confirm
                                    </label>
                                    <input
                                        type="text"
                                        value={restoreConfirmText}
                                        onChange={(e) => setRestoreConfirmText(e.target.value)}
                                        placeholder="RESTORE"
                                        className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40"
                                    />
                                </div>
                                <button
                                    onClick={handleRestoreBackup}
                                    disabled={restoreConfirmText !== 'RESTORE' || isRestoring}
                                    className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 disabled:opacity-50"
                                >
                                    {isRestoring ? 'Restoring…' : 'Restore Database'}
                                </button>
                                {restoreError && <p className="text-red-600 text-sm mt-2">{restoreError}</p>}
                                {restoreSuccess && <p className="text-green-700 text-sm mt-2">{restoreSuccess}</p>}
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <section id="governance" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <Users className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>Identity Governance</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => {
                                setShowCreateUser(true);
                                setCreatedUser(null);
                            }}
                            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md text-white"
                            style={{ backgroundColor: 'var(--bfp-maroon)' }}
                        >
                            <UserPlus className="w-4 h-4" /> Create User
                        </button>
                        <button
                            onClick={loadUsers}
                            disabled={loadingUsers}
                            className="flex items-center gap-1 text-sm font-medium disabled:opacity-50"
                            style={{ color: 'var(--bfp-maroon)' }}
                        >
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
                        <tbody
                            className="bg-white divide-y divide-gray-200"
                            tabIndex={0}
                            role="rowgroup"
                        >
                            {users.map((u) => (
                                <UserRow
                                    key={u.user_id}
                                    user={u}
                                    onUpdate={handleUpdateUser}
                                    sessionCount={sessionsByUser[u.user_id]?.length ?? 0}
                                    onViewSessions={() => setSelectedSessionUser(u)}
                                    regions={regions}
                                />
                            ))}
                        </tbody>
                    </table>
                    {users.length === 0 && !loadingUsers && (
                        <div className="p-8 text-center text-gray-500">No users found.</div>
                    )}
                </div>
            </section>

            <section id="sessions" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <BarChart3 className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>Active Sessions</span>
                    </div>
                    <button
                        onClick={loadSessions}
                        disabled={loadingSessions}
                        className="flex items-center gap-1 text-sm font-medium disabled:opacity-50"
                        style={{ color: 'var(--bfp-maroon)' }}
                    >
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
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Revoke</th>
                            </tr>
                        </thead>
                        <tbody
                            className="bg-white divide-y divide-gray-200"
                            tabIndex={0}
                            role="rowgroup"
                        >
                            {activeSessions.map((s) => (
                                <tr
                                    key={s.session_id}
                                    className="hover:bg-gray-50"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.currentTarget
                                                .querySelector<HTMLButtonElement>('button')
                                                ?.click();
                                        }
                                    }}
                                >
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                        {s.username}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{s.role}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">
                                        {s.ip_address}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {new Date(s.last_access).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {s.clients ? Object.values(s.clients).join(', ') || '—' : '—'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right">
                                        <div className="flex items-center justify-end gap-3">
                                            <button
                                                onClick={() => handleRevokeIndividualSession(s.user_id, s.session_id)}
                                                disabled={revokingSessionId === s.session_id}
                                                className="text-orange-600 hover:text-orange-800 text-sm font-medium disabled:opacity-50"
                                            >
                                                {revokingSessionId === s.session_id ? 'Revoking…' : 'Revoke Session'}
                                            </button>
                                            <button
                                                onClick={() => handleRevokeSession(s.user_id)}
                                                disabled={isRevoking === s.user_id}
                                                className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50"
                                            >
                                                {isRevoking === s.user_id ? 'Revoking…' : 'Force Logout'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {activeSessions.length === 0 && !loadingSessions && (
                        <div className="p-8 text-center text-gray-500">No active sessions found.</div>
                    )}
                </div>
            </section>

            <section id="telemetry" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>Threat Telemetry</span>
                    </div>
                    <button
                        onClick={loadSecurityLogs}
                        disabled={loadingLogs}
                        className="flex items-center gap-1 text-sm font-medium disabled:opacity-50"
                        style={{ color: 'var(--bfp-maroon)' }}
                    >
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
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Admin Review</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">View</th>
                            </tr>
                        </thead>
                        <tbody
                            className="bg-white divide-y divide-gray-200"
                            tabIndex={0}
                            role="rowgroup"
                        >
                            {pagedSecurityLogs.map((log) => (
                                <tr
                                    key={log.log_id}
                                    className="hover:bg-gray-50"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.currentTarget
                                                .querySelector<HTMLButtonElement>('button')
                                                ?.click();
                                        }
                                    }}
                                >
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span
                                            className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                                log.severity_level === 'CRITICAL'
                                                    ? 'bg-red-100 text-red-800'
                                                    : log.severity_level === 'HIGH'
                                                      ? 'bg-orange-100 text-orange-800'
                                                      : log.severity_level === 'MEDIUM'
                                                        ? 'bg-yellow-100 text-yellow-800'
                                                        : 'bg-blue-100 text-blue-800'
                                            }`}
                                        >
                                            {log.severity_level ?? '—'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {log.timestamp
                                            ? new Date(log.timestamp).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })
                                            : '—'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">
                                        {log.source_ip ?? '—'} → {log.destination_ip ?? '—'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {log.suricata_sid ?? '—'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                                        {log.admin_action_taken ? (
                                            <span className="text-green-700 font-medium">{log.admin_action_taken}</span>
                                        ) : (
                                            <span className="text-gray-400 italic">Unreviewed</span>
                                        )}
                                    </td>
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
                                            <button
                                                onClick={() => setSelectedLog(log)}
                                                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                                            >
                                                View
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {securityLogs.length === 0 && !loadingLogs && (
                        <div className="p-8 text-center text-gray-500">No Suricata alerts.</div>
                    )}
                </div>
                {/* Pagination footer */}
                {securityLogs.length > SECURITY_PAGE_SIZE && (
                    <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                        <span className="text-xs text-gray-500">
                            Showing{' '}
                            {securityPage * SECURITY_PAGE_SIZE + 1}–
                            {Math.min((securityPage + 1) * SECURITY_PAGE_SIZE, securityLogs.length)} of{' '}
                            {securityLogs.length}
                        </span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setSecurityPage((p) => p - 1)}
                                disabled={securityPage === 0}
                                className="px-3 py-1 text-xs border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-100"
                            >
                                Prev
                            </button>
                            <button
                                onClick={() => setSecurityPage((p) => p + 1)}
                                disabled={
                                    (securityPage + 1) * SECURITY_PAGE_SIZE >= securityLogs.length
                                }
                                className="px-3 py-1 text-xs border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-100"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </section>

            <section id="audit" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>System Audit</span>
                    </div>
                    <button
                        onClick={loadAuditLogs}
                        disabled={loadingAudit}
                        className="flex items-center gap-1 text-sm font-medium disabled:opacity-50"
                        style={{ color: 'var(--bfp-maroon)' }}
                    >
                        <RefreshCw className={`w-4 h-4 ${loadingAudit ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                </div>
                {/* Filter bar */}
                <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap gap-3 items-center">
                    <Filter className="w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Filter by username…"
                        value={auditFilterUser}
                        onChange={(e) => setAuditFilterUser(e.target.value)}
                        className="border border-gray-200 rounded px-3 py-1.5 text-sm w-48"
                    />
                    <input
                        type="text"
                        placeholder="Filter by action…"
                        value={auditFilterAction}
                        onChange={(e) => setAuditFilterAction(e.target.value)}
                        className="border border-gray-200 rounded px-3 py-1.5 text-sm w-48"
                    />
                    {(auditFilterUser || auditFilterAction) && (
                        <button
                            onClick={() => {
                                setAuditFilterUser('');
                                setAuditFilterAction('');
                            }}
                            className="text-xs text-gray-500 hover:text-gray-700 underline"
                        >
                            Clear
                        </button>
                    )}
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
                        <tbody
                            className="bg-white divide-y divide-gray-200"
                            tabIndex={0}
                            role="rowgroup"
                        >
                            {filteredAuditItems.map((a) => (
                                <tr
                                    key={a.audit_id}
                                    className="hover:bg-gray-50"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.currentTarget
                                                .querySelector<HTMLButtonElement>('button')
                                                ?.click();
                                        }
                                    }}
                                >
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {a.timestamp
                                            ? new Date(a.timestamp).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })
                                            : '—'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">
                                        {a.user_id
                                            ? userIdToUsername[a.user_id] ?? a.user_id.slice(0, 8) + '…'
                                            : '—'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                        {a.action_type ?? '—'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {a.table_affected ?? '—'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {a.record_id ?? '—'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">
                                        {a.ip_address ?? '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filteredAuditItems.length === 0 && !loadingAudit && (
                        <div className="p-8 text-center text-gray-500">No audit entries.</div>
                    )}
                </div>
                {auditLogs.total > 0 && (
                    <div className="px-6 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
                        Showing {filteredAuditItems.length} of {auditLogs.total}
                    </div>
                )}
            </section>

            {selectedLog && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto bg-[var(--background)] text-[var(--foreground)]">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800">
                            <h3 className="text-lg font-bold text-[var(--foreground)] text-white">
                                Suricata Alert #{selectedLog.log_id}
                            </h3>
                            <button
                                onClick={() => {
                                    setSelectedLog(null);
                                    setActionNote('');
                                }}
                                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                            >
                                <XCircle className="w-6 h-6" />
                            </button>
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
                                <div>
                                    <span className="text-gray-600 dark:text-gray-400">Source</span>
                                    <div className="font-mono text-[var(--foreground)]">
                                        {selectedLog.source_ip ?? '—'}
                                    </div>
                                </div>
                                <div>
                                    <span className="text-gray-600 dark:text-gray-400">Destination</span>
                                    <div className="font-mono text-[var(--foreground)]">
                                        {selectedLog.destination_ip ?? '—'}
                                    </div>
                                </div>
                                <div>
                                    <span className="text-gray-600 dark:text-gray-400">SID</span>
                                    <div className="text-[var(--foreground)]">{selectedLog.suricata_sid ?? '—'}</div>
                                </div>
                                <div>
                                    <span className="text-gray-600 dark:text-gray-400">Severity</span>
                                    <div className="text-[var(--foreground)]">{selectedLog.severity_level ?? '—'}</div>
                                </div>
                            </div>
                            {selectedLog.raw_payload && (
                                <div>
                                    <span className="text-gray-600 dark:text-gray-400 text-xs uppercase">Raw Payload</span>
                                    <div className="relative mt-1">
                                        <pre className="bg-gray-100 dark:bg-gray-950 text-gray-800 dark:text-gray-200 p-2 rounded text-xs overflow-x-auto font-mono max-h-40 overflow-y-auto">
                                            {selectedLog.raw_payload}
                                        </pre>
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(selectedLog.raw_payload ?? '');
                                            }}
                                            className="absolute top-1 right-1 px-2 py-0.5 bg-gray-200 hover:bg-gray-300 text-xs rounded text-gray-600"
                                        >
                                            Copy
                                        </button>
                                    </div>
                                </div>
                            )}
                            {!selectedLog.admin_action_taken && (
                                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
                                        Admin action note
                                    </label>
                                    <textarea
                                        value={actionNote}
                                        onChange={(e) => setActionNote(e.target.value)}
                                        placeholder="e.g. RESOLVED, FALSE_POSITIVE, ESCALATED"
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm text-[var(--foreground)] bg-[var(--background)]"
                                        rows={2}
                                    />
                                    <div className="mt-2 flex gap-2">
                                        <button
                                            onClick={handleUpdateSecurityLog}
                                            disabled={!actionNote.trim() || isSubmitting}
                                            className="px-4 py-2 bg-red-600 text-white rounded font-medium hover:bg-red-700 disabled:opacity-50"
                                        >
                                            {isSubmitting ? 'Saving...' : 'Save'}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setSelectedLog(null);
                                                setActionNote('');
                                            }}
                                            className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 rounded font-medium hover:bg-gray-300 dark:hover:bg-gray-500"
                                        >
                                            Cancel
                                        </button>
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
                                <h3 className="text-base font-bold">
                                    Active Sessions — {selectedSessionUser.username}
                                </h3>
                            </div>
                            <button
                                onClick={() => setSelectedSessionUser(null)}
                                className="text-gray-500 hover:text-gray-700"
                            >
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
                                                        Started:{' '}
                                                        {s.start
                                                            ? new Date(s.start).toLocaleString('en-PH', {
                                                                  timeZone: 'Asia/Manila',
                                                              })
                                                            : '—'}{' '}
                                                        &middot; Last access:{' '}
                                                        {s.lastAccess
                                                            ? new Date(s.lastAccess).toLocaleString('en-PH', {
                                                                  timeZone: 'Asia/Manila',
                                                              })
                                                            : '—'}
                                                    </div>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {/* Step 2 confirmation: shown when terminateConfirmUser is not null */}
                            {terminateConfirmUser ? (
                                <div className="pt-3 border-t border-red-200 space-y-3">
                                    <p className="text-sm text-red-700 font-medium">
                                        Are you sure? This will end all sessions for{' '}
                                        {terminateConfirmUser.username}.
                                    </p>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => {
                                                handleTerminateSessions(terminateConfirmUser);
                                                setTerminateConfirmUser(null);
                                            }}
                                            className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700"
                                        >
                                            Confirm Terminate
                                        </button>
                                        <button
                                            onClick={() => setTerminateConfirmUser(null)}
                                            className="px-4 py-2 bg-gray-200 text-gray-800 text-sm font-medium rounded hover:bg-gray-300"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="pt-2 border-t border-gray-100 flex justify-between items-center">
                                    <span className="text-xs text-gray-400">
                                        Terminating ends all active sessions for this user.
                                    </span>
                                    <button
                                        onClick={() => setTerminateConfirmUser(selectedSessionUser)}
                                        disabled={
                                            terminatingUser === selectedSessionUser.user_id ||
                                            (sessionsByUser[selectedSessionUser.user_id] ?? []).length === 0
                                        }
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 disabled:opacity-50"
                                    >
                                        <LogOut className="w-4 h-4" />
                                        {terminatingUser === selectedSessionUser.user_id
                                            ? 'Terminating…'
                                            : 'Terminate All'}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Create User Modal */}
            {showCreateUser && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="rounded-xl shadow-2xl w-full max-w-lg bg-white overflow-hidden">
                        <div
                            className="px-6 py-4 border-b border-gray-200 flex justify-between items-center"
                            style={{ backgroundColor: 'var(--sidebar-bg)' }}
                        >
                            <div className="flex items-center gap-2">
                                <UserPlus className="w-5 h-5 text-white" />
                                <h3 className="text-base font-bold text-white">Onboard New User</h3>
                            </div>
                            <button
                                onClick={() => {
                                    setShowCreateUser(false);
                                    setCreatedUser(null);
                                }}
                                className="text-white/70 hover:text-white"
                            >
                                <XCircle className="w-5 h-5" />
                            </button>
                        </div>

                        {createdUser ? (
                            <div className="p-6 space-y-4">
                                <div className="flex items-center gap-2 text-green-700 font-semibold">
                                    <CheckCircle className="w-5 h-5" />
                                    <span>User created successfully!</span>
                                </div>
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                                    <p className="text-sm text-amber-800 font-medium">
                                        ⚠ Distribute this temporary password to the user securely. They must
                                        change it on first login.
                                    </p>
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">Username</p>
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm bg-white border border-gray-200 rounded px-3 py-1.5 flex-1">
                                                {createdUser.username}
                                            </p>
                                            <button
                                                onClick={handleCopyUsername}
                                                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md font-medium"
                                                style={{
                                                    backgroundColor: copyUsernameSuccess
                                                        ? '#16a34a'
                                                        : 'var(--sidebar-bg)',
                                                    color: 'white',
                                                }}
                                            >
                                                <Copy className="w-4 h-4" />
                                                {copyUsernameSuccess ? 'Copied!' : 'Copy'}
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">Temporary Password</p>
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm bg-white border border-gray-200 rounded px-3 py-1.5 flex-1 tracking-widest">
                                                {showTempPassword
                                                    ? createdUser.temporary_password
                                                    : '••••••••••••••'}
                                            </p>
                                            <button
                                                onClick={() => setShowTempPassword(!showTempPassword)}
                                                className="p-2 text-gray-500 hover:text-gray-700"
                                            >
                                                {showTempPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                            <button
                                                onClick={handleCopyPassword}
                                                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md font-medium"
                                                style={{
                                                    backgroundColor: copySuccess ? '#16a34a' : 'var(--sidebar-bg)',
                                                    color: 'white',
                                                }}
                                            >
                                                <Copy className="w-4 h-4" />
                                                {copySuccess ? 'Copied!' : 'Copy'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => {
                                        setShowCreateUser(false);
                                        setCreatedUser(null);
                                        setShowTempPassword(false);
                                    }}
                                    className="w-full py-2 rounded-md text-white font-medium"
                                    style={{ backgroundColor: 'var(--sidebar-bg)' }}
                                >
                                    Done
                                </button>
                            </div>
                        ) : (
                            <div className="p-6 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-1">
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                            First Name <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={createForm.first_name}
                                            onChange={(e) => setCreateForm((p) => ({ ...p, first_name: e.target.value }))}
                                            placeholder="First Name"
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                        />
                                    </div>
                                    <div className="col-span-1">
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                            Last Name <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={createForm.last_name}
                                            onChange={(e) => setCreateForm((p) => ({ ...p, last_name: e.target.value }))}
                                            placeholder="Last Name"
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                            Email Address <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="email"
                                            value={createForm.email}
                                            onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
                                            placeholder="juan@bfp.gov.ph"
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                            Username <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={createForm.username}
                                            onChange={(e) => setCreateForm((p) => ({ ...p, username: e.target.value }))}
                                            placeholder="e.g. encoder_juan"
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                        />
                                        <p className="text-xs text-gray-400 mt-1">
                                            3–50 characters: letters, numbers, underscores, hyphens. Used to log in
                                            via Keycloak.
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                            Role <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            value={createForm.role}
                                            onChange={(e) => setCreateForm((p) => ({ ...p, role: e.target.value }))}
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                        >
                                            <option value="REGIONAL_ENCODER">Regional Encoder</option>
                                            <option value="NATIONAL_VALIDATOR">National Validator</option>
                                            <option value="NATIONAL_ANALYST">National Analyst</option>
                                        </select>
                                    </div>
                                    {createForm.role === 'REGIONAL_ENCODER' && (
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                                Assigned Region <span className="text-red-500">*</span>
                                            </label>
                                            <select
                                                value={createForm.assigned_region_id}
                                                onChange={(e) =>
                                                    setCreateForm((p) => ({ ...p, assigned_region_id: e.target.value }))
                                                }
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
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                            Contact Number
                                        </label>
                                        <input
                                            type="tel"
                                            value={createForm.contact_number}
                                            onChange={(e) =>
                                                setCreateForm((p) => ({ ...p, contact_number: e.target.value }))
                                            }
                                            placeholder="e.g. 09171234567"
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                        />
                                    </div>
                                </div>
                                <p className="text-xs text-gray-500">
                                    A temporary password will be automatically generated and shown to you after
                                    creation. The user will be required to change it on first login.
                                </p>
                                <div className="flex gap-3 pt-2">
                                    <button
                                        onClick={handleCreateUser}
                                        disabled={
                                            isCreating ||
                                            !createForm.email ||
                                            !createForm.first_name ||
                                            !createForm.last_name ||
                                            !createForm.username
                                        }
                                        className="flex-1 py-2.5 rounded-lg text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                                        style={{ backgroundColor: 'var(--sidebar-bg)' }}
                                    >
                                        {isCreating ? (
                                            <>
                                                <RefreshCw className="w-4 h-4 animate-spin" /> Creating…
                                            </>
                                        ) : (
                                            <>
                                                <UserPlus className="w-4 h-4" /> Create User
                                            </>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowCreateUser(false);
                                            setCreatedUser(null);
                                        }}
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

            {/* Create Scheduled Report Modal */}
            {showCreateReport && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="rounded-xl shadow-2xl w-full max-w-lg bg-white overflow-hidden">
                        <div
                            className="px-6 py-4 border-b border-gray-200 flex justify-between items-center"
                            style={{ backgroundColor: 'var(--sidebar-bg)' }}
                        >
                            <div className="flex items-center gap-2">
                                <Clock className="w-5 h-5 text-white" />
                                <h3 className="text-base font-bold text-white">New Scheduled Report</h3>
                            </div>
                            <button
                                onClick={() => {
                                    setShowCreateReport(false);
                                    setReportError(null);
                                }}
                                className="text-white/70 hover:text-white"
                            >
                                <XCircle className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                    Report Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={createReportForm.name}
                                    onChange={(e) =>
                                        setCreateReportForm((p) => ({ ...p, name: e.target.value }))
                                    }
                                    placeholder="e.g. Weekly Incident Summary"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                    Cron Expression <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={createReportForm.cron_expr}
                                    onChange={(e) =>
                                        setCreateReportForm((p) => ({ ...p, cron_expr: e.target.value }))
                                    }
                                    placeholder="0 8 * * 1"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 font-mono"
                                />
                                <p className="text-xs text-gray-400 mt-1">Standard cron format</p>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                    Format
                                </label>
                                <select
                                    value={createReportForm.format}
                                    onChange={(e) =>
                                        setCreateReportForm((p) => ({ ...p, format: e.target.value }))
                                    }
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                >
                                    <option value="pdf">PDF</option>
                                    <option value="excel">Excel</option>
                                    <option value="csv">CSV</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                    Recipients
                                </label>
                                <input
                                    type="text"
                                    value={createReportForm.recipients}
                                    onChange={(e) =>
                                        setCreateReportForm((p) => ({ ...p, recipients: e.target.value }))
                                    }
                                    placeholder="Comma-separated email addresses"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                />
                                <p className="text-xs text-gray-400 mt-1">Comma-separated email addresses</p>
                            </div>
                            {reportError && <p className="text-sm text-red-600">{reportError}</p>}
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={handleCreateReport}
                                    disabled={
                                        creatingReport ||
                                        !createReportForm.name.trim() ||
                                        !createReportForm.cron_expr.trim()
                                    }
                                    className="flex-1 py-2.5 rounded-lg text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                                    style={{ backgroundColor: 'var(--sidebar-bg)' }}
                                >
                                    {creatingReport ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 animate-spin" /> Creating…
                                        </>
                                    ) : (
                                        <>
                                            <Clock className="w-4 h-4" /> Create
                                        </>
                                    )}
                                </button>
                                <button
                                    onClick={() => {
                                        setShowCreateReport(false);
                                        setReportError(null);
                                    }}
                                    className="px-5 py-2.5 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function UserRow({
    user,
    onUpdate,
    sessionCount,
    onViewSessions,
    regions,
}: {
    user: AdminUser;
    onUpdate: (
        id: string,
        p: { role?: string; assigned_region_id?: number; is_active?: boolean }
    ) => void;
    sessionCount: number;
    onViewSessions: () => void;
    regions: Region[];
}) {
    const [expanded, setExpanded] = useState(false);
    const [editRole, setEditRole] = useState(user.role);
    const [editRegion, setEditRegion] = useState(user.assigned_region_id?.toString() ?? '');
    const [editActive, setEditActive] = useState(user.is_active);
    const hasChanges =
        editRole !== user.role ||
        editRegion !== (user.assigned_region_id?.toString() ?? '') ||
        editActive !== user.is_active;

    const handleSave = () => {
        if (!hasChanges) return;
        onUpdate(user.user_id, {
            role: editRole,
            assigned_region_id: editRegion ? parseInt(editRegion, 10) : undefined,
            is_active: editActive,
        });
        setExpanded(false);
    };

    useEffect(() => {
        if (!expanded) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setEditRole(user.role);
                setEditRegion(user.assigned_region_id?.toString() ?? '');
                setEditActive(user.is_active);
                setExpanded(false);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [expanded, user]);

    const ROLES = [
        'CIVILIAN_REPORTER',
        'REGIONAL_ENCODER',
        'NATIONAL_VALIDATOR',
        'NATIONAL_ANALYST',
        'SYSTEM_ADMIN',
    ];
    const ROLE_LABELS: Record<string, string> = {
        CIVILIAN_REPORTER: 'Civilian Reporter',
        REGIONAL_ENCODER: 'Regional Encoder',
        NATIONAL_VALIDATOR: 'National Validator',
        NATIONAL_ANALYST: 'National Analyst',
        SYSTEM_ADMIN: 'System Admin',
    };

    return (
        <>
            <tr
                className="hover:bg-gray-50"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.currentTarget.querySelector<HTMLButtonElement>('button')?.click();
                    }
                }}
            >
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {user.username}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {ROLE_LABELS[user.role] ?? user.role}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {user.assigned_region_id ?? '—'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                    {user.is_active ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                        <XCircle className="w-5 h-5 text-red-500" />
                    )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {user.created_at
                        ? new Date(user.created_at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })
                        : '—'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                    <button
                        onClick={onViewSessions}
                        className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
                    >
                        <Monitor className="w-4 h-4" />
                        {sessionCount > 0 ? (
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                                {sessionCount}
                            </span>
                        ) : (
                            <span className="text-gray-400">0</span>
                        )}
                    </button>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1 ml-auto"
                    >
                        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}{' '}
                        Edit
                    </button>
                </td>
            </tr>
            {expanded && (
                <tr className="bg-gray-50">
                    <td colSpan={7} className="px-6 py-4">
                        <div className="flex flex-wrap gap-4 items-end">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                                <select
                                    value={editRole}
                                    onChange={(e) => setEditRole(e.target.value)}
                                    className="border border-gray-300 rounded px-3 py-1.5 text-sm"
                                >
                                    {ROLES.map((r) => (
                                        <option key={r} value={r}>
                                            {ROLE_LABELS[r] ?? r}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Region ID</label>
                                <select
                                    value={editRegion}
                                    onChange={(e) => setEditRegion(e.target.value)}
                                    className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40"
                                >
                                    <option value="">— No Region —</option>
                                    {regions.map((r) => (
                                        <option key={r.region_id} value={r.region_id}>
                                            {r.region_name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id={`active-${user.user_id}`}
                                    checked={editActive}
                                    onChange={(e) => setEditActive(e.target.checked)}
                                />
                                <label htmlFor={`active-${user.user_id}`} className="text-sm text-gray-700">
                                    Active
                                </label>
                            </div>
                            <button
                                onClick={handleSave}
                                disabled={!hasChanges}
                                className="px-4 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                            >
                                Save
                            </button>
                            <button
                                onClick={() => {
                                    setEditRole(user.role);
                                    setEditRegion(user.assigned_region_id?.toString() ?? '');
                                    setEditActive(user.is_active);
                                    setExpanded(false);
                                }}
                                className="px-4 py-2 bg-gray-200 text-gray-800 rounded text-sm font-medium hover:bg-gray-300"
                            >
                                Cancel
                            </button>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}