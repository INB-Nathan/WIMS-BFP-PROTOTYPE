'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { createUserManager } from '@/lib/oidc';
import { refreshToken } from '@/lib/auth-refresh';
import { clearAllCachedIncidents } from '@/lib/offlineStore';

export interface User {
  id: string;
  sub?: string;
  email?: string;
  preferred_username?: string;
  role?: string;
  assignedRegionId?: number | null;
}

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  loggingOut: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const PROACTIVE_REFRESH_INTERVAL_MS = 4 * 60 * 1000; // refresh before 5-minute access token expiry

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null);
  const router = useRouter();

  // ─── Token refresh ────────────────────────────────────────────────────────────
  // Delegates to auth-refresh.ts which uses navigator.locks when available
  // and falls back to a direct fetch when Web Locks API is unavailable.
  const refreshAccessToken = useCallback(async (): Promise<boolean> => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }
    // refreshToken() returns a typed RefreshResult ({ ok, reason }); collapse it to a
    // boolean for callers. Without the `.ok` map the object is always truthy, so a
    // failed refresh would be treated as success.
    const promise = refreshToken().then((r) => r.ok);
    refreshInFlightRef.current = promise;
    const result = await promise;
    refreshInFlightRef.current = null;
    return result;
  }, []);

  // ─── Session re-hydration ──────────────────────────────────────────────────
  // fetchSession re-loads user state from /api/auth/session.
  // IMPORTANT: on visibility/focus we NO LONGER call fetchSession — doing so
  // causes a full user=null flush followed by a /api/auth/session call, which
  // races against concurrent tab refreshes (refreshTokenMaxReuse:0) and often
  // results in 401 → session kill → logged out.  Proactive interval refresh is
  // sufficient; the cookie stays valid across tab switches without re-fetching.
  //
  // Offline resilience: when the backend is unreachable (503) or the request
  // fails entirely (DevTools offline mode blocks localhost), we restore the user
  // from a localStorage cache written on the last successful login. This allows
  // encoders to access the app and view cached incidents when offline.
  const SESSION_CACHE_KEY = 'wims:offline_session_cache';

  const restoreSessionFromCache = useCallback(() => {
    try {
      const raw = localStorage.getItem(SESSION_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as { user: User };
        if (cached.user) setUser(cached.user);
      }
    } catch { /* localStorage unavailable or invalid JSON — skip */ }
  }, []);

  const fetchSession = useCallback(async () => {
    try {
      const requestSession = () => fetch('/api/auth/session');
      let res = await requestSession();

      if (res.status === 401) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          res = await requestSession();
        }
      }

      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
          try { localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ user: data.user })); } catch { /* private mode */ }
        } else {
          setUser(null);
          localStorage.removeItem(SESSION_CACHE_KEY);
        }
      } else if (res.status === 503) {
        // Backend unreachable — restore from local cache so offline encoders
        // can still access the app and their cached incident data.
        restoreSessionFromCache();
      } else {
        // Genuine auth failure (401 after refresh, 500, etc.) — clear session.
        setUser(null);
        localStorage.removeItem(SESSION_CACHE_KEY);
      }
    } catch (err) {
      // Network error: DevTools offline mode blocks even localhost requests.
      restoreSessionFromCache();
      console.error('[AuthContext] fetchSession: initialization failed:', err);
    } finally {
      setLoading(false);
    }
  }, [refreshAccessToken, restoreSessionFromCache]);

  // ─── Initial session load ────────────────────────────────────────────────────
  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // ─── Proactive token refresh + visibility handling ───────────────────────────
  // Uses document.visibilityState (NOT window focus) to trigger refresh.
  // - visibilitychange: fires when tab becomes visible (tab switch, window restore).
  //   Only calls refreshAccessToken (cookie rotation), NOT fetchSession, so no
  //   user state is disturbed.
  // - window.setInterval: fires every 4 min to proactively rotate the token
  //   before the 5-min access token expires.
  //
  // Why NOT focus event? The focus event fires on every click inside the window
  // (tabs, buttons, inputs), triggering unnecessary refresh races. visibilityState
  // is a cleaner signal for "user has returned to this tab".
  useEffect(() => {
    if (!user || loggingOut) {
      return;
    }

    const proactivelyRefreshJwtOnly = async () => {
      // Silent refresh — only rotates the cookie, does NOT touch user state.
      // This is safe to call concurrently from multiple tabs because of the
      // navigator.locks gate inside refreshAccessToken().
      await refreshAccessToken();
    };

    const intervalId = window.setInterval(
      () => void proactivelyRefreshJwtOnly(),
      PROACTIVE_REFRESH_INTERVAL_MS
    );

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Tab became visible — refresh token silently.
        // Do NOT call fetchSession() here; doing so re-fetches user from
        // /api/auth/session which can race with other tabs and result in a
        // full session kill (401) when refreshTokenMaxReuse:0.
        void proactivelyRefreshJwtOnly();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loggingOut, refreshAccessToken, user]);

  const login = useCallback(async () => {
    try {
      const userManager = createUserManager();
      await userManager.signinRedirect();
    } catch (err) {
      console.error('[AuthContext] login: signinRedirect error:', err);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    localStorage.removeItem(SESSION_CACHE_KEY);
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });

      // Shared-device privacy: purge the local read cache so cached incident PII
      // does not linger for the next user. Pending offline ops are intentionally
      // preserved so unsynced work is not dropped — it resumes on re-login.
      try {
        await clearAllCachedIncidents();
      } catch {
        /* IndexedDB unavailable (e.g. private mode) — non-fatal for logout */
      }

      const userManager = createUserManager();
      const currentUser = await userManager.getUser();

      // Clear local OIDC state before redirecting away to avoid stale client-side sessions.
      await userManager.removeUser();

      // Explicit id_token_hint improves Keycloak end-session behavior in some deployments.
      await userManager.signoutRedirect({
        id_token_hint: currentUser?.id_token,
        post_logout_redirect_uri: `${window.location.origin}/login`,
      });
    } catch (err) {
      console.error('[AuthContext] logout: failed during signoutRedirect', err);
      setUser(null);
      setLoggingOut(false);
      router.push('/login');
    }
  }, [router]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
        loggingOut,
        login,
        logout,
        refreshSession: fetchSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
