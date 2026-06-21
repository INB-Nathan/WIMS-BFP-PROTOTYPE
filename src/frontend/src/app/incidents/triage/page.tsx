'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ClipboardList, Clock, Filter, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { TriageInspectionModal } from '@/components/triage';
import '@/components/triage/triage-modal.css';
import {
  claimTriageCluster,
  fetchTriageQueue,
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

type InspectionMode = 'cluster' | 'singleton';

function statusTone(severity: string) {
  if (severity === 'HIGH') return 'bg-red-100 text-red-700 border-red-200';
  if (severity === 'MEDIUM') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

export default function TriagePage() {
  const { user, loading: authLoading } = useAuth();
  const role = (user as { role?: string })?.role ?? null;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [queue, setQueue] = useState<TriageQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openCluster, setOpenCluster] = useState<TriageClusterEntry | null>(null);
  const [inspectionMode, setInspectionMode] = useState<InspectionMode>('cluster');
  const [lastPolled, setLastPolled] = useState<Date | null>(null);
  const [claiming, setClaiming] = useState<number | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load triage queue.');
    } finally {
      setLoading(false);
    }
  }, [filterParams]);

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
    if (!canAccess || authLoading || openCluster) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadQueueRef.current();
    }, 30000);
    return () => window.clearInterval(interval);
  }, [authLoading, canAccess, openCluster]);

  function toggleFilter(key: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (next.get(key) === 'true') next.delete(key);
    else next.set(key, 'true');
    router.replace(`/incidents/triage${next.toString() ? `?${next.toString()}` : ''}`);
  }

  async function openInspection(cluster: TriageClusterEntry, mode: InspectionMode) {
    setOpenCluster(cluster);
    setInspectionMode(mode);
  }

  async function claimCluster(clusterId: number | null) {
    if (!clusterId) return;
    setClaiming(clusterId);
    setError(null);
    try {
      await claimTriageCluster(clusterId);
      setMessage(`Cluster ${clusterId} claimed.`);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim cluster.');
    } finally {
      setClaiming(null);
    }
  }

  const closeInspection = useCallback(() => {
    setOpenCluster(null);
  }, []);

  // Split queue into clusters and singletons
  const clusters = useMemo(() => {
    if (!queue) return [];
    return queue.clusters.filter((item) => item.cluster_id !== null && item.cluster_id !== undefined);
  }, [queue]);

  const singletons = useMemo(() => {
    if (!queue) return [];
    return queue.clusters.filter((item) => item.cluster_id === null || item.cluster_id === undefined);
  }, [queue]);

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

  const unreviewedOnly = searchParams.get('unreviewed') === 'true';
  const filteredSingletons = useMemo(() => {
    if (!unreviewedOnly) return sortedSingletons;
    return sortedSingletons.filter((item) => item.reports.some((r: TriageReportEntry) => r.status === 'PENDING'));
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

      <div className="flex items-center gap-6 text-sm text-gray-600 py-2 border-b">
        <span>Clusters: <strong>{sortedClusters.length}</strong></span>
        <span>Individual reports: <strong>{filteredSingletons.length}</strong></span>
        {lastPolled && <span>Polled {lastPolled.toLocaleTimeString()}</span>}
      </div>

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
                          <button
                            disabled={claiming === cluster.cluster_id}
                            onClick={() => void claimCluster(cluster.cluster_id)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
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
                  const terminalStatus = report.status === 'ACTIONED' || report.status.startsWith('REJECTED_');
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

      <TriageInspectionModal
        openCluster={openCluster}
        inspectionMode={inspectionMode}
        onClose={closeInspection}
        onReloadQueue={loadQueue}
        onMessage={setMessage}
        onError={setError}
        role={role}
      />
    </div>
  );
}
