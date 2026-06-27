"use client";

/**
 * GhostValidatorRow — pulsing skeleton for the validator dashboard incident
 * table. Matches the 9-column layout (checkbox, Submitted, Status, Region,
 * Station, Call Received, Category, Alarm, Actions) to prevent layout shift.
 * Renders in groups of 8 to fill a full page.
 */

export function GhostValidatorRow() {
  return (
    <tr aria-hidden="true" className="animate-pulse">
      <td className="px-4 py-3 w-8"><div className="h-4 w-4 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-3 w-16 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-5 w-14 rounded-full bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-3 w-12 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-3 w-24 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-3 w-10 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-3 w-12 rounded bg-gray-200" /></td>
    </tr>
  );
}

/**
 * GhostValidatorTable — renders a full page of ghost rows (8 rows).
 */
export function GhostValidatorTable() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <GhostValidatorRow key={`ghost-row-${i}`} />
      ))}
    </>
  );
}
