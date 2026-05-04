"use client";

/**
 * /dashboard/validator — NATIONAL_VALIDATOR incident queue.
 *
 * Mirrors the patterns in /dashboard/regional (encoder dashboard):
 *  - Calls its own backend endpoint  GET /regional/validator/incidents
 *  - Sends decisions via             PATCH /regional/incidents/:id/verification
 *  - Uses the same apiFetch helper from src/lib/api.ts
 *  - Owns its own loading / error / empty states
 *
 * NATIONAL_VALIDATOR has cross-region authority — this page surfaces
 * encoder-submitted incidents from all regions awaiting verification.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { apiFetch, fetchValidatorStats } from "@/lib/api";
import { IncidentDiffPanel } from "@/components/IncidentDiffPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ValidatorIncident {
  incident_id: number;
  verification_status: string;
  encoder_id: string | null;
  region_id: number;
  created_at: string | null;
  notification_dt: string | null;
  general_category: string | null;
  alarm_level: string | null;
  fire_station_name: string | null;
  structures_affected: number | null;
  households_affected: number | null;
  responder_type: string | null;
  fire_origin: string | null;
  extent_of_damage: string | null;
}

interface QueueResponse {
  items: ValidatorIncident[];
  total: number;
  limit: number;
  offset: number;
}

type ActionType = "accept" | "pending" | "reject";

const STATUS_FILTER_QUEUE = "__QUEUE__";
const STATUS_FILTER_ALL = "__ALL__";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING: "Pending Review",
  PENDING_VALIDATION: "Awaiting Validation",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING: "bg-yellow-100 text-yellow-800",
  PENDING_VALIDATION: "bg-blue-100 text-blue-800",
  VERIFIED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ValidatorDashboard() {
  const [incidents, setIncidents] = useState<ValidatorIncident[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters — default to pending queue
  const [statusFilter, setStatusFilter] = useState<string>(STATUS_FILTER_QUEUE);
  const [encoderFilter, setEncoderFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Stats
  const [stats, setStats] = useState<{ total_verified: number; pending_validation: number; by_category: { category: string; count: number }[] } | null>(null);

  // Action modal state
  const [actionTarget, setActionTarget] = useState<ValidatorIncident | null>(null);
  const [actionType, setActionType] = useState<ActionType | null>(null);
  const [actionNotes, setActionNotes] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  // M4-H: bulk approve selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const togglePending = (inc: ValidatorIncident, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(inc.incident_id);
      else next.delete(inc.incident_id);
      return next;
    });
  };

  const allPendingSelected =
    incidents.filter((i) => i.verification_status === "PENDING").length > 0 &&
    incidents
      .filter((i) => i.verification_status === "PENDING")
      .every((i) => selectedIds.has(i.incident_id));

  const toggleSelectAllPending = (checked: boolean) => {
    if (checked) {
      setSelectedIds(
        new Set(
          incidents
            .filter((i) => i.verification_status === "PENDING")
            .map((i) => i.incident_id),
        ),
      );
    } else {
      setSelectedIds(new Set());
    }
  };

  const submitBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Approve ${selectedIds.size} incident${selectedIds.size !== 1 ? 's' : ''}?`)) return;
    setBulkLoading(true);
    setBulkError(null);
    try {
      await apiFetch('/regional/validator/incidents/bulk-approve', {
        method: 'POST',
        body: JSON.stringify({ incident_ids: Array.from(selectedIds) }),
      });
      setSelectedIds(new Set());
      await fetchQueue();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bulk approve failed';
      setBulkError(msg);
    } finally {
      setBulkLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Fetch queue
  // ---------------------------------------------------------------------------

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    if (statusFilter === STATUS_FILTER_ALL) {
      params.set("show_all", "true");
    } else if (statusFilter && statusFilter !== STATUS_FILTER_QUEUE) {
      params.set("status", statusFilter);
    }
    if (encoderFilter) params.set("encoder_id", encoderFilter.trim());

    try {
      const data: QueueResponse = await apiFetch(
        `/regional/validator/incidents?${params.toString()}`
      );
      setIncidents(data.items);
      setTotal(data.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, encoderFilter]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  useEffect(() => {
    fetchValidatorStats().then(setStats).catch(() => {/* non-critical */});
  }, []);

  // ---------------------------------------------------------------------------
  // Submit validator decision
  // ---------------------------------------------------------------------------

  const submitAction = async () => {
    if (!actionTarget || !actionType) return;
    setActionLoading(true);
    setActionError(null);

    try {
      await apiFetch(
        `/regional/incidents/${actionTarget.incident_id}/verification`,
        {
          method: "PATCH",
          body: JSON.stringify({
            action: actionType,
            notes: actionNotes.trim() || null,
          }),
        }
      );

      // Optimistic update — replace just this row's status in local state
      const nextStatus =
        actionType === "accept"
          ? "VERIFIED"
          : actionType === "reject"
          ? "REJECTED"
          : "PENDING";

      setIncidents((prev) =>
        prev.map((inc) =>
          inc.incident_id === actionTarget.incident_id
            ? { ...inc, verification_status: nextStatus }
            : inc
        )
      );

      // Close modal
      setActionTarget(null);
      setActionType(null);
      setActionNotes("");
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const openAction = (inc: ValidatorIncident, type: ActionType) => {
    setActionTarget(inc);
    setActionType(type);
    setActionNotes("");
    setActionError(null);
    setShowDiff(false);
  };

  const closeModal = () => {
    if (actionLoading) return;
    setActionTarget(null);
    setActionType(null);
    setActionNotes("");
    setActionError(null);
    setShowDiff(false);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-2xl font-bold">Validator Queue</h1>
        <Link
          href="/dashboard/validator/audit"
          className="text-sm font-medium text-blue-700 hover:text-blue-900"
        >
          Audit Trail →
        </Link>
      </div>
      <p className="text-gray-500 text-sm mb-6">
        Encoder-submitted incidents from all regions awaiting review.
      </p>

      {/* ── Summary cards ── */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs text-gray-500">Awaiting Validation</p>
            <p className="text-2xl font-bold text-blue-700">{stats.pending_validation}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs text-gray-500">Total Verified</p>
            <p className="text-2xl font-bold text-green-700">{stats.total_verified}</p>
          </div>
          {(['STRUCTURAL', 'NON_STRUCTURAL', 'VEHICULAR'] as const).map((cat) => {
            const entry = stats.by_category.find((c) => c.category === cat);
            const label = cat === 'NON_STRUCTURAL' ? 'Non-Structural' : cat.charAt(0) + cat.slice(1).toLowerCase();
            return (
              <div key={cat} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs text-gray-500">{label}</p>
                <p className="text-2xl font-bold text-gray-800">{entry?.count ?? 0}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-4 mb-6">
        <select
          className="border rounded px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
        >
          <option value={STATUS_FILTER_QUEUE}>Pending</option>
          <option value="REJECTED">Rejected</option>
          <option value="VERIFIED">Accepted</option>
        </select>

        <input
          type="text"
          placeholder="Filter by Encoder UUID…"
          className="border rounded px-3 py-2 text-sm w-72"
          value={encoderFilter}
          onChange={(e) => { setEncoderFilter(e.target.value); setPage(0); }}
        />

        <button
          onClick={fetchQueue}
          className="bg-gray-100 hover:bg-gray-200 border rounded px-4 py-2 text-sm"
        >
          ↺ Refresh
        </button>

        {/* M4-H: Bulk approve action */}
        {selectedIds.size > 0 && (
          <button
            onClick={submitBulkApprove}
            disabled={bulkLoading}
            className="ml-auto bg-green-600 hover:bg-green-700 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {bulkLoading
              ? 'Approving…'
              : `Bulk Approve (${selectedIds.size})`}
          </button>
        )}
      </div>
      {bulkError && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 mb-4">
          {bulkError}
        </div>
      )}

      {/* ── States ── */}
      {loading && (
        <div className="text-gray-400 text-sm py-12 text-center">Loading…</div>
      )}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700 text-sm mb-4">
          {error}
        </div>
      )}
      {!loading && !error && incidents.length === 0 && (
        <div className="text-gray-400 text-sm py-12 text-center">
          No incidents match the current filters.
        </div>
      )}

      {/* ── Incident table ── */}
      {!loading && incidents.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-3 font-medium w-8">
                  <input
                    type="checkbox"
                    checked={allPendingSelected}
                    onChange={(e) => toggleSelectAllPending(e.target.checked)}
                    title="Select all PENDING"
                  />
                </th>
                <th className="text-left px-4 py-3 font-medium">ID</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Station</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-left px-4 py-3 font-medium">Alarm</th>
                <th className="text-left px-4 py-3 font-medium">Structures</th>
                <th className="text-left px-4 py-3 font-medium">Notification</th>
                <th className="text-left px-4 py-3 font-medium">Region</th>
                <th className="text-left px-4 py-3 font-medium">Details</th>
                <th className="text-left px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {incidents.map((inc) => (
                <tr key={inc.incident_id} className="hover:bg-gray-50">
                  <td className="px-3 py-3">
                    {inc.verification_status === "PENDING" ? (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(inc.incident_id)}
                        onChange={(e) => togglePending(inc, e.target.checked)}
                      />
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{inc.incident_id}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        STATUS_COLORS[inc.verification_status] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {STATUS_LABELS[inc.verification_status] ?? inc.verification_status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{inc.fire_station_name ?? "—"}</td>
                  <td className="px-4 py-3">{inc.general_category ?? "—"}</td>
                  <td className="px-4 py-3">{inc.alarm_level ?? "—"}</td>
                  <td className="px-4 py-3">{inc.structures_affected ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {inc.notification_dt
                      ? new Date(inc.notification_dt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {inc.region_id ? `Region ${inc.region_id}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/regional/incidents/${inc.incident_id}`}
                      className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button
                        onClick={() => openAction(inc, "accept")}
                        disabled={inc.verification_status === "VERIFIED"}
                        className="px-2 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => openAction(inc, "pending")}
                        disabled={inc.verification_status === "PENDING"}
                        className="px-2 py-1 text-xs rounded bg-yellow-500 text-white hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Pend
                      </button>
                      <button
                        onClick={() => openAction(inc, "reject")}
                        disabled={inc.verification_status === "REJECTED"}
                        className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {total > PAGE_SIZE && (
        <div className="flex items-center gap-4 mt-4 text-sm text-gray-600">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            ← Prev
          </button>
          <span>
            Page {page + 1} of {totalPages} · {total} total
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}

      {/* ── Action confirmation modal ── */}
      {actionTarget && actionType && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-1">
              {actionType === "accept"
                ? "Accept Incident"
                : actionType === "reject"
                ? "Reject Incident"
                : "Return to Pending"}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Incident #{actionTarget.incident_id} ·{" "}
              {actionTarget.fire_station_name ?? "Unknown station"}
            </p>

            <div className="mb-4">
              <button
                type="button"
                onClick={() => setShowDiff((s) => !s)}
                className="text-xs font-medium text-blue-700 hover:text-blue-900 underline"
              >
                {showDiff ? "Hide" : "View"} changes since submission
              </button>
              {showDiff && (
                <div className="mt-2">
                  <IncidentDiffPanel incidentId={actionTarget.incident_id} />
                </div>
              )}
            </div>

            {actionType === "reject" && (
              <>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason for rejection <span className="text-red-600">*</span>
                </label>
                <textarea
                  className="w-full border rounded px-3 py-2 text-sm h-24 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Required for rejection…"
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  disabled={actionLoading}
                />
              </>
            )}

            {actionError && (
              <p className="mt-2 text-sm text-red-600">{actionError}</p>
            )}

            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={closeModal}
                disabled={actionLoading}
                className="px-4 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={submitAction}
                disabled={actionLoading || (actionType === "reject" && !actionNotes.trim())}
                className={`px-4 py-2 text-sm rounded text-white disabled:opacity-50 ${
                  actionType === "accept"
                    ? "bg-green-600 hover:bg-green-700"
                    : actionType === "reject"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-yellow-500 hover:bg-yellow-600"
                }`}
              >
                {actionLoading ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
