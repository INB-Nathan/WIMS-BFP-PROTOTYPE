import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { StatusUpdateStage } from '@/lib/api';
import { StatusUpdatePanel } from './StatusUpdatePanel';

function renderPanel(overrides: Partial<React.ComponentProps<typeof StatusUpdatePanel>> = {}) {
  const onRequestConfirm = overrides.onRequestConfirm ?? vi.fn();
  render(
    <StatusUpdatePanel
      stage="UNDER_REVIEW"
      setStage={vi.fn()}
      stationName=""
      setStationName={vi.fn()}
      jurisdiction=""
      setJurisdiction={vi.fn()}
      eta=""
      setEta={vi.fn()}
      arrivedAt=""
      setArrivedAt={vi.fn()}
      outcomeSummary=""
      setOutcomeSummary={vi.fn()}
      duplicateOf=""
      setDuplicateOf={vi.fn()}
      reason=""
      setReason={vi.fn()}
      onRequestConfirm={onRequestConfirm}
      busy={false}
      {...overrides}
    />,
  );
  return { onRequestConfirm };
}

describe('StatusUpdatePanel (#636)', () => {
  it('renders the stage dropdown populated with all lifecycle stages', () => {
    renderPanel();
    const select = screen.getByTestId('update-stage-select') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual([
      'RECEIVED',
      'UNDER_REVIEW',
      'HELP_DISPATCHED',
      'ON_SCENE',
      'RESOLVED',
      'CLOSED_DUPLICATE',
      'CLOSED_INSUFFICIENT',
    ]);
  });

  it('shows no metadata fields for basic stages', () => {
    renderPanel({ stage: 'UNDER_REVIEW' });
    expect(screen.queryByTestId('update-station-input')).toBeNull();
    expect(screen.queryByTestId('update-arrived-input')).toBeNull();
    expect(screen.getByTestId('update-note-basic')).toBeInTheDocument();
  });

  it('shows station + jurisdiction + eta fields for HELP_DISPATCHED', () => {
    renderPanel({ stage: 'HELP_DISPATCHED' as StatusUpdateStage });
    expect(screen.getByTestId('update-station-input')).toBeInTheDocument();
    expect(screen.getByTestId('update-jurisdiction-input')).toBeInTheDocument();
    expect(screen.getByTestId('update-eta-input')).toBeInTheDocument();
  });

  it('shows arrived_at for ON_SCENE, outcome for RESOLVED, reason for CLOSED_INSUFFICIENT', () => {
    renderPanel({ stage: 'ON_SCENE' as StatusUpdateStage });
    expect(screen.getByTestId('update-arrived-input')).toBeInTheDocument();

    renderPanel({ stage: 'RESOLVED' as StatusUpdateStage });
    expect(screen.getByTestId('update-outcome-input')).toBeInTheDocument();

    renderPanel({ stage: 'CLOSED_INSUFFICIENT' as StatusUpdateStage });
    expect(screen.getByTestId('update-reason-input')).toBeInTheDocument();

    renderPanel({ stage: 'CLOSED_DUPLICATE' as StatusUpdateStage });
    expect(screen.getByTestId('update-duplicate-input')).toBeInTheDocument();
  });

  it('calls onRequestConfirm when the send button is clicked', async () => {
    const user = userEvent.setup();
    const { onRequestConfirm } = renderPanel();
    await user.click(screen.getByTestId('update-send-button'));
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables the send button while busy', () => {
    renderPanel({ busy: true });
    expect((screen.getByTestId('update-send-button') as HTMLButtonElement).disabled).toBe(true);
  });
});
