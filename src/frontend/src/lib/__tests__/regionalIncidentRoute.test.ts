import { describe, expect, it } from 'vitest';
import { extractRegionalIncidentRouteId } from '../regionalIncidentRoute';

describe('extractRegionalIncidentRouteId', () => {
  it('extracts a server incident id from the live pathname', () => {
    expect(extractRegionalIncidentRouteId('/dashboard/regional/incidents/123')).toBe('123');
  });

  it('extracts a pending local UUID from the live pathname', () => {
    expect(
      extractRegionalIncidentRouteId('/dashboard/regional/incidents/4c0f64a6-e5b3-4593-9939-a59eb7993205'),
    ).toBe('4c0f64a6-e5b3-4593-9939-a59eb7993205');
  });

  it('returns undefined for non-detail paths', () => {
    expect(extractRegionalIncidentRouteId('/dashboard/regional')).toBeUndefined();
    expect(extractRegionalIncidentRouteId(undefined)).toBeUndefined();
  });
});
