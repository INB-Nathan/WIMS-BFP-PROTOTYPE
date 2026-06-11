import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapPickerInner } from '../MapPickerInner';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  Marker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="marker">{children}</div>
  ),
  useMap: () => ({ setView: vi.fn(), getZoom: () => 12 }),
  useMapEvents: () => null,
}));

const mockSearchGeocode = vi.fn();
vi.mock('@/lib/geocode', () => ({
  searchGeocode: (...args: unknown[]) => mockSearchGeocode(...args),
}));

describe('MapPickerInner', () => {
  it('renders TileLayer and MapContainer with no props (all optional)', () => {
    render(<MapPickerInner />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('tile-layer')).toBeInTheDocument();
  });
});
