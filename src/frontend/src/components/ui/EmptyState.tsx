"use client";

import type { ReactNode } from "react";

interface EmptyStateProps {
  /** Primary message displayed when no results are found. */
  message?: string;
  /** Optional secondary message. */
  secondary?: string;
  /** When true, renders the "Search All Time" button. */
  showAllTime?: boolean;
  /** Click handler for the "Search All Time" button. */
  onShowAllTime?: () => void;
  /** Extra content rendered below the button. */
  children?: ReactNode;
}

/**
 * Shared empty-state placeholder used by the validator and regional dashboards.
 * When `showAllTime` is true, a "Search All Time" button is rendered.
 */
export function EmptyState({
  message = "No incidents found",
  secondary,
  showAllTime = false,
  onShowAllTime,
  children,
}: EmptyStateProps) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center px-5 py-14 text-center">
      <p
        className="text-sm font-semibold"
        style={{ color: "var(--text-primary)" }}
      >
        {message}
      </p>
      {secondary && (
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          {secondary}
        </p>
      )}
      {showAllTime && onShowAllTime && (
        <button
          type="button"
          onClick={onShowAllTime}
          className="mt-4 inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-900"
          style={{ backgroundColor: "#991B1B" }}
        >
          Search All Time
        </button>
      )}
      {children}
    </div>
  );
}
