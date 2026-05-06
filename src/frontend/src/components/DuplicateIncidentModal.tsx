'use client';

import Link from 'next/link';
import type { RefDuplicateIncident } from '@/lib/api';
import { formatClassification } from '@/lib/afor-utils';

interface CurrentFormSummary {
  region: string;
  classification: string;
  typeOfInvolved: string;
  incidentTypeCode: string;
  stationCode: string;
  stationName: string;
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

function formatDt(raw: string | null | undefined): string {
  if (!raw) return '—';
  try {
    const dt = new Date(raw);
    const datePart = dt.toLocaleDateString('en-PH', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const timePart = dt.toLocaleTimeString('en-PH', {
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
    return `${datePart} | ${timePart}`;
  } catch {
    return raw;
  }
}

function formatCurrentDate(date: string, time: string): string {
  if (!date) return '—';
  return formatDt(`${date}T${time || '00:00'}:00`);
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

  const existingAddress = first.street_address || [
    first.city_municipality,
    first.province_district,
  ].filter(Boolean).join(', ') || '—';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dup-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
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
          {isVerified ? (
            /* Verified incidents: no comparison needed */
            <div className="rounded-lg bg-green-50 border border-green-300 p-4 space-y-3">
              <p className="font-semibold text-green-900">
                This duplicate is already verified with reference number: <span className="font-mono text-sm bg-white px-2 py-1 rounded">{first.reference_number}</span>
              </p>
              <p className="text-sm text-green-800">
                A verified incident cannot be modified. You can submit this as a new separate incident, or go back and edit your form.
              </p>
            </div>
          ) : (
            /* Non-verified: show comparison */
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Left: Current form — NO Reference No. */}
            <div className="border-2 border-blue-500 rounded-lg p-4 space-y-2">
              <p className="text-xs font-bold uppercase text-blue-700 tracking-wide mb-3">
                Current (about to submit)
              </p>
              <Row label="Region"           value={currentForm.region || '—'} />
              <Row label="Station"          value={currentForm.stationName || currentForm.stationCode || '—'} />
              <Row label="Fire Date"        value={formatCurrentDate(currentForm.fireDate, currentForm.fireTime)} />
              <Row label="Classification"   value={currentForm.classification || '—'} />
              <Row label="Type of Involved" value={currentForm.typeOfInvolved || '—'} />
              <Row label="Alarm Level"      value={currentForm.alarmLevel || '—'} />
              <Row label="Address"          value={currentForm.address || '—'} />
            </div>

            {/* Right: Existing incident — WITH Reference No. and Status */}
            <div className="border-2 border-amber-500 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase text-amber-700 tracking-wide">
                  Existing Incident #{first.incident_id}
                </p>
                <Link
                  href={`/dashboard/regional/incidents/${first.incident_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline font-medium"
                >
                  View Full ↗
                </Link>
              </div>

              {first.reference_number && (
                <Row
                  label="Reference No."
                  value={
                    <span className="font-mono text-xs text-amber-800 bg-amber-50 px-1 rounded">
                      {first.reference_number}
                    </span>
                  }
                />
              )}

              <Row
                label="Status"
                value={
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${STATUS_COLORS[first.verification_status] ?? 'bg-gray-100 text-gray-700'}`}>
                    {STATUS_LABELS[first.verification_status] ?? first.verification_status}
                  </span>
                }
              />

              <Row label="Region"           value={first.region_name || '—'} />
              <Row label="Station"          value={first.fire_station_name || first.station_code || '—'} />
              <Row label="Fire Date"        value={formatDt(first.notification_dt)} />
              <Row label="Classification"   value={formatClassification(first.general_category)} />
              <Row label="Type of Involved" value={first.type_of_involved ?? '—'} />
              <Row label="Alarm Level"      value={first.alarm_level ?? '—'} />
              <Row label="Address"          value={existingAddress} />
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
            </>
          )}
        </div>

        {/* Action buttons */}
        <div className="border-t border-gray-200 px-5 py-4 flex flex-col sm:flex-row gap-3 justify-end">
          <button
            type="button"
            onClick={onEditCurrent}
            className="order-3 sm:order-1 px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel / Keep Editing
          </button>

          {/* VERIFIED / PENDING_VALIDATION */}
          {isVerified ? (
            <>
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
          ) : isPending ? (
            /* PENDING: offer update request (links to pending original) or new */
            <>
              <button
                type="button"
                onClick={onKeepBoth}
                className="order-2 px-4 py-2 rounded-lg border border-blue-500 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                title="Create this as a separate new incident"
              >
                Submit as New
              </button>
              <button
                type="button"
                onClick={() => onRequestUpdate(first.incident_id)}
                className="order-1 sm:order-3 px-4 py-2 rounded-lg bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800"
                title="Submit as an update request linked to the existing pending incident"
              >
                Submit as Update to #{first.incident_id}
              </button>
            </>
          ) : isDraft ? (
            <>
              <button
                type="button"
                onClick={onKeepBoth}
                className="order-2 px-4 py-2 rounded-lg border border-blue-500 text-sm font-semibold text-blue-700 hover:bg-blue-50"
              >
                Submit as New
              </button>
              <button
                type="button"
                onClick={() => onReplace(first.incident_id)}
                className="order-1 sm:order-3 px-4 py-2 rounded-lg bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800"
                title="Overwrite the existing draft with the data from this form"
              >
                Replace Draft (#{first.incident_id})
              </button>
            </>
          ) : (
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
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-gray-500 w-32 shrink-0 text-right">{label}:</span>
      <span className="font-medium text-gray-900 flex-1">{value}</span>
    </div>
  );
}
