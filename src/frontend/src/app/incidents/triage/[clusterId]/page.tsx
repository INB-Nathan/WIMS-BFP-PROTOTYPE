'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { TriageWorkflowPanel } from '@/components/triage';
import {
  ContributorCredibility,
  CorrectionActionPanel,
  EvidenceGallery,
  LocationComparisonMap,
} from '@/components/triage/workspace';
import '@/components/triage/triage-workflow.css';
import {
  claimTriageCluster,
  fetchTriageQueue,
  fetchTriageWorkspace,
  type TriageClusterEntry,
  type TriageWorkspaceResponse,
  type WorkspaceReport,
} from '@/lib/api';

export default function TriageWorkspacePage() {
  const params = useParams<{ clusterId: string }>();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const clusterId = Number(params.clusterId);
  const requestedReportId = Number(searchParams.get('report_id'));
  const role = user?.role ?? null;
  const canAccess = role === 'NATIONAL_VALIDATOR' || role === 'SYSTEM_ADMIN';
  const [workspace, setWorkspace] = useState<TriageWorkspaceResponse | null>(null);
  const [queueCluster, setQueueCluster] = useState<TriageClusterEntry | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const terminalCluster = workspace?.cluster.status === 'CLUSTER_CLOSED' || workspace?.cluster.status === 'CLUSTER_ACTIONED';

  const loadWorkspace = useCallback(async () => {
    if (!Number.isInteger(clusterId) || clusterId <= 0 || !canAccess) return;
    setError(null);
    try {
      const [workspaceData, queueData] = await Promise.all([
        fetchTriageWorkspace(clusterId),
        fetchTriageQueue().catch(() => null),
      ]);
      setWorkspace(workspaceData);
      const nextQueueCluster = queueData?.clusters.find((item) => item.cluster_id === clusterId) ?? null;
      setQueueCluster(nextQueueCluster);
      setStale(false);
      setSelectedReportId((current) => {
        const preferredReportId = current ?? (Number.isInteger(requestedReportId) && requestedReportId > 0 ? requestedReportId : null);
        return workspaceData.reports.some((report) => report.report_id === preferredReportId)
          ? preferredReportId
          : workspaceData.cluster.anchor_report_id ?? workspaceData.reports[0]?.report_id ?? null;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Workspace unavailable.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canAccess, clusterId, requestedReportId]);

  useEffect(() => {
    if (!authLoading) void loadWorkspace();
  }, [authLoading, loadWorkspace]);

  useEffect(() => {
    document.querySelector<HTMLElement>('#triage-workspace-heading')?.focus();
  }, []);

  useEffect(() => {
    if (!workspace || terminalCluster) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void fetchTriageWorkspace(clusterId)
        .then((latest) => {
          if (latest.cluster.updated_at !== workspace.cluster.updated_at) {
            setStale(true);
          }
        })
        .catch(() => setStale(true));
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [clusterId, terminalCluster, workspace]);

  useEffect(() => {
    if (
      !queueCluster?.cluster_id ||
      queueCluster.assigned_to !== user?.preferred_username ||
      terminalCluster
    ) return;
    const heartbeatClusterId = queueCluster.cluster_id;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void claimTriageCluster(heartbeatClusterId).catch(() => setStale(true));
    }, 5 * 60_000);
    return () => window.clearInterval(interval);
  }, [queueCluster, terminalCluster, user?.preferred_username]);

  const selectedReport = useMemo<WorkspaceReport | null>(
    () => workspace?.reports.find((report) => report.report_id === selectedReportId) ?? workspace?.reports[0] ?? null,
    [selectedReportId, workspace],
  );
  const returnHref = `/incidents/triage${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;

  if (authLoading) {
    return <div role="status" className="flex min-h-72 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /><span className="sr-only">Loading evidence workspace</span></div>;
  }
  if (!canAccess) {
    return <NeutralState title="Access restricted" body="This evidence workspace is available to National Validators and System Administrators." returnHref={returnHref} />;
  }
  if (!Number.isInteger(clusterId) || clusterId <= 0) {
    return <NeutralState title="Workspace unavailable" body="Cluster identifier is invalid." returnHref={returnHref} />;
  }
  if (loading) {
    return <div role="status" className="flex min-h-72 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /><span className="sr-only">Loading evidence workspace</span></div>;
  }
  if (error || !workspace) {
    return <NeutralState title="Workspace unavailable" body={error ?? 'Workspace data was not returned.'} returnHref={returnHref} />;
  }

  return (
    <div className="space-y-5 pb-10">
      <header className="sticky top-0 z-20 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href={returnHref} className="text-sm font-medium text-red-700">← Return to triage queue</Link>
            <h1 id="triage-workspace-heading" tabIndex={-1} className="mt-1 text-2xl font-semibold text-slate-950">Cluster #{workspace.cluster.cluster_id} evidence workspace</h1>
            <p className="text-sm text-slate-600">
              Status {workspace.cluster.status} · Claimed by {workspace.cluster.assigned_to ?? 'nobody'}{workspace.cluster.review_started_at ? ` since ${new Date(workspace.cluster.review_started_at).toLocaleTimeString()}` : ''} · {stale ? 'Refresh needed' : `Fresh as of ${new Date(workspace.loaded_at).toLocaleTimeString()}`}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={refreshing} onClick={() => { setRefreshing(true); void loadWorkspace(); }} className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>

          </div>
        </div>
      </header>

      {message && <p role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{message}</p>}
      {terminalCluster && (
        <section role="status" className="rounded-xl border border-slate-300 bg-slate-50 p-5">
          <h2 className="font-semibold">Cluster is closed</h2>
          <p className="mt-1 text-sm text-slate-600">Evidence remains viewable, but workflow actions are unavailable. Return to the queue to continue triage.</p>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <nav aria-label="Reports in cluster" className="h-fit rounded-xl border border-slate-200 bg-white p-3">
          <h2 className="px-2 pb-2 font-semibold">Reports</h2>
          <ul className="space-y-2">
            {workspace.reports.map((report) => (
              <li key={report.report_id}>
                <button
                  type="button"
                  aria-current={report.report_id === selectedReport?.report_id ? 'true' : undefined}
                  onClick={() => setSelectedReportId(report.report_id)}
                  className={`w-full rounded-lg border p-3 text-left text-sm ${report.report_id === selectedReport?.report_id ? 'border-red-500 bg-red-50' : 'border-slate-200 bg-white'}`}
                >
                  <strong>Report #{report.report_id}</strong>
                  <span className="mt-1 block">{report.status} · trust {report.trust_score}</span>
                  <span className="block text-xs text-slate-600">{report.photos.length} photo(s) · {report.contributor.authenticated ? 'authenticated' : 'anonymous'}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {selectedReport ? (
          <main className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-xl font-semibold">Report #{selectedReport.report_id}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{selectedReport.description ?? 'No narrative supplied.'}</p>
              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-slate-500">Category</dt><dd>{selectedReport.category ?? 'Unspecified'}</dd></div>
                <div><dt className="text-slate-500">Safety</dt><dd>{selectedReport.safety_status ?? 'Unspecified'}</dd></div>
                <div><dt className="text-slate-500">Reported</dt><dd>{new Date(selectedReport.reported_at ?? selectedReport.created_at).toLocaleString()}</dd></div>
                <div><dt className="text-slate-500">Previous report</dt><dd>{selectedReport.previous_report_id ? `#${selectedReport.previous_report_id}` : 'None'}</dd></div>
              </dl>
            </section>

            <EvidenceGallery key={selectedReport.report_id} reportId={selectedReport.report_id} photos={selectedReport.photos} />
            <LocationComparisonMap report={selectedReport} />
            <ContributorCredibility reportId={selectedReport.report_id} credibility={selectedReport.contributor} />

            <section className="grid gap-4 lg:grid-cols-2">
              <Timeline title="Follow-ups" empty="No follow-ups." entries={selectedReport.followups.map((item) => ({ id: item.followup_id, title: item.followup_text, at: item.created_at }))} />
              <Timeline title="Civilian-visible feedback" empty="No feedback published." entries={selectedReport.feedback.map((item) => ({ id: item.update_id, title: item.stage.replaceAll('_', ' '), at: item.created_at }))} />
            </section>
            <Timeline
              title="Cluster activity"
              empty="No cluster activity recorded."
              entries={workspace.activity.map((item, index) => ({
                id: index,
                title: `${item.event_type.replaceAll('_', ' ')}${item.actor_username ? ` · ${item.actor_username}` : ''}${item.note ? ` · ${item.note}` : ''}`,
                at: item.occurred_at ?? workspace.loaded_at,
              }))}
            />
          </main>
        ) : (
          <p role="status" className="rounded-xl border border-slate-200 bg-white p-6">Cluster contains no visible reports.</p>
        )}
      </div>

      <CorrectionActionPanel
        key={workspace.loaded_at}
        reports={workspace.reports}
        onError={setError}
        onComplete={async (successMessage) => {
          setMessage(successMessage);
          await loadWorkspace();
        }}
      />

      {!terminalCluster && queueCluster && (
        <TriageWorkflowPanel
          cluster={queueCluster}
          inspectionMode="cluster"
          onWorkflowComplete={() => setQueueCluster(null)}
          onReloadQueue={loadWorkspace}
          onMessage={setMessage}
          onError={setError}
          role={role}
          currentUsername={user?.preferred_username ?? null}
        />
      )}
      {!terminalCluster && !queueCluster && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Action controls are unavailable because this cluster is no longer in the active queue. Refresh or return to the queue.</p>
      )}
    </div>
  );
}

function Timeline({ title, empty, entries }: { title: string; empty: string; entries: { id: number; title: string; at: string }[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">{title}</h2>
      {entries.length ? <ol className="mt-3 space-y-3">{entries.map((entry) => <li key={entry.id} className="border-l-2 border-slate-300 pl-3 text-sm"><p>{entry.title}</p><time className="text-xs text-slate-500">{new Date(entry.at).toLocaleString()}</time></li>)}</ol> : <p className="mt-2 text-sm text-slate-600">{empty}</p>}
    </section>
  );
}

function NeutralState({ title, body, returnHref }: { title: string; body: string; returnHref: string }) {
  return <section role="alert" className="rounded-xl border border-slate-200 bg-white p-8 text-center"><h1 className="text-xl font-semibold">{title}</h1><p className="mt-2 text-sm text-slate-600">{body}</p><Link href={returnHref} className="mt-4 inline-block text-sm font-medium text-red-700">Return to triage queue</Link></section>;
}
