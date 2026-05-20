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
const REFRESH_LOCK_NAME = 'wims:auth:refresh_lock';

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch(REFRESH_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      console.warn('[auth-refresh] refresh failed', res.status);
      return false;
    }
    console.log('[auth-refresh] token refreshed');
    return true;
  } catch (err) {
    console.error('[auth-refresh] refresh request failed', err);
    return false;
  }
}

export async function refreshToken(): Promise<boolean> {
  // Web Locks API available — use the lock to serialise cross-tab refreshes.
  if ('locks' in navigator && typeof navigator.locks.request === 'function') {
    const lock = await navigator.locks.request(REFRESH_LOCK_NAME, async () => {
      return doRefresh();
    });
    return lock ?? false;
  }

  // Web Locks unavailable — fall back to direct fetch.
  // This still handles token expiry correctly; the only tradeoff is loss of
  // cross-tab serialisation (multiple tabs may hit /api/auth/refresh
  // concurrently), which is safe for refresh token grants.
  console.warn('[auth-refresh] Web Locks API unavailable — using direct fetch fallback');
  return doRefresh();
}
