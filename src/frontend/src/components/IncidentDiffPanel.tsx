'use client';

/**
 * M4-G: Side-by-side diff panel.
 * Compares the original (submitted) snapshot to the current incident_nonsensitive_details.
 * Used by validators in the queue to see what changed before approving.
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface DiffResponse {
  original: Record<string, unknown> | null;
  current: Record<string, unknown>;
  changed_fields: string[];
  note?: string;
}

interface IncidentDiffPanelProps {
  incidentId: number;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function IncidentDiffPanel({ incidentId }: IncidentDiffPanelProps) {
  const [data, setData] = useState<DiffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<DiffResponse>(`/regional/validator/incidents/${incidentId}/diff`)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load diff');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [incidentId]);

  if (loading) return <div className="text-sm text-gray-500 py-4">Loading diff…</div>;
  if (error)
    return (
      <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
        {error}
      </div>
    );
  if (!data) return null;

  if (data.original === null) {
    return (
      <div className="text-sm text-gray-600 bg-yellow-50 border border-yellow-200 rounded p-3">
        {data.note ?? 'No snapshot available — diff cannot be computed.'}
      </div>
    );
  }

  if (data.changed_fields.length === 0) {
    return (
      <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-3">
        No changes between submitted version and current values.
      </div>
    );
  }

  return (
    <div className="border rounded overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b text-xs text-gray-600">
        <span className="font-semibold">{data.changed_fields.length}</span> field
        {data.changed_fields.length !== 1 ? 's' : ''} changed since submission
      </div>
      <table className="w-full text-xs">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="text-left px-3 py-2 font-medium text-gray-700">Field</th>
            <th className="text-left px-3 py-2 font-medium text-gray-700">Original (submitted)</th>
            <th className="text-left px-3 py-2 font-medium text-gray-700">Current</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.changed_fields.map((field) => (
            <tr key={field} className="bg-yellow-50">
              <td className="px-3 py-2 font-mono text-gray-700">{field}</td>
              <td className="px-3 py-2 text-gray-800 break-all">
                {formatValue(data.original?.[field])}
              </td>
              <td className="px-3 py-2 text-gray-800 break-all font-medium">
                {formatValue(data.current[field])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
