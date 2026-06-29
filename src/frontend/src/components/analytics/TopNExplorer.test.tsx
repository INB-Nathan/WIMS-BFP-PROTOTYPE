import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopNExplorer } from './TopNExplorer';

const sampleData = [
  { name: 'Makati', value: 12, incident_count: 12, metric_count: 12 },
  { name: 'Manila', value: 9, incident_count: 9, metric_count: 9 },
];

describe('TopNExplorer', () => {
  it('renders selectable ranked hotspots and detail metrics', () => {
    render(
      <TopNExplorer
        data={sampleData}
        metric="incidents"
        dimension="municipality"
        selectedName="Makati"
        onSelect={vi.fn()}
        onShowMatchingIncidents={vi.fn()}
        onViewOnMap={vi.fn()}
      />,
    );

    expect(screen.getByText('Selected hotspot')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Makati' })).toBeInTheDocument();
    expect(screen.getByText('Share of visible Top-N')).toBeInTheDocument();
    expect(screen.getByText('57.1%')).toBeInTheDocument();
  });

  it('fires select and action callbacks', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onShowMatchingIncidents = vi.fn();
    const onViewOnMap = vi.fn();

    render(
      <TopNExplorer
        data={sampleData}
        metric="incidents"
        dimension="municipality"
        selectedName="Makati"
        onSelect={onSelect}
        onShowMatchingIncidents={onShowMatchingIncidents}
        onViewOnMap={onViewOnMap}
      />,
    );

    await user.click(screen.getByRole('button', { name: /manila/i }));
    expect(onSelect).toHaveBeenCalledWith('Manila');

    await user.click(screen.getByRole('button', { name: /show matching incidents/i }));
    expect(onShowMatchingIncidents).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /view on map/i }));
    expect(onViewOnMap).toHaveBeenCalledTimes(1);
  });
});
