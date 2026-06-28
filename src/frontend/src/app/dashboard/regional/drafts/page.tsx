'use client';

/**
 * /dashboard/regional/drafts — encoder DRAFT incident list (M4-E).
 *
 * Online:  fetches server drafts + merges locally-queued create ops.
 * Offline: reads locally-queued ops from IndexedDB + last cached server list.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { WifiOff } from 'lucide-react';
import { deleteDraft } from '@/lib/api';
import { deleteOfflineOp } from '@/lib/offlineStore';
import { useAuth } from '@/context/AuthContext';
import { useNetworkStatus } from '@/lib/useNetworkStatus';
import {
  listEncoderDraftsOfflineAware,
  type AnyDraftItem,
  type LocalDraftItem,
} from '@/lib/api/offlineDrafts';
import { formatClassification } from '@/lib/afor-utils';

function isLocalDraft(item: AnyDraftItem): item is LocalDraftItem {
  return (item as LocalDraftItem).isLocal === true;
}

export default function EncoderDraftsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const encoderId = (user as { id?: string } | null)?.id ?? '';
  const { isOnline } = useNetworkStatus();

  const [drafts, setDrafts] = useState<AnyDraftItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!encoderId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listEncoderDraftsOfflineAware(encoderId, 50, 0);
      setDrafts(res.items);
      setTotal(res.total);
      setFromCache(res.fromCache);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load drafts');
    } finally {
      setLoading(false);
    }
  }, [encoderId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (item: AnyDraftItem) => {
    if (!confirm('Discard this draft? This cannot be undone.')) return;

    if (isLocalDraft(item)) {
      // Local (unsynced) draft — delete directly from IndexedDB
      const key = item.localId;
      setDeletingKey(key);
      try {
        await deleteOfflineOp(item.localId);
        setDrafts((prev) => prev.filter((d) => isLocalDraft(d) ? d.localId !== item.localId : true));
        setTotal((t) => Math.max(0, t - 1));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete draft');
      } finally {
        setDeletingKey(null);
      }
      return;
    }

    // Server draft — requires network
    if (!isOnline) {
      setError('Cannot delete a synced draft while offline. Reconnect first.');
      return;
    }
    const key = String(item.incident_id);
    setDeletingKey(key);
    try {
      await deleteDraft(item.incident_id);
      setDrafts((prev) => prev.filter((d) => !isLocalDraft(d) && d.incident_id !== item.incident_id));
      setTotal((t) => Math.max(0, t - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete draft');
    } finally {
      setDeletingKey(null);
    }
  };

  const handleResume = (item: AnyDraftItem) => {
    if (isLocalDraft(item)) {
      router.push(`/dashboard/regional/incidents/local/${item.localId}`);
    } else {
      router.push(`/dashboard/regional/incidents/${item.incident_id}`);
    }
  };

  const getItemKey = (item: AnyDraftItem): string =>
    isLocalDraft(item) ? `local:${item.localId}` : `server:${item.incident_id}`;

  const isDeletingItem = (item: AnyDraftItem): boolean =>
    deletingKey === (isLocalDraft(item) ? item.localId : String(item.incident_id));

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-baseline justify-between mb-2">
        <h1 className="text-2xl font-bold">Drafts</h1>
        <Link
          href="/incidents/create"
          className="text-sm font-medium text-red-800 hover:text-red-700"
        >
          + New Incident
        </Link>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Your saved drafts. Drafts are auto-archived after 30 days of inactivity.
      </p>

      {!isOnline && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 mb-4">
          <WifiOff className="h-4 w-4 flex-shrink-0" aria-hidden />
          <span>Offline — showing locally-saved drafts{fromCache ? ' and last cached server list' : ''}.</span>
        </div>
      )}
      {isOnline && fromCache && (
        <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-700 mb-4">
          Showing cached draft list — reconnecting…
        </div>
      )}

      {loading && (
        <div className="text-gray-400 text-sm py-12 text-center">Loading…</div>
      )}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700 text-sm mb-4">
          {error}
        </div>
      )}
      {!loading && !error && drafts.length === 0 && (
        <div className="text-gray-400 text-sm py-12 text-center border border-dashed rounded">
          You have no drafts. Click <span className="font-medium">+ New Incident</span> to start one.
        </div>
      )}

      {!loading && drafts.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium">ID</th>
                <th className="text-left px-4 py-3 font-medium">Station</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-left px-4 py-3 font-medium">Alarm</th>
                <th className="text-left px-4 py-3 font-medium">Notification</th>
                <th className="text-left px-4 py-3 font-medium">Last Edited</th>
                <th className="text-left px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {drafts.map((d) => (
                <tr key={getItemKey(d)} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    {isLocalDraft(d) ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                          LOCAL
                        </span>
                        <span className="text-gray-400">{d.localId.slice(0, 8)}…</span>
                      </span>
                    ) : (
                      d.incident_id
                    )}
                  </td>
                  <td className="px-4 py-3">{d.fire_station_name ?? '—'}</td>
                  <td className="px-4 py-3">{formatClassification(d.general_category)}</td>
                  <td className="px-4 py-3">{d.alarm_level ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {d.notification_dt ? new Date(d.notification_dt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {d.updated_at ? new Date(d.updated_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleResume(d)}
                        className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                      >
                        Resume
                      </button>
                      <button
                        onClick={() => handleDelete(d)}
                        disabled={isDeletingItem(d)}
                        className="px-3 py-1 text-xs rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40"
                      >
                        {isDeletingItem(d) ? 'Deleting…' : 'Discard'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-500">
            Showing {drafts.length} of {total} drafts.
          </div>
        </div>
      )}
    </div>
  );
}
