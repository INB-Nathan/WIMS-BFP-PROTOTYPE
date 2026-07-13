/**
 * Issue #523 — the "H. Fire Scene Location" section must show the persisted
 * address (street_address/incident_address) instead of raw lat/lng, and must
 * NOT fire a live reverseGeocode call when a stored address already exists.
 * Only when there is no stored address at all should it fall back to a
 * one-time live geocode.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// jsdom has no IntersectionObserver — the page's section-nav scroll-spy needs a stub.
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IntersectionObserver = MockIntersectionObserver;

const mockRouter = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/dashboard/regional/incidents/42',
}));

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    loading: false,
    user: { id: 'encoder-1', role: 'REGIONAL_ENCODER', assignedRegionId: 5 },
  }),
}));

vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true }),
}));

vi.mock('@/lib/offlineStore', () => ({
  deleteOfflineOpCascade: vi.fn(),
  deleteOfflineOp: vi.fn(),
  getOfflineOp: vi.fn().mockResolvedValue(null),
  getLinkedSubmitOpLocalId: vi.fn().mockResolvedValue(null),
  queueOfflineOp: vi.fn(),
}));

vi.mock('@/lib/api/offlineValidator', () => ({
  submitVerificationOfflineAware: vi.fn(),
}));

const mockReverseGeocode = vi.hoisted(() => vi.fn());
vi.mock('@/lib/geocode', () => ({ reverseGeocode: mockReverseGeocode }));

vi.mock('@/components/UpdateRequestDiffPanel', () => ({ UpdateRequestDiffPanel: () => null }));
vi.mock('@/components/IncidentDiffPanel', () => ({ IncidentDiffPanel: () => null }));
vi.mock('@/components/IncidentRevisionHistory', () => ({ IncidentRevisionHistory: () => null }));
vi.mock('@/components/IncidentConflictMergePanel', () => ({ IncidentConflictMergePanel: () => null }));
vi.mock('@/components/MapPickerInner', () => ({
  MapPickerInner: () => <div data-testid="mock-map" />,
  DETAIL_INCIDENT_MAP_ZOOM: 15,
  DETAIL_INCIDENT_MAP_HEIGHT: '320px',
}));
vi.mock('@/components/IncidentForm', () => ({ IncidentForm: () => null }));

const mockFetchDetail = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/offlineRegional', () => ({
  fetchRegionalIncidentOfflineAware: mockFetchDetail,
}));

vi.mock('@/lib/api', () => ({
  submitIncidentForReview: vi.fn(),
  unpendIncident: vi.fn(),
  deleteIncident: vi.fn(),
  apiFetch: vi.fn(),
  ApiRequestError: class ApiRequestError extends Error {
    status: number;
    detail: unknown;
    constructor(status: number, detail?: unknown) {
      super(`Request failed: ${status}`);
      this.status = status;
      this.detail = detail;
    }
  },
  updateRegionalIncident: vi.fn(),
}));

import RegionalIncidentDetailPage from './page';

function baseDetail(overrides: Record<string, unknown> = {}) {
  return {
    incident_id: 42,
    verification_status: 'PENDING',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    region_id: 5,
    latitude: 14.6,
    longitude: 120.98,
    reference_number: null,
    incident_type_code: null,
    parent_incident_id: null,
    is_duplicate: false,
    duplicate_of: null,
    is_wildland: false,
    wildland_fire_type: null,
    wildland_area_hectares: null,
    wildland_area_display: null,
    nonsensitive: {},
    sensitive: {},
    rejection_reason: null,
    rejection_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReverseGeocode.mockReset();
});

describe('Incident detail — fire scene address display (#523)', () => {
  it('shows the stored street_address and never calls reverseGeocode', async () => {
    mockFetchDetail.mockResolvedValue({
      response: baseDetail({ sensitive: { street_address: '123 Rizal St, Brgy. Commonwealth' } }),
      fromCache: false,
      cachedAt: undefined,
    });

    render(<RegionalIncidentDetailPage />);

    await waitFor(() => {
      expect(screen.getAllByText('123 Rizal St, Brgy. Commonwealth').length).toBeGreaterThan(0);
      expect(screen.getByText('📌 Latitude')).toBeInTheDocument();
      expect(screen.getByText('14.600000')).toBeInTheDocument();
      expect(screen.getByText('📌 Longitude')).toBeInTheDocument();
      expect(screen.getByText('120.980000')).toBeInTheDocument();
    });
    expect(mockReverseGeocode).not.toHaveBeenCalled();
  });

  it('falls back to a one-time live geocode when no address was ever stored', async () => {
    mockReverseGeocode.mockResolvedValue({
      barangay: 'Barangay Commonwealth',
      city: 'Quezon City',
      province: 'Metro Manila',
      state: 'NCR',
    });
    mockFetchDetail.mockResolvedValue({
      response: baseDetail({ sensitive: {}, nonsensitive: {} }),
      fromCache: false,
      cachedAt: undefined,
    });

    render(<RegionalIncidentDetailPage />);

    await waitFor(() => {
      expect(mockReverseGeocode).toHaveBeenCalledWith(14.6, 120.98);
    });
    await waitFor(() => {
      expect(
        screen.getByText('Barangay Commonwealth, Quezon City, Metro Manila')
      ).toBeInTheDocument();
    });
  });

  it('shows "Resolving address…" while the fallback geocode is in flight', async () => {
    let resolveGeocode: (value: unknown) => void = () => {};
    mockReverseGeocode.mockReturnValue(
      new Promise((resolve) => {
        resolveGeocode = resolve;
      })
    );
    mockFetchDetail.mockResolvedValue({
      response: baseDetail({ sensitive: {}, nonsensitive: {} }),
      fromCache: false,
      cachedAt: undefined,
    });

    render(<RegionalIncidentDetailPage />);

    await waitFor(() => {
      expect(mockReverseGeocode).toHaveBeenCalledWith(14.6, 120.98);
    });
    expect(await screen.findByText('Resolving address…')).toBeInTheDocument();

    resolveGeocode({ barangay: 'Barangay Commonwealth', city: 'Quezon City', province: 'Metro Manila' });
    await waitFor(() => {
      expect(screen.queryByText('Resolving address…')).not.toBeInTheDocument();
    });
  });

  it('shows a coordinates-only fallback ("—") when the geocode result is null', async () => {
    mockReverseGeocode.mockResolvedValue(null);
    mockFetchDetail.mockResolvedValue({
      response: baseDetail({ sensitive: {}, nonsensitive: {} }),
      fromCache: false,
      cachedAt: undefined,
    });

    render(<RegionalIncidentDetailPage />);

    await waitFor(() => {
      expect(mockReverseGeocode).toHaveBeenCalledWith(14.6, 120.98);
    });
    await waitFor(() => {
      expect(screen.queryByText('Resolving address…')).not.toBeInTheDocument();
    });
    expect(await screen.findByText('📌 Latitude')).toBeInTheDocument();
    expect(screen.getByText('14.600000')).toBeInTheDocument();
    // formatDetailValue() renders null as an em dash — no address string, coordinates only.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
