'use client';

import { useCallback, useEffect, useState } from 'react';

import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CheckCircle, ExternalLink, Upload } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  getConflictOps,
  resolveConflictOp,
  deleteOfflineOp,
  deleteOfflineOpCascade,
  type OfflineOpDecrypted,
} from '@/lib/offlineStore';
import { fieldLabel } from '@/lib/afor-utils';

type Resolution = 'keep-local' | 'use-server' | 'discard';

// Duplicate metadata stored in serverVersion by the sync engine when a 409
// DUPLICATE_DETECTED is returned by the submit or create endpoint.
interface DuplicateMeta {
  incident_id?: number | null;         // server ID of the created draft (submit conflicts)
  matched_incident_id?: number | null; // the existing incident it duplicates
  matched_status?: string | null;
  confidence?: string | null;
}

function isDuplicateMeta(v: unknown): v is DuplicateMeta {
  return typeof v === 'object' && v !== null && ('matched_incident_id' in v || 'incident_id' in v);
}

interface ConflictItem {
  op: OfflineOpDecrypted;
  resolution: Resolution | null;
  resolving: boolean;
  error: string | null;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function RegionalConflictResolutionPage() {
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<ConflictItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const encoderId = user?.id ?? null;

  // ─── Load conflicts on mount ──────────────────────────────────────────────

  const loadConflicts = useCallback(async () => {
    if (!encoderId) return;
    setLoading(true);
    setError(null);
    try {
      const ops = await getConflictOps(encoderId);
      setItems(
        ops.map((op) => ({
          op,
          resolution: null,
          resolving: false,
          error: null,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conflicts');
    } finally {
      setLoading(false);
    }
  }, [encoderId]);

  useEffect(() => {
    if (authLoading) return;
    if (!encoderId) return;
    void loadConflicts();
  }, [authLoading, encoderId, loadConflicts]);

  // ─── Resolution helpers ───────────────────────────────────────────────────

  const setResolution = (index: number, resolution: Resolution) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, resolution, error: null } : item)),
    );
  };

  const applyResolutions = async () => {
    // Only apply to OCC conflict items (duplicates are resolved via their own buttons).
    const hasDestructive = occItems.some(
      (item) => item.resolution === 'discard' || item.resolution === 'use-server',
    );
    if (hasDestructive && !window.confirm('Some selected resolutions will permanently discard your local changes. This cannot be undone. Continue?')) {
      return;
    }

    setSubmitting(true);
    let changed = false;

    for (let i = 0; i < items.length; i++) {
      const { op, resolution } = items[i];
      if (!resolution || op.syncStatus !== 'conflict') continue;

      setItems((prev) =>
        prev.map((item, idx) => (idx === i ? { ...item, resolving: true } : item)),
      );

      try {
        if (resolution === 'keep-local') {
          // Re-queue the local payload — sync engine will retry with client_id
          // which is an idempotency key, or with force-replace semantics on PUT.
          await resolveConflictOp(op.localId, op.payload as Record<string, unknown>);
        } else if (resolution === 'use-server') {
          // Discard the local change. For create ops, cascade-delete linked
          // submit/update ops too; for standalone ops, simple delete.
          if (op.operation === 'create') {
            await deleteOfflineOpCascade(op.localId);
          } else {
            await deleteOfflineOp(op.localId);
          }
        } else if (resolution === 'discard') {
          // Discard the local change without accepting server version.
          if (op.operation === 'create') {
            await deleteOfflineOpCascade(op.localId);
          } else {
            await deleteOfflineOp(op.localId);
          }
        }
        changed = true;
      } catch (err) {
        setItems((prev) =>
          prev.map((item, idx) =>
            idx === i
              ? { ...item, error: err instanceof Error ? err.message : 'Resolution failed' }
              : item,
          ),
        );
      } finally {
        setItems((prev) =>
          prev.map((item, idx) => (idx === i ? { ...item, resolving: false } : item)),
        );
      }
    }

    setSubmitting(false);
    if (changed) {
      // Reload to verify no conflicts remain
      await loadConflicts();
    }
  };

  // ─── Error / empty / loading states ───────────────────────────────────────

