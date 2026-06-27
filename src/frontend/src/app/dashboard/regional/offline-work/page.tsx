'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FileText, Upload, Archive, Clock, AlertTriangle, RefreshCw,
  Trash2, ExternalLink, AlertCircle, CheckCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  getDraftOps,
  getPendingOps,
  getConflictOps,
  getFailedOps,
  deleteOfflineOp,
  deleteOfflineOpCascade,
  type OfflineOpDecrypted,
} from '@/lib/offlineStore';
import { syncPendingIncidents } from '@/lib/syncEngine';
import { useAutoSync } from '@/lib/useAutoSync';
import { useNetworkStatus } from '@/lib/useNetworkStatus';

type TabId = 'drafts' | 'queued' | 'failed' | 'conflicts';

const TABS: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: 'drafts', label: 'Drafts', icon: FileText },
  { id: 'queued', label: 'Queued', icon: Clock },
  { id: 'failed', label: 'Failed', icon: AlertCircle },
  { id: 'conflicts', label: 'Conflicts', icon: AlertTriangle },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function opTypeLabel(op: OfflineOpDecrypted): string {
  if (op.operation === 'archive_action') {
    const action = (op.payload as Record<string, unknown>).action;
    return action === 'unarchive' ? 'Restore' : 'Archive';
  }
  const labels: Record<string, string> = {
    create: 'New incident',
    update: 'Update incident',
    submit: 'Submit for review',
    delete: 'Delete incident',
  };
  return labels[op.operation] ?? op.operation;
}

