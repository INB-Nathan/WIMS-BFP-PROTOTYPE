'use client';

import dynamic from 'next/dynamic';
import type { TriageClusterEntry } from '@/lib/api';

const TriageSpatialPanelInner = dynamic(() => import('./TriageSpatialPanelInner'), {
  ssr: false,
  loading: () => (
    <div
      data-testid="triage-spatial-panel"
      className="flex h-full min-h-[280px] items-center justify-center bg-slate-100 text-sm text-slate-500"
    >
      Loading report map...
    </div>
  ),
});

export interface TriageSpatialPanelProps {
  cluster: TriageClusterEntry;
  selectedReportId: number | null;
  suggestedReportIds: number[];
  inspectionMode: 'cluster' | 'singleton';
  onSelectReport: (reportId: number) => void;
}

export function TriageSpatialPanel(props: TriageSpatialPanelProps) {
  return <TriageSpatialPanelInner {...props} />;
}
