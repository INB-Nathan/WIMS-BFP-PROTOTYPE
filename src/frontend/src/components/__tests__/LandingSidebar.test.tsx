import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LandingSidebar } from '../LandingSidebar';
import type { EmergencyResponse } from '@/lib/api/information';

function makeEmergency(overrides: Partial<EmergencyResponse> = {}): EmergencyResponse {
  return {
    id: 1,
    title: 'Warehouse fire',
    location: 'Quezon City',
    description: '',
    severity: 'critical',
    status: 'ongoing',
    promoted_from_incident_id: 10,
    latitude: 14.6,
    longitude: 121.0,
    perimeter: null,
    civilian_signal_count: 0,
    published: true,
    published_at: '2026-07-19T08:00:00Z',
    created_at: '2026-07-19T08:00:00Z',
    ...overrides,
  };
}

describe('LandingSidebar', () => {
  it('shows the civilian-signal count badge only when count > 0', () => {
    const { rerender } = render(
      <LandingSidebar
        emergencies={[makeEmergency({ id: 1, civilian_signal_count: 0 })]}
        loading={false}
        error={false}
        retry={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('sidebar-civ-signals')).not.toBeInTheDocument();

    rerender(
      <LandingSidebar
        emergencies={[makeEmergency({ id: 1, civilian_signal_count: 3 })]}
        loading={false}
        error={false}
        retry={vi.fn()}
      />,
    );
    const badge = screen.getByTestId('sidebar-civ-signals');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('3');
  });

  it('activating the card flies the map; activating the count opens signals', () => {
    const onSelect = vi.fn();
    const onView = vi.fn();
    render(
      <LandingSidebar
        emergencies={[makeEmergency({ id: 1, civilian_signal_count: 2 })]}
        loading={false}
        error={false}
        retry={vi.fn()}
        onSelectEmergency={onSelect}
        onViewSignals={onView}
      />,
    );

    fireEvent.click(screen.getByTestId('sidebar-fire-card'));
    expect(onSelect).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('sidebar-civ-signals'));
    expect(onView).toHaveBeenCalledTimes(1);
    // The two controls are independent — clicking the count did not also fly the map.
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
