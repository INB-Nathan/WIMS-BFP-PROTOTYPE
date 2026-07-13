/**
 * AutoRefreshToast tests — non-blocking event-driven refresh indicator (PR #518).
 *
 * Expected behavior:
 * - Renders nothing when pending, refreshing, and justRefreshed are all false.
 * - Shows the "pending" label/icon when pending=true.
 * - Shows the "refreshing" label/icon (spinner) when refreshing=true; refreshing
 *   takes priority over pending when both are true simultaneously.
 * - Shows the "done" label when justRefreshed=true and refreshing/pending are false.
 * - A custom `text` prop overrides the default per-state label.
 * - The toast root carries role="status" and aria-live="polite" while visible.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AutoRefreshToast } from '../AutoRefreshToast';

describe('AutoRefreshToast', () => {
  it('renders nothing when pending, refreshing, and justRefreshed are all false', () => {
    const { container } = render(<AutoRefreshToast />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the pending state text when pending is true', () => {
    render(<AutoRefreshToast pending />);
    expect(screen.getByText(/New data available/i)).toBeInTheDocument();
  });

  it('shows the refreshing state text when refreshing is true', () => {
    render(<AutoRefreshToast refreshing />);
    expect(screen.getByText(/Refreshing…/i)).toBeInTheDocument();
  });

  it('prioritizes refreshing over pending when both are true', () => {
    render(<AutoRefreshToast pending refreshing />);
    expect(screen.getByText(/Refreshing…/i)).toBeInTheDocument();
    expect(screen.queryByText(/New data available/i)).not.toBeInTheDocument();
  });

  it('shows the done state text when justRefreshed is true and refreshing/pending are false', () => {
    render(<AutoRefreshToast justRefreshed />);
    expect(screen.getByText(/Data refreshed/i)).toBeInTheDocument();
  });

  it('overrides the default per-state label with the text prop', () => {
    render(<AutoRefreshToast pending text="Custom label" />);
    expect(screen.getByText('Custom label')).toBeInTheDocument();
    expect(screen.queryByText(/New data available/i)).not.toBeInTheDocument();
  });

  it('applies the custom text override to the refreshing and done states as well', () => {
    const { rerender } = render(<AutoRefreshToast refreshing text="Working…" />);
    expect(screen.getByText('Working…')).toBeInTheDocument();

    rerender(<AutoRefreshToast justRefreshed text="All set" />);
    expect(screen.getByText('All set')).toBeInTheDocument();
  });

  it('has role="status" and aria-live="polite" while visible', () => {
    render(<AutoRefreshToast pending />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });
});
