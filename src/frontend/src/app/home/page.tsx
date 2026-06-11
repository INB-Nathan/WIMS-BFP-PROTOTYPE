'use client';

import { useState, useEffect, useCallback } from 'react';
import { useUserProfile } from '@/lib/auth';
import Link from 'next/link';
import { Search, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  fetchOperations,
  createOperation,
  updateOperation,
  deleteOperation,
  type Operation,
  type FireStatus,
  type OperationCreate,
} from '@/lib/api/operations';

type TabValue = 'ON-GOING' | 'FIRE OUT' | 'ALL';

const STATUS_BADGE: Record<FireStatus, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-red-100 text-red-700 border-red-200' },
  CONTAINED: { label: 'Contained', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  FIRE_OUT: { label: 'Fire Out', className: 'bg-green-100 text-green-700 border-green-200' },
};

export default function HomePage() {
  const { role, loading: authLoading } = useUserProfile();
  const isValidator = role === 'NATIONAL_VALIDATOR';

  const [ops, setOps] = useState<Operation[]>([]);
  const [opsLoading, setOpsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabValue>('ALL');
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Operation | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const loadOps = useCallback(async () => {
    setOpsLoading(true);
    try {
      const data = await fetchOperations();
      setOps(data);
    } catch {
      /* non-critical — board renders empty */
    } finally {
      setOpsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) void loadOps();
  }, [authLoading, loadOps]);

  const filteredOps = ops.filter((op) => {
    const matchTab =
      activeTab === 'ON-GOING'
        ? op.fire_status === 'ACTIVE' || op.fire_status === 'CONTAINED'
        : activeTab === 'FIRE OUT'
          ? op.fire_status === 'FIRE_OUT'
          : true;
    const matchSearch =
      op.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (op.notes ?? '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchTab && matchSearch;
  });

  async function handleStatusChange(id: number, status: FireStatus) {
    await updateOperation(id, { fire_status: status });
    await loadOps();
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this operation?')) return;
    await deleteOperation(id);
    await loadOps();
  }

  if (authLoading)
    return (
      <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
        Loading Operations Center...
      </div>
    );

  return (
    <div className="space-y-6">
      {/* Search Bar */}
      <div className="card">
        <div className="card-body flex flex-col md:flex-row gap-4 items-center justify-between">
          <div
            className="flex items-center gap-3 flex-1 w-full md:max-w-md px-4 py-2.5 rounded-lg"
            style={{ backgroundColor: '#f3f4f6' }}
          >
            <span
              className="text-xs font-bold tracking-wider uppercase"
              style={{ color: 'var(--bfp-maroon)' }}
            >
              Operations
            </span>
            <div className="w-px h-5 bg-gray-300" />
            <input
              type="text"
              placeholder="Search location or notes..."
              className="bg-transparent outline-none flex-1 text-sm placeholder-gray-400"
              style={{ color: 'var(--text-primary)' }}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <Search className="w-4 h-4 text-gray-400" />
          </div>
          <Link
            href="/incidents"
            className="text-sm font-bold text-white px-5 py-2 rounded-lg transition-colors"
            style={{ backgroundColor: '#16a34a' }}
          >
            View All Logs
          </Link>
        </div>
      </div>

      {/* Operations Board */}
      <div className="card">
        <div className="card-body space-y-4">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Operations Board
            </h2>
            {isValidator && (
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-2 rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800"
              >
                <Plus className="h-4 w-4" /> New Operation
              </button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 flex-wrap">
            {(['ON-GOING', 'FIRE OUT', 'ALL'] as TabValue[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  activeTab === tab
                    ? 'border-red-300 bg-red-50 text-red-700'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Table */}
          {opsLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
            </div>
          ) : filteredOps.length === 0 ? (
            <div className="rounded-md border border-slate-200 p-8 text-center text-sm text-slate-500">
              No operations found.
            </div>
          ) : (
            <div className="rounded-md border border-slate-200 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-medium uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">Size (ha)</th>
                    <th className="px-3 py-2">Start Time</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Linked Reports</th>
                    <th className="px-3 py-2">Last Updated</th>
                    {isValidator && <th className="px-3 py-2">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredOps.map((op) => (
                    <tr key={op.operation_id} className="hover:bg-slate-50">
                      <td className="px-3 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                        {op.location}
                      </td>
                      <td className="px-3 py-3 text-slate-600">{op.size_hectares ?? '—'}</td>
                      <td className="px-3 py-3 text-xs text-slate-500">
                        {new Date(op.start_time).toLocaleString()}
                      </td>
                      <td className="px-3 py-3">
                        {isValidator ? (
                          <select
                            value={op.fire_status}
                            onChange={(e) =>
                              void handleStatusChange(op.operation_id, e.target.value as FireStatus)
                            }
                            className={`rounded-md border px-2 py-1 text-xs font-medium ${STATUS_BADGE[op.fire_status].className}`}
                          >
                            <option value="ACTIVE">Active</option>
                            <option value="CONTAINED">Contained</option>
                            <option value="FIRE_OUT">Fire Out</option>
                          </select>
                        ) : (
                          <span
                            className={`rounded-md border px-2 py-1 text-xs font-medium ${STATUS_BADGE[op.fire_status].className}`}
                          >
                            {STATUS_BADGE[op.fire_status].label}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">
                        {op.linked_report_ids.length}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">
                        {new Date(op.updated_at).toLocaleString()}
                      </td>
                      {isValidator && (
                        <td className="px-3 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => setEditTarget(op)}
                              className="rounded-md border border-slate-300 p-1 text-slate-600 hover:bg-slate-50"
                              aria-label="Edit operation"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => void handleDelete(op.operation_id)}
                              className="rounded-md border border-red-200 p-1 text-red-600 hover:bg-red-50"
                              aria-label="Delete operation"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create / Edit modal */}
      {(showForm || editTarget) && (
        <OperationFormModal
          initial={editTarget}
          onClose={() => {
            setShowForm(false);
            setEditTarget(null);
          }}
          onSave={async (data) => {
            if (editTarget) {
              await updateOperation(editTarget.operation_id, data);
            } else {
              await createOperation(data);
            }
            setShowForm(false);
            setEditTarget(null);
            await loadOps();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OperationFormModal
// ---------------------------------------------------------------------------

function OperationFormModal({
  initial,
  onClose,
  onSave,
}: {
  initial: Operation | null;
  onClose: () => void;
  onSave: (data: OperationCreate) => Promise<void>;
}) {
  const [fireStatus, setFireStatus] = useState<FireStatus>(initial?.fire_status ?? 'ACTIVE');
  const [startTime, setStartTime] = useState(
    initial?.start_time ? new Date(initial.start_time).toISOString().slice(0, 16) : '',
  );
  const [location, setLocation] = useState(initial?.location ?? '');
  const [sizeHa, setSizeHa] = useState(initial?.size_hectares?.toString() ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({
        fire_status: fireStatus,
        start_time: new Date(startTime).toISOString(),
        location,
        size_hectares: sizeHa ? parseFloat(sizeHa) : undefined,
        notes: notes || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <form
        className="w-full max-w-md rounded-md bg-white p-5 shadow-xl space-y-4"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void handleSubmit(e)}
      >
        <h3 className="text-base font-semibold text-slate-900">
          {initial ? 'Edit Operation' : 'New Operation'}
        </h3>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
            <select
              value={fireStatus}
              onChange={(e) => setFireStatus(e.target.value as FireStatus)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="ACTIVE">Active</option>
              <option value="CONTAINED">Contained</option>
              <option value="FIRE_OUT">Fire Out</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Start Time *</label>
            <input
              type="datetime-local"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Location *</label>
            <input
              required
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Address or descriptive location"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Size (hectares)
            </label>
            <input
              type="number"
              step="0.01"
              value={sizeHa}
              onChange={(e) => setSizeHa(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
