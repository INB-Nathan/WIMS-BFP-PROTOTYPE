/**
 * TDD: Sidebar navigation — #363 Rate Limits entry
 *
 * Verifies that the Sidebar:
 * 1. Shows "Rate Limits" nav item for SYSTEM_ADMIN
 * 2. Does NOT show "Rate Limits" for other roles
 * 3. Links to /admin/system/rate-limits
 */
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Sidebar } from '@/components/Sidebar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/system/config',
  useRouter: () => ({ push: vi.fn() }),
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

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ alt, ...props }: { alt: string; [key: string]: unknown }) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt} {...props} />;
  },
}));

describe('Sidebar — Rate Limits entry', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows Rate Limits for SYSTEM_ADMIN', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'SYSTEM_ADMIN' },
      loading: false,
      logout: vi.fn(),
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Rate Limits')).toBeInTheDocument();
  });

  it('Rate Limits link points to /admin/system/rate-limits', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'SYSTEM_ADMIN' },
      loading: false,
      logout: vi.fn(),
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    const link = screen.getByText('Rate Limits').closest('a');
    expect(link).toHaveAttribute('href', '/admin/system/rate-limits');
  });

  it('does NOT show Rate Limits for REGIONAL_ENCODER', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'REGIONAL_ENCODER' },
      loading: false,
      logout: vi.fn(),
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByText('Rate Limits')).not.toBeInTheDocument();
  });

  it('does NOT show Rate Limits for NATIONAL_VALIDATOR', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'NATIONAL_VALIDATOR' },
      loading: false,
      logout: vi.fn(),
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByText('Rate Limits')).not.toBeInTheDocument();
  });

  it('does NOT show Rate Limits for NATIONAL_ANALYST', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'NATIONAL_ANALYST' },
      loading: false,
      logout: vi.fn(),
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByText('Rate Limits')).not.toBeInTheDocument();
  });

  it('Configuration is still present for SYSTEM_ADMIN', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'SYSTEM_ADMIN' },
      loading: false,
      logout: vi.fn(),
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Configuration')).toBeInTheDocument();
  });
});
