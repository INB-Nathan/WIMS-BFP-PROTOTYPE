import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClusterMapInner from '../ClusterMapInner';

let markerCount = 0;

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  Marker: ({ children }: { children?: React.ReactNode }) => {
    markerCount++;
    return <div data-testid="marker">{children}</div>;
  },
  Circle: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="circle">{children}</div>
  ),
}));

describe('ClusterMapInner', () => {
  beforeEach(() => {
    markerCount = 0;
  });

  it('renders TileLayer and MapContainer with required props', () => {
    render(<ClusterMapInner center={[14.6, 121.0]} reports={[]} suggestedReportIds={[]} />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('tile-layer')).toBeInTheDocument();
  });

  it('renders markers for each report', () => {
    const reports = [
      {
        report_id: 1,
        latitude: 14.6,
        longitude: 121.0,
        category: 'STRUCTURAL',
        sub_category: 'FIRE',
      },
      {
        report_id: 2,
        latitude: 14.61,
        longitude: 121.01,
        category: 'VEHICULAR',
        sub_category: 'COLLISION',
      },
    ];
    render(
      <ClusterMapInner center={[14.6, 121.0]} reports={reports as any} suggestedReportIds={[]} />,
    );
    expect(markerCount).toBe(2);
  });

  it('renders a Circle for reports with anchor position', () => {
    const reports = [
      {
        report_id: 1,
        latitude: 14.6,
        longitude: 121.0,
      },
    ];
    render(
      <ClusterMapInner center={[14.6, 121.0]} reports={reports as any} suggestedReportIds={[]} />,
    );
    expect(screen.getByTestId('circle')).toBeInTheDocument();
  });
});
