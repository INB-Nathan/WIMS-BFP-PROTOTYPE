import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  registerNotification: vi.fn(),
  submitFollowup: vi.fn(),
}));

vi.mock('@/lib/api/offlineCivilianReads', () => ({
  fetchMyReportsOfflineAware: vi.fn().mockResolvedValue({
    response: { reports: [{ report_id: 42 }] },
    fromCache: false,
  }),
  fetchReportStatusOfflineAware: vi.fn().mockResolvedValue({
    response: {
      report_id: 42,
      status: 'ACTIONED',
      created_at: '2026-05-19T08:00:00Z',
    },
    fromCache: false,
  }),
  fetchReportTimelineOfflineAware: vi.fn().mockResolvedValue({
    response: { timeline: [], followups: [] },
    fromCache: false,
  }),
}));

vi.mock('@/lib/firebase', () => ({
  getMessagingToken: vi.fn(),
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={String(props.alt ?? '')} />;
  },
}));

describe('ReportTrackerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.pushState({}, '', '/tracking');
  });

  it('loads report status from the id query parameter', async () => {
    const mockFetchReportStatus = (await import('@/lib/api/offlineCivilianReads')).fetchReportStatusOfflineAware as ReturnType<typeof vi.fn>;
    mockFetchReportStatus.mockResolvedValue({
      response: {
        report_id: 42,
        status: 'ACTIONED',
        created_at: '2026-05-19T08:00:00Z',
      },
      fromCache: false,
    });
    localStorage.setItem('wims_civilian_device_id', 'device-a');
    window.history.pushState({}, '', '/tracking?id=42');

    const { default: ReportTrackerPage } = await import('./page');
    render(<ReportTrackerPage />);

    expect(screen.getByDisplayValue('42')).toBeDefined();
    await waitFor(() => expect(mockFetchReportStatus).toHaveBeenCalledWith('42', 'device-a'));
    expect(await screen.findByText('ACTIONED')).toBeDefined();
  });

  it('uses neutral active-operation copy for linked reports', async () => {
    const mockFetchReportStatus = (await import('@/lib/api/offlineCivilianReads')).fetchReportStatusOfflineAware as ReturnType<typeof vi.fn>;
    mockFetchReportStatus.mockResolvedValue({
      response: {
        report_id: 42,
        status: 'LINKED',
        created_at: '2026-05-19T08:00:00Z',
      },
      fromCache: false,
    });
    localStorage.setItem('wims_civilian_device_id', 'device-a');
    window.history.pushState({}, '', '/tracking?id=42');

    const { default: ReportTrackerPage } = await import('./page');
    render(<ReportTrackerPage />);

    expect(await screen.findByText('Linked to Active BFP Operation')).toBeInTheDocument();
    expect(screen.getByText(/linked to an active BFP operation/i)).toBeInTheDocument();
    expect(screen.queryByText(/another report/i)).toBeNull();
  });

  it('renders the bilingual 911 emergency boundary on a PENDING report (not only REJECTED_*)', async () => {
    const mockFetchReportStatus = (await import('@/lib/api/offlineCivilianReads')).fetchReportStatusOfflineAware as ReturnType<typeof vi.fn>;
    mockFetchReportStatus.mockResolvedValue({
      response: {
        report_id: 42,
        status: 'PENDING',
        created_at: '2026-05-19T08:00:00Z',
      },
      fromCache: false,
    });
    localStorage.setItem('wims_civilian_device_id', 'device-a');
    window.history.pushState({}, '', '/tracking?id=42');

    const { default: ReportTrackerPage } = await import('./page');
    render(<ReportTrackerPage />);

    // Wait for the data to load, then assert the 911 boundary is present
    // for a PENDING (non-REJECTED) status. The gap register item (3)
    // previously claimed the boundary only rendered for REJECTED_* statuses.
    // The 911 boundary must appear across all statuses — PENDING/UNDER_REVIEW/
    // LINKED get the prominent red variant, ACTIONED a muted variant, and
    // REJECTED_* the prominent red variant. This test locks the PENDING path.
    expect(
      await screen.findByText(/For urgent emergencies, call 911\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /This report helps BFP review signals — it does not replace an emergency call\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Ang report na ito ay tumutulong sa BFP na suriin ang mga signal/,
      ),
    ).toBeInTheDocument();
  });
});
