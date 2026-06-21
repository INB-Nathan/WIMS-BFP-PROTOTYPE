/**
 * Unit tests for the Service Worker RSC cache key construction.
 *
 * The bug (PR #382): cache keys used an invalid 'rsc:' URL scheme prefix
 * that the Cache API rejected. The fix uses a synthetic same-origin path
 * prefix '/_rsc' which is a valid HTTP URL.
 *
 * These tests verify:
 * 1. canonicalPath maps incident detail pages to a stable template key
 * 2. The constructed cache key is a valid HTTP(S) URL (not 'rsc:' scheme)
 */

import { describe, it, expect } from 'vitest';

// ── canonicalPath (extracted from sw.js lines 47-53) ──────────────────────

function canonicalPath(pathname: string): string {
  if (
    /^\/dashboard\/regional\/incidents\/[^/]+\/?$/.test(pathname) &&
    !/\/incidents\/local\//.test(pathname)
  ) {
    return '/dashboard/regional/incidents/__detail__';
  }
  return pathname;
}

// ── RSC cache key builder (replicates sw.js line 140) ─────────────────────

function buildRscCacheKey(origin: string, pathname: string): string {
  return origin + '/_rsc' + canonicalPath(pathname);
}

const INCIDENT_DETAIL_SHELL = '/dashboard/regional/incidents/1';

function offlineNavigationFallbackKeys(origin: string, pathname: string): string[] {
  const canonicalKey = origin + canonicalPath(pathname);
  const isCanonicalDetail = canonicalKey !== origin + pathname;
  return [
    origin + pathname,
    canonicalKey,
    ...(isCanonicalDetail ? [origin + INCIDENT_DETAIL_SHELL] : []),
    origin + '/dashboard',
    origin + '/',
  ];
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('canonicalPath', () => {
  it('maps incident detail pages to the __detail__ template key', () => {
    expect(canonicalPath('/dashboard/regional/incidents/42')).toBe(
      '/dashboard/regional/incidents/__detail__'
    );
    expect(canonicalPath('/dashboard/regional/incidents/42/')).toBe(
      '/dashboard/regional/incidents/__detail__'
    );
    expect(canonicalPath('/dashboard/regional/incidents/abc-123')).toBe(
      '/dashboard/regional/incidents/__detail__'
    );
  });

  it('preserves non-incident pathnames unchanged', () => {
    expect(canonicalPath('/dashboard')).toBe('/dashboard');
    expect(canonicalPath('/dashboard/regional')).toBe('/dashboard/regional');
    expect(canonicalPath('/api/incidents')).toBe('/api/incidents');
    expect(canonicalPath('/')).toBe('/');
  });

  it('preserves local incident paths (excluded from template)', () => {
    expect(canonicalPath('/dashboard/regional/incidents/local/42')).toBe(
      '/dashboard/regional/incidents/local/42'
    );
  });
});

describe('buildRscCacheKey — PR #382 fix', () => {
  const origin = 'https://wimsbfp.tech';

  it('produces a valid HTTP URL (not a custom scheme)', () => {
    const key = buildRscCacheKey(origin, '/dashboard/regional/incidents/42');
    expect(key).toBe(
      'https://wimsbfp.tech/_rsc/dashboard/regional/incidents/__detail__'
    );
    // Must start with http:// or https://
    expect(key).toMatch(/^https?:\/\//);
    // Must NOT use the old 'rsc:' scheme prefix
    expect(key).not.toMatch(/^rsc:/);
    expect(key).not.toContain('rsc:');
  });

  it('uses the synthetic /_rsc path prefix for namespace isolation', () => {
    const key = buildRscCacheKey('http://localhost:3000', '/dashboard');
    expect(key).toBe('http://localhost:3000/_rsc/dashboard');
    expect(key).toContain('/_rsc/');
  });

  it('never produces a bare scheme-only prefix', () => {
    const key = buildRscCacheKey(origin, '/some/page');
    // The Cache API constructs a Request from the key string.
    // 'rsc:' would throw: Failed to execute 'put' on 'Cache': Request scheme 'rsc' is unsupported
    // Our key must be a valid URL that can be passed to new Request(key)
    expect(() => new Request(key)).not.toThrow();
  });

  it('handles root path correctly', () => {
    const key = buildRscCacheKey(origin, '/');
    expect(key).toBe('https://wimsbfp.tech/_rsc/');
  });

  it('handles deep nested paths', () => {
    const key = buildRscCacheKey(origin, '/dashboard/regional/analytics/monthly');
    expect(key).toBe('https://wimsbfp.tech/_rsc/dashboard/regional/analytics/monthly');
  });
});

describe('offlineNavigationFallbackKeys', () => {
  const origin = 'https://wimsbfp.tech';

  it('falls back from any pending-sync local incident URL to the cached detail shell before the generic dashboard', () => {
    expect(offlineNavigationFallbackKeys(origin, '/dashboard/regional/incidents/abc-123')).toEqual([
      'https://wimsbfp.tech/dashboard/regional/incidents/abc-123',
      'https://wimsbfp.tech/dashboard/regional/incidents/__detail__',
      'https://wimsbfp.tech/dashboard/regional/incidents/1',
      'https://wimsbfp.tech/dashboard',
      'https://wimsbfp.tech/',
    ]);
  });

  it('does not use the incident detail shell for unrelated navigations', () => {
    expect(offlineNavigationFallbackKeys(origin, '/dashboard/regional')).toEqual([
      'https://wimsbfp.tech/dashboard/regional',
      'https://wimsbfp.tech/dashboard/regional',
      'https://wimsbfp.tech/dashboard',
      'https://wimsbfp.tech/',
    ]);
  });
});
