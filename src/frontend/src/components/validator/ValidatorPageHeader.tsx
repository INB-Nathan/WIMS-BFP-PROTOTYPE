"use client";

import { RefreshCw } from "lucide-react";

interface ValidatorPageHeaderProps {
  loading: boolean;
  onRefresh: () => void;
  queuedValidatorOpsCount: number;
  syncing: boolean;
  isOnline: boolean;
  selectedCount: number;
  bulkLoading: boolean;
  bulkProgress: string | null;
  onBulkApprove: () => void;
}

/**
 * Page header for the validator dashboard.
 * Shows the title, refresh button, queued-ops badge, offline indicator,
 * and bulk-approve button.
 */
export function ValidatorPageHeader({
  loading,
  onRefresh,
  queuedValidatorOpsCount,
  syncing,
  isOnline,
  selectedCount,
  bulkLoading,
  bulkProgress,
  onBulkApprove,
}: ValidatorPageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1
            className="font-bold leading-tight"
            style={{ fontSize: "32px", color: "var(--text-primary)" }}
          >
            Dashboard
          </h1>
        </div>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Review workload, validation decisions, and finalized incident records.
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            aria-hidden
          />
          Refresh
        </button>
        {queuedValidatorOpsCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold"
            style={{
              backgroundColor: "#FEF3C7",
              borderColor: "#F59E0B",
              color: "#92400E",
            }}
            title={`${queuedValidatorOpsCount} action${queuedValidatorOpsCount !== 1 ? "s" : ""} waiting for sync`}
          >
            {syncing ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
            {queuedValidatorOpsCount} queued
          </span>
        )}
        {!isOnline && (
          <span
            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold"
            style={{
              backgroundColor: "#FEE2E2",
              borderColor: "#FCA5A5",
              color: "#991B1B",
            }}
            title="You are offline. Changes will be queued and synced when you reconnect."
          >
            Offline
          </span>
        )}
        {selectedCount > 0 && (
          <button
            onClick={onBulkApprove}
            disabled={bulkLoading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#16A34A" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "#15803D";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "#16A34A";
            }}
          >
            {bulkLoading
              ? (bulkProgress ?? "Processing…")
              : `Bulk Approve (${selectedCount})`}
          </button>
        )}
      </div>
    </div>
  );
}
