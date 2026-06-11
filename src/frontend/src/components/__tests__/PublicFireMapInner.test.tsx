import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PublicFireMapInner from '../PublicFireMapInner';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  CircleMarker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="circle-marker">{children}</div>
  ),
  Popup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popup">{children}</div>
  ),
  Marker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="marker">{children}</div>
  ),
  useMapEvents: () => ({
    getBounds: () => ({
      getNorthEast: () => ({ lat: 15, lng: 122 }),
      getSouthWest: () => ({ lat: 14, lng: 120 }),
    }),
    getZoom: () => 10,
  }),
}));

const mockFetchClusters = vi.fn();
vi.mock('@/lib/api', () => ({
  fetchClusters: (...args: unknown[]) => mockFetchClusters(...args),
}));

describe('PublicFireMapInner', () => {
  it('renders TileLayer and MapContainer with required props', () => {
    render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('tile-layer')).toBeInTheDocument();
  });
});