  if (authLoading || loading) {
    return (
      <div className="p-6">
        <p className="text-gray-500 text-sm">Loading conflicts…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-6">
        <Link
          href="/dashboard/regional"
          className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-center gap-2">
          <CheckCircle className="h-4 w-4" />
          No conflicts — all your offline operations are consistent with the server.
        </div>
      </div>
    );
  }

  // ─── Render conflict list ─────────────────────────────────────────────────

  // Only OCC conflicts require a radio-button resolution; duplicate conflicts
  // are handled individually via their own action buttons.
  const occItems = items.filter((item) => item.op.errorCode !== '409_duplicate');
  const allResolved = occItems.length > 0 && occItems.every((item) => item.resolution !== null);
  const anyResolving = items.some((item) => item.resolving);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/dashboard/regional"
            className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline mb-1"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Sync Conflicts</h1>
          <p className="text-sm text-gray-600 mt-1">
            {items.length} offline operation{items.length !== 1 ? 's' : ''} could not be synced
            because the server has a different version. Choose how to resolve each one.
          </p>
        </div>
        {occItems.length > 0 && (
          <button
            onClick={applyResolutions}
            disabled={!allResolved || submitting || anyResolving}
            className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload className="h-4 w-4" />
            Apply Resolutions
          </button>
        )}
      </div>

