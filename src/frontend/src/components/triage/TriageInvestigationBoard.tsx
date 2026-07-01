'use client';

import { AlertTriangle, ClipboardList, Clock, ShieldCheck } from 'lucide-react';
import type { TriageClusterEntry } from '@/lib/api';
import { TriageEvidenceCard } from './TriageEvidenceCard';
import { trustLevel, TRUST_COLORS } from '@/lib/trustColors';
import { deriveClusterGeometry, getTriageItemIdentity, sortTriageItemsByPriority } from './triageGeometry';

interface TriageInvestigationBoardProps {
  items: TriageClusterEntry[];
  selectedItem: TriageClusterEntry | null;
  selectedReportId: number | null;
  role: string | null;
  claiming: number | null;
  onInspect: (item: TriageClusterEntry) => void;
  onSelectItem: (item: TriageClusterEntry) => void;
  onSelectReport: (reportId: number) => void;
  onClaimCluster: (clusterId: number) => void;
}

export function TriageInvestigationBoard({
  items,
  selectedItem,
  selectedReportId,
  role,
  claiming,
  onInspect,
  onSelectItem,
  onSelectReport,
  onClaimCluster,
}: TriageInvestigationBoardProps) {
  const selectedIdentity = selectedItem ? getTriageItemIdentity(selectedItem) : null;
  const geometry = selectedItem ? deriveClusterGeometry(selectedItem) : null;
  const ranked = sortTriageItemsByPriority(items)
    .filter((item) => {
      if (!selectedIdentity) return true;
      const id = getTriageItemIdentity(item);
      return !(id && id.type === selectedIdentity.type && id.id === selectedIdentity.id);
    })
    .slice(0, 8);
  const canClaim =
    role === 'NATIONAL_VALIDATOR' &&
    selectedIdentity?.type === 'cluster' &&
    selectedItem?.cluster_id != null &&
    selectedItem.assigned_to === null;

  return (
    <aside data-testid="triage-investigation-board" className="flex h-full min-h-[420px] flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">Investigation board</p>
        {selectedItem && selectedIdentity ? (
          <div className="mt-2 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-slate-950">
                {selectedIdentity.type === 'cluster' ? `Cluster #${selectedIdentity.id}` : `Report #${selectedIdentity.id}`}
              </h2>
              <p className="text-sm text-slate-600">
                {selectedItem.member_count} report(s) · {selectedItem.station.name ?? 'No station'}
              </p>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${TRUST_COLORS[trustLevel(selectedItem.avg_trust)].bg} ${TRUST_COLORS[trustLevel(selectedItem.avg_trust)].text}`}
                title="Trust score: higher = more reliable. Calculated from device history, proximity, and report consistency."
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${TRUST_COLORS[trustLevel(selectedItem.avg_trust)].dot}`}
                />
                Trust {Math.round(selectedItem.avg_trust)}/100
              </span>
            </div>
            <button
              type="button"
              className="rounded-md bg-red-700 px-3 py-2 text-sm font-bold text-white hover:bg-red-800"
              onClick={() => onInspect(selectedItem)}
            >
              Inspect / Act
            </button>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-600">Select a cluster or report on the map to inspect evidence.</p>
        )}
      </div>

      {selectedItem && (
        <div className="border-b border-slate-200 p-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-md bg-slate-100 px-2 py-1 font-bold text-slate-700">{selectedItem.severity}</span>
            {selectedItem.has_life_safety && <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-1 font-bold text-red-800"><AlertTriangle className="h-3 w-3" /> Life safety</span>}
            {selectedItem.is_timeout_risk && <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 font-bold text-amber-800"><Clock className="h-3 w-3" /> Timeout risk</span>}
            {geometry?.invalidReports.length ? <span className="rounded-md bg-slate-200 px-2 py-1 font-bold text-slate-700">{geometry.invalidReports.length} no usable location</span> : null}
          </div>
          {canClaim && selectedItem.cluster_id != null && (
            <button
              type="button"
              disabled={claiming === selectedItem.cluster_id}
              className="mt-3 inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => onClaimCluster(selectedItem.cluster_id!)}
            >
              <ShieldCheck className="h-3 w-3" /> Claim cluster
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {selectedItem ? (
          <div className="space-y-3">
            {selectedItem.reports.map((report) => (
              <TriageEvidenceCard
                key={report.report_id}
                report={report}
                selected={report.report_id === selectedReportId}
                onClick={onSelectReport}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            Choose a marker or ranked item to begin.
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
          <ClipboardList className="h-4 w-4 text-red-700" /> Ranked queue
        </div>
        <div className="space-y-2">
          {ranked.map((item) => {
            const identity = getTriageItemIdentity(item);
            if (!identity) return null;
            const selected = selectedIdentity?.type === identity.type && selectedIdentity.id === identity.id;
            return (
              <button
                key={`${identity.type}-${identity.id}`}
                type="button"
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${selected ? 'border-red-700 bg-red-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                onClick={() => onSelectItem(item)}
              >
                <span className="font-bold text-slate-950">{identity.type === 'cluster' ? `Cluster #${identity.id}` : `Report #${identity.id}`}</span>
                <span className="ml-2 text-slate-500">{item.severity} · {item.member_count} report(s)</span>
                <span
                  className={`ml-auto text-[10px] font-bold ${TRUST_COLORS[trustLevel(item.avg_trust)].inline}`}
                >
                  Trust {Math.round(item.avg_trust)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
