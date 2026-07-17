import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockParams = { report_id: '42', tracking_token: 'token-abc' };

vi.mock('next/navigation', () => ({ useParams: () => mockParams }));

const publicApiFetchMock = vi.fn();
vi.mock('@/lib/api/public-transport', () => ({
  publicApiFetch: (...args: unknown[]) => publicApiFetchMock(...args),
}));

vi.mock('./TrackingRouteMap', () => ({
  TrackingRouteMap: ({ geometry }: { geometry: Record<string, unknown> | null }) =>
    geometry ? <div data-testid="tracking-route-map" /> : null,
}));

const BASE_TRACKING_DATA = {
  report_id: 42,
  category: 'STRUCTURAL',
  sub_category: null,
  safety_status: null,
  status: 'PENDING',
  guidance: 'Please stay clear of the area.',
  escalation_guidance: null,
  nearest_station_name: 'BFP Antipolo Central',
  nearest_station_phone: '0917-000-0000',
  routing_distance_m: 1200,
  routing_duration_s: 240,
  routing_data_source: 'osrm',
  routing_geometry: null,
  photo_count: 0,
  status_updates: [],
  created_at: '2026-07-15T14:32:00Z',
};

describe('TrackingV2Page', () => {
  beforeEach(() => {
    vi.resetModules();
    publicApiFetchMock.mockReset();
  });

  it('renders text-only route feedback when routing_geometry is null', async () => {
    publicApiFetchMock.mockResolvedValue(BASE_TRACKING_DATA);
    const { default: Page } = await import('./page');
    render(<Page />);

    expect(await screen.findByText('Road route unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('tracking-route-map')).not.toBeInTheDocument();
  });

  it('renders the route map when routing_geometry is present', async () => {
    publicApiFetchMock.mockResolvedValue({
      ...BASE_TRACKING_DATA,
      routing_geometry: { type: 'LineString', coordinates: [[121.05, 14.6], [121.06, 14.61]] },
    });
    const { default: Page } = await import('./page');
    render(<Page />);

    await waitFor(() => expect(screen.getByTestId('tracking-route-map')).toBeInTheDocument());
  });

  it('renders text-only route feedback when routing_geometry is malformed', async () => {
    publicApiFetchMock.mockResolvedValue({ ...BASE_TRACKING_DATA, routing_geometry: { type: 'Point', coordinates: [121.05, 14.6] } });
    const { default: Page } = await import('./page');
    render(<Page />);

    expect(await screen.findByTestId('routing-text-fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('tracking-route-map')).not.toBeInTheDocument();
  });

  it('renders the receipt QR code and secure tracking token', async () => {
    publicApiFetchMock.mockResolvedValue(BASE_TRACKING_DATA);
    const { default: Page } = await import('./page');
    render(<Page />);

    expect(await screen.findByTestId('qr-code')).toBeInTheDocument();
    expect(screen.getByTestId('tracking-token')).toHaveTextContent('token-abc');
    expect(screen.getByRole('button', { name: 'Copy tracking token' })).toBeInTheDocument();
  });

  it('copies the token through the document fallback when Clipboard API is unavailable', async () => {
    publicApiFetchMock.mockResolvedValue(BASE_TRACKING_DATA);
    const execCommand = vi.fn(() => true);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const { default: Page } = await import('./page');
    render(<Page />);

    fireEvent.click(await screen.findByRole('button', { name: 'Copy tracking token' }));
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('renders stage-specific timeline metadata', async () => {
    publicApiFetchMock.mockResolvedValue({
      ...BASE_TRACKING_DATA,
      status_updates: [
        {
          stage: 'HELP_DISPATCHED',
          metadata: { station_name: 'BFP Antipolo Central', station_phone: '0917-000-0000', jurisdiction: 'Antipolo City' },
          created_at: '2026-07-15T14:35:00Z',
        },
        { stage: 'ON_SCENE', metadata: { arrived_at: '2026-07-15T14:41:00Z' }, created_at: '2026-07-15T14:41:00Z' },
        { stage: 'RESOLVED', metadata: { outcome_summary: 'Fire contained.' }, created_at: '2026-07-15T15:00:00Z' },
      ],
    });
    const { default: Page } = await import('./page');
    render(<Page />);

    expect(await screen.findByText('Help Dispatched')).toBeInTheDocument();
    expect(screen.getByText('Antipolo City')).toBeInTheDocument();
    expect(screen.getByText(/Arrived:/)).toBeInTheDocument();
    expect(screen.getByText('Fire contained.')).toBeInTheDocument();
  });

  it('shows an error state on 404 without crashing', async () => {
    const { ApiRequestError } = await import('@/lib/api/errors');
    publicApiFetchMock.mockRejectedValue(new ApiRequestError('not found', 404));
    const { default: Page } = await import('./page');
    render(<Page />);

    expect(await screen.findByText(/report not found/i)).toBeInTheDocument();
  });
});
