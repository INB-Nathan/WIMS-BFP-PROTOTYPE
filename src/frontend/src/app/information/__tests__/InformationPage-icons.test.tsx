import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import InformationPage from '../page';

// Mock AuthContext
vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// Mock API information module
vi.mock('@/lib/api/information', () => ({
  fetchAnnouncements: vi.fn(),
  fetchEmergencies: vi.fn(),
  resolveAnnouncementImageUrl: vi.fn(),
}));

const { useAuth } = await import('@/context/AuthContext');

describe('InformationPage - Icon System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with Tabler icons, not emoji characters, in guide cards', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: '1', preferred_username: 'Test User', role: 'CIVILIAN_REPORTER' },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
      isAuthenticated: true,
      serverValidated: true,
      canQueueOfflineWrites: true,
      loggingOut: false,
    });

    const { container } = render(<InformationPage />);

    // Get the raw HTML of the guide section
    const guideSection = container.querySelector('[aria-labelledby="guide-heading"]');
    const htmlContent = guideSection?.innerHTML || '';

    // Common emoji patterns that should NOT be present in the guide cards area
    const emojiPatterns = [
      /📋/,  // Clipboard
      /🏷️/,  // Label/tag
      /⭐/,  // Star
      /📸/,  // Camera
      /🔒/,  // Lock
      /🔄/,  // Refresh/cycle
    ];

    // Verify no emoji in guide section
    emojiPatterns.forEach((pattern) => {
      expect(htmlContent).not.toMatch(pattern);
    });

    // Verify SVG icons are present (Tabler icons render as SVG)
    const svgElements = container.querySelectorAll('svg');
    expect(svgElements.length).toBeGreaterThan(0);
  });

  it('renders tab buttons with Tabler icons, not emoji', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: '1', preferred_username: 'Test User', role: 'CIVILIAN_REPORTER' },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
      isAuthenticated: true,
      serverValidated: true,
      canQueueOfflineWrites: true,
      loggingOut: false,
    });

    const { container } = render(<InformationPage />);

    // Select the tab container (the first div with rounded-lg inside the header)
    const header = container.querySelector('header');
    const tabContainer = header?.nextElementSibling;
    const tabButtons = tabContainer?.querySelectorAll('button') ?? [];

    expect(tabButtons.length).toBeGreaterThanOrEqual(3);

    // Check that tab buttons don't contain emoji text nodes
    tabButtons.forEach((button) => {
      const textContent = button.textContent || '';
      // Should not start with emoji (old pattern was "⚠ Emergencies", "📢 Announcements", "📖 Reporting Guide")
      expect(textContent).not.toMatch(/^[⚠📢📖]/);
    });

    // Verify SVG icons are in each tab button
    tabButtons.forEach((button) => {
      const svg = button.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  it('renders empty state icons as SVG, not emoji', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: '1', preferred_username: 'Test User', role: 'CIVILIAN_REPORTER' },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
      isAuthenticated: true,
      serverValidated: true,
      canQueueOfflineWrites: true,
      loggingOut: false,
    });

    const { container } = render(<InformationPage />);

    // Empty state containers are .text-center divs inside the emergencies/announcements sections
    const emergenciesSection = container.querySelector('[aria-labelledby="emergencies-heading"]');
    const announcementsSection = container.querySelector('[aria-labelledby="announcements-heading"]');

    [emergenciesSection, announcementsSection].forEach((section) => {
      if (!section) return;
      const emptyStateDivs = section.querySelectorAll('.text-center');
      emptyStateDivs.forEach((div) => {
        const html = div.innerHTML;
        // Should contain an SVG icon, not the old emoji
        expect(html).not.toMatch(/🌤️/);
        expect(html).not.toMatch(/📭/);
      });
    });
  });

  it('guide card icon wrappers contain SVG not emoji', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: '1', preferred_username: 'Test User', role: 'CIVILIAN_REPORTER' },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
      isAuthenticated: true,
      serverValidated: true,
      canQueueOfflineWrites: true,
      loggingOut: false,
    });

    const { container } = render(<InformationPage />);

    // Click the 'Reporting Guide' tab to show the guide section
    const tabButtons = container.querySelectorAll('button');
    const guideTab = Array.from(tabButtons).find((btn) =>
      btn.textContent?.includes('Reporting Guide'),
    );
    expect(guideTab).toBeDefined();
    fireEvent.click(guideTab!);

    const guideSection = container.querySelector('[aria-labelledby="guide-heading"]');
    expect(guideSection).toBeInTheDocument();

    // Each guide card has an icon wrapper div (flex items-center justify-center)
    const iconWrappers = guideSection?.querySelectorAll('.flex.items-center.justify-center') ?? [];
    expect(iconWrappers.length).toBeGreaterThanOrEqual(6); // 6 guide cards

    iconWrappers.forEach((wrapper) => {
      const innerHtml = wrapper.innerHTML;
      // Should contain an SVG (Tabler icon)
      expect(wrapper.querySelector('svg')).toBeInTheDocument();
      // Should NOT contain emoji characters
      expect(innerHtml).not.toMatch(/[📋🏷️⭐📸🔒🔄]/);
    });
  });

  it('replaces the location pin emoji (📍) with a Tabler icon in emergency list items (#614)', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: '1', preferred_username: 'Test User', role: 'CIVILIAN_REPORTER' },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
      isAuthenticated: true,
      serverValidated: true,
      canQueueOfflineWrites: true,
      loggingOut: false,
    });

    const { container, findByText } = render(<InformationPage />);

    // Wait for the (mocked) emergencies fetch to resolve and render the list.
    await findByText(/Emergencies/);

    // The stray 📍 glyph must be gone — location is now conveyed by an SVG icon.
    expect(container.innerHTML).not.toMatch(/📍/);
  });
});
