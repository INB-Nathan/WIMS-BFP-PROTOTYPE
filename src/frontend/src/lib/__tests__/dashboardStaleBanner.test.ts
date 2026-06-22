/**
 * Sync-guard tests for the dashboard stale-cache banner (issue #18) and the
 * StaleCacheBanner JSDoc (issue #19).
 *
 * Issue #18: the dashboard reference-data useEffect handlers must capture
 * `r.cachedAt` and surface it via a StaleCacheBanner so a user working
 * offline for the 7-day reference TTL sees a "Showing cached data" notice.
 * The previous version silently ignored `r.fromCache` / `r.cachedAt`.
 *
 * Issue #19: the StaleCacheBanner contract — "render null when cachedAt is
 * missing" — was previously undocumented. The JSDoc + this test pin the
 * contract so a future refactor does not accidentally render the banner
 * with no data.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('Dashboard stale-cache banner (issue #18)', () => {
  const DASHBOARD = readFileSync(
    join(process.cwd(), 'src', 'app', 'dashboard', 'page.tsx'),
    'utf8',
  );

  it('imports StaleCacheBanner from the components barrel', () => {
    expect(DASHBOARD).toMatch(
      /import\s*\{[^}]*\bStaleCacheBanner\b[^}]*\}\s*from\s*['"]@\/components\/ui\/StaleCacheBanner['"]/,
    );
  });

  it('tracks the latest cachedAt across the three reference fetches', () => {
    // Each fetch must capture r.cachedAt into a refsCachedAt state setter.
    // Mirrors the admin monitoring page pattern.
    expect(DASHBOARD).toMatch(
      /fetchRegionsOfflineAware[\s\S]{0,200}setRefsCachedAt\(r\.cachedAt\)/,
    );
    expect(DASHBOARD).toMatch(
      /fetchProvincesOfflineAware[\s\S]{0,300}setRefsCachedAt\(r\.cachedAt\)/,
    );
    expect(DASHBOARD).toMatch(
      /fetchCitiesOfflineAware[\s\S]{0,300}setRefsCachedAt\(r\.cachedAt\)/,
    );
  });

  it('declares a refsCachedAt state', () => {
    expect(DASHBOARD).toMatch(
      /const\s*\[\s*refsCachedAt\s*,\s*setRefsCachedAt\s*\]\s*=\s*useState/,
    );
  });

  it('renders the StaleCacheBanner when refsCachedAt is set', () => {
    // The banner is conditional on refsCachedAt being truthy.
    expect(DASHBOARD).toMatch(
      /\{refsCachedAt\s*&&\s*<StaleCacheBanner\s+freshness=\{\{[^}]*cachedAt:\s*refsCachedAt/,
    );
  });
});

describe('StaleCacheBanner contract (issue #19)', () => {
  const BANNER = readFileSync(
    join(process.cwd(), 'src', 'components', 'ui', 'StaleCacheBanner.tsx'),
    'utf8',
  );

  it('documents the "render null when cachedAt is missing" contract', () => {
    expect(BANNER).toMatch(/JSDoc/);
    expect(BANNER).toMatch(/freshness\?:\s*\{\s*cachedAt\?:\s*number/);
  });

  it('preserves the render-null short-circuit', () => {
    expect(BANNER).toMatch(/if\s*\(\s*freshness\?\.cachedAt\s*==\s*null\s*\)\s*return\s+null/);
  });
});
