'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle, ClipboardList, Clock, Filter, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ClusterInspectionMap } from '@/components/ClusterInspectionMap';
import {
  applyTriageTerminalAction,
  claimTriageCluster,
  correctTriageReport,
  fetchMergeCandidates,
  fetchTriageClusterActivity,
  fetchTriageQueue,
  mergeTriageClusters,
  splitTriageCluster,
  type MergeCandidateEntry,
  type TerminalCitizenStatus,
  type TriageClusterActivityEntry,
  type TriageClusterEntry,
  type TriageQueueResponse,
  type TriageReportEntry,
} from '@/lib/api';

const FILTERS = [
  { key: 'needs_help', label: 'Needs Help' },
  { key: 'someone_else_needs_help', label: 'Other In Danger' },
  { key: 'aging', label: 'Aging' },
  { key: 'timeout_risk', label: 'Timeout Risk' },
  { key: 'unreviewed', label: 'Unreviewed' },
] as const;

const TERMINAL_OPTIONS: { value: TerminalCitizenStatus; label: string; template: string }[] = [
  {
    value: 'ACTIONED',
    label: 'Actioned',
    template: 'BFP has received and actioned this civilian signal. Call 911 for urgent updates.',
  },
  {
    value: 'REJECTED_DUPLICATE',
    label: 'Duplicate',
    template: 'This appears to duplicate another civilian signal already under review or action.',
  },
  {
    value: 'REJECTED_INSUFFICIENT',
    label: 'Insufficient',
    template: 'This report could not be verified from the available details. Submit a new report if the emergency continues.',
  },
  {
    value: 'REJECTED_BOGUS',
    label: 'Bogus',
    template: 'This report was rejected after review. Call 911 immediately if this is a real emergency.',
  },
];

function isTerminal(status: string) {
  return status === 'ACTIONED' || status.startsWith('REJECTED_');
}

