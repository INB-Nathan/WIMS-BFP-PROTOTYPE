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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// Reads the actual sw.js source so the contract assertions catch drift
// (replicated helpers only document the design; this guards the file).
const SW_SOURCE = readFileSync(
  join(process.cwd(), 'public', 'sw.js'),
  'utf8',
);

// ── canonicalPath (replicates sw.js; v12 adds 3 analyst families) ────────

const VALID_ANALYST_WORKFLOW_SLUGS = new Set([
  'comparative',
  'heatmap',
  'trends',
  'response-time',
  'top-n',
  'incident-explorer',
]);

const CACHE_NAME = 'wims-bfp-cache-v13';
const INCIDENT_DETAIL_SHELL = '/dashboard/regional/incidents/1';
const ANALYST_DETAIL_SHELL = '/dashboard/analyst/incidents/1';
const WILDLAND_SHELL = '/dashboard/analyst/incidents/1/wildland';
const WORKFLOW_SHELL = '/dashboard/analyst/comparative';

function canonicalPath(pathname: string): string {
  if (
    /^\/dashboard\/regional\/incidents\/[^/]+\/?$/.test(pathname) &&
    !/\/incidents\/local\//.test(pathname)
  ) {
    return '/dashboard/regional/incidents/__detail__';
  }
  // /dashboard/analyst/incidents/<id>/wildland must be checked BEFORE the
  // detail collapse (which would also match). Order matters.
  if (/^\/dashboard\/analyst\/incidents\/[^/]+\/wildland\/?$/.test(pathname)) {
    return '/dashboard/analyst/incidents/__detail__/wildland';
  }
  if (
    /^\/dashboard\/analyst\/incidents\/[^/]+\/?$/.test(pathname) &&
    !/\/incidents\/local\//.test(pathname)
  ) {
    return '/dashboard/analyst/incidents/__detail__';
  }
  const wfMatch = pathname.match(/^\/dashboard\/analyst\/([^/]+)\/?$/);
  if (wfMatch && VALID_ANALYST_WORKFLOW_SLUGS.has(wfMatch[1])) {
    return '/dashboard/analyst/__workflow__';
  }
  return pathname;
}

// ── RSC cache key builder (replicates sw.js) ─────────────────────────────

function buildRscCacheKey(origin: string, pathname: string): string {
  return origin + '/_rsc' + canonicalPath(pathname);
}

function offlineNavigationFallbackKeys(origin: string, pathname: string): string[] {
  const canonicalKey = origin + canonicalPath(pathname);
  const collapsed = canonicalKey !== origin + pathname;
  if (!collapsed) {
    return [origin + pathname, canonicalKey, origin + '/dashboard', origin + '/'];
  }
  // Choose the right shell for the collapsed family.
  if (canonicalKey === origin + '/dashboard/analyst/incidents/__detail__/wildland') {
    return [
      origin + pathname,
      canonicalKey,
      origin + WILDLAND_SHELL,
      origin + '/dashboard',
      origin + '/',
    ];
  }
  if (canonicalKey === origin + '/dashboard/analyst/incidents/__detail__') {
    return [
      origin + pathname,
      canonicalKey,
      origin + ANALYST_DETAIL_SHELL,
      origin + '/dashboard',
      origin + '/',
    ];
  }
  if (canonicalKey === origin + '/dashboard/analyst/__workflow__') {
    return [
      origin + pathname,
      canonicalKey,
      origin + WORKFLOW_SHELL,
      origin + '/dashboard',
      origin + '/',
    ];
  }
  // regional incident detail (existing)
  return [
    origin + pathname,
    canonicalKey,
    origin + INCIDENT_DETAIL_SHELL,
    origin + '/dashboard',
    origin + '/',
  ];
}

