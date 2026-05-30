import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NearbyPublicReportAreas } from '../NearbyPublicReportAreas';

// Mock the dynamic import inner component
vi.mock('next/dynamic', () => ({
  default: () => {
    return function MockMap() {
      return <div data-testid="mock-map">Map Content</div>;
    };
  },
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
    render(<NearbyPublicReportAreas />);
    await act(async () => {
      await Promise.resolve();
    });
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
