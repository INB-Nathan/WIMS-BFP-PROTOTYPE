import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { IncidentConflictMergePanel } from '../IncidentConflictMergePanel';

const CLIENT_DRAFT: Record<string, unknown> = {
  alarm_level: '1st Alarm',
  fire_station_name: 'Makati Central',
  structures_affected: 2,
  recommendations: 'Inspect wiring',
};

const SERVER_VERSION: Record<string, unknown> = {
  alarm_level: '2nd Alarm',   // differs
  fire_station_name: 'Makati Central', // same
  structures_affected: 5,     // differs
  recommendations: 'Inspect wiring',  // same
};

describe('IncidentConflictMergePanel', () => {
  it('renders only fields that differ', () => {
    render(
      <IncidentConflictMergePanel
        clientDraft={CLIENT_DRAFT}
        serverVersion={SERVER_VERSION}
        onSubmitMerge={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    // Conflicting fields should appear
    expect(screen.getByText('Highest Alarm Level')).toBeTruthy();
    expect(screen.getByText('No. of Structures Affected')).toBeTruthy();

    // Non-conflicting fields should NOT appear
    expect(screen.queryByText('Responding Fire Station')).toBeNull();
    expect(screen.queryByText('Recommendations')).toBeNull();
  });

  it('defaults to client version for all conflicting fields', () => {
    render(
      <IncidentConflictMergePanel
        clientDraft={CLIENT_DRAFT}
        serverVersion={SERVER_VERSION}
        onSubmitMerge={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    // Client values should be visible
    expect(screen.getByText('1st Alarm')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('calls onSubmitMerge with merged payload including force_update when submitted', () => {
    const handleSubmit = vi.fn();
    render(
      <IncidentConflictMergePanel
        clientDraft={CLIENT_DRAFT}
        serverVersion={SERVER_VERSION}
        onSubmitMerge={handleSubmit}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Submit Merged Version'));

    expect(handleSubmit).toHaveBeenCalledOnce();
    const merged = handleSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(merged.force_update).toBe(true);
    expect(merged.client_updated_at).toBeUndefined();
    // Default selection is client — should keep client values
    expect(merged.alarm_level).toBe('1st Alarm');
    expect(merged.structures_affected).toBe(2);
  });

  it('uses server value when user selects server version for a field', () => {
    const handleSubmit = vi.fn();
    render(
      <IncidentConflictMergePanel
        clientDraft={CLIENT_DRAFT}
        serverVersion={SERVER_VERSION}
        onSubmitMerge={handleSubmit}
        onCancel={vi.fn()}
      />
    );

    // Click the server-version button for alarm_level
    const serverVersionButtons = screen.getAllByText('Server version');
    fireEvent.click(serverVersionButtons[0]); // first conflicting field = alarm_level

    fireEvent.click(screen.getByText('Submit Merged Version'));

    const merged = handleSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(merged.alarm_level).toBe('2nd Alarm');
    expect(merged.force_update).toBe(true);
  });

  it('calls onCancel when Cancel button is clicked', () => {
    const handleCancel = vi.fn();
    render(
      <IncidentConflictMergePanel
        clientDraft={CLIENT_DRAFT}
        serverVersion={SERVER_VERSION}
        onSubmitMerge={vi.fn()}
        onCancel={handleCancel}
      />
    );

    // There are two Cancel buttons (header × and footer) — click footer one
    const cancelButtons = screen.getAllByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);

    expect(handleCancel).toHaveBeenCalledOnce();
  });

  it('shows conflict count in footer', () => {
    render(
      <IncidentConflictMergePanel
        clientDraft={CLIENT_DRAFT}
        serverVersion={SERVER_VERSION}
        onSubmitMerge={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('2 conflicting fields')).toBeTruthy();
  });

  it('shows "No conflicting fields" when drafts are identical', () => {
    render(
      <IncidentConflictMergePanel
        clientDraft={CLIENT_DRAFT}
        serverVersion={CLIENT_DRAFT}
        onSubmitMerge={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('No conflicting fields detected.')).toBeTruthy();
  });
});
