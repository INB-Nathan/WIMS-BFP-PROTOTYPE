import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TriageClusterEntry, TriageReportEntry } from '@/lib/api';
import { TriageInspectionModal } from './TriageInspectionModal';

function report(overrides: Partial<TriageReportEntry> = {}): TriageReportEntry {
  return {
    report_id: 10,
    latitude: 14.5,
    longitude: 121.0,
    category: 'STRUCTURAL',
    sub_category: 'RESIDENTIAL',
    reporting_context: 'someone_else_needs_help',
    safety_status: null,
    status: 'PENDING',
    status_explanation: null,
    trust_breakdown: { score: 80, included_signals: [], missing_signals: [], gps_mismatch: false, duplicate_device_count_30m: 0 },
    severity: 'HIGH',
    related_count: 0,
    linked_count: 0,
    created_at: '2026-06-25T00:00:00Z',
    reported_at: '2026-06-25T00:00:00Z',
    is_aging: false,
    is_timeout_risk: false,
    previous_report_id: null,
    station: { name: 'Balayan FS', distance_m: 1000, phone_available: true, phone: '123-4567' },
    province_name: 'Batangas',
    ...overrides,
  };
}

function cluster(overrides: Partial<TriageClusterEntry> = {}): TriageClusterEntry {
  return {
    cluster_id: 42,
    anchor_report_id: 10,
    cluster_status: 'OPEN',
    assigned_to: null,
    review_started_at: null,
    member_count: 2,
    has_life_safety: true,
    severity: 'HIGH',
    avg_trust: 76,
    oldest_report_at: '2026-06-25T00:00:00Z',
    is_aging: false,
    is_timeout_risk: true,
    is_danger: false,
    related_count: 1,
    reports: [report()],
    station: { name: 'Balayan FS', distance_m: 1000, phone_available: true, phone: '123-4567' },
    province_name: 'Batangas',
    ...overrides,
  };
}

function renderModal(clusterIn: TriageClusterEntry, role = 'NATIONAL_VALIDATOR') {
  const onMessage = vi.fn();
  const onError = vi.fn();
  const utils = render(
    <TriageInspectionModal
      openCluster={clusterIn}
      inspectionMode="cluster"
      onClose={vi.fn()}
      onReloadQueue={vi.fn()}
      onMessage={onMessage}
      onError={onError}
      role={role}
      currentUsername="validator1"
    />,
  );
  return { ...utils, onMessage, onError };
}

describe('TriageInspectionModal — #636 context + Send Update', () => {
  it('renders the jurisdiction + nearest-station context strip', () => {
    renderModal(cluster());
    expect(screen.getByTestId('triage-jurisdiction-context')).toBeInTheDocument();
    expect(screen.getByTestId('triage-context-province')).toHaveTextContent('Batangas');
    expect(screen.getByTestId('triage-context-station-name')).toHaveTextContent('Balayan FS');
    expect(screen.getByTestId('triage-context-station-phone')).toHaveTextContent('123-4567');
  });

  it('opens the Send Update tab when the "5" shortcut is pressed (allowed role)', async () => {
    const user = userEvent.setup();
    renderModal(cluster());
    await user.keyboard('5');
    expect(screen.getByTestId('triage-panel-update')).toBeInTheDocument();
    expect(screen.getByTestId('update-stage-select')).toBeInTheDocument();
  });

  it('hides the Send Update tab for SYSTEM_ADMIN and ignores the 5 shortcut', async () => {
    const user = userEvent.setup();
    renderModal(cluster(), 'SYSTEM_ADMIN');
    // SYSTEM_ADMIN has no Send Update tab rendered.
    expect(screen.queryByTestId('triage-panel-update')).toBeNull();
    await user.keyboard('5');
    // 5 must not open the update panel for SYSTEM_ADMIN.
    expect(screen.queryByTestId('triage-panel-update')).toBeNull();
  });

  it('shows a closed notice when the anchor report is already terminal', async () => {
    const user = userEvent.setup();
    const closedCluster = cluster({
      reports: [report({ status: 'ACTIONED', report_id: 10 })],
      anchor_report_id: 10,
    });
    renderModal(closedCluster);
    await user.keyboard('5');
    expect(screen.getByTestId('triage-panel-update-closed')).toBeInTheDocument();
    expect(screen.getByTestId('triage-panel-update-closed')).toHaveTextContent('already closed');
    expect(screen.queryByTestId('update-stage-select')).toBeNull();
  });
});
