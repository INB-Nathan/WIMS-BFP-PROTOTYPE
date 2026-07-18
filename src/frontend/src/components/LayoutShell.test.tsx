/**
 * Unit tests for LayoutShell — route-driven header selection.
 * Issue #609 (PR feat/609-shared-header-nav)
 *
 * Verifies that:
 * - Public routes render PublicHeader except / (page-owned overlay) and /login.
 * - Civilian routes (/contributor, /information) render PublicHeader.
 * - /profile uses the civilian shell only for CIVILIAN_REPORTER.
 * - Staff-authenticated routes render Sidebar+Header (not PublicHeader).
 */
import { render, screen, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LayoutShell } from './LayoutShell';

// ---- Hoisted mocks ----
const { mockUseAuth, mockUsePathname, mockUseNetworkStatus } = vi.hoisted(
  () => ({
    mockUseAuth: vi.fn(() => ({
      user: null,
      isAuthenticated: false,
      serverValidated: false,
      canQueueOfflineWrites: false,
      loading: false,
      loggingOut: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    })),
    mockUsePathname: vi.fn(() => '/'),
    mockUseNetworkStatus: vi.fn(() => ({ isOnline: true })),
  }),
);

// ---- Module mocks ----
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

vi.mock('@/lib/useNetworkStatus', () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

vi.mock('@/lib/swRegistration', () => ({
  registerServiceWorker: vi.fn(),
}));

vi.mock('@/lib/offlineStore', () => ({
  maybePruneCaches: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/usePreloadDashboardData', () => ({
  usePreloadDashboardData: vi.fn(),
}));

// Child component markers
vi.mock('@/components/PublicHeader', () => ({
  PublicHeader: () => <div data-testid="public-header" />,
}));

vi.mock('@/components/Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

vi.mock('@/components/Header', () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock('@/components/PwaInstallPrompt', () => ({
  PwaInstallPrompt: () => null,
}));

describe('LayoutShell', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('Anonymous user on public routes (isPublicRoute)', () => {
    const publicPaths = [
      '/report',
      '/register',
      '/callback',
      '/verify-sent',
      '/verify',
      '/tracking/abc',
      '/fire-stations/123',
      '/privacy/policy',
    ];

    it.each(publicPaths)('renders PublicHeader for pathname "%s"', (pathname) => {
      mockUsePathname.mockReturnValue(pathname);
      render(<LayoutShell>content</LayoutShell>);

      expect(screen.getByTestId('public-header')).toBeInTheDocument();
      expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
      expect(screen.queryByTestId('header')).not.toBeInTheDocument();
    });

    it.each(['/', '/login'])('does NOT inject PublicHeader for pathname "%s"', (pathname) => {
      mockUsePathname.mockReturnValue(pathname);
      render(<LayoutShell>content</LayoutShell>);

      expect(screen.queryByTestId('public-header')).not.toBeInTheDocument();
      expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
      expect(screen.queryByTestId('header')).not.toBeInTheDocument();
      expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    });
  });

  describe('Anonymous user on civilian routes (isCivilianRoute)', () => {
    const civilianPaths = ['/contributor', '/information'];

    it.each(civilianPaths)(
      'renders PublicHeader for civilian pathname "%s"',
      (pathname) => {
        mockUsePathname.mockReturnValue(pathname);
        render(<LayoutShell>content</LayoutShell>);

        expect(screen.getByTestId('public-header')).toBeInTheDocument();
        expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
        expect(screen.queryByTestId('header')).not.toBeInTheDocument();
      },
    );
  });

  describe('Anonymous auth-guard redirect (login)', () => {
    it('does NOT redirect anonymous users away from /information (public, #654)', () => {
      vi.useFakeTimers();
      const login = vi.fn();
      mockUseAuth.mockReturnValue({
        user: null,
        isAuthenticated: false,
        serverValidated: false,
        canQueueOfflineWrites: false,
        loading: false,
        loggingOut: false,
        login,
        logout: vi.fn(),
        refreshSession: vi.fn(),
      });
      mockUseNetworkStatus.mockReturnValue({ isOnline: true });
      mockUsePathname.mockReturnValue('/information');
      render(<LayoutShell>content</LayoutShell>);

      // 500ms debounce in the guard — advance past it.
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(login).not.toHaveBeenCalled();
      expect(screen.getByTestId('public-header')).toBeInTheDocument();
      vi.useRealTimers();
    });

    it('still redirects anonymous users away from /contributor (auth-gated)', () => {
      vi.useFakeTimers();
      const login = vi.fn();
      mockUseAuth.mockReturnValue({
        user: null,
        isAuthenticated: false,
        serverValidated: false,
        canQueueOfflineWrites: false,
        loading: false,
        loggingOut: false,
        login,
        logout: vi.fn(),
        refreshSession: vi.fn(),
      });
      mockUseNetworkStatus.mockReturnValue({ isOnline: true });
      mockUsePathname.mockReturnValue('/contributor');
      render(<LayoutShell>content</LayoutShell>);

      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(login).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });
  });

  describe('/profile role-aware shell', () => {
    it('renders PublicHeader for a civilian reporter', () => {
      mockUseAuth.mockReturnValue({
        user: { id: 'civilian-1', preferred_username: 'reporter', role: 'CIVILIAN_REPORTER' },
        isAuthenticated: true,
        serverValidated: true,
        canQueueOfflineWrites: true,
        loading: false,
        loggingOut: false,
        login: vi.fn(),
        logout: vi.fn(),
        refreshSession: vi.fn(),
      });
      mockUsePathname.mockReturnValue('/profile');
      render(<LayoutShell>content</LayoutShell>);

      expect(screen.getByTestId('public-header')).toBeInTheDocument();
      expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    });

    it('retains the staff shell for a non-civilian user', () => {
      mockUseAuth.mockReturnValue({
        user: { id: 'staff-1', preferred_username: 'analyst', role: 'NATIONAL_ANALYST' },
        isAuthenticated: true,
        serverValidated: true,
        canQueueOfflineWrites: true,
        loading: false,
        loggingOut: false,
        login: vi.fn(),
        logout: vi.fn(),
        refreshSession: vi.fn(),
      });
      mockUsePathname.mockReturnValue('/profile');
      render(<LayoutShell>content</LayoutShell>);

      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
      expect(screen.getByTestId('header')).toBeInTheDocument();
      expect(screen.queryByTestId('public-header')).not.toBeInTheDocument();
    });
  });

  describe('Staff-authenticated user', () => {
    const staffRoles = [
      'REGIONAL_ENCODER',
      'NATIONAL_VALIDATOR',
      'NATIONAL_ANALYST',
      'SYSTEM_ADMIN',
    ];

    it.each(staffRoles)(
      'renders Sidebar+Header (not PublicHeader) for role %s on any route',
      (role) => {
        mockUseAuth.mockReturnValue({
          user: {
            id: 'staff-1',
            preferred_username: 'staff_user',
            role,
            assignedRegionId: role === 'REGIONAL_ENCODER' ? 1 : null,
          },
          isAuthenticated: true,
          serverValidated: true,
          canQueueOfflineWrites: true,
          loading: false,
          loggingOut: false,
          login: vi.fn(),
          logout: vi.fn(),
          refreshSession: vi.fn(),
        });
        // Use a non-public /staff path to trigger the Sidebar+Header branch
        mockUsePathname.mockReturnValue('/dashboard');
        render(<LayoutShell>content</LayoutShell>);

        expect(screen.getByTestId('sidebar')).toBeInTheDocument();
        expect(screen.getByTestId('header')).toBeInTheDocument();
        expect(screen.queryByTestId('public-header')).not.toBeInTheDocument();
      },
    );
  });
});
