/**
 * Offline-mode localStorage flag helpers.
 *
 * Extracted from offlineEnable.ts to avoid a circular import:
 *   offlineStore.ts → offlineEnable.ts → api/offlineRegional.ts → offlineStore.ts
 *
 * These functions have no imports and are safe to call from any library code.
 */

const OFFLINE_ENABLED_KEY = 'wims:offline_enabled';
const OFFLINE_BANNER_DISMISSED_KEY = 'wims:offline_banner_dismissed';

export function isOfflineModeEnabled(): boolean {
  try { return localStorage.getItem(OFFLINE_ENABLED_KEY) === 'true'; } catch { return false; }
}

export function markOfflineModeEnabled(): void {
  try { localStorage.setItem(OFFLINE_ENABLED_KEY, 'true'); } catch { /* private mode */ }
}

export function clearOfflineModeEnabled(): void {
  try {
    localStorage.removeItem(OFFLINE_ENABLED_KEY);
    localStorage.removeItem(OFFLINE_BANNER_DISMISSED_KEY);
  } catch { /* private mode */ }
}

export function isOfflineBannerDismissed(): boolean {
  try { return localStorage.getItem(OFFLINE_BANNER_DISMISSED_KEY) === 'true'; } catch { return false; }
}

export function dismissOfflineBanner(): void {
  try { localStorage.setItem(OFFLINE_BANNER_DISMISSED_KEY, 'true'); } catch { /* private mode */ }
}
