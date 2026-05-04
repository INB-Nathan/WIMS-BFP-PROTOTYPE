'use client';

import { useState } from 'react';
import type { DuplicateInfo, RowResolution, DuplicateAction } from '@/lib/api';

interface DuplicateResolutionModalProps {
  duplicates: DuplicateInfo[];
  radiusMeters: number;
  minMatchingFields: number;
  onResolve: (resolutions: RowResolution[]) => void;
  onCancel: () => void;
}

const ACTION_OPTIONS: { value: DuplicateAction; label: string; description: string }[] = [
  { value: 'skip', label: 'Skip', description: 'Do not import this row' },
  { value: 'merge', label: 'Merge', description: 'Update the existing incident with this row' },
  { value: 'force', label: 'Force Create', description: 'Create as a new incident anyway' },
];

export function DuplicateResolutionModal({
  duplicates,
  radiusMeters,
  minMatchingFields,
  onResolve,
  onCancel,
}: DuplicateResolutionModalProps) {
  const [decisions, setDecisions] = useState<Record<number, DuplicateAction>>(
    Object.fromEntries(duplicates.map((d) => [d.row_index, 'skip' as DuplicateAction])),
  );

  const setDecision = (rowIndex: number, action: DuplicateAction) => {
    setDecisions((prev) => ({ ...prev, [rowIndex]: action }));
  };

  const submit = () => {
    const resolutions: RowResolution[] = duplicates.map((d) => ({
      row_index: d.row_index,
      action: decisions[d.row_index] ?? 'skip',
      existing_incident_id:
        decisions[d.row_index] === 'merge' ? d.existing_incident_id : null,
    }));
    onResolve(resolutions);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
        <div className="border-b px-6 py-4 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-gray-900">Possible duplicate incidents detected</h2>
          <p className="text-sm text-gray-600 mt-1">
            The following rows match existing incidents within{' '}
            <span className="font-medium">{radiusMeters} meters</span> on at least{' '}
            <span className="font-medium">{minMatchingFields}</span> fields. Choose how to
            resolve each one.
          </p>
        </div>

        <div className="p-6 space-y-6">
          {duplicates.map((dup) => (
            <div
              key={dup.row_index}
              className="border rounded-lg p-4 bg-gray-50"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <p className="font-semibold text-sm text-gray-900">
                    Import row #{dup.row_index + 1} matches existing incident{' '}
                    <span className="font-mono">#{dup.existing_incident_id}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Distance: <span className="font-medium">{dup.distance_m.toFixed(1)} m</span>
                    {'  •  '}
                    Matched fields:{' '}
                    <span className="font-medium">{dup.matched_fields.join(', ')}</span>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs mb-3">
                <div className="bg-white border rounded p-2">
                  <p className="font-bold text-blue-700 mb-1">Incoming row</p>
                  {Object.entries(dup.incoming_values).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <span className="text-gray-500">{k}</span>
                      <span
                        className={`text-gray-900 font-medium ${
                          dup.matched_fields.includes(k) ? 'bg-yellow-100' : ''
                        }`}
                      >
                        {v ?? '—'}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="bg-white border rounded p-2">
                  <p className="font-bold text-green-700 mb-1">
                    Existing incident #{dup.existing_incident_id}
                  </p>
                  {Object.entries(dup.existing_values).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <span className="text-gray-500">{k}</span>
                      <span
                        className={`text-gray-900 font-medium ${
                          dup.matched_fields.includes(k) ? 'bg-yellow-100' : ''
                        }`}
                      >
                        {v ?? '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mt-2">
                {ACTION_OPTIONS.map((opt) => {
                  const selected = decisions[dup.row_index] === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={`flex-1 min-w-[140px] cursor-pointer border rounded px-3 py-2 text-xs ${
                        selected
                          ? 'border-blue-500 bg-blue-50 text-blue-900'
                          : 'border-gray-300 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`action-${dup.row_index}`}
                        className="mr-1.5"
                        checked={selected}
                        onChange={() => setDecision(dup.row_index, opt.value)}
                      />
                      <span className="font-semibold">{opt.label}</span>
                      <span className="block text-[10px] text-gray-600 mt-0.5">
                        {opt.description}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t px-6 py-4 flex justify-end gap-3 sticky bottom-0 bg-white">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="px-4 py-2 text-sm rounded bg-red-800 text-white hover:bg-red-700"
          >
            Confirm Decisions
          </button>
        </div>
      </div>
    </div>
  );
}
