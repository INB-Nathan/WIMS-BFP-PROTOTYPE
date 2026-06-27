'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, WifiOff } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useNetworkStatus } from '@/lib/useNetworkStatus';

interface EncoderAuditEntry {
  history_id: number | string;
  incident_id: number | null;
  action_label: string | null;
  previous_status: string | null;
  new_status: string | null;
  notes: string | null;
  action_timestamp: string | null;
  ip_address: string | null;
}

interface EncoderAuditResponse {
  items: EncoderAuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

const ACTION_OPTIONS = [
  { value: '', label: 'Any action' },
  { value: 'LOGIN', label: 'Login' },
  { value: 'CREATED_DRAFT', label: 'Created Draft' },
  { value: 'EDITED', label: 'Edited' },
  { value: 'SUBMITTED', label: 'Submitted for Review' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
  { value: 'DELETED_DRAFT', label: 'Deleted Draft' },
  { value: 'DELETED_PENDING', label: 'Deleted Pending' },
];

const ACTION_LABEL_MAP: Record<string, string> = {
  LOGIN: 'Login',
  CREATED_DRAFT: 'Created Draft',
  EDITED: 'Edited',
  DELETED_DRAFT: 'Deleted Draft',
  DELETED_PENDING: 'Deleted Pending',
  SUBMITTED: 'Submitted for Review',
  WITHDRAWN: 'Withdrawn',
};

const ACTION_BADGE_STYLE: Record<string, React.CSSProperties> = {
  LOGIN: { backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
  SUBMITTED: { backgroundColor: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' },
  CREATED_DRAFT: { backgroundColor: '#f9fafb', color: '#374151', border: '1px solid #d1d5db' },
  EDITED: { backgroundColor: '#fefce8', color: '#854d0e', border: '1px solid #fef08a' },
  WITHDRAWN: { backgroundColor: '#fff7ed', color: '#9a3412', border: '1px solid #fed7aa' },
  DELETED_DRAFT: { backgroundColor: '#fef2f2', color: '#1A3263', border: '1px solid #fecaca' },
  DELETED_PENDING: { backgroundColor: '#fef2f2', color: '#1A3263', border: '1px solid #fecaca' },
};

const PAGE_SIZE = 15;

export default function EncoderAuditPage() {
  const { isOnline, isChecking } = useNetworkStatus();
  const [items, setItems] = useState<EncoderAuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const p = new URLSearchParams();
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    if (actionFilter) p.set('action', actionFilter);
    if (cityFilter.trim()) p.set('city_municipality', cityFilter.trim());
    p.set('limit', String(PAGE_SIZE));
    p.set('offset', String(page * PAGE_SIZE));
    try {
      const res = await apiFetch<EncoderAuditResponse>(
        `/regional/audit-log?${p.toString()}`,
      );
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, actionFilter, cityFilter, page]);

  useEffect(() => {
    if (isOnline) load();
  }, [load, isOnline]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (!isChecking && !isOnline) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center p-8">
        <WifiOff className="w-12 h-12 text-gray-300" />
        <h2 className="text-lg font-semibold text-gray-600">Activity Log Unavailable Offline</h2>
        <p className="text-sm text-gray-400 max-w-xs">
          Your activity log is stored on the server and requires a live connection to display.
          Connect to the network to view your history.
        </p>
        <Link
          href="/dashboard/regional"
          className="text-sm font-medium px-4 py-2 rounded-lg text-white"
          style={{ backgroundColor: 'var(--bfp-maroon)' }}
        >
          â† Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="card overflow-hidden">
        <div
          className="card-header flex items-center gap-2"
          style={{ borderLeft: '4px solid var(--sidebar-bg)' }}
        >
          <FileText className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
          <span>My Activity Log</span>
        </div>

        <div className="card-body">
          <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
            Every action you have taken on your incidents, including logins.
          </p>

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4 text-sm">
            <label className="flex flex-col">
              <span className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>From</span>
              <input
                type="date"
                className="border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
              />
            </label>
            <label className="flex flex-col">
              <span className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>To</span>
              <input
                type="date"
                className="border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
              />
            </label>
            <label className="flex flex-col">
              <span className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Action</span>
              <select
                className="border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                value={actionFilter}
                onChange={(e) => { setActionFilter(e.target.value); setPage(0); }}
              >
                {ACTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col">
              <span className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>City / Municipality</span>
              <input
                type="text"
                className="border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                placeholder="partial match"
                value={cityFilter}
                onChange={(e) => { setCityFilter(e.target.value); setPage(0); }}
              />
            </label>
          </div>

          <div className="flex gap-2 mb-4">
            <button
              onClick={() => { setPage(0); load(); }}
              className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
            >
              â†º Refresh
            </button>
          </div>

          {loading && (
            <div className="text-sm py-12 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</div>
          )}
          {error && !loading && (
            <div className="rounded-md p-3 text-sm mb-4" style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
              {error}
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="text-sm py-12 text-center" style={{ color: 'var(--text-muted)' }}>
              No activity recorded yet.
            </div>
          )}

          {!loading && items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date &amp; Time</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Incident</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {items.map((it) => (
                    <tr key={String(it.history_id)} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-sm whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                        {it.action_timestamp
                          ? new Date(it.action_timestamp).toLocaleString('en-PH', {
                              timeZone: 'Asia/Manila',
                              year: 'numeric', month: '2-digit', day: '2-digit',
                              hour: '2-digit', minute: '2-digit', hour12: false,
                            })
                          : '—'}
                      </td>
                      <td className="px-6 py-3 text-sm font-mono">
                        {it.incident_id != null ? (
                          <Link
                            href={`/dashboard/regional/incidents/${it.incident_id}`}
                            className="hover:underline"
                            style={{ color: 'var(--bfp-maroon)' }}
                          >
                            #{it.incident_id}
                          </Link>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-sm">
                        <span
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                          style={ACTION_BADGE_STYLE[it.action_label ?? ''] ?? { backgroundColor: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' }}
                        >
                          {ACTION_LABEL_MAP[it.action_label ?? ''] ?? it.action_label ?? '—'}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>
                        {it.ip_address ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center gap-4 mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 border rounded disabled:opacity-40"
              style={{ borderColor: 'var(--border-color)' }}
            >
              â† Prev
            </button>
            <span>
              Page {page + 1} of {totalPages} ({total} entries)
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1 border rounded disabled:opacity-40"
              style={{ borderColor: 'var(--border-color)' }}
            >
              Next →
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

