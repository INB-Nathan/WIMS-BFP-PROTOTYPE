import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchReportStatus } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  fetchReportStatus: vi.fn(),
  registerNotification: vi.fn(),
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
    window.history.pushState({}, '', '/report/tracking');
  });

  it('loads report status from the id query parameter', async () => {
    vi.mocked(fetchReportStatus).mockResolvedValue({
      report_id: 42,
      status: 'VERIFIED',
      description: 'Smoke visible near the market',
      created_at: '2026-05-19T08:00:00Z',
    });
    window.history.pushState({}, '', '/report/tracking?id=42');

    const { default: ReportTrackerPage } = await import('./page');
    render(<ReportTrackerPage />);

    expect(screen.getByDisplayValue('42')).toBeDefined();
    await waitFor(() => expect(fetchReportStatus).toHaveBeenCalledWith('42'));
    expect(await screen.findByText('VERIFIED')).toBeDefined();
  });
});
