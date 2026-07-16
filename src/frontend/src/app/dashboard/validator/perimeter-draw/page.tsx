'use client';

/**
 * /dashboard/validator/perimeter-draw — disposable #637 interaction prototype.
 *
 * This route intentionally uses synthetic incident/report context and performs
 * no API calls. It exists only to validate the validator's perimeter-drawing
 * workflow before a separately reviewed production implementation is scoped.
 */

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { FlaskConical, WifiOff } from 'lucide-react';
import { useNetworkStatus } from '@/lib/useNetworkStatus';

const PerimeterDrawInner = dynamic(
  () => import('./PerimeterDrawInner'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
        Loading perimeter workspace...
      </div>
    ),
  },
);

const OFFLINE_UNAVAILABLE_MESSAGE =
  'The perimeter workspace is unavailable offline. Reconnect to load the map tiles and continue drawing.';

export default function ValidatorPerimeterDrawPage() {
  const networkStatus = useNetworkStatus();

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-6 py-3">
        <Link
          href="/dashboard/validator"
          className="text-sm font-medium text-blue-700 hover:text-blue-900"
        >
          ← Queue
        </Link>
        <h1 className="text-lg font-bold text-slate-800">Perimeter Drawing</h1>

        {!networkStatus.isOnline && (
          <span
            data-testid="offline-indicator"
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
          >
            Offline
          </span>
        )}

        <div className="ml-auto flex items-center gap-4">
          <div className="hidden items-center gap-2 sm:flex">
            <label className="text-xs font-medium text-slate-500" htmlFor="prototype-incident">
              Incident:
            </label>
            <select
              id="prototype-incident"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
              defaultValue="482"
              aria-label="Synthetic incident"
            >
              <option value="482">#482 · Batangas brush fire</option>
            </select>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <label className="text-xs font-medium text-slate-500" htmlFor="prototype-method">
              Method:
            </label>
            <select
              id="prototype-method"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
              defaultValue="MANUAL_DRAW"
              aria-label="Perimeter mapping method"
            >
              <option value="MANUAL_DRAW">Manual draw</option>
            </select>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
            <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
            Synthetic prototype
          </span>
        </div>
      </div>

      {!networkStatus.isOnline ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
          <WifiOff className="h-12 w-12 text-slate-300" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-slate-600">Perimeter Workspace Unavailable Offline</h2>
          <p className="max-w-sm text-sm text-slate-400">{OFFLINE_UNAVAILABLE_MESSAGE}</p>
          <Link
            href="/dashboard/validator"
            className="text-sm font-medium text-blue-700 hover:text-blue-900"
          >
            ← Back to queue
          </Link>
        </div>
      ) : (
        <div className="relative flex-1">
          <PerimeterDrawInner />
        </div>
      )}
    </div>
  );
}
