import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FireStationsMapInner } from './FireStationsMapInner';

const mockMap = {
  setView: vi.fn(),
  fitBounds: vi.fn(),
  getBounds: vi.fn(),
};

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: ({ eventHandlers }: { eventHandlers?: { tileerror?: () => void } }) => (
    <button data-testid="tile-layer" onClick={eventHandlers?.tileerror} type="button">
      tile-layer
    </button>
  ),
  Marker: ({
    children,
    eventHandlers,
    opacity,
  }: {
    children?: React.ReactNode;
    eventHandlers?: { click?: () => void };
    opacity?: number;
  }) => (
    <div data-testid="marker" data-opacity={opacity} onClick={eventHandlers?.click}>
      {children}
    </div>
  ),
  Popup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popup">{children}</div>
  ),
  useMap: () => mockMap,
}));

vi.mock('@/components/map/leafletIcons', () => ({
  firePinIcon: { options: { className: 'leaflet-fire-pin' } },
  userLocationIcon: { options: { className: 'leaflet-user-location' } },
}));

const stations = [
  { station_id: 1, station_name: 'Central Station', latitude: 14.6, longitude: 121, distance_m: null },
  { station_id: 2, station_name: 'North Station', latitude: 15, longitude: 121.1, distance_m: null },
];

describe('FireStationsMapInner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders TileLayer and MapContainer with required props', () => {
    render(<FireStationsMapInner stations={[]} />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('tile-layer')).toBeInTheDocument();
  });

  it('centers around the user location when available', () => {
    render(<FireStationsMapInner stations={[]} userLocation={[14.6, 121.0]} />);
    expect(mockMap.setView).toHaveBeenCalledWith([14.6, 121.0], 12);
    expect(screen.getByText('Your location')).toBeInTheDocument();
  });

  it('retains every pin and highlights the chosen station while centering it', () => {
    const onSelectStation = vi.fn();
    const { rerender } = render(<FireStationsMapInner stations={stations} onSelectStation={onSelectStation} />);

    expect(screen.getAllByTestId('marker')).toHaveLength(2);
    fireEvent.click(screen.getAllByTestId('marker')[1]);
    expect(onSelectStation).toHaveBeenCalledWith(stations[1]);

    rerender(<FireStationsMapInner stations={stations} selectedStationId={2} onSelectStation={onSelectStation} />);

    const markers = screen.getAllByTestId('marker');
    expect(markers).toHaveLength(2);
    expect(markers[0]).toHaveAttribute('data-opacity', '0.55');
    expect(markers[1]).toHaveAttribute('data-opacity', '1');
    expect(mockMap.setView).toHaveBeenCalledWith([15, 121.1], 14);
  });

  it('surfaces tile failures through the tileerror handler', () => {
    const onMapError = vi.fn();
    render(<FireStationsMapInner stations={stations} onMapError={onMapError} />);

    fireEvent.click(screen.getByTestId('tile-layer'));

    expect(onMapError).toHaveBeenCalledTimes(1);
  });
});