function opSummary(op: OfflineOpDecrypted): string {
  const p = op.payload as Record<string, unknown>;
  const ns = (p.incident_nonsensitive_details ?? {}) as Record<string, unknown>;
  const sens = (p.incident_sensitive_details ?? {}) as Record<string, unknown>;
  const category = String(ns.general_category ?? p.general_category ?? '—');
  const station = String(ns.fire_station_name ?? p.fire_station_name ?? '—');
  const location = [
    sens.street_address ?? p.street_address,
    ns.city_municipality ?? p.city_municipality,
    ns.province_district ?? p.province_district,
  ].filter(Boolean).join(', ') || '—';
  const incidentId = op.serverId ?? (p.incident_id as number | undefined);
  const incidentRef = incidentId ? `#${incidentId}` : '(new)';
  return `${incidentRef} · ${category} · ${station} · ${location}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatErrorCode(code: string | null): string {
  if (!code) return 'Unknown error';
  const labels: Record<string, string> = {
    '409_duplicate': 'Duplicate',
    '409_conflict': 'Conflict',
    '403': 'Forbidden',
    '4xx': 'Client error',
    'network': 'Network error',
  };
  return labels[code] ?? code;
}

// ── Confirmation dialog ─────────────────────────────────────────────────────

function ConfirmDialog({
  open, title, message, onConfirm, onCancel, busy,
}: {
  open: boolean; title: string; message: string;
  onConfirm: () => void; onCancel: () => void; busy: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <p className="mt-2 text-sm text-gray-600">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function OfflineWorkPage() {
  const router = useRouter();
  const { user, role } = useAuth();
  const { syncing, syncNow } = useAutoSync();
  const { isOnline } = useNetworkStatus();
  const encoderId = (user as { id?: string })?.id ?? '';
  const isEncoder = role === 'REGIONAL_ENCODER' || role === 'ENCODER';

  const [drafts, setDrafts] = useState<OfflineOpDecrypted[]>([]);
  const [queued, setQueued] = useState<OfflineOpDecrypted[]>([]);
  const [failed, setFailed] = useState<OfflineOpDecrypted[]>([]);
  const [conflicts, setConflicts] = useState<OfflineOpDecrypted[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('drafts');
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());

  // Confirmation state
  const [confirmTarget, setConfirmTarget] = useState<{ localId: string; label: string } | null>(null);

  const loadAll = useCallback(async () => {
    if (!encoderId) return;
    setLoading(true);
    try {
      const [d, q, f, c] = await Promise.all([
        getDraftOps(encoderId),
        getPendingOps(encoderId),
        getFailedOps(encoderId),
        getConflictOps(encoderId),
      ]);
      setDrafts(d);
      setQueued(q);
      setFailed(f);
      setConflicts(c);
    } catch {
      toast.error('Failed to load offline work data.');
    } finally {
      setLoading(false);
    }
  }, [encoderId]);

  useEffect(() => {
    if (isEncoder && encoderId) {
      loadAll();
    }
  }, [isEncoder, encoderId, loadAll]);

  // Redirect non-encoders
  useEffect(() => {
    if (role && !isEncoder) {
      router.replace('/dashboard/regional');
    }
  }, [role, isEncoder, router]);

  const retryFailedOp = useCallback(async (op: OfflineOpDecrypted) => {
    setRetryingIds((prev) => new Set(prev).add(op.localId));
    try {
      await syncPendingIncidents(encoderId, { bypassBackoff: true });
      toast.success(`Retried incident ${op.serverId ?? ''}`);
      await loadAll();
    } catch {
      toast.error('Retry failed. The operation may still be in queue.');
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(op.localId);
        return next;
      });
    }
  }, [encoderId, loadAll]);

  const confirmCancel = useCallback((localId: string, label: string) => {
    setConfirmTarget({ localId, label });
  }, []);

  const executeCancel = useCallback(async () => {
    if (!confirmTarget) return;
    try {
      const op = [...drafts, ...queued, ...failed].find(
        (o) => o.localId === confirmTarget.localId,
      );
      if (!op) {
        toast.error('Operation not found — it may have already been removed.');
        setConfirmTarget(null);
        return;
      }
      if (op.operation === 'create') {
        await deleteOfflineOpCascade(confirmTarget.localId);
      } else {
        await deleteOfflineOp(confirmTarget.localId);
      }
      toast.success('Operation cancelled.');
      setConfirmTarget(null);
      await loadAll();
    } catch {
      toast.error('Failed to cancel operation.');
    }
  }, [confirmTarget, drafts, queued, failed, loadAll]);

  const totalCount = drafts.length + queued.length + failed.length + conflicts.length;

  if (!isEncoder) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-500">
        Checking access…
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Offline Work</h1>
          <p className="mt-1 text-sm text-gray-500">
            {totalCount === 0
              ? 'No offline work pending.'
              : `${totalCount} item${totalCount !== 1 ? 's' : ''} across all buckets.`
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadAll}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            aria-label="Refresh offline work"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
          <Link
            href="/dashboard/regional"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            Dashboard
          </Link>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard icon={FileText} label="Drafts" count={drafts.length} color="blue" />
        <SummaryCard icon={Clock} label="Queued" count={queued.length} color="amber" />
        <SummaryCard icon={AlertCircle} label="Failed" count={failed.length} color="red" />
        <SummaryCard icon={AlertTriangle} label="Conflicts" count={conflicts.length} color="orange" />
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <RefreshCw className="mr-2 h-5 w-5 animate-spin" aria-hidden />
          Loading offline work…
        </div>
      )}

      {/* Empty state */}
      {!loading && totalCount === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <CheckCircle className="mb-3 h-12 w-12 text-green-400" aria-hidden />
          <p className="text-lg font-medium text-gray-600">All caught up!</p>
          <p className="mt-1 text-sm">No drafts, queued ops, failures, or conflicts.</p>
        </div>
      )}

      {!loading && totalCount > 0 && (
        <>
          {/* Tabs */}
          <div className="flex border-b border-gray-200" role="tablist">
            {TABS.map((tab) => {
              const count = (
                tab.id === 'drafts' ? drafts.length :
                tab.id === 'queued' ? queued.length :
                tab.id === 'failed' ? failed.length :
                conflicts.length
              );
              if (count === 0) return null;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'border-red-600 text-red-700'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {tab.label}
                  <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                    tab.id === 'failed' ? 'bg-red-100 text-red-700' :
                    tab.id === 'conflicts' ? 'bg-orange-100 text-orange-700' :
                    tab.id === 'queued' ? 'bg-amber-100 text-amber-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div role="tabpanel">
            {/* Drafts */}
            {activeTab === 'drafts' && (
              <OpTable
                items={drafts}
                emptyMsg="No unsaved drafts."
                columns={['Incident', 'Category', 'Saved']}
                renderRow={(op) => {
                  const p = op.payload as Record<string, unknown>;
                  const ns = (p.incident_nonsensitive_details ?? {}) as Record<string, unknown>;
                  return [
                    <Link key="link" href="/afor/create" className="text-blue-700 underline hover:text-blue-900 text-xs font-medium">
                      Continue editing
                    </Link>,
                    String(ns.general_category ?? p.general_category ?? '—'),
                    formatTime(op.createdAt),
                  ];
                }}
                extraColumn={(op) => (
                  <button
                    type="button"
                    onClick={() => confirmCancel(op.localId, 'draft')}
                    disabled={syncing}
                    className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    aria-label="Discard draft"
                  >
                    <Trash2 className="inline h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              />
            )}

            {/* Queued */}
            {activeTab === 'queued' && (
              <OpTable
                items={queued}
                emptyMsg="No queued operations."
                columns={['Operation', 'Summary', 'Queued']}
                renderRow={(op) => [
                  <span key="op" className="font-medium text-gray-900 text-xs">{opTypeLabel(op)}</span>,
                  <span key="sum" className="text-xs text-gray-600 truncate max-w-[300px] block">{opSummary(op)}</span>,
                  formatTime(op.createdAt),
                ]}
                extraColumn={(op) => (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => confirmCancel(op.localId, opTypeLabel(op))}
                      disabled={syncing}
                      className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      aria-label={`Cancel ${opTypeLabel(op)}`}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              />
            )}

            {/* Failed */}
            {activeTab === 'failed' && (
              <OpTable
                items={failed}
                emptyMsg="No failed operations."
                columns={['Operation', 'Summary', 'Error', 'Retries', 'Queued']}
                renderRow={(op) => [
                  <span key="op" className="font-medium text-gray-900 text-xs">{opTypeLabel(op)}</span>,
                  <span key="sum" className="text-xs text-gray-600 truncate max-w-[200px] block">{opSummary(op)}</span>,
                  <span key="err" className="text-xs text-red-600">
                    {formatErrorCode(op.errorCode)}
                    {op.errorMessage ? `: ${op.errorMessage.slice(0, 60)}` : ''}
                  </span>,
                  <span key="ret" className="text-xs text-gray-500">{op.retryCount}</span>,
                  formatTime(op.createdAt),
                ]}
                extraColumn={(op) => (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => retryFailedOp(op)}
                      disabled={syncing || retryingIds.has(op.localId)}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                      aria-label={`Retry ${opTypeLabel(op)}`}
                    >
                      {retryingIds.has(op.localId) ? (
                        <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />
                      ) : (
                        <RefreshCw className="h-3 w-3" aria-hidden />
                      )}
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={() => confirmCancel(op.localId, opTypeLabel(op))}
                      disabled={syncing}
                      className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      aria-label={`Cancel ${opTypeLabel(op)}`}
                    >
                      Remove
                    </button>
                  </div>
                )}
              />
            )}

            {/* Conflicts */}
            {activeTab === 'conflicts' && (
              <OpTable
                items={conflicts}
                emptyMsg="No conflicts."
                columns={['Operation', 'Summary', 'Queued']}
                renderRow={(op) => [
                  <span key="op" className="font-medium text-gray-900 text-xs">{opTypeLabel(op)}</span>,
                  <span key="sum" className="text-xs text-gray-600 truncate max-w-[300px] block">{opSummary(op)}</span>,
                  formatTime(op.createdAt),
                ]}
                extraColumn={() => (
                  <Link
                    href="/dashboard/regional/conflicts"
                    className="inline-flex items-center gap-1 rounded-md border border-orange-300 px-2 py-1 text-xs font-medium text-orange-800 hover:bg-orange-50"
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden />
                    Resolve
                  </Link>
                )}
              />
            )}
          </div>
        </>
      )}

      {/* Confirmation dialog */}
      <ConfirmDialog
        open={confirmTarget !== null}
        title={confirmTarget ? `Remove ${confirmTarget.label}` : ''}
        message={
          confirmTarget
            ? confirmTarget.label === 'draft'
              ? 'This draft will be permanently deleted. Any unsaved changes will be lost.'
              : `The queued "${confirmTarget.label}" operation will be cancelled. If the incident was already synced, the server data is not affected.`
            : ''
        }
        onConfirm={executeCancel}
        onCancel={() => setConfirmTarget(null)}
        busy={false}
      />
    </div>
  );
}

// ── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, label, count, color }: {
  icon: typeof FileText; label: string; count: number; color: 'blue' | 'amber' | 'red' | 'orange';
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
  };
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color]}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5" aria-hidden />
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold">{count}</p>
    </div>
  );
}

// ── Generic operation table ──────────────────────────────────────────────────

function OpTable({
  items, emptyMsg, columns, renderRow, extraColumn,
}: {
  items: OfflineOpDecrypted[];
  emptyMsg: string;
  columns: string[];
  renderRow: (op: OfflineOpDecrypted) => React.ReactNode[];
  extraColumn?: (op: OfflineOpDecrypted) => React.ReactNode;
}) {
  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">{emptyMsg}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((col) => (
              <th key={col} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                {col}
              </th>
            ))}
            {extraColumn && <th className="px-4 py-3" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((op) => {
            const cells = renderRow(op);
            return (
              <tr key={op.localId} className="hover:bg-gray-50">
                {cells.map((cell, i) => (
                  <td key={i} className="px-4 py-3 whitespace-nowrap">{cell}</td>
                ))}
                {extraColumn && (
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    {extraColumn(op)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
