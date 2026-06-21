import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type {
  TriageQueueResponse,
  TriageClusterEntry,
} from '@/lib/api';

vi.mock('@/lib/api', () => {
  const mockQueue: TriageQueueResponse = {
    polled_at: '2026-05-20T10:00:00Z',
    total_reports: 3,
    clusters: [
      {
        cluster_id: 1,
        anchor_report_id: 10,
        cluster_status: 'CLUSTER_MONITORING',
        assigned_to: null,
        review_started_at: null,
        member_count: 2,
        has_life_safety: true,
        severity: 'HIGH',
        avg_trust: 0.7,
        oldest_report_at: '2026-05-20T09:00:00Z',
        is_aging: false,
        is_timeout_risk: true,
        is_danger: false,
        related_count: 1,
        station: { name: 'BFP Manila', distance_m: 800, phone_available: true },
        reports: [
          {
            report_id: 10,
            latitude: 14.5995,
            longitude: 120.9842,
            category: 'STRUCTURAL',
            sub_category: 'FIRE',
            reporting_context: 'WITNESS',
            safety_status: 'SOMEONE_ELSE_NEEDS_HELP',
            status: 'PENDING',
            status_explanation: null,
            trust_breakdown: {
              score: 70,
              included_signals: ['WITNESS', 'STRUCTURAL'],
              missing_signals: [],
              gps_mismatch: false,
              duplicate_device_count_30m: 0,
            },
            severity: 'HIGH',
            related_count: 1,
            linked_count: 0,
            created_at: '2026-05-20T09:00:00Z',
            reported_at: '2026-05-20T09:00:00Z',
            is_aging: false,
            is_timeout_risk: true,
            previous_report_id: null,
            station: { name: 'BFP Manila', distance_m: 800, phone_available: true },
            followups: [],
          },
          {
            report_id: 11,
            latitude: 14.6000,
            longitude: 120.9850,
            category: 'STRUCTURAL',
            sub_category: 'FIRE',
            reporting_context: 'WITNESS',
            safety_status: 'I_NEED_HELP',
            status: 'PENDING',
            status_explanation: null,
            trust_breakdown: {
              score: 65,
              included_signals: ['WITNESS', 'STRUCTURAL'],
              missing_signals: [],
              gps_mismatch: false,
              duplicate_device_count_30m: 0,
            },
            severity: 'HIGH',
            related_count: 0,
            linked_count: 0,
            created_at: '2026-05-20T09:10:00Z',
            reported_at: '2026-05-20T09:10:00Z',
            is_aging: false,
            is_timeout_risk: true,
            previous_report_id: null,
            station: { name: 'BFP Manila', distance_m: 820, phone_available: true },
            followups: [],
          },
        ],
      },
      {
        cluster_id: 2,
        anchor_report_id: 20,
        cluster_status: 'SINGLETON' as TriageClusterEntry['cluster_status'],
        assigned_to: null,
        review_started_at: null,
        member_count: 1,
        has_life_safety: false,
        severity: 'MEDIUM',
        avg_trust: 0.5,
        oldest_report_at: '2026-05-20T09:30:00Z',
        is_aging: false,
        is_timeout_risk: false,
        is_danger: false,
        related_count: 0,
        station: { name: 'BFP Quezon City', distance_m: 1200, phone_available: true },
        reports: [
          {
            report_id: 20,
            latitude: 14.6500,
            longitude: 121.0500,
            category: 'STRUCTURAL',
            sub_category: 'COLLAPSE',
            reporting_context: 'WITNESS',
            safety_status: 'SAFE',
            status: 'PENDING',
            status_explanation: null,
            trust_breakdown: {
              score: 50,
              included_signals: ['WITNESS'],
              missing_signals: ['STRUCTURAL'],
              gps_mismatch: false,
              duplicate_device_count_30m: 0,
            },
            severity: 'MEDIUM',
            related_count: 0,
            linked_count: 0,
            created_at: '2026-05-20T09:30:00Z',
            reported_at: '2026-05-20T09:30:00Z',
            is_aging: false,
            is_timeout_risk: false,
            previous_report_id: null,
            station: { name: 'BFP Quezon City', distance_m: 1200, phone_available: true },
            followups: [],
          },
        ],
      },
      {
        cluster_id: 3,
        anchor_report_id: 30,
        cluster_status: 'CLUSTER_MONITORING',
        assigned_to: null,
        review_started_at: null,
        member_count: 1,
        has_life_safety: false,
        severity: 'LOW',
        avg_trust: 0.9,
        oldest_report_at: '2026-06-21T03:00:00Z',
        is_aging: false,
        is_timeout_risk: false,
        is_danger: false,
        related_count: 0,
        station: { name: 'BFP Pasig', distance_m: 500, phone_available: true },
        reports: [
          {
            report_id: 30,
            latitude: 14.5600,
            longitude: 121.0700,
            category: 'STRUCTURAL',
            sub_category: 'FIRE',
            reporting_context: 'WITNESS',
            safety_status: 'SAFE',
            status: 'PENDING',
            status_explanation: null,
            trust_breakdown: {
              score: 90,
              included_signals: ['WITNESS', 'STRUCTURAL'],
              missing_signals: [],
              gps_mismatch: false,
              duplicate_device_count_30m: 0,
            },
            severity: 'LOW',
            related_count: 0,
            linked_count: 0,
            created_at: '2026-06-21T03:00:00Z',
            reported_at: '2026-06-21T03:00:00Z',
            is_aging: false,
            is_timeout_risk: false,
            previous_report_id: null,
            station: { name: 'BFP Pasig', distance_m: 500, phone_available: true },
            description: '<script>alert(1)</script>',
            followups: [
              {
                followup_id: 1,
                followup_text: '<script>alert(1)</script>',
                created_at: '2026-06-21T03:05:00Z',
              },
            ],
          },
        ],
      },
    ],
  };

  return {
    fetchTriageQueue: vi.fn().mockResolvedValue(mockQueue),
    claimTriageCluster: vi.fn().mockResolvedValue({}),
    applyTriageTerminalAction: vi.fn().mockResolvedValue({}),
    correctTriageReport: vi.fn().mockResolvedValue({}),
    splitTriageCluster: vi.fn().mockResolvedValue({}),
    mergeTriageClusters: vi.fn().mockResolvedValue({}),
    fetchMergeCandidates: vi.fn().mockResolvedValue([
      {
        cluster_id: 99,
        anchor_report_id: 30,
        distance_m: 87.5,
        minutes_apart: 12.3,
        status: 'CLUSTER_MONITORING',
        member_count: 3,
      },
    ]),
    fetchTriageClusterActivity: vi.fn().mockResolvedValue([]),
  };
});

