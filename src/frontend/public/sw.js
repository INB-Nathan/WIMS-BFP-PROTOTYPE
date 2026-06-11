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

const CACHE_NAME = 'wims-bfp-cache-v5';
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
  '/login',
  '/afor/create',
  '/afor/import',
  '/manifest.webmanifest',
];

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
  const cacheWhitelist = [CACHE_NAME];
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

  // Never intercept API or auth routes — these must always hit the network so the
  // app's own offline-aware wrappers (offlineRegional.ts) decide what to do.
  if (url.includes('/api/') || url.includes('/auth/')) {
    return;
  }

  // Navigation requests: try the network first, fall back to the cached shell when
  // offline so the encoder still lands on a usable page instead of a browser error.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(async (response) => {
        const cache = await caches.open(CACHE_NAME);
        if (response.ok && request.method === 'GET') {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (
          (await cache.match(request)) ||
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

  // Static assets: cache-first, then store successful same-origin GETs for later
  // offline navigations to already-visited Next.js pages.
  event.respondWith(
    caches.match(request).then((response) => {
      if (response) return response;
      return fetch(request).then(async (networkResponse) => {
        const requestUrl = new URL(request.url);
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
