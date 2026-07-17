import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RouteFeedback } from './RouteFeedback';
import type { PublicTrackingData } from '@/lib/api/tracking';

vi.mock('@/components/map/RouteMap', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="route-map" data-props={JSON.stringify(props)} />
  ),
}));

const station = { name: 'Station A', lat: 14.61, lng: 121.01 };
const validGeometry = {
  type: 'LineString',
  coordinates: [[121, 14.5], [121.01, 14.61]],
};

function tracking(overrides: Partial<PublicTrackingData> = {}): PublicTrackingData {
  return {
    report_id: 7,
    category: 'NON_STRUCTURAL',
    sub_category: null,
    safety_status: 'UNKNOWN',
    status: 'PENDING',
    guidance: null,
    escalation_guidance: null,
    nearest_station_name: 'Station A',
    nearest_station_phone: null,
    routing_distance_m: 1500,
    routing_duration_s: 300,
    routing_geometry: validGeometry,
    routing_data_source: 'osrm',
    photo_count: 0,
    status_updates: [],
    created_at: '2026-07-15T10:00:00.000Z',
    ...overrides,
  };
}

const baseProps = { reportLat: 14.5, reportLng: 121, station };

describe('RouteFeedback', () => {
  it('renders RouteMap and derives Routed only from valid geometry', () => {
    render(<RouteFeedback {...baseProps} tracking={tracking()} loading={false} />);

    expect(screen.getByTestId('route-feedback')).toHaveAttribute('data-state', 'SUCCESS');
    expect(screen.getByTestId('route-state-badge')).toHaveTextContent('Routed');
    expect(screen.getByTestId('route-map')).toHaveAttribute(
      'data-props',
      expect.stringContaining('Road route to Station A'),
    );
    expect(document.querySelector('svg[aria-label^="Straight-line route"]')).not.toBeInTheDocument();
  });

  it.each([
    ['null', null],
    ['malformed', { type: 'Point', coordinates: [121, 14.5] }],
  ])('labels %s geometry as Estimated despite an OSRM source', (_label, geometry) => {
    render(
      <RouteFeedback
        {...baseProps}
        tracking={tracking({ routing_geometry: geometry })}
        loading={false}
      />,
    );

    expect(screen.getByTestId('route-feedback')).toHaveAttribute('data-state', 'FAILED');
    expect(screen.getByTestId('route-state-badge')).toHaveTextContent('Estimated');
    expect(screen.getByText(/showing estimated distance/i)).toBeInTheDocument();
  });

  it('shows the endpoint map and Calculating label while polling', () => {
    render(<RouteFeedback {...baseProps} tracking={null} loading />);

    expect(screen.getByTestId('route-map')).toBeInTheDocument();
    expect(screen.getByTestId('route-state-badge')).toHaveTextContent('Calculating');
  });

  it('does not invent station coordinates when the station is missing', () => {
    render(<RouteFeedback reportLat={14.5} reportLng={121} station={null} tracking={null} loading />);

    expect(screen.queryByTestId('route-map')).not.toBeInTheDocument();
    expect(screen.getByText('Station location unavailable')).toBeInTheDocument();
  });
});
