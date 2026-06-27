'use client';

/**
 * Offline Work Center — unified view of all queued offline work.
 *
 * Displays Drafts, Queued, Failed, and Conflicts as tabbed or stacked
 * sections so the encoder can see, manage, and act on every offline operation.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Clock,
  FileText,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  getDraftOps,
  getPendingOps,
  getConflictOps,
  getFailedOps,
  type OfflineOpDecrypted,
} from '@/lib/offlineStore';
import { cancelOfflineOperation } from '@/lib/offlineOpActions';
import { syncPendingIncidents } from '@/lib/syncEngine';
import { useAutoSync } from '@/lib/useAutoSync';

type Section = 'drafts' | 'queued' | 'failed' | 'conflicts';

const SECTION_LABELS: Record<Section, string> = {
  drafts: 'Drafts',
  queued: 'Queued',
  failed: 'Failed',
  conflicts: 'Conflicts',
};

const SECTION_ICONS: Record<Section, React.ReactNode> = {
  drafts: <FileText className="h-4 w-4" aria-hidden />,
  queued: <Clock className="h-4 w-4" aria-hidden />,
  failed: <XCircle className="h-4 w-4" aria-hidden />,
  conflicts: <AlertTriangle className="h-4 w-4" aria-hidden />,
};

const OPERATION_LABELS: Record<string, string> = {
  create: 'Create incident',
  update: 'Update incident',
  submit: 'Submit for review',
  delete: 'Delete incident',
  archive_action: 'Archive action',
  verify: 'Verification',
};

function operationDisplay(op: OfflineOpDecrypted): string {
  const label = OPERATION_LABELS[op.operation] || op.operation;
  if (op.operation === 'archive_action') {
    const action = (op.payload as Record<string, unknown>).action;
    return action === 'unarchive' ? 'Restore incident' : 'Archive incident';
  }
  return label;
}

function formatCreatedAt(ts: number): string {
  return new Date(ts).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSyncErrors(
  errors: Array<{ localId: string; operation: string; status?: number; error?: string }>,
): string {
  return errors
    .map((err) => {
      const status = err.status ? `HTTP ${err.status}: ` : '';
      const label = OPERATION_LABELS[err.operation] || err.operation;
      return `${label} ${err.localId}: ${status}${err.error ?? 'Unknown error'}`;
    })
    .join('; ');
}

export default function OfflineWorkPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const role = (user as { role?: string })?.role ?? null;
  const encoderId = (user as { id?: string })?.id ?? '';
  const isEncoder = role === 'REGIONAL_ENCODER' || role === 'ENCODER';

  const { syncing } = useAutoSync();
  const [activeSection, setActiveSection] = useState<Section>('drafts');
  const [drafts, setDrafts] = useState<OfflineOpDecrypted[]>([]);
  const [pendingOps, setPendingOps] = useState<OfflineOpDecrypted[]>([]);
  const [conflictOps, setConflictOps] = useState<OfflineOpDecrypted[]>([]);
  const [failedOps, setFailedOps] = useState<OfflineOpDecrypted[]>([]);
  const [loadingOps, setLoadingOps] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<OfflineOpDecrypted | null>(null);

  const loadAll = useCallback(async () => {
    if (!encoderId) return;
    setLoadingOps(true);
    try {
      const [d, p, c, f] = await Promise.all([
        getDraftOps(encoderId),
        getPendingOps(encoderId),
        getConflictOps(encoderId),
        getFailedOps(encoderId),
      ]);
      setDrafts(d);
      setPendingOps(p);
      setConflictOps(c);
      setFailedOps(f);
    } catch {
      toast.error('Failed to load offline work.');
    } finally {
      setLoadingOps(false);
      setCancellingId(null);
    }
  }, [encoderId]);

  useEffect(() => {
    if (!loading && !isEncoder) {
      router.replace('/dashboard');
      return;
    }
    if (encoderId) {
      void loadAll();
    }
  }, [loading, isEncoder, encoderId, router, loadAll]);

  const handleRetryAll = async () => {
    if (syncing || !encoderId) return;
    setRetrying(true);
    try {
      const result = await syncPendingIncidents(encoderId, { bypassBackoff: true });
      if (result.synced > 0 || result.conflicts > 0) {
        toast.success(`Synced ${result.synced} item${result.synced !== 1 ? 's' : ''}.`);
      }
      if (result.failed > 0) {
        toast.warning(`${result.failed} item${result.failed !== 1 ? 's' : ''} failed to sync.`);
      }
      if (result.errors?.length) {
        toast.error(`Sync errors: ${formatSyncErrors(result.errors)}`);
      }
      await loadAll();
    } catch {
      toast.error('Sync attempt failed.');
    } finally {
      setRetrying(false);
    }
  };

  const handleCancelConfirm = useCallback(async () => {
    if (!confirmCancel || syncing) return;
    setCancellingId(confirmCancel.localId);
    try {
      await cancelOfflineOperation(confirmCancel);
      toast.success('Operation cancelled.');
      void loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel operation.');
    } finally {
      setConfirmCancel(null);
      setCancellingId(null);
    }
  }, [confirmCancel, syncing, loadAll]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  if (!isEncoder) return null;

  const sections: { key: Section; count: number; ops: OfflineOpDecrypted[] }[] = [
    { key: 'drafts', count: drafts.length, ops: drafts },
    { key: 'queued', count: pendingOps.length, ops: pendingOps },
    { key: 'failed', count: failedOps.length, ops: failedOps },
    { key: 'conflicts', count: conflictOps.length, ops: conflictOps },
  ];
  const activeCount = sections.find((s) => s.key === activeSection)?.count ?? 0;
  const activeOps = sections.find((s) => s.key === activeSection)?.ops ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      {/* ── Back link ── */}
      <Link
        href="/dashboard/regional"
        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to Dashboard
      </Link>

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Offline Work</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your queued, failed, conflicting, and draft offline operations.
          </p>
        </div>
        <button
          type="button"
          onClick={loadAll}
          disabled={loadingOps}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          aria-label="Refresh offline work"
        >
          <RefreshCw className={`h-4 w-4 ${loadingOps ? 'animate-spin' : ''}`} aria-hidden />
          Refresh
        </button>
      </div>

      {/* ── Section tabs ── */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-2" role="tablist">
        {sections.map(({ key, count }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeSection === key}
            aria-controls={`section-${key}`}
            onClick={() => setActiveSection(key)}
            className={`inline-flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-sm font-medium transition-colors min-h-[44px] ${
              activeSection === key
                ? 'border-b-2 border-blue-600 text-blue-700'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {SECTION_ICONS[key]}
            <span>{SECTION_LABELS[key]}</span>
            {count > 0 && (
              <span
                className={`ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-bold text-white ${
                  key === 'drafts' ? 'bg-blue-600' :
                  key === 'queued' ? 'bg-amber-500' :
                  key === 'failed' ? 'bg-red-600' :
                  'bg-orange-500'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Section content ── */}
      <div
        id={`section-${activeSection}`}
        role="tabpanel"
        aria-live="polite"
        className="space-y-4"
      >
        {/* ── Global retry (failed section) ── */}
        {activeSection === 'failed' && failedOps.length > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <span className="text-sm text-red-800">
              {failedOps.length} operation{failedOps.length !== 1 ? 's' : ''} failed permanently.
            </span>
            <button
              type="button"
              onClick={handleRetryAll}
              disabled={syncing || retrying}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]" style={{ backgroundColor: '#1A3263' }}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} aria-hidden />
              {retrying ? 'Retrying…' : 'Retry All'}
            </button>
          </div>
        )}

        {/* ── Retry all for queued section ── */}
        {activeSection === 'queued' && pendingOps.length > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <span className="text-sm text-amber-800">
              {pendingOps.length} operation{pendingOps.length !== 1 ? 's' : ''} waiting to sync.
            </span>
            <button
              type="button"
              onClick={handleRetryAll}
              disabled={syncing || retrying}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} aria-hidden />
              {retrying ? 'Syncing…' : 'Sync Now'}
            </button>
          </div>
        )}

        {/* ── Empty state ── */}
        {!loadingOps && activeCount === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 px-6 py-16 text-center">
            <CheckCircle className="mb-3 h-10 w-10 text-green-400" aria-hidden />
            <p className="text-lg font-medium text-gray-700">
              No {SECTION_LABELS[activeSection].toLowerCase()} to show
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {activeSection === 'drafts' && 'Save a draft while editing to see it here.'}
              {activeSection === 'queued' && 'All pending operations have been synced.'}
              {activeSection === 'failed' && 'No permanently failed operations.'}
              {activeSection === 'conflicts' && 'No conflicts to resolve.'}
            </p>
            <Link
              href="/dashboard/regional"
              className="mt-4 text-sm font-medium text-blue-700 underline hover:text-blue-900"
            >
              Back to Dashboard
            </Link>
          </div>
        )}

        {/* ── Loading state ── */}
        {loadingOps && (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            <RefreshCw className="mr-2 h-5 w-5 animate-spin" aria-hidden />
            Loading offline work…
          </div>
        )}

        {/* ── Op list ── */}
        {!loadingOps && activeOps.length > 0 && (
          <div className="space-y-3">
            {activeOps.map((op) => {
              const payload = op.payload as Record<string, unknown>;
              const incidentNonsensitive = (payload.incident_nonsensitive_details ?? {}) as Record<string, unknown>;
              const incidentSensitive = (payload.incident_sensitive_details ?? {}) as Record<string, unknown>;
              const category = String(incidentNonsensitive.general_category ?? payload.general_category ?? '—');
              const city = String(incidentNonsensitive.city_municipality ?? payload.city_municipality ?? '—');
              const address = String(incidentSensitive.street_address ?? payload.street_address ?? '—');

              const detailPath =
                op.operation === 'create'
                  ? `/dashboard/regional/incidents/${op.localId}`
                  : op.serverId
                    ? `/dashboard/regional/incidents/${op.serverId}`
                    : null;

              const isConflictLink = activeSection === 'conflicts';

              return (
                <div
                  key={op.localId}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                          {operationDisplay(op)}
                        </span>
                        <span className="text-xs text-gray-500">
                          {formatCreatedAt(op.createdAt)}
                        </span>
                        {op.retryCount > 0 && (
                          <span className="text-xs text-gray-400">
                            Retry #{op.retryCount}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 text-sm text-gray-700">
                        {category !== '—' && <span className="font-medium">{category}</span>}
                        {city !== '—' && (
                          <span className="text-gray-500">
                            {category !== '—' ? ' · ' : ''}{city}
                          </span>
                        )}
                        {address !== '—' && category === '—' && (
                          <span className="text-gray-500">{address}</span>
                        )}
                      </div>
                      {op.errorMessage && (
                        <p className="mt-1 text-xs text-red-600">
                          Error: {op.errorMessage}
                        </p>
                      )}
                      {op.syncStatus === 'conflict' && op.serverVersion && (
                        <p className="mt-1 text-xs text-orange-600">
                          Server has different data — choose which version to keep.
                        </p>
                      )}
                    </div>

                    <div className="flex flex-shrink-0 items-center gap-2">
                      {isConflictLink && (
                        <Link
                          href="/dashboard/regional/conflicts"
                          className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 min-h-[44px]"
                        >
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                          Resolve
                        </Link>
                      )}
                      {detailPath && !isConflictLink && (
                        <Link
                          href={detailPath}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 min-h-[44px]"
                        >
                          {op.operation === 'create' ? 'Open Draft' : 'View Incident'}
                        </Link>
                      )}
                      {(activeSection === 'queued' || activeSection === 'failed') && !isConflictLink && (
                        <button
                          type="button"
                          disabled={syncing || cancellingId === op.localId}
                          onClick={() => setConfirmCancel(op)}
                          className="inline-flex items-center gap-1 rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                          aria-label={`Cancel ${operationDisplay(op)}`}
                        >
                          <XCircle className="h-3.5 w-3.5" aria-hidden />
                          {cancellingId === op.localId ? 'Cancelling…' : 'Cancel'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Sync status footer ── */}
      {syncing && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
          Sync in progress…
        </div>
      )}

      {/* ── Cancel confirmation dialog ── */}
      {confirmCancel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-confirm-heading"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2
              id="cancel-confirm-heading"
              className="text-lg font-semibold text-gray-900"
            >
              Cancel {operationDisplay(confirmCancel)}?
            </h2>
            <p className="mt-2 text-sm text-red-700">
              This will permanently delete this queued operation. It cannot be undone.
            </p>
            <div className="mt-1 text-xs text-gray-500">
              <p>Operation: {operationDisplay(confirmCancel)}</p>
              {confirmCancel.createdAt && (
                <p>Queued: {formatCreatedAt(confirmCancel.createdAt)}</p>
              )}
              {confirmCancel.syncStatus === 'failed' && (
                <p className="mt-1 text-red-600">
                  This operation failed permanently and will not retry automatically.
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmCancel(null)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 min-h-[44px]"
              >
                Keep Operation
              </button>
              <button
                type="button"
                disabled={syncing || cancellingId !== null}
                onClick={handleCancelConfirm}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
              >
                {cancellingId === confirmCancel.localId ? 'Cancelling…' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
