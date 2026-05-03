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
const REFRESH_LOCK_NAME = 'wims:auth:refresh_lock';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (loading) {
      console.log(
        '[AuthContext] loading=true - session check in progress. If stuck, verify authority URL is reachable: http://localhost/auth/realms/bfp'
      );
    }
  }, [loading]);

  // ─── Token refresh ────────────────────────────────────────────────────────────
  // Uses navigator.locks to ensure only ONE tab refreshes at a time, preventing
  // the refreshTokenMaxReuse:0 race condition across tabs.
  const refreshAccessToken = useCallback(async (): Promise<boolean> => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const refreshPromise = (async () => {
      // Acquire a named lock so other tabs block here while this one refreshes.
      // If the lock is already held, this tab waits until the holder releases it.
      const lock = await navigator.locks.request(REFRESH_LOCK_NAME, async () => {
        try {
          const res = await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include',
          });
          if (!res.ok) {
            console.log(
              '[AuthContext] refreshAccessToken: refresh failed',
              res.status
            );
            return false;
          }
          console.log('[AuthContext] refreshAccessToken: token refreshed');
          return true;
        } catch (err) {
          console.error(
            '[AuthContext] refreshAccessToken: request failed',
            err
          );
          return false;
        }
      });
      return lock ?? false;
    })();

    refreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }, []);

  // ─── Session re-hydration ──────────────────────────────────────────────────
  // fetchSession re-loads user state from /api/auth/session.
  // IMPORTANT: on visibility/focus we NO LONGER call fetchSession — doing so
  // causes a full user=null flush followed by a /api/auth/session call, which
  // races against concurrent tab refreshes (refreshTokenMaxReuse:0) and often
  // results in 401 → session kill → logged out.  Proactive interval refresh is
  // sufficient; the cookie stays valid across tab switches without re-fetching.
  const fetchSession = useCallback(async () => {
    console.log('[AuthContext] fetchSession: starting');
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
          console.log(
            '[AuthContext] fetchSession: user loaded',
            data.user?.email ?? data.user?.id
          );
        } else {
          setUser(null);
          console.log('[AuthContext] fetchSession: no user in session');
        }
      } else {
        setUser(null);
        console.log(
          '[AuthContext] fetchSession: session fetch not ok',
          res.status
        );
      }
    } catch (err) {
      setUser(null);
      console.error('[AuthContext] fetchSession: initialization failed:', err);
    } finally {
      setLoading(false);
      console.log('[AuthContext] fetchSession: loading=false');
    }
  }, [refreshAccessToken]);

  // ─── Initial session load ────────────────────────────────────────────────────
  useEffect(() => {
    console.log('[AuthContext] useEffect: initializing auth');
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
    console.log('[AuthContext] login: called');
    try {
      const userManager = createUserManager();
      console.log('[AuthContext] login: UserManager created, calling signinRedirect');
      await userManager.signinRedirect();
      console.log('[AuthContext] login: signinRedirect completed (redirect should occur)');
    } catch (err) {
      console.error('[AuthContext] login: signinRedirect error:', err);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    setLoggingOut(true);
    try {
      console.log('[AuthContext] logout: clearing local session');
      await fetch('/api/auth/logout', { method: 'POST' });

      console.log('[AuthContext] logout: calling Keycloak signoutRedirect');
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
