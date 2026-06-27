import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IncidentTableRow } from '../IncidentTableRow';
import type { ValidatorIncident } from '../types';

function makeIncident(overrides: Partial<ValidatorIncident> = {}): ValidatorIncident {
  return {
    incident_id: 101,
    verification_status: 'PENDING',
    encoder_id: 'enc-1',
    region_id: 1,
    created_at: '2026-06-25T10:00:00Z',
    submitted_at: '2026-06-25T10:00:00Z',
    updated_at: null,
    notification_dt: '2026-06-25T10:00:00Z',
    general_category: 'STRUCTURAL',
    alarm_level: 'ALARM',
    fire_station_name: 'BFP Manila',
    structures_affected: null,
    households_affected: null,
    responder_type: null,
    fire_origin: null,
    extent_of_damage: null,
    parent_incident_id: null,
    is_duplicate: false,
    duplicate_of: null,
    reference_number: null,
    ...overrides,
  };
}

const baseProps = {
  idx: 0,
  isArchiveView: false,
  selectedIds: new Set<number>(),
  acceptingId: null,
  runtimeDuplicates: new Map<number, number>(),
  queuedIncidentIds: new Set<number>(),
  isOnline: true,
  onRowClick: vi.fn(),
  onTogglePending: vi.fn(),
  onHoverStart: vi.fn(),
  onHoverMove: vi.fn(),
  onHoverEnd: vi.fn(),
  onUnarchive: vi.fn(),
  onDelete: vi.fn(),
  onArchive: vi.fn(),
  onReviewDuplicate: vi.fn(),
  onAccept: vi.fn(),
  onReject: vi.fn(),
};

describe('IncidentTableRow', () => {
  it('renders Accept and Reject buttons for a pending incident', () => {
    render(<IncidentTableRow inc={makeIncident()} {...baseProps} />);
    expect(screen.getByText('Accept')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
  });

  it('renders Queued badge instead of action buttons when incident has a pending queued op', () => {
    render(
      <IncidentTableRow
        inc={makeIncident({ incident_id: 101 })}
        {...baseProps}
        queuedIncidentIds={new Set([101])}
      />,
    );
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.queryByText('Accept')).not.toBeInTheDocument();
    expect(screen.queryByText('Reject')).not.toBeInTheDocument();
  });

  it('disables Delete button when offline', () => {
    render(
      <IncidentTableRow
        inc={makeIncident({ verification_status: 'VERIFIED' })}
        {...baseProps}
        isArchiveView={true}
        isOnline={false}
      />,
    );
    const deleteButton = screen.getByText('Delete').closest('button');
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAttribute('title', 'Go online to delete');
  });
});
