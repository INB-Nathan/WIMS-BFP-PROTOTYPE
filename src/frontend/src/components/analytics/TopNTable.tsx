"use client";

import type { TopNItem } from "@/lib/api";

export interface TopNTableProps {
  data: TopNItem[];
  metric: string;
  /** Optional "no data" message override. */
  emptyMessage?: string;
}

/**
 * Ranked horizontal-bar visualization for Top-N analytics.
 *
 * Visual contract:
 *   - Rank number, name, bar, value (with optional response-time sample detail).
 *   - Bar fill width is proportional to the largest value; minimum 6% so labels
 *     remain readable when the value is very small.
 *   - Bar uses `bg-red-700` so it stays on-brand (BFP maroon) even when
 *     the parent card swaps to a different surface.
 */
export function TopNTable({ data, metric, emptyMessage }: TopNTableProps) {
  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {emptyMessage ?? "No ranked data matches the active filters."}
      </p>
    );
  }

  const max = Math.max(...data.map((item) => Number(item.value || 0)), 1);

  return (
    <div className="space-y-3" data-testid="bar-chart">
      {data.map((item, index) => {
        const width = Math.max(6, (Number(item.value || 0) / max) * 100);
        let displayValue: string;
        if (typeof item.value !== "number") {
          displayValue = String(item.value ?? "—");
        } else if (metric === "damage_cost") {
          displayValue = `₱${item.value.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        } else if (metric === "response_time") {
          displayValue = `${item.value.toFixed(1)} min`;
        } else {
          displayValue = item.value.toLocaleString("en-PH", { maximumFractionDigits: 0 });
        }
        const sampleDetail =
          metric === "response_time" &&
          item.incident_count != null &&
          item.metric_count != null
            ? `${item.metric_count.toLocaleString()} of ${item.incident_count.toLocaleString()} incidents have response-time data`
            : null;
        return (
          <div
            key={`${item.name}-${index}`}
            className="grid grid-cols-[2rem_1fr_9rem] items-center gap-3 text-sm"
          >
            <span className="font-semibold text-gray-500">{index + 1}</span>
            <div className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="truncate font-medium text-gray-900">
                  {item.name || "Unspecified"}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-red-700 transition-all"
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
            <span className="text-right">
              <span className="block font-bold text-gray-900">{displayValue}</span>
              {sampleDetail && (
                <span className="block text-[11px] font-medium leading-tight text-gray-500">
                  {sampleDetail}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
