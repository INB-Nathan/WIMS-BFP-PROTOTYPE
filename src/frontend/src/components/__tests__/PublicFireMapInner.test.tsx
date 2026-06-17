import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PublicFireMapInner from '../PublicFireMapInner';

/**
 * Mock navigator.geolocation for testing.
 * @param errorCode - 0=success, 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT
 */
function mockGeolocation(errorCode: number = 0, coords?: { latitude: number; longitude: number }) {
  const getCurrentPosition = vi.fn().mockImplementation((successFn, errorFn) => {
    if (errorCode === 0 && coords) {
      successFn({ coords: { ...coords, accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
    } else if (errorCode > 0) {
      const err = { code: errorCode, message: ['denied', 'unavailable', 'timeout'][errorCode - 1] || 'error' };
      errorFn(err);
    }
    // If no coords with errorCode=0, neither callback fires (for loading/indeterminate tests)
  });
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: { getCurrentPosition },
    writable: true,
    configurable: true,
  });
  return getCurrentPosition;
}

const mockSetView = vi.fn();
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
  Marker: ({ children, interactive, _icon }: { children?: React.ReactNode; interactive?: boolean; _icon?: unknown }) => (
    <div data-testid={interactive === false ? 'user-marker' : 'marker'}>{children}</div>
  ),
  useMapEvents: () => ({
    getBounds: () => ({
      getNorthEast: () => ({ lat: 15, lng: 122 }),
      getSouthWest: () => ({ lat: 14, lng: 120 }),
    }),
    getZoom: () => 10,
  }),
  useMap: () => ({
    setView: mockSetView,
  }),
}));

const mockFetchClusters = vi.fn();
vi.mock('@/lib/api', () => ({
  fetchClusters: (...args: unknown[]) => mockFetchClusters(...args),
}));

vi.mock('../map/leafletIcons', () => ({
  userLocationIcon: { options: { className: 'leaflet-user-location' } },
  firePinIcon: { options: { className: 'leaflet-fire-pin' } },
}));

describe('PublicFireMapInner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchClusters.mockResolvedValue({ clusters: [] });
  });

  it('renders TileLayer and MapContainer with required props', () => {
    render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('tile-layer')).toBeInTheDocument();
  });

  it('renders locate button with accessible label', () => {
    render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} />);
    const btn = screen.getByLabelText(/Use my location/);
    expect(btn).toBeInTheDocument();
  });

  it('shows user marker after successful geolocation in non-selection mode', async () => {
    mockGeolocation(0, { latitude: 14.5, longitude: 121.0 });
    render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} selectionMode={false} />);

    const btn = screen.getByLabelText(/Use my location/);
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(screen.getByTestId('user-marker')).toBeInTheDocument();
  });

  it('recenters map after successful geolocation in non-selection mode', async () => {
    mockSetView.mockClear();
    mockGeolocation(0, { latitude: 14.5, longitude: 121.0 });
    render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} selectionMode={false} />);

    const btn = screen.getByLabelText(/Use my location/);
    await act(async () => {
      fireEvent.click(btn);
    });

    // MapRecenter should call setView with user coords
    expect(mockSetView).toHaveBeenCalledWith(
      [14.5, 121.0],
      expect.any(Number),
      expect.objectContaining({ animate: true }),
    );
  });

  it('shows non-blocking fallback when geolocation is denied', async () => {
    mockGeolocation(1);
    render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} selectionMode={false} />);

    const btn = screen.getByLabelText(/Use my location/);
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(screen.getByText(/Location access denied/)).toBeInTheDocument();
  });

  it('does not render user marker in selection mode', async () => {
    mockGeolocation(0, { latitude: 14.5, longitude: 121.0 });
    render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} selectionMode={true} />);

    const btn = screen.getByLabelText(/Use my location/);
    await act(async () => {
      fireEvent.click(btn);
    });

    // In selection mode, should render a regular marker, not user-marker
    expect(screen.queryByTestId('user-marker')).not.toBeInTheDocument();
    expect(screen.getByTestId('marker')).toBeInTheDocument();
  });

  it('fetches clusters on initial viewport load', async () => {
    vi.useFakeTimers();
    mockFetchClusters.mockClear();
    render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} />);
    // ViewportHandler fires setTimeout(200ms), then debounce setTimeout(400ms)
    // Advance past both but stay under the 60s polling interval
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockFetchClusters).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('shows loading indicator immediately on locate click', async () => {
    // Don't mock coords so neither callback fires synchronously
    mockGeolocation(0);
    render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} />);

    const btn = screen.getByLabelText(/Use my location/);
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(screen.getByText('Locating...')).toBeInTheDocument();
  });

  it('shows non-blocking fallback on geolocation timeout', async () => {
    mockGeolocation(3); // TIMEOUT
    render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} />);

    const btn = screen.getByLabelText(/Use my location/);
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(screen.getByText(/Location request timed out/)).toBeInTheDocument();
  });

  it('shows non-blocking fallback on generic geolocation error', async () => {
    mockGeolocation(2); // POSITION_UNAVAILABLE
    render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} />);

    const btn = screen.getByLabelText(/Use my location/);
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(screen.getByText(/Could not get location/)).toBeInTheDocument();
  });
});
