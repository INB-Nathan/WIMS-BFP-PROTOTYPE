"use client";

import { formatClassification } from "@/lib/afor-utils";
import type { SyncedIncidentSummary } from "@/lib/useAutoSync";

interface SyncNotificationModalProps {
  incidents: SyncedIncidentSummary[];
  onConfirm: () => void;
}

/**
 * Modal listing incidents that were synced while the encoder was offline.
 * Shown after a successful reconnect sync.
 */
export function SyncNotificationModal({
  incidents,
  onConfirm,
}: SyncNotificationModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2
            className="text-base font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            Incidents Synced
          </h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            The following {incidents.length === 1 ? "incident was" : "incidents were"} successfully synced
            while you were offline.
          </p>
        </div>
        <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto px-6 py-2">
          {incidents.map((inc) => (
            <li
              key={`${inc.serverId}-${inc.operation}`}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <p
                  className="text-sm font-medium"
                  style={{ color: "var(--text-primary)" }}
                >
                  {formatClassification(inc.category) || "Incident"}
                  <span
                    className="ml-1.5 text-xs font-normal"
                    style={{ color: "var(--text-muted)" }}
                  >
                    #{inc.serverId}
                  </span>
                </p>
                {inc.location && (
                  <p
                    className="mt-0.5 truncate text-xs"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {inc.location}
                  </p>
                )}
                <p
                  className="mt-0.5 text-[11px] font-medium uppercase tracking-wide"
                  style={{ color: "var(--text-muted)" }}
                >
                  {inc.operation === "create"
                    ? "Created"
                    : inc.operation === "submit"
                      ? "Submitted"
                      : inc.operation === "update"
                        ? "Edited"
                        : "Deleted"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  inc.operation === "delete"
                    ? "bg-gray-100 text-gray-600"
                    : inc.operation === "submit"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-green-100 text-green-700"
                }`}
              >
                {inc.result}
              </span>
            </li>
          ))}
        </ul>
        <div className="border-t border-gray-100 px-6 py-4 flex justify-end">
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-900"
            style={{ backgroundColor: "#991B1B" }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