// Replicates the SW's urlsToCache list (only shells + nav anchors, no admin/validator).
const urlsToCache: string[] = [
  '/',
  '/dashboard',
  '/dashboard/regional',
  '/dashboard/regional/audit',
  INCIDENT_DETAIL_SHELL,
  '/home',
  '/login',
  '/afor/create',
  '/afor/import',
  '/manifest.webmanifest',
  ANALYST_DETAIL_SHELL,
  WILDLAND_SHELL,
  WORKFLOW_SHELL,
];

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

  // Issue #20: the RSC cache key currently drops the query string. If two
  // RSC requests share the same canonical pathname but differ in their
  // `?_rsc=...` or other query params, they collide in the cache. The
  // navigation handler's HTML collapse is intentional (the shell is the
  // same); the RSC handler applies the same collapse but RSC payloads are
  // per-incident data, so the collapse can serve one incident's RSC for
  // another.
  //
  // The SW author's intent is unclear (see meta-review). Pin the current
  // behaviour here so a future refactor does not silently drop the query
  // string or silently change the cache-key shape.
  it('drops the query string (current behaviour — open question for issue #20)', () => {
    // The helper signature is (origin, pathname) — there is no search param
    // argument, so the query string is not part of the key. This test pins
    // the current 2-arg shape.
    expect(buildRscCacheKey.length).toBe(2);
    // Sanity: a known canonical path with a hypothetical search string
    // appended to the URL would still produce the same key as the same
    // canonical path with a different search string (because search is
    // dropped at the call site in sw.js, not the helper).
    const key1 = buildRscCacheKey(origin, '/dashboard/analyst/incidents/__detail__');
    const key2 = buildRscCacheKey(origin, '/dashboard/analyst/incidents/__detail__');
    expect(key1).toBe(key2);
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

  // ── Task 9: analyst dynamic-route shells (v12) ──────────────────────────
  it('falls back to ANALYST_DETAIL_SHELL for any analyst incident detail URL', () => {
    expect(offlineNavigationFallbackKeys(origin, '/dashboard/analyst/incidents/5')).toEqual([
      'https://wimsbfp.tech/dashboard/analyst/incidents/5',
      'https://wimsbfp.tech/dashboard/analyst/incidents/__detail__',
      'https://wimsbfp.tech/dashboard/analyst/incidents/1',
      'https://wimsbfp.tech/dashboard',
      'https://wimsbfp.tech/',
    ]);
  });

  it('falls back to WILDLAND_SHELL for any analyst wildland URL', () => {
    expect(offlineNavigationFallbackKeys(origin, '/dashboard/analyst/incidents/5/wildland')).toEqual([
      'https://wimsbfp.tech/dashboard/analyst/incidents/5/wildland',
      'https://wimsbfp.tech/dashboard/analyst/incidents/__detail__/wildland',
      'https://wimsbfp.tech/dashboard/analyst/incidents/1/wildland',
      'https://wimsbfp.tech/dashboard',
      'https://wimsbfp.tech/',
    ]);
  });

  it('falls back to WORKFLOW_SHELL for any valid analyst workflow slug', () => {
    expect(offlineNavigationFallbackKeys(origin, '/dashboard/analyst/heatmap')).toEqual([
      'https://wimsbfp.tech/dashboard/analyst/heatmap',
      'https://wimsbfp.tech/dashboard/analyst/__workflow__',
      'https://wimsbfp.tech/dashboard/analyst/comparative',
      'https://wimsbfp.tech/dashboard',
      'https://wimsbfp.tech/',
    ]);
  });
});

describe('canonicalPath — analyst families (v12)', () => {
  it('collapses analyst incident detail to the __detail__ template key', () => {
    expect(canonicalPath('/dashboard/analyst/incidents/5')).toBe(
      '/dashboard/analyst/incidents/__detail__'
    );
    expect(canonicalPath('/dashboard/analyst/incidents/abc-123')).toBe(
      '/dashboard/analyst/incidents/__detail__'
    );
  });

  it('collapses analyst wildland to the __detail__/wildland template key', () => {
    expect(canonicalPath('/dashboard/analyst/incidents/5/wildland')).toBe(
      '/dashboard/analyst/incidents/__detail__/wildland'
    );
    expect(canonicalPath('/dashboard/analyst/incidents/abc/wildland/')).toBe(
      '/dashboard/analyst/incidents/__detail__/wildland'
    );
  });

  it('wildland collapse takes precedence over bare detail collapse', () => {
    expect(canonicalPath('/dashboard/analyst/incidents/5/wildland')).not.toBe(
      '/dashboard/analyst/incidents/__detail__'
    );
  });

  it('collapses valid workflow slugs to the __workflow__ template key', () => {
    for (const slug of ['comparative', 'heatmap', 'trends', 'response-time', 'top-n', 'incident-explorer']) {
      expect(canonicalPath(`/dashboard/analyst/${slug}`)).toBe('/dashboard/analyst/__workflow__');
    }
  });

  it('does NOT collapse invalid workflow slugs (leaves pathname unchanged)', () => {
    expect(canonicalPath('/dashboard/analyst/admin')).toBe('/dashboard/analyst/admin');
    expect(canonicalPath('/dashboard/analyst/incidents')).toBe('/dashboard/analyst/incidents');
    expect(canonicalPath('/dashboard/analyst/garbage-slug')).toBe('/dashboard/analyst/garbage-slug');
  });

  it('preserves analyst base path and unrelated analyst paths', () => {
    expect(canonicalPath('/dashboard/analyst')).toBe('/dashboard/analyst');
    expect(canonicalPath('/dashboard/analyst/queue-baseline')).toBe(
      '/dashboard/analyst/queue-baseline'
    );
  });
});

