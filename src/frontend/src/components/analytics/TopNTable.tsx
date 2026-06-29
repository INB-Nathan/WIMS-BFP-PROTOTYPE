"use client";

import type { TopNItem } from "@/lib/api";

export interface TopNTableProps {
  data: TopNItem[];
  metric: string;
  selectedName?: string | null;
  onSelect?: (name: string) => void;
  /** Optional "no data" message override. */
  emptyMessage?: string;
}

export function formatTopNValue(metric: string, value: number | string | null | undefined): string {
  if (typeof value !== "number") {
    return String(value ?? "—");
  }
  if (metric === "damage_cost") {
    return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  if (metric === "response_time") {
    return `${value.toFixed(1)} min`;
  }
  return value.toLocaleString("en-PH", { maximumFractionDigits: 0 });
}

export function getTopNSampleDetail(metric: string, item: TopNItem): string | null {
  return metric === "response_time" && item.incident_count != null && item.metric_count != null
    ? `${item.metric_count.toLocaleString()} of ${item.incident_count.toLocaleString()} incidents have response-time data`
    : null;
}

/**
 * Ranked horizontal-bar visualization for Top-N analytics.
 */
export function TopNTable({ data, metric, selectedName, onSelect, emptyMessage }: TopNTableProps) {
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
        const displayValue = formatTopNValue(metric, item.value);
        const sampleDetail = getTopNSampleDetail(metric, item);
        const selected = selectedName === item.name;
        const rowClassName = `grid w-full grid-cols-[2rem_1fr_9rem] items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${selected ? 'border-red-200 bg-red-50/60 ring-1 ring-red-100' : 'border-transparent hover:border-gray-200 hover:bg-gray-50'}`;
        const rowContent = (
          <>
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
          </>
        );

        if (onSelect) {
          return (
            <button
              key={`${item.name}-${index}`}
              type="button"
              onClick={() => onSelect(item.name)}
              aria-pressed={selected}
              className={rowClassName}
            >
              {rowContent}
            </button>
          );
        }

        return (
          <div key={`${item.name}-${index}`} className={rowClassName}>
            {rowContent}
          </div>
        );
      })}
    </div>
  );
}
