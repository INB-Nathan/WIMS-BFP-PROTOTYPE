import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TriageWorkspacePage from '../page';

const fetchWorkspace = vi.fn();
const fetchQueue = vi.fn();
const claimCluster = vi.fn();
const auth = vi.fn();
const search = { params: new URLSearchParams('status=NEW') };

vi.mock('next/navigation', () => ({
  useParams: () => ({ clusterId: '12' }),
  useSearchParams: () => search.params,
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth() }));
vi.mock('@/lib/api', () => ({
  claimTriageCluster: (...args: unknown[]) => claimCluster(...args),
  fetchTriageWorkspace: (...args: unknown[]) => fetchWorkspace(...args),
  fetchTriageQueue: (...args: unknown[]) => fetchQueue(...args),
}));
vi.mock('@/components/triage', () => ({
  TriageWorkflowPanel: ({ cluster }: { cluster: unknown }) => cluster ? <div>Embedded action controls<input aria-label="Action draft" defaultValue="" /></div> : null,
}));
vi.mock('@/components/triage/workspace', () => ({
  CorrectionActionPanel: () => null,
  EvidenceGallery: ({ reportId }: { reportId: number }) => <div>Evidence {reportId}</div>,
  LocationComparisonMap: ({ report }: { report: { report_id: number } }) => <div>Map {report.report_id}</div>,
  ContributorCredibility: ({ reportId }: { reportId: number }) => <div>Credibility {reportId}</div>,
}));

const location = { source: 'report_location', available: true, latitude: 14.6, longitude: 121, accuracy_m: null, approximate: false, distance_to_report_m: 0 };
const report = (id: number) => ({
  report_id: id, report_token: `t-${id}`, status: 'PENDING', category: 'FIRE', sub_category: null,
  description: `Narrative ${id}`, safety_status: 'SAFE', reporting_context: 'WITNESS',
  created_at: '2026-07-20T00:00:00Z', reported_at: null, trust_score: 75,
  credibility_badge: null, previous_report_id: null, current_cluster_id: 12,
  report_location: location, device_location: { ...location, source: 'device_gps' }, ip_location: { ...location, source: 'ip_city_centroid' },
  photos: [], contributor: { authenticated: false, badge: null, trust_score: 75, total_reports: null, actioned_reports: null, pending_reports: null, evidence_quality: null, active_months: null },
  followups: [], feedback: [],
});

const workspace = {
  cluster: { cluster_id: 12, status: 'NEW', anchor_report_id: 1, assigned_to: null, created_at: '2026-07-20T00:00:00Z', updated_at: '2026-07-20T00:00:00Z' },
  reports: [report(1), report(2)], activity: [], loaded_at: '2026-07-20T00:00:00Z',
};
const queueCluster = { cluster_id: 12, status: 'NEW', report_count: 2 };

describe('TriageWorkspacePage', () => {
  beforeEach(() => {
    search.params = new URLSearchParams('status=NEW');
    fetchWorkspace.mockReset().mockResolvedValue(workspace);
    fetchQueue.mockReset().mockResolvedValue({ clusters: [queueCluster] });
    claimCluster.mockReset().mockResolvedValue({});
    auth.mockReset().mockReturnValue({ user: { id: 'validator', role: 'NATIONAL_VALIDATOR', preferred_username: 'validator' }, loading: false });
  });

  it('loads the route workspace, preserves queue filters, and changes reports without refetching', async () => {
    render(<TriageWorkspacePage />);
    expect(await screen.findByRole('heading', { name: /Cluster #12 evidence workspace/ })).toBeInTheDocument();
    expect(fetchWorkspace).toHaveBeenCalledWith(12);
    expect(screen.getByRole('link', { name: /Return to triage queue/ })).toHaveAttribute('href', '/incidents/triage?status=NEW');
    expect(screen.getByText('Evidence 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Report #2/ }));
    expect(screen.getByText('Evidence 2')).toBeInTheDocument();
    expect(fetchWorkspace).toHaveBeenCalledTimes(1);
  });

  it('reconstructs the selected report from a deep link', async () => {
    search.params = new URLSearchParams('status=NEW&report_id=2');
    render(<TriageWorkspacePage />);
    expect(await screen.findByText('Evidence 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Return to triage queue/ })).toHaveAttribute('href', '/incidents/triage?status=NEW&report_id=2');
  });

  it('reuses full action controls without modal-only presentation', async () => {
    render(<TriageWorkspacePage />);
    expect(await screen.findByText('Embedded action controls')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks remote changes stale without overwriting an in-progress action form', async () => {
    vi.useFakeTimers();
    fetchWorkspace
      .mockResolvedValueOnce(workspace)
      .mockResolvedValue({ ...workspace, cluster: { ...workspace.cluster, updated_at: '2026-07-20T00:01:00Z' } });
    render(<TriageWorkspacePage />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const draft = screen.getByLabelText('Action draft');
    fireEvent.change(draft, { target: { value: 'Do not replace me' } });
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(draft).toHaveValue('Do not replace me');
    expect(screen.getByText(/Refresh needed/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('refreshes its own claim on the five-minute heartbeat', async () => {
    vi.useFakeTimers();
    fetchQueue.mockResolvedValue({ clusters: [{ ...queueCluster, assigned_to: 'validator' }] });
    render(<TriageWorkspacePage />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
      await Promise.resolve();
    });
    expect(claimCluster).toHaveBeenCalledWith(12);
    vi.useRealTimers();
  });

  it('shows a recoverable closed state without active workflow controls', async () => {
    fetchWorkspace.mockResolvedValue({
      ...workspace,
      cluster: { ...workspace.cluster, status: 'CLUSTER_CLOSED' },
    });
    fetchQueue.mockResolvedValue({ clusters: [] });
    render(<TriageWorkspacePage />);
    expect(await screen.findByRole('heading', { name: 'Cluster is closed' })).toBeInTheDocument();
    expect(screen.queryByText('Embedded action controls')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Return to triage queue/ })).toBeInTheDocument();
  });

  it('uses a neutral recoverable state when the workspace is missing', async () => {
    fetchWorkspace.mockRejectedValue(new Error('Workspace unavailable.'));
    render(<TriageWorkspacePage />);
    expect(await screen.findByRole('heading', { name: 'Workspace unavailable' })).toBeInTheDocument();
    expect(screen.getByText('Workspace unavailable.')).toBeInTheDocument();
  });

  it('blocks roles outside the backend workspace contract', async () => {
    auth.mockReturnValue({ user: { id: 'encoder', role: 'DATA_ENCODER' }, loading: false });
    render(<TriageWorkspacePage />);
    expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeInTheDocument();
    await waitFor(() => expect(fetchWorkspace).not.toHaveBeenCalled());
  });
});
