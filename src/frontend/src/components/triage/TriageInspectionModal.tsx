'use client';

import { useEffect, useMemo, useState } from 'react';
import type { TriageClusterEntry, TriageReportEntry } from '@/lib/api';
import { ActivityPanel } from './ActivityPanel';
import { ClusterSummaryHeader } from './ClusterSummaryHeader';
import { ConfirmActionDialog, type ConfirmTone } from './ConfirmActionDialog';
import { CorrectionActionPanel } from './CorrectionActionPanel';
import { MergeActionPanel } from './MergeActionPanel';
import { ReportsListPanel } from './ReportsListPanel';
import { SplitActionPanel } from './SplitActionPanel';
import { TerminalActionPanel } from './TerminalActionPanel';
import { TriageActionTabs } from './TriageActionTabs';
import { TriageSpatialPanel } from './TriageSpatialPanel';
import {
  TERMINAL_OPTIONS,
  selectedReportIds,
  useTriageModalState,
} from './useTriageModalState';

export interface TriageInspectionModalProps {
  openCluster: TriageClusterEntry | null;
  inspectionMode: 'cluster' | 'singleton';
  onClose: () => void;
  onReloadQueue: () => Promise<void> | void;
  onMessage: (msg: string) => void;
  onError: (err: string) => void;
  /** Role of the current user; only NATIONAL_VALIDATOR may claim from the modal. */
  role: string | null;
}

interface PendingConfirm {
  kind: 'terminal' | 'split' | 'merge' | 'correct';
  title: string;
  body: string;
  confirmLabel: string;
  confirmTone: ConfirmTone;
  preview: React.ReactNode;
  run: () => Promise<void>;
}

