"use client";

/**
 * /dashboard/validator — NATIONAL_VALIDATOR incident queue.
 */

import { useEffect, useState, useCallback, useMemo, useRef, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCw, Flame, Building2, TreePine, Car, Layers, Home, Users, Truck, Trees,
  Archive, CalendarDays,
} from "lucide-react";
import { apiFetch, ApiRequestError, fetchValidatorStats } from "@/lib/api";
import { IncidentDiffPanel } from "@/components/IncidentDiffPanel";
import { UpdateRequestDiffPanel } from "@/components/UpdateRequestDiffPanel";
import { IncidentRevisionHistory } from "@/components/IncidentRevisionHistory";
import { formatClassification } from "@/lib/afor-utils";
import { PH_REGIONS, getShortRegionName } from "@/lib/ph-regions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatIncidentDate, isDateOnly, getDateBounds, categoryCount as sharedCategoryCount } from "@/lib/incident-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ValidatorIncident {
  incident_id: number;
  verification_status: string;
  encoder_id: string | null;
  region_id: number;
  created_at: string | null;
  submitted_at: string | null;
  updated_at: string | null;
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
  reference_number: string | null;
  is_resubmitted: boolean;
}

interface QueueResponse {
  items: ValidatorIncident[];
  total: number;
  limit: number;
  offset: number;
}

type ActionType = "accept" | "accept_replace" | "reject";

const STATUS_FILTER_QUEUE = "__QUEUE__";
const STATUS_FILTER_ALL = "__ALL__";

const VALIDATOR_STATUS_FILTERS = [
  { label: "All", value: STATUS_FILTER_ALL },
  { label: "Pending", value: STATUS_FILTER_QUEUE },
  { label: "Accepted", value: "VERIFIED" },
  { label: "Rejected", value: "REJECTED" },
] as const;

interface HoverHint {
  id: number;
  x: number;
  y: number;
}

const DATE_FILTERS = [
  { label: "Today", value: "today" },
  { label: "This Week", value: "week" },
  { label: "This Month", value: "month" },
  { label: "This Year", value: "year" },
  { label: "Specific Date", value: "specific" },
  { label: "All Time", value: "all" },
] as const;

type DateFilterValue = (typeof DATE_FILTERS)[number]["value"];

const STATS_DATE_FILTERS = [
  { label: "Today", value: "today" },
  { label: "This Week", value: "week" },
  { label: "This Month", value: "month" },
  { label: "All Time", value: "all" },
] as const;

type StatsDateFilterValue = (typeof STATS_DATE_FILTERS)[number]["value"];

