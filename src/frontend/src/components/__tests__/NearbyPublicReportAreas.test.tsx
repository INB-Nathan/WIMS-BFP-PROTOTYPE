import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NearbyPublicReportAreas } from '../NearbyPublicReportAreas';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  Circle: ({ children }: { children: React.ReactNode }) => <div data-testid="circle">{children}</div>,
  Marker: ({ children }: { children: React.ReactNode }) => <div data-testid="marker">{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div data-testid="popup">{children}</div>,
  useMap: () => ({
    setView: vi.fn(),
    fitBounds: vi.fn(),
  }),
}));

const mockFetchReportClusters = vi.fn();
const mockFetchEmergencyServices = vi.fn();

// Mock the API calls
vi.mock('@/lib/api', () => ({
  fetchReportClusters: (...args: unknown[]) => mockFetchReportClusters(...args),
  fetchEmergencyServices: (...args: unknown[]) => mockFetchEmergencyServices(...args)
}));

describe('NearbyPublicReportAreas', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetchReportClusters.mockResolvedValue({
      mode: 'national',
      center: null,
      radius_m: null,
      window_minutes: 60,
      min_reports: 10,
      truncated: false,
      stale: false,
      degraded: false,
      areas: [],
    });
    mockFetchEmergencyServices.mockResolvedValue({
      emergency_number: '911',
      nearest_station_ids: [],
      stations: [],
      stale: false,
      degraded: false,
    });
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('renders correctly and shows heading', async () => {
    // Use real timers so next/dynamic's @loadable/component 200ms delay fires
    // and the dynamic import resolves. Restored in afterEach.
    vi.useRealTimers();
    render(<NearbyPublicReportAreas />);
    // Wait for the async dynamic import to resolve
    await screen.findByTestId('tile-layer');
    expect(screen.getByText('Public Fire Report Areas')).toBeInTheDocument();
    expect(screen.getByText('Show national report areas')).toBeInTheDocument();
    expect(screen.getByText('Choose area manually')).toBeInTheDocument();
  });

  it('polls data every 60 seconds when visible', async () => {
    render(<NearbyPublicReportAreas fireLat={14.5} fireLon={121.0} />);
    
    // Initial fetch
    expect(mockFetchReportClusters).toHaveBeenCalledWith(14.5, 121.0);
    expect(mockFetchReportClusters).toHaveBeenCalledTimes(1);
    
    // Advance time by 60s
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    
    expect(mockFetchReportClusters).toHaveBeenCalledTimes(2);
  });

  it('pauses polling when tab is hidden', async () => {
    render(<NearbyPublicReportAreas />);
    
    // Initial fetch
    expect(mockFetchReportClusters).toHaveBeenCalledTimes(1);

    // Hide tab
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Advance time
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });

    // Should not have fetched again
    expect(mockFetchReportClusters).toHaveBeenCalledTimes(1);

    // Show tab
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Should fetch immediately upon becoming visible
    expect(mockFetchReportClusters).toHaveBeenCalledTimes(2);
  });

  it('shows degraded and stale states', async () => {
    mockFetchReportClusters.mockResolvedValueOnce({
      mode: 'national',
      center: null,
      radius_m: null,
      window_minutes: 60,
      min_reports: 10,
      truncated: false,
      stale: true,
      degraded: true,
      areas: [],
    });
    
    render(<NearbyPublicReportAreas />);
    
    // Wait for async fetch to resolve
    await act(async () => {
      await Promise.resolve();
    });
    
    expect(screen.getByText(/Operating in degraded mode/i)).toBeInTheDocument();
  });
});
