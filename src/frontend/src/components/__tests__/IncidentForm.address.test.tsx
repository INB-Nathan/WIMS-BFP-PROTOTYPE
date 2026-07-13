/**
 * Issue #523 — the fire-scene location display must show a human-readable
 * address (composed from reverseGeocode's real { barangay, city, province,
 * state } shape) instead of raw lat/lng, with coordinates demoted to a
 * secondary line rather than removed.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockRouter = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => mockRouter }));

vi.mock('sonner', () => ({ toast: { info: vi.fn() } }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    loading: false,
    user: { id: 'encoder-1', role: 'REGIONAL_ENCODER', assignedRegionId: 1 },
  }),
}));

vi.mock('@/lib/connectivity', () => ({
  isReachable: vi.fn().mockResolvedValue(true),
  markConnectivityOffline: vi.fn(),
}));

vi.mock('@/lib/edgeFunctions', () => ({
  edgeFunctions: { uploadBundle: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  updateRegionalIncident: vi.fn(),
  forceReplaceIncident: vi.fn(),
  createRegionalIncident: vi.fn(),
  submitIncidentForReview: vi.fn(),
  ApiRequestError: class ApiRequestError extends Error {
    status: number;
    detail: unknown;
    constructor(status: number, detail?: unknown) {
      super(`Request failed: ${status}`);
      this.status = status;
      this.detail = detail;
    }
  },
}));

vi.mock('@/lib/offlineStore', () => ({
  queueOfflineOp: vi.fn().mockResolvedValue(undefined),
  saveDraftOp: vi.fn().mockResolvedValue(undefined),
  getDraftOps: vi.fn().mockResolvedValue([]),
  deleteOfflineOp: vi.fn().mockResolvedValue(undefined),
  updateOfflineOp: vi.fn().mockResolvedValue(undefined),
}));

const mockReverseGeocode = vi.hoisted(() => vi.fn());
vi.mock('@/lib/geocode', () => ({ reverseGeocode: mockReverseGeocode }));
vi.mock('@/lib/formDirty', () => ({ setFormDirty: vi.fn(), isFormDirty: vi.fn(() => false) }));

vi.mock('@/components/SectionDotNav', () => ({
  SectionDotNav: () => <nav data-testid="section-dot-nav" />,
}));

vi.mock('../IncidentFormSections', () => ({
  AssetsResourcesSection: () => <div data-testid="assets-section" />,
  AlarmLevelSection: () => <div data-testid="alarm-section" />,
  CasualtiesSection: () => <div data-testid="casualties-section" />,
  PersonnelOnDutySection: () => <div data-testid="personnel-section" />,
  ProblemsChecklistSection: () => <div data-testid="problems-section" />,
}));

// Real MapPicker (and next/dynamic) are swapped for a lightweight stand-in
// that exposes a button to trigger onChange(lat, lng) synchronously.
vi.mock('../MapPicker', () => ({
  MapPicker: ({ onChange }: { onChange?: (lat: number, lng: number) => void }) => (
    <button type="button" data-testid="drop-pin" onClick={() => onChange?.(14.6, 120.98)}>
      Drop pin
    </button>
  ),
}));

import { IncidentForm } from '../IncidentForm';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mockReverseGeocode.mockReset();
  localStorage.clear();
});

describe('IncidentForm — fire scene address display (#523)', () => {
  it('shows the composed address on the 📍 line when reverseGeocode resolves', async () => {
    mockReverseGeocode.mockResolvedValue({
      barangay: 'Barangay Commonwealth',
      city: 'Quezon City',
      province: 'Metro Manila',
      state: 'NCR',
    });

    render(<IncidentForm />);
    await userEvent.click(await screen.findByTestId('drop-pin'));

    await waitFor(() => {
      expect(
        screen.getByText('📍 Barangay Commonwealth, Quezon City, Metro Manila')
      ).toBeInTheDocument();
    });
    expect(screen.getByText('📌 14.600000, 120.980000')).toBeInTheDocument();
  });

  it('shows "Resolving address…" while the geocode call is pending', async () => {
    let resolveGeocode: (value: unknown) => void = () => {};
    mockReverseGeocode.mockReturnValue(
      new Promise((resolve) => {
        resolveGeocode = resolve;
      })
    );

    render(<IncidentForm />);
    await userEvent.click(await screen.findByTestId('drop-pin'));

    await waitFor(() => {
      expect(screen.getByText('📍 Resolving address…')).toBeInTheDocument();
    });
    expect(screen.getByText('📌 14.600000, 120.980000')).toBeInTheDocument();

    await act(async () => {
      resolveGeocode(null);
    });
  });

  it('falls back to coordinates-only when reverseGeocode returns null', async () => {
    mockReverseGeocode.mockResolvedValue(null);

    render(<IncidentForm />);
    await userEvent.click(await screen.findByTestId('drop-pin'));

    await waitFor(() => {
      expect(screen.getByText('📌 14.600000, 120.980000')).toBeInTheDocument();
    });
    expect(screen.queryByText(/📍/)).not.toBeInTheDocument();
  });
});
