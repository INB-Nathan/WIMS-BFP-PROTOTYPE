/**
 * Service Worker for WIMS-BFP PWA.
 *
 * - Cache-first for static assets (skip /api/ and /auth/)
 * - Navigation requests fall back to the cached app shell when offline
 * - Background Sync notifies open clients to run the authoritative
 *   app-level sync (syncEngine.ts). The SW cannot refresh the HttpOnly
 *   auth cookie or resolve the create→submit dependency chain itself, so
 *   it delegates to the page rather than POSTing directly.
 */

const CACHE_NAME = 'wims-bfp-cache-v12';
// Separate long-lived cache for map tiles so they survive main-cache evictions.
const TILE_CACHE_NAME = 'wims-tiles-v1';
const SYNC_TAG = 'sync-pending-incidents';
const APP_SHELL = '/dashboard';
const INCIDENT_DETAIL_SHELL = '/dashboard/regional/incidents/1';
// Analyst fallback shells. Mirrors the existing INCIDENT_DETAIL_SHELL pattern:
// one canonical HTML page per dynamic route family, precached so the
// 'use client' page mounts offline and the offline wrappers can read
// IndexedDB. Not the same as hardcoding role pages — admin/validator pages
// are runtime-cached + post-login role prefetched; the analyst shells are
// fallback anchors only.
const ANALYST_DETAIL_SHELL = '/dashboard/analyst/incidents/1';
const WILDLAND_SHELL = '/dashboard/analyst/incidents/1/wildland';
const WORKFLOW_SHELL = '/dashboard/analyst/comparative';

// Role-scoped post-login prefetch (Task 9, v12 — pushback P2). Pure runtime
// caching leaves a user who goes offline before first-visiting an admin/validator
// page with a blank page. Mitigation: after a successful login the app posts
// { type: 'PREFETCH_ROLE', role } to the SW; the SW fetch()es that role's
// route set and cache.put()s them. Routes already in the cache are skipped
// (cache.match before fetch). Best-effort — Promise.allSettled — so a failed
// prefetch never blocks login.
const ANALYST_WORKFLOW_SLUGS = [
  'comparative',
  'heatmap',
  'trends',
  'response-time',
  'top-n',
  'incident-explorer',
];

