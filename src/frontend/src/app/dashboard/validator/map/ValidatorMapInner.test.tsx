import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ValidatorMapInner from './ValidatorMapInner';

const mapMocks = vi.hoisted(() => ({
  getBounds: vi.fn(() => ({
    getNorthEast: () => ({ lat: 15, lng: 122 }),
    getSouthWest: () => ({ lat: 14, lng: 120 }),
  })),
  getZoom: vi.fn(() => 10),
  moveendHandler: undefined as (() => void) | undefined,
  radii: [] as number[],
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  CircleMarker: ({ children, radius }: { children?: React.ReactNode; radius: number }) => {
    mapMocks.radii.push(radius);
    return <div data-testid="circle-marker">{children}</div>;
  },
  Popup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popup">{children}</div>
  ),
  useMapEvents: (handlers: { moveend?: () => void }) => {
    mapMocks.moveendHandler = handlers.moveend;
    return {
      getBounds: mapMocks.getBounds,
      getZoom: mapMocks.getZoom,
    };
  },
}));

describe('ValidatorMapInner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mapMocks.getZoom.mockReturnValue(10);
    mapMocks.moveendHandler = undefined;
    mapMocks.radii = [];
  });

  it('renders TileLayer and MapContainer with required props', () => {
    render(
      <ValidatorMapInner onViewportChange={vi.fn()} clusters={[]} />,
    );
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('tile-layer')).toBeInTheDocument();
  });

  it('requests clusters for the initial viewport on first render', async () => {
    const onViewportChange = vi.fn();

    render(
      <ValidatorMapInner onViewportChange={onViewportChange} clusters={[]} />,
    );

    await waitFor(() => expect(onViewportChange).toHaveBeenCalledTimes(1));
    expect(onViewportChange).toHaveBeenCalledWith(expect.any(Object), 10);
  });

  it('keeps high-count cluster markers smaller at far zoom levels', async () => {
    const cluster = { lat: 14.6, lng: 121, count: 200, severity: 'high' as const, latest_at: null };
    mapMocks.getZoom.mockReturnValue(6);

    const { rerender } = render(
      <ValidatorMapInner onViewportChange={vi.fn()} clusters={[cluster]} />,
    );

    await waitFor(() => expect(mapMocks.radii.length).toBeGreaterThan(0));
    const lowZoomRadius = mapMocks.radii.at(-1);

    mapMocks.getZoom.mockReturnValue(12);
    mapMocks.moveendHandler?.();
    rerender(<ValidatorMapInner onViewportChange={vi.fn()} clusters={[cluster]} />);

    const highZoomRadius = mapMocks.radii.at(-1);
    expect(lowZoomRadius).toBeLessThanOrEqual(16);
    expect(highZoomRadius).toBeGreaterThan(lowZoomRadius ?? 0);
  });
});
