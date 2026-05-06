'use client';

/**
 * Side-by-side diff view for update requests.
 * Shown when a validator opens a PENDING incident that has parent_incident_id set
 * (i.e. the encoder submitted it as an update to an existing VERIFIED incident).
 *
 * Left = original VERIFIED incident, Right = incoming update request.
 * Changed fields are highlighted red (original) / green (updated).
 */

import { useEffect, useState } from 'react';
import { fetchRegionalIncident, type RegionalIncidentDetailResponse } from '@/lib/api';
import { formatClassification } from '@/lib/afor-utils';

interface UpdateRequestDiffPanelProps {
  updateIncidentId: number;
  originalIncidentId: number;
}

interface DiffField {
  key: string;
  label: string;
  format?: (v: unknown) => string;
}

const NS_DIFF_FIELDS: DiffField[] = [
  { key: 'notification_dt', label: 'Fire Date', format: fmtDate },
  { key: 'general_category', label: 'Classification', format: (v) => formatClassification(String(v ?? '')) },
  { key: 'sub_category', label: 'Type of Involved' },
  { key: 'alarm_level', label: 'Alarm Level' },
  { key: 'fire_station_name', label: 'Fire Station' },
  { key: 'city_municipality', label: 'City / Municipality' },
  { key: 'province_district', label: 'Province / District' },
  { key: 'structures_affected', label: 'Structures Affected' },
  { key: 'households_affected', label: 'Households Affected' },
  { key: 'families_affected', label: 'Families Affected' },
  { key: 'individuals_affected', label: 'Individuals Affected' },
  { key: 'fire_origin', label: 'Fire Origin' },
  { key: 'extent_of_damage', label: 'Extent of Damage' },
  { key: 'stage_of_fire', label: 'Stage of Fire' },
];

const SENS_DIFF_FIELDS: DiffField[] = [
  { key: 'street_address', label: 'Street Address' },
  { key: 'narrative_report', label: 'Narrative Report' },
];

function fmtDate(v: unknown): string {
  if (!v) return '—';
  try {
    const dt = new Date(String(v));
    const d = dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
    const t = dt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${d} | ${t}`;
  } catch {
    return String(v);
  }
}

function fmtValue(v: unknown, fmt?: (v: unknown) => string): string {
  if (v === null || v === undefined || v === '') return '—';
  if (fmt) return fmt(v);
  return String(v);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '';
  return String(a) === String(b);
}

export function UpdateRequestDiffPanel({ updateIncidentId, originalIncidentId }: UpdateRequestDiffPanelProps) {
  const [original, setOriginal] = useState<RegionalIncidentDetailResponse | null>(null);
  const [update, setUpdate] = useState<RegionalIncidentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchRegionalIncident(originalIncidentId),
      fetchRegionalIncident(updateIncidentId),
    ])
      .then(([orig, upd]) => {
        if (!cancelled) {
          setOriginal(orig);
          setUpdate(upd);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load incidents');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [originalIncidentId, updateIncidentId]);

  if (loading) return <div className="text-sm text-gray-500 py-3">Loading comparison…</div>;
  if (error) return <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>;
  if (!original || !update) return null;

  const origNs = original.nonsensitive as Record<string, unknown>;
  const updNs = update.nonsensitive as Record<string, unknown>;
  const origSens = original.sensitive as Record<string, unknown>;
  const updSens = update.sensitive as Record<string, unknown>;

  // Build a merged view: look up each field in nonsensitive or sensitive as appropriate
  const getVal = (rec: Record<string, unknown>, sensRec: Record<string, unknown>, field: DiffField) => {
    if (SENS_DIFF_FIELDS.some((f) => f.key === field.key)) return sensRec[field.key];
    return rec[field.key];
  };

  const ALL_DIFF_FIELDS = [...NS_DIFF_FIELDS, ...SENS_DIFF_FIELDS];
  const changedFields = ALL_DIFF_FIELDS.filter(
    (f) => !valuesEqual(getVal(origNs, origSens, f), getVal(updNs, updSens, f))
  );
  const unchangedFields = ALL_DIFF_FIELDS.filter(
    (f) => valuesEqual(getVal(origNs, origSens, f), getVal(updNs, updSens, f))
  );

  return (
    <div className="border rounded overflow-hidden text-sm">
      {/* Header */}
      <div className="grid grid-cols-2 text-xs font-semibold">
        <div className="bg-red-50 border-b border-r border-red-200 px-3 py-2 text-red-800">
          ← Original #{originalIncidentId}
          {original.reference_number && (
            <span className="ml-2 font-mono text-red-700 bg-red-100 px-1 rounded">{original.reference_number}</span>
          )}
        </div>
        <div className="bg-green-50 border-b border-green-200 px-3 py-2 text-green-800">
          Update Request #{updateIncidentId} →
        </div>
      </div>

      {changedFields.length === 0 ? (
        <div className="px-3 py-4 text-center text-gray-500 text-sm">
          No field differences found between the original and update request.
        </div>
      ) : (
        <>
          {changedFields.map((f) => (
            <div key={f.key} className="grid grid-cols-2 border-b last:border-b-0">
              <div className="col-span-2 bg-yellow-50 border-b px-3 py-1 text-xs font-semibold text-yellow-800">
                {f.label}
              </div>
              <div className="px-3 py-2 bg-red-50 border-r text-red-900 break-words">
                {fmtValue(getVal(origNs, origSens, f), f.format)}
              </div>
              <div className="px-3 py-2 bg-green-50 text-green-900 font-medium break-words">
                {fmtValue(getVal(updNs, updSens, f), f.format)}
              </div>
            </div>
          ))}
        </>
      )}

      {/* Footer */}
      <div className="px-3 py-2 bg-gray-50 border-t flex items-center justify-between text-xs text-gray-500">
        <span>
          <span className="font-semibold text-yellow-700">{changedFields.length}</span> field
          {changedFields.length !== 1 ? 's' : ''} differ ·{' '}
          <span className="text-gray-400">{unchangedFields.length} unchanged</span>
        </span>
        {unchangedFields.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="text-blue-600 hover:underline"
          >
            {showAll ? 'Hide unchanged' : `Show all (${ALL_DIFF_FIELDS.length})`}
          </button>
        )}
      </div>

      {/* Unchanged fields (shown when showAll) */}
      {showAll && unchangedFields.map((f) => (
        <div key={f.key} className="grid grid-cols-2 border-b last:border-b-0">
          <div className="col-span-2 bg-gray-50 border-b px-3 py-1 text-xs font-medium text-gray-500">
            {f.label}
          </div>
          <div className="px-3 py-2 text-gray-700 border-r break-words">
            {fmtValue(getVal(origNs, origSens, f), f.format)}
          </div>
          <div className="px-3 py-2 text-gray-700 break-words">
            {fmtValue(getVal(updNs, updSens, f), f.format)}
          </div>
        </div>
      ))}
    </div>
  );
}
