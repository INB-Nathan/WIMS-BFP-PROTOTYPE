import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicHeader } from './PublicHeader';
import * as AuthContext from '@/context/AuthContext';

const mockUsePathname = vi.hoisted(() => vi.fn(() => '/'));

// Mock the AuthContext
vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

describe('PublicHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePathname.mockReturnValue('/');
  });

  describe('Anonymous state', () => {
    beforeEach(() => {
      vi.mocked(AuthContext.useAuth).mockReturnValue({
        user: null,
        isAuthenticated: false,
        serverValidated: false,
        canQueueOfflineWrites: false,
        loading: false,
        loggingOut: false,
        login: vi.fn(),
        logout: vi.fn(),
        refreshSession: vi.fn(),
      });
    });

    it('renders the WIMS-BFP logo', () => {
      render(<PublicHeader />);
      expect(screen.getByText('WIMS-BFP')).toBeInTheDocument();
    });

    it('renders Register and Sign In buttons', () => {
      render(<PublicHeader />);
      expect(screen.getByText('Register')).toBeInTheDocument();
      expect(screen.getByText('Sign In')).toBeInTheDocument();
    });

    it('renders Report a Fire button for desktop', () => {
      render(<PublicHeader />);
      const reportButtons = screen.getAllByText('Report a Fire');
      expect(reportButtons.length).toBeGreaterThan(0);
      const reportLinks = screen.getAllByRole('link', { name: /Report a Fire/i });
      reportLinks.forEach((link) => expect(link).toHaveAttribute('href', '/report'));
    });

    it('does not render nav links for anonymous users', () => {
      render(<PublicHeader />);
      expect(screen.queryByText('Home')).not.toBeInTheDocument();
      expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
      expect(screen.queryByText('Information')).not.toBeInTheDocument();
    });

    it('does not render avatar for anonymous users', () => {
      const { container } = render(<PublicHeader />);
      expect(container.querySelector('.public-header-avatar')).not.toBeInTheDocument();
    });
  });

  describe('Logged-in civilian state', () => {
    beforeEach(() => {
      vi.mocked(AuthContext.useAuth).mockReturnValue({
        user: {
          id: '123',
          email: 'civilian@test.com',
          preferred_username: 'civilian_user',
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
    });

    it('renders the WIMS-BFP logo', () => {
      render(<PublicHeader />);
      expect(screen.getByText('WIMS-BFP')).toBeInTheDocument();
    });

    it('renders nav links: Home, Dashboard, Information', () => {
      render(<PublicHeader />);
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Information')).toBeInTheDocument();
    });

    it('renders profile avatar with initial', () => {
      render(<PublicHeader />);
      const avatar = screen.getByText('C'); // 'C' from 'civilian_user'
      expect(avatar).toBeInTheDocument();
      expect(avatar.className).toContain('public-header-avatar');
    });

    it('renders Report a Fire button', () => {
      render(<PublicHeader />);
      const reportButtons = screen.getAllByText('Report a Fire');
      expect(reportButtons.length).toBeGreaterThan(0);
      const reportLinks = screen.getAllByRole('link', { name: /Report a Fire/i });
      reportLinks.forEach((link) => expect(link).toHaveAttribute('href', '/report'));
    });

    it('does not render Register or Sign In buttons', () => {
      render(<PublicHeader />);
      expect(screen.queryByText('Register')).not.toBeInTheDocument();
      expect(screen.queryByText('Sign In')).not.toBeInTheDocument();
    });
  });

  describe('Report page', () => {
    beforeEach(() => {
      vi.mocked(AuthContext.useAuth).mockReturnValue({
        user: null,
        isAuthenticated: false,
        serverValidated: false,
        canQueueOfflineWrites: false,
        loading: false,
        loggingOut: false,
        login: vi.fn(),
        logout: vi.fn(),
        refreshSession: vi.fn(),
      });
      mockUsePathname.mockReturnValue('/report');
    });

    it('does not render redundant Report a Fire actions', () => {
      const { container } = render(<PublicHeader />);
      expect(screen.queryByRole('link', { name: /Report a Fire/i })).not.toBeInTheDocument();
      expect(container.querySelector('.public-fab')).not.toBeInTheDocument();
    });
  });

  describe('FAB (Floating Action Button)', () => {
    beforeEach(() => {
      vi.mocked(AuthContext.useAuth).mockReturnValue({
        user: null,
        isAuthenticated: false,
        serverValidated: false,
        canQueueOfflineWrites: false,
        loading: false,
        loggingOut: false,
        login: vi.fn(),
        logout: vi.fn(),
        refreshSession: vi.fn(),
      });
    });

    it('renders the mobile FAB', () => {
      const { container } = render(<PublicHeader />);
      const fab = container.querySelector('.public-fab');
      expect(fab).toBeInTheDocument();
    });

    it('FAB links to /report', () => {
      const { container } = render(<PublicHeader />);
      const fab = container.querySelector('.public-fab');
      expect(fab).toHaveAttribute('href', '/report');
    });

    it('FAB has accessible label', () => {
      const { container } = render(<PublicHeader />);
      const fab = container.querySelector('.public-fab');
      expect(fab).toHaveAttribute('aria-label', 'Report a Fire');
    });
  });

  describe('Staff roles', () => {
    it('does not render for REGIONAL_ENCODER', () => {
      vi.mocked(AuthContext.useAuth).mockReturnValue({
        user: {
          id: '456',
          email: 'encoder@test.com',
          role: 'REGIONAL_ENCODER',
          assignedRegionId: 1,
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

      const { container } = render(<PublicHeader />);
      expect(container.querySelector('.public-header')).not.toBeInTheDocument();
    });

    it('does not render for NATIONAL_VALIDATOR', () => {
      vi.mocked(AuthContext.useAuth).mockReturnValue({
        user: {
          id: '789',
          email: 'validator@test.com',
          role: 'NATIONAL_VALIDATOR',
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

      const { container } = render(<PublicHeader />);
      expect(container.querySelector('.public-header')).not.toBeInTheDocument();
    });

    it('does not render for NATIONAL_ANALYST', () => {
      vi.mocked(AuthContext.useAuth).mockReturnValue({
        user: {
          id: 'abc',
          email: 'analyst@test.com',
          role: 'NATIONAL_ANALYST',
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

      const { container } = render(<PublicHeader />);
      expect(container.querySelector('.public-header')).not.toBeInTheDocument();
    });

    it('does not render for SYSTEM_ADMIN', () => {
      vi.mocked(AuthContext.useAuth).mockReturnValue({
        user: {
          id: 'def',
          email: 'admin@test.com',
          role: 'SYSTEM_ADMIN',
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

      const { container } = render(<PublicHeader />);
      expect(container.querySelector('.public-header')).not.toBeInTheDocument();
    });
  });

  describe('Loading state', () => {
    it('does not render during auth loading', () => {
      vi.mocked(AuthContext.useAuth).mockReturnValue({
        user: null,
        isAuthenticated: false,
        serverValidated: false,
        canQueueOfflineWrites: false,
        loading: true,
        loggingOut: false,
        login: vi.fn(),
        logout: vi.fn(),
        refreshSession: vi.fn(),
      });

      const { container } = render(<PublicHeader />);
      expect(container.querySelector('.public-header')).not.toBeInTheDocument();
    });
  });
});
