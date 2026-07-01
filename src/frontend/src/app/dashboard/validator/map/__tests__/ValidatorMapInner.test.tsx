import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ValidatorMapInner from '../ValidatorMapInner';
import type { MapClusterItem } from '@/lib/api/map';

const mockFetchFireStations = vi.hoisted(() =>
  vi.fn().mockResolvedValue([
    {
      station_id: 1,
      station_name: 'Test Station',
      address: '123 Test St',
      region_name: 'NCR',
      latitude: 14.5,
      longitude: 121.0,
    },
  ]),
);

const mockFetchOperations = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@/lib/api', () => ({
  fetchValidatorFireStations: mockFetchFireStations,
  fetchOperations: mockFetchOperations,
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  CircleMarker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="circle-marker">{children}</div>
  ),
  Circle: () => <div data-testid="operation-circle" />,
  Marker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="station-marker">{children}</div>
  ),
  Popup: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="popup">{children}</div>
  ),
  useMapEvents: () => ({
    getZoom: () => 10,
    getBounds: () => ({
      getSouthWest: () => ({ lat: 14.0, lng: 120.0 }),
      getNorthEast: () => ({ lat: 15.0, lng: 121.0 }),
    }),
  }),
  useMap: () => ({
    getZoom: () => 10,
    getBounds: () => ({
      getSouthWest: () => ({ lat: 14.0, lng: 120.0 }),
      getNorthEast: () => ({ lat: 15.0, lng: 121.0 }),
    }),
  }),
}));

let markerCount = 0;

const mockCluster: MapClusterItem = {
  lat: 14.5,
  lng: 121.0,
  count: 5,
  severity: 'medium',
  latest_at: '2026-06-01T00:00:00Z',
};

const mockRichCluster: MapClusterItem = {
  lat: 14.5,
  lng: 121.0,
  count: 5,
  severity: 'medium',
  latest_at: '2026-06-01T00:00:00Z',
  status_breakdown: { PENDING: 2, VERIFIED: 3, REJECTED: 0, PENDING_VALIDATION: 0 },
  category_mix: ['Structural', 'Wildland'],
  total_damage_php: 1500000,
  total_casualties: 3,
  earliest_at: '2026-05-15T00:00:00Z',
  region_id: 1,
};

describe('ValidatorMapInner', () => {
  beforeEach(() => {
    markerCount = 0;
  });

  it('renders map container and tile layer', () => {
    render(
      <ValidatorMapInner
        onViewportChange={vi.fn()}
        clusters={[]}
      />,
    );
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('tile-layer')).toBeInTheDocument();
  });

  it('renders no circle-markers when clusters is empty', () => {
    render(
      <ValidatorMapInner
        onViewportChange={vi.fn()}
        clusters={[]}
      />,
    );
    expect(screen.queryByTestId('circle-marker')).not.toBeInTheDocument();
  });

  it('renders a CircleMarker for each cluster', () => {
    render(
      <ValidatorMapInner
        onViewportChange={vi.fn()}
        clusters={[mockCluster]}
      />,
    );
    expect(screen.getByTestId('circle-marker')).toBeInTheDocument();
  });

  it('renders multiple CircleMarkers for multiple clusters', () => {
    render(
      <ValidatorMapInner
        onViewportChange={vi.fn()}
        clusters={[mockCluster, { ...mockCluster, lat: 14.6, lng: 121.1 }]}
      />,
    );
    expect(screen.getAllByTestId('circle-marker')).toHaveLength(2);
  });

  it('renders fire station toggle button', async () => {
    render(
      <ValidatorMapInner
        onViewportChange={vi.fn()}
        clusters={[]}
      />,
    );
    expect(await screen.findByText(/Stations/)).toBeInTheDocument();
  });

  it('renders operations toggle button', async () => {
    render(
      <ValidatorMapInner
        onViewportChange={vi.fn()}
        clusters={[]}
      />,
    );
    expect(await screen.findByText(/Operations/)).toBeInTheDocument();
  });

  it('renders enriched popup with status breakdown when data exists', () => {
    render(
      <ValidatorMapInner
        onViewportChange={vi.fn()}
        clusters={[mockRichCluster]}
      />,
    );
    expect(screen.getByTestId('popup')).toBeInTheDocument();
    expect(screen.getByText(/AFOR Cluster/)).toBeInTheDocument();
    expect(screen.getByText(/PENDING/)).toBeInTheDocument();
    expect(screen.getByText(/VERIFIED/)).toBeInTheDocument();
    expect(screen.getByText(/PHP/)).toBeInTheDocument();
  });

  it('renders simple fallback popup when enriched data is absent', () => {
    render(
      <ValidatorMapInner
        onViewportChange={vi.fn()}
        clusters={[mockCluster]}
      />,
    );
    expect(screen.getByTestId('popup')).toBeInTheDocument();
    expect(screen.getByText(/AFOR Cluster/)).toBeInTheDocument();
  });
});
