import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRetry = vi.fn();
const mockUsePublicEmergencies = vi.fn();

vi.mock('@/lib/usePublicEmergencies', () => ({
  usePublicEmergencies: () => mockUsePublicEmergencies(),
}));

import IncidentsPage from './page';

const emergencies = [
  {
    id: 1,
    title: 'Warehouse fire',
    location: 'Quezon City',
    description: 'Crews are responding.',
    severity: 'critical',
    status: 'ongoing',
    promoted_from_incident_id: 10,
    latitude: 14.6,
    longitude: 121.0,
    perimeter: null,
    published: true,
    published_at: '2026-07-19T08:00:00Z',
    created_at: '2026-07-19T08:00:00Z',
  },
  {
    id: 2,
    title: 'Grass fire',
    location: 'Makati',
    description: 'Monitoring for flare-ups.',
    severity: 'low',
    status: 'monitoring',
    promoted_from_incident_id: 11,
    latitude: 14.5,
    longitude: 121.0,
    perimeter: null,
    published: true,
    published_at: '2026-07-18T08:00:00Z',
    created_at: '2026-07-18T08:00:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockUsePublicEmergencies.mockReturnValue({ emergencies, loading: false, error: false, retry: mockRetry });
});

describe('IncidentsPage', () => {
  it('renders the published emergency listing and its public-facing title', () => {
    render(<IncidentsPage />);

    expect(screen.getByRole('heading', { name: 'All active fires' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Reported' })).toBeInTheDocument();
    expect(screen.getByText('Warehouse fire')).toBeInTheDocument();
    expect(screen.getByText('Grass fire')).toBeInTheDocument();
    expect(screen.getByText('Showing 2 of 2 incidents')).toBeInTheDocument();
  });

  it('filters incidents by search and severity', () => {
    render(<IncidentsPage />);

    fireEvent.change(screen.getByLabelText('Search incidents'), { target: { value: 'Makati' } });
    expect(screen.queryByText('Warehouse fire')).not.toBeInTheDocument();
    expect(screen.getByText('Grass fire')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'critical' } });
    expect(screen.getByText('No matching incidents')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Warehouse fire')).toBeInTheDocument();
    expect(screen.getByText('Grass fire')).toBeInTheDocument();
  });

  it('announces loading and offers retry after an error', () => {
    mockUsePublicEmergencies.mockReturnValue({ emergencies: [], loading: true, error: false, retry: mockRetry });
    const { rerender } = render(<IncidentsPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading published incidents…');

    mockUsePublicEmergencies.mockReturnValue({ emergencies: [], loading: false, error: true, retry: mockRetry });
    rerender(<IncidentsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });
});
