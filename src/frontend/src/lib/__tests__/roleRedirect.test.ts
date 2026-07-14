import { describe, expect, it } from 'vitest';
import { defaultRouteForRole, resolvePostLoginRedirect } from '../roleRedirect';

describe('role redirect helpers', () => {
  it('routes encoder and validator roles to their dashboards', () => {
    expect(defaultRouteForRole('REGIONAL_ENCODER')).toBe('/dashboard/regional');
    expect(defaultRouteForRole('ENCODER')).toBe('/dashboard/regional');
    expect(defaultRouteForRole('NATIONAL_VALIDATOR')).toBe('/dashboard/validator');
  });

  it('routes CIVILIAN_REPORTER to /contributor', () => {
    expect(defaultRouteForRole('CIVILIAN_REPORTER')).toBe('/contributor');
  });

  it('replaces stale operations redirects with the role dashboard', () => {
    expect(resolvePostLoginRedirect('REGIONAL_ENCODER', 'https://localhost/home', 'https://localhost')).toBe('/dashboard/regional');
    expect(resolvePostLoginRedirect('NATIONAL_VALIDATOR', '/home', 'https://localhost')).toBe('/dashboard/validator');
  });

  it('replaces stale /contributor redirect with the role dashboard for non-CIVILIAN_REPORTER', () => {
    expect(resolvePostLoginRedirect('REGIONAL_ENCODER', 'https://localhost/contributor', 'https://localhost')).toBe('/dashboard/regional');
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

  it('CIVILIAN_REPORTER defaults to /contributor when no saved redirect', () => {
    expect(resolvePostLoginRedirect('CIVILIAN_REPORTER', null, 'https://localhost')).toBe('/contributor');
    expect(resolvePostLoginRedirect('CIVILIAN_REPORTER', '', 'https://localhost')).toBe('/contributor');
  });

  it('CIVILIAN_REPORTER ignores /contributor as a saved redirect (generic path)', () => {
    expect(resolvePostLoginRedirect('CIVILIAN_REPORTER', 'https://localhost/contributor', 'https://localhost')).toBe('/contributor');
  });

  it('CIVILIAN_REPORTER preserves a non-generic saved redirect', () => {
    // If a CIVILIAN_REPORTER has a deep link like /contributor/reports/42,
    // it should be preserved (not in GENERIC_LOGIN_PATHS).
    expect(resolvePostLoginRedirect('CIVILIAN_REPORTER', 'https://localhost/contributor/reports/42', 'https://localhost')).toBe('/contributor/reports/42');
  });

  it('unknown role falls back to /dashboard', () => {
    expect(defaultRouteForRole('UNKNOWN_ROLE')).toBe('/dashboard');
    expect(defaultRouteForRole(null)).toBe('/dashboard');
    expect(defaultRouteForRole(undefined as unknown as string)).toBe('/dashboard');
  });
});
