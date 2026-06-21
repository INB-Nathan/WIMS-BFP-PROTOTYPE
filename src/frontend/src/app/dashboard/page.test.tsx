/**
 * Dashboard page tests — NATIONAL_ANALYST redirect to /dashboard/analyst.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import DashboardPage from './page';

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const mockFetchRegionsOfflineAware = vi.fn();
const mockFetchProvincesOfflineAware = vi.fn();
const mockFetchCitiesOfflineAware = vi.fn();

vi.mock('@/lib/api', () => ({
  // Plan T13 (Phase B) — offline-aware reference reads (regions/provinces/cities).
  fetchRegionsOfflineAware: (userId: string) => mockFetchRegionsOfflineAware(userId),
  fetchProvincesOfflineAware: (userId: string, regionId: string | number) =>
    mockFetchProvincesOfflineAware(userId, regionId),
  fetchCitiesOfflineAware: (userId: string, provinceId: string | number) =>
    mockFetchCitiesOfflineAware(userId, provinceId),
  // Legacy fallbacks kept for safety — the rewire should not call them.
  fetchRegions: vi.fn().mockResolvedValue([]),
  fetchProvinces: vi.fn().mockResolvedValue([]),
  fetchCities: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/edgeFunctions', () => ({
  edgeFunctions: { getAnalyticsSummary: vi.fn().mockResolvedValue({ total_incidents: 0, by_general_category: [] }) },
  AnalyticsSummaryResponse: {},
}));

import { useAuth } from '@/context/AuthContext';

describe('Dashboard page — NATIONAL_ANALYST redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchRegionsOfflineAware.mockResolvedValue({ response: [], fromCache: false });
    mockFetchProvincesOfflineAware.mockResolvedValue({ response: [], fromCache: false });
    mockFetchCitiesOfflineAware.mockResolvedValue({ response: [], fromCache: false });
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'test-user', role: 'NATIONAL_ANALYST' },
      loading: false,
      loggingOut: false,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    });
  });

  it('redirects NATIONAL_ANALYST to /dashboard/analyst', () => {
    render(<DashboardPage />);

    expect(mockReplace).toHaveBeenCalledWith('/dashboard/analyst');
  });

  it('calls fetchRegionsOfflineAware with the active user id (Plan T13 reference rewire)', async () => {
    render(<DashboardPage />);

    await waitFor(() => {
      expect(mockFetchRegionsOfflineAware).toHaveBeenCalledWith('test-user');
    });
  });
});
