"use client";

/**
 * /dashboard/validator — NATIONAL_VALIDATOR incident queue.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { apiFetch, fetchValidatorStats } from "@/lib/api";
import { IncidentDiffPanel } from "@/components/IncidentDiffPanel";
import { UpdateRequestDiffPanel } from "@/components/UpdateRequestDiffPanel";
import { formatClassification } from "@/lib/afor-utils";
import { PH_REGIONS } from "@/lib/ph-regions";

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
  parent_incident_id: number | null;
  is_duplicate: boolean;
  duplicate_of: number | null;
}

interface QueueResponse {
  items: ValidatorIncident[];
  total: number;
  limit: number;
  offset: number;
}

// accept | reject are the only standard actions; accept_replace for duplicate replacement;
// accept_new is used only inside the bulk/modal flow to force accept-as-new for duplicates.
type ActionType = "accept" | "accept_replace" | "reject";

const STATUS_FILTER_QUEUE = "__QUEUE__";
const STATUS_FILTER_ALL = "__ALL__";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING: "Pending",
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
// Helpers
// ---------------------------------------------------------------------------

const PLAIN_CODES = new Set(["NCR", "CAR", "BARMM", "NIR"]);

function regionDisplay(regionId: number): string {
  const region = PH_REGIONS.find((r) => r.regionId === regionId);
  if (!region) return `Region ${regionId}`;
  const code = region.regionCode;
  return PLAIN_CODES.has(code) ? code : `Region ${code}`;
}

function formatCallReceived(dt: string | null): string {
  if (!dt) return "—";
  const d = new Date(dt);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  let hours = d.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const hh = String(hours).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd}/${yyyy} ${hh}:${min} ${ampm}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ValidatorDashboard() {
  const [incidents, setIncidents] = useState<ValidatorIncident[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters — default to all incidents so validators can see the full workflow
  const [statusFilter, setStatusFilter] = useState<string>(STATUS_FILTER_ALL);
  const [encoderFilter, setEncoderFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Stats
  const [stats, setStats] = useState<{
    total_verified: number;
    pending_validation: number;
    by_category: { category: string; count: number }[];
  } | null>(null);

  // Action modal state
  const [actionTarget, setActionTarget] = useState<ValidatorIncident | null>(null);
  const [actionType, setActionType] = useState<ActionType | null>(null);
  const [actionNotes, setActionNotes] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  // ---------------------------------------------------------------------------
  // Bulk approve state (Phase 1.4)
  // ---------------------------------------------------------------------------
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  // When a duplicate is found during bulk processing, pause here for user decision.
  const [bulkDupTarget, setBulkDupTarget] = useState<ValidatorIncident | null>(null);
  // Resolve function: call with "accept" | "accept_replace" | "reject" | "skip"
  const bulkDupResolve = useRef<((decision: string) => void) | null>(null);

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
            .map((i) => i.incident_id)
        )
      );
    } else {
      setSelectedIds(new Set());
    }
  };

  // ---------------------------------------------------------------------------
  // Batch duplicate check helpers (Phase 1.4 — in-memory check)
  // ---------------------------------------------------------------------------
  function isBatchDuplicate(
    candidate: ValidatorIncident,
    acceptedSoFar: ValidatorIncident[]
  ): boolean {
    return acceptedSoFar.some(
      (a) =>
        a.region_id === candidate.region_id &&
        a.general_category === candidate.general_category &&
        a.notification_dt &&
        candidate.notification_dt &&
        a.notification_dt.slice(0, 10) === candidate.notification_dt.slice(0, 10)
    );
  }

  // Returns a Promise that resolves when the user makes a bulk-dup decision.
  function waitForBulkDupDecision(inc: ValidatorIncident): Promise<string> {
    return new Promise((resolve) => {
      setBulkDupTarget(inc);
      bulkDupResolve.current = resolve;
    });
  }

  const submitBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    if (
      !confirm(
        `Approve ${selectedIds.size} incident${selectedIds.size !== 1 ? "s" : ""}?`
      )
    )
      return;

    setBulkLoading(true);
    setBulkError(null);
    setBulkProgress(null);

    // Collect selected incidents in chronological order (they're already sorted).
    const toProcess = incidents
      .filter((i) => selectedIds.has(i.incident_id))
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));

    const acceptedSoFar: ValidatorIncident[] = [];
    let processedCount = 0;

    try {
      for (const inc of toProcess) {
        processedCount++;
        setBulkProgress(`Processing ${processedCount} / ${toProcess.length}…`);

        // Check: flagged as duplicate of a verified incident (stored at submission time)
        const hasDup =
          inc.is_duplicate || isBatchDuplicate(inc, acceptedSoFar);

        if (hasDup) {
          const decision = await waitForBulkDupDecision(inc);
          setBulkDupTarget(null);

          if (decision === "skip") continue;
          if (decision === "reject") {
            await apiFetch(`/regional/incidents/${inc.incident_id}/verification`, {
              method: "PATCH",
              body: JSON.stringify({ action: "reject", notes: "Rejected during bulk approve (duplicate)" }),
            });
            continue;
          }
          // "accept" or "accept_replace"
          const action = decision === "accept_replace" ? "accept_replace" : "accept";
          await apiFetch(`/regional/incidents/${inc.incident_id}/verification`, {
            method: "PATCH",
            body: JSON.stringify({ action, notes: "Bulk approve" }),
          });
          if (action === "accept" || action === "accept_replace") {
            acceptedSoFar.push(inc);
          }
        } else {
          await apiFetch(`/regional/incidents/${inc.incident_id}/verification`, {
            method: "PATCH",
            body: JSON.stringify({ action: "accept", notes: "Bulk approve" }),
          });
          acceptedSoFar.push(inc);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Bulk approve failed";
      setBulkError(msg);
    } finally {
      setBulkLoading(false);
      setBulkProgress(null);
      setBulkDupTarget(null);
      bulkDupResolve.current = null;
      setSelectedIds(new Set());
      await fetchQueue();
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
    fetchValidatorStats()
      .then(setStats)
      .catch(() => {
        /* non-critical */
      });
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

      await fetchQueue();

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

  // Determine if the modal target is an update request or duplicate that needs diff
  const isUpdateRequest = !!(actionTarget?.parent_incident_id);
  const isDuplicateIncident = !!(actionTarget?.is_duplicate && actionTarget?.duplicate_of);

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
            <p className="text-2xl font-bold text-blue-700">
              {stats.pending_validation}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs text-gray-500">Total Verified</p>
            <p className="text-2xl font-bold text-green-700">
              {stats.total_verified}
            </p>
          </div>
          {(["STRUCTURAL", "NON_STRUCTURAL", "VEHICULAR"] as const).map(
            (cat) => {
              const entry = stats.by_category.find((c) => c.category === cat);
              return (
                <div
                  key={cat}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-3"
                >
                  <p className="text-xs text-gray-500">
                    {formatClassification(cat)}
                  </p>
                  <p className="text-2xl font-bold text-gray-800">
                    {entry?.count ?? 0}
                  </p>
                </div>
              );
            }
          )}
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-4 mb-6">
        <select
          className="border rounded px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value={STATUS_FILTER_QUEUE}>Pending</option>
          <option value="REJECTED">Rejected</option>
          <option value="VERIFIED">Accepted</option>
          <option value={STATUS_FILTER_ALL}>All</option>
        </select>

        <input
          type="text"
          placeholder="Filter by Encoder UUID…"
          className="border rounded px-3 py-2 text-sm w-72"
          value={encoderFilter}
          onChange={(e) => {
            setEncoderFilter(e.target.value);
            setPage(0);
          }}
        />

        <button
          onClick={fetchQueue}
          className="bg-gray-100 hover:bg-gray-200 border rounded px-4 py-2 text-sm"
        >
          ↺ Refresh
        </button>

        {selectedIds.size > 0 && (
          <button
            onClick={submitBulkApprove}
            disabled={bulkLoading}
            className="ml-auto bg-green-600 hover:bg-green-700 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {bulkLoading
              ? bulkProgress ?? "Processing…"
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
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Region</th>
                <th className="text-left px-4 py-3 font-medium">Station</th>
                <th className="text-left px-4 py-3 font-medium">Call Received</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-left px-4 py-3 font-medium">Alarm</th>
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
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          STATUS_COLORS[inc.verification_status] ??
                          "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {STATUS_LABELS[inc.verification_status] ??
                          inc.verification_status}
                      </span>
                      {inc.parent_incident_id && (
                        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                          UPDATE
                        </span>
                      )}
                      {inc.is_duplicate && !inc.parent_incident_id && (
                        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-bold bg-orange-100 text-orange-800 border border-orange-300">
                          DUPLICATE
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {regionDisplay(inc.region_id)}
                  </td>
                  <td className="px-4 py-3">{inc.fire_station_name ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {formatCallReceived(inc.notification_dt)}
                  </td>
                  <td className="px-4 py-3">
                    {formatClassification(inc.general_category)}
                  </td>
                  <td className="px-4 py-3">{inc.alarm_level ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Link
                        href={`/dashboard/regional/incidents/${inc.incident_id}`}
                        className="px-2 py-1 text-xs rounded border border-blue-400 text-blue-700 hover:bg-blue-50"
                      >
                        View
                      </Link>
                      <button
                        onClick={() => openAction(inc, "accept")}
                        disabled={inc.verification_status === "VERIFIED"}
                        className="px-2 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Accept
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

      {/* ── Bulk duplicate resolution modal (Phase 1.4) ── */}
      {bulkDupTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-1">Duplicate Detected in Batch</h2>
            <p className="text-sm text-gray-500 mb-4">
              Incident #{bulkDupTarget.incident_id} · {bulkDupTarget.fire_station_name ?? "Unknown station"} ·{" "}
              {regionDisplay(bulkDupTarget.region_id)}
            </p>
            <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded text-sm text-orange-800">
              This incident may be a duplicate of a verified record. Choose how to proceed.
            </div>
            {bulkDupTarget.is_duplicate && bulkDupTarget.duplicate_of && (
              <div className="mb-4">
                <UpdateRequestDiffPanel
                  updateIncidentId={bulkDupTarget.incident_id}
                  originalIncidentId={bulkDupTarget.duplicate_of}
                />
              </div>
            )}
            <div className="flex flex-wrap gap-2 justify-end mt-4">
              <button
                onClick={() => bulkDupResolve.current?.("skip")}
                className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
              >
                Skip (Leave Pending)
              </button>
              <button
                onClick={() => bulkDupResolve.current?.("reject")}
                className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700"
              >
                Reject
              </button>
              <button
                onClick={() => bulkDupResolve.current?.("accept_replace")}
                className="px-4 py-2 text-sm rounded bg-amber-600 text-white hover:bg-amber-700"
              >
                Replace Original
              </button>
              <button
                onClick={() => bulkDupResolve.current?.("accept")}
                className="px-4 py-2 text-sm rounded bg-green-600 text-white hover:bg-green-700"
              >
                Accept as New
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Action confirmation modal ── */}
      {actionTarget && actionType && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            {/* Back button at top for duplicate/update incidents (Phase 1.3) */}
            {(isUpdateRequest || isDuplicateIncident) && (
              <button
                onClick={closeModal}
                className="mb-3 text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                ← Back
              </button>
            )}

            <h2 className="text-lg font-semibold mb-1">
              {actionType === "accept" || actionType === "accept_replace"
                ? isDuplicateIncident
                  ? "Review Duplicate Incident"
                  : "Accept Incident"
                : "Reject Incident"}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Incident #{actionTarget.incident_id} ·{" "}
              {actionTarget.fire_station_name ?? "Unknown station"}
            </p>

            {/* Diff view */}
            <div className="mb-4">
              {isUpdateRequest ? (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                      UPDATE REQUEST
                    </span>
                    <span className="text-xs text-gray-500">
                      Encoder submitted this as an update to incident #
                      {actionTarget.parent_incident_id}
                    </span>
                  </div>
                  <UpdateRequestDiffPanel
                    updateIncidentId={actionTarget.incident_id}
                    originalIncidentId={actionTarget.parent_incident_id!}
                  />
                </div>
              ) : isDuplicateIncident ? (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-orange-100 text-orange-800 border border-orange-300">
                      FLAGGED DUPLICATE
                    </span>
                    <span className="text-xs text-gray-500">
                      Matches verified incident #{actionTarget.duplicate_of}
                    </span>
                  </div>
                  <UpdateRequestDiffPanel
                    updateIncidentId={actionTarget.incident_id}
                    originalIncidentId={actionTarget.duplicate_of!}
                  />
                </div>
              ) : (
                <>
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
                </>
              )}
            </div>

            {actionType === "reject" && (
              <>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason for rejection{" "}
                  <span className="text-red-600">*</span>
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

            {/* Action buttons — duplicate incidents get 3-button layout (Phase 1.3) */}
            {isDuplicateIncident && (actionType === "accept" || actionType === "accept_replace") ? (
              <div className="flex flex-wrap gap-2 justify-end mt-4">
                <button
                  onClick={closeModal}
                  disabled={actionLoading}
                  className="px-4 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-40"
                >
                  Back
                </button>
                <button
                  onClick={() => { setActionType("reject"); }}
                  disabled={actionLoading}
                  className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  onClick={() => { setActionType("accept_replace"); void submitAction(); }}
                  disabled={actionLoading}
                  className="px-4 py-2 text-sm rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {actionLoading ? "Saving…" : "Replace Original"}
                </button>
                <button
                  onClick={() => { setActionType("accept"); void submitAction(); }}
                  disabled={actionLoading}
                  className="px-4 py-2 text-sm rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {actionLoading ? "Saving…" : "Accept as New"}
                </button>
              </div>
            ) : (
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
                  disabled={
                    actionLoading ||
                    (actionType === "reject" && !actionNotes.trim())
                  }
                  className={`px-4 py-2 text-sm rounded text-white disabled:opacity-50 ${
                    actionType === "accept" || actionType === "accept_replace"
                      ? "bg-green-600 hover:bg-green-700"
                      : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  {actionLoading ? "Saving…" : "Confirm"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
