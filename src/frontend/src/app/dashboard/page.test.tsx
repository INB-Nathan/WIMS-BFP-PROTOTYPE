/**
 * Dashboard page tests — NATIONAL_ANALYST redirect to /dashboard/analyst.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import DashboardPage from './page';

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
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
});
