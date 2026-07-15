/**
 * Silent JWT refresh helper.
 *
 * Strategy:
 *  1. If the Web Locks API is available, acquire a named lock so only ONE tab
 *     refreshes at a time (prevents refreshTokenMaxReuse:0 race conditions).
 *  2. If navigator.locks is missing (older browsers, embedded webviews, jsdom
 *     test environments), fall back to a direct fetch — the lock's purpose is
 *     purely cross-tab synchronisation, so the refresh itself is still safe.
 *
 * Returns a typed result so callers can distinguish a network error (the user
 * is offline / connectivity is shaky) from a genuine auth failure (the refresh
 * token itself is expired or revoked). The sync engine maps these to different
 * abort reasons so "session expired" is not shown when the device is simply
 * still coming back online.
 */

const REFRESH_ENDPOINT = '/api/auth/refresh';
// Hang guard (issue #604 / map #603): a slow or unreachable backend must not
// block the silent refresh — and therefore the whole auth chain and public
// surface — until the browser's TCP timeout (~2 min). Bound the fetch to 15s
// so it fails fast and the caller can fall back to the offline path.
export const REFRESH_TIMEOUT_MS = 15_000;
export const REFRESH_LOCK_NAME = 'wims:auth:refresh_lock';

export type RefreshResult =
  | { ok: true }
  | { ok: false; reason: 'auth' }    // HTTP non-2xx — token invalid/expired
  | { ok: false; reason: 'offline' }; // network error — device is offline

let refreshInFlight: Promise<RefreshResult> | null = null;

async function doRefresh(): Promise<RefreshResult> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), REFRESH_TIMEOUT_MS);
  try {
    const res = await fetch(REFRESH_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true };
    if (res.status >= 500 || res.status === 429) return { ok: false, reason: 'offline' };
    return { ok: false, reason: 'auth' };
  } catch {
    // AbortError (timeout) or network failure — backend unreachable / offline.
    // The sync engine maps 'offline' to a non-fatal abort reason.
    return { ok: false, reason: 'offline' };
  } finally {
    clearTimeout(tid);
  }
}

export async function refreshToken(): Promise<RefreshResult> {
  if (refreshInFlight) return refreshInFlight;

  const p = (async (): Promise<RefreshResult> => {
    try {
      if (typeof navigator === 'undefined' || !navigator.locks) {
        return await doRefresh();
      }
      const result = await navigator.locks.request(REFRESH_LOCK_NAME, doRefresh);
      return result ?? { ok: false, reason: 'auth' };
    } catch {
      // TypeError / network failure — device is still offline or just came back
      return { ok: false, reason: 'offline' };
    }
  })();

  refreshInFlight = p;
  p.finally(() => { refreshInFlight = null; });
  return p;
}
