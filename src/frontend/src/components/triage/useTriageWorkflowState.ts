'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  applyReportStatusUpdate,
  applyTriageTerminalAction,
  claimTriageCluster,
  fetchMergeCandidates,
  fetchTriageClusterActivity,
  mergeTriageClusters,
  splitTriageCluster,
  type MergeCandidateEntry,
  type StatusUpdateStage,
  type TerminalCitizenStatus,
  type TriageClusterActivityEntry,
  type TriageClusterEntry,
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

export type TriageActionTab = 'terminal' | 'split' | 'merge' | 'activity' | 'update';

export interface TriageWorkflowCallbacks {
  onWorkflowComplete: () => void;
  onReloadQueue: () => Promise<void> | void;
  onMessage: (msg: string) => void;
  onError: (err: string) => void;
}

export interface TriageWorkflowState {
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

  // Split form
  splitNote: string;
  setSplitNote: (s: string) => void;

  // Merge form
  mergeSourceClusterId: string;
  setMergeSourceClusterId: (s: string) => void;
  mergeNote: string;
  setMergeNote: (s: string) => void;
  pickMergeCandidate: (candidate: MergeCandidateEntry) => void;

  // Status-update (Send Update) form
  updateStage: StatusUpdateStage;
  setUpdateStage: (s: StatusUpdateStage) => void;
  updateStationName: string;
  setUpdateStationName: (s: string) => void;
  updateJurisdiction: string;
  setUpdateJurisdiction: (s: string) => void;
  updateEta: string;
  setUpdateEta: (s: string) => void;
  updateArrivedAt: string;
  setUpdateArrivedAt: (s: string) => void;
  updateOutcomeSummary: string;
  setUpdateOutcomeSummary: (s: string) => void;
  updateDuplicateOf: string;
  setUpdateDuplicateOf: (s: string) => void;
  updateReason: string;
  setUpdateReason: (s: string) => void;

  // Action handlers
  mergeCandidates: MergeCandidateEntry[];
  activity: TriageClusterActivityEntry[];

  // Action handlers
  applyTerminalAction: () => Promise<void>;
  applySplit: () => Promise<void>;
  applyMerge: () => Promise<void>;
  applyStatusUpdate: () => Promise<void>;
  claimCluster: (clusterId: number | null, reason?: string) => Promise<void>;

  // Busy
  busy: boolean;
}

export interface UseTriageWorkflowStateArgs {
  cluster: TriageClusterEntry | null;
  inspectionMode: 'cluster' | 'singleton';
  callbacks: TriageWorkflowCallbacks;
}

