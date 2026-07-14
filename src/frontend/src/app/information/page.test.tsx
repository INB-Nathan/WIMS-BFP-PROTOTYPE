import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

let authUser: { id: string; role?: string } | null = { id: 'c1', role: 'CIVILIAN_REPORTER' };
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

beforeEach(() => {
  vi.clearAllMocks();
  authUser = { id: 'c1', role: 'CIVILIAN_REPORTER' };
  mockEmergencies.mockResolvedValue([
    {
      id: 1,
      title: 'Taal Volcano — Alert Level 3',
      location: 'Batangas Province',
      description: 'Phreatomagmatic eruption ongoing.',
      severity: 'critical',
      status: 'ongoing',
      promoted_from_incident_id: null,
      published: true,
      published_at: null,
      created_at: '2026-07-14T00:00:00Z',
    },
  ]);
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

describe('Information page', () => {
  it('renders the three tabs', () => {
    render(<InformationPage />);
    expect(screen.getByText(/Emergencies/)).toBeTruthy();
    expect(screen.getByText(/Announcements/)).toBeTruthy();
    expect(screen.getByText(/Reporting Guide/)).toBeTruthy();
  });

  it('loads and displays emergencies by default', async () => {
    render(<InformationPage />);
    expect(await screen.findByText('Taal Volcano — Alert Level 3')).toBeTruthy();
    expect(mockEmergencies).toHaveBeenCalledTimes(1);
    expect(mockAnnouncements).toHaveBeenCalledTimes(1);
  });
  it('switches to the announcements tab and shows cards', async () => {
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

  it('restricts access to civilian reporters', async () => {
    authUser = { id: 'x', role: 'REGIONAL_ENCODER' };
    render(<InformationPage />);
    expect(await screen.findByText('Access restricted')).toBeTruthy();
    expect(screen.queryByText('Emergencies')).toBeNull();
  });
});
