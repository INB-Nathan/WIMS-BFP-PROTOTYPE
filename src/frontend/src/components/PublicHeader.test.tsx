import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicHeader } from './PublicHeader';
import * as AuthContext from '@/context/AuthContext';
import * as PublicThemeProvider from '@/components/public/PublicThemeProvider';

const mockUsePathname = vi.hoisted(() => vi.fn(() => '/'));

// Mock the AuthContext
vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// Mock the public theme provider (no DOM side effects in tests)
vi.mock('@/components/public/PublicThemeProvider', () => ({
  usePublicTheme: vi.fn(() => ({ theme: 'dark', toggleTheme: vi.fn() })),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

const defaultAuth = {
  user: null as null | Record<string, unknown>,
  isAuthenticated: false,
  serverValidated: false,
  canQueueOfflineWrites: false,
  loading: false,
  loggingOut: false,
  login: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
};

const staffUser = (role: string) => ({
  ...defaultAuth,
  user: { id: '1', email: `${role.toLowerCase()}@test.com`, role, assignedRegionId: null },
  isAuthenticated: true,
  serverValidated: true,
  canQueueOfflineWrites: true,
});

const civilianUser = {
  ...defaultAuth,
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
};

describe('PublicHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePathname.mockReturnValue('/');
    vi.mocked(PublicThemeProvider.usePublicTheme).mockReturnValue({
      theme: 'dark',
      toggleTheme: vi.fn(),
    });
    vi.mocked(AuthContext.useAuth).mockReturnValue(defaultAuth);
  });

  describe('Authenticated staff on public routes', () => {
    it.each([
      ['REGIONAL_ENCODER', '/dashboard/regional'],
      ['NATIONAL_VALIDATOR', '/dashboard/validator'],
      ['NATIONAL_ANALYST', '/dashboard/analyst'],
      ['SYSTEM_ADMIN', '/admin/system'],
    ])('renders a role dashboard link for %s', (role, dashboardHref) => {
      vi.mocked(AuthContext.useAuth).mockReturnValue(staffUser(role));
      render(<PublicHeader />);

      expect(screen.getByRole('banner')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
        'href',
        dashboardHref,
      );
      expect(screen.queryByTestId('header-register')).not.toBeInTheDocument();
      expect(screen.queryByTestId('header-signin')).not.toBeInTheDocument();
    });
  });

  describe('Loading state', () => {
    it('does not render during auth loading', () => {
      vi.mocked(AuthContext.useAuth).mockReturnValue({ ...defaultAuth, loading: true });
      const { container } = render(<PublicHeader />);
      expect(screen.queryByRole('banner')).not.toBeInTheDocument();
      expect(container.querySelector('.landing-header')).not.toBeInTheDocument();
    });
  });

  describe('Anonymous state', () => {
    beforeEach(() => {
      vi.mocked(AuthContext.useAuth).mockReturnValue(defaultAuth);
    });

    it('renders .landing-header', () => {
      const { container } = render(<PublicHeader />);
      expect(container.querySelector('.landing-header')).toBeInTheDocument();
      expect(screen.getByRole('banner')).toBeInTheDocument();
    });

    it('renders the WIMS-BFP title', () => {
      render(<PublicHeader />);
      expect(screen.getByText('WIMS-BFP')).toBeInTheDocument();
    });

    it('renders only the approved public destinations plus sign-in', () => {
      render(<PublicHeader />);
      expect(screen.getByRole('link', { name: 'WIMS-BFP home' })).toHaveAttribute('href', '/');
      expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
      expect(screen.getByRole('link', { name: 'Active fires' })).toHaveAttribute('href', '/incidents');
      expect(screen.getByRole('link', { name: 'Information' })).toHaveAttribute('href', '/information');
      expect(screen.getByRole('link', { name: 'Fire stations' })).toHaveAttribute('href', '/fire-stations');
      expect(screen.getByTestId('header-register')).toHaveAttribute('href', '/register');
      expect(screen.getByTestId('header-signin')).toHaveAttribute('href', '/login');
      expect(screen.getByTestId('header-report')).toHaveAttribute('href', '/report');
    });

    it('renders theme-toggle button', () => {
      render(<PublicHeader />);
      const toggle = screen.getByTestId('theme-toggle');
      expect(toggle).toBeInTheDocument();
      expect(toggle.tagName).toBe('BUTTON');
    });

    it('does not expose authenticated navigation to anonymous users', () => {
      render(<PublicHeader />);
      expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    });

    it('does not render avatar for anonymous users', () => {
      const { container } = render(<PublicHeader />);
      expect(container.querySelector('.landing-header-avatar')).not.toBeInTheDocument();
    });
  });

  describe('Logged-in civilian state', () => {
    beforeEach(() => {
      vi.mocked(AuthContext.useAuth).mockReturnValue(civilianUser);
    });

    it('renders .landing-header', () => {
      const { container } = render(<PublicHeader />);
      expect(container.querySelector('.landing-header')).toBeInTheDocument();
      expect(screen.getByRole('banner')).toBeInTheDocument();
    });

    it('renders nav links: Home, Dashboard, Active fires, Information, Fire stations', () => {
      render(<PublicHeader />);
      const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
      expect(nav).toBeInTheDocument();
      expect(screen.getByText('Home')).toHaveAttribute('href', '/');
      expect(screen.getByText('Dashboard')).toHaveAttribute('href', '/contributor');
      expect(screen.getByText('Active fires')).toHaveAttribute('href', '/incidents');
      expect(screen.getByText('Information')).toHaveAttribute('href', '/information');
      expect(screen.getByText('Fire stations')).toHaveAttribute('href', '/fire-stations');
    });

    it('renders profile avatar with aria-label = email or username', () => {
      render(<PublicHeader />);
      const avatar = screen.getByRole('img', { name: 'civilian_user' });
      expect(avatar.className).toContain('landing-header-avatar');
      expect(avatar).toHaveTextContent('C');
    });

    it('renders Report a Fire link', () => {
      render(<PublicHeader />);
      const report = screen.getByTestId('header-report');
      expect(report).toHaveAttribute('href', '/report');
    });

    it('does not render Register or Sign In buttons', () => {
      render(<PublicHeader />);
      expect(screen.queryByTestId('header-register')).not.toBeInTheDocument();
      expect(screen.queryByTestId('header-signin')).not.toBeInTheDocument();
    });

    it('renders Sign out and calls logout', () => {
      const logout = vi.fn();
      vi.mocked(AuthContext.useAuth).mockReturnValue({ ...civilianUser, logout });
      render(<PublicHeader />);

      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      expect(logout).toHaveBeenCalledOnce();
    });
  });

  describe('Report page (hide CTA)', () => {
    beforeEach(() => {
      vi.mocked(AuthContext.useAuth).mockReturnValue(civilianUser);
      mockUsePathname.mockReturnValue('/report');
    });

    it('hides the Report a Fire link on /report', () => {
      render(<PublicHeader />);
      expect(screen.queryByTestId('header-report')).not.toBeInTheDocument();
    });
  });

  describe('Theme toggle label', () => {
    it('shows Dark label when theme is dark', () => {
      vi.mocked(PublicThemeProvider.usePublicTheme).mockReturnValue({
        theme: 'dark',
        toggleTheme: vi.fn(),
      });
      render(<PublicHeader />);
      expect(screen.getByTestId('theme-toggle')).toHaveTextContent('🌙 Dark');
    });

    it('shows Light label when theme is light', () => {
      vi.mocked(PublicThemeProvider.usePublicTheme).mockReturnValue({
        theme: 'light',
        toggleTheme: vi.fn(),
      });
      render(<PublicHeader />);
      expect(screen.getByTestId('theme-toggle')).toHaveTextContent('☀️ Light');
    });
  });
});
