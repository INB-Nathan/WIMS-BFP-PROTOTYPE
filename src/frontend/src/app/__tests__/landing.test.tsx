import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mock next/image
vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

// Mock next/link
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// Mock the client data-fetching sections so the test only exercises the
// static hero + CTA markup without network calls.
vi.mock('@/components/LandingSections', () => ({
  LiveTicker: () => <div data-testid="live-ticker" />,
  EmergenciesSection: () => <div data-testid="emergencies-section" />,
  AnnouncementsSection: () => <div data-testid="announcements-section" />,
}));

describe('LandingPage', () => {
  it('renders the hero title and subtitle', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'WIMS-BFP' })).toBeInTheDocument();
    expect(screen.getByText('Wildfire Incident Management System')).toBeInTheDocument();
  });

  it('renders the three primary CTAs with correct hrefs', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);

    const reportLink = screen.getByRole('link', { name: 'Report a Fire' });
    expect(reportLink).toHaveAttribute('href', '/report');

    const registerLink = screen.getByRole('link', { name: 'Become a Reporter' });
    expect(registerLink).toHaveAttribute('href', '/register');

    const loginLink = screen.getByRole('link', { name: 'Sign In' });
    expect(loginLink).toHaveAttribute('href', '/login');
  });

  it('renders the DPA footer Privacy Policy link and fire-stations link', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);

    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: /Find a fire station/i })).toHaveAttribute('href', '/fire-stations');
  });
});
