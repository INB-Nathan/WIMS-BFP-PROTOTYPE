import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FireStationsPage from './page';
import { fetchEmergencyServices } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  fetchEmergencyServices: vi.fn(),
}));

vi.mock('next/dynamic', () => ({
  default: () =>
    function MockFireStationsMap(props: {
      stations: Array<{ station_id: number; station_name: string }>;
      selectedStationId?: number | null;
      onMapError?: () => void;
    }) {
      return (
        <div data-testid="mock-map" data-selected-station-id={props.selectedStationId ?? ''}>
          <span>Map stations: {props.stations.map((station) => station.station_name).join(', ')}</span>
          <button type="button" onClick={props.onMapError}>Trigger map failure</button>
        </div>
      );
    },
}));

const stations = [
  { station_id: 1, station_name: 'Central Station', latitude: 14.6, longitude: 121, distance_m: null },
  { station_id: 2, station_name: 'North Station', latitude: 15, longitude: 121.1, distance_m: 1500 },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchEmergencyServices).mockResolvedValue({
    emergency_number: '911',
    nearest_station_ids: [],
    stations,
    stale: false,
    degraded: false,
  });
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn() },
  });
});

describe('FireStationsPage', () => {
  it('renders the map and directory side-by-side simultaneously — no toggle required', async () => {
    render(<FireStationsPage />);

    // The map is visible immediately, without clicking any "show map" control.
    expect(await screen.findByTestId('mock-map')).toBeInTheDocument();
    expect(screen.getByText('Map stations: Central Station, North Station')).toBeInTheDocument();
    // The directory list is visible at the same time.
    expect(screen.getByRole('button', { name: /Central Station/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /North Station/i })).toBeInTheDocument();
    // There is no collapsible "show/hide map" toggle button anymore.
    expect(screen.queryByRole('button', { name: /show map/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /hide map/i })).not.toBeInTheDocument();
  });

  it('applies split-view responsive layout classes (stacked on mobile, side-by-side on xl+)', async () => {
    render(<FireStationsPage />);
    await screen.findByTestId('mock-map');

    const splitView = screen.getByTestId('station-split-view');
    expect(splitView.className).toContain('flex-col');
    expect(splitView.className).toContain('xl:flex-row');
  });

  it('supports keyboard selection and keeps map filters synchronized with the directory', async () => {
    const user = userEvent.setup();
    render(<FireStationsPage />);

    await screen.findByTestId('mock-map');
    expect(screen.getByText('Map stations: Central Station, North Station')).toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: /search fire stations/i });
    await user.type(search, 'North');

    await waitFor(() => expect(screen.getByText('1 of 2 stations')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Central Station/i })).not.toBeInTheDocument();
    expect(screen.getByText('Map stations: North Station')).toBeInTheDocument();

    const northStation = screen.getByRole('button', { name: /North Station/i });
    northStation.focus();
    await user.keyboard('{Enter}');

    expect(northStation).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('mock-map')).toHaveAttribute('data-selected-station-id', '2');
  });

  it('shows an empty-search state', async () => {
    const user = userEvent.setup();
    render(<FireStationsPage />);

    const search = await screen.findByRole('searchbox', { name: /search fire stations/i });
    await user.type(search, 'No matches here');

    expect(screen.getByText('No fire stations match your search.')).toBeInTheDocument();
  });

  it('shows degraded map guidance while keeping the directory list usable', async () => {
    render(<FireStationsPage />);

    await screen.findByTestId('mock-map');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Trigger map failure' }));

    expect(screen.getByText(/Map tiles are unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Central Station/i })).toBeInTheDocument();
  });

  it('shows the same fetch failure guidance in both the map panel and the directory panel', async () => {
    vi.mocked(fetchEmergencyServices).mockRejectedValueOnce(new Error('offline'));
    render(<FireStationsPage />);

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toHaveTextContent('Failed to load fire stations. Please try again when online.');
    expect(alerts[1]).toHaveTextContent('Failed to load fire stations. Please try again when online.');
  });

  it('preserves mobile-friendly full-width controls and responsive hotline layout classes', async () => {
    const { container } = render(<FireStationsPage />);

    const search = await screen.findByRole('searchbox', { name: /search fire stations/i });
    expect(search.className).toContain('w-full');
    expect(container.querySelector('div[class*="grid-cols-1"][class*="sm:grid-cols-2"]')).not.toBeNull();
  });
});
