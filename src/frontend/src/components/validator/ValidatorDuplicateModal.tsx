"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { UpdateRequestDiffPanel } from "@/components/UpdateRequestDiffPanel";
import { IncidentRevisionHistory } from "@/components/IncidentRevisionHistory";
import type { ValidatorIncident } from "./types";

interface Props {
  target: ValidatorIncident;
  matchedId: number;
  confidence: "LIKELY" | "POSSIBLE" | null;
  onClose: () => void;
  onReject: (inc: ValidatorIncident) => void;
  onRefresh: () => Promise<void>;
}

export function ValidatorDuplicateModal({
  target,
  matchedId,
  confidence,
  onClose,
  onReject,
  onRefresh,
}: Props) {
  const [showDupHistory, setShowDupHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReject = () => {
    onClose();
    onReject(target);
  };

  const handleReplace = () => {
    onClose();
    setLoading(true);
    setError(null);
    void apiFetch(`/regional/incidents/${target.incident_id}/verification?force=true`, {
      method: "PATCH",
      body: JSON.stringify({ action: "accept_replace", original_incident_id: matchedId }),
    }).then(() => onRefresh()).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Failed to replace existing");
    }).finally(() => setLoading(false));
  };

  const handleVerify = () => {
    onClose();
    setLoading(true);
    setError(null);
    void apiFetch(`/regional/incidents/${target.incident_id}/verification?force=true`, {
      method: "PATCH",
      body: JSON.stringify({ action: "accept" }),
    }).then(() => onRefresh()).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Failed to verify as new");
    }).finally(() => setLoading(false));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-1 text-amber-800">
          {confidence === "LIKELY" ? "Likely Duplicate Incident" : "Possible Duplicate Incident"}
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Incident #{target.incident_id} closely matches a verified record (#{matchedId}). Review the records side by side before deciding.
        </p>
        <div className="mb-4">
          <UpdateRequestDiffPanel updateIncidentId={target.incident_id} originalIncidentId={matchedId} />
        </div>
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setShowDupHistory((s) => !s)}
            className="text-xs font-medium underline"
            style={{ color: 'var(--bfp-red)' }}
          >
            {showDupHistory ? "Hide" : "View"} revision history
          </button>
          {showDupHistory && (
            <div className="mt-2">
              <IncidentRevisionHistory incidentId={target.incident_id} />
            </div>
          )}
        </div>
        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        <div className="flex flex-wrap gap-2 justify-end mt-4">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-40">Cancel</button>
          <button onClick={handleReject} disabled={loading} className="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50" style={{ backgroundColor: '#991B1B' }}>Reject</button>
          <button onClick={handleReplace} disabled={loading} className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
            {loading ? "Saving…" : "Replace Existing"}
          </button>
          <button onClick={handleVerify} disabled={loading} className="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50" style={{ backgroundColor: '#16A34A' }}>
            {loading ? "Saving…" : "Verify as New"}
          </button>
        </div>
      </div>
    </div>
  );
}
