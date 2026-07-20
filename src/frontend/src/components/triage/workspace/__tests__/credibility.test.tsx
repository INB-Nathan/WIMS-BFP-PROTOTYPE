import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContributorCredibility } from '../ContributorCredibility';
import type { ContributorCredibility as Credibility } from '@/types/triage-workspace';

const revealContact = vi.fn();
vi.mock('@/lib/api', () => ({ revealTriageReporterContact: (...args: unknown[]) => revealContact(...args) }));

const credibility: Credibility = {
  authenticated: true,
  badge: 'Established',
  trust_score: 82,
  total_reports: 5,
  actioned_reports: 2,
  pending_reports: 1,
  evidence_quality: 91,
  active_months: 4,
};

describe('ContributorCredibility', () => {
  beforeEach(() => revealContact.mockReset());

  it('keeps supporting details collapsed by default', () => {
    render(<ContributorCredibility reportId={7} credibility={credibility} />);
    expect(screen.getByText(/Reliability score/)).toHaveTextContent('82');
    expect(screen.queryByText('Prior reports')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getByText('Prior reports')).toBeInTheDocument();
  });

  it('reveals contact only after explicit action and warns against persistence', async () => {
    revealContact.mockResolvedValue({ report_id: 7, reporter_name: 'Ana', reporter_phone: '+639171234567' });
    render(<ContributorCredibility reportId={7} credibility={credibility} />);
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal contact' }));
    await waitFor(() => expect(revealContact).toHaveBeenCalledWith(7));
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText(/Do not copy this contact/)).toBeInTheDocument();
  });
});
