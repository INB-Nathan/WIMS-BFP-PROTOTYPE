/**
 * AFOR import page tests — Wildland AFOR deprecation block.
 *
 * F3: Dedicated Wildland AFOR import is deprecated/out of scope.
 * If a Wildland AFOR preview reaches the commit flow, the page must
 * block with an explicit message, keep preview data, and not navigate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AforImportPage from '../page';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

const mockUseAuth = vi.fn();
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

let networkIsOnline = false;
vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: networkIsOnline, isReconnecting: false }),
}));

vi.mock('@/lib/api', () => ({
  importAforFile: vi.fn(),
  commitAforImport: vi.fn(),
  submitIncidentForReview: vi.fn(),
}));

vi.mock('@/lib/offlineStore', () => ({
  queueOfflineOp: vi.fn(),
}));

vi.mock('@/lib/geocode', () => ({
  searchGeocode: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/connectivity', () => ({
  markConnectivityOffline: vi.fn(),
}));

// Heavy/stub-only child components
vi.mock('@/components/MapPicker', () => ({
  MapPicker: () => null,
}));
vi.mock('@/components/DuplicateResolutionModal', () => ({
  DuplicateResolutionModal: () => null,
}));
vi.mock('@/components/SectionDotNav', () => ({
  SectionDotNav: () => null,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function seedWildlandPreview() {
  sessionStorage.setItem(
    'wims:afor_import_draft',
    JSON.stringify({
      form_kind: 'WILDLAND_AFOR',
      total_rows: 1,
      valid_rows: 1,
      invalid_rows: 0,
      requires_location: false,
      rows: [
        {
          row_index: 0,
          status: 'VALID',
          errors: [],
          data: {
            _city_text: 'Test City',
            wildland: {
              call_received_at: '2026-06-21T10:00:00',
              engine_dispatched: 'Engine 1',
              wildland_fire_type: 'Brush',
              primary_action_taken: 'Suppression',
            },
          },
        },
      ],
    }),
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('AFOR import page — Wildland AFOR deprecation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    networkIsOnline = false;
    mockUseAuth.mockReturnValue({
      user: { id: 'test-encoder', role: 'REGIONAL_ENCODER', assignedRegionId: 1 },
      loading: false,
      loggingOut: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });
    seedWildlandPreview();
  });

  afterEach(() => {
    sessionStorage.clear();
    networkIsOnline = false;
  });

  it('shows deprecation message when committing Wildland AFOR and stays on page', async () => {
    const user = userEvent.setup();
    render(<AforImportPage />);

    // Wait for sessionStorage restore to populate previewData
    await waitFor(() => {
      expect(screen.getByText(/commit 1 valid row/i)).toBeInTheDocument();
    });

    // Click the commit button
    await user.click(screen.getByRole('button', { name: /commit 1 valid row/i }));

    // Assert deprecation message appears
    await waitFor(() => {
      expect(
        screen.getByText(
          /dedicated wildland afor import is deprecated/i,
        ),
      ).toBeInTheDocument();
    });

    // Assert preview data is still visible (page did not navigate away)
    expect(screen.getByText(/commit 1 valid row/i)).toBeInTheDocument();

    // Assert no navigation occurred
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not clear preview data or navigate away after blocking', async () => {
    const user = userEvent.setup();
    render(<AforImportPage />);

    await waitFor(() => {
      expect(screen.getByText(/commit 1 valid row/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /commit 1 valid row/i }));

    // Deprecation message appears
    await waitFor(() => {
      expect(
        screen.getByText(/dedicated wildland afor import is deprecated/i),
      ).toBeInTheDocument();
    });

    // Preview data is NOT cleared — commit button still visible
    expect(screen.getByText(/commit 1 valid row/i)).toBeInTheDocument();

    // No redirect
    expect(mockPush).not.toHaveBeenCalled();
  });
});