export function useTriageWorkflowState({ cluster, inspectionMode, callbacks }: UseTriageWorkflowStateArgs): TriageWorkflowState {
  const [tab, setTab] = useState<TriageActionTab>('terminal');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [terminalStatus, setTerminalStatus] = useState<TerminalCitizenStatus>('ACTIONED');
  const [explanation, setExplanation] = useState<string>(TERMINAL_OPTIONS[0].template);
  const [internalNote, setInternalNote] = useState('');
  const [splitNote, setSplitNote] = useState('');
  const [mergeSourceClusterId, setMergeSourceClusterId] = useState('');
  const [mergeNote, setMergeNote] = useState('');
  const [mergeCandidates, setMergeCandidates] = useState<MergeCandidateEntry[]>([]);
  const [activity, setActivity] = useState<TriageClusterActivityEntry[]>([]);
  const [busy, setBusy] = useState(false);

  // Status-update (Send Update) form state
  const [updateStage, setUpdateStage] = useState<StatusUpdateStage>('UNDER_REVIEW');
  const [updateStationName, setUpdateStationName] = useState('');
  const [updateJurisdiction, setUpdateJurisdiction] = useState('');
  const [updateEta, setUpdateEta] = useState('');
  const [updateArrivedAt, setUpdateArrivedAt] = useState('');
  const [updateOutcomeSummary, setUpdateOutcomeSummary] = useState('');
  const [updateDuplicateOf, setUpdateDuplicateOf] = useState('');
  const [updateReason, setUpdateReason] = useState('');

  // Reset and pre-select on cluster open
  useEffect(() => {
    if (!cluster) return;
    setTab(inspectionMode === 'singleton' ? 'terminal' : 'terminal');
    setSelected(new Set(cluster.reports.filter((report) => !isTerminalStatus(report.status)).map((report) => report.report_id)));
    setTerminalStatus('ACTIONED');
    setExplanation(TERMINAL_OPTIONS[0].template);
    setInternalNote('');
    setSplitNote('');
    setMergeSourceClusterId('');
    setMergeNote('');
    setActivity([]);
    setMergeCandidates([]);
    setUpdateStage('UNDER_REVIEW');
    setUpdateStationName(cluster.station?.name ?? '');
    setUpdateJurisdiction(cluster.province_name ?? '');
    setUpdateEta('');
    setUpdateArrivedAt('');
    setUpdateOutcomeSummary('');
    setUpdateDuplicateOf('');
    setUpdateReason('');

    if (cluster.cluster_id) {
      Promise.all([
        fetchTriageClusterActivity(cluster.cluster_id).catch(() => []),
        fetchMergeCandidates(cluster.cluster_id).catch(() => []),
      ]).then(([events, candidates]) => {
        setActivity(events.slice(-8).reverse());
        setMergeCandidates(candidates);
      });
    }
  }, [cluster, inspectionMode]);

  // Singleton mode hides cluster-only split and merge actions.
  useEffect(() => {
    if (inspectionMode === 'singleton' && (tab === 'split' || tab === 'merge')) {
      setTab('terminal');
    }
  }, [inspectionMode, tab]);

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

  const applyTerminalAction = useCallback(async () => {
    if (!cluster?.cluster_id) return;
    const reportIds = selectedReportIds(cluster, selected);
    if (reportIds.length === 0) {
      callbacks.onError('Select at least one non-terminal report.');
      return;
    }
    setBusy(true);
    try {
      await applyTriageTerminalAction(cluster.cluster_id, {
        report_ids: reportIds,
        status: terminalStatus,
        status_explanation: explanation,
        internal_note: internalNote || undefined,
      });
      callbacks.onMessage(`Applied ${terminalStatus} to ${reportIds.length} report(s).`);
      callbacks.onWorkflowComplete();
      await callbacks.onReloadQueue();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : 'Failed to apply terminal action.');
    } finally {
      setBusy(false);
    }
  }, [cluster, selected, terminalStatus, explanation, internalNote, callbacks]);

  const applySplit = useCallback(async () => {
    if (!cluster?.cluster_id) return;
    const reportIds = selectedReportIds(cluster, selected);
    if (reportIds.length < 2 || !splitNote.trim()) {
      callbacks.onError('Split requires at least two selected reports and an internal note.');
      return;
    }
    setBusy(true);
    try {
      await splitTriageCluster(cluster.cluster_id, {
        report_ids: reportIds,
        internal_note: splitNote,
      });
      callbacks.onMessage(`Split ${reportIds.length} report(s) into a new cluster.`);
      callbacks.onWorkflowComplete();
      await callbacks.onReloadQueue();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : 'Failed to split cluster.');
    } finally {
      setBusy(false);
    }
  }, [cluster, selected, splitNote, callbacks]);

  const applyMerge = useCallback(async () => {
    if (!cluster?.cluster_id) return;
    const sourceId = Number(mergeSourceClusterId);
    if (!Number.isInteger(sourceId) || sourceId <= 0 || !mergeNote.trim()) {
      callbacks.onError('Merge requires a source cluster id and internal note.');
      return;
    }
    setBusy(true);
    try {
      await mergeTriageClusters(cluster.cluster_id, {
        source_cluster_id: sourceId,
        internal_note: mergeNote,
      });
      callbacks.onMessage(`Merged cluster ${sourceId} into cluster ${cluster.cluster_id}.`);
      callbacks.onWorkflowComplete();
      await callbacks.onReloadQueue();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : 'Failed to merge clusters.');
    } finally {
      setBusy(false);
    }
  }, [cluster, mergeSourceClusterId, mergeNote, callbacks]);

  const applyStatusUpdate = useCallback(async () => {
    if (!cluster) return;
    const reportId = cluster.anchor_report_id ?? cluster.reports[0]?.report_id;
    if (!reportId) {
      callbacks.onError('No report available to update.');
      return;
    }
    const metadata: Record<string, unknown> = {};
    switch (updateStage) {
      case 'HELP_DISPATCHED':
        if (!updateStationName.trim() || !updateJurisdiction.trim()) {
          callbacks.onError('Help Dispatched requires station name and jurisdiction.');
          return;
        }
        metadata.station_name = updateStationName.trim();
        metadata.jurisdiction = updateJurisdiction.trim();
        if (updateEta.trim()) metadata.eta = updateEta.trim();
        break;
      case 'ON_SCENE':
        if (!updateArrivedAt.trim()) {
          callbacks.onError('On Scene requires an arrival time.');
          return;
        }
        metadata.arrived_at = updateArrivedAt.trim();
        break;
      case 'RESOLVED':
        if (!updateOutcomeSummary.trim()) {
          callbacks.onError('Resolved requires an outcome summary.');
          return;
        }
        metadata.outcome_summary = updateOutcomeSummary.trim();
        break;
      case 'CLOSED_DUPLICATE': {
        const dupId = Number(updateDuplicateOf);
        if (!Number.isInteger(dupId) || dupId <= 0) {
          callbacks.onError('Duplicate-of report id must be a positive integer.');
          return;
        }
        metadata.duplicate_of_report_id = dupId;
        break;
      }
      case 'CLOSED_INSUFFICIENT':
        if (!updateReason.trim()) {
          callbacks.onError('Insufficient closure requires a reason.');
          return;
        }
        metadata.reason = updateReason.trim();
        break;
      default:
        break;
    }
    setBusy(true);
    try {
      await applyReportStatusUpdate(reportId, {
        stage: updateStage,
        metadata: Object.keys(metadata).length ? metadata : null,
      });
      callbacks.onMessage(`Sent status update (${updateStage}) to report #${reportId}.`);
      callbacks.onWorkflowComplete();
      await callbacks.onReloadQueue();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : 'Failed to send status update.');
    } finally {
      setBusy(false);
    }
  }, [cluster, updateStage, updateStationName, updateJurisdiction, updateEta, updateArrivedAt, updateOutcomeSummary, updateDuplicateOf, updateReason, callbacks]);

  const claimCluster = useCallback(
    async (clusterId: number | null, reason?: string) => {
      if (!clusterId) return;
      setBusy(true);
      try {
        await claimTriageCluster(clusterId, reason);
        const msg = reason
          ? `Snatched cluster ${clusterId} from ${cluster?.assigned_to ?? 'previous owner'}.`
          : cluster?.assigned_to
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
    [callbacks, cluster],
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
    splitNote,
    setSplitNote,
    mergeSourceClusterId,
    setMergeSourceClusterId,
    mergeNote,
    setMergeNote,
    pickMergeCandidate,
    mergeCandidates,
    activity,
    updateStage,
    setUpdateStage,
    updateStationName,
    setUpdateStationName,
    updateJurisdiction,
    setUpdateJurisdiction,
    updateEta,
    setUpdateEta,
    updateArrivedAt,
    setUpdateArrivedAt,
    updateOutcomeSummary,
    setUpdateOutcomeSummary,
    updateDuplicateOf,
    setUpdateDuplicateOf,
    updateReason,
    setUpdateReason,
    applyTerminalAction,
    applySplit,
    applyMerge,
    applyStatusUpdate,
    claimCluster,
    busy,
  };
}
