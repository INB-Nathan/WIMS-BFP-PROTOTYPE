'use client';

/**
 * /dashboard/validator/audit — M4-I.
 *
 * Searchable, filterable view of wims.incident_verification_history with
 * CSV export. NATIONAL_VALIDATOR only.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
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
    <div className="space-y-6">
      <section className="card overflow-hidden">
        <div
          className="card-header flex items-center gap-2"
          style={{ borderLeft: '4px solid var(--sidebar-bg)' }}
        >
          <FileText className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
          <span>Audit Trail</span>
        </div>

        <div className="card-body">
          <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
            Every validator decision (and encoder edit) is recorded here.
          </p>

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-4 text-sm">
            <label className="flex flex-col">
              <span className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>From</span>
              <input
                type="date"
                className="border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label className="flex flex-col">
              <span className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>To</span>
              <input
                type="date"
                className="border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label className="flex flex-col">
              <span className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Region</span>
              <select
                className="border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
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
              <span className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Username</span>
              <input
                type="text"
                className="border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
                placeholder="any"
                value={actorUsername}
                onChange={(e) => {
                  setActorUsername(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label className="flex flex-col">
              <span className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Role</span>
              <select
                className="border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
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
              <span className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Action</span>
              <select
                className="border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--sidebar-bg)' } as React.CSSProperties}
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
              className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
            >
              ↺ Refresh
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors border"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
            >
              Export CSV
            </button>
          </div>

          {loading && (
            <div className="text-sm py-12 text-center" style={{ color: 'var(--text-muted)' }}>
              Loading…
            </div>
          )}
          {error && !loading && (
            <div className="rounded-md p-3 text-sm mb-4" style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
              {error}
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="text-sm py-12 text-center" style={{ color: 'var(--text-muted)' }}>
              No audit entries match the current filters.
            </div>
          )}

          {!loading && items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date &amp; Time</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Incident</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Region</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">By</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {items.map((it) => (
                    <tr key={it.history_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {it.action_timestamp
                          ? new Date(it.action_timestamp).toLocaleString('en-PH', {
                              timeZone: 'Asia/Manila',
                              year: 'numeric', month: '2-digit', day: '2-digit',
                              hour: '2-digit', minute: '2-digit', hour12: false,
                            })
                          : '—'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono">
                        <Link
                          href={`/dashboard/regional/incidents/${it.incident_id}`}
                          className="text-blue-700 hover:underline"
                        >
                          {it.incident_id}
                        </Link>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-primary)' }}>
                        {it.region_display ?? '—'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-primary)' }}>
                        {it.actor_username ?? (it.action_by_user_id ? `${it.action_by_user_id.slice(0, 8)}…` : '—')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {it.action_label ?? it.new_status ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {total > PAGE_SIZE && (
            <div className="flex items-center gap-4 mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1 border rounded disabled:opacity-40 transition-opacity"
                style={{ borderColor: 'var(--border-color)' }}
              >
                ← Prev
              </button>
              <span>
                Page {page + 1} of {totalPages} · {total} total
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 border rounded disabled:opacity-40 transition-opacity"
                style={{ borderColor: 'var(--border-color)' }}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
