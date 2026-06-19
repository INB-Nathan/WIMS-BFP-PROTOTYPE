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
});
