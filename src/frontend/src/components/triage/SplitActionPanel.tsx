'use client';

import { ArrowRight, Info, Loader2 } from 'lucide-react';
import type { TriageClusterEntry, TriageReportEntry } from '@/lib/api';
import { stripHtml } from './useTriageModalState';

export interface SplitActionPanelProps {
  cluster: TriageClusterEntry;
  selected: Set<number>;
  splitNote: string;
  setSplitNote: (s: string) => void;
  onApply: () => void;
  busy: boolean;
}

/**
 * Right rail: split form.
 * - Side-by-side preview of "leaving" (selected) and "staying" reports.
 * - Internal note is required.
 * - Pre-commit summary card makes the operator confirm the impact before clicking.
 */
export function SplitActionPanel({
  cluster,
  selected,
  splitNote,
  setSplitNote,
  onApply,
  busy,
}: SplitActionPanelProps) {
  const { leaving, staying } = splitReports(cluster.reports, selected);
  const canApply = !busy && !!cluster.cluster_id && leaving.length >= 2 && splitNote.trim().length > 0;
  const remainingCount = cluster.reports.length - leaving.length;
  const willBeEmpty = remainingCount === 0;

  return (
    <section className="triage-panel" data-testid="triage-panel-split">
      <header className="triage-panel__head">
        <span className="triage-panel__eyebrow">ACTION 3</span>
        <h3 className="triage-panel__title">Split this cluster</h3>
        <p className="triage-panel__desc">
          Moves the selected reports out of this cluster and into a brand-new one. Use when a
          subset of reports should be investigated as a separate event.
        </p>
      </header>

      <div className="triage-split-preview">
        <SplitColumn
          tone="leaving"
          title="Leaving this cluster"
          reports={leaving}
          count={leaving.length}
        />
        <ArrowRight className="triage-split-preview__arrow" />
        <SplitColumn
          tone="staying"
          title="Staying in this cluster"
          reports={staying}
          count={staying.length}
          emptyText="(no remaining reports)"
        />
      </div>

      <div className="triage-field">
        <label className="triage-field__label" htmlFor="triage-split-note">
          Internal note <span className="triage-field__required">required</span>
        </label>
        <p className="triage-field__hint">
          Why is this a separate event? Recorded in the cluster&apos;s audit log. Visible to validators
          and admins only.
        </p>
        <textarea
          id="triage-split-note"
          value={splitNote}
          onChange={(e) => setSplitNote(e.target.value)}
          rows={3}
          placeholder="e.g. different address, different time window"
          className="triage-textarea triage-textarea--audit"
        />
      </div>

      <details className="triage-why">
        <summary>
          <Info className="h-3.5 w-3.5" />
          What will happen?
        </summary>
        <p>
          A new cluster is created with the {leaving.length} leaving report{leaving.length === 1 ? '' : 's'}.
          This cluster keeps the {staying.length} staying report{staying.length === 1 ? '' : 's'}.
          {willBeEmpty
            ? ' This cluster will become empty after the split; the backend may auto-close it.'
            : ''}
        </p>
      </details>

      <button
        type="button"
        disabled={!canApply}
        onClick={onApply}
        className="triage-commit triage-commit--caution"
        data-testid="triage-commit-split"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        <span>
          Split {leaving.length} report{leaving.length === 1 ? '' : 's'} into a new cluster
        </span>
        <span className="triage-commit__hint">click to confirm</span>
      </button>
    </section>
  );
}

function splitReports(reports: TriageReportEntry[], selected: Set<number>) {
  const leaving: TriageReportEntry[] = [];
  const staying: TriageReportEntry[] = [];
  for (const report of reports) {
    if (selected.has(report.report_id)) leaving.push(report);
    else staying.push(report);
  }
  return { leaving, staying };
}

interface SplitColumnProps {
  tone: 'leaving' | 'staying';
  title: string;
  reports: TriageReportEntry[];
  count: number;
  emptyText?: string;
}

function SplitColumn({ tone, title, reports, count, emptyText }: SplitColumnProps) {
  return (
    <div className={`triage-split-col triage-split-col--${tone}`}>
      <div className="triage-split-col__head">
        <span className="triage-split-col__title">{title}</span>
        <span className="triage-split-col__count">{count}</span>
      </div>
      {reports.length === 0 ? (
        <p className="triage-split-col__empty">{emptyText ?? '—'}</p>
      ) : (
        <ul className="triage-split-col__list">
          {reports.map((report) => (
            <li key={report.report_id} className="triage-split-col__item">
              <span className="triage-split-col__id">#{report.report_id}</span>
              <span className="triage-split-col__cat">
                {report.category ?? 'Unspecified'} / {report.sub_category ?? 'none'}
              </span>
              {report.description && (
                <span className="triage-split-col__desc">{stripHtml(report.description).slice(0, 80)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
