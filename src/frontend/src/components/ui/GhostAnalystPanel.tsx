"use client";

/**
 * GhostAnalystPanel — pulsing skeleton panels for the National Analyst
 * dashboard. Each matches the dimensions of its real chart counterpart
 * so layout doesn't shift when data arrives.
 */

/**
 * Ghost KPI card — pulsing skeleton for the KPI strip (4 cards).
 */
export function GhostAnalystKpiCard() {
  return (
    <div
      className="animate-pulse rounded-md border border-gray-100 bg-gray-50 px-4 py-3"
      aria-hidden="true"
    >
      <div className="flex items-center gap-1.5">
        <div className="h-3.5 w-3.5 rounded bg-gray-200" />
        <div className="h-3 w-16 rounded bg-gray-200" />
      </div>
      <div className="mt-1 h-7 w-20 rounded bg-gray-200" />
      <div className="mt-0.5 h-3 w-24 rounded bg-gray-200" />
    </div>
  );
}

/**
 * Ghost chart panel — pulsing skeleton matching a chart card
 * (trend window, comparative, type distribution, response time, etc.).
 */
export function GhostChartPanel() {
  return (
    <div
      className="animate-pulse overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm"
      aria-hidden="true"
    >
      {/* Header skeleton */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3">
        <div className="h-5 w-5 rounded bg-gray-200" />
        <div className="h-4 w-28 rounded bg-gray-200" />
        <div className="ml-auto h-3 w-16 rounded bg-gray-200" />
      </div>
      {/* Chart body skeleton */}
      <div className="p-5">
        <div className="h-48 w-full rounded bg-gray-100" />
      </div>
    </div>
  );
}

/**
 * Ghost metric tile — 4-column grid skeleton for comparative summary.
 */
export function GhostMetricTiles() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className="animate-pulse rounded-md border border-gray-100 bg-gray-50 p-3" aria-hidden="true">
        <div className="h-3 w-14 rounded bg-gray-200" />
        <div className="mt-1 h-6 w-16 rounded bg-gray-200" />
        <div className="mt-1 h-3 w-20 rounded bg-gray-200" />
      </div>
      <div className="animate-pulse rounded-md border border-gray-100 bg-gray-50 p-3" aria-hidden="true">
        <div className="h-3 w-14 rounded bg-gray-200" />
        <div className="mt-1 h-6 w-16 rounded bg-gray-200" />
        <div className="mt-1 h-3 w-20 rounded bg-gray-200" />
      </div>
      <div className="animate-pulse rounded-md border border-gray-100 bg-gray-50 p-3" aria-hidden="true">
        <div className="h-3 w-14 rounded bg-gray-200" />
        <div className="mt-1 h-6 w-16 rounded bg-gray-200" />
        <div className="mt-1 h-3 w-20 rounded bg-gray-200" />
      </div>
      <div className="animate-pulse rounded-md border border-gray-100 bg-gray-50 p-3" aria-hidden="true">
        <div className="h-3 w-14 rounded bg-gray-200" />
        <div className="mt-1 h-6 w-16 rounded bg-gray-200" />
        <div className="mt-1 h-3 w-20 rounded bg-gray-200" />
      </div>
    </div>
  );
}

/**
 * Ghost incident table — pulsing skeleton for the incident list section.
 */
export function GhostIncidentTable() {
  return (
    <div className="animate-pulse overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm" aria-hidden="true">
      <div className="border-b border-gray-100 px-5 py-3">
        <div className="h-4 w-32 rounded bg-gray-200" />
      </div>
      <div className="divide-y divide-gray-100">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3">
            <div className="h-3 w-20 rounded bg-gray-200" />
            <div className="h-3 w-28 rounded bg-gray-200" />
            <div className="h-3 w-16 rounded bg-gray-200" />
            <div className="ml-auto h-5 w-14 rounded-full bg-gray-200" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * GhostMapPanel — pulsing skeleton for the heatmap section.
 */
export function GhostMapPanel() {
  return (
    <div
      className="animate-pulse overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm"
      aria-hidden="true"
    >
      <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3">
        <div className="h-5 w-5 rounded bg-gray-200" />
        <div className="h-4 w-20 rounded bg-gray-200" />
      </div>
      <div className="h-[400px] w-full rounded-b-md bg-gray-100" />
    </div>
  );
}
