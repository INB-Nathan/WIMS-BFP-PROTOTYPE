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
 * Returns true when the server confirms a new access token, false otherwise.
 */

const REFRESH_ENDPOINT = '/api/auth/refresh';
export const REFRESH_LOCK_NAME = 'wims:auth:refresh_lock';

let refreshInFlight: Promise<boolean> | null = null;

export async function refreshToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  const p = (async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.locks) {
        const res = await fetch(REFRESH_ENDPOINT, { method: 'POST', credentials: 'include' });
        return res.ok;
      }
      const result = await navigator.locks.request(REFRESH_LOCK_NAME, async () => {
        const res = await fetch(REFRESH_ENDPOINT, { method: 'POST', credentials: 'include' });
        return res.ok;
      });
      return result ?? false;
    } catch {
      return false;
    }
  })();

  refreshInFlight = p;
  p.finally(() => { refreshInFlight = null; });
  return p;
}