function statusTone(severity: string) {
  if (severity === 'HIGH') return 'bg-red-100 text-red-700 border-red-200';
  if (severity === 'MEDIUM') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function selectedReportIds(cluster: TriageClusterEntry | null, selected: Set<number>) {
  if (!cluster) return [];
  return cluster.reports.filter((report) => selected.has(report.report_id)).map((report) => report.report_id);
}

type InspectionMode = 'cluster' | 'singleton';

export default function TriagePage() {
  const { user, loading: authLoading } = useAuth();
  const role = (user as { role?: string })?.role ?? null;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [queue, setQueue] = useState<TriageQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openCluster, setOpenCluster] = useState<TriageClusterEntry | null>(null);
  const [inspectionMode, setInspectionMode] = useState<InspectionMode>('cluster');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [terminalStatus, setTerminalStatus] = useState<TerminalCitizenStatus>('ACTIONED');
  const [explanation, setExplanation] = useState(TERMINAL_OPTIONS[0].template);
  const [internalNote, setInternalNote] = useState('');
  const [correctionReportId, setCorrectionReportId] = useState<number | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [splitNote, setSplitNote] = useState('');
  const [mergeSourceClusterId, setMergeSourceClusterId] = useState('');
  const [mergeNote, setMergeNote] = useState('');
  const [mergeCandidates, setMergeCandidates] = useState<MergeCandidateEntry[]>([]);
  const [activity, setActivity] = useState<TriageClusterActivityEntry[]>([]);
  const [lastPolled, setLastPolled] = useState<Date | null>(null);

  const canAccess =
    role === 'ENCODER' ||
    role === 'NATIONAL_VALIDATOR' ||
    role === 'REGIONAL_ENCODER' ||
    role === 'NATIONAL_VALIDATOR' ||
    role === 'SYSTEM_ADMIN';

  const filterParams = useMemo(() => {
    const params: Record<string, string | boolean> = {};
    FILTERS.forEach((filter) => {
      if (searchParams.get(filter.key) === 'true') params[filter.key] = true;
    });
    const confidence = searchParams.get('confidence');
    if (confidence) params.confidence = confidence;
    return params;
  }, [searchParams]);

  const loadQueue = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchTriageQueue(filterParams);
      setQueue(data);
      setLastPolled(new Date());
      if (openCluster) {
        const refreshed = data.clusters.find((cluster) => cluster.cluster_id === openCluster.cluster_id);
        if (refreshed) setOpenCluster(refreshed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load triage queue.');
    } finally {
      setLoading(false);
    }
  }, [filterParams, openCluster]);

  const loadQueueRef = useRef(loadQueue);
  loadQueueRef.current = loadQueue;

  useEffect(() => {
    if (!authLoading && !canAccess) router.push('/dashboard');
  }, [authLoading, canAccess, router]);

  useEffect(() => {
    if (!canAccess || authLoading) return;
    setLoading(true);
    void loadQueue();
  }, [authLoading, canAccess, loadQueue]);

  useEffect(() => {
    if (!canAccess || authLoading) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadQueueRef.current();
    }, 30000);
    return () => window.clearInterval(interval);
  }, [authLoading, canAccess]);

  // Keyboard navigation — safe when focus is not in input/textarea/select
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!openCluster) return;
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (e.key === 'Escape') { setOpenCluster(null); return; }
      if (e.key === 'r' || e.key === 'R') { void loadQueue(); return; }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [openCluster, loadQueue]);

  function toggleFilter(key: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (next.get(key) === 'true') next.delete(key);
    else next.set(key, 'true');
    router.replace(`/incidents/triage${next.toString() ? `?${next.toString()}` : ''}`);
  }

  async function openInspection(cluster: TriageClusterEntry, mode: InspectionMode) {
    setOpenCluster(cluster);
    setInspectionMode(mode);
    setSelected(new Set(cluster.reports.filter((report) => !isTerminal(report.status)).map((report) => report.report_id)));
    setTerminalStatus('ACTIONED');
    setExplanation(TERMINAL_OPTIONS[0].template);
    setInternalNote('');
    setCorrectionReportId(null);
    setCorrectionReason('');
    setSplitNote('');
    setMergeSourceClusterId('');
    setMergeNote('');
    setActivity([]);
    if (cluster.cluster_id) {
      const [events, candidates] = await Promise.all([
        fetchTriageClusterActivity(cluster.cluster_id).catch(() => []),
        fetchMergeCandidates(cluster.cluster_id).catch(() => []),
      ]);
      setActivity(events.slice(-8).reverse());
      setMergeCandidates(candidates);
    }
  }

  async function claimCluster(clusterId: number | null) {
    if (!clusterId) return;
    setBusy(true);
    setError(null);
    try {
      await claimTriageCluster(clusterId);
      setMessage(`Cluster ${clusterId} claimed.`);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim cluster.');
    } finally {
      setBusy(false);
    }
  }

  async function applyTerminalAction() {
    if (!openCluster?.cluster_id) return;
    const reportIds = selectedReportIds(openCluster, selected);
    if (reportIds.length === 0) {
      setError('Select at least one non-terminal report.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await applyTriageTerminalAction(openCluster.cluster_id, {
        report_ids: reportIds,
        status: terminalStatus,
        status_explanation: explanation,
        internal_note: internalNote || undefined,
      });
      setMessage(`Applied ${terminalStatus} to ${reportIds.length} report(s).`);
      setOpenCluster(null);
      setSelected(new Set());
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply terminal action.');
    } finally {
      setBusy(false);
    }
  }

  async function applyCorrection() {
    if (!correctionReportId) {
      setError('Select a terminal report to correct.');
      return;
    }
    if (!explanation.trim() || !correctionReason.trim()) {
      setError('Correction requires a reason and replacement explanation.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await correctTriageReport(correctionReportId, {
        status: terminalStatus,
        status_explanation: explanation,
        correction_reason: correctionReason,
      });
      setMessage(`Corrected report ${correctionReportId}.`);
      setOpenCluster(null);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to correct report.');
    } finally {
      setBusy(false);
    }
  }

  async function applySplit() {
    if (!openCluster?.cluster_id) return;
    const reportIds = selectedReportIds(openCluster, selected);
    if (reportIds.length < 2 || !splitNote.trim()) {
      setError('Split requires at least two selected reports and an internal note.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await splitTriageCluster(openCluster.cluster_id, {
        report_ids: reportIds,
        internal_note: splitNote,
      });
      setMessage(`Split ${reportIds.length} report(s) into a new cluster.`);
      setOpenCluster(null);
      setSelected(new Set());
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to split cluster.');
    } finally {
      setBusy(false);
    }
  }

  async function applyMerge() {
    if (!openCluster?.cluster_id) return;
    const sourceId = Number(mergeSourceClusterId);
    if (!Number.isInteger(sourceId) || sourceId <= 0 || !mergeNote.trim()) {
      setError('Merge requires a source cluster id and internal note.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await mergeTriageClusters(openCluster.cluster_id, {
        source_cluster_id: sourceId,
        internal_note: mergeNote,
      });
      setMessage(`Merged cluster ${sourceId} into cluster ${openCluster.cluster_id}.`);
      setOpenCluster(null);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to merge clusters.');
    } finally {
      setBusy(false);
    }
  }

  // Split queue into clusters and singletons
  const clusters = useMemo(() => {
    if (!queue) return [];
    return queue.clusters.filter(item => item.cluster_id !== null && item.cluster_id !== undefined);
  }, [queue]);

  const singletons = useMemo(() => {
    if (!queue) return [];
    return queue.clusters.filter(item => item.cluster_id === null || item.cluster_id === undefined);
  }, [queue]);

  // Sort clusters: life_safety_risk DESC → timeout_risk DESC → severity DESC → member_count DESC → age DESC
  const sortedClusters = useMemo(() => {
    return [...clusters].sort((a, b) => {
      if (a.has_life_safety !== b.has_life_safety) return a.has_life_safety ? -1 : 1;
      if (a.is_timeout_risk !== b.is_timeout_risk) return a.is_timeout_risk ? -1 : 1;
      const severityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      const aSev = severityOrder[a.severity] ?? 0;
      const bSev = severityOrder[b.severity] ?? 0;
      if (aSev !== bSev) return bSev - aSev;
      if (a.member_count !== b.member_count) return b.member_count - a.member_count;
      return new Date(a.oldest_report_at).getTime() - new Date(b.oldest_report_at).getTime();
    });
  }, [clusters]);

  // Sort singletons: aging DESC → timeout_risk DESC → severity DESC → age DESC
  const sortedSingletons = useMemo(() => {
    return [...singletons].sort((a, b) => {
      if (a.is_aging !== b.is_aging) return a.is_aging ? -1 : 1;
      if (a.is_timeout_risk !== b.is_timeout_risk) return a.is_timeout_risk ? -1 : 1;
      const severityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      const aSev = severityOrder[a.severity] ?? 0;
      const bSev = severityOrder[b.severity] ?? 0;
      if (aSev !== bSev) return bSev - aSev;
      return new Date(a.oldest_report_at).getTime() - new Date(b.oldest_report_at).getTime();
    });
  }, [singletons]);

  // Filter singletons by Unreviewed chip
  const unreviewedOnly = searchParams.get('unreviewed') === 'true';
  const filteredSingletons = useMemo(() => {
    if (!unreviewedOnly) return sortedSingletons;
    return sortedSingletons.filter(item => item.reports.some(r => r.status === 'PENDING'));
  }, [sortedSingletons, unreviewedOnly]);

  if (authLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-slate-500" /></div>;
  }
  if (!canAccess) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Civilian Triage Queue</h1>
          <p className="text-sm text-slate-600">Public reports stay as signal records; terminal actions update tracking without creating official incidents.</p>
        </div>
        <button onClick={() => void loadQueue()} className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {(error || message) && (
        <div className={`rounded-md border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
          {error ?? message}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-slate-500" />
        {FILTERS.map((filter) => {
          const active = searchParams.get(filter.key) === 'true';
          return (
            <button
              key={filter.key}
              onClick={() => toggleFilter(filter.key)}
              className={`rounded-md border px-3 py-1.5 text-sm ${active ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-300 bg-white text-slate-700'}`}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {/* Metrics bar */}
      <div className="flex items-center gap-6 text-sm text-gray-600 py-2 border-b">
        <span>Clusters: <strong>{sortedClusters.length}</strong></span>
        <span>Individual reports: <strong>{filteredSingletons.length}</strong></span>
        {lastPolled && <span>Polled {lastPolled.toLocaleTimeString()}</span>}
      </div>

      {/* Clusters table */}
      <div className="rounded-md border border-slate-200 bg-white" data-testid="clusters-table">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2 font-medium text-slate-900">
            <ClipboardList className="h-4 w-4 text-red-700" />
            Clusters
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-slate-500" /></div>
        ) : sortedClusters.length === 0 ? (
          <div className="p-12 text-center text-slate-600">No clusters matching current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">Life Safety</th>
                  <th className="px-3 py-2">Timeout Risk</th>
                  <th className="px-3 py-2">Assigned To</th>
                  <th className="px-3 py-2">Members</th>
                  <th className="px-3 py-2">Avg Trust</th>
                  <th className="px-3 py-2">Station</th>
                  <th className="px-3 py-2">Age</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {sortedClusters.map((cluster) => (
                  <tr key={cluster.cluster_id}>
                    <td className="px-3 py-3">{cluster.cluster_id}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-md border px-2 py-1 text-xs font-medium ${statusTone(cluster.severity)}`}>{cluster.severity}</span>
                    </td>
                    <td className="px-3 py-3">
                      {cluster.has_life_safety && <AlertTriangle className="h-4 w-4 text-red-700" />}
                    </td>
                    <td className="px-3 py-3">
                      {cluster.is_danger && <span className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-100 px-2 py-1 text-xs font-bold text-red-800 animate-pulse"><AlertTriangle className="h-3 w-3" />2h+</span>}
                      {!cluster.is_danger && cluster.is_timeout_risk && <Clock className="h-4 w-4 text-amber-700" />}
                    </td>
                    <td className="px-3 py-3">{cluster.assigned_to ?? '—'}</td>
                    <td className="px-3 py-3">{cluster.member_count}{cluster.related_count > 0 ? ` (+${cluster.related_count} related)` : ''}</td>
                    <td className="px-3 py-3">{Math.round(cluster.avg_trust)}</td>
                    <td className="px-3 py-3">{cluster.station.name ?? 'N/A'}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{new Date(cluster.oldest_report_at).toLocaleString()}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2">
                        {cluster.assigned_to === null && role === 'NATIONAL_VALIDATOR' && (
                          <button disabled={busy} onClick={() => void claimCluster(cluster.cluster_id)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                            <ShieldCheck className="h-3 w-3" />
                            Claim
                          </button>
                        )}
                        <button onClick={() => void openInspection(cluster, 'cluster')} className="rounded-md bg-red-700 px-2 py-1 text-xs font-medium text-white hover:bg-red-800">
                          Inspect
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Individual Reports table */}
      <div className="rounded-md border border-slate-200 bg-white" data-testid="singletons-table">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2 font-medium text-slate-900">
            <ClipboardList className="h-4 w-4 text-red-700" />
            Individual Reports
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-slate-500" /></div>
        ) : filteredSingletons.length === 0 ? (
          <div className="p-12 text-center text-slate-600">No individual reports matching current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">Life Safety</th>
                  <th className="px-3 py-2">Timeout Risk</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Trust</th>
                  <th className="px-3 py-2">Station</th>
                  <th className="px-3 py-2">Age</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredSingletons.map((singleton) => {
                  const report = singleton.reports?.[0];
                  if (!report) return null;
                  const terminalStatus = isTerminal(report.status);
                  return (
                    <tr key={singleton.anchor_report_id ?? report.report_id}>
                      <td className="px-3 py-3">{report.report_id}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-md border px-2 py-1 text-xs font-medium ${statusTone(singleton.severity)}`}>{singleton.severity}</span>
                      </td>
                      <td className="px-3 py-3">
                        {singleton.has_life_safety && <AlertTriangle className="h-4 w-4 text-red-700" />}
                      </td>
                      <td className="px-3 py-3">
                        {singleton.is_danger && <span className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-100 px-2 py-1 text-xs font-bold text-red-800 animate-pulse"><AlertTriangle className="h-3 w-3" />2h+</span>}
                        {!singleton.is_danger && singleton.is_timeout_risk && <Clock className="h-4 w-4 text-amber-700" />}
                      </td>
                      <td className="px-3 py-3 text-xs">{report.status}</td>
                      <td className="px-3 py-3 text-xs">{report.category ?? 'N/A'} / {report.sub_category ?? 'none'}</td>
                      <td className="px-3 py-3">{report.trust_breakdown.score}</td>
                      <td className="px-3 py-3">{singleton.station.name ?? 'N/A'}</td>
                      <td className="px-3 py-3 text-xs text-slate-500">{new Date(singleton.oldest_report_at).toLocaleString()}</td>
                      <td className="px-3 py-3">
                        {terminalStatus ? (
                          <button onClick={() => void openInspection(singleton, 'singleton')} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
                            Correct
                          </button>
                        ) : (
                          <button onClick={() => void openInspection(singleton, 'singleton')} className="rounded-md bg-red-700 px-2 py-1 text-xs font-medium text-white hover:bg-red-800">
                            Inspect
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openCluster && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpenCluster(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-md bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{openCluster.cluster_id ? `Cluster ${openCluster.cluster_id}` : 'Singleton report'}</h2>
                <p className="text-sm text-slate-600">Select non-terminal rows, preview the civilian-visible explanation, then apply a terminal action.</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">Esc close · R refresh</span>
                <button onClick={() => setOpenCluster(null)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100"><XCircle className="h-5 w-5" /></button>
              </div>
            </div>

            <div className="grid gap-5 p-5 lg:grid-cols-[1fr_340px]">
              <div className="overflow-hidden rounded-md border border-slate-200">
                {inspectionMode === 'cluster' && (
                  <ClusterInspectionMap
                    reports={openCluster.reports}
                    suggestedReportIds={mergeCandidates.map((c) => c.anchor_report_id)}
                  />
                )}
                {inspectionMode === 'singleton' && (
                  <div className="bg-slate-50 px-3 py-2 text-sm text-slate-700 border-b border-slate-200">
                    Location: {openCluster.reports[0]?.latitude.toFixed(4)}, {openCluster.reports[0]?.longitude.toFixed(4)}
                  </div>
                )}
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-medium uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Select</th>
                      <th className="px-3 py-2">Report</th>
                      <th className="px-3 py-2">Signals</th>
                      <th className="px-3 py-2">Trust</th>
                      <th className="px-3 py-2">Station</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {openCluster.reports.map((report: TriageReportEntry) => {
                      const terminal = isTerminal(report.status);
                      return (
                        <tr key={report.report_id} className={report.trust_breakdown.gps_mismatch || report.trust_breakdown.duplicate_device_count_30m > 0 ? 'bg-amber-50/60' : undefined}>
                          <td className="px-3 py-3 align-top">
                            <input
                              type="checkbox"
                              disabled={terminal}
                              checked={selected.has(report.report_id)}
                              onChange={() => {
                                const next = new Set(selected);
                                if (next.has(report.report_id)) next.delete(report.report_id);
                                else next.add(report.report_id);
                                setSelected(next);
                              }}
                              className="h-4 w-4 rounded border-slate-300 text-red-700 focus:ring-red-700 disabled:opacity-40"
                            />
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="font-medium text-slate-950">#{report.report_id}</div>
                            <div className="text-xs text-slate-500">{report.status}</div>
                            <div className="mt-1 text-xs text-slate-500">{new Date(report.created_at).toLocaleString()}</div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div>{report.category ?? 'Unspecified'} / {report.sub_category ?? 'none'}</div>
                            <div className="text-xs text-slate-500">{report.reporting_context} · {report.safety_status}</div>
                            <div className="mt-1 text-xs text-amber-700">
                              {report.trust_breakdown.gps_mismatch ? 'GPS mismatch ' : ''}
                              {report.trust_breakdown.duplicate_device_count_30m > 0 ? `Duplicate-device count ${report.trust_breakdown.duplicate_device_count_30m}` : ''}
                            </div>
                          </td>
                          <td className="px-3 py-3 align-top">{report.trust_breakdown.score}</td>
                          <td className="px-3 py-3 align-top">
                            <div>{report.station.name ?? 'Unavailable'}</div>
                            <div className="text-xs text-slate-500">{report.station.phone_available ? 'Phone available' : 'No phone listed'}</div>
                            {terminal && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCorrectionReportId(report.report_id);
                                  setExplanation(report.status_explanation ?? TERMINAL_OPTIONS[0].template);
                                }}
                                className="mt-2 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                              >
                                Correct
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="space-y-4">
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="mb-2 text-sm font-medium text-slate-900">Terminal Action</div>
                  <select
                    value={terminalStatus}
                    onChange={(event) => {
                      const next = event.target.value as TerminalCitizenStatus;
                      setTerminalStatus(next);
                      setExplanation(TERMINAL_OPTIONS.find((option) => option.value === next)?.template ?? '');
                    }}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    {TERMINAL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} rows={5} className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} rows={3} placeholder="Internal note, optional" className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                    Preview for {selectedReportIds(openCluster, selected).length} report(s): {explanation || 'No explanation entered.'}
                  </div>
                  <button
                    disabled={busy || !openCluster.cluster_id || !explanation.trim()}
                    onClick={() => void applyTerminalAction()}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                    Apply
                  </button>
                  {!openCluster.cluster_id && <p className="mt-2 text-xs text-slate-500">Claimable terminal actions require a durable cluster. Singleton suggestions can be clustered by backend workflow before action.</p>}
                </div>

                <div className="rounded-md border border-slate-200 p-3">
                  <div className="mb-2 text-sm font-medium text-slate-900">Correction</div>
                  <p className="text-xs text-slate-500">
                    Select Correct on a terminal row, then provide the replacement civilian-visible explanation and audit reason.
                  </p>
                  <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {correctionReportId ? `Report #${correctionReportId}` : 'No terminal report selected'}
                  </div>
                  <textarea
                    value={correctionReason}
                    onChange={(event) => setCorrectionReason(event.target.value)}
                    rows={3}
                    placeholder="Correction audit reason"
                    className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    disabled={busy || !correctionReportId || !explanation.trim() || !correctionReason.trim()}
                    onClick={() => void applyCorrection()}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Apply Correction
                  </button>
                </div>

                {inspectionMode === 'cluster' && (
                  <>
                    <div className="rounded-md border border-slate-200 p-3">
                      <div className="mb-2 text-sm font-medium text-slate-900">Split Cluster</div>
                      <p className="text-xs text-slate-500">
                        Moves the selected rows into a new explicit cluster. Requires at least two selected reports.
                      </p>
                      <textarea
                        value={splitNote}
                        onChange={(event) => setSplitNote(event.target.value)}
                        rows={3}
                        placeholder="Split internal note"
                        className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      />
                      <button
                        disabled={busy || !openCluster.cluster_id || selectedReportIds(openCluster, selected).length < 2 || !splitNote.trim()}
                        onClick={() => void applySplit()}
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Split Selected
                      </button>
                    </div>

                    <div className="rounded-md border border-slate-200 p-3">
                      <div className="mb-2 text-sm font-medium text-slate-900">Merge Cluster</div>
                      <p className="text-xs text-slate-500 mb-3">
                        Nearby clusters within 250m and 1 hour. Select a candidate or enter a cluster id manually.
                      </p>
                      {mergeCandidates.length === 0 ? (
                        <p className="text-xs text-slate-400 italic mb-3">No nearby clusters found.</p>
                      ) : (
                        <div className="mb-3 space-y-2 max-h-40 overflow-y-auto">
                          {mergeCandidates.map((c) => (
                            <div key={c.cluster_id} className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                              <div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMergeSourceClusterId(String(c.cluster_id));
                                    setMergeNote(`Suggested merge: cluster #${c.cluster_id} (${c.distance_m.toFixed(0)}m, ${c.minutes_apart.toFixed(0)}min ago, ${c.member_count} member(s), status=${c.status}).`);
                                  }}
                                  className="font-medium text-blue-700 hover:underline"
                                >
                                  Cluster #{c.cluster_id}
                                </button>
                                <span className="ml-2 text-slate-500">anchor #{c.anchor_report_id} · {c.distance_m.toFixed(0)}m · {c.minutes_apart.toFixed(0)}min · {c.member_count} members · {c.status}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <input
                        value={mergeSourceClusterId}
                        onChange={(event) => setMergeSourceClusterId(event.target.value)}
                        inputMode="numeric"
                        placeholder="Source cluster id"
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      />
                      <textarea
                        value={mergeNote}
                        onChange={(event) => setMergeNote(event.target.value)}
                        rows={3}
                        placeholder="Merge internal note"
                        className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      />
                      <button
                        disabled={busy || !openCluster.cluster_id || !mergeSourceClusterId.trim() || !mergeNote.trim()}
                        onClick={() => void applyMerge()}
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Merge Source Into This Cluster
                      </button>
                    </div>
                  </>
                )}

                <div className="rounded-md border border-slate-200 p-3">
                  <div className="mb-2 text-sm font-medium text-slate-900">Activity</div>
                  {activity.length === 0 ? (
                    <p className="text-xs text-slate-500">No activity events yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {activity.map((event, index) => (
                        <div key={`${event.event_type}-${event.occurred_at ?? index}`} className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          <div className="font-medium text-slate-900">{event.event_type.replaceAll('_', ' ')}</div>
                          <div className="mt-0.5 text-slate-500">
                            {event.occurred_at ? new Date(event.occurred_at).toLocaleString() : 'Time unavailable'}
                            {event.actor_username ? ` · ${event.actor_username}` : ''}
                            {event.report_id ? ` · report #${event.report_id}` : ''}
                          </div>
                          {event.note && <div className="mt-1 text-slate-600">{event.note}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
