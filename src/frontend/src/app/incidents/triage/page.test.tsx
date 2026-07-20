import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TriageClusterEntry } from '@/lib/api';

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
const api = vi.hoisted(() => ({ fetchQueue: vi.fn(), claim: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
  useSearchParams: () => search.params,
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'validator', role: 'NATIONAL_VALIDATOR' }, loading: false }),
}));
vi.mock('@/lib/api', () => ({
  fetchTriageQueue: (...args: unknown[]) => api.fetchQueue(...args),
  claimTriageCluster: (...args: unknown[]) => api.claim(...args),
}));
vi.mock('@/lib/useAutoRefresh', () => ({
  useAutoRefresh: () => ({ pending: false, refreshing: false, justRefreshed: false }),
}));
vi.mock('@/components/ui/AutoRefreshToast', () => ({ AutoRefreshToast: () => null }));
vi.mock('@/components/triage', () => ({
  getTriageItemIdentity: (item: TriageClusterEntry) => item.cluster_id
    ? { type: 'cluster', id: item.cluster_id }
    : { type: 'singleton', id: item.reports[0]?.report_id },
  sortTriageItemsByPriority: (items: TriageClusterEntry[]) => items,
  TriageCanvasMap: ({ items, onSelectItem }: { items: TriageClusterEntry[]; onSelectItem: (item: TriageClusterEntry) => void }) => (
    <div data-testid="triage-canvas-map">{items.map((item) => <button key={item.anchor_report_id} onClick={() => onSelectItem(item)}>Select {item.cluster_id ? `cluster ${item.cluster_id}` : `report ${item.anchor_report_id}`}</button>)}</div>
  ),
  TriageInvestigationBoard: ({ selectedItem, onInspect, onClaimCluster }: { selectedItem: TriageClusterEntry | null; onInspect: (item: TriageClusterEntry) => void; onClaimCluster: (id: number) => void }) => (
    <div data-testid="triage-investigation-board">
      <span>{selectedItem?.cluster_id ? `Cluster #${selectedItem.cluster_id}` : `Report #${selectedItem?.anchor_report_id}`}</span>
      {selectedItem && <button onClick={() => onInspect(selectedItem)}>Inspect / Act</button>}
      {selectedItem?.cluster_id && <button onClick={() => onClaimCluster(selectedItem.cluster_id!)}>Claim</button>}
    </div>
  ),
  TriageEvidenceTable: ({ item, onSelectReport }: { item: TriageClusterEntry; onSelectReport: (id: number) => void }) => (
    <div data-testid="triage-evidence-table">
      {item.reports.map((entry) => <button key={entry.report_id} onClick={() => onSelectReport(entry.report_id)}>Evidence report {entry.report_id}</button>)}
    </div>
  ),
  TriageLegend: () => <div>Triage legend</div>,
}));

const report = (id: number) => ({ report_id: id, status: 'PENDING', trust_breakdown: { score: 70 }, created_at: '2026-07-20T00:00:00Z', reported_at: '2026-07-20T00:00:00Z', followups: [] });
const cluster = {
  cluster_id: 12, anchor_report_id: 7, cluster_status: 'CLUSTER_MONITORING', assigned_to: null,
  review_started_at: null, member_count: 2, has_life_safety: false, severity: 'HIGH', avg_trust: 70,
  oldest_report_at: '2026-07-20T00:00:00Z', is_aging: false, is_timeout_risk: false, is_danger: false,
  related_count: 0, station: { name: 'Station A', distance_m: 100, phone_available: true }, reports: [report(7), report(9)],
} as unknown as TriageClusterEntry;
const orphan = { ...cluster, cluster_id: null, anchor_report_id: 8, member_count: 1, reports: [report(8)] } as unknown as TriageClusterEntry;

describe('TriagePage route handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/incidents/triage?aging=true');
    search.params = new URLSearchParams('aging=true');
    api.fetchQueue.mockResolvedValue({ polled_at: '2026-07-20T00:00:00Z', total_reports: 3, clusters: [cluster, orphan] });
    api.claim.mockResolvedValue({});
  });

  it('renders the map, board, and evidence table', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    expect(await screen.findByTestId('triage-canvas-map')).toBeInTheDocument();
    expect(screen.getByTestId('triage-investigation-board')).toBeInTheDocument();
    expect(screen.getByTestId('triage-evidence-table')).toBeInTheDocument();
  });

  it('routes Inspect / Act to the dedicated cluster workspace with return state', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select cluster 12' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect / Act' }));
    expect(navigation.push).toHaveBeenCalledWith('/incidents/triage/12?aging=true&selected_type=cluster&selected_id=12&report_id=7');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps queue and report selection until deliberate inspection', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select cluster 12' }));
    fireEvent.click(screen.getByRole('button', { name: 'Evidence report 9' }));
    expect(screen.getByText('Cluster #12')).toBeInTheDocument();
    expect(navigation.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect / Act' }));
    expect(navigation.push).toHaveBeenCalledWith('/incidents/triage/12?aging=true&selected_type=cluster&selected_id=12&report_id=9');
  });

  it('uses a safe error instead of navigating an orphaned legacy row', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select report 8' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect / Act' }));
    expect(await screen.findByText(/has not been assigned a workspace cluster/)).toBeInTheDocument();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('claims from the board and refreshes queue', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Claim' }));
    await waitFor(() => expect(api.claim).toHaveBeenCalledWith(12));
    expect(api.fetchQueue).toHaveBeenCalledTimes(2);
  });
});
