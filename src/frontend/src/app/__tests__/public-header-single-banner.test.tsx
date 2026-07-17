/**
 * Route-level single-header guarantee (issue #654, plan Step 6).
 *
 * Verifies that public/civilian routes render EXACTLY ONE <header> element
 * (PublicHeader's .landing-header chrome) and that the PublicThemeProvider's
 * own .ps-header chrome is suppressed via showHeader={false} — i.e. no
 * double-header bug on /report and /tracking.
 *
 * This mounts the REAL LayoutShell + real PublicHeader (no PublicHeader stub),
 * so the DOM <header> count is asserted against the actual rendered tree.
 */
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LayoutShell } from '@/components/LayoutShell';

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
    mockUsePathname: vi.fn(() => '/report'),
    mockUseNetworkStatus: vi.fn(() => ({ isOnline: true })),
  }),
);

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

describe('Public surface — exactly one header per route (#654)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // Routes that previously double-rendered (provider ps-header + PublicHeader).
  const singleHeaderPaths = ['/report', '/tracking', '/tracking/abc', '/register', '/contributor', '/information'];

  it.each(singleHeaderPaths)(
    'renders exactly ONE <header> and no .ps-header duplicate on "%s"',
    (pathname) => {
      mockUsePathname.mockReturnValue(pathname);
      render(<LayoutShell>child-content</LayoutShell>);

      // (a) child renders
      expect(screen.getByText('child-content')).toBeInTheDocument();

      // (b) exactly one banner (PublicHeader's .landing-header)
      const banners = screen.getAllByRole('banner');
      expect(banners.length).toBe(1);

      // (c) provider's own ps-header chrome is suppressed via showHeader={false}
      expect(document.querySelector('.ps-header')).toBeNull();
      expect(document.querySelector('.landing-header')).not.toBeNull();
    },
  );

  it('renders no navigation header or footer on /login', () => {
    mockUsePathname.mockReturnValue('/login');
    render(<LayoutShell>child-content</LayoutShell>);

    expect(screen.getByText('child-content')).toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  });
});
