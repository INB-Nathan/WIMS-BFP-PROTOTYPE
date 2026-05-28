"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface RevisionEntry {
  history_id: number;
  previous_status: string;
  new_status: string;
  notes: string | null;
  action_label: string | null;
  action_timestamp: string | null;
  actor_username: string | null;
}

interface HistoryResponse {
  incident_id: number;
  history: RevisionEntry[];
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING: "Pending",
  PENDING_VALIDATION: "Awaiting Validation",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
  REPLACED: "Replaced",
};

const LABEL_COLORS: Record<string, { bg: string; text: string }> = {
  SUBMITTED:     { bg: "#DBEAFE", text: "#1D4ED8" },
  RESUBMITTED:   { bg: "#DBEAFE", text: "#1D4ED8" },
  APPROVED:      { bg: "#DCFCE7", text: "#15803D" },
  BULK_APPROVED: { bg: "#DCFCE7", text: "#15803D" },
  REJECTED:      { bg: "#FEE2E2", text: "#B91C1C" },
  CORRECTION:    { bg: "#F3E8FF", text: "#6D28D9" },
  ARCHIVED:      { bg: "#F3F4F6", text: "#6B7280" },
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function IncidentRevisionHistory({ incidentId }: { incidentId: number }) {
  const [history, setHistory] = useState<RevisionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<HistoryResponse>(`/regional/validator/incidents/${incidentId}/history`);
        if (!cancelled) setHistory(data.history);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load history");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [incidentId]);

  if (loading) {
    return <div className="text-sm py-3" style={{ color: "var(--text-muted)" }}>Loading revision history…</div>;
  }
  if (error) {
    return <div className="text-sm text-red-500 py-2">{error}</div>;
  }
  if (history.length === 0) {
    return <div className="text-sm py-3" style={{ color: "var(--text-muted)" }}>No revision history recorded.</div>;
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
      <ol className="space-y-4">
        {history.map((entry, idx) => {
          const labelStyle = entry.action_label
            ? (LABEL_COLORS[entry.action_label] ?? { bg: "#F3F4F6", text: "#6B7280" })
            : null;
          const isLast = idx === history.length - 1;
          return (
            <li key={entry.history_id} className="relative flex gap-3">
              {/* connector line */}
              {!isLast && (
                <div
                  className="absolute left-[11px] top-6 bottom-0 w-px"
                  style={{ backgroundColor: "#E5E7EB" }}
                />
              )}
              {/* dot */}
              <div
                className="mt-0.5 h-6 w-6 flex-shrink-0 rounded-full border-2 border-white flex items-center justify-center text-xs font-bold"
                style={{ backgroundColor: "#D1D5DB", zIndex: 1 }}
              />
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {STATUS_LABELS[entry.previous_status] ?? entry.previous_status}
                    {" → "}
                    {STATUS_LABELS[entry.new_status] ?? entry.new_status}
                  </span>
                  {labelStyle && entry.action_label && (
                    <span
                      className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold"
                      style={{ backgroundColor: labelStyle.bg, color: labelStyle.text }}
                    >
                      {entry.action_label}
                    </span>
                  )}
                </div>
                <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {entry.actor_username ?? "Unknown"} · {fmt(entry.action_timestamp)}
                </div>
                {entry.notes && (
                  <div
                    className="mt-1.5 text-xs rounded-lg border border-gray-200 bg-white px-3 py-2"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {entry.notes}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
