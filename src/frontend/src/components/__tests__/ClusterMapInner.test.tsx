import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClusterMapInner from '../ClusterMapInner';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  Marker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="marker">{children}</div>
  ),
  Circle: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="circle">{children}</div>
  ),
}));

describe('ClusterMapInner', () => {
  it('renders TileLayer and MapContainer with required props', () => {
    render(<ClusterMapInner center={[14.6, 121.0]} reports={[]} suggestedReportIds={[]} />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('tile-layer')).toBeInTheDocument();
  });
});
