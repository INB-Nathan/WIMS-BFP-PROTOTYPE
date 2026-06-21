"use client";

/**
 * Single KPI tile used in analyst dashboard cards (Comparative Summary,
 * Response Time, Trend Calculation) and the dedicated workflow pages.
 *
 * Visual contract:
 *   - White tile, 1px border, no shadow (sits inside a card with shadow).
 *   - Uppercase tracking-wide label, large bold value, small detail line.
 */
export interface MetricTileProps {
  label: string;
  value: string;
  detail?: string;
  /** Optional Tailwind class on the value (e.g. for variance color). */
  valueClassName?: string;
}

export function MetricTile({ label, value, detail, valueClassName }: MetricTileProps) {
  return (
    <div className="rounded-md border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-2 text-2xl font-bold text-gray-900 ${valueClassName ?? ""}`}>{value}</div>
      {detail && <p className="mt-1 text-xs text-gray-500">{detail}</p>}
    </div>
  );
}
