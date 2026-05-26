import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api', () => ({
  queueAnalyticsExport: vi.fn(),
  downloadAnalyticsExport: vi.fn(),
}));

import { ExportPreviewModal, DEFAULT_SELECTED_COLUMNS } from './ExportPreviewModal';

function renderModal() {
  return render(
    <ExportPreviewModal
      format="csv"
      filters={{}}
      filtersSummary=""
      onClose={() => {}}
    />,
  );
}

describe('ExportPreviewModal — #113 default column selection', () => {
  it('exports the curated 9-column default list', () => {
    expect(DEFAULT_SELECTED_COLUMNS).toEqual([
      'incident_id',
      'notification_dt',
      'region_name',
      'province_name',
      'municipality_name',
      'general_category',
      'alarm_level',
      'estimated_damage_php',
      'total_response_time_minutes',
    ]);
  });

  it('pre-checks exactly the 9 default columns on render', () => {
    renderModal();

    for (const col of DEFAULT_SELECTED_COLUMNS) {
      const label = screen.getByText(labelFor(col)).closest('label');
      const checkbox = label?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      expect(checkbox, `${col} checkbox`).not.toBeNull();
      expect(checkbox!.checked, `${col} should be checked by default`).toBe(true);
    }
  });

  it('does not include barangay_name in the picker (no checkbox at all)', () => {
    renderModal();
    expect(screen.queryByText(/^Barangay$/)).toBeNull();
  });

  it('leaves region_id unchecked by default (region_name is preferred)', () => {
    renderModal();
    const regionIdLabel = screen.getByText('Region ID').closest('label');
    const checkbox = regionIdLabel?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox).not.toBeNull();
    expect(checkbox!.checked).toBe(false);
  });

  it('shows "Region" (region_name) as a selectable, checked column', () => {
    renderModal();
    const regionLabel = screen.getByText('Region').closest('label');
    const checkbox = regionLabel?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox).not.toBeNull();
    expect(checkbox!.checked).toBe(true);
  });
});

// Mirror of ExportPreviewModal's COLUMN_LABELS — kept local so the test
// doesn't import internals; if a label is renamed the test will fail
// noisily and someone can update both in lockstep.
function labelFor(col: string): string {
  const map: Record<string, string> = {
    incident_id: 'Incident ID',
    notification_dt: 'Notification Date/Time',
    region_name: 'Region',
    province_name: 'Province',
    municipality_name: 'Municipality',
    general_category: 'Category',
    alarm_level: 'Alarm Level',
    estimated_damage_php: 'Est. Damage (PHP)',
    total_response_time_minutes: 'Response Time (min)',
  };
  return map[col] ?? col;
}
