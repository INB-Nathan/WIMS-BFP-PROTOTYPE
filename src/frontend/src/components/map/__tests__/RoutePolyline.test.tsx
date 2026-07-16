import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoutePolyline, parseLineStringToLatLng } from '../RoutePolyline';

vi.mock('react-leaflet', () => ({
  Polyline: ({ positions }: { positions: [number, number][] }) => (
    <div data-testid="polyline" data-positions={JSON.stringify(positions)} />
  ),
}));

const VALID_GEOMETRY = {
  type: 'LineString',
  coordinates: [
    [121.05, 14.6],
    [121.06, 14.61],
    [121.07, 14.62],
  ],
};

describe('parseLineStringToLatLng', () => {
  it('converts GeoJSON [lng, lat] coordinates to [lat, lng] tuples', () => {
    const result = parseLineStringToLatLng(VALID_GEOMETRY);
    expect(result).toEqual([
      [14.6, 121.05],
      [14.61, 121.06],
      [14.62, 121.07],
    ]);
  });

  it('returns null for null/undefined geometry', () => {
    expect(parseLineStringToLatLng(null)).toBeNull();
    expect(parseLineStringToLatLng(undefined)).toBeNull();
  });

  it('returns null when type is not LineString', () => {
    expect(parseLineStringToLatLng({ type: 'Point', coordinates: [121.05, 14.6] })).toBeNull();
  });

  it('returns null when fewer than 2 coordinate pairs', () => {
    expect(parseLineStringToLatLng({ type: 'LineString', coordinates: [[121.05, 14.6]] })).toBeNull();
  });

  it('returns null on non-numeric coordinates', () => {
    expect(
      parseLineStringToLatLng({ type: 'LineString', coordinates: [['a', 'b'], [121.06, 14.61]] }),
    ).toBeNull();
  });

  it('returns null on malformed coordinate entries', () => {
    expect(
      parseLineStringToLatLng({ type: 'LineString', coordinates: [[121.05], [121.06, 14.61]] }),
    ).toBeNull();
  });

  it('does not crash on completely unrelated shapes', () => {
    expect(parseLineStringToLatLng({} as Record<string, unknown>)).toBeNull();
    expect(parseLineStringToLatLng('not an object' as unknown as Record<string, unknown>)).toBeNull();
  });
});

describe('RoutePolyline', () => {
  it('renders a Polyline when given valid geometry', () => {
    render(<RoutePolyline geometry={VALID_GEOMETRY} />);
    expect(screen.getByTestId('polyline')).toBeInTheDocument();
  });

  it('renders nothing when geometry is null', () => {
    const { container } = render(<RoutePolyline geometry={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when geometry is undefined', () => {
    const { container } = render(<RoutePolyline geometry={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not crash and renders nothing on malformed geometry', () => {
    const { container } = render(
      <RoutePolyline geometry={{ type: 'LineString', coordinates: 'oops' } as unknown as Record<string, unknown>} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
