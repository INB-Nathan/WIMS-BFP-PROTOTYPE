'use client';

interface FreshnessDotProps {
  /** Minutes since data was cached. null/undefined = live data or offline. */
  minutesAgo?: number;
  isOnline: boolean;
}

export function FreshnessDot({ minutesAgo, isOnline }: FreshnessDotProps) {
  if (!isOnline) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400">
        <span className="inline-block h-2 w-2 rounded-full bg-gray-400" aria-hidden="true" />
        Offline
      </span>
    );
  }

  if (minutesAgo == null) {
    return null;
  }

  if (minutesAgo < 5) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
        Updated {minutesAgo}m ago
      </span>
    );
  }

  if (minutesAgo < 30) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
        Cached {minutesAgo}m ago
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600">
      <span className="inline-block h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
      Stale &mdash; {minutesAgo}m ago
    </span>
  );
}
