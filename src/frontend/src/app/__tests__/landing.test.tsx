import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';

// Mock next/navigation (used by IntentModal)
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock next/link
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
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

// Mock LandingSidebar — fires data is tested separately
vi.mock('@/components/LandingSidebar', () => ({
  LandingSidebar: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="landing-sidebar-component">
      <button data-testid="sidebar-close-btn" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

// Mock Tabler icons
vi.mock('@tabler/icons-react', () => ({
  IconMapPinFilled: () => <span data-testid="icon-map-pin" />,
  IconLayoutSidebar: () => <span data-testid="icon-layout-sidebar" />,
  IconFlameFilled: () => <span data-testid="icon-flame-filled" />,
  IconShieldCheckFilled: () => <span data-testid="icon-shield-check" />,
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

  it('renders emergencies and announcements sections in the sidebar mobile extra', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    expect(screen.getByTestId('emergencies-section')).toBeInTheDocument();
    expect(screen.getByTestId('announcements-section')).toBeInTheDocument();
  });

  it('does NOT export LiveTicker from LandingSections', async () => {
    const actualMod = await vi.importActual<Record<string, unknown>>(
      '@/components/LandingSections',
    );
    expect(actualMod.LiveTicker).toBeUndefined();
  });

  it('does NOT render the old hero title and subtitle', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    // The old hero section displayed an h1 "WIMS-BFP" in the page markup.
    // The new page puts "WIMS-BFP" inside the IntentModal (mocked away),
    // and the header uses a span, not an h1.
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('does NOT render the old "Find a fire station" standalone card', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    expect(screen.queryByRole('link', { name: 'Find a fire station' })).not.toBeInTheDocument();
  });

  it('renders the fire stations toggle button on the map overlay', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    const toggleBtn = screen.getByTestId('toggle-stations-btn');
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute('aria-label', 'Toggle fire stations');
  });

  it('renders the map trust panel', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    expect(screen.getByTestId('landing-trust-panel')).toBeInTheDocument();
    expect(screen.getByText(/Verified BFP incidents/)).toBeInTheDocument();
  });

  it('renders the floating header with Register, Sign In, and Report a Fire', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    expect(screen.getByTestId('header-register')).toHaveAttribute('href', '/register');
    expect(screen.getByTestId('header-signin')).toHaveAttribute('href', '/login');
    expect(screen.getByTestId('header-report')).toHaveAttribute('href', '/report');
  });

  it('renders the sidebar', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    expect(screen.getByTestId('landing-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('landing-sidebar-component')).toBeInTheDocument();
  });

  it('does NOT render a FAB (mobile emergency CTA is the header link only)', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    expect(screen.queryByTestId('fab-report')).not.toBeInTheDocument();
  });

  it('renders the sidebar toggle button with aria-expanded', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    const toggleBtn = screen.getByTestId('sidebar-toggle-btn');
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute('aria-label', 'Toggle active fires sidebar');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles sidebar open/close when toggle button is clicked', async () => {
    const user = userEvent.setup();
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    const sidebar = screen.getByTestId('landing-sidebar');
    // Sidebar starts closed (no 'open' class)
    expect(sidebar.className).not.toContain('open');

    // Click toggle button to open
    await user.click(screen.getByTestId('sidebar-toggle-btn'));
    expect(sidebar.className).toContain('open');

    // aria-expanded reflects open state
    expect(screen.getByTestId('sidebar-toggle-btn')).toHaveAttribute('aria-expanded', 'true');

    // Click sidebar close button
    await user.click(screen.getByTestId('sidebar-close-btn'));
    expect(sidebar.className).not.toContain('open');
    expect(screen.getByTestId('sidebar-toggle-btn')).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders footer with Privacy Policy and Register links', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(screen.getByRole('link', { name: 'Register as a reporter' })).toHaveAttribute(
      'href',
      '/register',
    );
  });

  it('does NOT render the old hero CTA buttons', async () => {
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    // "Become a Reporter" was in the old hero — new header calls it "Register"
    expect(screen.queryByRole('link', { name: 'Become a Reporter' })).not.toBeInTheDocument();
  });

  it('sidebar has dialog role and aria-modal when open', async () => {
    const user = userEvent.setup();
    const { default: LandingPage } = await import('../page');
    render(<LandingPage />);
    const sidebar = screen.getByTestId('landing-sidebar');

    // Closed: role=dialog, aria-modal=undefined
    expect(sidebar).toHaveAttribute('role', 'dialog');
    expect(sidebar.getAttribute('aria-modal')).toBeNull();

    // Open
    await user.click(screen.getByTestId('sidebar-toggle-btn'));
    expect(sidebar).toHaveAttribute('aria-modal', 'true');
  });
});
