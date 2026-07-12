'use client';

import { AlertTriangle, CheckCircle2, MapPin, RadioTower } from 'lucide-react';
import type { TriageReportEntry } from '@/lib/api';
import { hasLifeSafetySignal, isValidPhilippinesCoordinate, statusTone } from './triageGeometry';
import { isTerminalStatus, stripHtml } from './useTriageModalState';
import { trustLevel, TRUST_COLORS } from '@/lib/trustColors';

export interface TriageEvidenceCardProps {
  report: TriageReportEntry;
  selected?: boolean;
  suggested?: boolean;
  compact?: boolean;
  onClick?: (reportId: number) => void;
  onStartCorrection?: (report: TriageReportEntry) => void;
}

export function TriageEvidenceCard({
  report,
  selected = false,
  suggested = false,
  compact = false,
  onClick,
  onStartCorrection,
}: TriageEvidenceCardProps) {
  const hasLocation = isValidPhilippinesCoordinate(report.latitude, report.longitude);
  const terminal = isTerminalStatus(report.status);
  const description = stripHtml(report.description ?? '').trim();

  return (
    <article
      data-testid={`triage-evidence-card-${report.report_id}`}
      aria-selected={selected}
      className={`rounded-xl border p-3 text-sm shadow-sm transition ${statusTone(report)} ${
        selected ? 'ring-2 ring-red-700 ring-offset-2 border-red-700' : ''
      }`}
      onClick={() => onClick?.(report.report_id)}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-bold text-slate-500">REPORT #{report.report_id}</p>
          <h3 className="mt-1 font-semibold text-slate-950">
            {report.category ?? 'Unclassified'}{report.sub_category ? ` / ${report.sub_category}` : ''}
          </h3>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {selected && <span className="rounded-full bg-red-700 px-2 py-0.5 text-xs font-bold text-white">Selected</span>}
          {suggested && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">Suggested</span>}
          {terminal && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">{report.status}</span>}
        </div>
      </div>

      {!compact && description && <p className="mt-2 line-clamp-3 text-slate-700">{description}</p>}

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {hasLifeSafetySignal(report) && (
          <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-1 font-bold text-red-800">
            <AlertTriangle className="h-3 w-3" /> Life safety
          </span>
        )}
        {hasLocation ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">
            <MapPin className="h-3 w-3" /> {report.latitude.toFixed(4)}, {report.longitude.toFixed(4)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-200 px-2 py-1 font-bold text-slate-700">
            <MapPin className="h-3 w-3" /> No usable location
          </span>
        )}
        <span
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-bold ${TRUST_COLORS[trustLevel(report.trust_breakdown.score)].bg} ${TRUST_COLORS[trustLevel(report.trust_breakdown.score)].text}`}
          title="Trust score: higher = more reliable. Calculated from device history, proximity, and report consistency."
        >
          <CheckCircle2 className="h-3 w-3" /> Trust {report.trust_breakdown.score}/100
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">
          <RadioTower className="h-3 w-3" /> {report.station.name ?? 'No station'}
        </span>
      </div>

      {onStartCorrection && terminal && (
        <button
          type="button"
          className="mt-3 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          onClick={(event) => {
            event.stopPropagation();
            onStartCorrection(report);
          }}
        >
          Correct terminal status
        </button>
      )}
    </article>
  );
}
