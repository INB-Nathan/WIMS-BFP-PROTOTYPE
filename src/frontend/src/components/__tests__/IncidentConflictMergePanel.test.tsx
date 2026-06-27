import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { IncidentConflictMergePanel } from '../IncidentConflictMergePanel';

const CLIENT_DRAFT: Record<string, unknown> = {
  alarm_level: '1st Alarm',
  fire_station_name: 'Makati Central',
  structures_affected: 2,
  civilian_injured: '',        // empty client, server has data → smart default should pick server
  recommendations: 'Inspect wiring',
};

const SERVER_VERSION: Record<string, unknown> = {
  alarm_level: '2nd Alarm',   // differs
  fire_station_name: 'Makati Central', // same
  structures_affected: 5,     // differs
  civilian_injured: 3,         // differs — client empty, server has data
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

  it('defaults to client version for populated client fields, server for empty client fields', () => {
    render(
      <IncidentConflictMergePanel
        clientDraft={CLIENT_DRAFT}
        serverVersion={SERVER_VERSION}
        onSubmitMerge={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    // Client values for populated fields should be visible
    expect(screen.getByText('1st Alarm')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();

    // Empty client field with server data should default to server
    // The server value '3' should appear as the selected version
    expect(screen.getByText('3')).toBeTruthy();
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
    // alarm_level and structures_affected have client values → keep client
    // civilian_injured is empty in client and 3 in server → smart default picks server
    expect(merged.alarm_level).toBe('1st Alarm');
    expect(merged.structures_affected).toBe(2);
    expect(merged.civilian_injured).toBe(3);
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

    expect(screen.getByText('3 conflicting fields')).toBeTruthy();
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

  it('renders group headings for groups with conflicts', () => {
    render(
      <IncidentConflictMergePanel
        clientDraft={CLIENT_DRAFT}
        serverVersion={SERVER_VERSION}
        onSubmitMerge={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    // alarm_level and fire_station_name → Incident Basics
    // structures_affected → Impact & Damage
    // civilian_injured → Casualties
    // The headings use CSS text-transform: uppercase but rendered text is title-case
    expect(screen.getByText('Incident Basics')).toBeTruthy();
    expect(screen.getByText('Impact & Damage')).toBeTruthy();
    expect(screen.getByText('Casualties')).toBeTruthy();

    // Location has no conflicts with this data
    expect(screen.queryByText('Location')).toBeNull();
  });

  it('renders quick-select buttons', () => {
    render(
      <IncidentConflictMergePanel
        clientDraft={CLIENT_DRAFT}
        serverVersion={SERVER_VERSION}
        onSubmitMerge={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Use all my changes')).toBeTruthy();
    expect(screen.getByText('Use all server values')).toBeTruthy();
  });

  it('"Use all my changes" selects client for all conflicting fields', () => {
    const handleSubmit = vi.fn();
    render(
      <IncidentConflictMergePanel
        clientDraft={CLIENT_DRAFT}
        serverVersion={SERVER_VERSION}
        onSubmitMerge={handleSubmit}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Use all my changes'));
    fireEvent.click(screen.getByText('Submit Merged Version'));

    const merged = handleSubmit.mock.calls[0][0] as Record<string, unknown>;
    // Even civilian_injured (empty client, server=3) should use client (empty) after clicking "Use all my changes"
    expect(merged.alarm_level).toBe('1st Alarm');
    expect(merged.civilian_injured).toBe('');
  });

  it('"Use all server values" selects server for all conflicting fields', () => {
    const handleSubmit = vi.fn();
    render(
      <IncidentConflictMergePanel
        clientDraft={CLIENT_DRAFT}
        serverVersion={SERVER_VERSION}
        onSubmitMerge={handleSubmit}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Use all server values'));
    fireEvent.click(screen.getByText('Submit Merged Version'));

    const merged = handleSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(merged.alarm_level).toBe('2nd Alarm');
    expect(merged.structures_affected).toBe(5);
    expect(merged.civilian_injured).toBe(3);
  });

  it('panel has dialog ARIA attributes', () => {
    render(
      <IncidentConflictMergePanel
        clientDraft={CLIENT_DRAFT}
        serverVersion={SERVER_VERSION}
        onSubmitMerge={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: /concurrent edit conflict/i });
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('conflict-dialog-heading');
  });
});
