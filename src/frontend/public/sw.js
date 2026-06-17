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

const CACHE_NAME = 'wims-bfp-cache-v9';
// Separate long-lived cache for map tiles so they survive main-cache evictions.
const TILE_CACHE_NAME = 'wims-tiles-v1';
const SYNC_TAG = 'sync-pending-incidents';
const APP_SHELL = '/dashboard';
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
  '/home',
  '/login',
  '/afor/create',
  '/afor/import',
  '/manifest.webmanifest',
];

// Dynamic incident-detail routes (/dashboard/regional/incidents/<id>) all render
// the SAME 'use client' page that reads the id from the URL and loads from
// IndexedDB. Collapsing them to one canonical cache key means visiting OR
// prefetching any single incident online makes EVERY incident — including
// offline-created local UUIDs that were never fetched from the server — viewable
// offline. The legacy /incidents/local/<id> route is excluded (it's a redirect shim).
function canonicalPath(pathname) {
  if (
    /^\/dashboard\/regional\/incidents\/[^/]+\/?$/.test(pathname) &&
    !/\/incidents\/local\//.test(pathname)
  ) {
    return '/dashboard/regional/incidents/__detail__';
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
        return (
          (await cache.match(request)) ||
          (await cache.match(canonicalKey)) ||
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
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'clear-auth-cache') {
    event.waitUntil(
      caches.delete(CACHE_NAME)
    );
  }
});

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
