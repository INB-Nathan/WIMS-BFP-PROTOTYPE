'use client';

import { Check, Link2, MessageSquareWarning, RotateCcw, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { TriageClusterEntry, TriageReportEntry } from '@/lib/api';
import { ClusterInspectionMap } from '@/components/ClusterInspectionMap';
import { isTerminalStatus, stripHtml } from './useTriageModalState';

export interface ReportsListPanelProps {
  cluster: TriageClusterEntry;
  inspectionMode: 'cluster' | 'singleton';
  selected: Set<number>;
  onToggle: (reportId: number) => void;
  onStartCorrection: (report: TriageReportEntry) => void;
  suggestedReportIds: number[];
}

/**
 * Center report list. Renders one card per report so the operator can scan
 * a single report at a time and see selection state, trust, signals, station,
 * and follow-ups at a glance. Terminal rows surface a Correct button inline.
 */
export function ReportsListPanel({
  cluster,
  inspectionMode,
  selected,
  onToggle,
  onStartCorrection,
  suggestedReportIds,
}: ReportsListPanelProps) {
  const first = cluster.reports[0];
  return (
    <div className="triage-reports" data-testid="triage-reports">
      {inspectionMode === 'cluster' && (
        <ClusterInspectionMap reports={cluster.reports} suggestedReportIds={suggestedReportIds} />
      )}
      {inspectionMode === 'singleton' && first && (
        <div className="triage-reports__singleton-meta">
          <span className="triage-reports__coord">
            <span className="triage-reports__coord-label">LAT</span>
            {first.latitude.toFixed(4)}
          </span>
          <span className="triage-reports__coord">
            <span className="triage-reports__coord-label">LON</span>
            {first.longitude.toFixed(4)}
          </span>
          <span className="triage-reports__coord">
            <span className="triage-reports__coord-label">STATION</span>
            {first.station.name ?? 'Unavailable'}
          </span>
        </div>
      )}

      <ul className="triage-report-list">
        {cluster.reports.map((report) => (
          <ReportCard
            key={report.report_id}
            report={report}
            selected={selected.has(report.report_id)}
            terminal={isTerminalStatus(report.status)}
            onToggle={() => onToggle(report.report_id)}
            onStartCorrection={() => onStartCorrection(report)}
          />
        ))}
      </ul>
    </div>
  );
}

interface ReportCardProps {
  report: TriageReportEntry;
  selected: boolean;
  terminal: boolean;
  onToggle: () => void;
  onStartCorrection: () => void;
}

function ReportCard({ report, selected, terminal, onToggle, onStartCorrection }: ReportCardProps) {
  const trust = report.trust_breakdown.score;
  const isSuspicious = report.trust_breakdown.gps_mismatch || report.trust_breakdown.duplicate_device_count_30m > 0;

  return (
    <li
      className={`triage-card ${selected ? 'triage-card--selected' : ''} ${terminal ? 'triage-card--terminal' : ''}`}
      data-testid={`triage-card-${report.report_id}`}
      data-selected={selected ? 'true' : 'false'}
    >
      <label className="triage-card__selector">
        <input
          type="checkbox"
          disabled={terminal}
          checked={selected}
          onChange={onToggle}
          className="triage-card__checkbox"
          aria-label={`Select report ${report.report_id}`}
        />
        <span className="triage-card__checkbox-pill" aria-hidden="true">
          {selected && <Check className="h-3.5 w-3.5" />}
        </span>
      </label>

      <div className="triage-card__body">
        <div className="triage-card__head">
          <div className="triage-card__id">
            <span className="triage-card__id-hash">#</span>
            <span className="triage-card__id-num">{report.report_id}</span>
          </div>
          <div className="triage-card__status-row">
            <span className={`triage-card__status triage-card__status--${report.status.toLowerCase()}`}>
              {report.status}
            </span>
            {report.linked_to_report_id && (
              <span className="triage-card__link" title={`Update to #${report.linked_to_report_id}`}>
                <Link2 className="h-3 w-3" />
                update to #{report.linked_to_report_id}
              </span>
            )}
            {report.linked_count > 0 && !report.linked_to_report_id && (
              <span className="triage-card__link">
                <Link2 className="h-3 w-3" />
                {report.linked_count} civilian update{report.linked_count === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>

        <div className="triage-card__signals">
          <div className="triage-card__category">
            {report.category ?? 'Unspecified'} / {report.sub_category ?? 'none'}
          </div>
          <div className="triage-card__context">
            {report.reporting_context ?? '—'} · {report.safety_status ?? '—'}
          </div>
        </div>

        {report.description && (
          <p className="triage-card__description">{stripHtml(report.description)}</p>
        )}

        {report.followups && report.followups.length > 0 && (
          <div className="triage-card__followups">
            {report.followups.map((followup) => (
              <div key={followup.followup_id} className="triage-card__followup">
                <MessageSquareWarning className="h-3.5 w-3.5" />
                <div>
                  <div className="triage-card__followup-text">{stripHtml(followup.followup_text)}</div>
                  <div className="triage-card__followup-time">Follow-up · {new Date(followup.created_at).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {isSuspicious && (
          <div className="triage-card__warnings">
            {report.trust_breakdown.gps_mismatch && (
              <span className="triage-card__warning">
                <TriangleAlert className="h-3 w-3" /> GPS mismatch
              </span>
            )}
            {report.trust_breakdown.duplicate_device_count_30m > 0 && (
              <span className="triage-card__warning">
                <ShieldAlert className="h-3 w-3" /> Duplicate device ×{report.trust_breakdown.duplicate_device_count_30m}
              </span>
            )}
          </div>
        )}

        <div className="triage-card__foot">
          <div className="triage-card__meta">
            <span className="triage-card__trust">
              trust <strong>{trust}</strong>
            </span>
            <span className="triage-card__time">{new Date(report.created_at).toLocaleString()}</span>
          </div>
          {terminal && (
            <button
              type="button"
              onClick={onStartCorrection}
              className="triage-card__correct"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Correct
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
