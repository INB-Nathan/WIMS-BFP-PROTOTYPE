"use client";

import { useState } from "react";
import { IncidentDiffPanel } from "@/components/IncidentDiffPanel";
import { UpdateRequestDiffPanel } from "@/components/UpdateRequestDiffPanel";
import { IncidentRevisionHistory } from "@/components/IncidentRevisionHistory";
import type { ValidatorIncident, ActionType } from "./types";

interface Props {
  target: ValidatorIncident;
  type: ActionType;
  isUpdateRequest: boolean;
  isDuplicateIncident: boolean;
  loading: boolean;
  error: string | null;
  notes: string;
  onClose: () => void;
  onNotesChange: (notes: string) => void;
  onSetActionType: (type: ActionType) => void;
  onSubmit: (force?: boolean, actionOverride?: ActionType) => void;
}

export function ActionModal({
  target,
  type,
  isUpdateRequest,
  isDuplicateIncident,
  loading,
  error,
  notes,
  onClose,
  onNotesChange,
  onSetActionType,
  onSubmit,
}: Props) {
  const [showDiff, setShowDiff] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        {(isUpdateRequest || isDuplicateIncident) && (
          <button onClick={onClose} className="mb-3 text-sm font-medium flex items-center gap-1" style={{ color: 'var(--bfp-red)' }}>
            â† Back
          </button>
        )}

        <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
          {type === "accept" || type === "accept_replace"
            ? isDuplicateIncident ? "Review Duplicate Incident" : "Accept Incident"
            : "Reject Incident"}
        </h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          Incident #{target.incident_id} · {target.fire_station_name ?? "Unknown station"}
        </p>

        <div className="mb-4">
          {isUpdateRequest ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">UPDATE REQUEST</span>
                <span className="text-xs text-gray-500">Encoder submitted this as an update to incident #{target.parent_incident_id}</span>
              </div>
              <UpdateRequestDiffPanel updateIncidentId={target.incident_id} originalIncidentId={target.parent_incident_id!} />
            </div>
          ) : isDuplicateIncident ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-800">FLAGGED DUPLICATE</span>
                <span className="text-xs text-gray-500">Matches verified incident #{target.duplicate_of}</span>
              </div>
              <UpdateRequestDiffPanel updateIncidentId={target.incident_id} originalIncidentId={target.duplicate_of!} />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-4 mb-1">
                <button
                  type="button"
                  onClick={() => setShowDiff((s) => !s)}
                  className="text-xs font-medium underline"
                  style={{ color: 'var(--bfp-red)' }}
                >
                  {showDiff ? "Hide" : "View"} changes since submission
                </button>
                <button
                  type="button"
                  onClick={() => setShowHistory((s) => !s)}
                  className="text-xs font-medium underline"
                  style={{ color: 'var(--bfp-red)' }}
                >
                  {showHistory ? "Hide" : "View"} revision history
                </button>
              </div>
              {showDiff && <div className="mt-2"><IncidentDiffPanel incidentId={target.incident_id} /></div>}
              {showHistory && <div className="mt-2"><IncidentRevisionHistory incidentId={target.incident_id} /></div>}
            </>
          )}
        </div>

        {type === "reject" && (
          <>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
              Reason for rejection <span style={{ color: 'var(--bfp-red)' }}>*</span>
            </label>
            <textarea
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm h-24 resize-none focus:outline-none focus:border-[#1A3263]"
              placeholder="Required for rejection…"
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              disabled={loading}
            />
          </>
        )}

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        {isDuplicateIncident && (type === "accept" || type === "accept_replace") ? (
          <div className="flex flex-wrap gap-2 justify-end mt-4">
            <button onClick={onClose} disabled={loading} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-40">Back</button>
            <button onClick={() => { onSetActionType("reject"); }} disabled={loading} className="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50" style={{ backgroundColor: '#1A3263' }}>Reject</button>
            <button onClick={() => { onSetActionType("accept_replace"); onSubmit(false, "accept_replace"); }} disabled={loading} className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">{loading ? "Saving…" : "Replace Original"}</button>
            <button onClick={() => { onSetActionType("accept"); onSubmit(true, "accept"); }} disabled={loading} className="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50" style={{ backgroundColor: '#16A34A' }}>{loading ? "Saving…" : "Accept as New"}</button>
          </div>
        ) : (
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={onClose} disabled={loading} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-40">Cancel</button>
            <button
              onClick={() => onSubmit()}
              disabled={loading || (type === "reject" && !notes.trim())}
              className="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50"
              style={{ backgroundColor: type === "accept" || type === "accept_replace" ? '#16A34A' : '#1A3263' }}
            >
              {loading ? "Saving…" : "Confirm"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

