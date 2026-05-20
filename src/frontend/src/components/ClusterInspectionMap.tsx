'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import type { TriageReportEntry } from '@/lib/api';

// SSR guard: react-leaflet breaks without window
const MapInner = dynamic(() => import('./ClusterMapInner'), { ssr: false, loading: () => (
  <div className="flex h-40 w-full items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-xs text-slate-400">
    Loading map...
  </div>
)});

export interface ClusterInspectionMapProps {
  reports: TriageReportEntry[];
  /** Merge-candidate anchor report IDs from fetchMergeCandidates */
  suggestedReportIds?: number[];
}

export function ClusterInspectionMap({ reports, suggestedReportIds = [] }: ClusterInspectionMapProps) {
  const center = useMemo<[number, number]>(() => {
    if (reports.length === 0) return [14.5995, 120.9842];
    const avgLat = reports.reduce((s, r) => s + r.latitude, 0) / reports.length;
    const avgLon = reports.reduce((s, r) => s + r.longitude, 0) / reports.length;
    return [avgLat, avgLon];
  }, [reports]);

  return (
    <div className="rounded-md border border-slate-200 overflow-hidden">
      <div className="bg-slate-50 px-3 py-1.5 border-b border-slate-200 flex items-center gap-2">
        <span className="text-xs font-medium text-slate-700">Report locations</span>
        <span className="flex gap-2 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-600" />
            Cluster member
          </span>
          {suggestedReportIds.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500" />
              Suggested merge source
            </span>
          )}
        </span>
      </div>
      <div style={{ height: 180 }}>
        <MapInner
          center={center}
          reports={reports}
          suggestedReportIds={suggestedReportIds}
        />
      </div>
    </div>
  );
}