const ROLE_PREFETCH_ROUTES = {
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

const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WIMS-BFP Offline</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#f8fafc;color:#0f172a">
<main style="max-width:560px;margin:12vh auto;padding:24px">
<h1 style="font-size:24px;margin:0 0 12px">Offline content unavailable</h1>
<p style="line-height:1.6">This page or incident is not saved on this device. Reconnect to load it, or return to a dashboard you opened earlier.</p>
<a href="/dashboard" style="display:inline-block;margin-top:12px;color:#b91c1c;font-weight:700">Go to dashboard</a>
</main>
</body>
</html>`;

const urlsToCache = [
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
  // Analyst fallback shells (Task 9, v12). Admin/validator pages are NOT
  // precached — they are runtime-cached + post-login role prefetched.
  ANALYST_DETAIL_SHELL,
  WILDLAND_SHELL,
  WORKFLOW_SHELL,
];

// Dynamic incident-detail routes (/dashboard/regional/incidents/<id>) all render
// the SAME 'use client' page that reads the id from the URL and loads from
// IndexedDB. Collapsing them to one canonical cache key means visiting OR
// prefetching any single incident online makes EVERY incident — including
// offline-created local UUIDs that were never fetched from the server — viewable
// offline. The legacy /incidents/local/<id> route is excluded (it's a redirect shim).
//
// Task 9 (v12) adds 3 analyst dynamic-route families that mirror the same
// collapse pattern so a single online visit/prefetch seeds offline coverage
// for every incident/wildland/workflow URL in that family.
const VALID_ANALYST_WORKFLOW_SLUGS = new Set([
  'comparative',
  'heatmap',
  'trends',
  'response-time',
  'top-n',
  'incident-explorer',
]);

function canonicalPath(pathname) {
  if (
    /^\/dashboard\/regional\/incidents\/[^/]+\/?$/.test(pathname) &&
    !/\/incidents\/local\//.test(pathname)
  ) {
    return '/dashboard/regional/incidents/__detail__';
  }
  // /dashboard/analyst/incidents/<id>/wildland MUST be checked BEFORE the
  // bare detail collapse (which would otherwise also match and lose the
  // /wildland suffix).
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

// --- Install ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll fails the whole install if any URL 404s; tolerate individual misses.
      return Promise.allSettled(urlsToCache.map((u) => cache.add(u)));
    })
  );
  self.skipWaiting();
});

// --- Activate ---
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME, TILE_CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// --- Fetch ---
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = request.url;

  // Never intercept API or auth routes.
  if (url.includes('/api/') || url.includes('/auth/')) {
    return;
  }

  // ── Map tiles (OpenStreetMap) ─────────────────────────────────────────────
  // Cache-first with a dedicated tile cache so tiles survive main-cache evictions.
  // Falls back to a transparent placeholder on complete offline tile miss.
  // Leaflet marker images are now self-hosted in /leaflet/ so no CDN fetch needed.
  if (url.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok || response.type === 'opaque') {
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          // 1×1 transparent GIF placeholder so Leaflet doesn't show broken tiles.
          return new Response(
            new Uint8Array([71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,255,255,255,33,249,4,0,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59]),
            { headers: { 'Content-Type': 'image/gif' } }
          );
        }
      })
    );
    return;
  }

  // ── Next.js RSC payloads (client-side navigation) ────────────────────────
  // Next.js App Router fetches an RSC payload on every client-side navigation.
  // These are NOT `mode: 'navigate'` — they are regular fetch() calls with an
  // `RSC: 1` header. Without caching them the router-cache (5-min TTL) expiry
  // makes offline navigation fail even when all JS chunks are cached.
  // Store under the path-only key with an 'rsc:' prefix so RSC entries never
  // collide with the HTML page entries stored by the navigation handler (both
  // would otherwise be keyed by the same URL, causing cache.match() on offline
  // navigation to return RSC flight data instead of the HTML shell).
  const requestUrl = new URL(url);
  const isRsc =
    requestUrl.origin === self.location.origin &&
    request.method === 'GET' &&
    (request.headers.get('RSC') === '1' || requestUrl.searchParams.has('_rsc')) &&
    !requestUrl.pathname.startsWith('/api/') &&
    !requestUrl.pathname.startsWith('/auth/');

  if (isRsc) {
    // Cache key must be a valid HTTP URL — the 'rsc:' prefix scheme is rejected
    // by the Cache API. Use a synthetic same-origin path instead.
    //
    // Issue #20 (open question): this key drops the query string entirely.
    // Two RSC requests that share `canonicalPath(pathname)` but differ in
    // `?_rsc=...` or other query params will collide in the cache. For the
    // canonical collapse pattern (one shell per URL family) this is OK, but
    // for incident-detail RSC payloads (where the data is per-incident) the
    // collapse can serve one incident's RSC for another. Confirm with the
    // Next.js team whether any served RSC payloads vary on query before
    // changing this. The pinned sync-guard test
    // (`__tests__/sw-cache-key.test.ts > drops the query string (current
    // behaviour — open question for issue #20)`) documents the current
    // 2-arg helper shape so this is not changed silently.
    const cacheKey = requestUrl.origin + '/_rsc' + canonicalPath(requestUrl.pathname);
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(cacheKey, response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const hit = await cache.match(cacheKey);
          if (hit) return hit;
          // No cached RSC for this route. Returning '{}' would feed the App Router
          // invalid flight data and crash the page. Returning a network error makes
          // Next.js fall back to a hard navigation, which the navigate handler below
          // serves from the cached page/app shell so in-app offline guards render.
          return Response.error();
        })
    );
    return;
  }

  // ── Full-page navigation ─────────────────────────────────────────────────
  if (request.mode === 'navigate') {
    const canonicalKey = requestUrl.origin + canonicalPath(requestUrl.pathname);
    event.respondWith(
      fetch(request).then(async (response) => {
        const cache = await caches.open(CACHE_NAME);
        if (response.ok && request.method === 'GET') {
          cache.put(request, response.clone());
          // Also store under the canonical key so any incident-detail page load
          // is reusable as the offline shell for every incident-detail URL.
          if (canonicalKey !== requestUrl.origin + requestUrl.pathname) {
            cache.put(canonicalKey, response.clone());
          }
        }
        return response;
      }).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const isCanonicalDetail = canonicalKey !== requestUrl.origin + requestUrl.pathname;
        // Pick the right shell for the collapsed family. The regional
        // detail-shell match is the original; the 3 analyst shells mirror it
        // for the v12 canonical-path additions.
        let detailShell;
        if (canonicalKey === requestUrl.origin + '/dashboard/analyst/incidents/__detail__/wildland') {
          detailShell = await cache.match(requestUrl.origin + WILDLAND_SHELL);
        } else if (canonicalKey === requestUrl.origin + '/dashboard/analyst/incidents/__detail__') {
          detailShell = await cache.match(requestUrl.origin + ANALYST_DETAIL_SHELL);
        } else if (canonicalKey === requestUrl.origin + '/dashboard/analyst/__workflow__') {
          detailShell = await cache.match(requestUrl.origin + WORKFLOW_SHELL);
        } else if (isCanonicalDetail) {
          detailShell = await cache.match(requestUrl.origin + INCIDENT_DETAIL_SHELL);
        }
        return (
          (await cache.match(request)) ||
          (await cache.match(canonicalKey)) ||
          detailShell ||
          (await cache.match(APP_SHELL)) ||
          (await cache.match('/')) ||
          new Response(OFFLINE_HTML, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        );
      })
    );
    return;
  }

  // ── Static assets (JS chunks, CSS, images, fonts) ───────────────────────
  // Skip cross-origin requests — let the browser handle them natively.
  // SW fetch() must satisfy connect-src CSP; intercepting fonts.googleapis.com
  // or other external origins triggers CSP violations.
  if (requestUrl.origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    caches.match(request).then((response) => {
      if (response) return response;
      return fetch(request).then(async (networkResponse) => {
        if (
          request.method === 'GET' &&
          networkResponse.ok &&
          requestUrl.origin === self.location.origin &&
          (requestUrl.pathname.startsWith('/_next/static/') ||
            request.destination === 'script' ||
            request.destination === 'style' ||
            request.destination === 'image' ||
            request.destination === 'font')
        ) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      });
    })
  );
});

