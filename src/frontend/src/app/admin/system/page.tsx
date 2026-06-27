'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
    fetchAdminUsers,
    updateAdminUser,
    createAdminUser,
    fetchAdminSecurityLogs,
    updateAdminSecurityLog,
    createIncidentFromAlert,
    fetchAuditLogsOfflineAware,
    fetchRelatedAuditLogs,
    analyzeSecurityLog,
    fetchRegionsOfflineAware,
    fetchUserSessions,
    terminateUserSessions,
    KeycloakSession,
    RelatedAuditItem,
    fetchActiveSessionsOfflineAware,
    revokeUserSessions,
    fetchSystemHealthOfflineAware,
    fetchSystemMetricsOfflineAware,
    fetchWorkerStatusOfflineAware,
    fetchScheduledReports,
    createScheduledReport,
    updateScheduledReport,
    deleteScheduledReport,
    pruneWorkers,
    ScheduledReport,
    WorkerStatusPaginatedResponse,
    fetchFailedSyncOps,
    retrySyncOp,
    deleteSyncOp,
    FailedSyncOp,
    BackupFile,
    listBackups,
} from '@/lib/api';
import { useNetworkStatus } from '@/lib/useNetworkStatus';
import { getConnectivitySnapshot, subscribeConnectivity, probeConnectivity } from '@/lib/connectivity';
import { resetFailedOp, deleteOfflineOp } from '@/lib/offlineStore';
import { normalizeNarrative } from '@/lib/xaiNarrativeNormalizer';
import { ActiveSession, Region } from '@/types/api';
import ReportFilterBuilder from '@/components/admin/ReportFilterBuilder';
import {
    AlertTriangle,
    BarChart3,
    Users,
    ShieldAlert,
    FileText,
    RefreshCw,
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
    Search,
    Clock,
    Calendar,
    Mail,
    Plus,
    Trash2,
    ToggleLeft,
    ToggleRight,
    ArrowRight,
    Bookmark,
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
    hitl_decision?: { action?: string; note?: string | null; reviewed_at?: string | null; reviewed_by?: string | null } | null;
}

const HITL_ACTION_LABELS: Record<string, string> = {
    CONFIRM_THREAT: 'Confirmed Threat',
    FALSE_POSITIVE: 'False Positive',
    REQUEST_MORE_INFO: 'More Info Requested',
};

function formatHitlAction(action: string): string {
    return HITL_ACTION_LABELS[action] ?? action.replaceAll('_', ' ').toLowerCase();
}

