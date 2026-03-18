/**
 * HeatmapViewer tests — empty state and marker rendering path.
 * Mocks react-leaflet for jsdom compatibility.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeatmapViewer } from './HeatmapViewer';
import type { HeatmapGeoJSON } from '@/lib/api';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  CircleMarker: ({ center }: { center: [number, number] }) => (
    <div data-testid="circle-marker" data-lat={center[0]} data-lng={center[1]} />
  ),
  useMap: () => null,
}));

describe('HeatmapViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no features exist', () => {
    const geojson: HeatmapGeoJSON = {
      type: 'FeatureCollection',
      features: [],
    };

    render(<HeatmapViewer geojson={geojson} />);

    expect(screen.getByText(/no incidents|no data|empty/i)).toBeInTheDocument();
  });

  it('renders map container and markers when features exist', () => {
    const geojson: HeatmapGeoJSON = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [121.5, 14.6] },
          properties: {
            incident_id: 1,
            alarm_level: '1',
            general_category: 'STRUCTURAL',
            notification_dt: '2024-01-15T10:00:00',
          },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [122, 15] },
          properties: {
            incident_id: 2,
            alarm_level: '2',
            general_category: 'NON_STRUCTURAL',
            notification_dt: '2024-01-16T12:00:00',
          },
        },
      ],
    };

    render(<HeatmapViewer geojson={geojson} />);

    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    const markers = screen.getAllByTestId('circle-marker');
    expect(markers).toHaveLength(2);
    expect(markers[0]).toHaveAttribute('data-lat', '14.6');
    expect(markers[0]).toHaveAttribute('data-lng', '121.5');
    expect(markers[1]).toHaveAttribute('data-lat', '15');
    expect(markers[1]).toHaveAttribute('data-lng', '122');
  });
});
