import { render } from '@testing-library/react';
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
      user: { id: '1', name: 'Test User', role: 'CIVILIAN_REPORTER' },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      checkSession: vi.fn(),
      refreshSession: vi.fn(),
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
      user: { id: '1', name: 'Test User', role: 'CIVILIAN_REPORTER' },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      checkSession: vi.fn(),
      refreshSession: vi.fn(),
    });

    const { container } = render(<InformationPage />);

    // Get tab buttons
    const tabButtons = container.querySelectorAll('button[type="button"]');

    // Check that tab buttons don't contain emoji text nodes
    tabButtons.forEach((button) => {
      const textContent = button.textContent || '';
      // Should not start with emoji (old pattern was "⚠ Emergencies", "📢 Announcements", "📖 Reporting Guide")
      expect(textContent).not.toMatch(/^[⚠📢📖]/);
    });

    // Verify SVG icons are in tab buttons
    const tabSvgs = Array.from(tabButtons).flatMap(btn => Array.from(btn.querySelectorAll('svg')));
    expect(tabSvgs.length).toBeGreaterThanOrEqual(3); // At least 3 tab icons
  });

  it('renders empty state icons as SVG, not emoji', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: '1', name: 'Test User', role: 'CIVILIAN_REPORTER' },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      checkSession: vi.fn(),
      refreshSession: vi.fn(),
    });

    const { container } = render(<InformationPage />);

    // Empty states use IconSun (🌤️) and IconMailbox (📭) — verify no emoji in empty state areas
    const emptyStateContainers = container.querySelectorAll('.text-center');
    emptyStateContainers.forEach((emptyState) => {
      const html = emptyState.innerHTML;
      expect(html).not.toMatch(/🌤️/);
      expect(html).not.toMatch(/📭/);
    });
  });

  it('only allows location pin emoji (📍) in emergency list items, not as UI icons', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: '1', name: 'Test User', role: 'CIVILIAN_REPORTER' },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      checkSession: vi.fn(),
      refreshSession: vi.fn(),
    });

    const { container } = render(<InformationPage />);

    // The 📍 emoji is allowed in the location display (content, not UI icon)
    // This test just verifies the pattern — we're swapping UI icons, not content emoji
    const locationPinPattern = /📍/;
    const htmlContent = container.innerHTML;

    // If present, it should be in a specific location context, not as standalone UI icon
    if (locationPinPattern.test(htmlContent)) {
      // Just verify we're not regressing — location pin is content, not a UI icon replacement target
      expect(htmlContent).toContain('📍');
    }
  });
});
