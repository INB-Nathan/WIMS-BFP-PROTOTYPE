'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useNetworkStatus } from '@/lib/useNetworkStatus';
import { getConnectivitySnapshot, subscribeConnectivity, probeConnectivity } from '@/lib/connectivity';
import { fetchAuditLogsOfflineAware } from '@/lib/api';
import type { AuditLogEntry } from '@/types/api';
import {
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const PAGE_SIZE = 50;

function formatLastCheckedAgo(checkedAt: Date | null): string | null {
  if (!checkedAt) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - checkedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ago`;
}

const KNOWN_ACTION_TYPES = [
  'LOGIN',
  'LOGOUT',
  'CREATE_USER',
  'UPDATE_USER',
  'DEACTIVATE_USER',
  'HITL_REVIEW',
  'CREATE_INCIDENT_FROM_ALERT',
  'BREACH_DETECTED',
  'BREACH_STATUS_UPDATE',
  'ANOMALY_ACK',
  'ANOMALY_RESOLVE',
  'BACKUP_CREATED',
  'BACKUP_DOWNLOADED',
  'PII_ANONYMIZE',
  'INCIDENT_UPDATE',
  'INCIDENT_DELETE',
  'UPLOAD_BUNDLE',
  'CIVILIAN_FOLLOWUP',
];

const KNOWN_TABLES = [
  'users',
  'security_threat_logs',
  'breach_notifications',
  'anomaly_detections',
  'incidents',
  'system_audit_trails',
  'scheduled_reports',
  'privacy_exports',
];

export default function AdminAuditPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const role = (user as { role?: string })?.role ?? null;

  const networkStatus = useNetworkStatus();
  const [connectivitySnapshot, setConnectivitySnapshot] = useState(getConnectivitySnapshot);

  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  // Filter state
  const [q, setQ] = useState('');
  const [userId, setUserId] = useState('');
  const [actionType, setActionType] = useState('');
  const [tableAffected, setTableAffected] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [offset, setOffset] = useState(0);

  // Expanded rows for old/new values
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // Redirect non-admins
  useEffect(() => {
    if (!authLoading && role !== 'SYSTEM_ADMIN') {
      router.replace('/dashboard');
    }
  }, [authLoading, role, router]);

  // Connectivity subscription
  useEffect(() => {
    setConnectivitySnapshot(getConnectivitySnapshot());
    const unsubscribe = subscribeConnectivity(() => {
      setConnectivitySnapshot(getConnectivitySnapshot());
    });
    probeConnectivity();
    return unsubscribe;
  }, []);

  const buildParams = useCallback((): {
    limit: number;
    offset: number;
    q?: string;
    user_id?: string;
    action_type?: string;
    table_affected?: string;
    ip_address?: string;
    date_from?: string;
    date_to?: string;
  } => {
    const params: ReturnType<typeof buildParams> = { limit: PAGE_SIZE, offset };
    const trimmedQ = q.trim();
    if (trimmedQ) params.q = trimmedQ;
    const trimmedUserId = userId.trim();
    if (trimmedUserId) params.user_id = trimmedUserId;
    if (actionType) params.action_type = actionType;
    if (tableAffected) params.table_affected = tableAffected;
    const trimmedIp = ipAddress.trim();
    if (trimmedIp) params.ip_address = trimmedIp;
    const trimmedFrom = dateFrom.trim();
    if (trimmedFrom) params.date_from = trimmedFrom;
    const trimmedTo = dateTo.trim();
    if (trimmedTo) params.date_to = trimmedTo;
    return params;
  }, [q, userId, actionType, tableAffected, ipAddress, dateFrom, dateTo, offset]);

  const loadAuditLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = buildParams();
      const { response, fromCache: cached, cachedAt } = await fetchAuditLogsOfflineAware(params);
      setItems(response.items);
      setTotal(response.total);
      setFromCache(cached);
      setLastChecked(cachedAt ? new Date(cachedAt) : new Date());
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? 'Failed to load audit logs');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  // Load on mount and when params change
  useEffect(() => {
    if (role === 'SYSTEM_ADMIN') {
      loadAuditLogs();
    }
  }, [role, loadAuditLogs]);

  const handleApplyFilters = () => {
    setOffset(0);
    // loadAuditLogs will be triggered by the useEffect due to state changes
  };

  const handleClearFilters = () => {
    setQ('');
    setUserId('');
    setActionType('');
    setTableAffected('');
    setIpAddress('');
    setDateFrom('');
    setDateTo('');
    setOffset(0);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleApplyFilters();
  };

  const toggleRowExpand = (auditId: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(auditId)) next.delete(auditId);
      else next.add(auditId);
      return next;
    });
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const hasActiveFilters = !!(q.trim() || userId.trim() || actionType || tableAffected || ipAddress.trim() || dateFrom.trim() || dateTo.trim());

  const isOffline = !networkStatus.isOnline || connectivitySnapshot.state === 'offline';

  // Auth loading guard
  if (authLoading || role !== 'SYSTEM_ADMIN') {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-gray-500">
        {authLoading ? 'Loading…' : 'Redirecting…'}
      </div>
    );
  }

  return (
    <div className="space-y-6 px-4 py-6 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>System Audit Logs</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Complete audit trail of all administrative actions and security events.
        </p>
      </div>

      {isOffline && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          {!networkStatus.isOnline
            ? 'You are offline — showing cached data'
            : 'Backend unreachable — showing cached data'}
        </div>
      )}

      {/* Filter bar */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-3 items-end">
          {/* Full-text search */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <div className="flex gap-2">
              <input
                type="text"
                aria-label="Full-text search audit logs"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search audit trail (action, table, user agent…)"
                className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
              />
              <button
                type="submit"
                className="flex items-center gap-1 px-3 py-1.5 rounded text-sm text-white"
                style={{ backgroundColor: 'var(--sidebar-bg)' }}
                aria-label="Search audit logs"
              >
                <Search className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Action Type */}
          <div className="min-w-[160px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Action Type</label>
            <input
              type="text"
              aria-label="Filter by action type"
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              placeholder="e.g. HITL_REVIEW"
              list="action-type-list"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
            />
            <datalist id="action-type-list">
              {KNOWN_ACTION_TYPES.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>

          {/* Table Affected */}
          <div className="min-w-[160px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Table</label>
            <input
              type="text"
              aria-label="Filter by table affected"
              value={tableAffected}
              onChange={(e) => setTableAffected(e.target.value)}
              placeholder="e.g. users"
              list="table-affected-list"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
            />
            <datalist id="table-affected-list">
              {KNOWN_TABLES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>

          {/* User ID */}
          <div className="min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">User ID</label>
            <input
              type="text"
              aria-label="Filter by user ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="UUID…"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
            />
          </div>

          {/* IP Address */}
          <div className="min-w-[160px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">IP Address</label>
            <input
              type="text"
              aria-label="Filter by IP address"
              value={ipAddress}
              onChange={(e) => setIpAddress(e.target.value)}
              placeholder="e.g. 192.168.1.1"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
            />
          </div>

          {/* Date From */}
          <div className="min-w-[140px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Date From</label>
            <input
              type="text"
              aria-label="Filter by date from"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              placeholder="YYYY-MM-DD"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
            />
          </div>

          {/* Date To */}
          <div className="min-w-[140px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Date To</label>
            <input
              type="text"
              aria-label="Filter by date to"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              placeholder="YYYY-MM-DD"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-end gap-2 pb-0.5">
            <button
              type="submit"
              className="px-4 py-1.5 rounded-md text-sm font-medium text-white"
              style={{ backgroundColor: 'var(--sidebar-bg)' }}
            >
              Apply Filters
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200"
              >
                Clear Filters
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Cache indicator + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {fromCache && <span className="text-xs italic text-amber-600">(cached)</span>}
          {fromCache && lastChecked && (
            <span className="text-xs text-gray-400">Last checked: {formatLastCheckedAgo(lastChecked)}</span>
          )}
        </div>
        <button
          onClick={loadAuditLogs}
          disabled={loading}
          className="flex items-center gap-1 text-sm font-medium disabled:opacity-50"
          style={{ color: 'var(--bfp-maroon)' }}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Error state */}
      {error && !loading && (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[180px]">
                  Timestamp
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Action
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Table
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Record ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  IP Address
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User Agent
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                /* Loading skeleton */
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skel-${i}`} className="animate-pulse">
                    <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-32" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-48" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-24" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-28" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-12" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-28" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-40" /></td>
                  </tr>
                ))
              ) : items.length === 0 ? (
                /* Empty state */
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                    {hasActiveFilters
                      ? 'No audit entries match the current filters.'
                      : 'No audit entries found.'}
                  </td>
                </tr>
              ) : (
                items.map((a) => {
                  const expanded = expandedRows.has(a.audit_id);
                  const hasValues = !!(a.old_values && Object.keys(a.old_values).length > 0) ||
                    !!(a.new_values && Object.keys(a.new_values).length > 0);
                  return (
                    <React.Fragment key={a.audit_id}>
                      <tr
                        className={`hover:bg-gray-50 ${hasValues ? 'cursor-pointer' : ''}`}
                        onClick={() => hasValues && toggleRowExpand(a.audit_id)}
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                          {a.timestamp ? new Date(a.timestamp).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-600 max-w-[200px] truncate" title={a.user_id ?? undefined}>
                          {a.user_id ?? '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                            a.action_type === 'HITL_REVIEW' ? 'bg-blue-100 text-blue-800' :
                            a.action_type === 'CREATE_INCIDENT_FROM_ALERT' ? 'bg-orange-100 text-orange-800' :
                            a.action_type === 'BREACH_DETECTED' ? 'bg-red-100 text-red-800' :
                            a.action_type?.startsWith('ANOMALY_') ? 'bg-purple-100 text-purple-800' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {a.action_type ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                          {a.table_affected ?? '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                          {a.record_id ?? '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-500">
                          {a.ip_address ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-400 max-w-[250px] truncate" title={a.user_agent ?? undefined}>
                          {a.user_agent
                            ? a.user_agent.length > 60
                              ? `${a.user_agent.substring(0, 60)}…`
                              : a.user_agent
                            : '—'}
                        </td>
                      </tr>
                      {/* Expanded values row */}
                      {expanded && hasValues && (
                        <tr className="bg-gray-50">
                          <td colSpan={7} className="px-6 py-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {a.old_values && Object.keys(a.old_values).length > 0 && (
                                <div>
                                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Old Values</h4>
                                  <pre className="text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto max-h-40 font-mono text-gray-700">
                                    {JSON.stringify(a.old_values, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {a.new_values && Object.keys(a.new_values).length > 0 && (
                                <div>
                                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">New Values</h4>
                                  <pre className="text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto max-h-40 font-mono text-gray-700">
                                    {JSON.stringify(a.new_values, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {!loading && total > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500">
            Showing {Math.min(offset + 1, total)}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOffset((p) => Math.max(0, p - PAGE_SIZE))}
              disabled={offset === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 border border-gray-300 hover:bg-gray-100"
            >
              <ChevronLeft className="w-4 h-4" /> Previous
            </button>
            <span className="text-xs text-gray-500 px-2">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setOffset((p) => p + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 border border-gray-300 hover:bg-gray-100"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
