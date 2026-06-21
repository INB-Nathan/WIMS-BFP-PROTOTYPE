import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { IncidentCard } from '../IncidentCard';
import type { RegionalIncidentListItem } from '@/lib/api';

const incident: RegionalIncidentListItem = {
  incident_id: 42,
  verification_status: 'DRAFT',
  created_at: '2026-06-21T08:00:00Z',
  updated_at: '2026-06-21T09:00:00Z',
  notification_dt: '2026-06-21T08:30:00Z',
  general_category: 'STRUCTURAL',
  sub_category: 'Single and Two Family Dwelling',
  alarm_level: 'First Alarm',
  fire_station_name: 'BFP QC District III',
  structures_affected: 1,
  households_affected: 1,
  families_affected: 1,
  individuals_affected: 4,
  vehicles_affected: 0,
  responder_type: 'First Responder',
  fire_origin: 'Kitchen',
  extent_of_damage: 'Confined to Room',
  owner_name: 'Juan Dela Cruz',
  establishment_name: null,
  caller_name: 'Maria Reyes',
  caller_number: '09171234567',
  street_address: 'Blk 3 Lot 12 Sampaguita St.',
  is_wildland: false,
  city_municipality: 'Quezon City',
  province_district: 'Fire District 5',
  location_display: 'Quezon City, Fire District 5',
};

function renderCard(overrides: Partial<ComponentProps<typeof IncidentCard>> = {}) {
  const props: ComponentProps<typeof IncidentCard> = {
    inc: incident,
    isArchiveView: false,
    onCardClick: vi.fn(),
    onHoverStart: vi.fn(),
    onHoverMove: vi.fn(),
    onHoverEnd: vi.fn(),
    onArchive: vi.fn(),
    onUnarchive: vi.fn(),
    ...overrides,
  };
  render(<IncidentCard {...props} />);
  return props;
}

describe('IncidentCard offline detail availability', () => {
  it('keeps an offline uncached online incident visible but disables navigation', () => {
    const props = renderCard({ isOnline: false, isDetailCached: false });

    const card = screen.getByRole('article', { name: /view incident 42/i });
    expect(card).toHaveAttribute('aria-disabled', 'true');
    expect(card).toHaveTextContent('Go online to view');

    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });

    expect(props.onCardClick).not.toHaveBeenCalled();
  });

  it('allows offline navigation when the incident detail is cached', () => {
    const props = renderCard({ isOnline: false, isDetailCached: true });

    const card = screen.getByRole('link', { name: /view incident 42/i });
    expect(card).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText('Go online to view')).not.toBeInTheDocument();

    fireEvent.click(card);

    expect(props.onCardClick).toHaveBeenCalledWith(42);
  });
});
