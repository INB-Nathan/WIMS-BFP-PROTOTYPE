import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchReportStatus, type CivilianReportTrackingResponse } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  fetchReportStatus: vi.fn(),
  fetchMyReports: vi.fn().mockResolvedValue({ reports: [{ report_id: 42 }] }),
  registerNotification: vi.fn(),
  fetchReportTimeline: vi.fn().mockResolvedValue({ timeline: [], followups: [] }),
  submitFollowup: vi.fn(),
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
    vi.mocked(fetchReportStatus).mockResolvedValue({
      report_id: 42,
      status: 'ACTIONED',
      created_at: '2026-05-19T08:00:00Z',
    } as unknown as CivilianReportTrackingResponse);
    localStorage.setItem('wims_civilian_device_id', 'device-a');
    window.history.pushState({}, '', '/tracking?id=42');

    const { default: ReportTrackerPage } = await import('./page');
    render(<ReportTrackerPage />);

    expect(screen.getByDisplayValue('42')).toBeDefined();
    await waitFor(() => expect(fetchReportStatus).toHaveBeenCalledWith('42', 'device-a'));
    expect(await screen.findByText('ACTIONED')).toBeDefined();
  });

  it('renders the bilingual 911 emergency boundary on a PENDING report (not only REJECTED_*)', async () => {
    vi.mocked(fetchReportStatus).mockResolvedValue({
      report_id: 42,
      status: 'PENDING',
      created_at: '2026-05-19T08:00:00Z',
    } as unknown as CivilianReportTrackingResponse);
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
