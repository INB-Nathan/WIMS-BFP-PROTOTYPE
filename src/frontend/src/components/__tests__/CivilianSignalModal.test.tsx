import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
vi.mock('@/lib/api/information', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/information')>('@/lib/api/information');
  return { ...actual, fetchCivilianSignals: (...args: unknown[]) => mockFetch(...args) };
});

import { CivilianSignalModal } from '../CivilianSignalModal';
import type { EmergencyResponse } from '@/lib/api/information';

const emergency: EmergencyResponse = {
  id: 5,
  title: 'Warehouse fire',
  location: 'Quezon City',
  description: '',
  severity: 'critical',
  status: 'ongoing',
  promoted_from_incident_id: 10,
  latitude: 14.6,
  longitude: 121.0,
  perimeter: null,
  civilian_signal_count: 2,
  published: true,
  published_at: '2026-07-19T08:00:00Z',
  created_at: '2026-07-19T08:00:00Z',
};

describe('CivilianSignalModal', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('renders nothing when closed', () => {
    render(<CivilianSignalModal emergency={null} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lists only submission timestamps when signals are returned', async () => {
    mockFetch.mockResolvedValueOnce([
      { submitted_at: '2026-07-19T08:00:00Z' },
      { submitted_at: '2026-07-19T09:30:00Z' },
    ]);
    render(<CivilianSignalModal emergency={emergency} onClose={vi.fn()} />);

    const list = await screen.findByTestId('cs-modal-list');
    expect(list.querySelectorAll('li')).toHaveLength(2);
    // No location/name/id leakage — only times appear in the list items.
    list.querySelectorAll('li').forEach((li) => {
      expect(li.textContent).not.toMatch(/Quezon|Warehouse|10/);
    });
  });

  it('shows an empty state when there are no signals', async () => {
    mockFetch.mockResolvedValueOnce([]);
    render(<CivilianSignalModal emergency={emergency} onClose={vi.fn()} />);
    expect(await screen.findByText('No civilian report times to show.')).toBeInTheDocument();
  });

  it('treats a null (unavailable source) response as empty, not an error', async () => {
    mockFetch.mockResolvedValueOnce(null);
    render(<CivilianSignalModal emergency={emergency} onClose={vi.fn()} />);
    expect(await screen.findByText('No civilian report times to show.')).toBeInTheDocument();
  });

  it('shows retry on error and refetches', async () => {
    mockFetch.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([
      { submitted_at: '2026-07-19T08:00:00Z' },
    ]);
    render(<CivilianSignalModal emergency={emergency} onClose={vi.fn()} />);

    const retry = await screen.findByTestId('cs-modal-retry');
    fireEvent.click(retry);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByTestId('cs-modal-list')).toBeInTheDocument());
  });

  it('closes on Escape', async () => {
    mockFetch.mockResolvedValueOnce([]);
    const onClose = vi.fn();
    render(<CivilianSignalModal emergency={emergency} onClose={onClose} />);
    await screen.findByText('No civilian report times to show.');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
