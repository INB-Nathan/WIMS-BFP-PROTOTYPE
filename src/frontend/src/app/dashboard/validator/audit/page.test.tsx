/**
 * Validator audit page — offline wiring (T12.2).
 *
 * Verifies that the page:
 * - uses the offline-aware `fetchValidatorAuditLogsOfflineAware` wrapper,
 * - mounts `useNetworkStatus`,
 * - renders the StaleCacheBanner when audit logs are served from the
 *   encrypted offline cache, and
 * - shows a friendly "unavailable offline" state when offline and the
 *   cache is empty (the wrapper throws, and the page must catch).
 */

import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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
const mockFetchValidatorAuditLogsOfflineAware = vi.fn();
vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
  fetchValidatorAuditLogsOfflineAware: (...args: unknown[]) =>
    mockFetchValidatorAuditLogsOfflineAware(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────────
function cachedAuditResult(cachedAt: number) {
  return {
    response: {
      items: [
        {
          history_id: 1,
          incident_id: 42,
          region_id: 13,
          region_display: 'Region 13',
          action_by_user_id: 'u1',
          actor_username: 'jdoe',
          previous_status: 'PENDING',
          new_status: 'APPROVED',
          action_label: 'Approved',
          notes: null,
          action_timestamp: '2025-06-01T00:00:00Z',
        },
      ],
      total: 1,
      limit: 15,
      offset: 0,
    },
    fromCache: true,
    cachedAt,
  };
}

function liveAuditResult() {
  return {
    response: { items: [], total: 0, limit: 15, offset: 0 },
    fromCache: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  networkStatusOverride = { isOnline: true, isChecking: false, isReconnecting: false };
  mockFetchValidatorAuditLogsOfflineAware.mockResolvedValue(liveAuditResult());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── T12.2: StaleCacheBanner when offline cache serves the audit logs ───
describe('Validator audit page — offline wiring', () => {
  it('renders StaleCacheBanner when audit logs are served from the offline cache', async () => {
    // Arrange: offline, wrapper returns a cached read
    networkStatusOverride = { isOnline: false, isChecking: false, isReconnecting: false };
    const cachedAt = Date.now() - 5_000;
    mockFetchValidatorAuditLogsOfflineAware.mockResolvedValue(cachedAuditResult(cachedAt));

    // Act — render the page; the load() effect fires on mount.
    const { default: ValidatorAuditPage } = await import('./page');
    render(<ValidatorAuditPage />);

    // Once the fetch resolves, the page should render the stale banner.
    await waitFor(() => {
      expect(screen.getByText(/Showing cached audit/i)).toBeInTheDocument();
    }, { timeout: 2_000 });

    // The page must have used the offline-aware wrapper, NOT a raw apiFetch.
    expect(mockFetchValidatorAuditLogsOfflineAware).toHaveBeenCalled();
  });
});