// STATUS_LABELS and STATUS_COLORS imported from @/components/ui/StatusBadge

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const regionDisplay = getShortRegionName;
const categoryCount = sharedCategoryCount;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ValidatorDashboard() {
  const router = useRouter();
  const [incidents, setIncidents] = useState<ValidatorIncident[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>(STATUS_FILTER_ALL);
  const [regionFilter, setRegionFilter] = useState<string>("");
  const [dateFilter, setDateFilter] = useState<DateFilterValue>("today");
  const [specificDate, setSpecificDate] = useState('');
  const [specificDateDraft, setSpecificDateDraft] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 10;
  const dateBounds = useMemo(() => getDateBounds(dateFilter, specificDate), [dateFilter, specificDate]);
  const specificDateDraftIsValid = isDateOnly(specificDateDraft);

  const [statsDateFilter, setStatsDateFilter] = useState<StatsDateFilterValue>("week");
  const statsDateBounds = useMemo(
    () => getDateBounds(statsDateFilter, ""),
    [statsDateFilter],
  );
  // Ref so fetchQueue can trigger a stats refresh without adding statsDateBounds as a dep.
  const statsDateBoundsRef = useRef(statsDateBounds);
  useEffect(() => { statsDateBoundsRef.current = statsDateBounds; }, [statsDateBounds]);

  const [stats, setStats] = useState<{
    total_verified: number;
    pending_validation: number;
    wildland_total: number;
    by_category: { category: string; count: number }[];
    structures_affected: number;
    households_affected: number;
    families_affected: number;
    individuals_affected: number;
    vehicles_affected: number;
  } | null>(null);

  const [actionTarget, setActionTarget] = useState<ValidatorIncident | null>(null);
  const [actionType, setActionType] = useState<ActionType | null>(null);
  const [actionNotes, setActionNotes] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showDupHistory, setShowDupHistory] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const [bulkDupTarget, setBulkDupTarget] = useState<ValidatorIncident | null>(null);
  const bulkDupResolve = useRef<((decision: string) => void) | null>(null);
  const [showBulkConfirmModal, setShowBulkConfirmModal] = useState(false);
  const [isArchiveView, setIsArchiveView] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [validatorDupTarget, setValidatorDupTarget] = useState<ValidatorIncident | null>(null);
  const [validatorDupMatchedId, setValidatorDupMatchedId] = useState<number | null>(null);
  const [validatorDupConfidence, setValidatorDupConfidence] = useState<'LIKELY' | 'POSSIBLE' | null>(null);
  // Runtime-detected duplicates: populated when Accept returns 409. Maps incident_id → matched_incident_id.
  const [runtimeDuplicates, setRuntimeDuplicates] = useState<Map<number, number>>(new Map());
  const [newIncidentBanner, setNewIncidentBanner] = useState(false);
  const [confirmAcceptTarget, setConfirmAcceptTarget] = useState<ValidatorIncident | null>(null);
  const [showConfirmDiff, setShowConfirmDiff] = useState(false);
  const [hoverHint, setHoverHint] = useState<HoverHint | null>(null);
  const lastKnownTotal = useRef<number | null>(null);
  const hoverHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsInitialMountRef = useRef(true);

  const updateFiltersWithoutScrollShift = useCallback((update: () => void) => {
    const x = window.scrollX;
    const y = window.scrollY;
    update();
    const restore = () => {
      if (Math.abs(window.scrollY - y) > 1 || Math.abs(window.scrollX - x) > 1) {
        window.scrollTo({ left: x, top: y, behavior: 'auto' });
      }
    };
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
  }, []);

  const applySpecificDateFilter = useCallback(() => {
    if (!specificDateDraftIsValid) return;
    updateFiltersWithoutScrollShift(() => {
      setSpecificDate(specificDateDraft);
      setDateFilter("specific");
      setPage(0);
    });
  }, [specificDateDraft, specificDateDraftIsValid, updateFiltersWithoutScrollShift]);

  const showAllTimeIncidents = useCallback(() => {
    updateFiltersWithoutScrollShift(() => {
      setDateFilter("all");
      setSpecificDate("");
      setSpecificDateDraft("");
      setPage(0);
    });
  }, [updateFiltersWithoutScrollShift]);

  const toggleArchiveView = useCallback(() => {
    updateFiltersWithoutScrollShift(() => {
      setIsArchiveView((prev) => !prev);
      setStatusFilter(STATUS_FILTER_QUEUE);
      setDateFilter("all");
      setSpecificDate("");
      setSpecificDateDraft("");
      setPage(0);
    });
  }, [updateFiltersWithoutScrollShift]);

  const selectStatusFilter = useCallback((nextStatus: string) => {
    updateFiltersWithoutScrollShift(() => {
      setStatusFilter(nextStatus);
      setPage(0);
      if (nextStatus === STATUS_FILTER_ALL) {
        setDateFilter("today");
        setSpecificDate("");
        setSpecificDateDraft("");
      } else {
        // Pending queue, Accepted, Rejected — all use "all time" so finalized records are always reachable.
        setDateFilter("all");
        setSpecificDate("");
        setSpecificDateDraft("");
      }
    });
  }, [updateFiltersWithoutScrollShift]);

  const clearHoverHint = useCallback(() => {
    if (hoverHintTimer.current) {
      clearTimeout(hoverHintTimer.current);
      hoverHintTimer.current = null;
    }
    setHoverHint(null);
  }, []);

  const scheduleHoverHint = useCallback((id: number, event: MouseEvent<HTMLElement>) => {
    if (hoverHintTimer.current) clearTimeout(hoverHintTimer.current);
    const { clientX, clientY } = event;
    hoverHintTimer.current = setTimeout(() => {
      setHoverHint({ id, x: clientX, y: clientY });
      hoverHintTimer.current = null;
    }, 2000);
  }, []);

  const hideHoverHintOnMove = useCallback(() => {
    if (hoverHintTimer.current) {
      clearTimeout(hoverHintTimer.current);
      hoverHintTimer.current = null;
    }
    if (hoverHint) setHoverHint(null);
  }, [hoverHint]);

  useEffect(() => () => {
    if (hoverHintTimer.current) clearTimeout(hoverHintTimer.current);
  }, []);

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
    incidents.filter((i) => i.verification_status === "PENDING").every((i) => selectedIds.has(i.incident_id));

  const toggleSelectAllPending = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(incidents.filter((i) => i.verification_status === "PENDING").map((i) => i.incident_id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  function isBatchDuplicate(candidate: ValidatorIncident, acceptedSoFar: ValidatorIncident[]): boolean {
    return acceptedSoFar.some(
      (a) =>
        a.region_id === candidate.region_id &&
        a.general_category === candidate.general_category &&
        a.notification_dt &&
        candidate.notification_dt &&
        a.notification_dt.slice(0, 10) === candidate.notification_dt.slice(0, 10)
    );
  }

  function waitForBulkDupDecision(inc: ValidatorIncident): Promise<string> {
    return new Promise((resolve) => {
      setBulkDupTarget(inc);
      bulkDupResolve.current = resolve;
    });
  }

  const doArchive = async (inc: ValidatorIncident) => {
    setArchiveError(null);
    try {
      await apiFetch(`/regional/validator/incidents/${inc.incident_id}/archive`, { method: "PATCH" });
      await fetchQueue();
    } catch (err: unknown) {
      setArchiveError(err instanceof Error ? err.message : "Archive failed");
    }
  };

  const doUnarchive = async (inc: ValidatorIncident) => {
    setArchiveError(null);
    try {
      await apiFetch(`/regional/validator/incidents/${inc.incident_id}/unarchive`, { method: "PATCH" });
      await fetchQueue();
    } catch (err: unknown) {
      setArchiveError(err instanceof Error ? err.message : "Unarchive failed");
    }
  };

  const doDelete = async (inc: ValidatorIncident) => {
    setDeleteError(null);
    try {
      await apiFetch(`/regional/validator/incidents/${inc.incident_id}`, { method: "DELETE" });
      await fetchQueue();
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleDirectAccept = async (inc: ValidatorIncident) => {
    setAcceptingId(inc.incident_id);
    setActionError(null);
    try {
      await apiFetch(`/regional/incidents/${inc.incident_id}/verification`, {
        method: "PATCH",
        body: JSON.stringify({ action: "accept", notes: null }),
      });
      await fetchQueue();
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && err.status === 409) {
        const detail = err.detail as { code?: string; matched_incident_id?: number; confidence?: 'LIKELY' | 'POSSIBLE' } | null;
        if (detail?.code === "DUPLICATE_DETECTED" && detail.matched_incident_id) {
          setRuntimeDuplicates((prev) => new Map(prev).set(inc.incident_id, detail.matched_incident_id!));
          setValidatorDupTarget(inc);
          setValidatorDupMatchedId(detail.matched_incident_id);
          setValidatorDupConfidence(detail.confidence ?? null);
          return;
        }
      }
      setActionError(err instanceof Error ? err.message : "Accept failed.");
    } finally {
      setAcceptingId(null);
    }
  };

  const submitBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    setShowBulkConfirmModal(false);
    setBulkLoading(true);
    setBulkError(null);
    setBulkProgress(null);

    const toProcess = incidents
      .filter((i) => selectedIds.has(i.incident_id))
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));

    const acceptedSoFar: ValidatorIncident[] = [];
    let processedCount = 0;

    try {
      for (const inc of toProcess) {
        processedCount++;
        setBulkProgress(`Processing ${processedCount} / ${toProcess.length}…`);
        const hasDup = inc.is_duplicate || isBatchDuplicate(inc, acceptedSoFar);
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
          const action = decision === "accept_replace" ? "accept_replace" : "accept";
          await apiFetch(`/regional/incidents/${inc.incident_id}/verification`, {
            method: "PATCH",
            body: JSON.stringify({ action, notes: "Bulk approve" }),
          });
          if (action === "accept" || action === "accept_replace") acceptedSoFar.push(inc);
        } else {
          await apiFetch(`/regional/incidents/${inc.incident_id}/verification`, {
            method: "PATCH",
            body: JSON.stringify({ action: "accept", notes: "Bulk approve" }),
          });
          acceptedSoFar.push(inc);
        }
      }
    } catch (err: unknown) {
      setBulkError(err instanceof Error ? err.message : "Bulk approve failed");
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

    if (isArchiveView) {
      params.set("archived", "true");
      params.set("show_all", "true");
    } else {
      if (statusFilter === STATUS_FILTER_ALL) {
        params.set("show_all", "true");
      } else if (statusFilter && statusFilter !== STATUS_FILTER_QUEUE) {
        params.set("status", statusFilter);
      }
      if (dateBounds.date_from) params.set("date_from", dateBounds.date_from);
      if (dateBounds.date_to) params.set("date_to", dateBounds.date_to);
    }

    if (regionFilter) params.set("region_id", regionFilter);

    try {
      const data: QueueResponse = await apiFetch(`/regional/validator/incidents?${params.toString()}`);
      setIncidents(data.items);
      setTotal(data.total);
      lastKnownTotal.current = data.total;
      setNewIncidentBanner(false);
      setRuntimeDuplicates(new Map());
      // Keep the pending-count badge in sync after every queue refresh.
      void fetchValidatorStats(statsDateBoundsRef.current).then(setStats).catch(() => {});
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, regionFilter, dateBounds.date_from, dateBounds.date_to, isArchiveView]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  // Skip the very first fire — fetchQueue already calls fetchValidatorStats on mount.
  // Subsequent fires (statsDateFilter change) still update stats without a full queue refetch.
  useEffect(() => {
    if (statsInitialMountRef.current) { statsInitialMountRef.current = false; return; }
    fetchValidatorStats(statsDateBounds).then(setStats).catch(() => { /* non-critical */ });
  }, [statsDateBounds]);

  useEffect(() => {
    const checkForNewIncidents = async () => {
      try {
        const data: QueueResponse = await apiFetch(`/regional/validator/incidents?limit=1&offset=0`);
        if (lastKnownTotal.current !== null && data.total > lastKnownTotal.current) setNewIncidentBanner(true);
        lastKnownTotal.current = data.total;
      } catch { /* non-critical */ }
    };
    const intervalId = setInterval(checkForNewIncidents, 10_000);
    return () => clearInterval(intervalId);
  }, []);

  // ---------------------------------------------------------------------------
  // Submit validator decision
  // ---------------------------------------------------------------------------

  const submitAction = async (force = false) => {
    if (!actionTarget || !actionType) return;
    setActionLoading(true);
    setActionError(null);
    const url = force
      ? `/regional/incidents/${actionTarget.incident_id}/verification?force=true`
      : `/regional/incidents/${actionTarget.incident_id}/verification`;
    try {
      await apiFetch(url, {
        method: "PATCH",
        body: JSON.stringify({ action: actionType, notes: actionNotes.trim() || null }),
      });
      await fetchQueue();
      setActionTarget(null);
      setActionType(null);
      setActionNotes("");
      setValidatorDupTarget(null);
      setValidatorDupMatchedId(null); setValidatorDupConfidence(null);
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && err.status === 409) {
        const detail = err.detail as { code?: string; matched_incident_id?: number; confidence?: 'LIKELY' | 'POSSIBLE' } | null;
        if (detail?.code === "DUPLICATE_DETECTED" && detail.matched_incident_id) {
          setRuntimeDuplicates((prev) => new Map(prev).set(actionTarget.incident_id, detail.matched_incident_id!));
          setValidatorDupTarget(actionTarget);
          setValidatorDupMatchedId(detail.matched_incident_id);
          setValidatorDupConfidence(detail.confidence ?? null);
          setActionTarget(null);
          return;
        }
      }
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  const openAction = (inc: ValidatorIncident, type: ActionType) => {
    setActionTarget(inc);
    setActionType(type);
    setActionNotes("");
    setActionError(null);
    setShowDiff(false);
    setShowHistory(false);
  };

  const closeModal = () => {
    if (actionLoading) return;
    setActionTarget(null);
    setActionType(null);
    setActionNotes("");
    setActionError(null);
    setShowDiff(false);
    setShowHistory(false);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isUpdateRequest = !!(actionTarget?.parent_incident_id);
  const isDuplicateIncident = !!(actionTarget?.is_duplicate && actionTarget?.duplicate_of);

  // ---------------------------------------------------------------------------
  // Stats card definitions
  // ---------------------------------------------------------------------------

  const incidentCards = stats ? [
    { key: 'pending', title: 'Awaiting Validation', icon: Flame, value: stats.pending_validation.toLocaleString(), iconBg: '#DBEAFE', iconColor: '#1D4ED8' },
    { key: 'wildland', title: 'Wildland Fire', icon: Trees, value: stats.wildland_total.toLocaleString(), iconBg: '#FEF9C3', iconColor: '#92400E' },
    ...(['STRUCTURAL', 'NON_STRUCTURAL', 'TRANSPORTATION'] as const).map((cat) => {
      const icons = { STRUCTURAL: Building2, NON_STRUCTURAL: TreePine, TRANSPORTATION: Car };
      const colors = { STRUCTURAL: { bg: '#FEF3C7', color: '#D97706' }, NON_STRUCTURAL: { bg: '#DCFCE7', color: '#16A34A' }, TRANSPORTATION: { bg: '#DBEAFE', color: '#2563EB' } };
      const aliases = cat === 'TRANSPORTATION'
        ? ['TRANSPORTATION', 'VEHICULAR', 'Transportation', 'Vehicular']
        : cat === 'NON_STRUCTURAL'
          ? ['NON_STRUCTURAL', 'NON-STRUCTURAL', 'Non-Structural']
          : ['STRUCTURAL', 'Structural'];
      return { key: cat, title: formatClassification(cat), icon: icons[cat], value: categoryCount(stats, aliases), iconBg: colors[cat].bg, iconColor: colors[cat].color };
    }),
  ] : [];

  const affectedCards = stats ? [
    { key: 'structures', title: 'Structures', icon: Layers, value: stats.structures_affected.toLocaleString(), iconBg: '#F3E8FF', iconColor: '#7C3AED' },
    { key: 'households', title: 'Households', icon: Home, value: stats.households_affected.toLocaleString(), iconBg: '#FCE7F3', iconColor: '#BE185D' },
    { key: 'families', title: 'Families', icon: Users, value: stats.families_affected.toLocaleString(), iconBg: '#E0F2FE', iconColor: '#0369A1' },
    { key: 'individuals', title: 'Individuals', icon: Users, value: stats.individuals_affected.toLocaleString(), iconBg: '#ECFDF5', iconColor: '#047857' },
    { key: 'vehicles', title: 'Vehicles', icon: Truck, value: stats.vehicles_affected.toLocaleString(), iconBg: '#FFF7ED', iconColor: '#C2410C' },
  ] : [];

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6 pb-8" style={{ backgroundColor: 'var(--content-bg)' }}>

      {/* ── Sticky notification toast (visible while scrolling) ── */}
      {newIncidentBanner && (
        <div className="sticky top-0 z-40">
          <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 shadow-md">
            <span>New incidents have been submitted. Refresh to see the latest queue.</span>
            <button
              onClick={fetchQueue}
              className="ml-4 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
              style={{ backgroundColor: '#1D4ED8' }}
            >
              Refresh now
            </button>
          </div>
        </div>
      )}

      {/* ── Page header ── */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-bold leading-tight" style={{ fontSize: '32px', color: 'var(--text-primary)' }}>
              Dashboard
            </h1>
          </div>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Review workload, validation decisions, and finalized incident records.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={fetchQueue}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
          {selectedIds.size > 0 && (
            <button
              onClick={() => setShowBulkConfirmModal(true)}
              disabled={bulkLoading}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: '#16A34A' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#15803D'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#16A34A'; }}
            >
              {bulkLoading ? (bulkProgress ?? "Processing…") : `Bulk Approve (${selectedIds.size})`}
            </button>
          )}
        </div>
      </div>

      {/* ── Error/bulk banners ── */}
      {bulkError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{bulkError}</div>
      )}
      {archiveError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{archiveError}</div>
      )}
      {deleteError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">Delete failed: {deleteError}</div>
      )}

      {/* ── Stats date filter chips ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Stats period:</span>
        {STATS_DATE_FILTERS.map((f) => {
          const active = statsDateFilter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatsDateFilter(f.value)}
              className="rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
              style={active
                ? { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5', color: '#991B1B' }
                : { backgroundColor: '#fff', borderColor: '#e5e7eb', color: 'var(--text-secondary)' }
              }
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* ── Incident stats cards ── */}
      {incidentCards.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {incidentCards.map((card) => {
            const IconComp = card.icon;
            return (
              <div
                key={card.key}
                className="bg-white rounded-2xl p-4 flex flex-col gap-3 transition-shadow hover:shadow-md"
                style={{ boxShadow: 'var(--card-shadow)', border: '1px solid var(--border-color)' }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: card.iconBg }}>
                  <IconComp className="w-5 h-5" style={{ color: card.iconColor }} />
                </div>
                <div>
                  <div className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-muted)' }}>{card.title}</div>
                  <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{card.value}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Affected count cards ── */}
      {affectedCards.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {affectedCards.map((card) => {
            const IconComp = card.icon;
            return (
              <div
                key={card.key}
                className="bg-white rounded-2xl p-4 flex flex-col gap-3 transition-shadow hover:shadow-md"
                style={{ boxShadow: 'var(--card-shadow)', border: '1px solid var(--border-color)' }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: card.iconBg }}>
                  <IconComp className="w-5 h-5" style={{ color: card.iconColor }} />
                </div>
                <div>
                  <div className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-muted)' }}>{card.title}</div>
                  <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{card.value}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Incident table section ── */}
      <section
        className="rounded-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)', border: '1px solid var(--border-color)' }}
      >
        {isArchiveView && (
          <div className="px-6 pt-5 pb-0">
            <p className="text-sm font-semibold" style={{ color: '#92400E' }}>Archived Incidents - restore records to the active queue or delete them permanently.</p>
          </div>
        )}
        {/* Filters */}
        <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2">
              {VALIDATOR_STATUS_FILTERS.map((filter) => {
                const active = statusFilter === filter.value;
                const pendingCount = stats?.pending_validation ?? 0;
                const showPendingIndicator = filter.value === STATUS_FILTER_QUEUE && pendingCount > 0;
                return (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => selectStatusFilter(filter.value)}
                    disabled={loading || isArchiveView}
                    className="relative rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50"
                    style={active
                      ? { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5', color: '#991B1B' }
                      : { backgroundColor: '#fff', borderColor: '#e5e7eb', color: 'var(--text-secondary)' }
                    }
                    onMouseEnter={(e) => {
                      if (!active) (e.currentTarget as HTMLElement).style.borderColor = 'var(--bfp-red)';
                    }}
                    onMouseLeave={(e) => {
                      if (!active) (e.currentTarget as HTMLElement).style.borderColor = '#e5e7eb';
                    }}
                  >
                    {filter.label}
                    {showPendingIndicator && (
                      <span
                        className="absolute -right-2 -top-2 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none text-white ring-2 ring-white"
                        style={{ backgroundColor: '#991B1B' }}
                        aria-label="Pending incidents available"
                      >
                        {pendingCount.toLocaleString()}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <select
              className="min-h-9 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium transition-colors focus:border-[#C62828] focus:outline-none"
              style={{ color: 'var(--text-primary)' }}
              value={regionFilter}
              onChange={(e) => updateFiltersWithoutScrollShift(() => { setRegionFilter(e.target.value); setPage(0); })}
            >
              <option value="">All Regions</option>
              {PH_REGIONS.map((r) => (
                <option key={r.regionId} value={String(r.regionId)}>{r.regionName}</option>
              ))}
            </select>

            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {loading ? 'Loading…' : `${total.toLocaleString()} total`}
            </span>

            <div className="ml-auto flex flex-wrap items-center gap-3">
              <select
                className="min-h-9 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium transition-colors focus:border-[#C62828] focus:outline-none"
                style={{ color: 'var(--text-primary)' }}
                value={dateFilter}
                onChange={(e) => updateFiltersWithoutScrollShift(() => {
                  setDateFilter(e.target.value as DateFilterValue);
                  setSpecificDate('');
                  setSpecificDateDraft('');
                  setPage(0);
                })}
                disabled={loading}
              >
                {DATE_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>{filter.label}</option>
                ))}
              </select>

              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
                <input
                  type="date"
                  className="min-h-9 rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm font-medium transition-colors focus:border-[#C62828] focus:outline-none"
                  style={{ color: 'var(--text-primary)' }}
                  value={specificDateDraft}
                  onChange={(e) => setSpecificDateDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applySpecificDateFilter();
                    if (e.key === "Escape") setSpecificDateDraft(specificDate);
                  }}
                  disabled={loading}
                  aria-label="Filter by specific submission date"
                  title="Filter by specific submission date"
                />
              </div>

              <button
                type="button"
                className="min-h-9 rounded-lg px-3 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#991B1B' }}
                onClick={applySpecificDateFilter}
                disabled={loading || !specificDateDraftIsValid}
              >
                Apply Date
              </button>
            </div>
          </div>
          <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Click an incident row to view details and diffs. Select pending rows for bulk approval; archive finalized records from the decision column.
          </p>
        </div>

        {/* Loading / error states */}
        {loading && (
          <div className="py-14 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
        )}
        {error && !loading && (
          <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-800">{error}</div>
        )}
        {!loading && !error && incidents.length === 0 && (
          <div className="flex min-h-[240px] flex-col items-center justify-center px-5 py-14 text-center">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              No incidents found
            </p>
            {dateFilter !== 'all' && (
              <>
                <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Try searching All Time.
                </p>
                <button
                  type="button"
                  onClick={showAllTimeIncidents}
                  className="mt-4 inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-900"
                  style={{ backgroundColor: '#991B1B' }}
                >
                  Search All Time
                </button>
              </>
            )}
          </div>
        )}

        {/* Table */}
        {!loading && incidents.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: '#FAFAFA', borderBottom: '1px solid var(--border-color)' }}>
                  <th className="px-4 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={allPendingSelected}
                      onChange={(e) => toggleSelectAllPending(e.target.checked)}
                      title="Select all PENDING"
                      className="rounded"
                    />
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Submitted</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Region</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Station</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Call Received</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Category</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Alarm</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((inc, idx) => (
                  <tr
                    key={inc.incident_id}
                    onClick={() => router.push(`/dashboard/regional/incidents/${inc.incident_id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        router.push(`/dashboard/regional/incidents/${inc.incident_id}`);
                      }
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={`View incident ${inc.incident_id}`}
                    className="cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#C62828] focus-visible:ring-inset"
                    style={{
                      backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bfp-red-light)';
                      scheduleHoverHint(inc.incident_id, e);
                    }}
                    onMouseMove={hideHoverHintOnMove}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA';
                      clearHoverHint();
                    }}
                  >
                    <td className="px-4 py-4">
                      {inc.verification_status === "PENDING" ? (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(inc.incident_id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => togglePending(inc, e.target.checked)}
                          className="rounded"
                        />
                      ) : null}
                    </td>
                    <td className="px-4 py-4 text-sm whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {formatIncidentDate(inc.submitted_at ?? inc.created_at)}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={inc.verification_status} />
                        {inc.is_resubmitted && ['PENDING', 'PENDING_VALIDATION'].includes(inc.verification_status) && (
                          <span className="inline-flex w-fit max-w-full rounded-full bg-purple-100 px-2 py-0.5 text-xs font-bold leading-none text-purple-800 whitespace-nowrap">
                            RESUBMITTED
                          </span>
                        )}
                        {inc.parent_incident_id && (
                          <span className="inline-flex w-fit max-w-full rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold leading-none text-amber-800 whitespace-nowrap">
                            UPDATE
                          </span>
                        )}
                        {(inc.is_duplicate || runtimeDuplicates.has(inc.incident_id)) && !["VERIFIED", "REJECTED", "REPLACED"].includes(inc.verification_status) && (
                          <span className="inline-flex w-fit max-w-full rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold leading-none text-orange-800 whitespace-nowrap">
                            DUPLICATE
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {regionDisplay(inc.region_id)}
                    </td>
                    <td className="px-4 py-4 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      <div className="flex max-w-[260px] items-center gap-2">
                        <span className="truncate">{inc.fire_station_name ?? "Unknown station"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {formatIncidentDate(inc.notification_dt)}
                    </td>
                    <td className="px-4 py-4 text-sm" style={{ color: 'var(--text-primary)' }}>
                      {formatClassification(inc.general_category)}
                    </td>
                    <td className="px-4 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {inc.alarm_level ?? "—"}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex gap-1.5 items-center">
                        {isArchiveView ? (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void doUnarchive(inc);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-gray-200 bg-white font-medium transition-colors hover:bg-gray-50"
                              style={{ color: 'var(--text-secondary)' }}
                              title="Restore this incident to the active queue"
                            >
                              <Archive className="h-3.5 w-3.5" aria-hidden />
                              Unarchive
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void doDelete(inc);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-red-200 bg-white font-medium transition-colors hover:bg-red-50"
                              style={{ color: '#991B1B' }}
                              title="Permanently delete this archived incident"
                            >
                              Delete
                            </button>
                          </>
                        ) : ["VERIFIED", "REPLACED", "REJECTED"].includes(inc.verification_status) ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void doArchive(inc);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-gray-200 bg-white font-medium transition-colors hover:bg-gray-50"
                            style={{ color: 'var(--text-secondary)' }}
                            title="Archive this incident"
                          >
                            <Archive className="h-3.5 w-3.5" aria-hidden />
                            Archive
                          </button>
                        ) : (
                          <>
                            {(inc.is_duplicate || runtimeDuplicates.has(inc.incident_id)) ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setValidatorDupTarget(inc);
                                  setValidatorDupMatchedId(inc.duplicate_of ?? runtimeDuplicates.get(inc.incident_id)!);
                                  setShowDupHistory(false);
                                }}
                                disabled={acceptingId === inc.incident_id}
                                className="px-2.5 py-1 text-xs rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                                style={{ backgroundColor: '#9333EA' }}
                                onMouseEnter={(e) => { if (acceptingId !== inc.incident_id) (e.currentTarget as HTMLElement).style.backgroundColor = '#7E22CE'; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#9333EA'; }}
                              >
                                Review
                              </button>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmAcceptTarget(inc);
                                  setShowConfirmDiff(false);
                                }}
                                disabled={acceptingId === inc.incident_id}
                                className="px-2.5 py-1 text-xs rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                                style={{ backgroundColor: '#16A34A' }}
                                onMouseEnter={(e) => { if (acceptingId !== inc.incident_id) (e.currentTarget as HTMLElement).style.backgroundColor = '#15803D'; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#16A34A'; }}
                              >
                                {acceptingId === inc.incident_id ? "…" : "Accept"}
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openAction(inc, "reject");
                              }}
                              className="px-2.5 py-1 text-xs rounded-lg font-medium text-white transition-colors"
                              style={{ backgroundColor: '#991B1B' }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bfp-red-dark)'; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#991B1B'; }}
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <button
            type="button"
            onClick={toggleArchiveView}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
            style={isArchiveView
              ? { backgroundColor: '#FEF3C7', borderColor: '#F59E0B', color: '#92400E' }
              : { backgroundColor: '#fff', borderColor: '#e5e7eb', color: 'var(--text-primary)' }
            }
          >
            <Archive className="h-4 w-4" aria-hidden />
            {isArchiveView ? "Hide Archive" : "See Archive"}
          </button>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium transition-colors hover:bg-gray-50 disabled:opacity-40"
              style={{ color: 'var(--text-primary)' }}
            >
              Prev
            </button>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Page {page + 1} of {totalPages} - {total} total
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium transition-colors hover:bg-gray-50 disabled:opacity-40"
              style={{ color: 'var(--text-primary)' }}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {hoverHint && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg bg-gray-950 px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
          style={{ left: hoverHint.x + 12, top: hoverHint.y + 12 }}
        >
          Click to view
        </div>
      )}

      {/* ── Validator duplicate resolution modal ── */}
      {validatorDupTarget && validatorDupMatchedId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-1 text-amber-800">
              {validatorDupConfidence === 'LIKELY' ? 'Likely Duplicate Incident' : 'Possible Duplicate Incident'}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Incident #{validatorDupTarget.incident_id} closely matches a verified record (#{validatorDupMatchedId}). Review the records side by side before deciding.
            </p>
            <div className="mb-4">
              <UpdateRequestDiffPanel updateIncidentId={validatorDupTarget.incident_id} originalIncidentId={validatorDupMatchedId} />
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
                  <IncidentRevisionHistory incidentId={validatorDupTarget.incident_id} />
                </div>
              )}
            </div>
            {actionError && <p className="text-sm text-red-600 mb-2">{actionError}</p>}
            <div className="flex flex-wrap gap-2 justify-end mt-4">
              <button onClick={() => { setValidatorDupTarget(null); setValidatorDupMatchedId(null); setValidatorDupConfidence(null); setActionError(null); setShowDupHistory(false); }} disabled={actionLoading} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-40">Cancel</button>
              <button onClick={() => { const inc = validatorDupTarget; setValidatorDupTarget(null); setValidatorDupMatchedId(null); setValidatorDupConfidence(null); setShowDupHistory(false); openAction(inc, "reject"); }} disabled={actionLoading} className="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50" style={{ backgroundColor: '#991B1B' }}>Reject</button>
              <button
                onClick={() => {
                  const inc = validatorDupTarget;
                  const originalId = validatorDupMatchedId;
                  setValidatorDupTarget(null);
                  setValidatorDupMatchedId(null); setValidatorDupConfidence(null);
                  setActionLoading(true);
                  setActionError(null);
                  void apiFetch(`/regional/incidents/${inc.incident_id}/verification?force=true`, {
                    method: "PATCH",
                    body: JSON.stringify({ action: "accept_replace", original_incident_id: originalId }),
                  }).then(() => fetchQueue()).catch((e: unknown) => { setActionError(e instanceof Error ? e.message : "Failed to replace existing"); }).finally(() => setActionLoading(false));
                }}
                disabled={actionLoading}
                className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {actionLoading ? "Saving…" : "Replace Existing"}
              </button>
              <button
                onClick={() => {
                  const inc = validatorDupTarget;
                  setValidatorDupTarget(null);
                  setValidatorDupMatchedId(null); setValidatorDupConfidence(null);
                  setActionLoading(true);
                  setActionError(null);
                  void apiFetch(`/regional/incidents/${inc.incident_id}/verification?force=true`, {
                    method: "PATCH",
                    body: JSON.stringify({ action: "accept" }),
                  }).then(() => fetchQueue()).catch((e: unknown) => { setActionError(e instanceof Error ? e.message : "Failed to verify as new"); }).finally(() => setActionLoading(false));
                }}
                disabled={actionLoading}
                className="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50"
                style={{ backgroundColor: '#16A34A' }}
              >
                {actionLoading ? "Saving…" : "Verify as New"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Accept confirmation modal ── */}
      {confirmAcceptTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Confirm Acceptance</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Incident #{confirmAcceptTarget.incident_id} · {confirmAcceptTarget.fire_station_name ?? 'Unknown station'} · {regionDisplay(confirmAcceptTarget.region_id)}
            </p>
            <button
              onClick={() => setShowConfirmDiff((v) => !v)}
              className="text-sm font-medium underline mb-4 block"
              style={{ color: 'var(--bfp-red)' }}
            >
              {showConfirmDiff ? 'Hide' : 'View'} revision history
            </button>
            {showConfirmDiff && (
              <div className="mb-4">
                <IncidentDiffPanel incidentId={confirmAcceptTarget.incident_id} />
              </div>
            )}
            <div className="flex justify-end gap-3 mt-2">
              <button
                onClick={() => { setConfirmAcceptTarget(null); setShowConfirmDiff(false); }}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const target = confirmAcceptTarget;
                  setConfirmAcceptTarget(null);
                  setShowConfirmDiff(false);
                  void handleDirectAccept(target);
                }}
                className="px-4 py-2 text-sm rounded-lg text-white"
                style={{ backgroundColor: '#16A34A' }}
              >
                Confirm Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk approve confirm modal ── */}
      {showBulkConfirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Confirm Bulk Approve</h2>
            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
              Approve {selectedIds.size} incident{selectedIds.size !== 1 ? "s" : ""}? This will set them to VERIFIED and cannot be undone without an explicit rejection.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowBulkConfirmModal(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => void submitBulkApprove()} className="px-4 py-2 text-sm rounded-lg text-white" style={{ backgroundColor: '#16A34A' }}>
                Confirm ({selectedIds.size})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk duplicate resolution modal ── */}
      {bulkDupTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Duplicate Detected in Batch</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Incident #{bulkDupTarget.incident_id} · {bulkDupTarget.fire_station_name ?? "Unknown station"} · {regionDisplay(bulkDupTarget.region_id)}
            </p>
            <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-xl text-sm text-orange-800">
              This incident may be a duplicate of a verified record. Choose how to proceed.
            </div>
            {bulkDupTarget.is_duplicate && bulkDupTarget.duplicate_of && (
              <div className="mb-4">
                <UpdateRequestDiffPanel updateIncidentId={bulkDupTarget.incident_id} originalIncidentId={bulkDupTarget.duplicate_of} />
              </div>
            )}
            <div className="flex flex-wrap gap-2 justify-end mt-4">
              <button onClick={() => bulkDupResolve.current?.("skip")} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Skip (Leave Pending)</button>
              <button onClick={() => bulkDupResolve.current?.("reject")} className="px-4 py-2 text-sm rounded-lg text-white" style={{ backgroundColor: '#991B1B' }}>Reject</button>
              <button onClick={() => bulkDupResolve.current?.("accept_replace")} className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700">Replace Original</button>
              <button onClick={() => bulkDupResolve.current?.("accept")} className="px-4 py-2 text-sm rounded-lg text-white" style={{ backgroundColor: '#16A34A' }}>Accept as New</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Action confirmation modal ── */}
      {actionTarget && actionType && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            {(isUpdateRequest || isDuplicateIncident) && (
              <button onClick={closeModal} className="mb-3 text-sm font-medium flex items-center gap-1" style={{ color: 'var(--bfp-red)' }}>
                ← Back
              </button>
            )}

            <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              {actionType === "accept" || actionType === "accept_replace"
                ? isDuplicateIncident ? "Review Duplicate Incident" : "Accept Incident"
                : "Reject Incident"}
            </h2>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Incident #{actionTarget.incident_id} · {actionTarget.fire_station_name ?? "Unknown station"}
            </p>

            <div className="mb-4">
              {isUpdateRequest ? (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">UPDATE REQUEST</span>
                    <span className="text-xs text-gray-500">Encoder submitted this as an update to incident #{actionTarget.parent_incident_id}</span>
                  </div>
                  <UpdateRequestDiffPanel updateIncidentId={actionTarget.incident_id} originalIncidentId={actionTarget.parent_incident_id!} />
                </div>
              ) : isDuplicateIncident ? (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-800">FLAGGED DUPLICATE</span>
                    <span className="text-xs text-gray-500">Matches verified incident #{actionTarget.duplicate_of}</span>
                  </div>
                  <UpdateRequestDiffPanel updateIncidentId={actionTarget.incident_id} originalIncidentId={actionTarget.duplicate_of!} />
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
                  {showDiff && <div className="mt-2"><IncidentDiffPanel incidentId={actionTarget.incident_id} /></div>}
                  {showHistory && <div className="mt-2"><IncidentRevisionHistory incidentId={actionTarget.incident_id} /></div>}
                </>
              )}
            </div>

            {actionType === "reject" && (
              <>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                  Reason for rejection <span style={{ color: 'var(--bfp-red)' }}>*</span>
                </label>
                <textarea
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm h-24 resize-none focus:outline-none focus:border-[#C62828]"
                  placeholder="Required for rejection…"
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  disabled={actionLoading}
                />
              </>
            )}

            {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}

            {isDuplicateIncident && (actionType === "accept" || actionType === "accept_replace") ? (
              <div className="flex flex-wrap gap-2 justify-end mt-4">
                <button onClick={closeModal} disabled={actionLoading} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-40">Back</button>
                <button onClick={() => { setActionType("reject"); }} disabled={actionLoading} className="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50" style={{ backgroundColor: '#991B1B' }}>Reject</button>
                <button onClick={() => { setActionType("accept_replace"); void submitAction(); }} disabled={actionLoading} className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">{actionLoading ? "Saving…" : "Replace Original"}</button>
                <button onClick={() => { setActionType("accept"); void submitAction(true); }} disabled={actionLoading} className="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50" style={{ backgroundColor: '#16A34A' }}>{actionLoading ? "Saving…" : "Accept as New"}</button>
              </div>
            ) : (
              <div className="flex justify-end gap-3 mt-4">
                <button onClick={closeModal} disabled={actionLoading} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-40">Cancel</button>
                <button
                  onClick={() => void submitAction()}
                  disabled={actionLoading || (actionType === "reject" && !actionNotes.trim())}
                  className="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50"
                  style={{ backgroundColor: actionType === "accept" || actionType === "accept_replace" ? '#16A34A' : '#991B1B' }}
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
