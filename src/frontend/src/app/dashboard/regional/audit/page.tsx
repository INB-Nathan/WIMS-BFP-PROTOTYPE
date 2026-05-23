'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

interface EncoderAuditEntry {
  history_id: number;
  incident_id: number;
  action_label: string | null;
  previous_status: string | null;
  new_status: string | null;
  notes: string | null;
  action_timestamp: string | null;
}

interface EncoderAuditResponse {
  items: EncoderAuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

const ACTION_OPTIONS = [
  { value: '', label: 'Any action' },
  { value: 'CREATED_DRAFT', label: 'Created Draft' },
  { value: 'EDITED', label: 'Edited' },
  { value: 'SUBMITTED', label: 'Submitted for Review' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
  { value: 'DELETED_DRAFT', label: 'Deleted Draft' },
  { value: 'DELETED_PENDING', label: 'Deleted Pending' },
];

const ACTION_LABEL_MAP: Record<string, string> = {
  CREATED_DRAFT: 'Created Draft',
  EDITED: 'Edited',
  DELETED_DRAFT: 'Deleted Draft',
  DELETED_PENDING: 'Deleted Pending Submission',
  SUBMITTED: 'Submitted for Review',
  WITHDRAWN: 'Withdrawn',
};

const PAGE_SIZE = 15;

export default function EncoderAuditPage() {
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
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-baseline justify-between mb-2">
        <h1 className="text-2xl font-bold">My Activity Log</h1>
        <Link
          href="/dashboard/regional"
          className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium bg-yellow-400 text-gray-900 hover:bg-yellow-500 transition-colors"
        >
          ← Back to Dashboard
        </Link>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        A record of every action you have taken on your incidents.
      </p>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4 text-sm">
        <label className="flex flex-col">
          <span className="text-xs text-gray-600">From</span>
          <input
            type="date"
            className="border rounded px-2 py-1.5"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-gray-600">To</span>
          <input
            type="date"
            className="border rounded px-2 py-1.5"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-gray-600">Action</span>
          <select
            className="border rounded px-2 py-1.5"
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(0); }}
          >
            {ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-gray-600">City / Municipality</span>
          <input
            type="text"
            className="border rounded px-2 py-1.5"
            placeholder="partial match"
            value={cityFilter}
            onChange={(e) => { setCityFilter(e.target.value); setPage(0); }}
          />
        </label>
      </div>

      <button
        onClick={() => { setPage(0); load(); }}
        className="bg-gray-100 hover:bg-gray-200 border rounded px-4 py-2 text-sm mb-4"
      >
        ↺ Refresh
      </button>

      {loading && (
        <div className="text-gray-400 text-sm py-12 text-center">Loading…</div>
      )}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm mb-4">
          {error}
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="text-gray-400 text-sm py-12 text-center border border-dashed rounded">
          No activity recorded yet.
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Date &amp; Time</th>
                <th className="text-left px-3 py-2 font-medium">Incident</th>
                <th className="text-left px-3 py-2 font-medium">Action</th>
                <th className="text-left px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((it) => (
                <tr key={it.history_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                    {it.action_timestamp
                      ? new Date(it.action_timestamp).toLocaleString('en-PH', {
                          timeZone: 'Asia/Manila',
                          year: 'numeric', month: '2-digit', day: '2-digit',
                          hour: '2-digit', minute: '2-digit', hour12: false,
                        })
                      : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    <Link
                      href={`/dashboard/regional/incidents/${it.incident_id}`}
                      className="text-blue-700 hover:underline"
                    >
                      #{it.incident_id}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {ACTION_LABEL_MAP[it.action_label ?? ''] ?? it.action_label ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{it.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-4 mt-4 text-sm text-gray-600">
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          className="px-3 py-1 border rounded disabled:opacity-40"
        >
          ← Prev
        </button>
        <span>
          Page {page + 1} of {totalPages} ({total} entries)
        </span>
        <button
          onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          disabled={page >= totalPages - 1}
          className="px-3 py-1 border rounded disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