export function TriageInspectionModal({
  openCluster,
  inspectionMode,
  onClose,
  onReloadQueue,
  onMessage,
  onError,
  role,
}: TriageInspectionModalProps) {
  const state = useTriageModalState({
    openCluster,
    inspectionMode,
    callbacks: { onClose, onReloadQueue, onMessage, onError },
  });
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  // Backdrop click + Escape to close
  useEffect(() => {
    if (!openCluster) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [openCluster]);

  useEffect(() => {
    if (!openCluster) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      // Tab navigation only — per system-wiki/frontend/validator-triage-shortcuts.md,
      // terminal / split / merge / correction actions must not have commit shortcuts
      // and require deliberate UI clicks.
      const key = e.key;
      if (key === '1') state.setTab('terminal');
      else if (key === '2') state.setTab('correct');
      else if (key === '3' && inspectionMode === 'cluster') state.setTab('split');
      else if (key === '4' && inspectionMode === 'cluster') state.setTab('merge');
      else if (key === '5') state.setTab('activity');
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [openCluster, onClose, inspectionMode, state]);

  const reportIds = useMemo(
    () => selectedReportIds(openCluster, state.selected),
    [openCluster, state.selected],
  );
  const suggestedReportIds = useMemo(
    () => state.mergeCandidates.map((c) => c.anchor_report_id),
    [state.mergeCandidates],
  );

  if (!openCluster) return null;

  async function requestApplyTerminal() {
    if (!openCluster?.cluster_id) return;
    if (reportIds.length === 0) {
      onError('Select at least one non-terminal report.');
      return;
    }
    if (!state.explanation.trim()) {
      onError('Citizen-visible explanation is required.');
      return;
    }
    const option = TERMINAL_OPTIONS.find((o) => o.value === state.terminalStatus);
    if (option?.tone === 'destructive' || option?.tone === 'caution') {
      setPending({
        kind: 'terminal',
        title: `Confirm ${option.label} on ${reportIds.length} report${reportIds.length === 1 ? '' : 's'}`,
        body:
          option.tone === 'destructive'
            ? `This is a destructive action. The citizen will be notified with the explanation you typed, and a REJECT audit event will be recorded.`
            : `The citizen will be notified with the explanation you typed, and a REJECT audit event will be recorded.`,
        confirmLabel: `Apply ${option.label}`,
        confirmTone: option.tone,
        preview: <TerminalPreview status={state.terminalStatus} message={state.explanation} reportCount={reportIds.length} />,
        run: state.applyTerminalAction,
      });
    } else {
      await state.applyTerminalAction();
    }
  }

  async function requestApplyCorrection() {
    if (!state.correctionReportId) {
      onError('Select a terminal report to correct.');
      return;
    }
    if (!state.explanation.trim() || !state.correctionReason.trim()) {
      onError('Correction requires a reason and replacement explanation.');
      return;
    }
    setPending({
      kind: 'correct',
      title: `Confirm correction of report #${state.correctionReportId}`,
      body: `The citizen-visible explanation will be replaced and a CORRECTION audit event will be written. The previous explanation is preserved in the audit log.`,
      confirmLabel: 'Apply correction',
      confirmTone: 'caution',
      preview: <TerminalPreview status={state.terminalStatus} message={state.explanation} reportCount={1} />,
      run: state.applyCorrection,
    });
  }

  async function requestApplySplit() {
    if (!openCluster?.cluster_id) return;
    if (reportIds.length < 2 || !state.splitNote.trim()) {
      onError('Split requires at least two selected reports and an internal note.');
      return;
    }
    setPending({
      kind: 'split',
      title: `Confirm split of ${reportIds.length} reports`,
      body: `A new cluster will be created with the ${reportIds.length} selected report${reportIds.length === 1 ? '' : 's'}. This cluster will retain the remaining reports. The action is recorded in the audit log.`,
      confirmLabel: 'Split cluster',
      confirmTone: 'caution',
      preview: (
        <SplitPreview
          leaving={openCluster.reports.filter((r: TriageReportEntry) => state.selected.has(r.report_id))}
          staying={openCluster.reports.filter((r: TriageReportEntry) => !state.selected.has(r.report_id))}
          note={state.splitNote}
        />
      ),
      run: state.applySplit,
    });
  }

  async function requestApplyMerge() {
    if (!openCluster?.cluster_id) return;
    const sourceId = Number(state.mergeSourceClusterId);
    if (!Number.isInteger(sourceId) || sourceId <= 0 || !state.mergeNote.trim()) {
      onError('Merge requires a source cluster id and internal note.');
      return;
    }
    setPending({
      kind: 'merge',
      title: `Confirm merge of cluster #${sourceId} into #${openCluster.cluster_id}`,
      body: `The source cluster's members will be appended to this cluster and the source will be closed. Merges are not auto-reversible and the action is recorded in the audit log.`,
      confirmLabel: 'Merge clusters',
      confirmTone: 'destructive',
      preview: <MergePreview sourceId={sourceId} targetId={openCluster.cluster_id} note={state.mergeNote} />,
      run: state.applyMerge,
    });
  }

  async function runPending() {
    if (!pending) return;
    const run = pending.run;
    setPending(null);
    await run();
  }

  const isCluster = inspectionMode === 'cluster' && openCluster.cluster_id !== null;
  // Backend role_can_work_cluster allows REGIONAL_ENCODER, NATIONAL_VALIDATOR, SYSTEM_ADMIN
  // to claim and work clusters. The Claim button must be visible for all three.
  const canClaim =
    (role === 'NATIONAL_VALIDATOR' || role === 'SYSTEM_ADMIN' || role === 'REGIONAL_ENCODER') &&
    isCluster &&
    (openCluster as TriageClusterEntry).assigned_to === null;

  return (
    <div
      className="triage-modal"
      data-testid="triage-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="triage-modal-title"
        className="triage-modal__panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ClusterSummaryHeader
          cluster={openCluster}
          inspectionMode={inspectionMode}
          onClose={onClose}
        />

        {canClaim && (
          <div className="triage-claim-bar">
            <span>This cluster is unassigned. Claim it before applying actions.</span>
            <button
              type="button"
              disabled={state.busy}
              onClick={() => state.claimCluster(openCluster.cluster_id)}
              className="triage-claim-bar__button"
            >
              Claim cluster #{openCluster.cluster_id}
            </button>
          </div>
        )}

        <div className="triage-modal__body">
          <aside className="triage-modal__spatial">
            <TriageSpatialPanel
              cluster={openCluster}
              selectedReportId={state.correctionReportId ?? reportIds[0] ?? null}
              suggestedReportIds={suggestedReportIds}
              inspectionMode={inspectionMode}
              onSelectReport={(reportId) => state.toggleSelected(reportId)}
            />
          </aside>

          <main className="triage-modal__center" data-testid="triage-evidence-panel">
            <ReportsListPanel
              cluster={openCluster}
              inspectionMode={inspectionMode}
              selected={state.selected}
              onToggle={state.toggleSelected}
              onStartCorrection={state.startCorrection}
              suggestedReportIds={suggestedReportIds}
            />
          </main>

          <aside className="triage-modal__right" data-testid="triage-action-rail">
            <div className="triage-action-rail__tabs">
              <TriageActionTabs
                tab={state.tab}
                setTab={state.setTab}
                inspectionMode={inspectionMode}
                selectedCount={reportIds.length}
                totalCount={openCluster.reports.length}
                correctionReportId={state.correctionReportId}
                mergeCandidateCount={state.mergeCandidates.length}
              />
            </div>
            {state.tab === 'terminal' && (
              <TerminalActionPanel
                cluster={openCluster}
                selected={state.selected}
                terminalStatus={state.terminalStatus}
                setTerminalStatus={state.setTerminalStatus}
                explanation={state.explanation}
                setExplanation={state.setExplanation}
                internalNote={state.internalNote}
                setInternalNote={state.setInternalNote}
                onApply={() => void requestApplyTerminal()}
                busy={state.busy}
              />
            )}
            {state.tab === 'correct' && (
              <CorrectionActionPanel
                correctionReportId={state.correctionReportId}
                terminalStatus={state.terminalStatus}
                setTerminalStatus={state.setTerminalStatus}
                explanation={state.explanation}
                setExplanation={state.setExplanation}
                correctionReason={state.correctionReason}
                setCorrectionReason={state.setCorrectionReason}
                onApply={() => void requestApplyCorrection()}
                busy={state.busy}
              />
            )}
            {state.tab === 'split' && inspectionMode === 'cluster' && (
              <SplitActionPanel
                cluster={openCluster}
                selected={state.selected}
                splitNote={state.splitNote}
                setSplitNote={state.setSplitNote}
                onApply={() => void requestApplySplit()}
                busy={state.busy}
              />
            )}
            {state.tab === 'merge' && inspectionMode === 'cluster' && (
              <MergeActionPanel
                cluster={openCluster}
                mergeCandidates={state.mergeCandidates}
                mergeSourceClusterId={state.mergeSourceClusterId}
                setMergeSourceClusterId={state.setMergeSourceClusterId}
                mergeNote={state.mergeNote}
                setMergeNote={state.setMergeNote}
                onPickCandidate={state.pickMergeCandidate}
                onApply={() => void requestApplyMerge()}
                busy={state.busy}
              />
            )}
            {state.tab === 'activity' && <ActivityPanel activity={state.activity} />}
          </aside>
        </div>
      </div>

      <ConfirmActionDialog
        open={pending !== null}
        title={pending?.title ?? ''}
        body={pending?.body ?? ''}
        confirmLabel={pending?.confirmLabel ?? 'Confirm'}
        confirmTone={pending?.confirmTone ?? 'standard'}
        preview={pending?.preview ?? null}
        busy={state.busy}
        onCancel={() => setPending(null)}
        onConfirm={() => void runPending()}
      />
    </div>
  );
}

function TerminalPreview({ status, message, reportCount }: { status: string; message: string; reportCount: number }) {
  return (
    <div className="triage-confirm__mini">
      <div className="triage-confirm__mini-row">
        <span className="triage-confirm__mini-label">Status</span>
        <span className="triage-confirm__mini-value">{status}</span>
      </div>
      <div className="triage-confirm__mini-row">
        <span className="triage-confirm__mini-label">Affected</span>
        <span className="triage-confirm__mini-value">{reportCount} report{reportCount === 1 ? '' : 's'}</span>
      </div>
      <div className="triage-confirm__mini-bubble">{message}</div>
    </div>
  );
}

function SplitPreview({ leaving, staying, note }: { leaving: TriageReportEntry[]; staying: TriageReportEntry[]; note: string }) {
  return (
    <div className="triage-confirm__mini">
      <div className="triage-confirm__mini-row">
        <span className="triage-confirm__mini-label">Leaving</span>
        <span className="triage-confirm__mini-value">{leaving.map((r) => `#${r.report_id}`).join(', ')}</span>
      </div>
      <div className="triage-confirm__mini-row">
        <span className="triage-confirm__mini-label">Staying</span>
        <span className="triage-confirm__mini-value">{staying.map((r) => `#${r.report_id}`).join(', ') || '—'}</span>
      </div>
      <div className="triage-confirm__mini-row">
        <span className="triage-confirm__mini-label">Note</span>
        <span className="triage-confirm__mini-value">{note}</span>
      </div>
    </div>
  );
}

function MergePreview({ sourceId, targetId, note }: { sourceId: number; targetId: number; note: string }) {
  return (
    <div className="triage-confirm__mini">
      <div className="triage-confirm__mini-row">
        <span className="triage-confirm__mini-label">Source</span>
        <span className="triage-confirm__mini-value">#{sourceId}</span>
      </div>
      <div className="triage-confirm__mini-row">
        <span className="triage-confirm__mini-label">Target</span>
        <span className="triage-confirm__mini-value">#{targetId}</span>
      </div>
      <div className="triage-confirm__mini-row">
        <span className="triage-confirm__mini-label">Note</span>
        <span className="triage-confirm__mini-value">{note}</span>
      </div>
    </div>
  );
}
