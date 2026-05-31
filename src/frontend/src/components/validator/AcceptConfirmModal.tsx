"use client";

import { useState } from "react";
import { IncidentDiffPanel } from "@/components/IncidentDiffPanel";
import type { ValidatorIncident } from "./types";

interface Props {
  target: ValidatorIncident;
  regionDisplay: (regionId: number) => string;
  onClose: () => void;
  onConfirm: (inc: ValidatorIncident) => void;
}

export function AcceptConfirmModal({ target, regionDisplay, onClose, onConfirm }: Props) {
  const [showConfirmDiff, setShowConfirmDiff] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Confirm Acceptance</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          Incident #{target.incident_id} · {target.fire_station_name ?? "Unknown station"} · {regionDisplay(target.region_id)}
        </p>
        <button
          onClick={() => setShowConfirmDiff((v) => !v)}
          className="text-sm font-medium underline mb-4 block"
          style={{ color: 'var(--bfp-red)' }}
        >
          {showConfirmDiff ? "Hide" : "View"} revision history
        </button>
        {showConfirmDiff && (
          <div className="mb-4">
            <IncidentDiffPanel incidentId={target.incident_id} />
          </div>
        )}
        <div className="flex justify-end gap-3 mt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(target)}
            className="px-4 py-2 text-sm rounded-lg text-white"
            style={{ backgroundColor: '#16A34A' }}
          >
            Confirm Accept
          </button>
        </div>
      </div>
    </div>
  );
}
