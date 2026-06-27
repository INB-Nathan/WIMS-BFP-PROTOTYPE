import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  TileLayer: () => <div data-testid="tile-layer" />,
  Marker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="marker">{children}</div>
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
});
