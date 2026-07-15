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
import { clearAllCachedIncidents, setActiveOfflineUser } from '@/lib/offlineStore';
import { getConnectivitySnapshot } from '@/lib/connectivity';
import { enableOfflineMode } from '@/lib/offlineEnable';

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
  /**
   * True only when the current user was returned by a successful
   * /api/auth/session call. False when the user is a read-only offline
   * restore from localStorage (issue #5) or when not authenticated.
   * Consumers that perform privileged actions should treat
   * `serverValidated === false` as "offline read-only mode" and gate
   * write/role-scoped operations behind a successful server re-check.
   */
  serverValidated: boolean;
  /**
   * True when the user identity is present in cache (even if the server hasn't
   * re-confirmed it yet). Queued offline writes (create/update via offlineOps)
   * are safe with only this flag — the server validates the JWT at sync time.
   * Use `serverValidated` for operations that MUST reach the server immediately.
   */
  canQueueOfflineWrites: boolean;
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
  // Issue #5: track whether `user` came from a successful /api/auth/session
  // call or from a localStorage cache restore. When false, the user is
  // treated as offline read-only — privileged actions (e.g. SW role
  // notification) MUST NOT run.
  const [serverValidated, setServerValidated] = useState(false);
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

  // Hang guard (issue #604 / map #603): the session fetch had no timeout, so a
  // slow or unreachable backend (Next.js API route, /api/auth/session, or
  // Keycloak) kept the loading spinner up until the browser's TCP timeout
  // (~2 min), blocking the entire public surface from rendering. Bound the
  // whole re-hydration attempt to 15s; on timeout it aborts and falls through
  // to the existing offline cache restore (see the catch below).
  const FETCH_SESSION_TIMEOUT_MS = 15_000;

  // ─── Service-worker role notification (Task 14) ──────────────────────────────
  // Best-effort: tell the active SW which role just signed in so it can
  // pre-warm that role's routes (see ROLE_PREFETCH_ROUTES in public/sw.js).
  // Must never throw or block login: missing SW, null controller, or a
  // postMessage failure are all silent no-ops.
  const notifyServiceWorkerOfRole = useCallback((role: string | undefined) => {
    if (!role) return;
    if (typeof navigator === 'undefined') return;
    const controller = navigator.serviceWorker?.controller;
    if (!controller) return;
    try {
      controller.postMessage({ type: 'PREFETCH_ROLE', role });
    } catch (err) {
      console.warn('[AuthContext] notifyServiceWorkerOfRole: postMessage failed:', err);
    }
  }, []);

  const restoreSessionFromCache = useCallback(() => {
    try {
      const raw = localStorage.getItem(SESSION_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as { user: Pick<User, 'id' | 'role' | 'assignedRegionId' | 'email' | 'preferred_username'> };
        if (cached.user) {
          setUser(cached.user);
          // Issue #5: cached user is OFFLINE READ-ONLY until a successful
          // /api/auth/session call re-validates the identity. Privileged
          // side-effects (e.g. SW PREFETCH_ROLE) must not run from here.
          setServerValidated(false);
          if (cached.user.id) void setActiveOfflineUser(cached.user.id);
        }
      }
    } catch { /* localStorage unavailable or invalid JSON — skip */ }
  }, []);

  const fetchSession = useCallback(async () => {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), FETCH_SESSION_TIMEOUT_MS);
    try {
      const requestSession = () => fetch('/api/auth/session', { signal: ctrl.signal });
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
          // Issue #5: server-validated user. Privileged side-effects are now
          // safe to run.
          setServerValidated(true);
          // Bind offline storage to this account — wipes prior user's offline data
          // if a different uid is now logged in (item F12).
          if (data.user.id) void setActiveOfflineUser(data.user.id);
          // Include assignedRegionId in the cache so encoders can create incidents
          // offline even when their session can only be restored from localStorage.
          try {
            localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
              user: {
                id: data.user.id,
                role: data.user.role,
                assignedRegionId: data.user.assignedRegionId ?? null,
                // Persist display identity so the header shows the correct name
                // when the session is restored offline (issue: shows "User" otherwise).
                email: data.user.email ?? null,
                preferred_username: data.user.preferred_username ?? null,
              },
            }));
          } catch { /* private mode */ }
          // Post-login role prefetch (Task 14): notify the active service worker
          // of the signed-in role so it can pre-warm that role's routes.
          notifyServiceWorkerOfRole(data.user.role);
        } else {
          setUser(null);
          setServerValidated(false);
          localStorage.removeItem(SESSION_CACHE_KEY);
        }
      } else if (res.status === 503) {
        // Backend unreachable — restore from local cache so offline encoders
        // can still access the app and their cached incident data.
        restoreSessionFromCache();
      } else {
        // Genuine auth failure (401 after refresh, 500, etc.) — clear session.
        setUser(null);
        setServerValidated(false);
        localStorage.removeItem(SESSION_CACHE_KEY);
      }
    } catch (err) {
      // Network error: DevTools offline mode blocks even localhost requests.
      restoreSessionFromCache();
      console.error('[AuthContext] fetchSession: initialization failed:', err);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, [refreshAccessToken, restoreSessionFromCache, notifyServiceWorkerOfRole]);

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
      if (!getConnectivitySnapshot().isOnline) return;
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

  // ─── Automatic offline cache warm-up (Track 2) ───────────────────────────────
  // Fires once per browser session after the first successful server validation.
  // Uses silent mode so failures are logged but never surfaced as UI errors or toasts.
  // The sessionStorage guard prevents re-running on every token refresh.
  useEffect(() => {
    if (!serverValidated || !user?.id) return;
    if (typeof sessionStorage === 'undefined') return;
    if (sessionStorage.getItem('wims:preload_done')) return;
    sessionStorage.setItem('wims:preload_done', '1');

    enableOfflineMode(user.id, {
      silent: true,
      prefetch: (href) => router.prefetch(href),
    }).catch((err) => {
      console.warn('[AuthContext] background offline preload failed:', err);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- router is stable; sessionStorage guard makes extra deps irrelevant
  }, [serverValidated, user?.id]);

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
      // RP-19: record self-service logout for non-repudiation before session teardown.
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 1500);
        await fetch('/api/auth/security-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event_type: 'LOGOUT', username: user?.preferred_username ?? null }),
          signal: ctrl.signal,
        }).catch(() => {});
        clearTimeout(tid);
      } catch { /* non-fatal — logout must always complete */ }
      await fetch('/api/auth/logout', { method: 'POST' });

      // Shared-device privacy: purge the local read cache so cached incident PII
      // does not linger for the next user. Pending offline ops are intentionally
      // preserved so unsynced work is not dropped — it resumes on re-login.
      try {
        await clearAllCachedIncidents();
      } catch {
        /* IndexedDB unavailable (e.g. private mode) — non-fatal for logout */
      }

      // Shared-device privacy: signal the service worker to evict the
      // authenticated app cache (RSC payloads, navigation pages, static
      // routes) so the next user cannot inspect cached content from
      // this session. The long-lived tile cache is preserved.
      //
      // Issue #4: postMessage can throw DataCloneError (non-cloneable
      // payload), InvalidStateError (controller closed), or SecurityError.
      // The dedicated try/catch below keeps the error from escaping into the
      // outer try/catch (which would short-circuit removeUser + signoutRedirect
      // and leave OIDC state stale).
      if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        try {
          navigator.serviceWorker.controller.postMessage({ type: 'clear-auth-cache' });
        } catch (pmErr) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[AuthContext] logout: postMessage failed:', pmErr);
          }
        }
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
  }, [router, user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        serverValidated,
        canQueueOfflineWrites: user !== null,
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
