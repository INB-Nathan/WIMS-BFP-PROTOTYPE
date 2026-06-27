"use client";

/**
 * GhostOperationsCard — pulsing skeleton for the Operations Board cards.
 * Matches the OperationsConsole card layout (status badge, title, details,
 * action buttons) to prevent layout shift.
 */

export function GhostOperationsCard() {
  return (
    <div
      className="animate-pulse rounded-lg border border-gray-200 bg-white p-4"
      aria-hidden="true"
    >
      {/* Header row: status badge + actions */}
      <div className="mb-3 flex items-center justify-between">
        <div className="h-5 w-20 rounded-full bg-gray-200" />
        <div className="flex gap-2">
          <div className="h-5 w-5 rounded bg-gray-200" />
          <div className="h-5 w-5 rounded bg-gray-200" />
        </div>
      </div>

      {/* Title */}
      <div className="mb-1 h-4 w-3/4 rounded bg-gray-200" />

      {/* Location */}
      <div className="mb-3 h-3 w-1/2 rounded bg-gray-200" />

      {/* Details row: date, size, reports */}
      <div className="flex flex-wrap gap-3">
        <div className="h-3 w-24 rounded bg-gray-200" />
        <div className="h-3 w-16 rounded bg-gray-200" />
        <div className="h-3 w-20 rounded bg-gray-200" />
      </div>
    </div>
  );
}

/**
 * GhostOperationCards — renders a grid of ghost operation cards for
 * the loading state.
 */
export function GhostOperationCards() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <GhostOperationsCard key={`ghost-op-${i}`} />
      ))}
    </div>
  );
}
