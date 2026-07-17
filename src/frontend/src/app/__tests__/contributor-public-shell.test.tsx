/**
 * Route-composition regression (issue #655, Task T3).
 *
 * Mounts the REAL LayoutShell (with the real PublicThemeProvider +
 * PublicHeader — none of these are mocked) for the civilian /contributor
 * route and proves:
 *  - the existing provider/header already supplies the full civilian
 *    navigation (Home / Dashboard / Information, avatar, Report a Fire);
 *  - exactly one banner renders (PublicHeader's .landing-header) and the
 *    provider's own .ps-header chrome is suppressed (no double-header);
 *  - exactly one theme toggle exists;
 *  - the shared theme toggle starts light, flips to dark on click, persists
 *    to localStorage['landing-theme'], and the stored value is read back on a
 *    fresh mount (true persistence, not a single-tree in-memory state).
 *
 * Only dependency/mocking seams are mocked — mirroring the single-banner
 * regression test's mocking pattern exactly.
 */
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LayoutShell } from '@/components/LayoutShell';

// ---- Hoisted mocks (mirror public-header-single-banner.test.tsx) ----
const { mockUseAuth, mockUsePathname, mockUseNetworkStatus } = vi.hoisted(() => {
  const civilianUser = {
    user: {
      id: '123',
      email: 'civilian@test.com',
      preferred_username: 'civilian_user',
      sub: 'sub-123',
      role: 'CIVILIAN_REPORTER',
      assignedRegionId: null,
    },
    isAuthenticated: true,
    serverValidated: true,
    canQueueOfflineWrites: true,
    loading: false,
    loggingOut: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
  };
  return {
    mockUseAuth: vi.fn(() => civilianUser),
    mockUsePathname: vi.fn(() => '/contributor'),
    mockUseNetworkStatus: vi.fn(() => ({ isOnline: true })),
  };
});

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

vi.mock('@/components/Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

vi.mock('@/components/Header', () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock('@/components/PwaInstallPrompt', () => ({
  PwaInstallPrompt: () => null,
}));

describe('Contributor civilian shell — singular + persistent (issue #655)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders the real civilian shell with one header and a persisted theme on /contributor', async () => {
    const user = userEvent.setup();

    // Mocked CIVILIAN_REPORTER user + /contributor pathname.
    mockUsePathname.mockReturnValue('/contributor');
    mockUseAuth.mockReturnValue({
      user: {
        id: '123',
        email: 'civilian@test.com',
        preferred_username: 'civilian_user',
        sub: 'sub-123',
        role: 'CIVILIAN_REPORTER',
        assignedRegionId: null,
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

    const { unmount } = render(<LayoutShell>child-content</LayoutShell>);

    // child renders inside the provider
    expect(screen.getByText('child-content')).toBeInTheDocument();

    // civilian navigation destinations
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/contributor',
    );
    expect(screen.getByRole('link', { name: 'Information' })).toHaveAttribute(
      'href',
      '/information',
    );

    // civilian avatar present
    expect(document.querySelector('.landing-header-avatar')).not.toBeNull();

    // Report a Fire CTA
    expect(screen.getByTestId('header-report')).toHaveAttribute('href', '/report');

    // exactly ONE banner (PublicHeader's .landing-header); provider .ps-header suppressed
    expect(screen.getAllByRole('banner').length).toBe(1);
    expect(document.querySelector('.ps-header')).toBeNull();
    expect(document.querySelector('.landing-header')).not.toBeNull();

    // exactly one theme toggle
    expect(screen.getAllByTestId('theme-toggle').length).toBe(1);

    // initial data-theme is light (cleared storage → shared light-first default)
    const surface = document.querySelector('.public-surface');
    expect(surface).not.toBeNull();
    expect(surface?.getAttribute('data-theme')).toBe('light');

    // click toggle → dark
    await user.click(screen.getByTestId('theme-toggle'));
    expect(document.querySelector('.public-surface')?.getAttribute('data-theme')).toBe('dark');

    // persistence: localStorage reflects the toggled dark theme
    expect(localStorage.getItem('landing-theme')).toBe('dark');

    // read-back: a fresh LayoutShell mount reads the stored value back as dark
    unmount();
    render(<LayoutShell>child-content-2</LayoutShell>);
    expect(localStorage.getItem('landing-theme')).toBe('dark');
    expect(document.querySelector('.public-surface')?.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByText('child-content-2')).toBeInTheDocument();
  });
});
