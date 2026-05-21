'use client';

/**
 * /dashboard/validator/audit — M4-I.
 *
 * Searchable, filterable view of wims.incident_verification_history with
 * CSV export. NATIONAL_VALIDATOR only.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { PH_REGIONS } from '@/lib/ph-regions';

interface AuditEntry {
  history_id: number;
  incident_id: number;
  region_id: number | null;
  region_display: string | null;
  action_by_user_id: string | null;
  actor_username: string | null;
  previous_status: string;
  new_status: string;
  action_label: string | null;
  notes: string | null;
  action_timestamp: string | null;
}

interface AuditResponse {
  items: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Any' },
  // Validator actions
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'BULK_APPROVED', label: 'Bulk Approved' },
  { value: 'REPLACED_EXISTING', label: 'Replaced Existing' },
  { value: 'ACCEPTED_AS_NEW', label: 'Accepted as New' },
  { value: 'ARCHIVED', label: 'Archived' },
  // Encoder actions
  { value: 'CREATED_DRAFT', label: 'Created Draft' },
  { value: 'EDITED', label: 'Edited' },
  { value: 'SUBMITTED', label: 'Submitted for Review' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
  { value: 'DELETED_DRAFT', label: 'Deleted Draft' },
];
const PAGE_SIZE = 15;

export default function ValidatorAuditPage() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [regionId, setRegionId] = useState('');
  const [actorUsername, setActorUsername] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [action, setAction] = useState('');

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    if (regionId) p.set('region_id', regionId);
    if (actorUsername.trim()) p.set('actor_username', actorUsername.trim());
    if (roleFilter) p.set('role', roleFilter);
    if (action) p.set('action', action);
    return p;
  }, [dateFrom, dateTo, regionId, actorUsername, roleFilter, action]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const p = buildParams();
    p.set('limit', String(PAGE_SIZE));
    p.set('offset', String(page * PAGE_SIZE));
    try {
      const res = await apiFetch<AuditResponse>(
        `/regional/validator/audit-logs?${p.toString()}`,
      );
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [buildParams, page]);

  useEffect(() => {
    load();
  }, [load]);

  const handleExport = () => {
    const p = buildParams();
    const url = `/api/regional/validator/audit-logs/export?${p.toString()}`;
    // The browser handles the download via the Content-Disposition header set by the server.
    window.open(url, '_blank');
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-baseline justify-between mb-2">
        <h1 className="text-2xl font-bold">Audit Trail</h1>
        <Link
          href="/dashboard/validator"
          className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium bg-yellow-400 text-gray-900 hover:bg-yellow-500 transition-colors"
        >
          ← Back to Queue
        </Link>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Every validator decision (and encoder edit) is recorded here.
      </p>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-4 text-sm">
        <label className="flex flex-col">
          <span className="text-xs text-gray-600">From</span>
          <input
            type="date"
            className="border rounded px-2 py-1.5"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-gray-600">To</span>
          <input
            type="date"
            className="border rounded px-2 py-1.5"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-gray-600">Region</span>
          <select
            className="border rounded px-2 py-1.5"
            value={regionId}
            onChange={(e) => {
              setRegionId(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All Regions</option>
            {PH_REGIONS.map((r) => (
              <option key={r.regionId} value={String(r.regionId)}>
                {r.regionName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-gray-600">Username</span>
          <input
            type="text"
            className="border rounded px-2 py-1.5"
            placeholder="any"
            value={actorUsername}
            onChange={(e) => {
              setActorUsername(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-gray-600">Role</span>
          <select
            className="border rounded px-2 py-1.5"
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Any</option>
            <option value="NATIONAL_VALIDATOR">Validator</option>
            <option value="REGIONAL_ENCODER">Encoder</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-gray-600">Action</span>
          <select
            className="border rounded px-2 py-1.5"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(0);
            }}
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value || 'any'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => {
            setPage(0);
            load();
          }}
          className="bg-gray-100 hover:bg-gray-200 border rounded px-4 py-2 text-sm"
        >
          ↺ Refresh
        </button>
        <button
          onClick={handleExport}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 text-sm"
        >
          Export CSV
        </button>
      </div>

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
          No audit entries match the current filters.
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Date &amp; Time</th>
                <th className="text-left px-3 py-2 font-medium">Incident</th>
                <th className="text-left px-3 py-2 font-medium">Region</th>
                <th className="text-left px-3 py-2 font-medium">By</th>
                <th className="text-left px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((it) => (
                <tr key={it.history_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-500">
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
                      {it.incident_id}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{it.region_display ?? '—'}</td>
                  <td className="px-3 py-2">
                    {it.actor_username ?? (it.action_by_user_id ? `${it.action_by_user_id.slice(0, 8)}…` : '—')}
                  </td>
                  <td className="px-3 py-2 font-medium">{it.action_label ?? it.new_status ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center gap-4 mt-4 text-sm text-gray-600">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            ← Prev
          </button>
          <span>
            Page {page + 1} of {totalPages} · {total} total
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
