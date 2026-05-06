'use client';

/**
 * /dashboard/regional/drafts — encoder DRAFT incident list (M4-E).
 *
 * Calls GET  /regional/incidents/drafts  to list the encoder's drafts,
 * and DELETE /regional/incidents/draft/{id} to soft-archive a draft.
 *
 * Resume action navigates to the existing detail page where the encoder
 * can edit the draft via IncidentForm.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { listEncoderDrafts, deleteDraft, type DraftSummary } from '@/lib/api';
import { formatClassification } from '@/lib/afor-utils';

export default function EncoderDraftsPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listEncoderDrafts(50, 0);
      setDrafts(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load drafts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: number) => {
    if (!confirm('Discard this draft? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await deleteDraft(id);
      setDrafts((prev) => prev.filter((d) => d.incident_id !== id));
      setTotal((t) => Math.max(0, t - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete draft');
    } finally {
      setDeletingId(null);
    }
  };

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
      <p className="text-sm text-gray-500 mb-6">
        Your saved drafts. Drafts are auto-archived after 30 days of inactivity.
      </p>

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
                <tr key={d.incident_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{d.incident_id}</td>
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
                        onClick={() => router.push(`/dashboard/regional/incidents/${d.incident_id}`)}
                        className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                      >
                        Resume
                      </button>
                      <button
                        onClick={() => handleDelete(d.incident_id)}
                        disabled={deletingId === d.incident_id}
                        className="px-3 py-1 text-xs rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40"
                      >
                        {deletingId === d.incident_id ? 'Deleting…' : 'Discard'}
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
