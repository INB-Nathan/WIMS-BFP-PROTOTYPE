/**
 * Tests for ReportFilterBuilder component (#353).
 *
 * Covers:
 * - Builder mode: renders region, severity, incident_type, start_date, end_date inputs
 * - Expert mode: toggle to raw JSON, validation, parse feedback
 * - onChange emits correct structured filters
 * - Inline error display
 * - Summary of applied filters
 */

import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ReportFilterBuilder from '@/components/admin/ReportFilterBuilder';
import type { Region } from '@/types/api';

const mockRegions: Region[] = [
  { region_id: 1, region_name: 'NCR' },
  { region_id: 2, region_name: 'Region IV-A' },
  { region_id: 3, region_name: 'Region VII' },
];

describe('ReportFilterBuilder — builder mode', () => {
  it('renders builder fields and region dropdown with "All Regions" default', () => {
    const onChange = vi.fn();
    render(
      <ReportFilterBuilder filters={{}} onChange={onChange} regions={mockRegions} />
    );

    // Builder mode is the default — check for key form elements
    expect(screen.getByLabelText('Filter by region')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by severity')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by incident type')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter start date')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter end date')).toBeInTheDocument();

    // Region dropdown has "All Regions" option
    expect(screen.getByRole('option', { name: 'All Regions' })).toBeInTheDocument();
  });

  it('renders region options from props', () => {
    const onChange = vi.fn();
    render(
      <ReportFilterBuilder filters={{}} onChange={onChange} regions={mockRegions} />
    );
    expect(screen.getByRole('option', { name: 'NCR' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Region IV-A' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Region VII' })).toBeInTheDocument();
  });

  it('calls onChange when region is selected', async () => {
    const onChange = vi.fn();
    render(
      <ReportFilterBuilder filters={{}} onChange={onChange} regions={mockRegions} />
    );
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Filter by region'), '1');

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ region_id: 1 })
    );
  });

  it('calls onChange when severity is selected', async () => {
    const onChange = vi.fn();
    render(
      <ReportFilterBuilder filters={{}} onChange={onChange} regions={mockRegions} />
    );
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Filter by severity'), 'HIGH');

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'HIGH' })
    );
  });

  it('calls onChange when incident type is typed', async () => {
    const onChange = vi.fn();
    render(
      <ReportFilterBuilder filters={{}} onChange={onChange} regions={mockRegions} />
    );
    const input = screen.getByLabelText('Filter by incident type');
    fireEvent.change(input, { target: { value: 'WILDLAND' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ incident_type: 'WILDLAND' })
    );
  });

  it('calls onChange when start date is set', async () => {
    const onChange = vi.fn();
    render(
      <ReportFilterBuilder filters={{}} onChange={onChange} regions={mockRegions} />
    );
    const user = userEvent.setup();
    const input = screen.getByLabelText('Filter start date');
    await user.type(input, '2026-06-01');

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ start_date: '2026-06-01' })
    );
  });

  it('removes a field from filters when value is cleared', async () => {
    const onChange = vi.fn();
    render(
      <ReportFilterBuilder
        filters={{ region_id: 1, severity: 'HIGH' }}
        onChange={onChange}
        regions={mockRegions}
      />
    );
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Filter by region'), '');

    expect(onChange).toHaveBeenCalledWith(
      expect.not.objectContaining({ region_id: expect.anything() })
    );
  });

  it('shows a summary of applied filters', () => {
    const onChange = vi.fn();
    render(
      <ReportFilterBuilder
        filters={{ region_id: 1, severity: 'HIGH' }}
        onChange={onChange}
        regions={mockRegions}
      />
    );
    expect(screen.getByText(/2 filters applied/)).toBeInTheDocument();
    expect(screen.getByText(/Region=NCR/)).toBeInTheDocument();
    expect(screen.getByText(/severity=HIGH/)).toBeInTheDocument();
  });

  it('shows inline date validation when end < start', async () => {
    const onChange = vi.fn();
    render(
      <ReportFilterBuilder
        filters={{ start_date: '2026-06-15', end_date: '2026-06-10' }}
        onChange={onChange}
        regions={mockRegions}
      />
    );
    expect(
      screen.getByText(/End date must be on or after start date/i)
    ).toBeInTheDocument();
  });

  it('displays per-field error messages from errors prop', () => {
    const onChange = vi.fn();
    const errors = {
      region_id: 'Invalid region.',
      severity: 'Unknown severity.',
    };
    render(
      <ReportFilterBuilder
        filters={{}}
        onChange={onChange}
        regions={mockRegions}
        errors={errors}
      />
    );
    expect(screen.getByText('Invalid region.')).toBeInTheDocument();
    expect(screen.getByText('Unknown severity.')).toBeInTheDocument();
  });

  it('does not show inline errors when errors prop is empty', () => {
    const onChange = vi.fn();
    render(
      <ReportFilterBuilder filters={{}} onChange={onChange} regions={mockRegions} errors={{}} />
    );
    // No error text visible
    expect(screen.queryByText(/Must be a valid/i)).toBeNull();
    expect(screen.queryByText(/Must be one of/i)).toBeNull();
  });
});