// --- Message handling: clear authenticated app cache on logout ---
// AuthContext posts { type: 'clear-auth-cache' } during logout so cached
// RSC payloads, navigation pages, and authenticated route content are
// evicted for shared-device privacy. The long-lived tile cache is preserved.
//
// Task 9 (v12) adds a { type: 'PREFETCH_ROLE', role } branch for post-login
// role-scoped prefetch (see ROLE_PREFETCH_ROUTES above).
self.addEventListener('message', (event) => {
  // Defence-in-depth: the SW is shared across all same-origin scripts, so an
  // XSS payload or compromised dependency can postMessage to it. Reject any
  // message whose origin is not our own, or whose source is not a controlled
  // Client (a ServiceWorker sender is not a Client; instanceof rejects it).
  // Issue #3 (security H1).
  if (event.origin !== self.location.origin) return;
  if (!event.source || !(event.source instanceof Client)) return;
  const data = event.data;
  if (!data || typeof data.type !== 'string') return;
  if (data.type === 'clear-auth-cache') {
    event.waitUntil(
      caches.delete(CACHE_NAME)
    );
    return;
  }
  if (data.type === 'PREFETCH_ROLE') {
    event.waitUntil(prefetchRole(data.role));
    return;
  }
});

/**
 * Best-effort prefetch of the active role's route set into CACHE_NAME.
 * - Skips routes already in the cache (cache.match before fetch).
 * - Never rejects (Promise.allSettled) so a failed prefetch does not block login.
 * - Unknown roles are a no-op.
 */
async function prefetchRole(role) {
  const routes = ROLE_PREFETCH_ROUTES[role];
  if (!routes || routes.length === 0) return;
  const cache = await caches.open(CACHE_NAME);
  const origin = self.location.origin;
  await Promise.allSettled(
    routes.map(async (route) => {
      const requestUrl = origin + route;
      // Skip routes already in the cache (e.g. precached shells).
      const existing = await cache.match(requestUrl);
      if (existing) return;
      try {
        const response = await fetch(requestUrl, { credentials: 'same-origin' });
        if (response && (response.ok || response.type === 'opaque')) {
          await cache.put(requestUrl, response.clone());
        }
      } catch {
        // Best-effort: swallow network errors so a single failed prefetch
        // does not poison the whole batch.
      }
    })
  );
}

// --- Background Sync: delegate to open clients ---
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(notifyClientsToSync());
  }
});

/**
 * Ask every open client to run the app-level sync. The page owns auth-token
 * refresh and the sequential create→submit replay, so the SW just nudges it.
 */
async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach((client) => {
    client.postMessage({ type: 'run-sync', tag: SYNC_TAG });
  });
}
