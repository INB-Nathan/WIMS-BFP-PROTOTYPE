import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FireStationsMapInner } from './FireStationsMapInner';

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
  useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn(), getBounds: vi.fn() }),
}));

describe('FireStationsMapInner', () => {
  it('renders TileLayer and MapContainer with required props', () => {
    render(<FireStationsMapInner stations={[]} />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('tile-layer')).toBeInTheDocument();
  });
});
