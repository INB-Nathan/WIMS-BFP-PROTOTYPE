'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  applyTriageTerminalAction,
  claimTriageCluster,
  correctTriageReport,
  fetchMergeCandidates,
  fetchTriageClusterActivity,
  mergeTriageClusters,
  splitTriageCluster,
  type MergeCandidateEntry,
  type TerminalCitizenStatus,
  type TriageClusterActivityEntry,
  type TriageClusterEntry,
  type TriageReportEntry,
} from '@/lib/api';

export const TERMINAL_OPTIONS: { value: TerminalCitizenStatus; label: string; template: string; hint: string; tone: 'standard' | 'caution' | 'destructive' }[] = [
  {
    value: 'ACTIONED',
    label: 'Actioned',
    tone: 'standard',
    hint: 'Standard close-out. The civilian signal has been received and routed for action. Use when BFP has taken ownership of the underlying emergency.',
    template: 'BFP has received and actioned this civilian signal. Call 911 for urgent updates.',
  },
  {
    value: 'REJECTED_DUPLICATE',
    label: 'Duplicate',
    tone: 'caution',
    hint: 'Logs a deduplication audit event. Use when this report is already covered by another report or active cluster.',
    template: 'This appears to duplicate another civilian signal already under review or action.',
  },
  {
    value: 'REJECTED_INSUFFICIENT',
    label: 'Insufficient',
    tone: 'caution',
    hint: 'Logs an insufficient-evidence audit event. Use when the report cannot be verified from the available details.',
    template: 'This report could not be verified from the available details. Submit a new report if the emergency continues.',
  },
  {
    value: 'REJECTED_BOGUS',
    label: 'Bogus',
    tone: 'destructive',
    hint: 'Records a fraud audit event and may trigger device-level rate limiting. Use only when the report is clearly false or abusive.',
    template: 'This report was rejected after review. Call 911 immediately if this is a real emergency.',
  },
];

export const TERMINAL_TONE: Record<TerminalCitizenStatus, 'standard' | 'caution' | 'destructive'> = {
  ACTIONED: 'standard',
  REJECTED_DUPLICATE: 'caution',
  REJECTED_INSUFFICIENT: 'caution',
  REJECTED_BOGUS: 'destructive',
};

export function isTerminalStatus(status: string): boolean {
  return status === 'ACTIONED' || status.startsWith('REJECTED_');
}

export function selectedReportIds(cluster: TriageClusterEntry | null, selected: Set<number>): number[] {
  if (!cluster) return [];
  return cluster.reports.filter((report) => selected.has(report.report_id)).map((report) => report.report_id);
}

export function stripHtml(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(/<[^>]*>/g, '');
}

export type TriageActionTab = 'terminal' | 'correct' | 'split' | 'merge' | 'activity';

export interface TriageModalCallbacks {
  onClose: () => void;
  onReloadQueue: () => Promise<void> | void;
  onMessage: (msg: string) => void;
  onError: (err: string) => void;
}

export interface TriageModalState {
  // Tab & selection
  tab: TriageActionTab;
  setTab: (tab: TriageActionTab) => void;
  selected: Set<number>;
  toggleSelected: (reportId: number) => void;

  // Terminal form
  terminalStatus: TerminalCitizenStatus;
  setTerminalStatus: (status: TerminalCitizenStatus) => void;
  explanation: string;
  setExplanation: (s: string) => void;
  internalNote: string;
  setInternalNote: (s: string) => void;

  // Correction form
  correctionReportId: number | null;
  startCorrection: (report: TriageReportEntry) => void;
  correctionReason: string;
  setCorrectionReason: (s: string) => void;

  // Split form
  splitNote: string;
  setSplitNote: (s: string) => void;

  // Merge form
  mergeSourceClusterId: string;
  setMergeSourceClusterId: (s: string) => void;
  mergeNote: string;
  setMergeNote: (s: string) => void;
  pickMergeCandidate: (candidate: MergeCandidateEntry) => void;

  // Side data
  mergeCandidates: MergeCandidateEntry[];
  activity: TriageClusterActivityEntry[];

