'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AuditLogEntry } from '@/types/api';
import { useAuth } from '@/context/AuthContext';
import { useNetworkStatus } from '@/lib/useNetworkStatus';
import { normalizeNarrative } from '@/lib/xaiNarrativeNormalizer';
import {
  type SecurityLogsSummary,
  updateAdminSecurityLog,
  createIncidentFromAlert,
} from '@/lib/api/legacy';
import {
  fetchAdminSecurityLogsOfflineAware,
  fetchSecurityLogsSummaryOfflineAware,
  fetchAuditLogsOfflineAware,
} from '@/lib/api/offlineAdmin';
import { blockSourceIp, deleteSecurityLog, bulkActionSecurityLogs, blockByFilter } from '@/lib/api/securityActions';
import { StaleCacheBanner } from '@/components/ui/StaleCacheBanner';
import { AutoRefreshToast } from '@/components/ui/AutoRefreshToast';
import type { SecurityLogFilter } from '@/types/api';
import { ShieldAlert, RefreshCw, AlertTriangle, Info, WifiOff } from 'lucide-react';
import { BlockedIpsPanel } from './BlockedIpsPanel';
import { useAutoRefresh } from '@/lib/useAutoRefresh';

type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const SEVERITY_COLORS: Record<SeverityLevel, string> = {
  LOW: 'bg-blue-500',
  MEDIUM: 'bg-yellow-500',
  HIGH: 'bg-orange-500',
  CRITICAL: 'bg-red-500',
};

const SEVERITY_BG_COLORS: Record<SeverityLevel, string> = {
  LOW: 'bg-blue-100 text-blue-800',
  MEDIUM: 'bg-yellow-100 text-yellow-800',
  HIGH: 'bg-orange-100 text-orange-800',
  CRITICAL: 'bg-red-100 text-red-800',
};

interface ThreatLogItem {
  log_id: number;
  timestamp: string;
  source_ip: string;
  severity_level: SeverityLevel;
  suricata_sid: number;
  admin_action_taken: string | null;
  xai_confidence: number | null;
}

