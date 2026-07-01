'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Filter, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  TriageCanvasMap,
  TriageInspectionModal,
  TriageInvestigationBoard,
  TriageLegend,
  getTriageItemIdentity,
  sortTriageItemsByPriority,
  type TriageItemIdentity,
} from '@/components/triage';
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
  { key: 'danger', label: 'Danger (2hr+)' },
] as const;

type InspectionMode = 'cluster' | 'singleton';

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
  const [selectedIdentity, setSelectedIdentity] = useState<TriageItemIdentity | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);

  const canAccess =
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

  function selectTriageItem(item: TriageClusterEntry) {
    const identity = getTriageItemIdentity(item);
    if (!identity) return;
    setSelectedIdentity(identity);
    setSelectedReportId(identity.type === 'singleton' ? item.reports[0]?.report_id ?? null : null);
    setSelectionNotice(null);
  }

  function inspectSelectedItem(item: TriageClusterEntry) {
    const identity = getTriageItemIdentity(item);
    if (!identity) return;
    setSelectedIdentity(identity);
    setSelectedReportId(identity.type === 'singleton' ? item.reports[0]?.report_id ?? null : null);
    void openInspection(item, identity.type);
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

  const allTriageItems = useMemo(() => {
    return sortTriageItemsByPriority([...sortedClusters, ...filteredSingletons]);
  }, [sortedClusters, filteredSingletons]);

  const selectedItem = useMemo(() => {
    if (!selectedIdentity) return allTriageItems[0] ?? null;
    return allTriageItems.find((item) => {
      const identity = getTriageItemIdentity(item);
      return identity?.type === selectedIdentity.type && identity.id === selectedIdentity.id;
    }) ?? null;
  }, [allTriageItems, selectedIdentity]);

  useEffect(() => {
    if (allTriageItems.length === 0) {
      setSelectedIdentity(null);
      setSelectedReportId(null);
      return;
    }

    if (!selectedIdentity) {
      const firstIdentity = getTriageItemIdentity(allTriageItems[0]);
      setSelectedIdentity(firstIdentity);
      setSelectedReportId(allTriageItems[0].reports[0]?.report_id ?? null);
      return;
    }

    const stillExists = allTriageItems.some((item) => {
      const identity = getTriageItemIdentity(item);
      return identity?.type === selectedIdentity.type && identity.id === selectedIdentity.id;
    });

    if (!stillExists) {
      const next = allTriageItems[0];
      setSelectedIdentity(getTriageItemIdentity(next));
      setSelectedReportId(next.reports[0]?.report_id ?? null);
      setSelectionNotice('Selected triage item changed after refresh. Showing the next highest-priority item.');
    }
  }, [allTriageItems, selectedIdentity]);

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

      <div className="rounded-md border border-slate-200 bg-white">
        {selectionNotice && (
          <div className="m-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {selectionNotice}
          </div>
        )}

        {loading ? (
          <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
            <div className="flex h-[min(68vh,680px)] min-h-[420px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
              <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading investigation board...</div>
          </div>
        ) : allTriageItems.length === 0 ? (
          <div className="p-12 text-center text-slate-600">No civilian reports matching current filters.</div>
        ) : (
          <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
            <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" aria-label="Civilian triage map canvas">
              <TriageCanvasMap
                items={allTriageItems}
                selectedIdentity={selectedIdentity}
                selectedReportId={selectedReportId}
                onSelectItem={selectTriageItem}
                onSelectReport={setSelectedReportId}
              />
            </section>
            <TriageInvestigationBoard
              items={allTriageItems}
              selectedItem={selectedItem}
              selectedReportId={selectedReportId}
              role={role}
              claiming={claiming}
              onInspect={inspectSelectedItem}
              onSelectItem={selectTriageItem}
              onSelectReport={setSelectedReportId}
              onClaimCluster={(clusterId) => void claimCluster(clusterId)}
            />
          </div>
        )}
      </div>

      {/* ── HCI Legend: explains clusters, trust scores, severity colors ── */}
      <TriageLegend />

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
