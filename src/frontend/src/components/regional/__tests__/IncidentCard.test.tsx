import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { IncidentCard } from '../IncidentCard';
import type { RegionalIncidentListItem } from '@/lib/api';
import type { RegionalIncidentOfflineStatus } from '@/lib/regionalOfflineStatus';

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

  it('allows opening a rejected incident while online', () => {
    const rejected = { ...incident, verification_status: 'REJECTED' as const };
    const props = renderCard({ inc: rejected, isOnline: true });

    const card = screen.getByRole('link', { name: /view incident 42/i });
    expect(card).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText('Go online to view')).not.toBeInTheDocument();

    fireEvent.click(card);

    expect(props.onCardClick).toHaveBeenCalledWith(42);
  });

  it('blocks opening a rejected incident while offline', () => {
    const rejected = { ...incident, verification_status: 'REJECTED' as const };
    const props = renderCard({ inc: rejected, isOnline: false });

    const card = screen.getByRole('article', { name: /view incident 42/i });
    expect(card).toHaveAttribute('aria-disabled', 'true');
    expect(card).toHaveTextContent('Go online to view');

    fireEvent.click(card);

    expect(props.onCardClick).not.toHaveBeenCalled();
  });
});

describe('IncidentCard offline sync badges', () => {
  it('renders "Update queued" badge when offlineStatus has an update op', () => {
    const offlineStatus: RegionalIncidentOfflineStatus = {
      serverId: 42,
      labels: ['Update queued'],
      severity: 'pending',
      operations: [{ operation: 'update', syncStatus: 'pending', localId: 'op-1' }],
      localIds: ['op-1'],
    };
    renderCard({ offlineStatus });
    expect(screen.getByText('Update queued')).toBeInTheDocument();
  });

  it('renders "Submit queued" badge', () => {
    const offlineStatus: RegionalIncidentOfflineStatus = {
      serverId: 42,
      labels: ['Submit queued'],
      severity: 'pending',
      operations: [{ operation: 'submit', syncStatus: 'pending', localId: 'op-1' }],
      localIds: ['op-1'],
    };
    renderCard({ offlineStatus });
    expect(screen.getByText('Submit queued')).toBeInTheDocument();
  });

  it('renders "Delete queued" badge', () => {
    const offlineStatus: RegionalIncidentOfflineStatus = {
      serverId: 42,
      labels: ['Delete queued'],
      severity: 'pending',
      operations: [{ operation: 'delete', syncStatus: 'pending', localId: 'op-1' }],
      localIds: ['op-1'],
    };
    renderCard({ offlineStatus });
    expect(screen.getByText('Delete queued')).toBeInTheDocument();
  });

  it('renders "Archive queued" badge', () => {
    const offlineStatus: RegionalIncidentOfflineStatus = {
      serverId: 42,
      labels: ['Archive queued'],
      severity: 'pending',
      operations: [{ operation: 'archive_action', syncStatus: 'pending', localId: 'op-1' }],
      localIds: ['op-1'],
    };
    renderCard({ offlineStatus });
    expect(screen.getByText('Archive queued')).toBeInTheDocument();
  });

  it('renders "Restore queued" badge for unarchive action', () => {
    const offlineStatus: RegionalIncidentOfflineStatus = {
      serverId: 42,
      labels: ['Restore queued'],
      severity: 'pending',
      operations: [{ operation: 'archive_action', syncStatus: 'pending', localId: 'op-1' }],
      localIds: ['op-1'],
    };
    renderCard({ offlineStatus });
    expect(screen.getByText('Restore queued')).toBeInTheDocument();
  });

  it('uses orange styling for conflict severity', () => {
    const offlineStatus: RegionalIncidentOfflineStatus = {
      serverId: 42,
      labels: ['Conflict'],
      severity: 'conflict',
      operations: [{ operation: 'update', syncStatus: 'conflict', localId: 'op-1' }],
      localIds: ['op-1'],
    };
    renderCard({ offlineStatus });
    const badge = screen.getByText('Conflict');
    expect(badge.className).toContain('bg-orange-100');
    expect(badge.className).toContain('text-orange-800');
  });

  it('uses red styling for failed severity', () => {
    const offlineStatus: RegionalIncidentOfflineStatus = {
      serverId: 42,
      labels: ['Sync failed'],
      severity: 'failed',
      operations: [{ operation: 'update', syncStatus: 'failed', localId: 'op-1' }],
      localIds: ['op-1'],
    };
    renderCard({ offlineStatus });
    const badge = screen.getByText('Sync failed');
    expect(badge.className).toContain('bg-red-100');
    expect(badge.className).toContain('text-red-800');
  });

  it('shows "+N more" when more than 2 labels', () => {
    const offlineStatus: RegionalIncidentOfflineStatus = {
      serverId: 42,
      labels: ['Update queued', 'Submit queued', 'Delete queued'],
      severity: 'pending',
      operations: [
        { operation: 'update', syncStatus: 'pending', localId: 'op-1' },
        { operation: 'submit', syncStatus: 'pending', localId: 'op-2' },
        { operation: 'delete', syncStatus: 'pending', localId: 'op-3' },
      ],
      localIds: ['op-1', 'op-2', 'op-3'],
    };
    renderCard({ offlineStatus });
    expect(screen.getByText('Update queued')).toBeInTheDocument();
    expect(screen.getByText('Submit queued')).toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
  });

  it('disables archive button when archive_action is queued', () => {
    const verifiedIncident = { ...incident, verification_status: 'VERIFIED' as const };
    const offlineStatus: RegionalIncidentOfflineStatus = {
      serverId: 42,
      labels: ['Archive queued'],
      severity: 'pending',
      operations: [{ operation: 'archive_action', syncStatus: 'pending', localId: 'op-1' }],
      localIds: ['op-1'],
    };
    const props = renderCard({ inc: verifiedIncident, offlineStatus });

    const archiveBtn = screen.getByRole('button', { name: /archive queued/i });
    expect(archiveBtn).toBeDisabled();
  });

  it('does not show offline sync badges when offlineStatus is undefined', () => {
    renderCard();
    expect(screen.queryByText('Update queued')).not.toBeInTheDocument();
    expect(screen.queryByText('Submit queued')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete queued')).not.toBeInTheDocument();
    expect(screen.queryByText('Archive queued')).not.toBeInTheDocument();
    expect(screen.queryByText('Conflict')).not.toBeInTheDocument();
    expect(screen.queryByText('Sync failed')).not.toBeInTheDocument();
  });
});
