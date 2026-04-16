/**
 * Service Worker for WIMS-BFP PWA.
 *
 * - Cache-first for static assets (skip /api/ and /auth/)
 * - Background Sync for pending incidents (FR-3D)
 */

const CACHE_NAME = 'wims-bfp-cache-v2';
const SYNC_TAG = 'sync-pending-incidents';
const DB_NAME = 'wims-bfp-db';
const STORE_NAME = 'incident-queue';
const SYNC_ENDPOINT = '/api/v1/public/report';

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
      return cache.addAll(urlsToCache);
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

// --- Fetch: cache-first for static, pass-through for API ---
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Never intercept API or auth routes
  if (url.includes('/api/') || url.includes('/auth/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }
      return fetch(event.request);
    })
  );
});

// --- Background Sync: process pending incidents ---
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(syncPendingFromSW());
  }
});

/**
 * Read pending incidents from IndexedDB and POST each to the API.
 * Mirrors the logic in syncEngine.ts but runs in SW context.
 */
async function syncPendingFromSW() {
  const db = await openDB();
  if (!db) return;

  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const all = await getAllFromStore(store);
  const pending = all.filter((item) => item.status === 'pending');

  for (const item of pending) {
    try {
      const response = await fetch(SYNC_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.payload),
      });

      if (response.ok) {
        // Mark synced
        const writeTx = db.transaction(STORE_NAME, 'readwrite');
        const writeStore = writeTx.objectStore(STORE_NAME);
        await writeStore.delete(item.id);
        await writeTx.complete;
      }
    } catch (err) {
      // Network error — leave pending for next sync event
      console.warn('[SW] Sync failed for item', item.id, err);
    }
  }

  // Notify clients of sync completion
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'sync-complete', tag: SYNC_TAG });
  });
}

/**
 * Minimal IndexedDB open for SW context.
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

/**
 * Get all records from an object store (SW-compatible, no idb library).
 */
function getAllFromStore(store) {
  return new Promise((resolve) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });
}
