import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

let authUser: { id: string; role?: string } | null = null;
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: authUser, loading: false }),
}));

const mockEmergencies = vi.fn();
const mockAnnouncements = vi.fn();
vi.mock('@/lib/api/information', () => ({
  fetchEmergencies: (...args: unknown[]) => mockEmergencies(...args),
  fetchAnnouncements: (...args: unknown[]) => mockAnnouncements(...args),
  resolveAnnouncementImageUrl: (p: string | null) => (p ? `https://cdn.test/${p}` : null),
}));

import InformationPage from './page';

const SAMPLE_EMERGENCIES = [
  {
    id: 1,
    title: 'Taal Volcano — Alert Level 3',
    location: 'Batangas Province',
    description: 'Phreatomagmatic eruption ongoing.',
    severity: 'critical',
    status: 'ongoing',
    promoted_from_incident_id: null,
    published: true,
    published_at: '2026-07-10T00:00:00Z',
    created_at: '2026-07-10T00:00:00Z',
  },
  {
    id: 2,
    title: 'Marikina River flood advisory',
    location: 'Marikina City',
    description: 'Rising water levels near residential zones.',
    severity: 'moderate',
    status: 'monitoring',
    promoted_from_incident_id: null,
    published: true,
    published_at: '2026-07-01T00:00:00Z',
    created_at: '2026-07-01T00:00:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  authUser = null;
  mockEmergencies.mockResolvedValue(SAMPLE_EMERGENCIES);
  mockAnnouncements.mockResolvedValue([
    {
      id: 2,
      title: 'New civilian reporter guidelines',
      body: 'Acknowledge the updated terms by August 1.',
      urgency: 'urgent',
      image_path: null,
      published: true,
      published_at: null,
      created_at: '2026-07-14T00:00:00Z',
    },
  ]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Information page — public access (#614)', () => {
  it('renders the three tabs', () => {
    render(<InformationPage />);
    expect(screen.getByText(/Emergencies/)).toBeTruthy();
    expect(screen.getByText(/Announcements/)).toBeTruthy();
    expect(screen.getByText(/Reporting Guide/)).toBeTruthy();
  });

  it('anonymous users see the full content with no sign-in wall or redirect', async () => {
    authUser = null;
    render(<InformationPage />);
    expect(await screen.findByText('Taal Volcano — Alert Level 3')).toBeTruthy();
    expect(screen.queryByText('Sign in required')).toBeNull();
    expect(screen.queryByText('Access restricted')).toBeNull();
    expect(mockEmergencies).toHaveBeenCalledTimes(1);
    expect(mockAnnouncements).toHaveBeenCalledTimes(1);
  });

  it('logged-in civilian reporters see the same content as anonymous users', async () => {
    authUser = { id: 'c1', role: 'CIVILIAN_REPORTER' };
    render(<InformationPage />);
    expect(await screen.findByText('Taal Volcano — Alert Level 3')).toBeTruthy();
    expect(screen.queryByText('Sign in required')).toBeNull();
    expect(screen.queryByText('Access restricted')).toBeNull();
  });

  it('does not gate content for other authenticated roles either', async () => {
    authUser = { id: 'x', role: 'REGIONAL_ENCODER' };
    render(<InformationPage />);
    expect(await screen.findByText('Taal Volcano — Alert Level 3')).toBeTruthy();
    expect(screen.queryByText('Access restricted')).toBeNull();
  });

  it('shows a "Register as a reporter" CTA for anonymous users', async () => {
    authUser = null;
    render(<InformationPage />);
    await screen.findByText('Taal Volcano — Alert Level 3');
    const ctaLinks = screen.getAllByText(/Register as a reporter/i);
    expect(ctaLinks.length).toBeGreaterThan(0);
  });

  it('hides the registration CTA for signed-in civilian reporters', async () => {
    authUser = { id: 'c1', role: 'CIVILIAN_REPORTER' };
    render(<InformationPage />);
    await screen.findByText('Taal Volcano — Alert Level 3');
    expect(screen.queryByText(/Register as a reporter/i)).toBeNull();
  });

  it('switches to the announcements tab and shows the full archive', async () => {
    render(<InformationPage />);
    await waitFor(() => expect(screen.getByText('Taal Volcano — Alert Level 3')).toBeTruthy());
    fireEvent.click(screen.getByText(/Announcements/));
    expect(await screen.findByText('New civilian reporter guidelines')).toBeTruthy();
  });

  it('switches to the reporting guide tab and shows guidance', async () => {
    render(<InformationPage />);
    fireEvent.click(screen.getByText(/Reporting Guide/));
    expect(await screen.findByText('How to submit a report')).toBeTruthy();
    expect(screen.getByText('Understanding your trust score')).toBeTruthy();
  });
});

describe('Information page — emergencies filters (#614)', () => {
  it('filters emergencies by search text', async () => {
    render(<InformationPage />);
    await screen.findByText('Taal Volcano — Alert Level 3');
    expect(screen.getByText('Marikina River flood advisory')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Taal' } });

    expect(screen.getByText('Taal Volcano — Alert Level 3')).toBeTruthy();
    expect(screen.queryByText('Marikina River flood advisory')).toBeNull();
  });

  it('filters emergencies by severity', async () => {
    render(<InformationPage />);
    await screen.findByText('Taal Volcano — Alert Level 3');

    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'moderate' } });

    expect(screen.queryByText('Taal Volcano — Alert Level 3')).toBeNull();
    expect(screen.getByText('Marikina River flood advisory')).toBeTruthy();
  });

  it('filters emergencies by date range', async () => {
    render(<InformationPage />);
    await screen.findByText('Taal Volcano — Alert Level 3');

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-07-05' } });

    expect(screen.getByText('Taal Volcano — Alert Level 3')).toBeTruthy();
    expect(screen.queryByText('Marikina River flood advisory')).toBeNull();
  });

  it('shows a "no matching emergencies" state and a clear-filters control when filters exclude everything', async () => {
    render(<InformationPage />);
    await screen.findByText('Taal Volcano — Alert Level 3');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'nonexistent-xyz' } });

    expect(await screen.findByText('No matching emergencies')).toBeTruthy();
    const clearBtn = screen.getByText('Clear filters');
    fireEvent.click(clearBtn);
    expect(await screen.findByText('Taal Volcano — Alert Level 3')).toBeTruthy();
  });
});

describe('Information page — no emoji glyphs (#614)', () => {
  it('contains no emoji characters anywhere in the rendered output', async () => {
    const { container } = render(<InformationPage />);
    await screen.findByText('Taal Volcano — Alert Level 3');
    fireEvent.click(screen.getByText(/Announcements/));
    await screen.findByText('New civilian reporter guidelines');
    fireEvent.click(screen.getByText(/Reporting Guide/));
    await screen.findByText('How to submit a report');
    fireEvent.click(screen.getByText(/Emergencies/));
    await screen.findByText('Taal Volcano — Alert Level 3');

    // Broad emoji range check (pictographs, symbols, dingbats) across the whole page.
    const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(emojiPattern.test(container.textContent || '')).toBe(false);
  });
});
