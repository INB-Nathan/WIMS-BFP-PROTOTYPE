"use client";

/**
 * GhostAdminPanel — pulsing skeleton panels for the System Admin Hub.
 * Mirrors the admin dashboard section layout to prevent layout shift.
 */

/**
 * Ghost admin stat card — pulsing skeleton for hub summary stats
 * (Total Users, Active Sessions, Celery Workers).
 */
export function GhostAdminStatCard() {
  return (
    <div
      className="animate-pulse rounded-lg border border-gray-200 bg-white p-5"
      aria-hidden="true"
    >
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-gray-200" />
        <div>
          <div className="mb-1 h-3 w-16 rounded bg-gray-200" />
          <div className="h-6 w-12 rounded bg-gray-200" />
        </div>
      </div>
    </div>
  );
}

/**
 * Ghost health card — pulsing skeleton for a service health component card
 * (PostgreSQL, Redis, Keycloak, Suricata, Ollama).
 */
export function GhostHealthCard() {
  return (
    <div
      className="animate-pulse rounded-lg p-4"
      style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}
      aria-hidden="true"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 rounded bg-gray-200" />
          <div>
            <div className="mb-1 h-3 w-20 rounded bg-gray-200" />
            <div className="h-3 w-8 rounded bg-gray-200" />
          </div>
        </div>
        <div className="h-3 w-3 rounded-full bg-gray-200" />
      </div>
    </div>
  );
}

/**
 * Ghost metric bar — pulsing skeleton for a system metric bar
 * (CPU, Memory, Disk, Uptime, Processes).
 */
export function GhostMetricCard() {
  return (
    <div
      className="animate-pulse rounded-lg p-4"
      style={{ backgroundColor: '#f8f9fa', border: '1px solid var(--border-color)' }}
      aria-hidden="true"
    >
      <div className="mb-1 h-3 w-10 rounded bg-gray-200" />
      <div className="mb-1 h-6 w-16 rounded bg-gray-200" />
      <div className="h-2 w-full rounded bg-gray-200" />
    </div>
  );
}

/**
 * Ghost monitor section — full monitoring panel skeleton
 * (5 metric cards + 4 health cards + worker table row).
 */
export function GhostMonitorSection() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden="true">
      {/* Metric cards row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <GhostMetricCard key={`metric-${i}`} />
        ))}
      </div>
      {/* Health services row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <GhostHealthCard key={`health-${i}`} />
        ))}
      </div>
      {/* Worker table skeleton */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 h-4 w-32 rounded bg-gray-200" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 w-full rounded bg-gray-100" />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Ghost admin layout — full-page skeleton for the auth-loading state,
 * matching the admin hub's: stat cards, then tabs with content areas.
 */
export function GhostAdminLayout() {
  return (
    <div className="space-y-6 p-6" aria-hidden="true">
      {/* Header */}
      <div className="animate-pulse">
        <div className="mb-1 h-7 w-48 rounded bg-gray-200" />
        <div className="h-4 w-80 rounded bg-gray-200" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <GhostAdminStatCard />
        <GhostAdminStatCard />
        <GhostAdminStatCard />
      </div>

      {/* Tab bar skeleton */}
      <div className="animate-pulse flex gap-2">
        <div className="h-9 w-24 rounded-lg bg-gray-200" />
        <div className="h-9 w-28 rounded-lg bg-gray-200" />
        <div className="h-9 w-20 rounded-lg bg-gray-200" />
        <div className="h-9 w-32 rounded-lg bg-gray-200" />
      </div>

      {/* Monitor section skeleton */}
      <GhostMonitorSection />
    </div>
  );
}
