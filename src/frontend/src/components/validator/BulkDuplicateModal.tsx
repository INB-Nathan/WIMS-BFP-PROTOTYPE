"use client";

import { UpdateRequestDiffPanel } from "@/components/UpdateRequestDiffPanel";
import type { ValidatorIncident } from "./types";

interface Props {
  target: ValidatorIncident;
  regionDisplay: (regionId: number) => string;
  onResolve: (decision: string) => void;
}

export function BulkDuplicateModal({ target, regionDisplay, onResolve }: Props) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Duplicate Detected in Batch</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          Incident #{target.incident_id} · {target.fire_station_name ?? "Unknown station"} · {regionDisplay(target.region_id)}
        </p>
        <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-xl text-sm text-orange-800">
          This incident may be a duplicate of a verified record. Choose how to proceed.
        </div>
        {target.is_duplicate && target.duplicate_of && (
          <div className="mb-4">
            <UpdateRequestDiffPanel updateIncidentId={target.incident_id} originalIncidentId={target.duplicate_of} />
          </div>
        )}
        <div className="flex flex-wrap gap-2 justify-end mt-4">
          <button onClick={() => onResolve("skip")} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Skip (Leave Pending)</button>
          <button onClick={() => onResolve("reject")} className="px-4 py-2 text-sm rounded-lg text-white" style={{ backgroundColor: '#991B1B' }}>Reject</button>
          <button onClick={() => onResolve("accept_replace")} className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700">Replace Original</button>
          <button onClick={() => onResolve("accept")} className="px-4 py-2 text-sm rounded-lg text-white" style={{ backgroundColor: '#16A34A' }}>Accept as New</button>
        </div>
      </div>
    </div>
  );
}