const mockUseAuth = vi.fn(() => ({
  user: { keycloak_id: 'test-id', username: 'validator1', role: 'NATIONAL_VALIDATOR' as string },
  loading: false,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={String(props.alt ?? '')} />;
  },
}));

describe('TriagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockImplementation(() => ({
      user: { keycloak_id: 'test-id', username: 'validator1', role: 'NATIONAL_VALIDATOR' },
      loading: false,
    }));
    window.history.pushState({}, '', '/incidents/triage');
  });

  it('renders clusters table with cluster row data', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await waitFor(() => {
      expect(screen.getByTestId('clusters-table')).toBeInTheDocument();
    });
    expect(screen.getByText('Clusters')).toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeInTheDocument();
  });

  it('renders metrics bar with correct counts and polled time', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await waitFor(() => {
      expect(screen.getByText('Clusters:')).toBeInTheDocument();
    });
    expect(screen.getByText('Individual reports:')).toBeInTheDocument();
    // Verify count values via the <strong> elements
    const strongs = screen.getAllByText(/^[0-9]+$/);
    expect(strongs.length).toBeGreaterThanOrEqual(2);
    expect(strongs[0].textContent).toBe('1'); // Clusters count (member_count > 1)
    expect(strongs[1].textContent).toBe('2'); // Individual reports count (member_count <= 1)
    expect(screen.getByText(/Polled/)).toBeInTheDocument();
  });

  it('renders both clusters and singletons tables', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await waitFor(() => {
      expect(screen.getByTestId('clusters-table')).toBeInTheDocument();
      expect(screen.getByTestId('singletons-table')).toBeInTheDocument();
    });
    // Singleton table renders the singleton row data
    expect(screen.getByText('MEDIUM')).toBeInTheDocument();
    expect(screen.getByText(/COLLAPSE/)).toBeInTheDocument();
  });

  it('shows Inspect on singleton and opens singleton-mode modal', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    // Wait for inspects to appear (data loaded) before querying
    const inspectBtns = await screen.findAllByRole('button', { name: 'Inspect' });
    // Layout under member_count-based split: [0] = cluster (member_count > 1),
    // [1..n] = singletons (member_count <= 1). The last button is always a
    // singleton because every active report now has a durable cluster.
    const singletonInspect = inspectBtns[inspectBtns.length - 1];
    await userEvent.click(singletonInspect);
    await waitFor(() => {
      // Singleton modal title is driven by member_count <= 1 (not cluster_id nullability)
      expect(screen.getByText('Singleton report')).toBeInTheDocument();
    });
  });

  it('opens cluster inspection modal when Inspect is clicked', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    const inspectBtns = await screen.findAllByRole('button', { name: 'Inspect' });
    const inspectBtn = inspectBtns[0];
    await userEvent.click(inspectBtn);
    await waitFor(() => {
      expect(screen.getByText('Cluster 1')).toBeInTheDocument();
      expect(screen.getByText('#10')).toBeInTheDocument();
      expect(screen.getByText('#11')).toBeInTheDocument();
    });
  });

  it('shows keyboard shortcut hint in modal header', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    const inspectBtn = await waitFor(() =>
      screen.getAllByRole('button', { name: 'Inspect' })[0],
    );
    await userEvent.click(inspectBtn);
    await waitFor(() => {
      expect(screen.getByText('Esc close')).toBeInTheDocument();
    });
  });

  it('closes modal on Escape key', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    const inspectBtn = await waitFor(() =>
      screen.getAllByRole('button', { name: 'Inspect' })[0],
    );
    await userEvent.click(inspectBtn);
    const modalTitle = await screen.findByText('Cluster 1');
    expect(modalTitle).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape', keyCode: 27 });
    await waitFor(() => {
      expect(screen.queryByText('Cluster 1')).not.toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('displays merge candidate list in modal', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    const inspectBtn = await waitFor(() =>
      screen.getAllByRole('button', { name: 'Inspect' })[0],
    );
    await userEvent.click(inspectBtn);
    await waitFor(() => {
      expect(screen.getByText('Cluster #99')).toBeInTheDocument();
    });
  });

  it('closes modal on Escape even when focus is inside an input', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    const inspectBtn = await waitFor(() =>
      screen.getAllByRole('button', { name: 'Inspect' })[0],
    );
    await userEvent.click(inspectBtn);
    await waitFor(() => expect(screen.getByText('Cluster 1')).toBeInTheDocument());

    const input = screen.getByPlaceholderText('Source cluster id');
    await userEvent.click(input);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Cluster 1')).not.toBeInTheDocument());
  });

  it('closes modal from the explicit Close button', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    const inspectBtn = await waitFor(() =>
      screen.getAllByRole('button', { name: 'Inspect' })[0],
    );
    await userEvent.click(inspectBtn);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Close inspection modal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes modal from the backdrop and restores body scrolling', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    const inspectBtn = await waitFor(() =>
      screen.getAllByRole('button', { name: 'Inspect' })[0],
    );
    await userEvent.click(inspectBtn);
    const backdrop = await screen.findByTestId('triage-modal-backdrop');
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.mouseDown(backdrop);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe('');
  });

  it('strips HTML tags from report description and follow-ups in cluster modal', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);

    const inspectBtns = await screen.findAllByRole('button', { name: 'Inspect' });
    // Layout under member_count-based split: [0] = cluster 1 (member_count=2),
    // [1] = singleton #2 (no HTML), [2] = singleton #3 (HTML in description + follow-ups).
    // Cluster 3 has cluster_id=3 but member_count=1, so its title is "Singleton report"
    // under the new contract.
    const clusterInspect = inspectBtns[2];
    await userEvent.click(clusterInspect);

    await waitFor(() => {
      expect(screen.getByText('Singleton report')).toBeInTheDocument();
    });

    const modalContent = screen.getByRole('dialog').textContent || '';
    // The description should have <script> tags stripped — 'alert(1)' visible, no angle brackets
    expect(modalContent).toContain('alert(1)');
    expect(modalContent).not.toContain('<script>');
    expect(modalContent).not.toContain('</script>');
    // Follow-up section and timestamp still render
    expect(modalContent).toContain('Follow-up');
  });

  it('does not show Claim button for ENCODER role', async () => {
    mockUseAuth.mockReturnValue({
      user: { keycloak_id: 'enc1', username: 'encoder1', role: 'ENCODER' },
      loading: false,
    });
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await waitFor(() => screen.getByTestId('clusters-table'));
    // Claim button rendered only for VALIDATOR/NATIONAL_VALIDATOR on unassigned clusters
    expect(screen.queryByRole('button', { name: 'Claim' })).not.toBeInTheDocument();
  });
});