describe('ReportFilterBuilder — expert mode', () => {
  it('toggles to expert mode and shows JSON textarea', async () => {
    const onChange = vi.fn();
    render(
      <ReportFilterBuilder
        filters={{ region_id: 1 }}
        onChange={onChange}
        regions={mockRegions}
      />
    );
    const user = userEvent.setup();

    // Click the Expert button
    await user.click(screen.getByRole('button', { name: /Expert/ }));

    // Textarea should be visible with JSON content
    const textarea = screen.getByLabelText('Filters raw JSON');
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe('TEXTAREA');
    expect((textarea as HTMLTextAreaElement).value).toContain('"region_id"');
  });

  it('switches back to builder mode and parses valid JSON', async () => {
    const onChange = vi.fn();
    render(
      <ReportFilterBuilder filters={{}} onChange={onChange} regions={mockRegions} />
    );
    const user = userEvent.setup();

    // Go to expert mode
    await user.click(screen.getByRole('button', { name: /Expert/ }));

    // Set JSON in textarea via fireEvent to avoid curly-brace parsing issues
    const textarea = screen.getByLabelText('Filters raw JSON');
    fireEvent.change(textarea, { target: { value: '{"severity": "LOW"}' } });

    // Click Builder button to switch back
    await user.click(screen.getByRole('button', { name: /Builder/ }));

    // onChange should have been called with parsed filters
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'LOW' })
    );
  });

  it('shows error when switching back with invalid JSON', async () => {
    const onChange = vi.fn();
    render(
      <ReportFilterBuilder filters={{}} onChange={onChange} regions={mockRegions} />
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Expert/ }));

    const textarea = screen.getByLabelText('Filters raw JSON');
    fireEvent.change(textarea, { target: { value: '{invalid json}' } });

    // Click Builder button
    await user.click(screen.getByRole('button', { name: /Builder/ }));

    // Should show error, not switch
    expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument();
    // Textarea should still be visible (still in expert mode)
    expect(screen.getByLabelText('Filters raw JSON')).toBeInTheDocument();
  });

  it('shows error for array or primitive JSON on switch back', async () => {
    const onChange = vi.fn();
    render(
      <ReportFilterBuilder filters={{}} onChange={onChange} regions={mockRegions} />
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Expert/ }));

    const textarea = screen.getByLabelText('Filters raw JSON');
    fireEvent.change(textarea, { target: { value: '["not", "an", "object"]' } });

    await user.click(screen.getByRole('button', { name: /Builder/ }));

    expect(screen.getByText(/Filters must be a JSON object/i)).toBeInTheDocument();
  });

  it('live-validates JSON in expert mode while typing', async () => {
    const onChange = vi.fn();
    render(
      <ReportFilterBuilder filters={{}} onChange={onChange} regions={mockRegions} />
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Expert/ }));

    const textarea = screen.getByLabelText('Filters raw JSON');
    // Set incomplete JSON
    fireEvent.change(textarea, { target: { value: '{' } });

    // Should show invalid JSON feedback
    expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument();

    // Complete the JSON
    fireEvent.change(textarea, { target: { value: '{}' } });

    // Error should clear (empty object is valid)
    expect(screen.queryByText(/Invalid JSON/)).toBeNull();
  });

  it('calls onChange on blur when JSON is valid', async () => {
    const onChange = vi.fn();
    render(
      <ReportFilterBuilder filters={{}} onChange={onChange} regions={mockRegions} />
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Expert/ }));

    const textarea = screen.getByLabelText('Filters raw JSON');
    fireEvent.change(textarea, { target: { value: '{"incident_type": "WILDLAND"}' } });

    // Blur the textarea
    fireEvent.blur(textarea);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ incident_type: 'WILDLAND' })
    );
  });
});
