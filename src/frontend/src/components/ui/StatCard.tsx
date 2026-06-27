"use client";

import type { LucideIcon } from "lucide-react";

export interface StatCardData {
  key: string;
  title: string;
  icon: LucideIcon;
  value: string;
  iconBg: string;
  iconColor: string;
}

interface StatCardProps {
  card: StatCardData;
}

/**
 * A single dashboard-stat card: coloured icon box + title + value.
 * Used by both the validator and regional dashboard stats grids.
 */
export function StatCard({ card }: StatCardProps) {
  const IconComp = card.icon;
  return (
    <div
      className="bg-white rounded-2xl p-4 flex flex-col gap-3 transition-shadow hover:shadow-md"
      style={{
        boxShadow: "var(--card-shadow)",
        border: "1px solid var(--border-color)",
      }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: card.iconBg }}
      >
        <IconComp className="w-5 h-5" style={{ color: card.iconColor }} />
      </div>
      <div>
        <div
          className="text-xs font-medium mb-0.5"
          style={{ color: "var(--text-muted)" }}
        >
          {card.title}
        </div>
        <div
          className="text-2xl font-bold"
          style={{ color: "var(--text-primary)" }}
        >
          {card.value}
        </div>
      </div>
    </div>
  );
}

// ── Shared grid constants ──────────────────────────────────────────────────

export const STATS_DATE_FILTERS = [
  { label: "Today", value: "today" },
  { label: "This Week", value: "week" },
  { label: "This Month", value: "month" },
  { label: "All Time", value: "all" },
] as const;

export type StatsDateFilterValue = (typeof STATS_DATE_FILTERS)[number]["value"];

interface StatsDateFilterChipsProps {
  value: StatsDateFilterValue;
  onChange: (value: StatsDateFilterValue) => void;
}

/**
 * Pill-shaped date-range selector for the stats section.
 * Shared by validator and regional dashboards.
 */
export function StatsDateFilterChips({
  value,
  onChange,
}: StatsDateFilterChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: "var(--text-muted)" }}
      >
        Stats:
      </span>
      {STATS_DATE_FILTERS.map((f) => {
        const active = value === f.value;
        return (
          <button
            key={f.value}
            type="button"
            onClick={() => onChange(f.value)}
            className="rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
            style={
              active
                ? {
                    backgroundColor: "#FEE2E2",
                    borderColor: "#FCA5A5",
                    color: "#1A3263",
                  }
                : {
                    backgroundColor: "#fff",
                    borderColor: "#e5e7eb",
                    color: "var(--text-secondary)",
                  }
            }
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

