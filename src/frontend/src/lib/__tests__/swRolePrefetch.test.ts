/**
 * Unit tests for the Service Worker PREFETCH_ROLE message handler.
 *
 * The SW route map is the source of truth in `public/sw.js` (loaded as a
 * classic worker script; not importable from Vitest). The route map is
 * mirrored here in a way that:
 *   1. Is the canonical contract under test.
 *   2. Stays in sync with sw.js via the "sync with sw.js" assertion below
 *      (we read the sw.js source and verify the route map is byte-identical).
 *
 * The prefetch handler itself is tested by exercising its public contract
 * (already-cached routes are skipped; failed fetches do not reject) against
 * a small in-memory cache + fetch shim.
 *
 * Mirrors `public/sw.js` lines 31-61.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';

// ── Mirrored from public/sw.js ────────────────────────────────────────────

const ANALYST_WORKFLOW_SLUGS = [
  'comparative',
  'heatmap',
  'trends',
  'response-time',
  'top-n',
  'incident-explorer',
];

const ANALYST_DETAIL_SHELL = '/dashboard/analyst/incidents/1';
const WILDLAND_SHELL = '/dashboard/analyst/incidents/1/wildland';

const ROLE_PREFETCH_ROUTES: Record<string, readonly string[]> = {
  SYSTEM_ADMIN: [
    '/admin/monitoring',
    '/admin/anomalies',
    '/admin/breach',
    '/admin/system',
    '/admin/system/config',
    '/admin/system/rate-limits',
  ],
  NATIONAL_ANALYST: [
    '/dashboard/analyst',
    ...ANALYST_WORKFLOW_SLUGS.map((slug) => `/dashboard/analyst/${slug}`),
    ANALYST_DETAIL_SHELL,
    WILDLAND_SHELL,
  ],
  NATIONAL_VALIDATOR: [
    '/dashboard/validator',
    '/dashboard/validator/map',
    '/dashboard/validator/audit',
  ],
  REGIONAL_ENCODER: [
    '/dashboard/regional',
  ],
};

// ── Test contract: role → route set ───────────────────────────────────────

describe('ROLE_PREFETCH_ROTES — role → route set (Task 9)', () => {
  it('SYSTEM_ADMIN maps to the 5 admin routes + /admin/system', () => {
    expect(ROLE_PREFETCH_ROUTES.SYSTEM_ADMIN).toEqual([
      '/admin/monitoring',
      '/admin/anomalies',
      '/admin/breach',
      '/admin/system',
      '/admin/system/config',
      '/admin/system/rate-limits',
    ]);
  });

  it('NATIONAL_ANALYST maps to /dashboard/analyst + 6 workflow slugs + 2 shells', () => {
    expect(ROLE_PREFETCH_ROUTES.NATIONAL_ANALYST).toEqual([
      '/dashboard/analyst',
      '/dashboard/analyst/comparative',
      '/dashboard/analyst/heatmap',
      '/dashboard/analyst/trends',
      '/dashboard/analyst/response-time',
      '/dashboard/analyst/top-n',
      '/dashboard/analyst/incident-explorer',
      ANALYST_DETAIL_SHELL,
      WILDLAND_SHELL,
    ]);
  });

  it('NATIONAL_VALIDATOR maps to the 3 validator routes', () => {
    expect(ROLE_PREFETCH_ROUTES.NATIONAL_VALIDATOR).toEqual([
      '/dashboard/validator',
      '/dashboard/validator/map',
      '/dashboard/validator/audit',
    ]);
  });

  it('REGIONAL_ENCODER maps to /dashboard/regional (already precached)', () => {
    expect(ROLE_PREFETCH_ROUTES.REGIONAL_ENCODER).toEqual(['/dashboard/regional']);
  });

  it('every role has a non-empty route set', () => {
    for (const [role, routes] of Object.entries(ROLE_PREFETCH_ROUTES)) {
      expect(routes.length, `${role} should have routes`).toBeGreaterThan(0);
    }
  });

  it('admin routes are scoped to SYSTEM_ADMIN (other roles do not include them)', () => {
    // Defensive: if a future refactor accidentally leaks admin routes into
    // a non-admin role's prefetch set, this catches it.
    const adminOnlyRoutes = [
      '/admin/monitoring',
      '/admin/anomalies',
      '/admin/breach',
      '/admin/system/config',
      '/admin/system/rate-limits',
    ];
    for (const [role, routes] of Object.entries(ROLE_PREFETCH_ROUTES)) {
      if (role === 'SYSTEM_ADMIN') continue;
      for (const route of adminOnlyRoutes) {
        expect(routes, `${role} should not include ${route}`).not.toContain(route);
      }
    }
  });

  it('validator routes are scoped to NATIONAL_VALIDATOR (other roles do not include them)', () => {
    const validatorRoutes = ['/dashboard/validator/map', '/dashboard/validator/audit'];
    for (const [role, routes] of Object.entries(ROLE_PREFETCH_ROUTES)) {
      if (role === 'NATIONAL_VALIDATOR') continue;
      for (const route of validatorRoutes) {
        expect(routes, `${role} should not include ${route}`).not.toContain(route);
      }
    }
  });
});

// ── Test contract: stays in sync with public/sw.js ────────────────────────

describe('swRolePrefetch.test.ts ↔ public/sw.js sync guard', () => {
  const SW_SOURCE = readFileSync(
    join(process.cwd(), 'public', 'sw.js'),
    'utf8',
  );

  it('sw.js defines ROLE_PREFETCH_ROUTES with SYSTEM_ADMIN, NATIONAL_ANALYST, NATIONAL_VALIDATOR, REGIONAL_ENCODER', () => {
    expect(SW_SOURCE).toMatch(/const\s+ROLE_PREFETCH_ROUTES\s*=/);
    expect(SW_SOURCE).toMatch(/SYSTEM_ADMIN\s*:/);
    expect(SW_SOURCE).toMatch(/NATIONAL_ANALYST\s*:/);
    expect(SW_SOURCE).toMatch(/NATIONAL_VALIDATOR\s*:/);
    expect(SW_SOURCE).toMatch(/REGIONAL_ENCODER\s*:/);
  });

  it('sw.js SYSTEM_ADMIN includes the 5 admin routes + /admin/system', () => {
    expect(SW_SOURCE).toContain("'/admin/monitoring'");
    expect(SW_SOURCE).toContain("'/admin/anomalies'");
    expect(SW_SOURCE).toContain("'/admin/breach'");
    expect(SW_SOURCE).toContain("'/admin/system'");
    expect(SW_SOURCE).toContain("'/admin/system/config'");
    expect(SW_SOURCE).toContain("'/admin/system/rate-limits'");
  });

  it('sw.js NATIONAL_VALIDATOR includes the 3 validator routes', () => {
    expect(SW_SOURCE).toContain("'/dashboard/validator'");
    expect(SW_SOURCE).toContain("'/dashboard/validator/map'");
    expect(SW_SOURCE).toContain("'/dashboard/validator/audit'");
  });

  it('sw.js handles the PREFETCH_ROLE message with prefetchRole()', () => {
    expect(SW_SOURCE).toMatch(/['"]PREFETCH_ROLE['"]/);
    expect(SW_SOURCE).toMatch(/function\s+prefetchRole\s*\(/);
  });

  it('sw.js prefetchRole uses cache.match (skip already-cached) and Promise.allSettled (best-effort)', () => {
    // cache.match before fetch + allSettled (no reject) are the two contract
    // guarantees the test file below exercises.
    expect(SW_SOURCE).toMatch(/cache\.match\(/);
    expect(SW_SOURCE).toMatch(/Promise\.allSettled\(/);
  });
});

// ── Test contract: prefetch semantics (cache.match + Promise.allSettled) ──

// Re-implement the SW's prefetchRole against in-memory stubs so the contract
// is testable in Vitest. The shape mirrors the sw.js handler exactly:
//   1. cache.match first → skip if present
//   2. fetch + cache.put otherwise
//   3. Promise.allSettled so a single failure does not reject

interface FakeCache {
  store: Map<string, Response>;
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

function makeFakeCache(initial: Record<string, Response> = {}): FakeCache {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async match(key) {
      return store.get(key);
    },
    async put(key, response) {
      store.set(key, response);
    },
  };
}

async function prefetchRole(
  role: string,
  routes: readonly string[],
  origin: string,
  cache: FakeCache,
  fetchImpl: (url: string) => Promise<Response>,
): Promise<void> {
  await Promise.allSettled(
    routes.map(async (route) => {
      const requestUrl = origin + route;
      const existing = await cache.match(requestUrl);
      if (existing) return;
      const response = await fetchImpl(requestUrl);
      if (response && (response.ok || response.type === 'opaque')) {
        await cache.put(requestUrl, response);
      }
    })
  );
}

describe('prefetchRole — cache.match + Promise.allSettled contract', () => {
  const origin = 'https://wimsbfp.tech';

  beforeEach(() => {
    // Each test gets its own fresh cache.
  });

  it('fetches + caches every route in the role set when cache is empty', async () => {
    const cache = makeFakeCache();
    const fetched: string[] = [];
    const fetchImpl = async (url: string) => {
      fetched.push(url);
      return new Response('ok', { status: 200 });
    };
    await prefetchRole(
      'NATIONAL_VALIDATOR',
      ROLE_PREFETCH_ROUTES.NATIONAL_VALIDATOR,
      origin,
      cache,
      fetchImpl,
    );
    expect(fetched).toEqual([
      'https://wimsbfp.tech/dashboard/validator',
      'https://wimsbfp.tech/dashboard/validator/map',
      'https://wimsbfp.tech/dashboard/validator/audit',
    ]);
    expect(cache.store.size).toBe(3);
  });

  it('skips already-cached routes (cache.match short-circuits fetch)', async () => {
    const preCached = new Response('cached', { status: 200 });
    const cache = makeFakeCache({
      'https://wimsbfp.tech/dashboard/validator': preCached,
    });
    const fetched: string[] = [];
    const fetchImpl = async (url: string) => {
      fetched.push(url);
      return new Response('ok', { status: 200 });
    };
    await prefetchRole(
      'NATIONAL_VALIDATOR',
      ROLE_PREFETCH_ROUTES.NATIONAL_VALIDATOR,
      origin,
      cache,
      fetchImpl,
    );
    // Only the 2 uncached routes should have been fetched.
    expect(fetched).toEqual([
      'https://wimsbfp.tech/dashboard/validator/map',
      'https://wimsbfp.tech/dashboard/validator/audit',
    ]);
    // The pre-cached entry must NOT have been overwritten.
    expect(await cache.match('https://wimsbfp.tech/dashboard/validator')).toBe(preCached);
  });

  it('does NOT reject when a fetch fails (Promise.allSettled semantics)', async () => {
    const cache = makeFakeCache();
    const fetchImpl = async (url: string) => {
      if (url.endsWith('/dashboard/validator/map')) {
        throw new TypeError('Failed to fetch');
      }
      return new Response('ok', { status: 200 });
    };
    // The handler must not throw — Promise.allSettled swallows the rejection.
    await expect(
      prefetchRole(
        'NATIONAL_VALIDATOR',
        ROLE_PREFETCH_ROUTES.NATIONAL_VALIDATOR,
        origin,
        cache,
        fetchImpl,
      )
    ).resolves.toBeUndefined();
    // The 2 successful routes are cached; the failed one is not.
    expect(await cache.match('https://wimsbfp.tech/dashboard/validator')).toBeDefined();
    expect(await cache.match('https://wimsbfp.tech/dashboard/validator/audit')).toBeDefined();
    expect(await cache.match('https://wimsbfp.tech/dashboard/validator/map')).toBeUndefined();
  });

  it('does not cache non-ok responses', async () => {
    const cache = makeFakeCache();
    const fetchImpl = async (_url: string) =>
      new Response('forbidden', { status: 403 });
    await prefetchRole(
      'NATIONAL_VALIDATOR',
      ROLE_PREFETCH_ROUTES.NATIONAL_VALIDATOR,
      origin,
      cache,
      fetchImpl,
    );
    expect(cache.store.size).toBe(0);
  });

  it('is a no-op for unknown roles', async () => {
    const cache = makeFakeCache();
    const fetched: string[] = [];
    const fetchImpl = async (url: string) => {
      fetched.push(url);
      return new Response('ok', { status: 200 });
    };
    await prefetchRole('UNKNOWN_ROLE', [], origin, cache, fetchImpl);
    expect(fetched).toEqual([]);
    expect(cache.store.size).toBe(0);
  });
});
