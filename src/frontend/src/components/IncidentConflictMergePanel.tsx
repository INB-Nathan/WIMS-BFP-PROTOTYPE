'use client';

/**
 * Field-level merge UI shown when a PUT /incidents/{id} returns 409 Conflict.
 *
 * The 409 body contains { message, server_version } where server_version is a
 * flat dict of the current server state matching IncidentUpdateRequest fields.
 * This panel diffs the client draft against the server version and lets the
 * encoder pick which value to keep for each conflicting field, then re-submits
 * with force_update: true to bypass the concurrency check.
 */

import { useState } from 'react';
import { fieldLabel } from '@/lib/afor-utils';

interface IncidentConflictMergePanelProps {
  clientDraft: Record<string, unknown>;
  serverVersion: Record<string, unknown>;
  onSubmitMerge: (merged: Record<string, unknown>) => void;
  onCancel: () => void;
}

// Fields to include in the merge UI — ordered by display importance.
// Complex JSONB blobs (alarm_timeline, resources_deployed, etc.) are shown
// for awareness but the user picks the entire object, not sub-fields.
const MERGE_FIELDS = [
  'notification_dt',
  'alarm_level',
  'general_category',
  'sub_category',
  'specific_type',
  'occupancy_type',
  'fire_station_name',
  'responder_type',
  'fire_origin',
  'extent_of_damage',
  'stage_of_fire',
  'province_district',
  'city_municipality',
  'barangay',
  'street_address',
  'landmark',
  'structures_affected',
  'households_affected',
  'families_affected',
  'individuals_affected',
  'vehicles_affected',
  'civilian_injured',
  'civilian_deaths',
  'firefighter_injured',
  'firefighter_deaths',
  'estimated_damage_php',
  'total_response_time_minutes',
  'narrative_report',
  'recommendations',
  'caller_name',
  'caller_number',
  'owner_name',
  'occupant_name',
  'disposition',
  'alarm_timeline',
  'resources_deployed',
  'problems_encountered',
];

function displayValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const na = a === null || a === undefined || a === '';
  const nb = b === null || b === undefined || b === '';
  if (na && nb) return true;
  if (na !== nb) return false;
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return String(a).trim() === String(b).trim();
}

export function IncidentConflictMergePanel({
  clientDraft,
  serverVersion,
  onSubmitMerge,
  onCancel,
}: IncidentConflictMergePanelProps) {
  // Collect only fields that differ between draft and server
  const conflictFields = MERGE_FIELDS.filter(
    (k) => !valuesEqual(clientDraft[k], serverVersion[k])
  );

  // Track per-field selection: 'client' | 'server'. Default to client (user's work).
  const [choices, setChoices] = useState<Record<string, 'client' | 'server'>>(() =>
    Object.fromEntries(conflictFields.map((k) => [k, 'client']))
  );

  const handleSubmit = () => {
    const merged: Record<string, unknown> = { ...clientDraft };
    for (const k of conflictFields) {
      merged[k] = choices[k] === 'server' ? serverVersion[k] : clientDraft[k];
    }
    merged.force_update = true;
    // Remove client_updated_at so the backend skips the concurrency check
    delete merged.client_updated_at;
    onSubmitMerge(merged);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Concurrent Edit Conflict</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Another user saved changes while you were editing. Choose which version to keep for each field.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none mt-0.5"
            aria-label="Cancel"
          >
            ×
          </button>
        </div>

        {/* Field list */}
        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3">
          {conflictFields.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No conflicting fields detected.</p>
          ) : (
            conflictFields.map((field) => (
              <div key={field} className="border rounded-lg overflow-hidden text-sm">
                <div className="bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700 border-b">
                  {fieldLabel(field)}
                </div>
                <div className="grid grid-cols-2 divide-x">
                  {/* Client (your) version */}
                  <button
                    type="button"
                    onClick={() => setChoices((c) => ({ ...c, [field]: 'client' }))}
                    className={`text-left p-3 transition-colors ${
                      choices[field] === 'client'
                        ? 'bg-blue-50 ring-1 ring-inset ring-blue-400'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                        choices[field] === 'client' ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                      }`} />
                      <span className="text-xs font-medium text-blue-700">Your version</span>
                    </div>
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words font-sans">
                      {displayValue(clientDraft[field])}
                    </pre>
                  </button>

                  {/* Server version */}
                  <button
                    type="button"
                    onClick={() => setChoices((c) => ({ ...c, [field]: 'server' }))}
                    className={`text-left p-3 transition-colors ${
                      choices[field] === 'server'
                        ? 'bg-amber-50 ring-1 ring-inset ring-amber-400'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                        choices[field] === 'server' ? 'border-amber-500 bg-amber-500' : 'border-gray-300'
                      }`} />
                      <span className="text-xs font-medium text-amber-700">Server version</span>
                    </div>
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words font-sans">
                      {displayValue(serverVersion[field])}
                    </pre>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex justify-between items-center bg-gray-50 rounded-b-xl">
          <span className="text-xs text-gray-500">
            {conflictFields.length} conflicting field{conflictFields.length !== 1 ? 's' : ''}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium"
            >
              Submit Merged Version
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
