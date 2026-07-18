/**
 * Test C — Receipt claim handshake (Issue #654).
 *
 * When the signed-in user is a CIVILIAN_REPORTER, the receipt shows a
 * "Link to my account" button that calls claimCivilianReport(). After a
 * successful claim the UI moves to the claimed state and links the dashboard.
 * Anonymous users never see the claim button (they keep the register incentive).
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Receipt, type ReceiptData } from './Receipt';

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={String(props.alt ?? '')} />;
  },
}));

function makeReporter(role: string | null) {
  return {
    user: role ? { id: 'c1', role } : null,
    isAuthenticated: role !== null,
    loading: false,
  };
}

const claimCivilianReport = vi.fn();
const useAuthMock = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/lib/api/legacy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/legacy')>();
  return {
    ...actual,
    claimCivilianReport: (...args: unknown[]) => claimCivilianReport(...args),
  };
});

const baseData: ReceiptData = {
  reportId: 7,
  trackingUrl: 'https://wims.test/tracking/7/abc',
  trackingToken: 'abc',
  createdAt: '2026-07-18T00:00:00Z',
  category: 'FIRE',
  description: 'smoke',
  latitude: 14.6,
  longitude: 120.9,
};

describe('Receipt claim handshake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue(makeReporter('CIVILIAN_REPORTER'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the claim button for a signed-in CIVILIAN_REPORTER', () => {
    render(<Receipt data={baseData} tracking={null} trackingLoading={false} />);
    expect(screen.getByTestId('claim-section')).toBeInTheDocument();
    expect(screen.getByTestId('claim-report')).toHaveTextContent('Link to my account');
  });

  it('does NOT render the claim button for an anonymous user', () => {
    useAuthMock.mockReturnValue(makeReporter(null));
    render(<Receipt data={baseData} tracking={null} trackingLoading={false} />);
    expect(screen.queryByTestId('claim-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('claim-report')).not.toBeInTheDocument();
    // Anonymous keeps the registration incentive instead.
    expect(screen.getByTestId('registration-incentive-toggle')).toBeInTheDocument();
  });

  it('claims the report and links to the dashboard on success', async () => {
    claimCivilianReport.mockResolvedValue({ report_id: 7 });
    render(<Receipt data={baseData} tracking={null} trackingLoading={false} />);

    fireEvent.click(screen.getByTestId('claim-report'));

    // Claimed state surfaces the dashboard link.
    await waitFor(() =>
      expect(screen.getByText(/Linked/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/dashboard/)).toHaveAttribute('href', '/contributor');
    expect(claimCivilianReport).toHaveBeenCalledWith(7, 'abc');
  });

  it('shows the error message when the claim fails', async () => {
    claimCivilianReport.mockRejectedValue(new Error('Report already linked to an account'));
    render(<Receipt data={baseData} tracking={null} trackingLoading={false} />);

    fireEvent.click(screen.getByTestId('claim-report'));

    await waitFor(() =>
      expect(screen.getByText(/Report already linked to an account/)).toBeInTheDocument(),
    );
    // Button remains available for a retry.
    expect(screen.getByTestId('claim-report')).toBeInTheDocument();
  });
});
