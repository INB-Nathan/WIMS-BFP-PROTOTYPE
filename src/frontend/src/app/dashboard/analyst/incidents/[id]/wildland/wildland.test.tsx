/**
 * Wildland AFOR detail page tests — offline-aware read rewire (Plan T13).
 *
 *  - Online happy-path: page calls fetchAnalystIncidentWildlandDetailOfflineAware
 *    and renders the wildland detail without a stale-cache banner.
 *  - Offline cached-render: when the offline-aware wrapper returns
 *    { fromCache: true, cachedAt }, the page renders a <StaleCacheBanner>.
 *  - Cache-miss state: when the wrapper throws (no cache + offline),
 *    the page renders a friendly "unavailable offline" message.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AnalystWildlandDetailPage from './page';

const mockReplace = vi.fn();
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useParams: () => ({ id: '42' }),
}));

const mockUseAuth = vi.fn();
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// Network status — default online, overridden per test.
let networkStatusOverride = {
  isOnline: true,
  isReconnecting: false,
  isChecking: false,
  state: 'online' as const,
  lastCheckedAt: Date.now(),
};
vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: () => networkStatusOverride,
}));

// Offline-aware wrapper mock — one entry per test, configured in beforeEach.
const mockFetchWildlandOfflineAware = vi.fn();
vi.mock('@/lib/api', () => ({
  fetchAnalystIncidentWildlandDetailOfflineAware: (incidentId: number) =>
    mockFetchWildlandOfflineAware(incidentId),
}));

function buildWildlandDetail() {
  return {
    incident_id: 42,
    reference_number: 'REF-42',
    wildland: {
      source: 'Phone',
      external_reference: null,
      call_received_at: '2024-01-15T08:00:00Z',
      fire_started_at: null,
      fire_arrival_at: null,
      fire_controlled_at: null,
      caller_transmitted_by: null,
      call_received_by_personnel: 'Dispatcher A',
      engine_dispatched: 'Engine 1',
      caller_office_address: 'Barangay 1',
      incident_location_description: 'Open field',
      distance_to_fire_station_km: 1.2,
      primary_action_taken: 'Extinguished',
      assistance_combined_summary: 'Mutual aid',
      buildings_involved: 0,
      buildings_threatened: 0,
      ownership_and_property_notes: null,
      total_area_burned_display: '0.5 ha',
      total_area_burned_hectares: 0.5,
      wildland_fire_type: 'Grass Fire',
      area_type_summary: 'Open field',
      causes_and_ignition_factors: null,
      suppression_factors: null,
      weather: null,
      fire_behavior: null,
      peso_losses: null,
      casualties: null,
      narration: 'Fire was contained within 30 minutes.',
      problems_encountered: null,
      recommendations: null,
      prepared_by: 'Officer X',
      prepared_by_title: 'Captain',
      noted_by: 'Chief Y',
      noted_by_title: 'Chief',
      incident_wildland_afor_id: 7,
      import_batch_id: null,
      created_at: '2024-01-15T09:00:00Z',
      updated_at: '2024-01-15T09:30:00Z',
    },
    alarm_statuses: [],
    assistance_rows: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({
    user: { id: 'analyst-1', role: 'NATIONAL_ANALYST' },
    loading: false,
    loggingOut: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
  });
  networkStatusOverride = {
    isOnline: true,
    isReconnecting: false,
    isChecking: false,
    state: 'online' as const,
    lastCheckedAt: Date.now(),
  };
});

describe('AnalystWildlandDetailPage — offline-aware read rewire', () => {
  it('online happy-path: fetches via offline-aware wrapper and renders detail without stale banner', async () => {
    mockFetchWildlandOfflineAware.mockResolvedValue({
      response: buildWildlandDetail(),
      fromCache: false,
    });

    render(<AnalystWildlandDetailPage />);

    await waitFor(() => {
      expect(mockFetchWildlandOfflineAware).toHaveBeenCalledWith(42);
    });

    // Wildland detail rendered.
    expect(screen.getByText(/REF-42/)).toBeInTheDocument();
    // No stale cache banner when not from cache.
    expect(screen.queryByText(/Showing cached data/i)).toBeNull();
  });

  it('offline cached-render: when fromCache: true, StaleCacheBanner is rendered', async () => {
    const cachedAt = Date.now() - 5 * 60_000;
    mockFetchWildlandOfflineAware.mockResolvedValue({
      response: buildWildlandDetail(),
      fromCache: true,
      cachedAt,
    });

    render(<AnalystWildlandDetailPage />);

    await waitFor(() => {
      expect(mockFetchWildlandOfflineAware).toHaveBeenCalledWith(42);
    });

    expect(screen.getByText(/REF-42/)).toBeInTheDocument();
    expect(screen.getByText(/Showing cached data/i)).toBeInTheDocument();
  });

  it('cache-miss offline: wrapper throws, page shows "unavailable offline" state', async () => {
    mockFetchWildlandOfflineAware.mockRejectedValue(
      new Error('Wildland AFOR detail is unavailable offline. Reconnect to refresh this view.'),
    );

    render(<AnalystWildlandDetailPage />);

    await waitFor(() => {
      expect(mockFetchWildlandOfflineAware).toHaveBeenCalledWith(42);
    });

    // Friendly offline state — banner matches the error message or a tailored fallback.
    expect(
      await screen.findByText(/unavailable offline|cached data|offline/i, undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
  });
});
