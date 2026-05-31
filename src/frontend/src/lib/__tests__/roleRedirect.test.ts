import { describe, expect, it } from 'vitest';
import { defaultRouteForRole, resolvePostLoginRedirect } from '../roleRedirect';

describe('role redirect helpers', () => {
  it('routes encoder and validator roles to their dashboards', () => {
    expect(defaultRouteForRole('REGIONAL_ENCODER')).toBe('/dashboard/regional');
    expect(defaultRouteForRole('ENCODER')).toBe('/dashboard/regional');
    expect(defaultRouteForRole('NATIONAL_VALIDATOR')).toBe('/dashboard/validator');
    expect(defaultRouteForRole('VALIDATOR')).toBe('/dashboard/validator');
  });

  it('replaces stale operations redirects with the role dashboard', () => {
    expect(resolvePostLoginRedirect('REGIONAL_ENCODER', 'https://localhost/home', 'https://localhost')).toBe('/dashboard/regional');
    expect(resolvePostLoginRedirect('NATIONAL_VALIDATOR', '/home', 'https://localhost')).toBe('/dashboard/validator');
  });

  it('keeps a specific same-origin workflow redirect after idle logout', () => {
    expect(resolvePostLoginRedirect('REGIONAL_ENCODER', 'https://localhost/afor/create?x=1', 'https://localhost')).toBe('/afor/create?x=1');
  });
});
