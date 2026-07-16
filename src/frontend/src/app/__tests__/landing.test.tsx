import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock next/navigation (used by IntentModal)
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock next/link
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// Mock intent modal — it has cookie/effect logic that's tested separately
vi.mock('@/components/IntentModal', () => ({
  IntentModal: () => <div data-testid="intent-modal" />,
}));

// Mock the client data-fetching sections
vi.mock('@/components/LandingSections', () => ({
  EmergenciesSection: () => <div data-testid="emergencies-section" />,
  AnnouncementsSection: () => <div data-testid="announcements-section" />,
}));

// Mock PublicFireMap (SSR-unsafe)
vi.mock('@/components/PublicFireMap', () => ({
  PublicFireMap: ({ showStations }: { showStations?: boolean }) => (
    <div data-testid="public-fire-map" data-show-stations={String(showStations)} />
  ),
}));

// Mock Tabler icon
vi.mock('@tabler/icons-react', () => ({
  IconMapPinFilled: () => <span data-testid="icon-map-pin" />,
}));

describe('LandingPage (public landing /)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the intent modal', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    expect(screen.getByTestId('intent-modal')).toBeInTheDocument();
  });

  it('renders the map', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    expect(screen.getByTestId('public-fire-map')).toBeInTheDocument();
  });

  it('renders emergencies and announcements sections', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    expect(screen.getByTestId('emergencies-section')).toBeInTheDocument();
    expect(screen.getByTestId('announcements-section')).toBeInTheDocument();
  });

  it('does NOT export LiveTicker from LandingSections', async () => {
    // Bypass the LandingSections mock to check the real module no longer exports LiveTicker
    const actualMod = await vi.importActual<Record<string, unknown>>('@/components/LandingSections');
    expect(actualMod.LiveTicker).toBeUndefined();
  });

  it('does NOT render the old hero title and subtitle', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    // The old hero section displayed an h1 "WIMS-BFP" in the page markup.
    // The new page puts "WIMS-BFP" inside the IntentModal (mocked away),
    // so no h1 should be directly in the page.
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('does NOT render the old "Find a fire station" standalone card', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    // The old card had link text "Find a fire station"
    expect(screen.queryByText(/Find a fire station/i)).not.toBeInTheDocument();
  });

  it('renders the fire stations toggle button on the map overlay', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    const toggleBtn = screen.getByTestId('toggle-stations-btn');
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute('aria-label', 'Toggle fire stations');
  });

  it('renders footer with Privacy Policy and Register links', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Register' })).toHaveAttribute('href', '/register');
  });

  it('renders the fire-stations link in the bottom sheet', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    // Find the link whose content includes "Fire stations" and "Locate the nearest"
    const stationLinks = screen.getAllByRole('link');
    const bottomStationLink = stationLinks.find(
      (link) =>
        link.getAttribute('href') === '/fire-stations' &&
        link.textContent?.includes('Fire stations'),
    );
    expect(bottomStationLink).toBeTruthy();
    expect(bottomStationLink?.textContent).toContain('Locate the nearest BFP station');
  });

  it('renders no old hero CTA buttons (Report a Fire, Become a Reporter, Sign In)', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    // These were in the old hero section
    expect(screen.queryByRole('link', { name: 'Become a Reporter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Sign In$/ })).not.toBeInTheDocument();
  });
});
