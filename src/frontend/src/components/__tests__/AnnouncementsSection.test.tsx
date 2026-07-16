import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AnnouncementsSection } from '../LandingSections';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Helper to mock a successful JSON response
function mockFetchResponse(data: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as Response);
}

describe('AnnouncementsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows skeleton placeholders during loading', () => {
    // Don't resolve the fetch — keep it pending
    mockFetch.mockReturnValueOnce(new Promise(() => undefined));
    render(<AnnouncementsSection />);
    // Should show skeleton cards (testid: announcement-skeleton)
    const skeletons = screen.getAllByTestId('announcement-skeleton');
    expect(skeletons.length).toBe(3);
  });

  it('shows the calm empty state when API returns empty array', async () => {
    mockFetchResponse([]);
    render(<AnnouncementsSection />);

    await waitFor(() => {
      expect(screen.getByTestId('announcements-empty')).toBeInTheDocument();
    });

    expect(screen.getByText('No active announcements at this time.')).toBeInTheDocument();
  });

  it('shows announcement cards when API returns data', async () => {
    const mockData = [
      { id: 1, title: 'Fire Safety Advisory', body: 'Test announcement body', urgency: 'advisory' },
      { id: 2, title: 'Typhoon Preparedness', body: 'Another announcement', urgency: 'urgent' },
    ];
    mockFetchResponse(mockData);
    render(<AnnouncementsSection />);

    await waitFor(() => {
      expect(screen.getByText('Fire Safety Advisory')).toBeInTheDocument();
    });

    expect(screen.getByText('Typhoon Preparedness')).toBeInTheDocument();
  });

  it('does NOT keep skeletons permanently when API returns empty array', async () => {
    mockFetchResponse([]);
    render(<AnnouncementsSection />);

    // Skeletons appear initially
    expect(screen.getAllByTestId('announcement-skeleton').length).toBe(3);

    // After fetch resolves, skeletons are replaced by empty state
    await waitFor(() => {
      expect(screen.getByTestId('announcements-empty')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('announcement-skeleton')).not.toBeInTheDocument();
  });
});