function hitlErrorMessage(error: unknown): string {
    const message = (error as { message?: string })?.message ?? 'Request failed';
    if (/Request failed:\s*500/i.test(message)) {
        return 'Server failed while applying the threat decision. The alert was not updated; please retry or check backend logs.';
    }
    return message;
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

interface SystemMetrics {
    cpu_percent: number;
    memory: { total_mb: number; used_mb: number; percent: number };
    disk: { total_gb: number; used_gb: number; percent: number };
    ai_inference: { avg_latency_ms: number | null; count: number } | null;
    network: { bytes_sent: number; bytes_recv: number } | null;
}

interface WorkerStatus {
    worker_id: string;
    hostname: string;
    last_seen: string | null;
    active_tasks: number;
    status: string;
}

interface PruneResult {
    status: string;
    deleted_count: number;
    retention_days: number;
    message: string;
}

const GOVERNANCE_ROLES = ['REGIONAL_ENCODER', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST', 'SYSTEM_ADMIN'];

function formatLastCheckedAgo(checkedAt: Date | null): string | null {
    if (!checkedAt) return null;
    const seconds = Math.max(0, Math.floor((Date.now() - checkedAt.getTime()) / 1000));
    if (seconds < 60) return `${seconds} sec ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours} hr ago`;
}

function getComponentStatusColor(status: string): string {
    switch (status) {
        case 'HEALTHY': return 'bg-green-500';
        case 'QUIET': return 'bg-blue-500';
        case 'FRESH': return 'bg-slate-400';
        case 'DEGRADED': return 'bg-amber-500';
        case 'UNHEALTHY': return 'bg-red-500';
        default: return 'bg-gray-400';
    }
}

function getComponentStatusTextColor(status: string): string {
    switch (status) {
        case 'HEALTHY': return 'text-green-700';
        case 'QUIET': return 'text-blue-700';
        case 'FRESH': return 'text-slate-600';
        case 'DEGRADED': return 'text-amber-700';
        case 'UNHEALTHY': return 'text-red-700';
        default: return 'text-gray-600';
    }
}

function getOverallBadgeColor(status: string): string {
    switch (status) {
        case 'HEALTHY': return 'bg-green-600';
        case 'DEGRADED': return 'bg-amber-600';
        default: return 'bg-red-600';
    }
}

export default function AdminSystemPage() {
    const router = useRouter();
    const { user, loading } = useAuth();
    const role = (user as { role?: string })?.role ?? null;
    const networkStatus = useNetworkStatus();
    const [connectivitySnapshot, setConnectivitySnapshot] = useState(getConnectivitySnapshot);

    const [users, setUsers] = useState<AdminUser[]>([]);
    const [securityLogs, setSecurityLogs] = useState<SecurityLog[]>([]);
    const [auditLogs, setAuditLogs] = useState<{ items: AuditItem[]; total: number }>({ items: [], total: 0 });
    const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
    const [health, setHealth] = useState<{ status: string; components: Record<string, { status: string; latency_ms: number; detail?: string; error?: string }> } | null>(null);
    const [healthLastChecked, setHealthLastChecked] = useState<Date | null>(null);
    const [healthFromCache, setHealthFromCache] = useState(false);
    const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
    const [workers, setWorkers] = useState<WorkerStatus[]>([]);
    const [workersTotal, setWorkersTotal] = useState(0);
    const [workersPage, setWorkersPage] = useState(0);
    const [workersPageSize, setWorkersPageSize] = useState(20);
    const [pruningWorkers, setPruningWorkers] = useState(false);
    const [pruneResult, setPruneResult] = useState<PruneResult | null>(null);
    const [confirmPruneWorkers, setConfirmPruneWorkers] = useState(false);
    const [monitoringLastChecked, setMonitoringLastChecked] = useState<Date | null>(null);
    const [monitoringFromCache, setMonitoringFromCache] = useState(false);
    const [sessionsLastChecked, setSessionsLastChecked] = useState<Date | null>(null);
    const [sessionsFromCache, setSessionsFromCache] = useState(false);
    const [securitySearchQ, setSecuritySearchQ] = useState('');

    // Threat Telemetry filter & pagination state (#348)
    const [telemetryPage, setTelemetryPage] = useState(0);
    const [telemetryTotal, setTelemetryTotal] = useState(0);
    const [telemetrySeverities, setTelemetrySeverities] = useState<Set<string>>(new Set());
    const [telemetrySourceIp, setTelemetrySourceIp] = useState('');
    const [telemetryDateFrom, setTelemetryDateFrom] = useState('');
    const [telemetryDateTo, setTelemetryDateTo] = useState('');
    const [telemetryError, setTelemetryError] = useState<string | null>(null);

    const TELEMETRY_PAGE_SIZE = 20;
    const securitySearchQRef = React.useRef(securitySearchQ);
    securitySearchQRef.current = securitySearchQ;

    const [loadingUsers, setLoadingUsers] = useState(false);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [loadingHighlights, setLoadingHighlights] = useState(false);
    const [loadingSessions, setLoadingSessions] = useState(false);
    const [loadingMonitoring, setLoadingMonitoring] = useState(true);

    // Page-level toast for replacing native alert()/confirm() (#359)
    const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [confirmDeleteReportId, setConfirmDeleteReportId] = useState<number | null>(null);
    const [regions, setRegions] = useState<Region[]>([]);
    const [selectedLog, setSelectedLog] = useState<SecurityLog | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [analyzingLogId, setAnalyzingLogId] = useState<number | null>(null);
    const [isRevoking, setIsRevoking] = useState<string | null>(null);

    // HITL / alert-action inline message state (issue #349/#350)
    const [hitlMessage, setHitlMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [createIncidentResult, setCreateIncidentResult] = useState<{ incident_id: number } | null>(null);

    // Related evidence panel state (issue #349)
    const [relatedEvidence, setRelatedEvidence] = useState<RelatedAuditItem[] | null>(null);
    const [loadingRelatedEvidence, setLoadingRelatedEvidence] = useState(false);
    const [relatedEvidenceError, setRelatedEvidenceError] = useState<string | null>(null);

    // Sessions state
    const [sessionsByUser, setSessionsByUser] = useState<Record<string, KeycloakSession[]>>({});
    const [selectedSessionUser, setSelectedSessionUser] = useState<AdminUser | null>(null);
    const [terminatingUser, setTerminatingUser] = useState<string | null>(null);
    const [loadingSessionUser, setLoadingSessionUser] = useState(false);
    const [sessionUserError, setSessionUserError] = useState<string | null>(null);

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
    const [createdUser, setCreatedUser] = useState<{ username: string; temporary_password: string; note?: string } | null>(null);
    const [showTempPassword, setShowTempPassword] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);

    // Scheduled Reports state (Issue #88 / #353)
    const [scheduledReports, setScheduledReports] = useState<ScheduledReport[]>([]);
    const [loadingReports, setLoadingReports] = useState(false);
    const [showCreateReport, setShowCreateReport] = useState(false);
    const [newReport, setNewReport] = useState({
        name: '',
        cron_expr: '0 7 * * 1',
        format: 'pdf' as 'pdf' | 'excel' | 'csv',
        filters: {} as Record<string, unknown>,
        recipients: '',
        enabled: true,
    });
    const [filterErrors, setFilterErrors] = useState<Record<string, string>>({});
    const [creatingReport, setCreatingReport] = useState(false);
    const [togglingReportId, setTogglingReportId] = useState<number | null>(null);
    const [deletingReportId, setDeletingReportId] = useState<number | null>(null);

    // Identity Governance filters & pagination (#346)
    const [governanceQuery, setGovernanceQuery] = useState('');
    const [governanceRoleFilter, setGovernanceRoleFilter] = useState('');
    const [governanceRegionFilter, setGovernanceRegionFilter] = useState('');
    const [governanceActiveFilter, setGovernanceActiveFilter] = useState('');
    const [governancePage, setGovernancePage] = useState(1);
    const [governancePageSize, setGovernancePageSize] = useState(10);

    // Active Sessions filter & pagination (#347)
    const [sessionsQuery, setSessionsQuery] = useState('');
    const [sessionsPage, setSessionsPage] = useState(1);
    const [sessionsPageSize, setSessionsPageSize] = useState(10);

    // Edit User modal state (#346)
    const [editUserModal, setEditUserModal] = useState<AdminUser | null>(null);
    const [editRole, setEditRole] = useState('');
    const [editRegionId, setEditRegionId] = useState('');
    const [editActive, setEditActive] = useState(false);
    const [savingUser, setSavingUser] = useState(false);

    // Failed Syncs state (Issue #141)
    const [failedSyncs, setFailedSyncs] = useState<FailedSyncOp[]>([]);
    const [loadingFailedSyncs, setLoadingFailedSyncs] = useState(false);
    const [retryingOpId, setRetryingOpId] = useState<string | null>(null);
    const [deletingOpId, setDeletingOpId] = useState<string | null>(null);

    // Backup Manager state (GAP-A01/A02)
    const [backups, setBackups] = useState<BackupFile[]>([]);
    const [loadingBackups, setLoadingBackups] = useState(false);
    const [backupError, setBackupError] = useState<string | null>(null);

    // Client-side filtered & paginated users (#346)
    const filteredUsers = useMemo(() => {
        return users.filter((u) => {
            if (governanceQuery && !u.username.toLowerCase().includes(governanceQuery.toLowerCase())) return false;
            if (governanceRoleFilter && u.role !== governanceRoleFilter) return false;
            if (governanceRegionFilter && u.assigned_region_id !== parseInt(governanceRegionFilter, 10)) return false;
            if (governanceActiveFilter === 'active' && !u.is_active) return false;
            if (governanceActiveFilter === 'inactive' && u.is_active) return false;
            return true;
        });
    }, [users, governanceQuery, governanceRoleFilter, governanceRegionFilter, governanceActiveFilter]);

    const paginatedUsers = useMemo(() => {
        const start = (governancePage - 1) * governancePageSize;
        return filteredUsers.slice(start, start + governancePageSize);
    }, [filteredUsers, governancePage, governancePageSize]);

    const totalGovernancePages = Math.max(1, Math.ceil(filteredUsers.length / governancePageSize));

    // Client-side filtered & paginated sessions (#347)
    const filteredSessions = useMemo(() => {
        if (!sessionsQuery) return activeSessions;
        const q = sessionsQuery.toLowerCase();
        return activeSessions.filter((s) => s.username.toLowerCase().includes(q));
    }, [activeSessions, sessionsQuery]);

    const paginatedSessions = useMemo(() => {
        const start = (sessionsPage - 1) * sessionsPageSize;
        return filteredSessions.slice(start, start + sessionsPageSize);
    }, [filteredSessions, sessionsPage, sessionsPageSize]);

    const totalSessionsPages = Math.max(1, Math.ceil(filteredSessions.length / sessionsPageSize));

    // Reset pagination when filters change
    const prevGovFiltersRef = React.useRef({ q: '', role: '', region: '', active: '' });
    useEffect(() => {
        const curr = { q: governanceQuery, role: governanceRoleFilter, region: governanceRegionFilter, active: governanceActiveFilter };
        if (
            curr.q !== prevGovFiltersRef.current.q ||
            curr.role !== prevGovFiltersRef.current.role ||
            curr.region !== prevGovFiltersRef.current.region ||
            curr.active !== prevGovFiltersRef.current.active
        ) {
            setGovernancePage(1);
        }
        prevGovFiltersRef.current = curr;
    }, [governanceQuery, governanceRoleFilter, governanceRegionFilter, governanceActiveFilter]);

    useEffect(() => {
        if (!loading && role !== 'SYSTEM_ADMIN') {
            router.replace('/dashboard');
        }
    }, [loading, role, router]);

    // Subscribe to connectivity snapshot so the offline banner reflects
    // health-probe results (backend unreachable) in addition to navigator.onLine.
    useEffect(() => {
        setConnectivitySnapshot(getConnectivitySnapshot());
        const unsubscribe = subscribeConnectivity(() => {
            setConnectivitySnapshot(getConnectivitySnapshot());
        });
        // Kick off a probe on mount so state transitions out of 'checking'.
        probeConnectivity();
        return unsubscribe;
    }, []);

    const loadHealth = useCallback(async () => {
        try {
            const { response, fromCache, cachedAt } = await fetchSystemHealthOfflineAware();
            setHealth(response);
            setHealthFromCache(fromCache);
            setHealthLastChecked(cachedAt ? new Date(cachedAt) : new Date());
        } catch {
            setHealth({ status: 'ERROR', components: {} });
        }
    }, []);

    const loadFailedSyncs = useCallback(async () => {
        setLoadingFailedSyncs(true);
        try {
            const data = await fetchFailedSyncOps();
            setFailedSyncs(data.items);
        } catch {
            setFailedSyncs([]);
        } finally {
            setLoadingFailedSyncs(false);
        }
    }, []);

    const handleRetrySyncOp = async (opId: string) => {
        setRetryingOpId(opId);
        try {
            await retrySyncOp(opId);
            // Reset the local IndexedDB op to 'pending' when it exists in this browser.
            // Cross-browser admin retry still clears the backend queue; the encoder's
            // originating browser owns its own local IndexedDB retry state.
            await resetFailedOp(opId);
            setFailedSyncs((prev) => prev.filter((op) => op.localId !== opId));
        } catch (e: unknown) {
            alert((e as { message?: string })?.message ?? 'Failed to retry sync op');
        } finally {
            setRetryingOpId(null);
        }
    };

    const handleDeleteSyncOp = async (opId: string) => {
        if (!confirm('Delete this failed sync op? This cannot be undone.')) return;
        setDeletingOpId(opId);
        try {
            await deleteSyncOp(opId);
            // Remove from IndexedDB so it doesn't linger in the offline store
            await deleteOfflineOp(opId);
            setFailedSyncs((prev) => prev.filter((op) => op.localId !== opId));
        } catch (e: unknown) {
            alert((e as { message?: string })?.message ?? 'Failed to delete sync op');
        } finally {
            setDeletingOpId(null);
        }
    };

    const loadMonitoring = useCallback(async () => {
        setLoadingMonitoring(true);
        const [metricsRes, workersRes] = await Promise.allSettled([
            fetchSystemMetricsOfflineAware(),
            fetchWorkerStatusOfflineAware({ limit: workersPageSize, offset: workersPage * workersPageSize }),
        ]);

        let fromCache = false;
        let cachedAt: number | undefined;

        if (metricsRes.status === 'fulfilled') {
            setSystemMetrics(metricsRes.value.response as SystemMetrics);
            fromCache = fromCache || metricsRes.value.fromCache;
            cachedAt = metricsRes.value.cachedAt ?? cachedAt;
        }

        if (workersRes.status === 'fulfilled') {
            const data = workersRes.value.response as WorkerStatusPaginatedResponse;
            setWorkers(data.items ?? []);
            setWorkersTotal(data.total ?? 0);
            fromCache = fromCache || workersRes.value.fromCache;
            cachedAt = workersRes.value.cachedAt ?? cachedAt;
        }

        setMonitoringFromCache(fromCache);
        setMonitoringLastChecked(cachedAt ? new Date(cachedAt) : new Date());
        setLoadingMonitoring(false);

        await loadHealth();
    }, [loadHealth, workersPage, workersPageSize]);

    useEffect(() => {
        if (role === 'SYSTEM_ADMIN') {
            loadUsers();
            loadSecurityLogs();
            loadHighlightAudit();
            loadRegions();
            loadSessions();
            loadScheduledReports();
            loadFailedSyncs();
            loadBackupSummary();
        }
    }, [role]);

    // M9a: 60s grouped auto-refresh (health + system metrics + workers)
    useEffect(() => {
        if (role !== 'SYSTEM_ADMIN') return;
        loadMonitoring();
        const intervalId = setInterval(loadMonitoring, 60 * 1000);
        return () => clearInterval(intervalId);
    }, [role, loadMonitoring]);

    const loadSessions = async () => {
        setLoadingSessions(true);
        try {
            const { response, fromCache, cachedAt } = await fetchActiveSessionsOfflineAware();
            setActiveSessions(response as ActiveSession[]);
            setSessionsFromCache(fromCache);
            setSessionsLastChecked(cachedAt ? new Date(cachedAt) : new Date());
        } catch {
            setActiveSessions([]);
        } finally {
            setLoadingSessions(false);
        }
    };

    const loadRegions = async () => {
        try {
            if (!user?.id) return;
            const { response } = await fetchRegionsOfflineAware(user.id);
            setRegions(response as Region[]);
        } catch {
            setRegions([]);
        }
    };

    const loadBackupSummary = useCallback(async () => {
        setLoadingBackups(true);
        setBackupError(null);
        try {
            const data = await listBackups();
            setBackups(data);
        } catch (err) {
            setBackupError((err as { message?: string })?.message ?? 'Failed to load backups');
            setBackups([]);
        } finally {
            setLoadingBackups(false);
        }
    }, []);

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

    const validateReportFilters = (f: Record<string, unknown>): Record<string, string> => {
        const errs: Record<string, string> = {};
        if (f.region_id !== undefined && f.region_id !== null) {
            if (typeof f.region_id !== 'number' || !Number.isFinite(f.region_id) || f.region_id <= 0) {
                errs.region_id = 'Must be a valid region ID.';
            }
        }
        if (f.severity !== undefined && f.severity !== null && f.severity !== '') {
            const valid = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
            if (typeof f.severity !== 'string' || !valid.includes(f.severity)) {
                errs.severity = `Must be one of: ${valid.join(', ')}.`;
            }
        }
        if (f.start_date && f.end_date) {
            if (typeof f.start_date === 'string' && typeof f.end_date === 'string') {
                if (f.start_date > f.end_date) {
                    errs.end_date = 'End date must be on or after start date.';
                }
            }
        }
        return errs;
    };

    const handleCreateReport = async () => {
        if (!newReport.name.trim() || !newReport.cron_expr.trim()) {
            setToast({ type: 'error', text: 'Name and cron expression are required.' });
            return;
        }

        // Validate filters before save
        const fErrs = validateReportFilters(newReport.filters);
        setFilterErrors(fErrs);
        if (Object.keys(fErrs).length > 0) {
            setToast({ type: 'error', text: 'Please fix filter errors before saving.' });
            return;
        }

        setCreatingReport(true);
        try {
            const recipients = newReport.recipients
                .split(',')
                .map((e) => e.trim())
                .filter((e) => e.length > 0);
            // Send structured filters object directly (no more JSON.parse)
            await createScheduledReport({
                name: newReport.name.trim(),
                cron_expr: newReport.cron_expr.trim(),
                format: newReport.format,
                filters: { ...newReport.filters },
                recipients,
                enabled: newReport.enabled,
            });
            setShowCreateReport(false);
            setNewReport({ name: '', cron_expr: '0 7 * * 1', format: 'pdf', filters: {}, recipients: '', enabled: true });
            setFilterErrors({});
            setToast({ type: 'success', text: 'Scheduled report created.' });
            await loadScheduledReports();
        } catch (e: unknown) {
            setToast({ type: 'error', text: (e as { message?: string })?.message ?? 'Failed to create report' });
        } finally {
            setCreatingReport(false);
        }
    };

    const handleToggleReport = async (report: ScheduledReport) => {
        setTogglingReportId(report.id);
        try {
            await updateScheduledReport(report.id, { enabled: !report.enabled });
            await loadScheduledReports();
            setToast({ type: 'success', text: `Report ${report.enabled ? 'disabled' : 'enabled'}.` });
        } catch (e: unknown) {
            setToast({ type: 'error', text: (e as { message?: string })?.message ?? 'Failed to toggle report' });
        } finally {
            setTogglingReportId(null);
        }
    };

    const handleDeleteReport = async (reportId: number) => {
        setConfirmDeleteReportId(reportId);
    };

    const executeDeleteReport = async () => {
        if (confirmDeleteReportId === null) return;
        const reportId = confirmDeleteReportId;
        setConfirmDeleteReportId(null);
        setDeletingReportId(reportId);
        try {
            await deleteScheduledReport(reportId);
            await loadScheduledReports();
            setToast({ type: 'success', text: 'Scheduled report deleted.' });
        } catch (e: unknown) {
            setToast({ type: 'error', text: (e as { message?: string })?.message ?? 'Failed to delete report' });
        } finally {
            setDeletingReportId(null);
        }
    };

    const loadUsers = async (): Promise<AdminUser[]> => {
        setLoadingUsers(true);
        try {
            const data = await fetchAdminUsers();
            setUsers(data as AdminUser[]);
            return data as AdminUser[];
        } catch {
            setUsers([]);
            return [];
        } finally {
            setLoadingUsers(false);
        }
    };

    // Lazy-load per-user sessions only when modal is opened (#359 N+1 fix)
    useEffect(() => {
        if (!selectedSessionUser) return;
        if (sessionsByUser[selectedSessionUser.user_id] !== undefined) return;
        let cancelled = false;
        const fetchSessions = async () => {
            setLoadingSessionUser(true);
            setSessionUserError(null);
            try {
                const res = await fetchUserSessions(selectedSessionUser.user_id);
                if (!cancelled) {
                    setSessionsByUser((prev) => ({
                        ...prev,
                        [selectedSessionUser.user_id]: res.sessions ?? [],
                    }));
                }
            } catch {
                if (!cancelled) {
                    setSessionsByUser((prev) => ({
                        ...prev,
                        [selectedSessionUser.user_id]: [],
                    }));
                    setSessionUserError('Failed to load sessions for this user.');
                }
            } finally {
                if (!cancelled) setLoadingSessionUser(false);
            }
        };
        fetchSessions();
        return () => { cancelled = true; };
    }, [selectedSessionUser, sessionsByUser]);

    const handleTerminateSessions = async (u: AdminUser) => {
        setTerminatingUser(u.user_id);
        try {
            await terminateUserSessions(u.user_id, 'all');
            setSessionsByUser((prev) => ({ ...prev, [u.user_id]: [] }));
            setSelectedSessionUser(null);
            setToast({ type: 'success', text: `Sessions terminated for ${u.username}.` });
        } catch (e: unknown) {
            setToast({ type: 'error', text: (e as { message?: string })?.message ?? 'Failed to terminate sessions' });
        } finally {
            setTerminatingUser(null);
        }
    };

    const loadSecurityLogs = async () => {
        setLoadingLogs(true);
        setTelemetryError(null);
        try {
            const q = securitySearchQRef.current.trim();
            const params: Record<string, unknown> = {
                limit: TELEMETRY_PAGE_SIZE,
                offset: telemetryPage * TELEMETRY_PAGE_SIZE,
            };
            if (q) params.q = q;
            if (telemetrySeverities.size > 0) params.severity = Array.from(telemetrySeverities).join(',');
            if (telemetrySourceIp.trim()) params.source_ip = telemetrySourceIp.trim();
            if (telemetryDateFrom) params.date_from = telemetryDateFrom;
            if (telemetryDateTo) params.date_to = telemetryDateTo;

            const data = await fetchAdminSecurityLogs(params);
            setSecurityLogs(data.items as SecurityLog[]);
            setTelemetryTotal(data.total);
        } catch {
            setSecurityLogs([]);
            setTelemetryTotal(0);
            setTelemetryError('Failed to load security logs');
        } finally {
            setLoadingLogs(false);
        }
    };

    // Auto-reload when telemetry filters change (#348)
    const prevTelemetryKeyRef = React.useRef('');
    useEffect(() => {
        if (role !== 'SYSTEM_ADMIN') return;
        const key = `${telemetryPage}|${Array.from(telemetrySeverities).sort().join(',')}|${telemetrySourceIp}|${telemetryDateFrom}|${telemetryDateTo}`;
        if (key !== prevTelemetryKeyRef.current) {
            prevTelemetryKeyRef.current = key;
            loadSecurityLogs();
        }
    }, [role, telemetryPage, telemetrySeverities, telemetrySourceIp, telemetryDateFrom, telemetryDateTo]);

    const handleToggleTelemetrySeverity = (sev: string) => {
        setTelemetrySeverities((prev) => {
            const next = new Set(prev);
            if (next.has(sev)) next.delete(sev);
            else next.add(sev);
            return next;
        });
        setTelemetryPage(0);
    };

    const handleClearTelemetryFilters = () => {
        setSecuritySearchQ('');
        setTelemetryPage(0);
        setTelemetrySeverities(new Set());
        setTelemetrySourceIp('');
        setTelemetryDateFrom('');
        setTelemetryDateTo('');
        setTelemetryError(null);
    };

    const loadHighlightAudit = async () => {
        setLoadingHighlights(true);
        try {
            const { response } = await fetchAuditLogsOfflineAware({ limit: 50, offset: 0 });
            setAuditLogs({
                items: response.items.map((item): AuditItem => ({
                    audit_id: item.audit_id,
                    user_id: item.user_id,
                    action_type: item.action_type,
                    table_affected: item.table_affected,
                    record_id: item.record_id,
                    ip_address: item.ip_address,
                    user_agent: item.user_agent,
                    timestamp: item.timestamp,
                })),
                total: response.total,
            });
        } catch {
            setAuditLogs({ items: [], total: 0 });
        } finally {
            setLoadingHighlights(false);
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
            setToast({ type: 'success', text: 'User updated.' });
        } catch (e: unknown) {
            setToast({ type: 'error', text: (e as { message?: string })?.message ?? 'Update failed' });
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
            setToast({ type: 'error', text: 'First name, last name, email, username, and role are required.' });
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
            setCreatedUser({ username: result.username, temporary_password: result.temporary_password, note: result.note });
            setCreateForm({ first_name: '', last_name: '', email: '', username: '', role: 'REGIONAL_ENCODER', contact_number: '', assigned_region_id: '' });
            await loadUsers();
            setToast({ type: 'success', text: `User ${payload.username.trim()} created.` });
        } catch (e: unknown) {
            setToast({ type: 'error', text: (e as { message?: string })?.message ?? 'Failed to create user' });
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

    const handleHitlDecision = async (action: string, note?: string) => {
        if (!selectedLog) return;
        setIsSubmitting(true);
        setHitlMessage(null);
        try {
            await updateAdminSecurityLog(selectedLog.log_id, { action, note });
            const label = formatHitlAction(action);
            setHitlMessage({ type: 'success', text: `${label} applied to alert #${selectedLog.log_id}.` });
            setSelectedLog({
                ...selectedLog,
                admin_action_taken: label,
                resolved_at: action === 'REQUEST_MORE_INFO' ? null : new Date().toISOString(),
                hitl_decision: { action, note: note ?? null },
            });
            await loadSecurityLogs();
        } catch (e: unknown) {
            setHitlMessage({ type: 'error', text: hitlErrorMessage(e) });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCreateIncident = async () => {
        if (!selectedLog) return;
        setIsSubmitting(true);
        setCreateIncidentResult(null);
        setHitlMessage(null);
        try {
            const result = await createIncidentFromAlert(selectedLog.log_id);
            setCreateIncidentResult({ incident_id: result.incident_id });
            setSelectedLog(null);
            await loadSecurityLogs();
        } catch (e: unknown) {
            setHitlMessage({ type: 'error', text: (e as { message?: string })?.message ?? 'Create incident failed' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleViewRelatedEvidence = async () => {
        if (!selectedLog) return;
        setLoadingRelatedEvidence(true);
        setRelatedEvidenceError(null);
        setRelatedEvidence(null);
        try {
            const data = await fetchRelatedAuditLogs(selectedLog.log_id);
            setRelatedEvidence(data.items);
        } catch (e: unknown) {
            setRelatedEvidenceError((e as { message?: string })?.message ?? 'Failed to load related evidence');
        } finally {
            setLoadingRelatedEvidence(false);
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
            setToast({ type: 'error', text: (e as { message?: string })?.message ?? 'Failed to analyze' });
        } finally {
            setAnalyzingLogId(null);
        }
    };

    const handlePruneWorkers = async () => {
        setConfirmPruneWorkers(false);
        setPruningWorkers(true);
        setPruneResult(null);
        try {
            const result = await pruneWorkers();
            setPruneResult(result);
            // Refresh worker list after prune, resetting to first page
            setWorkersPage(0);
            // loadMonitoring will be called via the state change effect
            await loadMonitoring();
        } catch (e: unknown) {
            setToast({ type: 'error', text: (e as { message?: string })?.message ?? 'Failed to prune workers' });
        } finally {
            setPruningWorkers(false);
        }
    };

    const handleRevokeSession = async (userId: string) => {
        setIsRevoking(userId);
        try {
            await revokeUserSessions(userId);
            await loadSessions();
            setToast({ type: 'success', text: 'Session revoked.' });
        } catch (e: unknown) {
            setToast({ type: 'error', text: (e as { message?: string })?.message ?? 'Failed to revoke session' });
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
        : activeSessions.length.toString();

    const systemStats = [
        { label: 'Total Users', value: users.length.toString(), icon: Users },
        { label: 'Active Sessions', value: totalActiveSessions, icon: Monitor },
        { label: 'Celery Workers', value: workersTotal.toString(), icon: BarChart3 },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>System Admin Hub</h1>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Identity governance, threat telemetry, and system audit.</p>
            </div>

            {(!networkStatus.isOnline || connectivitySnapshot.state === 'offline') && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                    {!networkStatus.isOnline
                        ? 'You are offline — showing cached data'
                        : 'Backend unreachable — showing cached data'}
                </div>
            )}

            {/* Page-level toast banner (#359 alert replacement) */}
            {toast && (
                <div
                    className={`rounded-md border px-4 py-3 text-sm font-medium flex items-center gap-2 ${
                        toast.type === 'success'
                            ? 'border-green-200 bg-green-50 text-green-800'
                            : 'border-red-200 bg-red-50 text-red-800'
                    }`}
                    role="alert"
                >
                    {toast.type === 'success' ? (
                        <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    ) : (
                        <XCircle className="w-4 h-4 flex-shrink-0" />
                    )}
                    <span className="flex-1">{toast.text}</span>
                    <button
                        onClick={() => setToast(null)}
                        className="text-current opacity-60 hover:opacity-100"
                        aria-label="Dismiss"
                    >
                        <XCircle className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* Confirmation modal for worker prune */}
            {confirmPruneWorkers && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="rounded-xl shadow-2xl max-w-sm w-full bg-white overflow-hidden">
                        <div className="px-6 py-4">
                            <h3 className="text-base font-bold text-gray-900">Prune OFFLINE Workers?</h3>
                            <p className="text-sm text-gray-600 mt-2">
                                This will permanently remove worker heartbeat records for OFFLINE workers
                                older than the retention threshold (default 7 days). ACTIVE and STALE workers
                                are never affected.
                            </p>
                            <p className="text-xs text-gray-400 mt-2">
                                The action is audit-logged. You can refresh the worker list afterwards.
                            </p>
                        </div>
                        <div className="px-6 py-3 bg-gray-50 flex gap-3 justify-end">
                            <button
                                onClick={() => setConfirmPruneWorkers(false)}
                                className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 font-medium hover:bg-gray-300"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handlePruneWorkers}
                                disabled={pruningWorkers}
                                className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50"
                            >
                                {pruningWorkers ? 'Pruning…' : 'Prune'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirmation modal for report delete (#359 confirm replacement) */}
            {confirmDeleteReportId !== null && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="rounded-xl shadow-2xl max-w-sm w-full bg-white overflow-hidden">
                        <div className="px-6 py-4">
                            <h3 className="text-base font-bold text-gray-900">Delete Scheduled Report?</h3>
                            <p className="text-sm text-gray-600 mt-2">
                                This action cannot be undone. The report schedule will be permanently removed.
                            </p>
                        </div>
                        <div className="px-6 py-3 bg-gray-50 flex gap-3 justify-end">
                            <button
                                onClick={() => setConfirmDeleteReportId(null)}
                                className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 font-medium hover:bg-gray-300"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={executeDeleteReport}
                                disabled={deletingReportId !== null}
                                className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50"
                            >
                                {deletingReportId !== null ? 'Deleting…' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

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

            <section id="monitoring" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>System Health &amp; Monitoring</span>
                        {(monitoringFromCache || healthFromCache) && <span className="text-xs italic text-amber-600">(cached)</span>}
                        {(monitoringFromCache || healthFromCache) && (monitoringLastChecked || healthLastChecked) && (
                            <span className="text-xs text-gray-400">
                                Last checked: {formatLastCheckedAgo(monitoringLastChecked || healthLastChecked)}
                            </span>
                        )}
                        <span className="text-xs text-gray-400">(auto-refreshes every 60s)</span>
                    </div>
                    <button onClick={loadMonitoring} className="flex items-center gap-1 text-sm font-medium hover:opacity-80 transition-opacity" style={{ color: 'var(--bfp-maroon)' }}>
                        <RefreshCw className="w-4 h-4" /> Refresh
                    </button>
                </div>
                <div className="card-body space-y-4">
                    {loadingMonitoring ? (
                        /* Skeleton loading state (#344) */
                        <div className="space-y-4 animate-pulse">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <div key={i} className="p-4 rounded-lg bg-gray-100 h-24" />
                                ))}
                            </div>
                            <div className="space-y-2">
                                <div className="h-4 bg-gray-100 rounded w-32" />
                                <div className="h-10 bg-gray-100 rounded w-full" />
                            </div>
                        </div>
                    ) : (
                        <>
                            {systemMetrics ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                                    <div className="p-4 rounded-lg" style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}>
                                        <div className="text-sm text-gray-500">CPU</div>
                                        <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{systemMetrics.cpu_percent}%</div>
                                        <div className="w-full bg-gray-200 rounded h-2 mt-2">
                                            <div className="bg-blue-500 h-2 rounded" style={{ width: `${systemMetrics.cpu_percent}%` }} />
                                        </div>
                                    </div>
                                    <div className="p-4 rounded-lg" style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}>
                                        <div className="text-sm text-gray-500">Memory</div>
                                        <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{systemMetrics.memory.percent}%</div>
                                        <div className="text-xs text-gray-400">
                                            {systemMetrics.memory.used_mb} / {systemMetrics.memory.total_mb} MB
                                        </div>
                                        <div className="w-full bg-gray-200 rounded h-2 mt-2">
                                            <div className="bg-green-500 h-2 rounded" style={{ width: `${systemMetrics.memory.percent}%` }} />
                                        </div>
                                    </div>
                                    <div className="p-4 rounded-lg" style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}>
                                        <div className="text-sm text-gray-500">Disk</div>
                                        <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{systemMetrics.disk.percent}%</div>
                                        <div className="text-xs text-gray-400">
                                            {systemMetrics.disk.used_gb} / {systemMetrics.disk.total_gb} GB
                                        </div>
                                        <div className="w-full bg-gray-200 rounded h-2 mt-2">
                                            <div className="bg-amber-500 h-2 rounded" style={{ width: `${systemMetrics.disk.percent}%` }} />
                                        </div>
                                    </div>
                                    <div className="p-4 rounded-lg" style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}>
                                        <div className="text-sm text-gray-500">AI Inference</div>
                                        {systemMetrics.ai_inference && systemMetrics.ai_inference.count > 0 ? (
                                            <>
                                                <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                                                    {systemMetrics.ai_inference.avg_latency_ms}ms
                                                </div>
                                                <div className="text-xs text-gray-400">
                                                    avg · {systemMetrics.ai_inference.count} call{systemMetrics.ai_inference.count !== 1 ? 's' : ''}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-sm text-gray-400 mt-1">No calls recorded</div>
                                        )}
                                    </div>
                                    <div className="p-4 rounded-lg" style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}>
                                        <div className="text-sm text-gray-500">Network</div>
                                        {systemMetrics.network ? (
                                            <>
                                                <div className="text-sm font-medium mt-1" style={{ color: 'var(--text-primary)' }}>
                                                    ↑ {(systemMetrics.network.bytes_sent / 1048576).toFixed(1)} MB sent
                                                </div>
                                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    ↓ {(systemMetrics.network.bytes_recv / 1048576).toFixed(1)} MB recv
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-sm text-gray-400 mt-1">N/A</div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sm text-gray-400">System metrics unavailable.</p>
                            )}

                            {/* Health sub-section (consolidated into monitoring, #344) */}
                            {health && (
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Service Health</h3>
                                        <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${getOverallBadgeColor(health.status)}`}>
                                            {health.status}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                                        <div className="p-4 rounded-lg flex items-center justify-between" style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}>
                                            <div className="flex items-center gap-3">
                                                <ShieldAlert className="w-5 h-5 text-gray-500" />
                                                <div>
                                                    <div className="text-sm font-semibold">Suricata IDS</div>
                                                    <div className="text-xs text-gray-500">{health.components.suricata?.latency_ms ?? 0}ms</div>
                                                    {health.components.suricata?.detail && (
                                                        <div className={`text-xs mt-0.5 font-medium ${getComponentStatusTextColor(health.components.suricata?.status ?? '')}`}>
                                                            {health.components.suricata.detail}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <span className={`w-3 h-3 rounded-full ${getComponentStatusColor(health.components.suricata?.status ?? '')}`} />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Celery Workers</h3>
                                    <button
                                        onClick={() => setConfirmPruneWorkers(true)}
                                        disabled={pruningWorkers}
                                        className="flex items-center gap-1 text-xs font-medium px-3 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                                        title="Prune OFFLINE workers older than retention threshold"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                        {pruningWorkers ? 'Pruning…' : 'Prune Old Workers'}
                                    </button>
                                </div>
                                {pruneResult && (
                                    <div
                                        className={`rounded-md border px-3 py-2 text-xs font-medium mb-2 ${
                                            pruneResult.deleted_count > 0
                                                ? 'border-green-200 bg-green-50 text-green-800'
                                                : 'border-gray-200 bg-gray-50 text-gray-600'
                                        }`}
                                    >
                                        {pruneResult.message}
                                    </div>
                                )}
                                {workers.length > 0 ? (
                                    <>
                                        <table className="min-w-full divide-y divide-gray-200">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hostname</th>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Active Tasks</th>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Seen</th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white divide-y divide-gray-200">
                                                {workers.map((w) => (
                                                    <tr key={w.worker_id} className="hover:bg-gray-50">
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{w.hostname}</td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{w.status}</td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{w.active_tasks}</td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                            {w.last_seen ? new Date(w.last_seen).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {/* Pagination controls */}
                                        {workersTotal > 0 && (
                                            <div className="px-1 py-2 flex flex-wrap items-center justify-between gap-2">
                                                <div className="text-xs text-gray-500">
                                                    Showing {workersPage * workersPageSize + 1}–{Math.min((workersPage + 1) * workersPageSize, workersTotal)} of {workersTotal} workers
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        value={workersPageSize}
                                                        onChange={(e) => { setWorkersPageSize(Number(e.target.value)); setWorkersPage(0); }}
                                                        className="border border-gray-300 rounded px-2 py-1 text-xs"
                                                        aria-label="Workers per page"
                                                    >
                                                        <option value={10}>10 / page</option>
                                                        <option value={20}>20 / page</option>
                                                        <option value={50}>50 / page</option>
                                                    </select>
                                                    <button
                                                        onClick={() => setWorkersPage((p) => Math.max(0, p - 1))}
                                                        disabled={workersPage <= 0}
                                                        className="px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-100"
                                                    >
                                                        Prev
                                                    </button>
                                                    <span className="text-xs text-gray-600 px-1">
                                                        Page {workersPage + 1} of {Math.max(1, Math.ceil(workersTotal / workersPageSize))}
                                                    </span>
                                                    <button
                                                        onClick={() => setWorkersPage((p) => p + 1)}
                                                        disabled={(workersPage + 1) * workersPageSize >= workersTotal}
                                                        className="px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-100"
                                                    >
                                                        Next
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <p className="text-sm text-gray-400">No active workers.</p>
                                )}
                            </div>
                        </>
                    )}
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
                            onClick={() => { setShowCreateUser(true); setCreatedUser(null); }}
                            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md text-white"
                            style={{ backgroundColor: '#991B1B' }}
                        >
                            <UserPlus className="w-4 h-4" /> Create User
                        </button>
                        <button onClick={loadUsers} disabled={loadingUsers} className="flex items-center gap-1 text-sm font-medium disabled:opacity-50" style={{ color: 'var(--bfp-maroon)' }}>
                            <RefreshCw className={`w-4 h-4 ${loadingUsers ? 'animate-spin' : ''}`} /> Refresh
                        </button>
                    </div>
                </div>
                {/* Filter bar (#346) */}
                <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap gap-3 items-end">
                    <div className="flex-1 min-w-[160px]">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Username</label>
                        <input
                            type="text"
                            value={governanceQuery}
                            onChange={(e) => setGovernanceQuery(e.target.value)}
                            placeholder="Search username…"
                            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                            style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                            aria-label="Filter by username"
                        />
                    </div>
                    <div className="min-w-[140px]">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                        <select
                            value={governanceRoleFilter}
                            onChange={(e) => setGovernanceRoleFilter(e.target.value)}
                            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                            style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                            aria-label="Filter by role"
                        >
                            <option value="">All Roles</option>
                            {GOVERNANCE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </div>
                    <div className="min-w-[140px]">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Region</label>
                        <select
                            value={governanceRegionFilter}
                            onChange={(e) => setGovernanceRegionFilter(e.target.value)}
                            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                            style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                            aria-label="Filter by region"
                            disabled={regions.length === 0}
                        >
                            <option value="">All Regions</option>
                            {regions.map((r) => <option key={r.region_id} value={r.region_id}>{r.region_name}</option>)}
                        </select>
                    </div>
                    <div className="min-w-[120px]">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                        <select
                            value={governanceActiveFilter}
                            onChange={(e) => setGovernanceActiveFilter(e.target.value)}
                            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                            style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                            aria-label="Filter by active status"
                        >
                            <option value="">All</option>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                        </select>
                    </div>
                    {(governanceQuery || governanceRoleFilter || governanceRegionFilter || governanceActiveFilter) && (
                        <div className="flex items-end pb-0.5">
                            <button
                                onClick={() => { setGovernanceQuery(''); setGovernanceRoleFilter(''); setGovernanceRegionFilter(''); setGovernanceActiveFilter(''); }}
                                className="text-xs px-2 py-1.5 text-gray-500 hover:text-gray-700"
                            >
                                Clear filters
                            </button>
                        </div>
                    )}
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
                            {loadingUsers ? (
                                <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400">Loading users…</td></tr>
                            ) : paginatedUsers.length === 0 ? (
                                <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                                    {filteredUsers.length === 0 && users.length > 0 ? 'No users match the current filters.' : 'No users found.'}
                                </td></tr>
                            ) : (
                                paginatedUsers.map((u) => (
                                    <tr key={u.user_id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                            <button
                                                onClick={() => setSelectedSessionUser(u)}
                                                className="text-blue-600 hover:text-blue-800 hover:underline text-left"
                                                title="View sessions"
                                            >
                                                {u.username}
                                            </button>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{u.role}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {regions.find((r) => r.region_id === u.assigned_region_id)?.region_name ?? u.assigned_region_id ?? '—'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">{u.is_active ? <CheckCircle className="w-5 h-5 text-green-600" /> : <XCircle className="w-5 h-5 text-red-500" />}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right">
                                            <button
                                                onClick={() => {
                                                    setEditUserModal(u);
                                                    setEditRole(u.role);
                                                    setEditRegionId(u.assigned_region_id?.toString() ?? '');
                                                    setEditActive(u.is_active);
                                                }}
                                                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                                            >
                                                Edit
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                {/* Pagination (#346) */}
                {filteredUsers.length > 0 && (
                    <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs text-gray-500">
                            Showing {(governancePage - 1) * governancePageSize + 1}–{Math.min(governancePage * governancePageSize, filteredUsers.length)} of {filteredUsers.length} users
                        </div>
                        <div className="flex items-center gap-2">
                            <select
                                value={governancePageSize}
                                onChange={(e) => { setGovernancePageSize(Number(e.target.value)); setGovernancePage(1); }}
                                className="border border-gray-300 rounded px-2 py-1 text-xs"
                                aria-label="Users per page"
                            >
                                <option value={10}>10 / page</option>
                                <option value={25}>25 / page</option>
                                <option value={50}>50 / page</option>
                            </select>
                            <button
                                onClick={() => setGovernancePage((p) => Math.max(1, p - 1))}
                                disabled={governancePage <= 1}
                                className="px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-100"
                            >
                                Prev
                            </button>
                            <span className="text-xs text-gray-600 px-1">
                                Page {governancePage} of {totalGovernancePages}
                            </span>
                            <button
                                onClick={() => setGovernancePage((p) => Math.min(totalGovernancePages, p + 1))}
                                disabled={governancePage >= totalGovernancePages}
                                className="px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-100"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </section>

            <section id="sessions" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <Monitor className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>Active Sessions</span>
                        {sessionsFromCache && <span className="text-xs italic text-amber-600">(cached)</span>}
                        {sessionsFromCache && sessionsLastChecked && (
                            <span className="text-xs text-gray-400">
                                Last checked: {formatLastCheckedAgo(sessionsLastChecked)}
                            </span>
                        )}
                    </div>
                    <button onClick={loadSessions} disabled={loadingSessions} className="flex items-center gap-1 text-sm font-medium disabled:opacity-50" style={{ color: 'var(--bfp-maroon)' }}>
                        <RefreshCw className={`w-4 h-4 ${loadingSessions ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                </div>
                {/* Username filter (#347) */}
                <div className="px-4 py-3 border-b border-gray-100">
                    <div className="max-w-xs">
                        <input
                            type="text"
                            value={sessionsQuery}
                            onChange={(e) => { setSessionsQuery(e.target.value); setSessionsPage(1); }}
                            placeholder="Filter by username…"
                            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                            style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                            aria-label="Filter sessions by username"
                        />
                    </div>
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
                            {loadingSessions ? (
                                <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-400">Loading sessions…</td></tr>
                            ) : paginatedSessions.length === 0 ? (
                                <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                                    {filteredSessions.length === 0 && activeSessions.length > 0 ? 'No sessions match the username filter.' : 'No active sessions found.'}
                                </td></tr>
                            ) : (
                                paginatedSessions.map((s) => (
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
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                {/* Pagination (#347) */}
                {filteredSessions.length > 0 && (
                    <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs text-gray-500">
                            Showing {(sessionsPage - 1) * sessionsPageSize + 1}–{Math.min(sessionsPage * sessionsPageSize, filteredSessions.length)} of {filteredSessions.length} sessions
                        </div>
                        <div className="flex items-center gap-2">
                            <select
                                value={sessionsPageSize}
                                onChange={(e) => { setSessionsPageSize(Number(e.target.value)); setSessionsPage(1); }}
                                className="border border-gray-300 rounded px-2 py-1 text-xs"
                                aria-label="Sessions per page"
                            >
                                <option value={10}>10 / page</option>
                                <option value={25}>25 / page</option>
                                <option value={50}>50 / page</option>
                            </select>
                            <button
                                onClick={() => setSessionsPage((p) => Math.max(1, p - 1))}
                                disabled={sessionsPage <= 1}
                                className="px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-100"
                            >
                                Prev
                            </button>
                            <span className="text-xs text-gray-600 px-1">
                                Page {sessionsPage} of {totalSessionsPages}
                            </span>
                            <button
                                onClick={() => setSessionsPage((p) => Math.min(totalSessionsPages, p + 1))}
                                disabled={sessionsPage >= totalSessionsPages}
                                className="px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-100"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </section>

            <section id="telemetry" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>Threat Telemetry</span>
                    </div>
                    <button onClick={() => loadSecurityLogs()} disabled={loadingLogs} className="flex items-center gap-1 text-sm font-medium disabled:opacity-50" style={{ color: 'var(--bfp-maroon)' }}>
                        <RefreshCw className={`w-4 h-4 ${loadingLogs ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                </div>
                {/* Search bar */}
                <form
                    onSubmit={e => { e.preventDefault(); loadSecurityLogs(); }}
                    className="px-6 py-3 border-b border-gray-100 flex items-center gap-2"
                >
                    <input
                        type="text"
                        aria-label="Search security logs"
                        value={securitySearchQ}
                        onChange={e => setSecuritySearchQ(e.target.value)}
                        placeholder="Search logs (narrative, IP, severity…)"
                        className="flex-1 border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                        style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                    />
                    <button
                        type="submit"
                        className="flex items-center gap-1 px-3 py-1.5 rounded text-sm text-white"
                        style={{ backgroundColor: 'var(--sidebar-bg)' }}
                        aria-label="Search security logs"
                    >
                        <Search className="w-3 h-3" />
                    </button>
                    {securitySearchQ && (
                        <button
                            type="button"
                            onClick={() => { setSecuritySearchQ(''); securitySearchQRef.current = ''; loadSecurityLogs(); }}
                            className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700"
                        >
                            Clear
                        </button>
                    )}
                </form>

                {/* Advanced filter bar (#348) */}
                <div className="px-6 py-3 border-b border-gray-100 space-y-3">
                    {/* Severity chips */}
                    <div>
                        <span className="text-xs font-medium text-gray-500 block mb-2">Severity</span>
                        <div className="flex gap-2 flex-wrap">
                            {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((sev) => {
                                const active = telemetrySeverities.has(sev);
                                const chipColors: Record<string, string> = {
                                    LOW: active ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600',
                                    MEDIUM: active ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600',
                                    HIGH: active ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-600',
                                    CRITICAL: active ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-600',
                                };
                                return (
                                    <button
                                        key={sev}
                                        type="button"
                                        onClick={() => handleToggleTelemetrySeverity(sev)}
                                        className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${chipColors[sev]}`}
                                    >
                                        {sev}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    {/* Source IP + Date range on one row */}
                    <div className="flex flex-wrap gap-3">
                        <div className="flex-1 min-w-[160px]">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Source IP</label>
                            <input
                                type="text"
                                value={telemetrySourceIp}
                                onChange={(e) => { setTelemetrySourceIp(e.target.value); setTelemetryPage(0); }}
                                onBlur={() => loadSecurityLogs()}
                                onKeyDown={(e) => { if (e.key === 'Enter') loadSecurityLogs(); }}
                                placeholder="e.g. 192.168.1.1"
                                className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                                style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                            />
                        </div>
                        <div className="min-w-[140px]">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Date From</label>
                            <input
                                type="text"
                                value={telemetryDateFrom}
                                onChange={(e) => { setTelemetryDateFrom(e.target.value); setTelemetryPage(0); }}
                                onBlur={() => loadSecurityLogs()}
                                onKeyDown={(e) => { if (e.key === 'Enter') loadSecurityLogs(); }}
                                placeholder="YYYY-MM-DD"
                                className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                                style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                            />
                        </div>
                        <div className="min-w-[140px]">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Date To</label>
                            <input
                                type="text"
                                value={telemetryDateTo}
                                onChange={(e) => { setTelemetryDateTo(e.target.value); setTelemetryPage(0); }}
                                onBlur={() => loadSecurityLogs()}
                                onKeyDown={(e) => { if (e.key === 'Enter') loadSecurityLogs(); }}
                                placeholder="YYYY-MM-DD"
                                className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                                style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                            />
                        </div>
                    </div>
                    {/* Reset controls */}
                    {(telemetrySeverities.size > 0 || telemetrySourceIp || telemetryDateFrom || telemetryDateTo || securitySearchQ) && (
                        <div className="pt-1">
                            <button
                                type="button"
                                onClick={handleClearTelemetryFilters}
                                className="text-xs px-3 py-1.5 rounded-md font-medium transition-colors"
                                style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
                            >
                                Reset All Filters
                            </button>
                        </div>
                    )}
                </div>

                {/* Error state (#348) */}
                {telemetryError && !loadingLogs && (
                    <div className="mx-6 mt-3 p-3 rounded-md text-sm font-medium bg-red-50 border border-red-200 text-red-800" role="alert">
                        {telemetryError}
                    </div>
                )}

                <div className="overflow-x-auto">
                    {/* Loading skeleton */}
                    {loadingLogs ? (
                        <div className="p-4 space-y-3 animate-pulse">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="flex gap-4">
                                    <div className="h-6 bg-gray-100 rounded w-16" />
                                    <div className="h-6 bg-gray-100 rounded w-40" />
                                    <div className="h-6 bg-gray-100 rounded w-48 flex-1" />
                                    <div className="h-6 bg-gray-100 rounded w-12" />
                                    <div className="h-6 bg-gray-100 rounded w-20" />
                                    <div className="h-6 bg-gray-100 rounded w-12" />
                                </div>
                            ))}
                        </div>
                    ) : securityLogs.length === 0 ? (
                        /* Empty state */
                        <div className="p-8 text-center text-gray-500">
                            {telemetrySeverities.size > 0 || telemetrySourceIp || telemetryDateFrom || telemetryDateTo || securitySearchQ
                                ? 'No alerts match the current filters.'
                                : 'No Suricata alerts.'}
                        </div>
                    ) : (
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
                    )}
                </div>

                {/* Pagination (#348) */}
                {!loadingLogs && telemetryTotal > 0 && (
                    <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                        <span className="text-xs text-gray-500">
                            Showing {Math.min((telemetryPage * TELEMETRY_PAGE_SIZE) + 1, telemetryTotal)}–{Math.min((telemetryPage + 1) * TELEMETRY_PAGE_SIZE, telemetryTotal)} of {telemetryTotal}
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setTelemetryPage((p) => Math.max(0, p - 1))}
                                disabled={telemetryPage === 0}
                                className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                                style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
                            >
                                Previous
                            </button>
                            <span className="text-xs text-gray-500">
                                Page {telemetryPage + 1} of {Math.max(1, Math.ceil(telemetryTotal / TELEMETRY_PAGE_SIZE))}
                            </span>
                            <button
                                onClick={() => setTelemetryPage((p) => p + 1)}
                                disabled={(telemetryPage + 1) * TELEMETRY_PAGE_SIZE >= telemetryTotal}
                                className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                                style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </section>

            {/* System Audit — dedicated page CTA (#352) */}
            <section id="audit" className="card overflow-hidden">
                <div className="card-header flex items-center gap-2" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <FileText className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    <span>System Audit</span>
                </div>
                <div className="card-body">
                    <div className="p-6 flex items-center justify-between">
                        <div className="space-y-2">
                            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                Full audit trail with advanced filters
                            </h3>
                            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                Search and filter by action type, table, user ID, IP address, date range, and full-text.
                            </p>
                        </div>
                        <a
                            href="/admin/audit"
                            className="px-4 py-2 rounded-md text-sm font-medium text-white inline-flex items-center gap-2"
                            style={{ backgroundColor: 'var(--sidebar-bg)' }}
                        >
                            <Search className="w-4 h-4" />
                            Open System Audit
                        </a>
                    </div>
                </div>
            </section>

            {/* Failed Syncs (Issue #141) */}
            <section id="failed-syncs" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>Failed Syncs</span>
                        {failedSyncs.length > 0 && (
                            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold">
                                {failedSyncs.length}
                            </span>
                        )}
                    </div>
                    <button
                        onClick={loadFailedSyncs}
                        disabled={loadingFailedSyncs}
                        className="flex items-center gap-1 text-sm font-medium disabled:opacity-50"
                        style={{ color: 'var(--bfp-maroon)' }}
                    >
                        <RefreshCw className={`w-4 h-4 ${loadingFailedSyncs ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                </div>
                <div className="overflow-x-auto">
                    {loadingFailedSyncs ? (
                        <div className="p-8 text-center text-gray-500">Loading failed syncs…</div>
                    ) : failedSyncs.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">No failed sync operations.</div>
                    ) : (
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Op ID</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Operation</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Error</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Retries</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Failed At</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {failedSyncs.map((op) => (
                                    <tr key={op.localId} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-xs font-mono text-gray-600" title={op.localId}>
                                            {op.localId.slice(0, 8)}…
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{op.operation}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 max-w-[200px] truncate" title={op.errorMessage}>
                                            {op.errorCode ? `${op.errorCode}: ` : ''}{op.errorMessage}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{op.retryCount}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {op.failed_at ? new Date(op.failed_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleRetrySyncOp(op.localId)}
                                                    disabled={retryingOpId === op.localId}
                                                    className="text-blue-600 hover:text-blue-800 text-sm font-medium disabled:opacity-50"
                                                >
                                                    {retryingOpId === op.localId ? 'Retrying…' : 'Retry'}
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteSyncOp(op.localId)}
                                                    disabled={deletingOpId === op.localId}
                                                    className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50 flex items-center gap-1"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                    {deletingOpId === op.localId ? 'Deleting…' : 'Delete'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </section>

            {/* Alert Action Highlights (issue #350) */}
            <section id="audit-highlights" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>Alert Action Highlights</span>
                    </div>
                    <button onClick={loadHighlightAudit} disabled={loadingHighlights} className="flex items-center gap-1 text-sm font-medium disabled:opacity-50" style={{ color: 'var(--bfp-maroon)' }}>
                        <RefreshCw className={`w-4 h-4 ${loadingHighlights ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                </div>
                <div className="overflow-x-auto">
                    {(() => {
                        const highlightActions = new Set(['HITL_REVIEW', 'CREATE_INCIDENT_FROM_ALERT', 'BREACH_DETECTED']);
                        const highlights = auditLogs.items.filter(a => a.action_type && highlightActions.has(a.action_type));
                        if (highlights.length === 0) {
                            return <div className="p-8 text-center text-gray-500">No security action highlights yet. Admin HITL decisions, incident creation from alerts, and breach detections will appear here.</div>;
                        }
                        return (
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Table</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Record</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP / UA</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {highlights.map((a) => (
                                        <tr key={a.audit_id} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{a.timestamp ? new Date(a.timestamp).toLocaleString() : '\u2014'}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                                    a.action_type === 'HITL_REVIEW' ? 'bg-blue-100 text-blue-800' :
                                                    a.action_type === 'CREATE_INCIDENT_FROM_ALERT' ? 'bg-orange-100 text-orange-800' :
                                                    'bg-red-100 text-red-800'
                                                }`}>
                                                    {a.action_type === 'HITL_REVIEW' ? 'HITL Review' :
                                                     a.action_type === 'CREATE_INCIDENT_FROM_ALERT' ? 'Incident Created' :
                                                     'Breach Detected'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                {a.table_affected === 'security_threat_logs' && a.record_id ? (
                                                    <a href={`#telemetry`} className="text-blue-600 hover:underline font-mono text-xs" onClick={(e) => { e.preventDefault(); setSecuritySearchQ(''); securitySearchQRef.current = ''; loadSecurityLogs(); }}>
                                                        alert #{a.record_id}
                                                    </a>
                                                ) : (
                                                    <span className="text-gray-400">{a.table_affected ?? '\u2014'}</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{a.record_id ?? '\u2014'}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                                                {a.ip_address ? <span className="font-mono text-xs mr-2">{a.ip_address}</span> : null}
                                                {a.user_agent ? <span className="text-xs truncate max-w-[200px] inline-block">{a.user_agent.substring(0, 50)}</span> : <span className="italic">no metadata</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        );
                    })()}
                </div>
            </section>

            {/* Scheduled Reports (Issue #88) */}
            <section id="scheduled-reports" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>Scheduled Reports</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowCreateReport(true)}
                            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md text-white"
                            style={{ backgroundColor: '#991B1B' }}
                        >
                            <Plus className="w-4 h-4" /> New Schedule
                        </button>
                        <button onClick={loadScheduledReports} disabled={loadingReports} className="flex items-center gap-1 text-sm font-medium disabled:opacity-50" style={{ color: 'var(--bfp-maroon)' }}>
                            <RefreshCw className={`w-4 h-4 ${loadingReports ? 'animate-spin' : ''}`} /> Refresh
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cron</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Format</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Recipients</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Enabled</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Run</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {scheduledReports.map((r) => (
                                <tr key={r.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{r.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">{r.cron_expr}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 uppercase">{r.format}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {r.recipients && r.recipients.length > 0 ? (
                                            <span className="flex items-center gap-1">
                                                <Mail className="w-3 h-3" /> {r.recipients.length}
                                            </span>
                                        ) : (
                                            <span className="text-gray-400">—</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <button
                                            onClick={() => handleToggleReport(r)}
                                            disabled={togglingReportId === r.id}
                                            className="disabled:opacity-50"
                                        >
                                            {r.enabled ? (
                                                <ToggleRight className="w-6 h-6 text-green-600" />
                                            ) : (
                                                <ToggleLeft className="w-6 h-6 text-gray-400" />
                                            )}
                                        </button>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {r.last_run_at ? new Date(r.last_run_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : (
                                            <span className="text-gray-400 italic">Never</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right">
                                        <button
                                            onClick={() => handleDeleteReport(r.id)}
                                            disabled={deletingReportId === r.id}
                                            className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50"
                                        >
                                            {deletingReportId === r.id ? 'Deleting…' : (
                                                <Trash2 className="w-4 h-4" />
                                            )}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {scheduledReports.length === 0 && !loadingReports && (
                        <div className="p-8 text-center text-gray-500">
                            No scheduled reports. Click &ldquo;New Schedule&rdquo; to create one.
                        </div>
                    )}
                </div>
            </section>

            {/* Backup Manager (GAP-A01/A02) */}
            <section id="backup" className="card overflow-hidden">
                <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <div className="flex items-center gap-2">
                        <Bookmark className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <span>Backup Manager</span>
                    </div>
                    <a
                        href="/admin/backups"
                        className="px-4 py-2 rounded-md text-sm font-medium text-white inline-flex items-center gap-2"
                        style={{ backgroundColor: 'var(--sidebar-bg)' }}
                    >
                        <ArrowRight className="w-4 h-4" />
                        Open Backup Manager
                    </a>
                </div>

                {/* Cadence nudge — if no backup in 7+ days */}
                {(() => {
                    if (backups.length === 0) return null;
                    const latestBackup = backups[0];
                    const daysSinceLastBackup = latestBackup.created_at
                        ? (Date.now() - new Date(latestBackup.created_at).getTime()) / (1000 * 60 * 60 * 24)
                        : 999;
                    if (daysSinceLastBackup < 7) return null;
                    return (
                        <div className="mx-4 mt-4 p-3 rounded-md text-sm font-medium bg-amber-50 border border-amber-200 text-amber-800 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            <span>No backup taken in <strong>{Math.round(daysSinceLastBackup)}</strong> days &mdash; consider{' '}
                                <a href="/admin/backups" className="underline font-semibold hover:opacity-80">triggering one</a>.
                            </span>
                        </div>
                    );
                })()}

                {/* Summary stats row */}
                <div className="grid grid-cols-3 gap-0 border-b border-gray-100">
                    <div className="p-4 text-center border-r border-gray-100">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Last Backup</div>
                        <div className="text-sm font-bold text-gray-900">
                            {loadingBackups ? '—' : backups.length > 0
                                ? (() => {
                                    const secs = (Date.now() - new Date(backups[0].created_at).getTime()) / 1000;
                                    if (secs < 60) return `${Math.round(secs)} sec ago`;
                                    if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
                                    if (secs < 86400) return `${Math.round(secs / 3600)} hr ago`;
                                    return `${Math.round(secs / 86400)} days ago`;
                                })()
                                : '—'
                            }
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">{backups[0]?.created_at ? new Date(backups[0].created_at).toLocaleString() : ''}</div>
                    </div>
                    <div className="p-4 text-center border-r border-gray-100">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Total Backups</div>
                        <div className="text-sm font-bold text-gray-900">{loadingBackups ? '—' : backups.length} / 100</div>
                        <div className="text-xs text-gray-400 mt-0.5">Slots used</div>
                    </div>
                    <div className="p-4 text-center">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Storage Used</div>
                        <div className="text-sm font-bold text-gray-900">
                            {loadingBackups
                                ? '—'
                                : backups.length > 0
                                    ? `${(backups.reduce((sum, b) => sum + b.size_bytes, 0) / (1024 * 1024)).toFixed(1)} MB`
                                    : '—'
                            }
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                            {backups.length > 1 ? `~${((backups.reduce((sum, b) => sum + b.size_bytes, 0) / backups.length) / (1024 * 1024)).toFixed(0)} MB avg` : ''}
                        </div>
                    </div>
                </div>

                {/* Latest Backup Details */}
                <div className="p-4">
                    {loadingBackups ? (
                        <div className="p-6 text-center text-gray-400">Loading backups…</div>
                    ) : backupError ? (
                        <div className="p-6 text-center text-red-500">
                            {backupError}
                            <button onClick={loadBackupSummary} className="ml-2 underline text-sm">Retry</button>
                        </div>
                    ) : backups.length === 0 ? (
                        <div className="p-6 text-center">
                            <p className="text-sm text-gray-500">No backups created yet.</p>
                            <a href="/admin/backups" className="text-sm font-medium mt-2 inline-flex items-center gap-1" style={{ color: 'var(--bfp-maroon)' }}>
                                <ArrowRight className="w-3 h-3" />
                                Trigger your first backup in the Backup Manager
                            </a>
                        </div>
                    ) : (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-mono text-sm font-medium text-gray-900">{backups[0].filename}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${backups[0].provider === 'openbao_transit' ? 'bg-blue-100 text-blue-800' : backups[0].provider === 'env_aesgcm' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>
                                        {backups[0].provider === 'openbao_transit' ? 'OpenBao WIMSBAO1' : backups[0].provider === 'env_aesgcm' ? 'Legacy AES' : 'Unknown'}
                                    </span>
                                </div>
                                <span className="text-sm font-medium text-gray-700 whitespace-nowrap">{(backups[0].size_bytes / (1024 * 1024)).toFixed(1)} MB</span>
                            </div>
                            {backups[0].manifest ? (
                                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                                    <div className="text-gray-600">
                                        Last incident: <span className="font-medium text-gray-900">{backups[0].manifest.last_updates?.incident ? new Date(backups[0].manifest.last_updates.incident).toLocaleString() : '—'}</span>
                                    </div>
                                    <div className="text-gray-600">
                                        Last citizen report: <span className="font-medium text-gray-900">{backups[0].manifest.last_updates?.citizen_report ? new Date(backups[0].manifest.last_updates.citizen_report).toLocaleString() : '—'}</span>
                                    </div>
                                    <div className="text-gray-600">
                                        Records: <span className="font-medium text-gray-900">{backups[0].manifest.record_counts?.incidents ?? '—'} incidents &middot; {backups[0].manifest.record_counts?.citizens ?? '—'} citizens</span>
                                    </div>
                                    <div className="text-gray-600">
                                        Users: <span className="font-medium text-gray-900">{backups[0].manifest.record_counts?.users ?? '—'}</span>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sm text-gray-400 italic">No manifest &mdash; backup data unavailable (legacy backup)</p>
                            )}
                        </div>
                    )}
                </div>
            </section>

            {/* Create Scheduled Report Modal */}
            {showCreateReport && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="rounded-xl shadow-2xl w-full max-w-lg bg-white overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center" style={{ backgroundColor: 'var(--sidebar-bg)' }}>
                            <div className="flex items-center gap-2">
                                <Calendar className="w-5 h-5 text-white" />
                                <h3 className="text-base font-bold text-white">New Scheduled Report</h3>
                            </div>
                            <button onClick={() => setShowCreateReport(false)} className="text-white/70 hover:text-white">
                                <XCircle className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Report Name <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    value={newReport.name}
                                    onChange={(e) => setNewReport((p) => ({ ...p, name: e.target.value }))}
                                    placeholder="e.g. Weekly Incident Summary"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Cron Expression <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    value={newReport.cron_expr}
                                    onChange={(e) => setNewReport((p) => ({ ...p, cron_expr: e.target.value }))}
                                    placeholder="0 7 * * 1"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2"
                                />
                                <p className="text-xs text-gray-400 mt-1">Standard cron: min hour dom month dow. Example: <code>0 7 * * 1</code> = Every Monday at 07:00 UTC.</p>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Format</label>
                                <select
                                    value={newReport.format}
                                    onChange={(e) => setNewReport((p) => ({ ...p, format: e.target.value as 'pdf' | 'excel' | 'csv' }))}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                >
                                    <option value="pdf">PDF</option>
                                    <option value="excel">Excel (XLSX)</option>
                                    <option value="csv">CSV</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Recipients (comma-separated emails)</label>
                                <input
                                    type="text"
                                    value={newReport.recipients}
                                    onChange={(e) => setNewReport((p) => ({ ...p, recipients: e.target.value }))}
                                    placeholder="admin@bfp.gov.ph, analyst@bfp.gov.ph"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                />
                            </div>
                            <div>
                                <ReportFilterBuilder
                                    filters={newReport.filters}
                                    onChange={(f) => {
                                        setNewReport((p) => ({ ...p, filters: f }));
                                        if (Object.keys(filterErrors).length > 0) {
                                            setFilterErrors({});
                                        }
                                    }}
                                    regions={regions}
                                    errors={filterErrors}
                                />
                                <p className="text-xs text-gray-400 mt-2">Optional filters applied to the export query. Use the form fields or toggle Expert mode for raw JSON editing.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="report-enabled"
                                    checked={newReport.enabled}
                                    onChange={(e) => setNewReport((p) => ({ ...p, enabled: e.target.checked }))}
                                />
                                <label htmlFor="report-enabled" className="text-sm text-gray-700">Enabled on creation</label>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={handleCreateReport}
                                    disabled={creatingReport || !newReport.name.trim() || !newReport.cron_expr.trim()}
                                    className="flex-1 py-2.5 rounded-lg text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                                    style={{ backgroundColor: 'var(--sidebar-bg)' }}
                                >
                                    {creatingReport ? <><RefreshCw className="w-4 h-4 animate-spin" /> Creating…</> : <><Plus className="w-4 h-4" /> Create Schedule</>}
                                </button>
                                <button
                                    onClick={() => setShowCreateReport(false)}
                                    className="px-5 py-2.5 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {selectedLog && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto bg-[var(--background)] text-[var(--foreground)]">
                        <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 dark:bg-gray-800/80">
                            <div className="flex items-center gap-2">
                                <ShieldAlert className="w-5 h-5 text-gray-500" />
                                <h3 className="text-base font-bold">Suricata Alert &mdash; #{selectedLog.log_id}</h3>
                            </div>
                            <button onClick={() => { setSelectedLog(null); setHitlMessage(null); setCreateIncidentResult(null); setRelatedEvidence(null); setRelatedEvidenceError(null); }} className="text-gray-400 hover:text-gray-600"><XCircle className="w-5 h-5" /></button>
                        </div>
                        <div className="p-5 space-y-5">

                            {/* Inline hitl success/error message */}
                            {hitlMessage && (
                                <div className={`p-3 rounded-md text-sm font-medium ${hitlMessage.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-950/40 dark:border-green-800 dark:text-green-200' : 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/40 dark:border-red-800 dark:text-red-200'}`}>
                                    {hitlMessage.type === 'success' ? <CheckCircle className="w-4 h-4 inline mr-1" /> : <XCircle className="w-4 h-4 inline mr-1" />}
                                    {hitlMessage.text}
                                </div>
                            )}

                            {/* Inline create incident success message */}
                            {createIncidentResult && (
                                <div className="p-3 rounded-md text-sm font-medium bg-green-50 border border-green-200 text-green-800 dark:bg-green-950/40 dark:border-green-800 dark:text-green-200">
                                    <CheckCircle className="w-4 h-4 inline mr-1" />
                                    Incident #{createIncidentResult.incident_id} created from this alert.{' '}
                                    <a href={`/incidents/${createIncidentResult.incident_id}`} className="underline font-semibold hover:opacity-80">View Incident</a>
                                </div>
                            )}

                            {/* Section: AI Threat Analysis */}
                            <div className="bg-purple-50 dark:bg-purple-950/40 p-4 rounded-lg border border-purple-100 dark:border-purple-800">
                                <div className="flex items-center gap-1.5 mb-3">
                                    <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                                    <h4 className="text-xs font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider">AI Threat Analysis</h4>
                                </div>
                                {selectedLog.xai_narrative ? (
                                    (() => {
                                        const parsed = normalizeNarrative(selectedLog.xai_narrative);
                                        if (parsed.isStructured || parsed.anomalyDescription || parsed.logEvidence || parsed.riskAssessment || parsed.recommendedAction) {
                                            return (
                                                <div className="space-y-3">
                                                    {parsed.anomalyDescription && (
                                                        <div>
                                                            <p className="text-xs font-semibold text-purple-700 dark:text-purple-300">Anomaly Description</p>
                                                            <p className="text-sm text-[var(--foreground)]">{parsed.anomalyDescription}</p>
                                                        </div>
                                                    )}
                                                    {parsed.logEvidence && (
                                                        <div>
                                                            <p className="text-xs font-semibold text-purple-700 dark:text-purple-300">Log Evidence</p>
                                                            <p className="text-sm text-[var(--foreground)]">{parsed.logEvidence}</p>
                                                        </div>
                                                    )}
                                                    {parsed.riskAssessment && (
                                                        <div>
                                                            <p className="text-xs font-semibold text-purple-700 dark:text-purple-300">Risk Assessment</p>
                                                            <p className="text-sm text-[var(--foreground)]">{parsed.riskAssessment}</p>
                                                        </div>
                                                    )}
                                                    {parsed.recommendedAction && (
                                                        <div>
                                                            <p className="text-xs font-semibold text-purple-700 dark:text-purple-300">Recommended Action</p>
                                                            <p className="text-sm text-[var(--foreground)]">{parsed.recommendedAction}</p>
                                                        </div>
                                                    )}
                                                    {selectedLog.xai_confidence != null && (
                                                        <div className="mt-2 text-xs text-purple-800 dark:text-purple-600 font-medium text-right">
                                                            Confidence: {((selectedLog.xai_confidence ?? 0) * 100).toFixed(1)}%
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        }
                                        return (
                                            <>
                                                <p className="text-sm text-[var(--foreground)]">{selectedLog.xai_narrative}</p>
                                                {selectedLog.xai_confidence != null && (
                                                    <div className="mt-2 text-xs text-purple-800 dark:text-purple-600 font-medium text-right">
                                                        Confidence: {((selectedLog.xai_confidence ?? 0) * 100).toFixed(1)}%
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleAnalyze(selectedLog)}
                                            disabled={analyzingLogId === selectedLog.log_id}
                                            className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                                        >
                                            <Sparkles className="w-4 h-4" />
                                            {analyzingLogId === selectedLog.log_id ? 'Analyzing\u2026' : 'Analyze with AI'}
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Section: Alert Details */}
                            <div>
                                <div className="flex items-center gap-1.5 mb-3">
                                    <AlertTriangle className="w-4 h-4 text-gray-500" />
                                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Alert Details</h4>
                                </div>
                                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                                    <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
                                        <div>
                                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Source IP</p>
                                            <p className="font-mono text-[var(--foreground)]">{selectedLog.source_ip ?? '\u2014'}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Destination IP</p>
                                            <p className="font-mono text-[var(--foreground)]">{selectedLog.destination_ip ?? '\u2014'}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Suricata SID</p>
                                            <p className="text-[var(--foreground)]">{selectedLog.suricata_sid ?? '\u2014'}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Severity Level</p>
                                            <p className="text-[var(--foreground)]">{selectedLog.severity_level ?? '\u2014'}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Section: Raw Payload */}
                            {selectedLog.raw_payload && (
                                <div>
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <FileText className="w-4 h-4 text-gray-500" />
                                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Raw Payload</h4>
                                    </div>
                                    <pre className="bg-gray-100 dark:bg-gray-950 text-gray-800 dark:text-gray-200 p-3 rounded-lg text-xs overflow-x-auto font-mono max-h-44 overflow-y-auto border border-gray-200 dark:border-gray-700 leading-relaxed">{selectedLog.raw_payload}</pre>
                                </div>
                            )}

                            {/* Section: Review Status / Decision */}
                            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                                {selectedLog.admin_action_taken ? (
                                    <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
                                        <div className="flex items-center gap-2 font-semibold">
                                            <CheckCircle className="w-4 h-4" />
                                            <span>Reviewed: {selectedLog.admin_action_taken}</span>
                                        </div>
                                        {selectedLog.resolved_at && (
                                            <div className="text-xs opacity-80 mt-1 ml-6">Resolved {new Date(selectedLog.resolved_at).toLocaleString()}</div>
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-1.5 mb-3">
                                            <ShieldAlert className="w-4 h-4 text-gray-500" />
                                            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Threat Decision</h4>
                                        </div>
                                        <div className="mb-3">
                                            <button
                                                onClick={() => handleCreateIncident()}
                                                disabled={isSubmitting}
                                                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-orange-600 text-white rounded-lg text-sm font-semibold hover:bg-orange-700 disabled:opacity-50"
                                            >
                                                <FileText className="w-4 h-4" />
                                                Create Incident from Alert
                                            </button>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                onClick={() => handleHitlDecision('CONFIRM_THREAT')}
                                                disabled={isSubmitting}
                                                className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
                                            >
                                                <CheckCircle className="w-4 h-4" />
                                                {isSubmitting ? 'Applying\u2026' : 'Confirm Threat'}
                                            </button>
                                            <button
                                                onClick={() => handleHitlDecision('FALSE_POSITIVE')}
                                                disabled={isSubmitting}
                                                className="flex items-center gap-1.5 px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 rounded-lg text-sm font-semibold hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-50"
                                            >
                                                <XCircle className="w-4 h-4" />
                                                {isSubmitting ? 'Applying\u2026' : 'False Positive'}
                                            </button>
                                        </div>
                                    </>
                                )}

                                {/* View Related Evidence */}
                                <div className="mt-4">
                                    <button
                                        onClick={() => handleViewRelatedEvidence()}
                                        disabled={loadingRelatedEvidence}
                                        className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                                    >
                                        <Search className="w-4 h-4" />
                                        {loadingRelatedEvidence ? 'Loading\u2026' : 'View Related Evidence'}
                                    </button>

                                    {/* Related Evidence sub-panel */}
                                    {(relatedEvidence !== null || loadingRelatedEvidence || relatedEvidenceError) && (
                                        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 mt-3 bg-gray-50 dark:bg-gray-900/50">
                                            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Related Audit Evidence</h4>
                                            {loadingRelatedEvidence && (
                                                <p className="text-sm text-gray-500 italic">Loading related evidence\u2026</p>
                                            )}
                                            {relatedEvidenceError && (
                                                <p className="text-sm text-red-600">{relatedEvidenceError}</p>
                                            )}
                                            {relatedEvidence && relatedEvidence.length === 0 && (
                                                <p className="text-sm text-gray-500">No related audit records found in the &plusmn;1 hour window.</p>
                                            )}
                                            {relatedEvidence && relatedEvidence.length > 0 && (
                                                <div className="max-h-48 overflow-y-auto space-y-2">
                                                    {relatedEvidence.map((item) => (
                                                        <div key={item.audit_id} className="text-xs p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700">
                                                            <div className="flex justify-between items-center">
                                                                <span className="font-semibold text-blue-700 dark:text-blue-300">{item.action_type ?? '\u2014'}</span>
                                                                <span className="text-gray-400">{item.timestamp ? new Date(item.timestamp).toLocaleString() : '\u2014'}</span>
                                                            </div>
                                                            <div className="text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                                                {item.ip_address && <span className="font-mono">{item.ip_address}</span>}
                                                                {item.user_agent && <span className="truncate block max-w-full">{item.user_agent.substring(0, 80)}</span>}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

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
                            {loadingSessionUser ? (
                                <p className="text-sm text-gray-500 text-center py-4">Loading sessions…</p>
                            ) : sessionUserError ? (
                                <p className="text-sm text-red-600 text-center py-4">{sessionUserError}</p>
                            ) : (sessionsByUser[selectedSessionUser.user_id] ?? []).length === 0 ? (
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
                                    <p className="text-sm text-amber-800 font-medium">{createdUser.note ?? '⚠ Distribute this temporary password to the user securely. They must change it on first login.'}</p>
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
            {/* Edit User Modal (#346) */}
            {editUserModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="rounded-xl shadow-2xl max-w-md w-full bg-[var(--background)] text-[var(--foreground)] overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center" style={{ backgroundColor: 'var(--sidebar-bg)' }}>
                            <div className="flex items-center gap-2">
                                <Users className="w-5 h-5 text-white" />
                                <h3 className="text-base font-bold text-white">Edit User — {editUserModal.username}</h3>
                            </div>
                            <button onClick={() => setEditUserModal(null)} className="text-white/70 hover:text-white">
                                <XCircle className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Role</label>
                                <select
                                    value={editRole}
                                    onChange={(e) => setEditRole(e.target.value)}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                    style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                                >
                                    {GOVERNANCE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Assigned Region</label>
                                <select
                                    value={editRegionId}
                                    onChange={(e) => setEditRegionId(e.target.value)}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                                    style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                                >
                                    <option value="">— No region —</option>
                                    {regions.map((r) => <option key={r.region_id} value={r.region_id}>{r.region_name}</option>)}
                                </select>
                            </div>
                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id={`edit-active-${editUserModal.user_id}`}
                                    checked={editActive}
                                    onChange={(e) => setEditActive(e.target.checked)}
                                    className="h-4 w-4"
                                />
                                <label htmlFor={`edit-active-${editUserModal.user_id}`} className="text-sm font-medium text-gray-700">Active</label>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={async () => {
                                        const regionId = editRegionId ? parseInt(editRegionId, 10) : undefined;
                                        const hasRegionChanged = regionId !== editUserModal.assigned_region_id;
                                        const hasRoleChanged = editRole !== editUserModal.role;
                                        const hasActiveChanged = editActive !== editUserModal.is_active;
                                        if (!hasRoleChanged && !hasRegionChanged && !hasActiveChanged) {
                                            setEditUserModal(null);
                                            return;
                                        }
                                        setSavingUser(true);
                                        try {
                                            await handleUpdateUser(editUserModal.user_id, {
                                                role: hasRoleChanged ? editRole : undefined,
                                                assigned_region_id: hasRegionChanged ? regionId : undefined,
                                                is_active: hasActiveChanged ? editActive : undefined,
                                            });
                                            setEditUserModal(null);
                                        } finally {
                                            setSavingUser(false);
                                        }
                                    }}
                                    disabled={savingUser}
                                    className="flex-1 py-2.5 rounded-lg text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                                    style={{ backgroundColor: 'var(--sidebar-bg)' }}
                                >
                                    {savingUser ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving…</> : 'Save Changes'}
                                </button>
                                <button
                                    onClick={() => setEditUserModal(null)}
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
