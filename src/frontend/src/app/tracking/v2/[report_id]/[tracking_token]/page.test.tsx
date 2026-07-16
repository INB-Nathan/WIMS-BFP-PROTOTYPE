import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockParams = { report_id: '42', tracking_token: 'token-abc' };

vi.mock('next/navigation', () => ({
  useParams: () => mockParams,
}));

const publicApiFetchMock = vi.fn();
vi.mock('@/lib/api/public-transport', () => ({
  publicApiFetch: (...args: unknown[]) => publicApiFetchMock(...args),
}));

// The route map dynamically imports react-leaflet under the hood; replace it
// with a lightweight stand-in so this test stays focused on page chrome.
vi.mock('./TrackingRouteMap', () => ({
  TrackingRouteMap: ({ geometry }: { geometry: Record<string, unknown> | null }) =>
    geometry ? <div data-testid="tracking-route-map" /> : null,
}));

const BASE_TRACKING_DATA = {
  report_id: 42,
  category: 'STRUCTURAL',
  sub_category: null,
  reporting_context: null,
  safety_status: null,
  status: 'PENDING',
  status_explanation: null,
  guidance: 'Please stay clear of the area.',
  escalation_guidance: null,
  related_cluster_status: null,
  nearest_station_name: 'BFP Antipolo Central',
  nearest_station_phone: '0917-000-0000',
  routing_distance_m: 1200,
  routing_duration_s: 240,
  routing_data_source: 'osrm',
  routing_geometry: null,
  photo_count: 0,
  submitter_type: 'CIVILIAN',
  link_count: 0,
  created_at: '2026-07-15T14:32:00Z',
};

describe('TrackingV2Page', () => {
  beforeEach(() => {
    vi.resetModules();
    publicApiFetchMock.mockReset();
  });

  it('renders the dark-styled status card without crashing when routing_geometry is null', async () => {
    publicApiFetchMock.mockResolvedValue(BASE_TRACKING_DATA);

    const { default: Page } = await import('./page');
    render(<Page />);

    expect(await screen.findByText('Report Received')).toBeInTheDocument();
    expect(screen.queryByTestId('tracking-route-map')).not.toBeInTheDocument();
  });

  it('renders the route map when routing_geometry is present', async () => {
    publicApiFetchMock.mockResolvedValue({
      ...BASE_TRACKING_DATA,
      routing_geometry: {
        type: 'LineString',
        coordinates: [
          [121.05, 14.6],
          [121.06, 14.61],
        ],
      },
    });

    const { default: Page } = await import('./page');
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByTestId('tracking-route-map')).toBeInTheDocument();
    });
  });

  it('renders exactly one page title/branding block (no duplicate hero)', async () => {
    publicApiFetchMock.mockResolvedValue(BASE_TRACKING_DATA);

    const { default: Page } = await import('./page');
    render(<Page />);

    await screen.findByText('Report Received');
    expect(screen.getAllByText('Track Emergency Report')).toHaveLength(1);
  });

  it('shows an error state on 404 without crashing', async () => {
    const { ApiRequestError } = await import('@/lib/api/errors');
    publicApiFetchMock.mockRejectedValue(new ApiRequestError('not found', 404));

    const { default: Page } = await import('./page');
    render(<Page />);

    expect(
      await screen.findByText(/report not found/i),
    ).toBeInTheDocument();
  });
});
