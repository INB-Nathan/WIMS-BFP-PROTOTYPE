/**
 * Service Worker registration + Background Sync integration (FR-3D).
 *
 * Registers sw.js and provides registerBackgroundSync() to queue
 * a 'sync-pending-incidents' sync event after offline queue operations.
 *
 * Falls back gracefully if Background Sync API is unsupported.
 */

const SW_PATH = '/sw.js';
const SYNC_TAG = 'sync-pending-incidents';

let swRegistration: ServiceWorkerRegistration | null = null;

/**
 * Register the service worker. Call once on app mount.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    console.info('[SW] Service Worker not supported');
    return null;
  }

  try {
    swRegistration = await navigator.serviceWorker.register(SW_PATH);
    console.info('[SW] Registered:', swRegistration.scope);
    return swRegistration;
  } catch (err) {
    console.warn('[SW] Registration failed:', err);
    return null;
  }
}

/**
 * Register a Background Sync event for pending incidents.
 *
 * If the Background Sync API is available, the SW will retry
 * syncing when connectivity restores (even if the tab is closed).
 *
 * If unsupported, returns false — caller should rely on app-level auto-sync.
 */
export async function registerBackgroundSync(): Promise<boolean> {
  if (!swRegistration) {
    swRegistration = await navigator.serviceWorker.ready;
  }

  if (!swRegistration || !('sync' in swRegistration)) {
    console.info('[SW] Background Sync API not supported — using app-level sync');
    return false;
  }

  try {
    // Background Sync API is experimental — not in standard TS DOM types.
    // The 'sync' in check above confirms the property exists at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (swRegistration as any).sync.register(SYNC_TAG);
    console.info('[SW] Background sync registered:', SYNC_TAG);
    return true;
  } catch (err) {
    console.warn('[SW] Background sync registration failed:', err);
    return false;
  }
}

/**
 * Get the current service worker registration (or null).
 */
export function getRegistration(): ServiceWorkerRegistration | null {
  return swRegistration;
}
