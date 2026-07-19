import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('./transport', () => ({ apiFetch }));

import { fetchPerimeter, fetchPerimeterIncidentOptions, saveManualPerimeter } from './perimeters';

const geometry = {
  type: 'Polygon' as const,
  coordinates: [[[121, 14], [121.1, 14], [121.1, 14.1], [121, 14]]],
};

describe('perimeter API client', () => {
  beforeEach(() => apiFetch.mockReset());

  it('creates a manual-draw perimeter through the regional API', async () => {
    apiFetch.mockResolvedValue({});

    await saveManualPerimeter(42, geometry, false);

    expect(apiFetch).toHaveBeenCalledWith('/regional/incidents/42/perimeter', {
      method: 'POST',
      body: JSON.stringify({ geometry, map_method: 'MANUAL_DRAW' }),
    });
  });

  it('lists verified perimeter incidents backed by civilian reports', async () => {
    apiFetch.mockResolvedValue([]);

    await fetchPerimeterIncidentOptions();

    expect(apiFetch).toHaveBeenCalledWith('/regional/perimeter-incidents');
  });

  it('loads the existing perimeter for editing', async () => {
    apiFetch.mockResolvedValue({});

    await fetchPerimeter(42);

    expect(apiFetch).toHaveBeenCalledWith('/regional/incidents/42/perimeter');
  });
});
