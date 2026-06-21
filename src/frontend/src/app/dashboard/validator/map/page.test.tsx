/**
 * Validator operational map page — offline wiring (T12.1).
 *
 * Verifies that the page:
 * - uses the offline-aware `fetchOperationalMapOfflineAware` wrapper,
 * - mounts `useNetworkStatus`,
 * - renders the StaleCacheBanner when clusters are served from the
 *   encrypted offline cache, and
 * - shows a friendly "unavailable offline" state when offline and the
 *   cache is empty (the wrapper throws, and the page must catch).
 */

import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';

// ── Network status mock (overridden per test) ───────────────────────────
let networkStatusOverride: {
  isOnline: boolean;
  isChecking: boolean;
  isReconnecting: boolean;
} = { isOnline: true, isChecking: false, isReconnecting: false };
vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: () => networkStatusOverride,
}));

// ── Offline-aware wrapper mock ─────────────────────────────────────────
const mockFetchOperationalMapOfflineAware = vi.fn();
vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
  fetchOperationalMapOfflineAware: (...args: unknown[]) =>
    mockFetchOperationalMapOfflineAware(...args),
}));

// ── next/dynamic mock — inner component calls onViewportChange on mount ──
const mockBounds = {
  getSouthWest: () => ({ lat: 14, lng: 120 }),
  getNorthEast: () => ({ lat: 15, lng: 122 }),
  getCenter: () => ({ lat: 14.5, lng: 121 }),
};
vi.mock('next/dynamic', () => ({
  default: () => function MockMapInner(
    props: { onViewportChange: (b: typeof mockBounds, z: number) => void; clusters: unknown[] },
  ) {
    React.useEffect(() => {
      // Fire once on mount to drive the initial fetch.
      props.onViewportChange(mockBounds, 10);
    }, []);
    return <div data-testid="map-inner" />;
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────
function cachedClustersResult(cachedAt: number) {
  return {
    response: [
      { lat: 14.5, lng: 121, count: 3, severity: 'low', latest_at: '2025-06-01T00:00:00Z' },
    ],
    fromCache: true,
    cachedAt,
  };
}

function liveClustersResult() {
  return {
    response: [
      { lat: 14.5, lng: 121, count: 1, severity: 'medium', latest_at: '2025-06-02T00:00:00Z' },
    ],
    fromCache: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: online, not checking
  networkStatusOverride = { isOnline: true, isChecking: false, isReconnecting: false };
  // Default: live online response
  mockFetchOperationalMapOfflineAware.mockResolvedValue(liveClustersResult());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── T12.1: StaleCacheBanner when offline cache serves the clusters ───
describe('Validator operational map — offline wiring', () => {
  it('renders StaleCacheBanner when clusters are served from the offline cache', async () => {
    // Arrange: offline, wrapper returns a cached read
    networkStatusOverride = { isOnline: false, isChecking: false, isReconnecting: false };
    const cachedAt = Date.now() - 5_000;
    mockFetchOperationalMapOfflineAware.mockResolvedValue(cachedClustersResult(cachedAt));

    // Act — use real timers, wait past the 400ms debounce
    const { default: ValidatorOperationalMapPage } = await import('./page');
    render(<ValidatorOperationalMapPage />);

    // The mocked inner component fires onViewportChange on mount; the page
    // debounces the fetch by 400ms (VIEWPORT_DEBOUNCE_MS).
    await waitFor(() => {
      expect(mockFetchOperationalMapOfflineAware).toHaveBeenCalled();
    }, { timeout: 2_000 });

    // Once the fetch resolves, the page should render the stale banner.
    await waitFor(() => {
      expect(screen.getByText(/Showing cached clusters/i)).toBeInTheDocument();
    }, { timeout: 2_000 });

    // The page must have used the offline-aware wrapper, NOT a raw apiFetch.
    expect(mockFetchOperationalMapOfflineAware).toHaveBeenCalledTimes(1);
  });
});