  // Action handlers
  applyTerminalAction: () => Promise<void>;
  applyCorrection: () => Promise<void>;
  applySplit: () => Promise<void>;
  applyMerge: () => Promise<void>;
  claimCluster: (clusterId: number | null, reason?: string) => Promise<void>;

  // Busy
  busy: boolean;
}

export interface UseTriageModalStateArgs {
  openCluster: TriageClusterEntry | null;
  inspectionMode: 'cluster' | 'singleton';
  callbacks: TriageModalCallbacks;
}

export function useTriageModalState({ openCluster, inspectionMode, callbacks }: UseTriageModalStateArgs): TriageModalState {
  const [tab, setTab] = useState<TriageActionTab>('terminal');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [terminalStatus, setTerminalStatus] = useState<TerminalCitizenStatus>('ACTIONED');
  const [explanation, setExplanation] = useState<string>(TERMINAL_OPTIONS[0].template);
  const [internalNote, setInternalNote] = useState('');
  const [correctionReportId, setCorrectionReportId] = useState<number | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [splitNote, setSplitNote] = useState('');
  const [mergeSourceClusterId, setMergeSourceClusterId] = useState('');
  const [mergeNote, setMergeNote] = useState('');
  const [mergeCandidates, setMergeCandidates] = useState<MergeCandidateEntry[]>([]);
  const [activity, setActivity] = useState<TriageClusterActivityEntry[]>([]);
  const [busy, setBusy] = useState(false);

  // Reset and pre-select on cluster open
  useEffect(() => {
    if (!openCluster) return;
    setTab(inspectionMode === 'singleton' ? 'terminal' : 'terminal');
    setSelected(new Set(openCluster.reports.filter((report) => !isTerminalStatus(report.status)).map((report) => report.report_id)));
    setTerminalStatus('ACTIONED');
    setExplanation(TERMINAL_OPTIONS[0].template);
    setInternalNote('');
    setCorrectionReportId(null);
    setCorrectionReason('');
    setSplitNote('');
    setMergeSourceClusterId('');
    setMergeNote('');
    setActivity([]);
    setMergeCandidates([]);

    if (openCluster.cluster_id) {
      Promise.all([
        fetchTriageClusterActivity(openCluster.cluster_id).catch(() => []),
        fetchMergeCandidates(openCluster.cluster_id).catch(() => []),
      ]).then(([events, candidates]) => {
        setActivity(events.slice(-8).reverse());
        setMergeCandidates(candidates);
      });
    }
  }, [openCluster, inspectionMode]);

  // Singleton mode: only terminal/correct/activity tabs available
  useEffect(() => {
    if (inspectionMode === 'singleton' && (tab === 'split' || tab === 'merge')) {
      setTab('terminal');
    }
  }, [inspectionMode, tab]);

  // Auto-switch to correct tab when a terminal report is selected for correction
  useEffect(() => {
    if (correctionReportId && tab !== 'correct') setTab('correct');
  }, [correctionReportId, tab]);

  const toggleSelected = useCallback((reportId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(reportId)) next.delete(reportId);
      else next.add(reportId);
      return next;
    });
  }, []);

  const pickMergeCandidate = useCallback((candidate: MergeCandidateEntry) => {
    setMergeSourceClusterId(String(candidate.cluster_id));
    setMergeNote(
      `Suggested merge: cluster #${candidate.cluster_id} (${candidate.distance_m.toFixed(0)}m, ${candidate.minutes_apart.toFixed(0)}min ago, ${candidate.member_count} member(s), status=${candidate.status}).`,
    );
  }, []);

  const startCorrection = useCallback((report: TriageReportEntry) => {
    setCorrectionReportId(report.report_id);
    setExplanation(report.status_explanation ?? TERMINAL_OPTIONS[0].template);
    setCorrectionReason('');
    setTab('correct');
  }, []);

  const applyTerminalAction = useCallback(async () => {
    if (!openCluster?.cluster_id) return;
    const reportIds = selectedReportIds(openCluster, selected);
    if (reportIds.length === 0) {
      callbacks.onError('Select at least one non-terminal report.');
      return;
    }
    setBusy(true);
    try {
      await applyTriageTerminalAction(openCluster.cluster_id, {
        report_ids: reportIds,
        status: terminalStatus,
        status_explanation: explanation,
        internal_note: internalNote || undefined,
      });
      callbacks.onMessage(`Applied ${terminalStatus} to ${reportIds.length} report(s).`);
      callbacks.onClose();
      await callbacks.onReloadQueue();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : 'Failed to apply terminal action.');
    } finally {
      setBusy(false);
    }
  }, [openCluster, selected, terminalStatus, explanation, internalNote, callbacks]);

  const applyCorrection = useCallback(async () => {
    if (!correctionReportId) {
      callbacks.onError('Select a terminal report to correct.');
      return;
    }
    if (!explanation.trim() || !correctionReason.trim()) {
      callbacks.onError('Correction requires a reason and replacement explanation.');
      return;
    }
    setBusy(true);
    try {
      await correctTriageReport(correctionReportId, {
        status: terminalStatus,
        status_explanation: explanation,
        correction_reason: correctionReason,
      });
      callbacks.onMessage(`Corrected report ${correctionReportId}.`);
      callbacks.onClose();
      await callbacks.onReloadQueue();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : 'Failed to correct report.');
    } finally {
      setBusy(false);
    }
  }, [correctionReportId, explanation, correctionReason, terminalStatus, callbacks]);

  const applySplit = useCallback(async () => {
    if (!openCluster?.cluster_id) return;
    const reportIds = selectedReportIds(openCluster, selected);
    if (reportIds.length < 2 || !splitNote.trim()) {
      callbacks.onError('Split requires at least two selected reports and an internal note.');
      return;
    }
    setBusy(true);
    try {
      await splitTriageCluster(openCluster.cluster_id, {
        report_ids: reportIds,
        internal_note: splitNote,
      });
      callbacks.onMessage(`Split ${reportIds.length} report(s) into a new cluster.`);
      callbacks.onClose();
      await callbacks.onReloadQueue();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : 'Failed to split cluster.');
    } finally {
      setBusy(false);
    }
  }, [openCluster, selected, splitNote, callbacks]);

  const applyMerge = useCallback(async () => {
    if (!openCluster?.cluster_id) return;
    const sourceId = Number(mergeSourceClusterId);
    if (!Number.isInteger(sourceId) || sourceId <= 0 || !mergeNote.trim()) {
      callbacks.onError('Merge requires a source cluster id and internal note.');
      return;
    }
    setBusy(true);
    try {
      await mergeTriageClusters(openCluster.cluster_id, {
        source_cluster_id: sourceId,
        internal_note: mergeNote,
      });
      callbacks.onMessage(`Merged cluster ${sourceId} into cluster ${openCluster.cluster_id}.`);
      callbacks.onClose();
      await callbacks.onReloadQueue();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : 'Failed to merge clusters.');
    } finally {
      setBusy(false);
    }
  }, [openCluster, mergeSourceClusterId, mergeNote, callbacks]);

  const claimCluster = useCallback(
    async (clusterId: number | null, reason?: string) => {
      if (!clusterId) return;
      setBusy(true);
      try {
        await claimTriageCluster(clusterId, reason);
        const msg = reason
          ? `Snatched cluster ${clusterId} from ${openCluster?.assigned_to ?? 'previous owner'}.`
          : openCluster?.assigned_to
            ? `Cluster ${clusterId} claim refreshed.`
            : `Cluster ${clusterId} claimed.`;
        callbacks.onMessage(msg);
        await callbacks.onReloadQueue();
      } catch (err) {
        callbacks.onError(err instanceof Error ? err.message : 'Failed to claim cluster.');
      } finally {
        setBusy(false);
      }
    },
    [callbacks, openCluster],
  );

  return {
    tab,
    setTab,
    selected,
    toggleSelected,
    terminalStatus,
    setTerminalStatus,
    explanation,
    setExplanation,
    internalNote,
    setInternalNote,
    correctionReportId,
    startCorrection,
    correctionReason,
    setCorrectionReason,
    splitNote,
    setSplitNote,
    mergeSourceClusterId,
    setMergeSourceClusterId,
    mergeNote,
    setMergeNote,
    pickMergeCandidate,
    mergeCandidates,
    activity,
    applyTerminalAction,
    applyCorrection,
    applySplit,
    applyMerge,
    claimCluster,
    busy,
  };
}