const HITL_ACTION_LABELS: Record<string, string> = {
  CONFIRM_THREAT: 'Confirmed Threat',
  FALSE_POSITIVE: 'False Positive',
  REQUEST_MORE_INFO: 'More Info Requested',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function SecurityMonitoringPage() {
  const { user, loading: authLoading } = useAuth();
  const { isOnline } = useNetworkStatus();
  const role = (user as { role?: string })?.role ?? null;
  const isAdmin = role === 'SYSTEM_ADMIN';

  const [summary, setSummary] = useState<SecurityLogsSummary | null>(null);
  const [threatLogs, setThreatLogs] = useState<ThreatLogItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSeverities, setActiveSeverities] = useState<Set<SeverityLevel>>(new Set());
  const [page, setPage] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [sourceIp, setSourceIp] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [searchQ, setSearchQ] = useState<string>('');
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalThreats, setTotalThreats] = useState<number>(0);
  const [expandedNarratives, setExpandedNarratives] = useState<Set<number>>(new Set());
  // T11: cache freshness tracking
  const [summaryCachedAt, setSummaryCachedAt] = useState<number | undefined>(undefined);
  const [threatsCachedAt, setThreatsCachedAt] = useState<number | undefined>(undefined);
  const [auditCachedAt, setAuditCachedAt] = useState<number | undefined>(undefined);
  // T11: friendly offline state when wrapper throws and we're offline
  const [offlineUnavailable, setOfflineUnavailable] = useState<boolean>(false);
  // Refresh key for BlockedIpsPanel — bump to force remount after filter block
  const [blockedIpsKey, setBlockedIpsKey] = useState(0);
  // T15: hide dismissed by default
  const [showDismissed, setShowDismissed] = useState(false);

  const PAGE_SIZE = 20;

  const loadMonitoring = useCallback(async () => {
    if (!isAdmin) return;

    setError(null);
    setOfflineUnavailable(false);
    try {
      const [summaryRes, auditRes] = await Promise.all([
        fetchSecurityLogsSummaryOfflineAware(),
        fetchAuditLogsOfflineAware({ limit: 50 }),
      ]);

      setSummary(summaryRes.response);
      setAuditLogs(auditRes.response.items);
      setSummaryCachedAt(summaryRes.fromCache ? summaryRes.cachedAt : undefined);
      setAuditCachedAt(auditRes.fromCache ? auditRes.cachedAt : undefined);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('loadMonitoring error', err);
      setSummary(null);
      setAuditLogs([]);
      if (!isOnline) {
        setOfflineUnavailable(true);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load monitoring data');
      }
    }
  }, [isAdmin, isOnline]);

  // T11: auto-dismiss toast after 4s
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const loadThreats = useCallback(async () => {
    if (!isAdmin) return;
    setError(null);
    setLoading(true);
    try {
      const severityParam = activeSeverities.size > 0 ? Array.from(activeSeverities).join(',') : undefined;
      const result = await fetchAdminSecurityLogsOfflineAware({
        severity: severityParam,
        source_ip: sourceIp.trim() || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        q: searchQ.trim() || undefined,
        show_dismissed: showDismissed || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setThreatLogs(result.response.items as ThreatLogItem[]);
      setTotalThreats(result.response.total);
      setThreatsCachedAt(result.fromCache ? result.cachedAt : undefined);
    } catch (err) {
      console.error('loadThreats error', err);
      if (!isOnline) {
        setOfflineUnavailable(true);
        setThreatLogs([]);
        setTotalThreats(0);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load threat data');
      }
    } finally {
      setLoading(false);
    }
  }, [isAdmin, isOnline, activeSeverities, page, sourceIp, dateFrom, dateTo, searchQ, showDismissed]);

  useEffect(() => {
    loadMonitoring();
    loadThreats();
  }, [loadMonitoring, loadThreats]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const startInterval = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        loadMonitoring();
        loadThreats();
      }, 30_000);
    };

    const stopInterval = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startInterval();
      } else {
        stopInterval();
      }
    };

    if (document.visibilityState === 'visible') {
      startInterval();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopInterval();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadMonitoring, loadThreats]);

  // SSE-driven refresh: fires immediately on new security events so threat
  // data stays current without waiting up to 30 s for the next interval tick.
  const { pending: autoRefreshPending, refreshing: autoRefreshing, justRefreshed: autoRefreshDone } = useAutoRefresh({
    eventTypes: [
      'security.threat_detected',
      'security.ai_analysis_complete',
      'security.hitl_confirmed',
    ],
    onRefresh: async () => {
      await Promise.all([loadMonitoring(), loadThreats()]);
    },
    notification: 'New security event — refreshing…',
  });

  const toggleSeverity = (sev: SeverityLevel) => {
    setActiveSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) {
        next.delete(sev);
      } else {
        next.add(sev);
      }
      return next;
    });
    setPage(0);
  };

  const clearFilters = () => {
    setActiveSeverities(new Set());
    setSourceIp('');
    setDateFrom('');
    setDateTo('');
    setSearchQ('');
    setPage(0);
  };

  // T11: HITL handler
  const handleHitl = useCallback(async (logId: number, action: 'CONFIRM_THREAT' | 'FALSE_POSITIVE' | 'REQUEST_MORE_INFO') => {
    try {
      await updateAdminSecurityLog(logId, { action });
      setToast({ type: 'success', text: HITL_ACTION_LABELS[action] });
      loadThreats();
    } catch (err) {
      console.error('HITL action failed', err);
      setToast({ type: 'error', text: 'Failed to record verdict' });
    }
  }, [loadThreats]);

  // T12: selected rows for bulk actions
  const [selectedLogIds, setSelectedLogIds] = useState<Set<number>>(new Set());

  const toggleSelect = (logId: number) => setSelectedLogIds(prev => {
    const next = new Set(prev);
    if (next.has(logId)) next.delete(logId);
    else next.add(logId);
    return next;
  });

  const toggleSelectAll = () => {
    if (selectedLogIds.size === threatLogs.length) setSelectedLogIds(new Set());
    else setSelectedLogIds(new Set(threatLogs.map(l => l.log_id)));
  };

  const handleBulkAction = async (action: 'block_ip' | 'dismiss' | 'false_positive') => {
    const log_ids = Array.from(selectedLogIds);
    if (log_ids.length === 0) return;
    const actionLabel = action === 'block_ip' ? 'Block' : action === 'dismiss' ? 'Dismiss' : 'Mark false positive';
    if (!window.confirm(`${actionLabel} ${log_ids.length} selected alerts?`)) return;
    try {
      await bulkActionSecurityLogs({ log_ids, action, ttl_hours: 24 });
      setSelectedLogIds(new Set());
      setToast({ type: 'success', text: `${action} applied to ${log_ids.length} alerts` });
      loadThreats();
    } catch (err: unknown) {
      const apiErr = err as { detail?: unknown; message?: string };
      const detail = typeof apiErr.detail === 'string' ? apiErr.detail : undefined;
      setToast({ type: 'error', text: detail || apiErr.message || 'Bulk action failed' });
    }
  };

  const handleBlockByFilter = async () => {
    const severityParam = activeSeverities.size > 0 ? Array.from(activeSeverities).join(',') : undefined;
    const filters: SecurityLogFilter = {
      severity: severityParam,
      source_ip: sourceIp.trim() || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      q: searchQ.trim() || undefined,
    };
    try {
      const preview = await blockByFilter(filters, { preview: true });
      let msg = `This will block ${preview.would_block} distinct IPs`;
      if (preview.repeat_offenders && preview.repeat_offenders > 0) {
        msg += `. ${preview.repeat_offenders} are repeat offenders and will be blocked permanently.`;
      }
      if (preview.total_distinct_ips && preview.capped_at && preview.total_distinct_ips > preview.capped_at) {
        msg += `\n\n⚠️ This will block the first ${preview.capped_at} of ${preview.total_distinct_ips} IPs. Run again with a narrower filter for the rest.`;
      }
      if (!window.confirm(msg)) return;
      const result = await blockByFilter(filters, { preview: false });
      setToast({
        type: 'success',
        text: `Blocked ${result.blocked_count} IPs (${result.permanent_count} permanent).${result.capped ? ` Capped at 500 — ${result.total_distinct_ips} total distinct.` : ''}`,
      });
      loadThreats();
      setBlockedIpsKey((k) => k + 1); // force BlockedIpsPanel remount + reload
    } catch (err: unknown) {
      const apiErr = err as { detail?: unknown; message?: string };
      const detail = typeof apiErr.detail === 'string' ? apiErr.detail : undefined;
      setToast({ type: 'error', text: detail || apiErr.message || 'Filter block failed' });
    }
  };

  // T11: Block Source IP handler
  const handleBlockSourceIp = useCallback(async (log: ThreatLogItem) => {
    if (!window.confirm(`Block source IP ${log.source_ip} for 24 hours? A repeat offender will be blocked permanently.`)) return;
    try {
      await blockSourceIp(log.log_id, { ttl_hours: 24 });
      setToast({ type: 'success', text: `Blocked IP ${log.source_ip}` });
      loadThreats();
    } catch (err: unknown) {
      const apiErr = err as { detail?: unknown; message?: string };
      const detail = typeof apiErr.detail === 'string' ? apiErr.detail : undefined;
      setToast({ type: 'error', text: detail || apiErr.message || 'Failed to block IP' });
      console.error('blockSourceIp error', err);
    }
  }, [loadThreats]);

  // T11: Create Incident handler
  const handleCreateIncident = useCallback(async (log: ThreatLogItem) => {
    if (!window.confirm(`Create a DRAFT fire incident from this alert? (log_id: ${log.log_id})`)) return;
    try {
      await createIncidentFromAlert(log.log_id);
      setToast({ type: 'success', text: 'Incident created from alert' });
    } catch (err) {
      console.error('createIncident error', err);
      setToast({ type: 'error', text: 'Failed to create incident' });
    }
  }, []);

  // T11: Dismiss Alert handler
  const handleDismissAlert = useCallback(async (log: ThreatLogItem) => {
    if (!window.confirm('Dismiss this alert? It will be excluded from active threat counts but kept for audit.')) return;
    try {
      await deleteSecurityLog(log.log_id);
      setToast({ type: 'success', text: 'Alert dismissed' });
      loadThreats();
    } catch (err) {
      console.error('deleteSecurityLog error', err);
      setToast({ type: 'error', text: 'Failed to dismiss alert' });
    }
  }, [loadThreats]);

  const toggleNarrative = (logId: number) => {
    setExpandedNarratives((prev) => {
      const next = new Set(prev);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
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

  const totalBySeverity = summary?.by_severity ?? { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  const total = summary?.total ?? 0;
  const unreviewed = summary?.unreviewed_count ?? 0;
  const highCriticalCount = totalBySeverity.HIGH + totalBySeverity.CRITICAL;

  const notableAuditLogs = auditLogs.filter((log) =>
    ['HITL_REVIEW', 'PII_EXPORT', 'PII_ANONYMIZE', 'BREACH_DETECTED'].includes(log.action_type ?? "")
  );

  return (
    <div className="space-y-6">
      <AutoRefreshToast pending={autoRefreshPending} refreshing={autoRefreshing} justRefreshed={autoRefreshDone} />
      {/* T11: Friendly offline-unavailable banner when wrapper throws + we're offline */}
      {offlineUnavailable && (
        <div
          className="card"
          data-testid="offline-unavailable"
          style={{ borderLeft: '4px solid #f59e0b', backgroundColor: '#fffbeb' }}
        >
          <div className="card-body flex items-center gap-3">
            <WifiOff className="w-5 h-5 text-amber-700 flex-shrink-0" />
            <div>
              <div className="text-sm font-semibold text-amber-800">
                Security monitoring data is unavailable offline
              </div>
              <div className="text-xs text-amber-700 mt-1">
                Reconnect to the network to load threat feeds, XAI narratives, and audit highlights.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* T11: Toast notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
            toast.type === 'success' ? 'bg-green-600 text-white' :
            toast.type === 'error' ? 'bg-red-600 text-white' :
            'bg-blue-600 text-white'
          }`}
          data-testid="toast"
          role="alert"
        >
          {toast.text}
        </div>
      )}

      {/* T11: Stale cache banner — pick the most recent cachedAt across all three feeds */}
      {(() => {
        const cachedAts = [summaryCachedAt, threatsCachedAt, auditCachedAt].filter(
          (v): v is number => typeof v === 'number',
        );
        if (cachedAts.length === 0) return null;
        const latest = Math.max(...cachedAts);
        return <StaleCacheBanner freshness={{ cachedAt: latest, isOnline }} />;
      })()}

      {/* Header */}
      <div className="card">
        <div className="card-body flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-red-600" />
            <div>
              <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                Security Monitoring
              </h1>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Real-time threat feed + XAI narratives + audit highlights
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Last refreshed {formatTime(lastRefresh.toISOString())}
            </div>
            <button
              onClick={() => {
                loadMonitoring();
                loadThreats();
              }}
              className="text-sm px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
              style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div
          className="card"
          style={{ borderLeft: '4px solid #dc2626', backgroundColor: '#fef2f2' }}
        >
          <div className="card-body">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <div>
                <div className="text-sm font-semibold text-red-700">
                  Unable to load monitoring data
                </div>
                <div className="text-xs text-red-600 mt-1">
                  {error}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="card-body">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Active Threats
            </div>
            <div className="text-3xl font-bold mt-2" style={{ color: 'var(--text-primary)' }}>
              {summary?.active_count ?? total}
            </div>
            {(summary?.dismissed_count ?? 0) > 0 && (
              <button
                onClick={() => { setShowDismissed(true); setPage(0); }}
                className="text-xs mt-1 underline hover:no-underline cursor-pointer"
                style={{ color: 'var(--text-muted)' }}
              >
                {summary!.dismissed_count} dismissed — click to view
              </button>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Unreviewed
            </div>
            <div className="text-3xl font-bold mt-2 text-orange-600">{unreviewed}</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              High + Critical
            </div>
            <div className="text-3xl font-bold mt-2 text-red-600">{highCriticalCount}</div>
          </div>
        </div>
      </div>

      {/* Severity Distribution Bar */}
      <div className="card">
        <div className="card-body">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
            Severity Distribution
          </div>
          {total === 0 ? (
            <div className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>
              No threats recorded.
            </div>
          ) : (
            <div className="flex w-full h-12 rounded-lg overflow-hidden">
              {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as SeverityLevel[]).map((sev) => {
                const count = totalBySeverity[sev];
                const percent = total > 0 ? (count / total) * 100 : 0;
                if (count === 0) return null;
                return (
                  <div
                    key={sev}
                    className={`${SEVERITY_COLORS[sev]} flex items-center justify-center text-white text-xs font-semibold`}
                    style={{ width: `${percent}%` }}
                    title={`${sev}: ${count}`}
                  >
                    {sev} ({count})
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Severity Filters */}
      <div className="card">
        <div className="card-body">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Filter by Severity
            </div>
            {activeSeverities.size > 0 && (
              <button
                onClick={clearFilters}
                className="text-xs px-3 py-1 rounded-md font-medium transition-colors"
                style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
              >
                Clear Filters
              </button>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as SeverityLevel[]).map((sev) => {
              const active = activeSeverities.has(sev);
              return (
                <button
                  key={sev}
                  onClick={() => toggleSeverity(sev)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                    active ? SEVERITY_BG_COLORS[sev] : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {sev}
                </button>
              );
            })}
          </div>
          {/* T12: S3 — Block all IPs in current filter button */}
          {(activeSeverities.size > 0 || sourceIp || dateFrom || dateTo || searchQ) && (
            <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button
                onClick={handleBlockByFilter}
                data-testid="block-by-filter-btn"
                className="px-3 py-1.5 text-xs font-semibold rounded-md border transition-all"
                style={{ borderColor: 'var(--bfp-maroon)', color: 'var(--bfp-maroon)', backgroundColor: 'transparent' }}
                title="Preview and execute block by current filter"
              >
                Block all IPs in current filter
              </button>
              <span className="ml-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                Preview shows counts before blocking
              </span>
            </div>
          )}
          {/* T12: New filter inputs */}
          <div className="flex gap-3 flex-wrap items-end mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }} htmlFor="filter-source-ip">Source IP</label>
              <input
                id="filter-source-ip"
                type="text"
                placeholder="Filter by source IP"
                value={sourceIp}
                onChange={(e) => { setSourceIp(e.target.value); setPage(0); }}
                className="px-3 py-1.5 rounded-md text-xs border"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }} htmlFor="filter-date-from">From</label>
              <input
                id="filter-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
                className="px-3 py-1.5 rounded-md text-xs border"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }} htmlFor="filter-date-to">To</label>
              <input
                id="filter-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
                className="px-3 py-1.5 rounded-md text-xs border"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }} htmlFor="filter-search">Search</label>
              <input
                id="filter-search"
                type="text"
                placeholder="Search payload or narrative"
                value={searchQ}
                onChange={(e) => { setSearchQ(e.target.value); setPage(0); }}
                className="px-3 py-1.5 rounded-md text-xs border"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)' }}
              />
            </div>
            {/* T15: Show dismissed toggle */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }} aria-hidden="true">&nbsp;</label>
              <button
                onClick={() => { setShowDismissed((v) => !v); setPage(0); }}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  showDismissed
                    ? 'border-[var(--bfp-maroon)] text-[var(--bfp-maroon)] bg-white'
                    : 'border-gray-300 text-gray-500 bg-gray-50'
                }`}
                data-testid="show-dismissed-toggle"
              >
                {showDismissed ? 'Include Dismissed' : 'Dismissed Hidden'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* T12: Bulk action bar */}
      {selectedLogIds.size > 0 && (
        <div
          data-testid="bulk-action-bar"
          className="card"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            borderLeft: `3px solid var(--bfp-maroon)`,
            marginBottom: '0.5rem',
          }}
        >
          <div className="card-body flex items-center gap-3 py-2">
            <span className="text-sm font-bold" style={{ color: 'var(--bfp-maroon)' }}>
              {selectedLogIds.size} selected
            </span>
            <div className="flex-1" />
            <button
              onClick={() => handleBulkAction('block_ip')}
              className="px-3 py-1.5 text-xs font-semibold rounded-md transition-colors"
              style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
            >
              Block Selected IPs
            </button>
            <button
              onClick={() => handleBulkAction('dismiss')}
              className="px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
            >
              Dismiss Selected
            </button>
            <button
              onClick={() => handleBulkAction('false_positive')}
              className="px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
            >
              Mark False Positive
            </button>
            <button
              onClick={() => setSelectedLogIds(new Set())}
              className="px-2 py-1.5 text-xs font-medium rounded-md transition-colors"
              style={{ color: 'var(--text-muted)', backgroundColor: 'transparent' }}
            >
              Clear selection
            </button>
          </div>
        </div>
      )}

      {/* Threat Feed Table */}
      <div className="card overflow-hidden">
        <div className="card-body">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
            Threat Feed
          </div>
        </div>
        {loading ? (
          <div className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>
            Loading threats…
          </div>
        ) : threatLogs.length === 0 ? (
          <div className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>
            No threats found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  style={{
                    backgroundColor: 'var(--table-header-bg)',
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  {/* T12: Select-all checkbox column */}
                  <th className="px-4 py-3 text-left" style={{ width: '48px' }}>
                    <input
                      type="checkbox"
                      onChange={toggleSelectAll}
                      checked={selectedLogIds.size === threatLogs.length && threatLogs.length > 0}
                      data-testid="select-all-checkbox"
                    />
                  </th>
                  <th
                    className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Timestamp
                  </th>
                  <th
                    className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Source IP
                  </th>
                  <th
                    className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Severity
                  </th>
                  <th
                    className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    SID
                  </th>
                  <th
                    className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Status
                  </th>
                  <th
                    className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    XAI Confidence
                  </th>
                  <th
                    className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {threatLogs.map((log) => {
                  const dismissedVals = ['Dismissed', 'False Positive (Dismissed)'];
                  const isDismissedRow = log.admin_action_taken != null && dismissedVals.includes(log.admin_action_taken);
                  return (
                  <tr
                    key={log.log_id}
                    style={{
                      borderBottom: '1px solid var(--border-color)',
                      borderLeft: selectedLogIds.has(log.log_id) ? '3px solid var(--bfp-maroon)' : isDismissedRow ? '3px solid #d1d5db' : '3px solid transparent',
                      backgroundColor: selectedLogIds.has(log.log_id) ? 'var(--table-header-bg)' : undefined,
                      opacity: isDismissedRow ? 0.6 : undefined,
                    }}
                  >
                    {/* T12: Row checkbox */}
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedLogIds.has(log.log_id)}
                        onChange={() => toggleSelect(log.log_id)}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-primary)' }}>
                      {formatTime(log.timestamp)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                      {log.source_ip}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          SEVERITY_BG_COLORS[log.severity_level]
                        }`}
                      >
                        {log.severity_level}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                      {log.suricata_sid}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-primary)' }}>
                      {(() => {
                        const dismissedVals = ['Dismissed', 'False Positive (Dismissed)'];
                        const isDismissed = log.admin_action_taken != null && dismissedVals.includes(log.admin_action_taken);
                        if (isDismissed) {
                          return <span className="text-gray-400 font-medium">{log.admin_action_taken}</span>;
                        }
                        return log.admin_action_taken ? (
                          <span className="text-green-600 font-medium">Reviewed</span>
                        ) : (
                          <span className="text-gray-500">Pending</span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-primary)' }}>
                      {log.xai_confidence != null ? `${(log.xai_confidence * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className="px-4 py-3" style={{ minWidth: '280px' }}>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* HITL 3-button group */}
                        <button
                          onClick={() => handleHitl(log.log_id, 'CONFIRM_THREAT')}
                          className="px-2 py-1 text-[11px] font-semibold rounded border transition-colors"
                          style={{ borderColor: '#22c55e', color: '#16a34a', backgroundColor: '#f0fdf4' }}
                          title="Confirm as real threat"
                        >
                          Confirm Threat
                        </button>
                        <button
                          onClick={() => handleHitl(log.log_id, 'FALSE_POSITIVE')}
                          className="px-2 py-1 text-[11px] font-semibold rounded border transition-colors"
                          style={{ borderColor: '#f59e0b', color: '#d97706', backgroundColor: '#fffbeb' }}
                          title="Mark as false positive"
                        >
                          False Positive
                        </button>
                        <button
                          onClick={() => handleHitl(log.log_id, 'REQUEST_MORE_INFO')}
                          className="px-2 py-1 text-[11px] font-semibold rounded border transition-colors"
                          style={{ borderColor: '#6366f1', color: '#6366f1', backgroundColor: '#eef2ff' }}
                          title="Request more analysis"
                        >
                          Request More Info
                        </button>

                        {/* Block Source IP — primary action, maroon */}
                        <button
                          onClick={() => handleBlockSourceIp(log)}
                          className="px-2 py-1 text-[11px] font-semibold rounded transition-colors"
                          style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
                          title="Block this source IP"
                        >
                          Block Source IP
                        </button>

                        {/* Create Incident — secondary */}
                        <button
                          onClick={() => handleCreateIncident(log)}
                          className="px-2 py-1 text-[11px] font-semibold rounded border transition-colors"
                          style={{ borderColor: 'var(--bfp-maroon)', color: 'var(--bfp-maroon)' }}
                          title="Create DRAFT incident from this alert"
                        >
                          Create Incident
                        </button>

                        {/* Dismiss Alert — ghost */}
                        <button
                          onClick={() => handleDismissAlert(log)}
                          className="px-2 py-1 text-[11px] font-semibold rounded transition-colors"
                          style={{ color: '#dc2626', backgroundColor: 'transparent' }}
                          title="Dismiss this alert (soft-delete, excludes from active counts)"
                        >
                          Dismiss Alert
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && threatLogs.length > 0 && (
          <div className="card-body flex items-center justify-between border-t" style={{ borderColor: 'var(--border-color)' }}>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Page {page + 1} ({PAGE_SIZE} per page)
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * PAGE_SIZE >= totalThreats}
                className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Blocked IPs management panel */}
      <BlockedIpsPanel key={blockedIpsKey} onUnblocked={loadThreats} />

      {/* Recent XAI Narratives */}
      <div className="card">
        <div className="card-body">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
            Recent XAI Narratives
          </div>
          {!summary || summary.recent_narratives.length === 0 ? (
            <div className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>
              No narratives yet.
            </div>
          ) : (
            <div className="space-y-3">
              {summary.recent_narratives.map((narrative) => {
                const parsed = normalizeNarrative(narrative.xai_narrative);
                const hasStructuredFields = parsed.isStructured || parsed.anomalyDescription || parsed.logEvidence || parsed.riskAssessment || parsed.recommendedAction;
                const primaryText = hasStructuredFields
                  ? (parsed.anomalyDescription || parsed.logEvidence || parsed.riskAssessment || parsed.recommendedAction || '')
                  : (narrative.xai_narrative || '');
                const isLong = primaryText.length > 200;
                const isExpanded = expandedNarratives.has(narrative.log_id);

                return (
                <div
                  key={narrative.log_id}
                  className="p-3 rounded-lg"
                  style={{ backgroundColor: 'var(--table-header-bg)', borderLeft: '3px solid var(--bfp-maroon)' }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${
                        SEVERITY_BG_COLORS[narrative.severity_level as SeverityLevel]
                      }`}
                    >
                      {narrative.severity_level}
                    </span>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                      Log #{narrative.log_id}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {formatTime(narrative.timestamp)}
                    </span>
                    {parsed.confidence != null && (
                      <span className="text-xs font-medium text-purple-600">{(parsed.confidence * 100).toFixed(0)}% conf.</span>
                    )}
                  </div>
                  <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    {narrative.xai_narrative ? (
                      hasStructuredFields ? (
                        /* Structured rendering */
                        <div className="space-y-2">
                          {parsed.anomalyDescription && (
                            <div>
                              <span className="text-xs font-semibold text-purple-600">Anomaly: </span>
                              <span>{isExpanded || !isLong ? parsed.anomalyDescription : parsed.anomalyDescription.slice(0, 200) + '…'}</span>
                            </div>
                          )}
                          {(isExpanded || !isLong) && (
                            <>
                              {parsed.riskAssessment && (
                                <div>
                                  <span className="text-xs font-semibold text-orange-600">Risk: </span>
                                  <span>{parsed.riskAssessment}</span>
                                </div>
                              )}
                              {parsed.recommendedAction && (
                                <div>
                                  <span className="text-xs font-semibold text-green-600">Recommendation: </span>
                                  <span>{parsed.recommendedAction}</span>
                                </div>
                              )}
                            </>
                          )}
                          {isLong && (
                            <span
                              className="text-xs text-blue-600 cursor-pointer"
                              onClick={() => toggleNarrative(narrative.log_id)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => e.key === 'Enter' && toggleNarrative(narrative.log_id)}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? 'Show less' : 'Read more'}
                            </span>
                          )}
                        </div>
                      ) : (
                        /* Plain text fallback with truncation */
                        <>
                          {isLong ? (
                            isExpanded ? (
                              <>
                                {narrative.xai_narrative}{' '}
                                <span
                                  className="text-xs text-blue-600 cursor-pointer"
                                  onClick={() => toggleNarrative(narrative.log_id)}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => e.key === 'Enter' && toggleNarrative(narrative.log_id)}
                                  aria-expanded="true"
                                >
                                  Show less
                                </span>
                              </>
                            ) : (
                              <>
                                {narrative.xai_narrative!.slice(0, 200)}…{' '}
                                <span
                                  className="text-xs text-blue-600 cursor-pointer"
                                  onClick={() => toggleNarrative(narrative.log_id)}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => e.key === 'Enter' && toggleNarrative(narrative.log_id)}
                                  aria-expanded="false"
                                >
                                  Read more
                                </span>
                              </>
                            )
                          ) : (
                            narrative.xai_narrative
                          )}
                        </>
                      )
                    ) : (
                      <span className="text-gray-500 italic">No narrative available</span>
                    )}
                  </div>
                </div>
              );})}
            </div>
          )}
        </div>
      </div>

      {/* Audit Highlights */}
      <div className="card">
        <div className="card-body">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
            Audit Highlights
          </div>
          {notableAuditLogs.length === 0 ? (
            <div className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>
              No notable events.
            </div>
          ) : (
            <div className="space-y-2">
              {notableAuditLogs.slice(0, 10).map((log) => (
                <div
                  key={log.audit_id}
                  className="flex items-center gap-3 p-2 rounded-lg"
                  style={{ backgroundColor: 'var(--table-header-bg)' }}
                >
                  <div className="flex-shrink-0">
                    {log.action_type === 'BREACH_DETECTED' ? (
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                    ) : (
                      <Info className="w-4 h-4 text-blue-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {log.action_type}
                      </span>
                      {log.table_affected && (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          on {log.table_affected}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {log.timestamp ? formatTime(log.timestamp) : "N/A"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
