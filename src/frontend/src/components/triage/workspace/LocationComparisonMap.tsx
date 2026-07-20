'use client';

import dynamic from 'next/dynamic';
import type { WorkspaceReport } from '@/types/triage-workspace';

const LocationComparisonMapInner = dynamic(() => import('./LocationComparisonMapInner'), {
  ssr: false,
  loading: () => <div role="status" className="flex min-h-80 items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-600">Loading evidence map…</div>,
});

export function LocationComparisonMap({ report }: { report: WorkspaceReport }) {
  return <LocationComparisonMapInner report={report} />;
}
