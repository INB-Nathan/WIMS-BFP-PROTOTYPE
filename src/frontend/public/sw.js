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

const CACHE_NAME = 'wims-bfp-cache-v3';
const SYNC_TAG = 'sync-pending-incidents';
const APP_SHELL = '/dashboard';

const urlsToCache = [
  '/',
  '/dashboard',
  '/login',
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
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (
          (await cache.match(request)) ||
          (await cache.match(APP_SHELL)) ||
          (await cache.match('/')) ||
          Response.error()
        );
      })
    );
    return;
  }

  // Static assets: cache-first.
  event.respondWith(
    caches.match(request).then((response) => response || fetch(request))
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
