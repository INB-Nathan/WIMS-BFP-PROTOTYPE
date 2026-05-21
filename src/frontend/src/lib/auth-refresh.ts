'use client';

// Shared module-level token refresh — ensures only ONE refresh call is in flight
// at any time, across all concurrent API calls and the proactive interval refresh.
// Uses navigator.locks for cross-tab coordination (prevents refreshTokenMaxReuse:0 races).

export const REFRESH_LOCK_NAME = 'wims:auth:refresh_lock';

let refreshInFlight: Promise<boolean> | null = null;

export async function refreshToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  const p = (async () => {
    try {
      const result = await navigator.locks.request(REFRESH_LOCK_NAME, async () => {
        const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        return res.ok;
      });
      return result ?? false;
    } catch {
      return false;
    }
  })();

  refreshInFlight = p;
  p.finally(() => {
    if (refreshInFlight === p) refreshInFlight = null;
  });
  return p;
}
