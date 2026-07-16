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

const { mockOfflineWorkCounts } = vi.hoisted(() => ({
  mockOfflineWorkCounts: vi.fn(() => ({
    pendingCount: 0,
    failedCount: 0,
    conflictCount: 0,
    draftCount: 0,
    totalActionableCount: 0,
    loading: false,
  })),
}));

vi.mock('@/lib/useOfflineWorkCounts', () => ({
  useOfflineWorkCounts: () => mockOfflineWorkCounts(),
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

describe('Sidebar — Offline Work badge (Item 10)', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows Offline Work nav item for REGIONAL_ENCODER', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'REGIONAL_ENCODER', id: 'enc-1' },
      loading: false,
      logout: vi.fn(),
    });
    mockOfflineWorkCounts.mockReturnValue({
      pendingCount: 3,
      failedCount: 1,
      conflictCount: 2,
      draftCount: 0,
      totalActionableCount: 6,
      loading: false,
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Offline Work')).toBeInTheDocument();
    // Badge shows 6 (totalActionableCount)
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('Offline Work link points to /dashboard/regional/offline-work', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'REGIONAL_ENCODER', id: 'enc-2' },
      loading: false,
      logout: vi.fn(),
    });
    mockOfflineWorkCounts.mockReturnValue({
      totalActionableCount: 1,
      loading: false,
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    const link = screen.getByText('Offline Work').closest('a');
    expect(link).toHaveAttribute('href', '/dashboard/regional/offline-work');
  });

  it('hides badge when totalActionableCount is zero', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'REGIONAL_ENCODER', id: 'enc-3' },
      loading: false,
      logout: vi.fn(),
    });
    mockOfflineWorkCounts.mockReturnValue({
      pendingCount: 0,
      failedCount: 0,
      conflictCount: 0,
      draftCount: 0,
      totalActionableCount: 0,
      loading: false,
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Offline Work')).toBeInTheDocument();
    // No badge element with '0'
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('does NOT show Offline Work or badge count for SYSTEM_ADMIN role', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'SYSTEM_ADMIN' },
      loading: false,
      logout: vi.fn(),
    });
    mockOfflineWorkCounts.mockReturnValue({
      pendingCount: 3,
      failedCount: 2,
      conflictCount: 1,
      draftCount: 0,
      totalActionableCount: 6,
      loading: false,
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByText('Offline Work')).not.toBeInTheDocument();
    expect(screen.queryByText('6')).not.toBeInTheDocument();
    expect(mockOfflineWorkCounts).toHaveBeenCalled();
  });

  it('does NOT show Offline Work for NATIONAL_VALIDATOR role', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'NATIONAL_VALIDATOR' },
      loading: false,
      logout: vi.fn(),
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByText('Offline Work')).not.toBeInTheDocument();
  });

  it('does NOT show Offline Work for NATIONAL_ANALYST role', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'NATIONAL_ANALYST' },
      loading: false,
      logout: vi.fn(),
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByText('Offline Work')).not.toBeInTheDocument();
  });
});

describe('Sidebar — CIVILIAN_REPORTER uses navbar, not sidebar nav items (#615)', () => {
  afterEach(() => {
    cleanup();
  });

  it('does NOT render the legacy Contributor (Megaphone) nav item for CIVILIAN_REPORTER', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'CIVILIAN_REPORTER' },
      loading: false,
      logout: vi.fn(),
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByText('Contributor')).not.toBeInTheDocument();
  });

  it('does NOT render the legacy Information (Newspaper) nav item for CIVILIAN_REPORTER', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'CIVILIAN_REPORTER' },
      loading: false,
      logout: vi.fn(),
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByText('Information')).not.toBeInTheDocument();
  });

  it('does NOT render any nav sections for CIVILIAN_REPORTER (PublicHeader owns civilian nav)', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'CIVILIAN_REPORTER' },
      loading: false,
      logout: vi.fn(),
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByText('My Profile')).not.toBeInTheDocument();
    expect(screen.queryByText('Operations')).not.toBeInTheDocument();
  });

  it('leaves SYSTEM_ADMIN nav unaffected (regression guard: shared getNavSections branch)', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'SYSTEM_ADMIN' },
      loading: false,
      logout: vi.fn(),
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Governance')).toBeInTheDocument();
    expect(screen.getByText('Configuration')).toBeInTheDocument();
  });

  it('leaves REGIONAL_ENCODER nav unaffected (regression guard: shared getNavSections branch)', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'REGIONAL_ENCODER', id: 'enc-4' },
      loading: false,
      logout: vi.fn(),
    });
    mockOfflineWorkCounts.mockReturnValue({
      pendingCount: 0,
      failedCount: 0,
      conflictCount: 0,
      draftCount: 0,
      totalActionableCount: 0,
      loading: false,
    });
    render(<Sidebar isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Manual Entry')).toBeInTheDocument();
    expect(screen.getByText('Import AFOR')).toBeInTheDocument();
  });
});
