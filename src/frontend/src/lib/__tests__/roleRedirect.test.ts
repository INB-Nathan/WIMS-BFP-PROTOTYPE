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

  it('ignores a cross-role dashboard saved redirect', () => {
    // encoder_r01 logs in but browser had a stale /dashboard/validator saved redirect
    expect(resolvePostLoginRedirect('REGIONAL_ENCODER', 'http://localhost/dashboard/validator', 'http://localhost')).toBe('/dashboard/regional');
    // validator logs in but browser had a stale /dashboard/regional saved redirect
    expect(resolvePostLoginRedirect('NATIONAL_VALIDATOR', 'http://localhost/dashboard/regional', 'http://localhost')).toBe('/dashboard/validator');
  });

  it('preserves a deep link within the user\'s own dashboard', () => {
    expect(resolvePostLoginRedirect('REGIONAL_ENCODER', 'http://localhost/dashboard/regional/incidents/42', 'http://localhost')).toBe('/dashboard/regional/incidents/42');
  });
});
