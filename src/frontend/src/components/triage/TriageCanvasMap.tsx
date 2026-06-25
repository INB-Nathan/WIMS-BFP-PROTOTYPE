'use client';

import dynamic from 'next/dynamic';
import type { TriageClusterEntry } from '@/lib/api';
import type { TriageItemIdentity } from './triageGeometry';

const TriageCanvasMapInner = dynamic(() => import('./TriageCanvasMapInner'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[min(68vh,680px)] min-h-[420px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-500">
      Loading triage map...
    </div>
  ),
});

export interface TriageCanvasMapProps {
  items: TriageClusterEntry[];
  selectedIdentity: TriageItemIdentity | null;
  selectedReportId: number | null;
  onSelectItem: (item: TriageClusterEntry) => void;
  onSelectReport: (reportId: number) => void;
}

export function TriageCanvasMap(props: TriageCanvasMapProps) {
  return <TriageCanvasMapInner {...props} />;
}
