import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TriageClusterEntry, TriageReportEntry } from '@/lib/api';
import { TriageWorkflowPanel } from './TriageWorkflowPanel';

const api = vi.hoisted(() => ({
  activity: vi.fn(),
  applyStatusUpdate: vi.fn(),
  applyTerminal: vi.fn(),
  claim: vi.fn(),
  merge: vi.fn(),
  mergeCandidates: vi.fn(),
  split: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  applyReportStatusUpdate: (...args: unknown[]) => api.applyStatusUpdate(...args),
  applyTriageTerminalAction: (...args: unknown[]) => api.applyTerminal(...args),
  claimTriageCluster: (...args: unknown[]) => api.claim(...args),
  fetchMergeCandidates: (...args: unknown[]) => api.mergeCandidates(...args),
  fetchTriageClusterActivity: (...args: unknown[]) => api.activity(...args),
  mergeTriageClusters: (...args: unknown[]) => api.merge(...args),
  splitTriageCluster: (...args: unknown[]) => api.split(...args),
}));

function report(overrides: Partial<TriageReportEntry> = {}): TriageReportEntry {
  return {
    report_id: 10,
    latitude: 14.5,
    longitude: 121.0,
    category: 'STRUCTURAL',
    sub_category: 'RESIDENTIAL',
    reporting_context: 'someone_else_needs_help',
    safety_status: null,
    status: 'PENDING',
    status_explanation: null,
    trust_breakdown: { score: 80, included_signals: [], missing_signals: [], gps_mismatch: false, duplicate_device_count_30m: 0 },
    severity: 'HIGH',
    related_count: 0,
    linked_count: 0,
    created_at: '2026-06-25T00:00:00Z',
    reported_at: '2026-06-25T00:00:00Z',
    is_aging: false,
    is_timeout_risk: false,
    previous_report_id: null,
    station: { name: 'Balayan FS', distance_m: 1000, phone_available: true, phone: '123-4567' },
    province_name: 'Batangas',
    ...overrides,
  };
}

function cluster(overrides: Partial<TriageClusterEntry> = {}): TriageClusterEntry {
  return {
    cluster_id: 42,
    anchor_report_id: 10,
    cluster_status: 'OPEN',
    assigned_to: null,
    review_started_at: null,
    member_count: 2,
    has_life_safety: true,
    severity: 'HIGH',
    avg_trust: 76,
    oldest_report_at: '2026-06-25T00:00:00Z',
    is_aging: false,
    is_timeout_risk: true,
    is_danger: false,
    related_count: 1,
    reports: [report(), report({ report_id: 11 })],
    station: { name: 'Balayan FS', distance_m: 1000, phone_available: true, phone: '123-4567' },
    province_name: 'Batangas',
    ...overrides,
  };
}

function renderPanel(clusterIn: TriageClusterEntry, role = 'NATIONAL_VALIDATOR') {
  const onMessage = vi.fn();
  const onError = vi.fn();
  const utils = render(
    <TriageWorkflowPanel
      cluster={clusterIn}
      inspectionMode="cluster"
      onWorkflowComplete={vi.fn()}
      onReloadQueue={vi.fn()}
      onMessage={onMessage}
      onError={onError}
      role={role}
      currentUsername="validator1"
    />,
  );
  return { ...utils, onMessage, onError };
}

