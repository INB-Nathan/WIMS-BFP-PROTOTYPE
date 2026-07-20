'use client';

import { AlertTriangle, ClipboardList, Clock, ShieldCheck } from 'lucide-react';
import type { TriageClusterEntry, TriageReportEntry } from '@/lib/api';
import { formatIncidentDate } from '@/lib/incident-utils';
import { trustLevel, TRUST_COLORS } from '@/lib/trustColors';
import {
  deriveClusterGeometry,
  getTriageItemIdentity,
  hasLifeSafetySignal,
  isValidPhilippinesCoordinate,
  sortTriageItemsByPriority,
  statusTone,
} from './triageGeometry';
import { isTerminalStatus } from './useTriageWorkflowState';

function formatSignalList(signals: string[]): string {
  return signals.length ? signals.join(', ') : '—';
}

function formatStationDistance(distanceMeters: number | null): string {
  if (distanceMeters == null) return '—';
  return distanceMeters >= 1000 ? `${(distanceMeters / 1000).toFixed(1)} km` : `${Math.round(distanceMeters)} m`;
}

interface TriageEvidenceRowProps {
  report: TriageReportEntry;
  selected: boolean;
  onClick?: (reportId: number) => void;
}

function TriageEvidenceRow({ report, selected, onClick }: TriageEvidenceRowProps) {
  const hasLocation = isValidPhilippinesCoordinate(report.latitude, report.longitude);
  const terminal = isTerminalStatus(report.status);
  const lifeSafety = hasLifeSafetySignal(report);

  return (
    <tr
      data-testid={`triage-evidence-row-${report.report_id}`}
      aria-selected={selected}
      className={`cursor-pointer border-b text-xs transition ${statusTone(report)} ${
        selected ? 'ring-2 ring-inset ring-red-700' : ''
      }`}
      onClick={() => onClick?.(report.report_id)}
    >
      <td className="whitespace-nowrap px-3 py-2 align-top font-mono font-bold text-slate-500">
        #{report.report_id}
      </td>
      <td className="px-3 py-2 align-top font-semibold text-slate-950">
        {report.category ?? 'Unclassified'}{report.sub_category ? ` / ${report.sub_category}` : ''}
      </td>
      <td className="hidden px-3 py-2 align-top text-slate-700 sm:table-cell">{report.reporting_context ?? '—'}</td>
      <td className="hidden px-3 py-2 align-top text-slate-700 sm:table-cell">
        {lifeSafety && (
          <span className="mb-1 inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 font-bold text-red-800">
            <AlertTriangle className="h-3 w-3" /> Life safety
          </span>
        )}
        <div>{report.safety_status ?? '—'}</div>
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2 align-top text-slate-700 sm:table-cell">
        {hasLocation ? `${report.latitude.toFixed(4)}, ${report.longitude.toFixed(4)}` : 'No usable location'}
      </td>
      <td className="whitespace-nowrap px-3 py-2 align-top">
        <span
          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-bold ${TRUST_COLORS[trustLevel(report.trust_breakdown.score)].bg} ${TRUST_COLORS[trustLevel(report.trust_breakdown.score)].text}`}
          title="Trust score: higher = more reliable. Calculated from device history, proximity, and report consistency."
        >
          {report.trust_breakdown.score}/100
        </span>
      </td>
      <td className="hidden max-w-[220px] px-3 py-2 align-top text-slate-700 sm:table-cell">
        {formatSignalList(report.trust_breakdown.included_signals)}
      </td>
      <td className="hidden max-w-[220px] px-3 py-2 align-top text-slate-700 sm:table-cell">
        {formatSignalList(report.trust_breakdown.missing_signals)}
      </td>
      <td className="hidden px-3 py-2 align-top sm:table-cell">
        <span className={report.trust_breakdown.gps_mismatch ? 'font-bold text-red-700' : 'text-slate-700'}>
          {report.trust_breakdown.gps_mismatch ? 'Yes' : 'No'}
        </span>
      </td>
      <td className="hidden px-3 py-2 align-top text-slate-700 sm:table-cell">{report.trust_breakdown.duplicate_device_count_30m}</td>
      <td className="hidden px-3 py-2 align-top text-slate-700 sm:table-cell">{report.station.name ?? 'No station'}</td>
      <td className="hidden whitespace-nowrap px-3 py-2 align-top text-slate-700 sm:table-cell">
        {formatStationDistance(report.station.distance_m)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 align-top">
        <span className={terminal ? 'rounded-full bg-slate-900 px-2 py-0.5 font-bold text-white' : 'text-slate-700'}>
          {report.status}
        </span>
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2 align-top text-slate-700 sm:table-cell">
        {formatIncidentDate(report.reported_at ?? report.created_at)}
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2 align-top sm:table-cell">
        <div className="flex flex-wrap gap-1">
          {report.is_aging && <span className="rounded-md bg-slate-200 px-2 py-0.5 font-bold text-slate-700">Aging</span>}
          {report.is_timeout_risk && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 font-bold text-amber-800">
              <Clock className="h-3 w-3" /> Timeout risk
            </span>
          )}
          {!report.is_aging && !report.is_timeout_risk && '—'}
        </div>
      </td>
    </tr>
  );
}

interface TriageEvidenceTableProps {
  item: TriageClusterEntry;
  selectedReportId: number | null;
  onSelectReport: (reportId: number) => void;
}

export function TriageEvidenceTable({ item, selectedReportId, onSelectReport }: TriageEvidenceTableProps) {
  const identity = getTriageItemIdentity(item);

  return (
    <section data-testid="triage-evidence-table" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-200 px-4 py-3">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">Report evidence</p>
        <h2 className="mt-1 text-lg font-black text-slate-950">
          {identity?.type === 'cluster'
            ? `Reports for Cluster #${identity.id}`
            : `Evidence for Report #${identity?.id ?? item.anchor_report_id}`}
        </h2>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Report ID</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Category / Sub</th>
              <th className="hidden px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 sm:table-cell">Context</th>
              <th className="hidden px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 sm:table-cell">Safety Status</th>
              <th className="hidden whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 sm:table-cell">Location</th>
              <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Trust Score</th>
              <th className="hidden px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 sm:table-cell">Signals Found</th>
              <th className="hidden px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 sm:table-cell">Missing Signals</th>
              <th className="hidden px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 sm:table-cell">GPS Mismatch</th>
              <th className="hidden whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 sm:table-cell">Dup Device Count</th>
              <th className="hidden px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 sm:table-cell">Station</th>
              <th className="hidden px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 sm:table-cell">Distance</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
              <th className="hidden whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 sm:table-cell">Reported At</th>
              <th className="hidden whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 sm:table-cell">Aging / Timeout</th>
            </tr>
          </thead>
          <tbody>
            {item.reports.map((report) => (
              <TriageEvidenceRow
                key={report.report_id}
                report={report}
                selected={report.report_id === selectedReportId}
                onClick={onSelectReport}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface TriageInvestigationBoardProps {
  items: TriageClusterEntry[];
  selectedItem: TriageClusterEntry | null;
  role: string | null;
  claiming: number | null;
  onInspect: (item: TriageClusterEntry) => void;
  onSelectItem: (item: TriageClusterEntry) => void;
  onClaimCluster: (clusterId: number) => void;
}

export function TriageInvestigationBoard({
  items,
  selectedItem,
  role,
  claiming,
  onInspect,
  onSelectItem,
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

      <div className="min-h-0 flex-1 p-4">
        <p className="text-sm text-slate-600">
          {selectedItem
            ? 'Review the selected item’s reports in the full-width evidence table below.'
            : 'Choose a marker or ranked item to begin.'}
        </p>
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
