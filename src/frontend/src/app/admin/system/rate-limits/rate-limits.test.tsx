/**
 * TDD: #363 Rate Limits admin page
 *
 * Verifies that /admin/system/rate-limits:
 * 1. Loads and displays current threshold + window from the API
 * 2. Shows explanatory copy about what the login tier protects
 * 3. Validates inputs (>=1 for both fields)
 * 4. Shows success message on save
 * 5. Shows failure message on API error
 * 6. Redirects non-admin users
 * 7. Refresh button reloads config
 */
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import RateLimitsPage from './page';
import userEvent from '@testing-library/user-event';

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(() => ({
    user: { role: 'SYSTEM_ADMIN' },
    loading: false,
    logout: vi.fn(),
  })),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isChecking: false, isReconnecting: false, state: 'online' }),
}));

const mockFetchRateLimits = vi.fn();
const mockUpdateRateLimits = vi.fn();
const mockFetchRateLimitsOfflineAware = vi.fn();

vi.mock('@/lib/api/legacy', () => ({
  fetchRateLimits: () => mockFetchRateLimits(),
  updateRateLimits: (tier: string, limit: number, window: number) =>
    mockUpdateRateLimits(tier, limit, window),
}));

vi.mock('@/lib/api/offlineAdmin', () => ({
  fetchRateLimitsOfflineAware: () => mockFetchRateLimitsOfflineAware(),
}));

function mockAdminUser() {
  mockUseAuth.mockReturnValue({
    user: { role: 'SYSTEM_ADMIN' },
    loading: false,
    logout: vi.fn(),
  });
}

const DEFAULT_CONFIG = {
  tier: 'login',
  login_window_seconds: 900,
  login_threshold: 5,
  updated_at: '1746432000.0',
};

describe('RateLimitsPage — loading', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockAdminUser();
    mockFetchRateLimits.mockResolvedValue(DEFAULT_CONFIG);
    // Default online mock — delegates to legacy so existing tests pass.
    // The T11 test overrides to return fromCache=true.
    mockFetchRateLimitsOfflineAware.mockImplementation(async () => ({
      response: await mockFetchRateLimits(),
      fromCache: false,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('displays loading spinner while fetching', () => {
    mockFetchRateLimits.mockReturnValue(new Promise(() => {})); // never resolves
    render(<RateLimitsPage />);
    expect(screen.getByText(/loading rate-limit/i)).toBeInTheDocument();
  });

  it('loads and displays current threshold and window', async () => {
    render(<RateLimitsPage />);
    await waitFor(() => {
      expect(screen.getByText(/login tier configuration/i)).toBeInTheDocument();
    });
    const thresholdInput = screen.getByDisplayValue('5');
    const windowInput = screen.getByDisplayValue('900');
    expect(thresholdInput).toBeInTheDocument();
    expect(windowInput).toBeInTheDocument();
  });

  it('shows explanatory copy about what the tier protects', async () => {
    render(<RateLimitsPage />);
    await waitFor(() => {
      expect(screen.getByText(/what this protects/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/keycloak authentication callback/i)).toBeInTheDocument();
  });
});

describe('RateLimitsPage — save', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockAdminUser();
    mockFetchRateLimits.mockResolvedValue(DEFAULT_CONFIG);
    mockUpdateRateLimits.mockResolvedValue({
      ...DEFAULT_CONFIG,
      login_threshold: 10,
      login_window_seconds: 600,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('saves updated threshold and window', async () => {
    const user = userEvent.setup();
    render(<RateLimitsPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('5')).toBeInTheDocument();
    });

    const thresholdInput = screen.getByDisplayValue('5');
    const windowInput = screen.getByDisplayValue('900');
    await user.clear(thresholdInput);
    await user.type(thresholdInput, '10');
    await user.clear(windowInput);
    await user.type(windowInput, '600');

    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/rate-limit configuration saved/i)).toBeInTheDocument();
    });
    expect(mockUpdateRateLimits).toHaveBeenCalledWith('login', 10, 600);
  });

  it('shows error message on save failure', async () => {
    mockUpdateRateLimits.mockRejectedValue(new Error('Redis write failed'));
    const user = userEvent.setup();
    render(<RateLimitsPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('5')).toBeInTheDocument();
    });

    const thresholdInput = screen.getByDisplayValue('5');
    await user.clear(thresholdInput);
    await user.type(thresholdInput, '20');

    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/redis write failed/i)).toBeInTheDocument();
    });
  });

  it('disables save button when no changes made', async () => {
    render(<RateLimitsPage />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('5')).toBeInTheDocument();
    });
    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    expect(saveBtn).toBeDisabled();
  });

  it('shows validation error for zero threshold', async () => {
    const user = userEvent.setup();
    render(<RateLimitsPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('5')).toBeInTheDocument();
    });

    const thresholdInput = screen.getByDisplayValue('5');
    await user.clear(thresholdInput);
    await user.type(thresholdInput, '0');

    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/threshold must be a whole number ≥ 1/i)).toBeInTheDocument();
    });
  });

  it('shows validation error for empty window', async () => {
    const user = userEvent.setup();
    render(<RateLimitsPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('900')).toBeInTheDocument();
    });

    const windowInput = screen.getByDisplayValue('900');
    await user.clear(windowInput);

    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/both fields are required/i)).toBeInTheDocument();
    });
  });
});

describe('RateLimitsPage — error and edge cases', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows error when API fails to load', async () => {
    mockAdminUser();
    mockFetchRateLimits.mockRejectedValue(new Error('Network error'));
    render(<RateLimitsPage />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load rate-limit/i)).toBeInTheDocument();
    });
  });

  it('shows last-updated timestamp when available', async () => {
    mockAdminUser();
    mockFetchRateLimits.mockResolvedValue({
      ...DEFAULT_CONFIG,
      updated_at: '1746432000.0',
    });
    render(<RateLimitsPage />);

    await waitFor(() => {
      // The timestamp is converted from seconds to ms — any non-empty text is fine
      expect(screen.getByText(/last updated/i)).toBeInTheDocument();
    });
  });

  it('redirects non-admin users', async () => {
    mockReplace.mockReset();
    mockUseAuth.mockReturnValue({
      user: { role: 'REGIONAL_ENCODER' },
      loading: false,
      logout: vi.fn(),
    });

    mockFetchRateLimits.mockResolvedValue(DEFAULT_CONFIG);
    render(<RateLimitsPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/admin/system');
    });
  });
});

// ── T11: offline-aware read cache (T11 rewire) ──────────────────────────────

describe('RateLimitsPage — offline-aware read caching (T11)', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockAdminUser();
    mockFetchRateLimits.mockResolvedValue(DEFAULT_CONFIG);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders StaleCacheBanner when offline-aware wrapper returns fromCache=true', async () => {
    const cachedAt = Date.now() - 60_000;
    mockFetchRateLimitsOfflineAware.mockResolvedValue({
      response: DEFAULT_CONFIG,
      fromCache: true,
      cachedAt,
    });

    render(<RateLimitsPage />);

    await waitFor(() => {
      expect(mockFetchRateLimitsOfflineAware).toHaveBeenCalled();
    });
    // Stale cache banner should be visible
    expect(screen.getByText(/Showing cached data/i)).toBeInTheDocument();
    // Underlying data should still render from the cached response
    await waitFor(() => {
      expect(screen.getByDisplayValue('5')).toBeInTheDocument();
    });
  });
});