describe('TriageWorkflowPanel — #636 context + Send Update', () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset().mockResolvedValue([]));
    api.mergeCandidates.mockResolvedValue([{
      cluster_id: 99,
      anchor_report_id: 30,
      distance_m: 87.5,
      minutes_apart: 12.3,
      status: 'CLUSTER_MONITORING',
      member_count: 3,
    }]);
  });

  it('renders the jurisdiction + nearest-station context strip', async () => {
    renderPanel(cluster());
    await waitFor(() => expect(api.activity).toHaveBeenCalledWith(42));
    expect(screen.getByTestId('triage-jurisdiction-context')).toBeInTheDocument();
    expect(screen.getByTestId('triage-context-province')).toHaveTextContent('Batangas');
    expect(screen.getByTestId('triage-context-station-name')).toHaveTextContent('Balayan FS');
    expect(screen.getByTestId('triage-context-station-phone')).toHaveTextContent('123-4567');
  });

  it('opens the Send Update tab when the "5" shortcut is pressed (allowed role)', async () => {
    const user = userEvent.setup();
    renderPanel(cluster());
    await user.keyboard('5');
    expect(screen.getByTestId('triage-panel-update')).toBeInTheDocument();
    expect(screen.getByTestId('update-stage-select')).toBeInTheDocument();
  });

  it('hides the Send Update tab for SYSTEM_ADMIN and ignores the 5 shortcut', async () => {
    const user = userEvent.setup();
    renderPanel(cluster(), 'SYSTEM_ADMIN');
    // SYSTEM_ADMIN has no Send Update tab rendered.
    expect(screen.queryByTestId('triage-panel-update')).toBeNull();
    await user.keyboard('5');
    // 5 must not open the update panel for SYSTEM_ADMIN.
    expect(screen.queryByTestId('triage-panel-update')).toBeNull();
  });

  it('requires deliberate click confirmation for destructive terminal actions', async () => {
    const user = userEvent.setup();
    renderPanel(cluster());
    await user.keyboard('b');
    expect(api.applyTerminal).not.toHaveBeenCalled();
    await user.click(screen.getByText('Bogus'));
    expect(screen.getByText('Citizen message preview')).toBeInTheDocument();
    await user.click(screen.getByTestId('triage-commit-terminal'));
    expect(screen.getByTestId('triage-confirm-dialog')).toBeInTheDocument();
    expect(api.applyTerminal).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('triage-confirm-commit'));
    await waitFor(() => expect(api.applyTerminal).toHaveBeenCalledWith(42, expect.objectContaining({
      report_ids: [10, 11],
      status: 'REJECTED_BOGUS',
    })));
  });

  it('preserves split, merge, and activity parity without modal shell', async () => {
    const user = userEvent.setup();
    api.activity.mockResolvedValue([{
      event_type: 'CLUSTER_CLAIMED',
      occurred_at: '2026-06-25T01:00:00Z',
      actor_username: 'validator1',
      report_id: null,
      previous_status: null,
      new_status: null,
      note: 'Review started',
    }]);
    renderPanel(cluster());
    await user.keyboard('2');
    expect(screen.getByTestId('triage-panel-split')).toBeInTheDocument();
    expect(screen.getByText('Leaving this cluster')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/different address, different time window/), 'Separate incident evidence');
    await user.click(screen.getByTestId('triage-commit-split'));
    expect(screen.getByText('Confirm split of 2 reports')).toBeInTheDocument();
    await user.click(screen.getByText('Cancel'));
    await user.keyboard('3');
    expect(await screen.findByTestId('triage-candidate-99')).toBeInTheDocument();
    await user.click(screen.getByTestId('triage-candidate-99'));
    await user.click(screen.getByTestId('triage-commit-merge'));
    expect(screen.getByText('Confirm merge of cluster #99 into #42')).toBeInTheDocument();
    await user.click(screen.getByText('Cancel'));
    await user.keyboard('4');
    expect(await screen.findByText('Review started')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a closed notice when the anchor report is already terminal', async () => {
    const user = userEvent.setup();
    const closedCluster = cluster({
      reports: [report({ status: 'ACTIONED', report_id: 10 })],
      anchor_report_id: 10,
    });
    renderPanel(closedCluster);
    await user.keyboard('5');
    expect(screen.getByTestId('triage-panel-update-closed')).toBeInTheDocument();
    expect(screen.getByTestId('triage-panel-update-closed')).toHaveTextContent('already closed');
    expect(screen.queryByTestId('update-stage-select')).toBeNull();
  });
});
