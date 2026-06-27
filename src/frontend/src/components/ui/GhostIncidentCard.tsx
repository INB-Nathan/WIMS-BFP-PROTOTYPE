"use client";

/**
 * GhostIncidentCard — pulsing skeleton card displayed while the regional
 * dashboard incident list is loading.
 *
 * Matches the dimensions of the real IncidentCard so the layout does not
 * shift when real data arrives (cumulative layout shift prevention).
 * Uses a soft pulse animation (Tailwind animate-pulse) with gray blocks
 * that mirror the card's content structure.
 */

export function GhostIncidentCard() {
  return (
    <div
      className="flex animate-pulse flex-col rounded-xl border p-4"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)' }}
      aria-hidden="true"
    >
      {/* Top row: date + status badge skeleton */}
      <div className="mb-3 flex items-center justify-between">
        <div className="h-3 w-24 rounded bg-gray-200" />
        <div className="h-5 w-16 rounded-full bg-gray-200" />
      </div>

      {/* Classification / title skeleton */}
      <div className="mb-1 h-4 w-3/4 rounded bg-gray-200" />

      {/* Station skeleton */}
      <div className="mb-3 h-3 w-1/2 rounded bg-gray-200" />

      {/* Address skeleton (two lines) */}
      <div className="mb-1 h-3 w-full rounded bg-gray-200" />
      <div className="mb-3 h-3 w-2/3 rounded bg-gray-200" />

      {/* Bottom row: metric pills skeleton */}
      <div className="mt-auto flex flex-wrap gap-2">
        <div className="h-6 w-14 rounded-full bg-gray-200" />
        <div className="h-6 w-16 rounded-full bg-gray-200" />
        <div className="h-6 w-12 rounded-full bg-gray-200" />
      </div>
    </div>
  );
}

/**
 * GhostStatCard — pulsing skeleton for a stat card on the dashboard.
 */
export function GhostStatCard() {
  return (
    <div
      className="flex animate-pulse flex-col rounded-xl border p-4"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)' }}
      aria-hidden="true"
    >
      {/* Icon area */}
      <div className="mb-3 h-8 w-8 rounded-lg bg-gray-200" />
      {/* Label */}
      <div className="mb-1 h-3 w-1/2 rounded bg-gray-200" />
      {/* Value */}
      <div className="h-6 w-1/3 rounded bg-gray-200" />
    </div>
  );
}

/**
 * GhostIncidentRow — pulsing skeleton for a table row on the dashboard
 * (used when table view is active instead of card view).
 */
export function GhostIncidentRow() {
  return (
    <tr aria-hidden="true" className="animate-pulse">
      <td className="px-5 py-3"><div className="h-3 w-20 rounded bg-gray-200" /></td>
      <td className="px-5 py-3"><div className="h-3 w-28 rounded bg-gray-200" /></td>
      <td className="px-5 py-3"><div className="h-3 w-16 rounded bg-gray-200" /></td>
      <td className="px-5 py-3"><div className="h-3 w-36 rounded bg-gray-200" /></td>
      <td className="px-5 py-3"><div className="h-3 w-20 rounded bg-gray-200" /></td>
      <td className="px-5 py-3"><div className="h-5 w-14 rounded-full bg-gray-200" /></td>
      <td className="px-5 py-3"><div className="h-3 w-12 rounded bg-gray-200" /></td>
    </tr>
  );
}
