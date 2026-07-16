/**
 * Device token hash — persistent storage for the X-Device-Token-Hash header.
 *
 * The backend middleware emits this header on every authenticated response
 * (src/backend/middleware/device_token.py:190). We capture it here and store
 * it in localStorage to make it available for offline continuity and device-
 * level correlation (Wayfinder issue #571).
 *
 * Storage boundary: localStorage, same as the existing civilian device ID
 * (wims_civilian_device_id in usePublicAutoSync.ts). The token hash is a
 * correlation identifier, not direct PII.
 */
import { onResponseHeader } from './api/transport';

const STORAGE_KEY = 'wims_device_token_hash';

/** Read the persisted device token hash, or null if not set or unavailable. */
export function getStoredDeviceTokenHash(): string | null {
  try {
    return typeof localStorage !== 'undefined'
      ? localStorage.getItem(STORAGE_KEY)
      : null;
  } catch {
    return null;
  }
}

/** Persist a device token hash to localStorage. */
export function setStoredDeviceTokenHash(hash: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, hash);
  } catch {
    // storage quota, private browsing, or SSR — degrade gracefully
  }
}

// ── Auto-wire: capture X-Device-Token-Hash from every API response ─────────
// The backend emits this header on every response. By registering a transport-
// level observer, the frontend automatically persists the current device token
// hash for any component that needs it (admin block/unblock flows, offline
// correlation, etc.).
if (typeof window !== 'undefined') {
  onResponseHeader((headers) => {
    const hash = headers.get('X-Device-Token-Hash');
    if (hash) {
      setStoredDeviceTokenHash(hash);
    }
  });
}
