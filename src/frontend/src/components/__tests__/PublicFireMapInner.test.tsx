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
  Circle: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="civilian-circle">{children}</div>
  ),
  Polygon: ({ children, eventHandlers, pathOptions }: { children?: React.ReactNode; eventHandlers?: Record<string, (e: unknown) => void>; pathOptions?: { color?: string } }) => (
    <div data-testid="incident-perimeter" onClick={(e) => eventHandlers?.click?.(e)}>
      {pathOptions?.color && (
        // Mirror the real Leaflet SVG path so color assertions can run.
        <path stroke={pathOptions.color} />
      )}
      {children}
    </div>
  ),
  Popup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popup">{children}</div>
  ),
  Marker: ({ children, interactive, _icon, eventHandlers }: { children?: React.ReactNode; interactive?: boolean; _icon?: unknown; eventHandlers?: Record<string, (e: unknown) => void> }) => (
    <div data-testid={interactive === false ? 'user-marker' : 'marker'} onClick={(e) => eventHandlers?.click?.(e)}>{children}</div>
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

const mockFetchEmergencies = vi.fn();
vi.mock('@/lib/api/information', () => ({
  fetchEmergencies: (...args: unknown[]) => mockFetchEmergencies(...args),
}));

const mockFetchStations = vi.fn();
vi.mock('@/lib/api/map', () => ({
  fetchStations: (...args: unknown[]) => mockFetchStations(...args),
}));

vi.mock('../map/leafletIcons', () => ({
  userLocationIcon: { options: { className: 'leaflet-user-location' } },
  firePinIcon: { options: { className: 'leaflet-fire-pin' } },
}));

describe('PublicFireMapInner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchClusters.mockResolvedValue({ clusters: [] });
    mockFetchEmergencies.mockResolvedValue([]);
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

  it('renders civilian clusters as area circles', async () => {
    mockFetchClusters.mockResolvedValue({
      clusters: [{ lat: 14.6, lng: 121, count: 3, severity: 'low', latest_at: null }],
    });
    vi.useFakeTimers();
    render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} />);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId('civilian-circle')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders a perimeter polygon and a point fallback for published incidents', async () => {
    mockFetchEmergencies.mockResolvedValue([
      {
        id: 1, title: 'Perimeter incident', location: 'Loc', description: 'd', severity: 'high', status: 'ongoing',
        promoted_from_incident_id: 10, latitude: 14.6, longitude: 121, published: true, published_at: null, created_at: '2026-07-17T00:00:00Z',
        perimeter: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[121, 14.6], [121.1, 14.6], [121.1, 14.7], [121, 14.6]]] }, properties: { incident_id: 10 } },
      },
      {
        id: 2, title: 'Point incident', location: 'Loc', description: 'd', severity: 'moderate', status: 'ongoing',
        promoted_from_incident_id: 11, latitude: 14.7, longitude: 121.1, published: true, published_at: null, created_at: '2026-07-17T00:00:00Z', perimeter: null,
      },
    ]);
    render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} />);
    expect(await screen.findByTestId('incident-perimeter')).toBeInTheDocument();
    expect(screen.getAllByTestId('marker')).toHaveLength(1);
  });

  describe('fire station layer', () => {
    beforeEach(() => {
      mockFetchStations.mockReset();
    });

    it('shows error banner when fetchStations rejects', async () => {
      mockFetchStations.mockRejectedValue(new Error('network error'));
      render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} showStations={true} />);

      // The effect runs asynchronously; wait for the error banner to appear
      const errorBanner = await screen.findByText('Unable to load fire stations');
      expect(errorBanner).toBeInTheDocument();
      expect(mockFetchStations).toHaveBeenCalledTimes(1);
    });

    it('shows success count badge when fetchStations resolves with data', async () => {
      mockFetchStations.mockResolvedValue([
        { station_id: 1, station_name: 'Station A', address: 'Addr A', region_name: 'Region 1', latitude: 14.6, longitude: 121.0 },
        { station_id: 2, station_name: 'Station B', address: 'Addr B', region_name: 'Region 2', latitude: 14.7, longitude: 121.1 },
      ]);
      render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} showStations={true} />);

      const badge = await screen.findByText('2 fire stations');
      expect(badge).toBeInTheDocument();
      expect(mockFetchStations).toHaveBeenCalledTimes(1);
    });

    it('shows singular badge when fetchStations returns 1 station', async () => {
      mockFetchStations.mockResolvedValue([
        { station_id: 1, station_name: 'Station A', address: null, region_name: null, latitude: 14.6, longitude: 121.0 },
      ]);
      render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} showStations={true} />);

      const badge = await screen.findByText('1 fire station');
      expect(badge).toBeInTheDocument();
    });

    it('does not fetch stations when showStations is false', () => {
      render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} showStations={false} />);
      expect(mockFetchStations).not.toHaveBeenCalled();
    });
  });

  describe('shared emergencies + selection coupling', () => {
    beforeEach(() => {
      mockFetchEmergencies.mockReset();
    });

    const sampleEmergencies = [
      {
        id: 1, title: 'Perimeter incident', location: 'Loc', description: 'd', severity: 'critical', status: 'ongoing',
        promoted_from_incident_id: 10, latitude: 14.6, longitude: 121, published: true, published_at: null, created_at: '2026-07-17T00:00:00Z',
        perimeter: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[121, 14.6], [121.1, 14.6], [121.1, 14.7], [121, 14.6]]] }, properties: { incident_id: 10 } },
      },
      {
        id: 2, title: 'Point incident', location: 'Loc', description: 'd', severity: 'moderate', status: 'ongoing',
        promoted_from_incident_id: 11, latitude: 14.7, longitude: 121.1, published: true, published_at: null, created_at: '2026-07-17T00:00:00Z', perimeter: null,
      },
    ] as any;

    it('uses provided emergencies and does NOT fetch independently', () => {
      mockFetchEmergencies.mockResolvedValue([]);
      render(
        <PublicFireMapInner center={[14.6, 121.0]} zoom={10} emergencies={sampleEmergencies} />,
      );
      expect(mockFetchEmergencies).not.toHaveBeenCalled();
      expect(screen.getByTestId('incident-perimeter')).toBeInTheDocument();
      expect(screen.getAllByTestId('marker')).toHaveLength(1);
    });

    it('emits onEmergencySelect when a perimeter is clicked', async () => {
      const onSelect = vi.fn();
      render(
        <PublicFireMapInner center={[14.6, 121.0]} zoom={10} emergencies={sampleEmergencies} onEmergencySelect={onSelect} />,
      );
      const polygon = await screen.findByTestId('incident-perimeter');
      await act(async () => {
        fireEvent.click(polygon);
      });
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect.mock.calls[0][0].id).toBe(1);
    });

    it('emits onEmergencySelect when a point marker is clicked', async () => {
      const onSelect = vi.fn();
      render(
        <PublicFireMapInner center={[14.6, 121.0]} zoom={10} emergencies={sampleEmergencies} onEmergencySelect={onSelect} />,
      );
      const marker = (await screen.findAllByTestId('marker'))[0];
      await act(async () => {
        fireEvent.click(marker);
      });
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect.mock.calls[0][0].id).toBe(2);
    });
  });

  describe('severityColor normalization', () => {
    it('maps critical to red and moderate to amber (backend enum parity)', () => {
      // Exercise severityColor indirectly via emergencies rendering: two
      // distinctly-coloured perimeters prove the branches are not collapsed.
      const ems = [
        { id: 1, title: 'Crit', location: 'L', description: 'd', severity: 'critical', status: 'ongoing', promoted_from_incident_id: 1, latitude: 14.6, longitude: 121, published: true, published_at: null, created_at: '2026-07-17T00:00:00Z', perimeter: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[121, 14.6], [121.1, 14.6], [121.1, 14.7], [121, 14.6]]] }, properties: { incident_id: 1 } } },
        { id: 2, title: 'Mod', location: 'L', description: 'd', severity: 'moderate', status: 'ongoing', promoted_from_incident_id: 2, latitude: 14.7, longitude: 121.1, published: true, published_at: null, created_at: '2026-07-17T00:00:00Z', perimeter: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[121.1, 14.6], [121.2, 14.6], [121.2, 14.7], [121.1, 14.6]]] }, properties: { incident_id: 2 } } },
      ] as any;
      mockFetchEmergencies.mockResolvedValue([]);
      render(<PublicFireMapInner center={[14.6, 121.0]} zoom={10} emergencies={ems} />);
      const polys = screen.getAllByTestId('incident-perimeter');
      expect(polys).toHaveLength(2);
      // Different stroke colors prove critical and moderate are not collapsed.
      const critPath = polys[0].querySelector('path');
      const modPath = polys[1].querySelector('path');
      expect(critPath).not.toBeNull();
      expect(modPath).not.toBeNull();
      expect(critPath!.getAttribute('stroke')).not.toBe(modPath!.getAttribute('stroke'));
    });
  });
});
