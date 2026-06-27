"use client";

import Link from "next/link";
import { RefreshCw, FileText, Upload, ChevronDown, ChevronUp } from "lucide-react";

interface RegionalPageHeaderProps {
  showStats: boolean;
  onToggleStats: () => void;
  statsRefreshing: boolean;
  incidentsLoading: boolean;
  onRefreshAll: () => void;
}

/**
 * Page header for the regional dashboard.
 * Shows the title, quick-action links (Manual Entry, Import AFOR),
 * stats toggle, and refresh button.
 */
export function RegionalPageHeader({
  showStats,
  onToggleStats,
  statsRefreshing,
  incidentsLoading,
  onRefreshAll,
}: RegionalPageHeaderProps) {
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
          Regional incident workload and submissions.
        </p>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link
          href="/afor/create"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
          style={{ backgroundColor: "#1A3263" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor =
              "var(--bfp-red-dark)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = "#1A3263";
          }}
        >
          <FileText className="h-3.5 w-3.5" aria-hidden />
          + Add New Incident
        </Link>
        <Link
          href="/afor/import"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
          style={{ borderColor: "var(--bfp-red)", color: "var(--bfp-red)" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor =
              "var(--bfp-red-light)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = "";
          }}
        >
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Import AFOR
        </Link>
        <button
          type="button"
          onClick={onToggleStats}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
          title={showStats ? "Hide statistics" : "Show statistics"}
        >
          {showStats ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          )}
          Stats
        </button>
        <button
          type="button"
          onClick={() => onRefreshAll()}
          disabled={statsRefreshing || incidentsLoading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${statsRefreshing ? "animate-spin" : ""}`}
            aria-hidden
          />
          Refresh
        </button>
      </div>
    </div>
  );
}

