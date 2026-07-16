/**
 * Unit tests for LayoutShell — route-driven header selection.
 * Issue #609 (PR feat/609-shared-header-nav)
 *
 * Verifies that:
 * - Public routes (/, /login, /register, /report, /callback, /verify-sent, /verify,
 *   /tracking/*, /fire-stations/*, /privacy/*) render PublicHeader.
 * - Civilian routes (/contributor, /information) render PublicHeader.
 * - Staff-authenticated routes render Sidebar+Header (not PublicHeader).
 */
import { render, screen, cleanup } from '@testing-library/react';
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
      '/',
      '/report',
      '/login',
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
