'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  fetchAnomalies,
  updateAnomalyStatus,
  type AnomalyDetectionItem,
} from '@/lib/api/legacy';
import { ShieldAlert, RefreshCw, CheckCircle, Clock, AlertTriangle } from 'lucide-react';

type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type AnomalyStatus = 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED';

const SEVERITY_BG_COLORS: Record<SeverityLevel, string> = {
  LOW: 'bg-blue-100 text-blue-800',
  MEDIUM: 'bg-yellow-100 text-yellow-800',
  HIGH: 'bg-orange-100 text-orange-800',
  CRITICAL: 'bg-red-100 text-red-800',
};

const STATUS_BG_COLORS: Record<AnomalyStatus, string> = {
  NEW: 'bg-red-100 text-red-800',
  ACKNOWLEDGED: 'bg-yellow-100 text-yellow-800',
  RESOLVED: 'bg-green-100 text-green-800',
};

const STATUS_LABELS: Record<AnomalyStatus, string> = {
  NEW: 'New',
  ACKNOWLEDGED: 'Acknowledged',
  RESOLVED: 'Resolved',
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

export default function AnomalyDetectionPage() {
  const { user, loading: authLoading } = useAuth();
  const role = (user as { role?: string })?.role ?? null;
  const isAdmin = role === 'SYSTEM_ADMIN';

  const [anomalies, setAnomalies] = useState<AnomalyDetectionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AnomalyStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [page, setPage] = useState(0);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  // Aggregate data from API for summary cards and dynamic filter options
  const [counts, setCounts] = useState<Record<string, number>>({ NEW: 0, ACKNOWLEDGED: 0, RESOLVED: 0 });
  const [typeFacets, setTypeFacets] = useState<Array<{ type: string; count: number }>>([]);

  const PAGE_SIZE = 20;

  const loadAnomalies = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAnomalies({
        status: statusFilter || undefined,
        severity: severityFilter || undefined,
        anomaly_type: typeFilter || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setAnomalies(result.items);
      setTotal(result.total);
      setCounts(result.counts ?? { NEW: 0, ACKNOWLEDGED: 0, RESOLVED: 0 });
      setTypeFacets(result.type_facets ?? []);
    } catch (err) {
      console.error('loadAnomalies error', err);
      setError(err instanceof Error ? err.message : 'Failed to load anomaly data');
      setAnomalies([]);
      setTotal(0);
      setCounts({ NEW: 0, ACKNOWLEDGED: 0, RESOLVED: 0 });
      setTypeFacets([]);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, statusFilter, typeFilter, severityFilter, page]);

  useEffect(() => {
    loadAnomalies();
  }, [loadAnomalies]);

  useEffect(() => {
    const interval = setInterval(loadAnomalies, 60_000);
    return () => clearInterval(interval);
  }, [loadAnomalies]);

  const handleAcknowledge = async (anomalyId: number) => {
    setUpdatingId(anomalyId);
    try {
      await updateAnomalyStatus(anomalyId, 'ACKNOWLEDGED');
      await loadAnomalies();
    } catch (err) {
      console.error('acknowledge error', err);
      setError(err instanceof Error ? err.message : 'Failed to acknowledge anomaly');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleResolve = async (anomalyId: number) => {
    setUpdatingId(anomalyId);
    try {
      await updateAnomalyStatus(anomalyId, 'RESOLVED');
      await loadAnomalies();
    } catch (err) {
      console.error('resolve error', err);
      setError(err instanceof Error ? err.message : 'Failed to resolve anomaly');
    } finally {
      setUpdatingId(null);
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

  // Summary counts — sourced from API aggregate, not current-page items
  const newCount = counts.NEW ?? 0;
  const ackCount = counts.ACKNOWLEDGED ?? 0;
  const resolvedCount = counts.RESOLVED ?? 0;
  const hasAnyFilters = statusFilter !== '' || typeFilter !== '' || severityFilter !== '';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card">
        <div className="card-body flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-red-600" />
            <div>
              <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                Anomaly Detection
              </h1>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Review and manage behavioral anomaly detections (NEW → ACKNOWLEDGED → RESOLVED)
              </p>
            </div>
          </div>
          <button
            onClick={loadAnomalies}
            className="text-sm px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
            style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
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
              <div className="text-sm text-red-700">{error}</div>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="card-body">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              New
            </div>
            <div className="text-3xl font-bold mt-2 text-red-600">{newCount}</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Acknowledged
            </div>
            <div className="text-3xl font-bold mt-2 text-yellow-600">{ackCount}</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Resolved
            </div>
            <div className="text-3xl font-bold mt-2 text-green-600">{resolvedCount}</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="card-body">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Filters
            </div>
            {/* Status filter chips */}
            <div className="flex gap-2">
              {(['', 'NEW', 'ACKNOWLEDGED', 'RESOLVED'] as const).map((s) => {
                const active = statusFilter === s;
                return (
                  <button
                    key={s || 'all'}
                    onClick={() => { setStatusFilter(s); setPage(0); }}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      active
                        ? (s === '' ? 'bg-gray-700 text-white' : STATUS_BG_COLORS[s])
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {s === '' ? 'All' : STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>
            {/* Type filter — dynamic from API type_facets */}
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
            >
              <option value="">All Types</option>
              {typeFacets.map((f) => (
                <option key={f.type} value={f.type}>
                  {f.type.replace(/_/g, ' ')} ({f.count})
                </option>
              ))}
            </select>
            {/* Severity filter */}
            <select
              value={severityFilter}
              onChange={(e) => { setSeverityFilter(e.target.value); setPage(0); }}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
            >
              <option value="">All Severities</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>
        </div>
      </div>

      {/* Anomalies Table */}
      <div className="card overflow-hidden">
        <div className="card-body">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
            Anomaly Detections ({total} total)
          </div>
        </div>
        {loading ? (
          <div className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>
            Loading anomalies…
          </div>
        ) : anomalies.length === 0 ? (
          <div className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>
            {total === 0 && !hasAnyFilters ? (
              <div className="space-y-2">
                <p>No anomaly detections exist yet.</p>
                <p className="text-xs">
                  Run <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">
                    ./scripts/seed-anomaly-detections.sh
                  </code>{' '}
                  to seed test data, or wait for the Celery anomaly detector to populate results.
                </p>
              </div>
            ) : (
              <p>No anomalies match the current filters. Try adjusting your filter selection.</p>
            )}
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
                  <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>ID</th>
                  <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Type</th>
                  <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Severity</th>
                  <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Detected</th>
                  <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Details</th>
                  <th className="px-4 py-3 text-right font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.map((anomaly) => {
                  const sev = anomaly.severity as SeverityLevel;
                  const st = anomaly.status as AnomalyStatus;
                  return (
                    <tr key={anomaly.anomaly_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                        #{anomaly.anomaly_id}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {anomaly.anomaly_type.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${SEVERITY_BG_COLORS[sev] || 'bg-gray-100 text-gray-800'}`}>
                          {sev}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BG_COLORS[st] || 'bg-gray-100 text-gray-800'}`}>
                          {st === 'NEW' && <Clock className="w-3 h-3" />}
                          {st === 'ACKNOWLEDGED' && <AlertTriangle className="w-3 h-3" />}
                          {st === 'RESOLVED' && <CheckCircle className="w-3 h-3" />}
                          {STATUS_LABELS[st] || st}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-primary)' }}>
                        {anomaly.detected_at ? formatTime(anomaly.detected_at) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)', maxWidth: '200px' }}>
                        <DetailsPreview details={anomaly.details} anomalyType={anomaly.anomaly_type} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {st === 'NEW' && (
                            <button
                              onClick={() => handleAcknowledge(anomaly.anomaly_id)}
                              disabled={updatingId === anomaly.anomaly_id}
                              className="text-xs px-3 py-1 rounded font-medium text-white bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 transition-colors"
                            >
                              {updatingId === anomaly.anomaly_id ? '…' : 'Acknowledge'}
                            </button>
                          )}
                          {st === 'ACKNOWLEDGED' && (
                            <button
                              onClick={() => handleResolve(anomaly.anomaly_id)}
                              disabled={updatingId === anomaly.anomaly_id}
                              className="text-xs px-3 py-1 rounded font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 transition-colors"
                            >
                              {updatingId === anomaly.anomaly_id ? '…' : 'Resolve'}
                            </button>
                          )}
                          {st === 'RESOLVED' && (
                            <span className="text-xs text-green-600 font-medium">Resolved</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && anomalies.length > 0 && (
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
                disabled={(page + 1) * PAGE_SIZE >= total}
                className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Render a compact preview of the anomaly details JSON */
function DetailsPreview({ details, anomalyType }: { details: Record<string, unknown>; anomalyType: string }) {
  if (!details || Object.keys(details).length === 0) return <span className="text-gray-400">—</span>;

  const parts: string[] = [];
  if (anomalyType === 'BULK_DELETE' && typeof details.count === 'number') {
    parts.push(`Count: ${details.count}`);
  }
  if (anomalyType === 'OFF_HOURS' && typeof details.action_type === 'string') {
    parts.push(`${details.action_type}`);
  }
  if (anomalyType === 'PRIVILEGE_ESCALATION' && typeof details.action_type === 'string') {
    parts.push(`${details.action_type}`);
  }
  if (anomalyType === 'RAPID_IP_SWITCH' && typeof details.distinct_ip_count === 'number') {
    parts.push(`${details.distinct_ip_count} IPs`);
  }
  if (anomalyType === 'RAPID_IP_SWITCH' && Array.isArray(details.ips)) {
    parts.push(`IPs: ${(details.ips as string[]).slice(0, 2).join(', ')}`);
  }

  return <span>{parts.length > 0 ? parts.join(' · ') : '—'}</span>;
}
