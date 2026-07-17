import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteMapInner } from '../RouteMapInner';

const mapMocks = vi.hoisted(() => ({
  fitBounds: vi.fn(),
  setView: vi.fn(),
  boundsPoints: [] as [number, number][],
}));

// Mock react-leaflet components.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div data-testid="map-container" style={style}>{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  Marker: ({
    position,
    icon,
  }: {
    position: [number, number];
    icon: unknown;
  }) => (
    <div
      data-testid="marker"
      data-position={JSON.stringify(position)}
      data-icon={icon ? 'present' : 'none'}
    />
  ),
  Polyline: ({
    positions,
    pathOptions,
  }: {
    positions: [number, number][];
    pathOptions?: { dashArray?: string; color?: string };
  }) => (
    <div
      data-testid="polyline"
      data-positions={JSON.stringify(positions)}
      data-dasharray={pathOptions?.dashArray ?? 'none'}
      data-color={pathOptions?.color ?? 'none'}
    />
  ),
  useMap: () => mapMocks,
}));

// Mock leaflet's latLngBounds.
vi.mock('leaflet', () => {
  const latLngBounds = vi.fn((points: [number, number][]) => {
    mapMocks.boundsPoints = points;
    const coincident = points.every(([lat, lng]) => lat === points[0][0] && lng === points[0][1]);
    const southwest = { lat: points[0][0], lng: points[0][1] };
    return {
      isValid: vi.fn(() => true),
      getNorthEast: vi.fn(() => ({ equals: vi.fn(() => coincident) })),
      getSouthWest: vi.fn(() => southwest),
    };
  });
  const divIcon = vi.fn(() => ({ options: {} }));
  return {
    default: { latLngBounds, divIcon, Icon: { Default: { prototype: {} } } },
    latLngBounds,
    divIcon,
    icon: vi.fn(() => ({ options: {} })),
    Icon: { Default: { prototype: {} } },
  };
});

// Mock RoutePolyline to avoid react-leaflet Polyline dependency in dash test.
vi.mock('@/components/map/RoutePolyline', () => ({
  parseLineStringToLatLng: vi.fn(),
  RoutePolyline: ({
    geometry,
    color,
    weight,
  }: {
    geometry: Record<string, unknown>;
    color?: string;
    weight?: number;
  }) => {
    if (!geometry) return null;
    return (
      <div
        data-testid="route-polyline"
        data-color={color}
        data-weight={weight}
      />
    );
  },
}));

import { parseLineStringToLatLng } from '@/components/map/RoutePolyline';

const VALID_GEOMETRY = {
  type: 'LineString',
  coordinates: [
    [121.05, 14.6],
    [121.06, 14.61],
    [121.07, 14.62],
  ],
};

const BASE_PROPS = {
  reportLat: 14.6,
  reportLng: 121.05,
  stationLat: 14.65,
  stationLng: 121.1,
  stationName: 'BFP Test Station',
};

