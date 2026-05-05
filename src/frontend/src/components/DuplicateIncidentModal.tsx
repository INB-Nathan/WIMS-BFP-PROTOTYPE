'use client';

import type { RefDuplicateIncident } from '@/lib/api';

interface CurrentFormSummary {
  region: string;
  classification: string;
  typeOfInvolved: string;
  incidentTypeCode: string;
  stationCode: string;
  fireDate: string;
  fireTime: string;
  alarmLevel: string;
  address: string;
  referencePreview: string;
}

interface DuplicateIncidentModalProps {
  duplicates: RefDuplicateIncident[];
  currentForm: CurrentFormSummary;
  onKeepBoth: () => void;
  onReplace: (existingIncidentId: number) => void;
  onRequestUpdate: (existingIncidentId: number) => void;
  onEditCurrent: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING: 'Pending Review',
  PENDING_VALIDATION: 'Pending Validation',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  PENDING: 'bg-yellow-100 text-yellow-800',
  PENDING_VALIDATION: 'bg-blue-100 text-blue-800',
  VERIFIED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-700',
};

function formatDt(raw: string | null): string {
  if (!raw) return 'N/A';
  try {
    return new Date(raw).toLocaleString('en-PH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return raw;
  }
}

export function DuplicateIncidentModal({
  duplicates,
  currentForm,
  onKeepBoth,
  onReplace,
  onRequestUpdate,
  onEditCurrent,
}: DuplicateIncidentModalProps) {
  const first = duplicates[0];
  const isVerified = first.verification_status === 'VERIFIED' || first.verification_status === 'PENDING_VALIDATION';
  const isPending = first.verification_status === 'PENDING';
  const isDraft = first.verification_status === 'DRAFT';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dup-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 bg-amber-700 text-white px-5 py-4 rounded-t-xl">
          <span className="text-2xl">⚠️</span>
          <div>
            <h2 id="dup-modal-title" className="text-lg font-bold">Possible Duplicate Incident Detected</h2>
            <p className="text-sm text-amber-100">
              {duplicates.length === 1
                ? 'An existing incident shares the same region, type, and fire date.'
                : `${duplicates.length} existing incidents share the same region, type, and fire date.`}
            </p>
          </div>
        </div>

        {/* Side-by-side comparison */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: Current form */}
            <div className="border-2 border-blue-500 rounded-lg p-4 space-y-3">
              <p className="text-xs font-bold uppercase text-blue-700 tracking-wide mb-2">Current (about to submit)</p>
              <Row label="Reference No." value={currentForm.referencePreview} highlight />
              <Row label="Region" value={currentForm.region} />
              <Row label="Fire Date" value={`${currentForm.fireDate} ${currentForm.fireTime}`} />
              <Row label="Classification" value={currentForm.classification} />
              <Row label="Type of Involved" value={currentForm.typeOfInvolved || '—'} />
              <Row label="Type Code" value={currentForm.incidentTypeCode || '—'} />
              <Row label="Station Code" value={currentForm.stationCode} />
              <Row label="Alarm Level" value={currentForm.alarmLevel || '—'} />
              <Row label="Address" value={currentForm.address || '—'} />
            </div>

            {/* Right: Existing incident */}
            <div className="border-2 border-amber-500 rounded-lg p-4 space-y-3">
              <p className="text-xs font-bold uppercase text-amber-700 tracking-wide mb-2">
                Existing Incident #{first.incident_id}
              </p>
              <Row
                label="Reference No."
                value={first.reference_number ?? 'N/A'}
                highlight={!!first.reference_number}
              />
              <Row label="Status" value={
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${STATUS_COLORS[first.verification_status] ?? 'bg-gray-100 text-gray-700'}`}>
                  {STATUS_LABELS[first.verification_status] ?? first.verification_status}
                </span>
              } />
              <Row label="Fire Date" value={formatDt(first.notification_dt)} />
              <Row label="Classification" value={first.general_category ?? '—'} />
              <Row label="Type of Involved" value={first.type_of_involved ?? '—'} />
              <Row label="Type Code" value={first.incident_type_code ?? '—'} />
              <Row label="Station Code" value={first.station_code ?? 'TBA'} />
              <Row label="Alarm Level" value={first.alarm_level ?? '—'} />
              <Row label="Fire Station" value={first.fire_station_name ?? '—'} />
            </div>
          </div>

          {duplicates.length > 1 && (
            <p className="mt-3 text-xs text-gray-500 text-center">
              Showing first duplicate. {duplicates.length - 1} more exist with the same key fields.
            </p>
          )}

          <div className="mt-4 rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs text-gray-600 space-y-1">
            <p className="font-semibold text-gray-800">Duplicate key fields:</p>
            <p>Region + Incident Type Code + Year + Month + Day of fire notification</p>
          </div>
        </div>

        {/* Action buttons — differ by existing incident status */}
        <div className="border-t border-gray-200 px-5 py-4 flex flex-col sm:flex-row gap-3 justify-end">
          {/* Always present: cancel / go back to editing */}
          <button
            type="button"
            onClick={onEditCurrent}
            className="order-3 sm:order-1 px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel / Keep Editing
          </button>

          {isVerified ? (
            <>
              {/* VERIFIED or PENDING_VALIDATION: offer update-request OR new copy */}
              <button
                type="button"
                onClick={onKeepBoth}
                className="order-2 px-4 py-2 rounded-lg border border-blue-500 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                title="Create this as a separate new incident record"
              >
                Submit as New Copy
              </button>
              <button
                type="button"
                onClick={() => onRequestUpdate(first.incident_id)}
                className="order-1 sm:order-3 px-4 py-2 rounded-lg bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800"
                title="Submit as an update request — validator will review side-by-side with the existing verified record"
              >
                Submit as Update to #{first.incident_id}
              </button>
            </>
          ) : (isPending || isDraft) ? (
            <>
              {/* PENDING / DRAFT: offer replace OR submit as new */}
              <button
                type="button"
                onClick={onKeepBoth}
                className="order-2 px-4 py-2 rounded-lg border border-blue-500 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                title="Create this as a separate new incident, leaving the existing one unchanged"
              >
                Submit as New
              </button>
              <button
                type="button"
                onClick={() => onReplace(first.incident_id)}
                className="order-1 sm:order-3 px-4 py-2 rounded-lg bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800"
                title={`Overwrite the existing ${isPending ? 'pending' : 'draft'} incident with the data from this form`}
              >
                Replace {isPending ? 'Pending' : 'Draft'} (#{first.incident_id})
              </button>
            </>
          ) : (
            /* Fallback for any other status */
            <button
              type="button"
              onClick={onKeepBoth}
              className="order-2 px-4 py-2 rounded-lg border border-blue-500 text-sm font-semibold text-blue-700 hover:bg-blue-50"
            >
              Create Anyway (Keep Both)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-gray-500 w-32 shrink-0 text-right">{label}:</span>
      <span className={`font-medium ${highlight ? 'text-blue-800 font-mono text-xs bg-blue-50 px-1 rounded' : 'text-gray-900'}`}>
        {value}
      </span>
    </div>
  );
}
