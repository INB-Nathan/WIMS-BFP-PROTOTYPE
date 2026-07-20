import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CorrectionActionPanel } from '../CorrectionActionPanel';
import type { WorkspaceReport } from '@/types/triage-workspace';

const correctReport = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return { ...original, correctTriageReport: (...args: unknown[]) => correctReport(...args) };
});

function report(status: string): WorkspaceReport {
  return {
    report_id: 7, status, status_explanation: null, category: null, sub_category: null,
    reporting_context: null, safety_status: null, description: null, trust_score: 50,
    created_at: '2026-07-20T00:00:00Z', reported_at: null, previous_report_id: null,
    report_location: { source: 'report_location', available: false, latitude: null, longitude: null, accuracy_m: null, approximate: false, distance_to_report_m: null },
    device_location: { source: 'device_gps', available: false, latitude: null, longitude: null, accuracy_m: null, approximate: false, distance_to_report_m: null },
    ip_location: { source: 'ip_city_centroid', available: false, latitude: null, longitude: null, accuracy_m: null, approximate: true, distance_to_report_m: null },
    photos: [], contributor: { authenticated: false, trust_score: null, badge: null, total_reports: null, actioned_reports: null, pending_reports: null, evidence_quality: null, active_months: null },
    followups: [], feedback: [], contact_reveal_url: '/api/triage/reports/7/contact-reveal',
  };
}

describe('CorrectionActionPanel', () => {
  beforeEach(() => correctReport.mockReset());

  it('does not offer correction for a non-terminal report', () => {
    render(<CorrectionActionPanel reports={[report('PENDING')]} onComplete={vi.fn()} onError={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: /Correct a terminal decision/ })).not.toBeInTheDocument();
  });

  it('requires deliberate review and confirmation before correction', async () => {
    const onComplete = vi.fn();
    correctReport.mockResolvedValue({ status: 'corrected' });
    render(<CorrectionActionPanel reports={[report('REJECTED_BOGUS')]} onComplete={onComplete} onError={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Audit reason'), { target: { value: 'New verified evidence' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review correction' }));
    expect(correctReport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply correction' }));
    await waitFor(() => expect(correctReport).toHaveBeenCalledWith(7, expect.objectContaining({
      status: 'ACTIONED', correction_reason: 'New verified evidence',
    })));
    expect(onComplete).toHaveBeenCalled();
  });
});