describe('RouteMapInner', () => {
  beforeEach(() => {
    vi.mocked(parseLineStringToLatLng).mockReturnValue(null);
    mapMocks.fitBounds.mockReset();
    mapMocks.setView.mockReset();
    mapMocks.boundsPoints = [];
  });

  it('renders map container and tile layer', () => {
    render(<RouteMapInner {...BASE_PROPS} />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('tile-layer')).toBeInTheDocument();
  });

  it('renders report and station markers', () => {
    render(<RouteMapInner {...BASE_PROPS} />);
    const markers = screen.getAllByTestId('marker');
    expect(markers).toHaveLength(2);

    // Report marker at report position.
    expect(markers[0]).toHaveAttribute(
      'data-position',
      JSON.stringify([BASE_PROPS.reportLat, BASE_PROPS.reportLng]),
    );
    // Station marker at station position.
    expect(markers[1]).toHaveAttribute(
      'data-position',
      JSON.stringify([BASE_PROPS.stationLat, BASE_PROPS.stationLng]),
    );
  });

  it('renders road polyline and fits its positions when geometry is valid', () => {
    const routePositions: [number, number][] = [
      [14.6, 121.05],
      [14.61, 121.06],
      [14.62, 121.07],
    ];
    vi.mocked(parseLineStringToLatLng).mockReturnValue(routePositions);

    render(<RouteMapInner {...BASE_PROPS} geometry={VALID_GEOMETRY} />);
    expect(screen.getByTestId('route-polyline')).toBeInTheDocument();
    expect(screen.queryByTestId('polyline')).not.toBeInTheDocument();
    expect(mapMocks.boundsPoints).toEqual(routePositions);
    expect(mapMocks.fitBounds).toHaveBeenCalledOnce();
  });

  it('renders dashed straight line when geometry is null', () => {
    vi.mocked(parseLineStringToLatLng).mockReturnValue(null);

    render(<RouteMapInner {...BASE_PROPS} geometry={null} />);
    expect(screen.getByTestId('polyline')).toBeInTheDocument();
    expect(screen.queryByTestId('route-polyline')).not.toBeInTheDocument();
    expect(mapMocks.boundsPoints).toEqual([
      [BASE_PROPS.reportLat, BASE_PROPS.reportLng],
      [BASE_PROPS.stationLat, BASE_PROPS.stationLng],
    ]);
    expect(mapMocks.fitBounds).toHaveBeenCalledOnce();
  });

  it('renders dashed straight line when geometry is malformed', () => {
    vi.mocked(parseLineStringToLatLng).mockReturnValue(null);

    render(
      <RouteMapInner
        {...BASE_PROPS}
        geometry={
          { type: 'Point', coordinates: [121.05, 14.6] } as unknown as Record<string, unknown>
        }
      />,
    );
    expect(screen.getByTestId('polyline')).toBeInTheDocument();
    expect(screen.queryByTestId('route-polyline')).not.toBeInTheDocument();
  });

  it('dashed line has dashArray attribute', () => {
    vi.mocked(parseLineStringToLatLng).mockReturnValue(null);

    render(<RouteMapInner {...BASE_PROPS} geometry={null} />);
    const dashed = screen.getByTestId('polyline');
    expect(dashed).toHaveAttribute('data-dasharray', '8 6');
  });

  it('renders dashed straight line when geometry array has fewer than 2 coords', () => {
    // parseLineStringToLatLng returns null for <2 coords.
    vi.mocked(parseLineStringToLatLng).mockReturnValue(null);

    render(
      <RouteMapInner
        {...BASE_PROPS}
        geometry={{ type: 'LineString', coordinates: [[121.05, 14.6]] }}
      />,
    );
    expect(screen.getByTestId('polyline')).toBeInTheDocument();
    expect(screen.queryByTestId('route-polyline')).not.toBeInTheDocument();
  });

  it('uses setView safely for coincident endpoints', () => {
    render(
      <RouteMapInner
        {...BASE_PROPS}
        stationLat={BASE_PROPS.reportLat}
        stationLng={BASE_PROPS.reportLng}
      />,
    );
    expect(mapMocks.fitBounds).not.toHaveBeenCalled();
    expect(mapMocks.setView).toHaveBeenCalledWith(
      [BASE_PROPS.reportLat, BASE_PROPS.reportLng],
      14,
    );
  });

  it('applies height and accessible label', () => {
    render(<RouteMapInner {...BASE_PROPS} height={300} accessibleLabel="Test route" />);
    expect(screen.getByTestId('map-container')).toHaveStyle({ height: '300px' });
    expect(screen.getByRole('img', { name: 'Test route' })).toBeInTheDocument();
  });

  it('handles missing geometry gracefully (null)', () => {
    vi.mocked(parseLineStringToLatLng).mockReturnValue(null);
    render(<RouteMapInner {...BASE_PROPS} />);
    expect(screen.getByTestId('polyline')).toBeInTheDocument();
  });
});
