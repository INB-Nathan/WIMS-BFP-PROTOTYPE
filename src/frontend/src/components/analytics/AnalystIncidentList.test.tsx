/**
 * Regression test for the analyst dashboard "Analyze selected" loop.
 *
 * History (2026-06-21): on `/dashboard/analyst`, after a user clicks
 * "Check all on page" and then "Analyze selected", the workflow page
 * (`/dashboard/analyst/[workflow]`) flashes the "Selected set active"
 * banner and then loops the analyst incident list, never settling.
 *
 * Root cause: the load effect inside `AnalystIncidentList` listed `filters`
 * in its dependency array alongside `filterKey` (the JSON-stringified form
 * of `filters`). The workflow page passes a `useMemo` (`evidenceFilters`)
 * whose identity changes every render because its deps include the
 * `selectedIncidentIds` state that the list itself rewrites via
 * `onSelectionChange` on mount. `Object.is(filters, prevFilters)` is then
 * always `false` -> the effect re-fires -> setLoading/setItems trigger
 * another render -> the parent's `useMemo` returns yet another new object
 * reference -> infinite loop.
 *
 * This test pins the fix: even when the parent re-renders with a new
 * `filters` object reference that has the SAME content, the load effect
 * must NOT re-fire.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useState } from 'react';

const mockReplace = vi.fn();
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

const mockFetchAnalystIncidentList = vi.fn();

vi.mock('@/lib/api', () => ({
  fetchAnalystIncidentList: (params: object) => mockFetchAnalystIncidentList(params),
}));

import { AnalystIncidentList } from './AnalystIncidentList';

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchAnalystIncidentList.mockResolvedValue({
    incidents: [
      { incident_id: 1, notification_dt: '2024-01-15T10:00:00Z' },
      { incident_id: 2, notification_dt: '2024-01-15T10:01:00Z' },
    ],
    total: 2,
    page: 1,
    page_size: 25,
  });
});

/**
 * Wraps `AnalystIncidentList` so the parent re-renders on a tick.
 * Each re-render passes a NEW `filters` object reference with IDENTICAL
 * content — the same scenario the workflow page's `evidenceFilters` useMemo
 * produces when `onSelectionChange` rewrites `selectedIncidentIds`.
 */
function ReRenderingHarness({ initialSelected }: { initialSelected?: number[] }) {
  const [, force] = useState(0);
  // Re-render the harness a few times after mount. Each tick constructs a
  // fresh `filters` object with the same content as the previous one.
  setTimeout(() => force((n) => n + 1), 5);
  setTimeout(() => force((n) => n + 1), 10);
  setTimeout(() => force((n) => n + 1), 15);

  const filters = { region_id: 1 }; // new object each render
  return (
    <AnalystIncidentList
      filters={filters}
      initialSelectedIncidentIds={initialSelected}
    />
  );
}

describe('AnalystIncidentList — #incident-loop regression', () => {
  it('does not re-fetch the incident list when the parent re-renders with a new filters object of identical content', async () => {
    render(<ReRenderingHarness initialSelected={[1, 2]} />);

    // Allow mount + at least 3 re-renders (the three setTimeouts above) to settle.
    await waitFor(() => {
      expect(mockFetchAnalystIncidentList).toHaveBeenCalled();
    });

    const callCountAfterMount = mockFetchAnalystIncidentList.mock.calls.length;

    // Give the harness's extra re-renders time to (not) re-fire the effect.
    await new Promise((r) => setTimeout(r, 50));

    const finalCallCount = mockFetchAnalystIncidentList.mock.calls.length;

    // The fix: the load effect depends on `filterKey` (a JSON string), not
    // on the raw `filters` object. So a new object reference with the same
    // content MUST NOT trigger another fetch. Without the fix this would
    // grow unbounded (one fetch per re-render).
    expect(finalCallCount).toBe(callCountAfterMount);
  });

  it('does re-fetch when the filter content actually changes', async () => {
    const harness = render(<ReRenderingHarness />);

    await waitFor(() => {
      expect(mockFetchAnalystIncidentList).toHaveBeenCalled();
    });

    const initialCalls = mockFetchAnalystIncidentList.mock.calls.length;

    // Force a content change: re-render with a different region_id.
    harness.rerender(
      <AnalystIncidentList
        filters={{ region_id: 2 }}
      />,
    );

    await waitFor(() => {
      expect(mockFetchAnalystIncidentList.mock.calls.length).toBeGreaterThan(initialCalls);
    });

    const lastCall = mockFetchAnalystIncidentList.mock.calls.at(-1)![0] as { region_id?: number };
    expect(lastCall.region_id).toBe(2);
  });
});