      {items.map((item, idx) => {
        const isDuplicate = item.op.errorCode === '409_duplicate';
        const dupMeta = isDuplicate && isDuplicateMeta(item.op.serverVersion)
          ? item.op.serverVersion
          : null;

        // For submit ops, incident_id is the created draft server ID.
        // For create ops that were rejected as duplicate, there is no server ID.
        const draftIncidentId = dupMeta?.incident_id ?? item.op.serverId ?? null;
        const matchedId = dupMeta?.matched_incident_id ?? null;
        const confidence = dupMeta?.confidence ?? null;

        return (
          <div
            key={item.op.localId}
            className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <span className="inline-flex items-center gap-1 rounded bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                  <AlertTriangle className="h-3 w-3" />
                  {isDuplicate ? 'Duplicate Detected' : 'Version Conflict'}
                </span>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {item.op.operation.charAt(0).toUpperCase() + item.op.operation.slice(1)} operation
                  {' · '}
                  {new Date(item.op.createdAt).toLocaleString('en-PH', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <p className="text-xs text-gray-500 font-mono mt-0.5">
                  ID: {item.op.localId}
                  {item.op.serverId !== null && ` (server #${item.op.serverId})`}
                </p>
                {item.op.errorMessage && (
                  <p className="text-xs text-red-600 mt-1">{item.op.errorMessage}</p>
                )}
              </div>
              {item.error && (
                <p className="text-xs text-red-600">{item.error}</p>
              )}
            </div>

            {/* ── Duplicate path: show context + diff-panel link ── */}
            {isDuplicate ? (
              <div className="space-y-3">
                <div className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
                  <p className="font-semibold">Possible duplicate of an existing incident</p>
                  {matchedId && (
                    <p className="mt-1 text-xs">
                      Matches incident <span className="font-mono font-medium">#{matchedId}</span>
                      {confidence && <span className="ml-1">({confidence.toLowerCase()} confidence)</span>}
                    </p>
                  )}
                  {draftIncidentId && (
                    <p className="mt-1 text-xs text-orange-700">
                      Your incident was saved as a draft (#{draftIncidentId}). Open it to compare side-by-side and decide whether to submit anyway or cancel.
                    </p>
                  )}
                  {!draftIncidentId && (
                    <p className="mt-1 text-xs text-orange-700">
                      The incident was not created on the server because a duplicate already exists.
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {draftIncidentId && (
                    <Link
                      href={`/dashboard/regional/incidents/${draftIncidentId}?pending_submit=1`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Review &amp; Decide
                    </Link>
                  )}
                  <button
                    type="button"
                    disabled={item.resolving || submitting}
                    onClick={async () => {
                      setItems((prev) =>
                        prev.map((it, i) => i === idx ? { ...it, resolving: true, error: null } : it),
                      );
                      try {
                        // Delete only the submit op — the create op is already synced (draft on server).
                        // For create ops rejected as duplicate, cascade-delete any linked ops.
                        if (item.op.operation === 'create') {
                          await deleteOfflineOpCascade(item.op.localId);
                        } else {
                          await deleteOfflineOp(item.op.localId);
                        }
                        await loadConflicts();
                      } catch (err) {
                        setItems((prev) =>
                          prev.map((it, i) =>
                            i === idx ? { ...it, error: err instanceof Error ? err.message : 'Failed to discard' } : it,
                          ),
                        );
                      } finally {
                        setItems((prev) =>
                          prev.map((it, i) => i === idx ? { ...it, resolving: false } : it),
                        );
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {item.resolving ? 'Discarding…' : 'Cancel Submission'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* ── OCC version conflict: show diff + resolution choices ── */}

                {/* Local payload summary */}
                <div className="mb-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    Your Local Version
                  </p>
                  <div className="rounded border bg-gray-50 p-3 max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <tbody>
                        {Object.entries(item.op.payload as Record<string, unknown>)
                          .filter(([k]) => !['client_id'].includes(k))
                          .slice(0, 12)
                          .map(([key, val]) => (
                            <tr key={key} className="border-b border-gray-100 last:border-0">
                              <td className="py-1 pr-3 text-gray-500 font-medium whitespace-nowrap">
                                {fieldLabel(key)}
                              </td>
                              <td className="py-1 text-gray-900 break-words">
                                {displayValue(val)}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {item.op.serverVersion && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Server Version
                    </p>
                    <div className="rounded border bg-blue-50 p-3 max-h-48 overflow-y-auto">
                      <table className="w-full text-xs">
                        <tbody>
                          {Object.entries(item.op.serverVersion as Record<string, unknown>)
                            .slice(0, 12)
                            .map(([key, val]) => (
                              <tr key={key} className="border-b border-blue-100 last:border-0">
                                <td className="py-1 pr-3 text-blue-700 font-medium whitespace-nowrap">
                                  {fieldLabel(key)}
                                </td>
                                <td className="py-1 text-blue-900 break-words">
                                  {displayValue(val)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mt-3">
                  <label
                    className={`flex-1 min-w-[140px] cursor-pointer rounded-md border px-3 py-2 text-xs ${
                      item.resolution === 'keep-local'
                        ? 'border-blue-500 bg-blue-50 text-blue-900'
                        : 'border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`resolution-${idx}`}
                      className="mr-1.5"
                      checked={item.resolution === 'keep-local'}
                      onChange={() => setResolution(idx, 'keep-local')}
                      disabled={item.resolving || submitting}
                    />
                    <span className="font-semibold">Keep Local</span>
                    <span className="block text-[10px] text-gray-600 mt-0.5">
                      Overwrite server with your version (retry sync)
                    </span>
                  </label>

                  <label
                    className={`flex-1 min-w-[140px] cursor-pointer rounded-md border px-3 py-2 text-xs ${
                      item.resolution === 'use-server'
                        ? 'border-green-500 bg-green-50 text-green-900'
                        : 'border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`resolution-${idx}`}
                      className="mr-1.5"
                      checked={item.resolution === 'use-server'}
                      onChange={() => setResolution(idx, 'use-server')}
                      disabled={item.resolving || submitting}
                    />
                    <span className="font-semibold">Discard Local (Server Wins)</span>
                    <span className="block text-[10px] text-gray-600 mt-0.5">
                      Server data will appear after the next sync or refresh
                    </span>
                  </label>

                  <label
                    className={`flex-1 min-w-[140px] cursor-pointer rounded-md border px-3 py-2 text-xs ${
                      item.resolution === 'discard'
                        ? 'border-red-500 bg-red-50 text-red-900'
                        : 'border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`resolution-${idx}`}
                      className="mr-1.5"
                      checked={item.resolution === 'discard'}
                      onChange={() => setResolution(idx, 'discard')}
                      disabled={item.resolving || submitting}
                    />
                    <span className="font-semibold">Discard</span>
                    <span className="block text-[10px] text-gray-600 mt-0.5">
                      Remove this operation entirely
                    </span>
                  </label>
                </div>

                {item.resolving && (
                  <p className="text-xs text-blue-600 mt-2">Applying resolution…</p>
                )}
              </>
            )}
          </div>
        );
      })}

        {allResolved && !submitting && (
          <div className="rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            All items have a resolution selected. Click &ldquo;Apply Resolutions&rdquo; to confirm.
          </div>
        )}

        {submitting && (
          <div className="rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Applying resolutions…
          </div>
        )}
      </div>
    );
  }
