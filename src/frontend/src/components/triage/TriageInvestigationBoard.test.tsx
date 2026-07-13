import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TriageClusterEntry, TriageReportEntry } from '@/lib/api';
import { TriageInvestigationBoard } from './TriageInvestigationBoard';

function report(overrides: Partial<TriageReportEntry>): TriageReportEntry {
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
    description: 'Smoke near market',
    trust_breakdown: { score: 80, included_signals: [], missing_signals: [], gps_mismatch: false, duplicate_device_count_30m: 0 },
    severity: 'HIGH',
    related_count: 0,
    linked_count: 0,
    created_at: '2026-06-25T00:00:00Z',
    reported_at: '2026-06-25T00:00:00Z',
    is_aging: false,
    is_timeout_risk: false,
    previous_report_id: null,
    station: { name: 'Balayan FS', distance_m: 1000, phone_available: true },
    ...overrides,
  };
}

function cluster(overrides: Partial<TriageClusterEntry>): TriageClusterEntry {
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
    reports: [report({ report_id: 10 }), report({ report_id: 11, latitude: 0 as number, longitude: 0 as number })],
    station: { name: 'Balayan FS', distance_m: 1000, phone_available: true },
    ...overrides,
  };
}

describe('TriageInvestigationBoard', () => {
  it('renders selected cluster summary, evidence table rows, no-location hint, and inspect CTA', async () => {
    const onInspect = vi.fn();
    const onSelectReport = vi.fn();

    render(
      <TriageInvestigationBoard
        items={[cluster({})]}
        selectedItem={cluster({})}
        selectedReportId={10}
        role="NATIONAL_VALIDATOR"
        claiming={null}
        onInspect={onInspect}
        onSelectItem={vi.fn()}
        onSelectReport={onSelectReport}
        onClaimCluster={vi.fn()}
      />,
    );

    expect(screen.getByText('Cluster #42')).toBeInTheDocument();
    expect(screen.getByText(/Life safety/)).toBeInTheDocument();
    expect(screen.getByTestId('triage-evidence-row-10')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/No usable location/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Inspect \/ Act/ }));
    expect(onInspect).toHaveBeenCalledWith(cluster({}));
  });

  it('renders comma-separated signals found/missing and reflects trust-score coloring', () => {
    render(
      <TriageInvestigationBoard
        items={[cluster({})]}
        selectedItem={cluster({
          reports: [
            report({
              report_id: 20,
              trust_breakdown: {
                score: 82,
                included_signals: ['gps_match', 'device_history'],
                missing_signals: ['photo_evidence'],
                gps_mismatch: false,
                duplicate_device_count_30m: 0,
              },
            }),
          ],
        })}
        selectedReportId={null}
        role="NATIONAL_VALIDATOR"
        claiming={null}
        onInspect={vi.fn()}
        onSelectItem={vi.fn()}
        onSelectReport={vi.fn()}
        onClaimCluster={vi.fn()}
      />,
    );

    expect(screen.getByText('gps_match, device_history')).toBeInTheDocument();
    expect(screen.getByText('photo_evidence')).toBeInTheDocument();
    // score >= 75 -> emerald tone on the row (statusTone), reused from triageGeometry.
    expect(screen.getByTestId('triage-evidence-row-20').className).toContain('emerald');
  });

  it('clicking a row selects the report via onSelectReport, not navigation', async () => {
    const onSelectReport = vi.fn();

    render(
      <TriageInvestigationBoard
        items={[cluster({})]}
        selectedItem={cluster({})}
        selectedReportId={null}
        role="NATIONAL_VALIDATOR"
        claiming={null}
        onInspect={vi.fn()}
        onSelectItem={vi.fn()}
        onSelectReport={onSelectReport}
        onClaimCluster={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTestId('triage-evidence-row-10'));
    expect(onSelectReport).toHaveBeenCalledWith(10);
  });
});
