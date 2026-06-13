'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AuditLogEntry } from '@/types/api';
import { useAuth } from '@/context/AuthContext';
import {
  fetchAdminSecurityLogs,
  fetchSecurityLogsSummary,
  fetchAuditLogs,
  type SecurityLogsSummary,
} from '@/lib/api/legacy';
import { ShieldAlert, RefreshCw, AlertTriangle, Info } from 'lucide-react';

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
  const { user } = useAuth();
  const role = (user as { role?: string })?.role ?? null;
  const isAdmin = role === 'SYSTEM_ADMIN';

  const [summary, setSummary] = useState<SecurityLogsSummary | null>(null);
  const [threatLogs, setThreatLogs] = useState<ThreatLogItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSeverities, setActiveSeverities] = useState<Set<SeverityLevel>>(new Set());
  const [page, setPage] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);
  const [totalThreats, setTotalThreats] = useState<number>(0);

  const PAGE_SIZE = 20;

  const loadMonitoring = useCallback(async () => {
    if (!isAdmin) return;

    setError(null);
    try {
      const [summaryData, auditData] = await Promise.all([
        fetchSecurityLogsSummary(),
        fetchAuditLogs({ limit: 50 }),
      ]);

      setSummary(summaryData);
      setAuditLogs(auditData.items);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('loadMonitoring error', err);
      setSummary(null);
      setError(err instanceof Error ? err.message : 'Failed to load monitoring data');
    }
  }, [isAdmin]);

  const loadThreats = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const severityParam = activeSeverities.size > 0 ? Array.from(activeSeverities).join(',') : undefined;
      const result = await fetchAdminSecurityLogs({
        severity: severityParam,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setThreatLogs(result.items as ThreatLogItem[]);
      setTotalThreats(result.total);
    } catch (err) {
      console.error('loadThreats error', err);
      setError(err instanceof Error ? err.message : 'Failed to load threat data');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, activeSeverities, page]);

  useEffect(() => {
    loadMonitoring();
    loadThreats();
  }, [loadMonitoring, loadThreats]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadMonitoring();
      loadThreats();
    }, 30_000);
    return () => clearInterval(interval);
  }, [loadMonitoring, loadThreats]);

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
    setPage(0);
  };

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
              Total Threats
            </div>
            <div className="text-3xl font-bold mt-2" style={{ color: 'var(--text-primary)' }}>
              {total}
            </div>
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
        </div>
      </div>

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
                </tr>
              </thead>
              <tbody>
                {threatLogs.map((log) => (
                  <tr key={log.log_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
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
                      {log.admin_action_taken ? (
                        <span className="text-green-600 font-medium">Reviewed</span>
                      ) : (
                        <span className="text-gray-500">Pending</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-primary)' }}>
                      {log.xai_confidence != null ? `${(log.xai_confidence * 100).toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                ))}
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
              {summary.recent_narratives.map((narrative) => (
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
                  </div>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    {narrative.xai_narrative ? (
                      narrative.xai_narrative.length > 200 ? (
                        <>
                          {narrative.xai_narrative.slice(0, 200)}…{' '}
                          <span className="text-xs text-blue-600 cursor-pointer">Read more</span>
                        </>
                      ) : (
                        narrative.xai_narrative
                      )
                    ) : (
                      <span className="text-gray-500 italic">No narrative available</span>
                    )}
                  </p>
                </div>
              ))}
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
