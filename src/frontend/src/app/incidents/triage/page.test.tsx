import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type {
  TriageQueueResponse,
  TriageClusterEntry,
  MergeCandidateEntry,
} from '@/lib/api';

vi.mock('@/lib/api', () => {
  const mockQueue: TriageQueueResponse = {
    polled_at: '2026-05-20T10:00:00Z',
    total_reports: 2,
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
        anchor_report_id: 20,
        distance_m: 87.5,
        minutes_apart: 12.3,
        status: 'CLUSTER_MONITORING',
        member_count: 3,
      },
    ]),
    fetchTriageClusterActivity: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { keycloak_id: 'test-id', username: 'validator1', role: 'NATIONAL_VALIDATOR' },
    loading: false,
  }),
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
    window.history.pushState({}, '', '/incidents/triage');
  });

  it('renders the queue with cluster rows', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    await waitFor(() => {
      expect(screen.getByText('Cluster 1')).toBeDefined();
    });
    expect(screen.getByText('2 member(s)')).toBeDefined();
    expect(screen.getByText('HIGH')).toBeDefined();
  });

  it('opens inspection modal when Inspect is clicked', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    const inspectBtn = await waitFor(() =>
      screen.getByRole('button', { name: 'Inspect' }),
    );
    await userEvent.click(inspectBtn);
    await waitFor(() => {
      expect(screen.getByText('#10')).toBeDefined();
      expect(screen.getByText('#11')).toBeDefined();
    });
  });

  it('shows keyboard shortcut hint in modal header', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    const inspectBtn = await waitFor(() =>
      screen.getByRole('button', { name: 'Inspect' }),
    );
    await userEvent.click(inspectBtn);
    await waitFor(() => {
      expect(screen.getByText('Esc close · R refresh')).toBeDefined();
    });
  });

  it('closes modal on Escape key', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    const inspectBtn = await waitFor(() =>
      screen.getByRole('button', { name: 'Inspect' }),
    );
    await userEvent.click(inspectBtn);
    await waitFor(() => expect(screen.getByText('#10')).toBeDefined());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByText('#10')).toBeNull();
    });
  });

  it('displays merge candidate list in modal', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    const inspectBtn = await waitFor(() =>
      screen.getByRole('button', { name: 'Inspect' }),
    );
    await userEvent.click(inspectBtn);
    await waitFor(() => {
      expect(screen.getByText('Cluster #99')).toBeDefined();
    });
  });

  it('does not fire Escape/R when focus is inside input', async () => {
    const { default: TriagePage } = await import('./page');
    render(<TriagePage />);
    const inspectBtn = await waitFor(() =>
      screen.getByRole('button', { name: 'Inspect' }),
    );
    await userEvent.click(inspectBtn);
    await waitFor(() => expect(screen.getByText('#10')).toBeDefined());

    const input = screen.getByPlaceholderText('Source cluster id');
    await userEvent.click(input);
    await userEvent.keyboard('{Escape}');
    // Modal should still be open — Escape was consumed by input guard
    await waitFor(() => expect(screen.queryByText('#10')).toBeDefined());
  });
});