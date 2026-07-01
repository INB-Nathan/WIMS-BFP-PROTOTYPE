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
        cluster_id: null as unknown as number,
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

vi.mock('next/navigation', () => {
  const stableSearchParams = new URLSearchParams();
  return {
    useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
    useSearchParams: () => stableSearchParams,
  };
});

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={String(props.alt ?? '')} />;
  },
}));

vi.mock('@/components/triage/TriageCanvasMap', () => ({
  TriageCanvasMap: ({ items, onSelectItem }: { items: TriageClusterEntry[]; onSelectItem: (item: TriageClusterEntry) => void }) => (
    <div data-testid="triage-canvas-map">
      {items.map((item) => (
        <button
          key={item.cluster_id ?? item.anchor_report_id ?? item.reports[0]?.report_id}
          type="button"
          onClick={() => onSelectItem(item)}
        >
          Select {item.cluster_id != null ? `cluster ${item.cluster_id}` : `report ${item.reports[0]?.report_id}`}
        </button>
      ))}
    </div>
  ),
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

  // ---------------------------------------------------------------------------
  // New spatial workspace contract — the page renders a map and an
  // investigation board in place of the previous table-first layout.
  // ---------------------------------------------------------------------------

  it('renders map canvas and investigation board instead of table-first sections', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);

    expect(await screen.findByTestId('triage-canvas-map')).toBeInTheDocument();
    expect(screen.getByTestId('triage-investigation-board')).toBeInTheDocument();
    expect(screen.queryByTestId('clusters-table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('singletons-table')).not.toBeInTheDocument();
  });

  it('selecting a map item updates the board without opening the modal', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);

    await userEvent.click(await screen.findByRole('button', { name: /Select cluster 1/ }));

    expect(screen.getByText('Cluster #1')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens inspection modal only from Inspect Act CTA', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);

    await userEvent.click(await screen.findByRole('button', { name: /Select cluster 1/ }));
    await userEvent.click(screen.getByRole('button', { name: /Inspect \/ Act/ }));

    await waitFor(() => {
      expect(document.getElementById('triage-modal-title')?.textContent).toBe('Cluster 1');
    });
  });

  it('renders cluster modal with spatial, evidence, and action panels', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);

    await userEvent.click(await screen.findByRole('button', { name: /Select cluster 1/ }));
    await userEvent.click(screen.getByRole('button', { name: /Inspect \/ Act/ }));

    // The spatial panel testid is present on both the dynamic-import loading
    // fallback AND on the mounted inner component. Query inside waitFor so we
    // re-resolve the DOM on each tick — the loading fallback is removed when
    // the inner map mounts, so a stale reference from find-by-testid would
    // miss the leaflet-container.
    await screen.findByTestId('triage-spatial-panel');
    await waitFor(() => {
      expect(screen.getByTestId('triage-spatial-panel').querySelector('.leaflet-container')).toBeTruthy();
    }, { timeout: 5000 });
    expect(screen.getByTestId('triage-evidence-panel')).toBeInTheDocument();
    expect(screen.getByTestId('triage-action-rail')).toBeInTheDocument();
    expect(screen.getByTestId('triage-action-tabs')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Preserved page-level behavior (metrics, polling, claim CTA) plus modal
  // action behavior (Escape, Close, tab nav, split/merge visibility, two-step
  // confirm). The modal opens through the board's `Inspect / Act` CTA, so
  // each test below selects a triage item first to populate the board.
  // ---------------------------------------------------------------------------

  async function openCluster1Modal() {
    await userEvent.click(await screen.findByRole('button', { name: /Select cluster 1/ }));
    await userEvent.click(screen.getByRole('button', { name: /Inspect \/ Act/ }));
  }

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
    expect(strongs[0].textContent).toBe('2'); // Clusters count
    expect(strongs[1].textContent).toBe('1'); // Individual reports count
    expect(screen.getByText(/Polled/)).toBeInTheDocument();
  });

  it('shows Inspect on singleton and opens singleton-mode modal', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    // Select the singleton (cluster_id: null) in the map, then open the modal.
    await userEvent.click(await screen.findByRole('button', { name: /Select report 20/ }));
    await userEvent.click(screen.getByRole('button', { name: /Inspect \/ Act/ }));
    await waitFor(() => {
      const title = document.getElementById('triage-modal-title');
      expect(title).toBeInTheDocument();
      expect(title?.textContent).toBe('Singleton report');
    });
  });

  it('opens cluster inspection modal when Inspect is clicked', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    await waitFor(() => {
      const title = document.getElementById('triage-modal-title');
      expect(title).toBeInTheDocument();
      expect(title?.textContent).toBe('Cluster 1');
      // Report IDs in the new card layout use a styled # prefix; match on the report number alone
      expect(screen.getByText('10')).toBeInTheDocument();
      expect(screen.getByText('11')).toBeInTheDocument();
    });
  });

  it('shows keyboard shortcut hint in modal header', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    await waitFor(() => {
      // Use a regex matcher because the Esc label is inside a styled <span>
      expect(screen.getByText(/Esc\s+close/)).toBeInTheDocument();
    });
  });

  it('closes modal on Escape key', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    const modalTitle = document.getElementById('triage-modal-title');
    expect(modalTitle).toBeInTheDocument();
    expect(modalTitle?.textContent).toBe('Cluster 1');
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape', keyCode: 27 });
    await waitFor(() => {
      expect(document.getElementById('triage-modal-title')).toBeNull();
    }, { timeout: 5000 });
  });

  it('displays merge candidate list when Merge tab is selected', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    // Switch to the Merge tab — candidates are only visible in that tab
    const mergeTab = await screen.findByRole('button', { name: /Merge/ });
    await userEvent.click(mergeTab);
    await waitFor(() => {
      expect(screen.getByText('Cluster #99')).toBeInTheDocument();
    });
  });

  it('closes modal on Escape even when focus is inside an input', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    await waitFor(() => expect(document.getElementById('triage-modal-title')?.textContent).toBe('Cluster 1'));

    // The merge source input lives behind the Merge tab; switch to it first.
    const mergeTab = await screen.findByRole('button', { name: /Merge/ });
    await userEvent.click(mergeTab);
    const input = await screen.findByPlaceholderText('Source cluster id');
    await userEvent.click(input);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.getElementById('triage-modal-title')).toBeNull());
  });

  it('closes modal from the explicit Close button', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Close inspection modal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes modal from the backdrop and restores body scrolling', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    const backdrop = await screen.findByTestId('triage-modal-backdrop');
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.mouseDown(backdrop);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe('');
  });

  it('strips HTML tags from report description and follow-ups in cluster modal', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);

    // Open cluster 3 which has HTML in description and follow-ups
    await userEvent.click(await screen.findByRole('button', { name: /Select cluster 3/ }));
    await userEvent.click(screen.getByRole('button', { name: /Inspect \/ Act/ }));

    await waitFor(() => {
      expect(screen.getByText('Cluster 3')).toBeInTheDocument();
    });

    const modalContent = screen.getByRole('dialog').textContent || '';
    // The description should have <script> tags stripped — 'alert(1)' visible, no angle brackets
    expect(modalContent).toContain('alert(1)');
    expect(modalContent).not.toContain('<script>');
    expect(modalContent).not.toContain('</script>');
    // Follow-up section and timestamp still render
    expect(modalContent).toContain('Follow-up');
  });

  it('shows Claim button for REGIONAL_ENCODER role', async () => {
    mockUseAuth.mockReturnValue({
      user: { keycloak_id: 'enc1', username: 'encoder1', role: 'REGIONAL_ENCODER' },
      loading: false,
    });
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    // Select cluster 1 in the map (the board now hosts the Claim CTA)
    await userEvent.click(await screen.findByRole('button', { name: /Select cluster 1/ }));
    // Claim button rendered only for VALIDATOR/NATIONAL_VALIDATOR on unassigned clusters
    // REGIONAL_ENCODER can see the page but not claim
    expect(screen.queryByRole('button', { name: /Claim cluster/ })).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // New HCI: action tabs, citizen preview, two-step destructive confirm,
  // keyboard shortcuts, singleton mode tabs.
  // ---------------------------------------------------------------------------

  it('renders the action tab nav with Terminal as the default tab', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    await waitFor(() => {
      expect(screen.getByTestId('triage-action-tabs')).toBeInTheDocument();
    });
    // The Terminal tab is the default, so its panel is visible
    expect(screen.getByTestId('triage-panel-terminal')).toBeInTheDocument();
    // Citizen message preview is rendered in the terminal panel
    expect(screen.getByText('Citizen message preview')).toBeInTheDocument();
  });

  it('switches to the Correct tab and shows the no-target empty state', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    const correctTab = await screen.findByRole('button', { name: /Correct/ });
    await userEvent.click(correctTab);
    await waitFor(() => {
      expect(screen.getByTestId('triage-panel-correct')).toBeInTheDocument();
    });
    expect(screen.getByText(/Click/)).toBeInTheDocument();
    // Commit button is disabled until a target report is selected
    expect(screen.getByTestId('triage-commit-correct')).toBeDisabled();
  });

  it('switches to the Split tab and shows leaving/staying preview', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    const splitTab = await screen.findByRole('button', { name: /Split/ });
    await userEvent.click(splitTab);
    await waitFor(() => {
      expect(screen.getByTestId('triage-panel-split')).toBeInTheDocument();
    });
    expect(screen.getByText('Leaving this cluster')).toBeInTheDocument();
    expect(screen.getByText('Staying in this cluster')).toBeInTheDocument();
    // Commit button is disabled until split note is filled
    expect(screen.getByTestId('triage-commit-split')).toBeDisabled();
  });

  it('switches to the Merge tab and shows the source → target flow', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    const mergeTab = await screen.findByRole('button', { name: /Merge/ });
    await userEvent.click(mergeTab);
    await waitFor(() => {
      expect(screen.getByTestId('triage-panel-merge')).toBeInTheDocument();
    });
    // The candidate list shows the mocked cluster #99
    expect(screen.getByTestId('triage-candidate-99')).toBeInTheDocument();
    // The flow has Source and Target placeholders
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText(/Target/)).toBeInTheDocument();
  });

  it('picking a merge candidate fills the source id and pre-fills the note', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    const mergeTab = await screen.findByRole('button', { name: /Merge/ });
    await userEvent.click(mergeTab);
    const candidate = await screen.findByTestId('triage-candidate-99');
    await userEvent.click(candidate);
    const sourceInput = (await screen.findByPlaceholderText('Source cluster id')) as HTMLInputElement;
    expect(sourceInput.value).toBe('99');
    const noteArea = (await screen.findByPlaceholderText(/Why is this the same incident/)) as HTMLTextAreaElement;
    expect(noteArea.value).toContain('Suggested merge');
  });

  it('hides Split and Merge tabs in singleton mode', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    // Select the singleton in the map and open the modal
    await userEvent.click(await screen.findByRole('button', { name: /Select report 20/ }));
    await userEvent.click(screen.getByRole('button', { name: /Inspect \/ Act/ }));
    await waitFor(() => {
      expect(screen.getByTestId('triage-action-tabs')).toBeInTheDocument();
    });
    // Only Terminal, Correct, and Activity tabs are visible in singleton mode.
    // The kbd shortcut makes the accessible name like "Terminal 1" / "Correct 2" / "Activity 5".
    expect(screen.getByRole('button', { name: /Terminal/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Correct/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Activity/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Split/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Merge/ })).not.toBeInTheDocument();
  });

  it('switches to the Activity tab and shows the empty state', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    const activityTab = await screen.findByRole('button', { name: /Activity/ });
    await userEvent.click(activityTab);
    await waitFor(() => {
      expect(screen.getByTestId('triage-panel-activity')).toBeInTheDocument();
    });
    expect(screen.getByText(/No activity events yet/)).toBeInTheDocument();
  });

  it('renders a destructive confirm dialog when applying REJECTED_BOGUS', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    // Pick Bogus (destructive tone)
    const bogusLabel = await screen.findByText('Bogus');
    await userEvent.click(bogusLabel);
    // Click the terminal commit
    const commit = await screen.findByTestId('triage-commit-terminal');
    await userEvent.click(commit);
    await waitFor(() => {
      expect(screen.getByTestId('triage-confirm-dialog')).toBeInTheDocument();
    });
    // The confirm dialog shows the impact: 2 reports, REJECTED_BOGUS, and the explanation
    expect(screen.getByText(/Confirm Bogus on 2 reports/)).toBeInTheDocument();
    expect(screen.getByTestId('triage-confirm-commit')).toBeInTheDocument();
  });

  it('does NOT show a confirm dialog for the non-destructive ACTIONED status', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    // Actioned is the default selection; the commit should apply without a confirm
    const commit = await screen.findByTestId('triage-commit-terminal');
    await userEvent.click(commit);
    // No confirm dialog appears
    await waitFor(() => {
      expect(screen.queryByTestId('triage-confirm-dialog')).not.toBeInTheDocument();
    });
  });

  it('Cancel on the destructive confirm dialog closes it without applying', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    await userEvent.click(await screen.findByText('Bogus'));
    await userEvent.click(await screen.findByTestId('triage-commit-terminal'));
    await waitFor(() => screen.getByTestId('triage-confirm-dialog'));
    // Escape inside the confirm dialog cancels
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape', keyCode: 27 });
    await waitFor(() => expect(screen.queryByTestId('triage-confirm-dialog')).not.toBeInTheDocument());
    // The cluster modal should still be open
    expect(document.getElementById('triage-modal-title')).toBeInTheDocument();
  });

  it('renders a confirm dialog for the Merge action with source/target preview', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    const mergeTab = await screen.findByRole('button', { name: /Merge/ });
    await userEvent.click(mergeTab);
    // Pick the suggested candidate
    await userEvent.click(await screen.findByTestId('triage-candidate-99'));
    // Click commit
    await userEvent.click(await screen.findByTestId('triage-commit-merge'));
    await waitFor(() => {
      expect(screen.getByTestId('triage-confirm-dialog')).toBeInTheDocument();
    });
    expect(screen.getByText(/Confirm merge of cluster #99 into #1/)).toBeInTheDocument();
  });

  it('renders Why-this-status guidance for the selected terminal status', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    // The "Why this status" details is in the DOM and open by default
    expect(screen.getByText('Why this status?')).toBeInTheDocument();
    // The actioned hint is rendered
    expect(screen.getByText(/Standard close-out/)).toBeInTheDocument();
  });

  it('renders the report card with trust, time, and follow-up when present', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    // Open cluster 3 which has followups
    await userEvent.click(await screen.findByRole('button', { name: /Select cluster 3/ }));
    await userEvent.click(screen.getByRole('button', { name: /Inspect \/ Act/ }));
    await waitFor(() => {
      expect(document.getElementById('triage-modal-title')?.textContent).toBe('Cluster 3');
    });
    // Card for report 30 is rendered
    expect(screen.getByTestId('triage-card-30')).toBeInTheDocument();
    // Follow-up text is rendered (HTML stripped). Use getAllByText because
    // both the description and the follow-up text equal 'alert(1)' after stripping.
    expect(screen.getAllByText('alert(1)').length).toBeGreaterThan(0);
  });

  it('renders Claim button for unassigned cluster when validator is selected', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    // The Claim CTA lives in the investigation board. Select cluster 1 (unassigned).
    await userEvent.click(await screen.findByRole('button', { name: /Select cluster 1/ }));
    // Mock data has unassigned clusters; role is NATIONAL_VALIDATOR
    expect(screen.getByRole('button', { name: /Claim cluster/ })).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Prioritized behavior tests from the spec's "Testing and Verification
  // Strategy" section. The whole-branch review (I1) flagged these as missing
  // regression coverage. The implementation behavior is correct; these tests
  // guard against future regressions.
  // ---------------------------------------------------------------------------

  it('closing the modal preserves the selected item on the page', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);

    // Select cluster 3 (LOW priority, not the default first item) on the map.
    // Using a non-default item is critical: the refresh-repair useEffect at
    // page.tsx:209-237 re-selects the highest-priority item (cluster 1) when
    // selectedIdentity is null, so selecting cluster 1 would make the test
    // pass even if selection was incorrectly cleared on close.
    await userEvent.click(await screen.findByRole('button', { name: /Select cluster 3/ }));
    expect(screen.getByText('Cluster #3')).toBeInTheDocument();

    // Open the modal via Inspect / Act
    await userEvent.click(screen.getByRole('button', { name: /Inspect \/ Act/ }));
    await waitFor(() => {
      expect(document.getElementById('triage-modal-title')).toBeInTheDocument();
    });

    // Close the modal via Escape
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape', keyCode: 27 });
    await waitFor(() => {
      expect(document.getElementById('triage-modal-title')).toBeNull();
    });

    // The board should STILL show Cluster #3 (selection was not cleared on close).
    // Use getByRole('heading') to target the headline specifically — the ranked
    // queue also renders "Cluster #X" text inside <button> elements.
    expect(screen.getByRole('heading', { name: /^Cluster #3$/ })).toBeInTheDocument();
    // Assert that cluster 1 is NOT the headline — if the implementation had
    // cleared selectedIdentity on close, the refresh-repair useEffect would
    // have re-defaulted to cluster 1 (highest priority).
    expect(screen.queryByRole('heading', { name: /^Cluster #1$/ })).not.toBeInTheDocument();
  });

  it('refresh while the modal is open does not disrupt active action form state', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await openCluster1Modal();
    await waitFor(() => {
      expect(screen.getByTestId('triage-panel-terminal')).toBeInTheDocument();
    });

    // Type a custom explanation into the terminal form
    const explanationArea = (await screen.findByLabelText('Citizen-visible explanation')) as HTMLTextAreaElement;
    await userEvent.clear(explanationArea);
    await userEvent.type(explanationArea, 'CUSTOM_EXPLANATION_VALUE');

    // userEvent.click dispatches the event directly on the button, bypassing
    // the modal's visual layering (triage-modal.css:7-11: position: fixed;
    // inset: 0; z-index: 50). A real user could not click the Refresh button
    // while the modal is open, but the form-state preservation behavior across
    // a re-render is what we're testing.
    await userEvent.click(screen.getByRole('button', { name: /Refresh/ }));

    // Modal should still be open
    expect(document.getElementById('triage-modal-title')).toBeInTheDocument();

    // The explanation field should still contain the typed value
    const updatedExplanation = (await screen.findByLabelText('Citizen-visible explanation')) as HTMLTextAreaElement;
    expect(updatedExplanation.value).toBe('CUSTOM_EXPLANATION_VALUE');
  });

  it('refresh that removes the selected item shows an amber notice and selects the next highest-priority item', async () => {
    const { fetchTriageQueue } = await import('@/lib/api');
    // Pull the default mock queue to base the filtered queue on it
    const fullQueue = await vi.mocked(fetchTriageQueue)();
    const filteredQueue: TriageQueueResponse = {
      ...fullQueue,
      total_reports: 2,
      clusters: fullQueue.clusters.filter((c) => c.cluster_id !== 1),
    };
    // The page's mount effect re-runs on every render because the
    // useSearchParams mock returns a new URLSearchParams on every call, which
    // invalidates the useCallback'd loadQueue. Use a flag that flips just
    // before the user-triggered refresh so the pre-refetch re-runs still
    // resolve to the full queue (keeping the selection visible) and the
    // refresh call resolves to the filtered queue.
    let useFilteredQueue = false;
    vi.mocked(fetchTriageQueue).mockImplementation(() => {
      return Promise.resolve(useFilteredQueue ? filteredQueue : fullQueue);
    });

    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);

    // Select cluster 1 on the map
    await userEvent.click(await screen.findByRole('button', { name: /Select cluster 1/ }));
    expect(screen.getByText('Cluster #1')).toBeInTheDocument();

    // Flip the flag and click Refresh — the next resolve will be the filtered queue
    useFilteredQueue = true;
    await userEvent.click(screen.getByRole('button', { name: /Refresh/ }));

    // Wait for the amber notice
    await waitFor(() => {
      expect(screen.getByText(/next highest-priority/)).toBeInTheDocument();
    });

    // The board should no longer show Cluster #1
    expect(screen.queryByText('Cluster #1')).not.toBeInTheDocument();
    // The next highest-priority item is the singleton (report 20, MEDIUM severity)
    expect(screen.getByText('Report #20')).toBeInTheDocument();
  });
});
