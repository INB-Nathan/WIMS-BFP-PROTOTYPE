import { describe, expect, it } from 'vitest';
import { buildTopNDrilldownFilters, getTopNDimensionLabel } from './topNDrilldown';

describe('topNDrilldown', () => {
  it('builds region drilldown filters from region lookup names', () => {
    const result = buildTopNDrilldownFilters(
      { province: 'Metro Manila', municipality: 'Makati' },
      'region',
      'National Capital Region',
      [{ region_id: 13, region_name: 'National Capital Region', region_code: 'NCR' }],
    );

    expect(result).toEqual({
      province: 'Metro Manila',
      region_id: 13,
      municipality: undefined,
      fire_station: undefined,
    });
  });

  it('builds municipality and fire-station drilldown filters', () => {
    expect(buildTopNDrilldownFilters({}, 'municipality', 'Makati')).toEqual({
      municipality: 'Makati',
      fire_station: undefined,
    });
    expect(buildTopNDrilldownFilters({ municipality: 'Makati' }, 'fire_station', 'Makati Central Fire Station')).toEqual({
      municipality: 'Makati',
      fire_station: 'Makati Central Fire Station',
    });
  });

  it('exposes readable labels for supported dimensions', () => {
    expect(getTopNDimensionLabel('region')).toBe('Region');
    expect(getTopNDimensionLabel('municipality')).toBe('Municipality');
    expect(getTopNDimensionLabel('fire_station')).toBe('Fire station');
  });
});