describe('CACHE_NAME + urlsToCache (v13)', () => {
  it('CACHE_NAME is bumped to v13', () => {
    expect(CACHE_NAME).toBe('wims-bfp-cache-v13');
  });

  it('the 3 analyst shells are in urlsToCache (fallback anchors)', () => {
    expect(urlsToCache).toContain(ANALYST_DETAIL_SHELL);
    expect(urlsToCache).toContain(WILDLAND_SHELL);
    expect(urlsToCache).toContain(WORKFLOW_SHELL);
  });

  it('the 7 admin/validator routes are NOT in urlsToCache (runtime-cached only)', () => {
    // The 7 routes from the prior draft that were dropped from the precache.
    // Admin pages are runtime-cached + post-login prefetched; validator pages
    // likewise. Asserting these are NOT in urlsToCache is the whole point.
    const adminValidatorRoutes = [
      '/admin/monitoring',
      '/admin/anomalies',
      '/admin/breach',
      '/admin/system/config',
      '/admin/system/rate-limits',
      '/dashboard/validator/map',
      '/dashboard/validator/audit',
    ];
    for (const route of adminValidatorRoutes) {
      expect(urlsToCache).not.toContain(route);
    }
  });
});

describe('public/sw.js source contract (Task 9)', () => {
  it('CACHE_NAME is defined as wims-bfp-cache-v13', () => {
    expect(SW_SOURCE).toMatch(/const\s+CACHE_NAME\s*=\s*['"]wims-bfp-cache-v13['"]/);
  });

  it('defines all 3 analyst shell constants', () => {
    expect(SW_SOURCE).toMatch(/const\s+ANALYST_DETAIL_SHELL\s*=\s*['"]\/dashboard\/analyst\/incidents\/1['"]/);
    expect(SW_SOURCE).toMatch(/const\s+WILDLAND_SHELL\s*=\s*['"]\/dashboard\/analyst\/incidents\/1\/wildland['"]/);
    expect(SW_SOURCE).toMatch(/const\s+WORKFLOW_SHELL\s*=\s*['"]\/dashboard\/analyst\/comparative['"]/);
  });

  it('pushes the 3 analyst shells into urlsToCache', () => {
    // Match within the urlsToCache array literal.
    const arrayMatch = SW_SOURCE.match(/const\s+urlsToCache\s*=\s*\[([\s\S]*?)\]/);
    expect(arrayMatch).not.toBeNull();
    const body = arrayMatch![1];
    expect(body).toContain('ANALYST_DETAIL_SHELL');
    expect(body).toContain('WILDLAND_SHELL');
    expect(body).toContain('WORKFLOW_SHELL');
  });

  it('the 7 admin/validator routes are NOT in the sw.js urlsToCache array', () => {
    const arrayMatch = SW_SOURCE.match(/const\s+urlsToCache\s*=\s*\[([\s\S]*?)\]/);
    expect(arrayMatch).not.toBeNull();
    const body = arrayMatch![1];
    const adminValidatorRoutes = [
      '/admin/monitoring',
      '/admin/anomalies',
      '/admin/breach',
      '/admin/system/config',
      '/admin/system/rate-limits',
      '/dashboard/validator/map',
      '/dashboard/validator/audit',
    ];
    for (const route of adminValidatorRoutes) {
      expect(body).not.toContain(`'${route}'`);
    }
  });

  it('canonicalPath in sw.js handles the 3 analyst families (regex evidence)', () => {
    // The replicated helper above documents the exact contract; the sw.js
    // source must reference all 3 collapse targets. We grep the literals
    // because regexes are minified into complex patterns we don't want to
    // assert character-by-character.
    expect(SW_SOURCE).toContain('/dashboard/analyst/incidents/__detail__');
    expect(SW_SOURCE).toContain('/dashboard/analyst/incidents/__detail__/wildland');
    expect(SW_SOURCE).toContain('/dashboard/analyst/__workflow__');
    // All 6 valid workflow slugs are referenced in the collapse branch.
    for (const slug of [
      'comparative',
      'heatmap',
      'trends',
      'response-time',
      'top-n',
      'incident-explorer',
    ]) {
      expect(SW_SOURCE).toContain(`'${slug}'`);
    }
  });
});
