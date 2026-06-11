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
import { refreshToken } from './auth-refresh';
import { getConnectivitySnapshot } from './connectivity';

export interface User {
    id: string;
    email?: string;
}

interface UserProfile {
    user: User | null;
    role: 'ENCODER' | 'NATIONAL_VALIDATOR' | 'ANALYST' | 'ADMIN' | 'SYSTEM_ADMIN' | 'REGIONAL_ENCODER' | null;
    assignedRegionId: number | null;
    loading: boolean;
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<UserProfile | undefined>(undefined);
const PROACTIVE_REFRESH_INTERVAL_MS = 4 * 60 * 1000; // refresh before 5-minute access token expiry

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [role, setRole] = useState<UserProfile['role']>(null);
    const [assignedRegionId, setAssignedRegionId] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const refreshInFlightRef = useRef<Promise<boolean> | null>(null);

    // ─── Silent token refresh ─────────────────────────────────────────────────
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

    // ─── Session re-hydration ─────────────────────────────────────────────────
    // Offline resilience: same 503/catch pattern as context/AuthContext.tsx.
    // On backend-unreachable or DevTools offline, restore from localStorage so
    // the IncidentForm knows the encoder's role and region without a live session.
    const PROFILE_CACHE_KEY = 'wims:offline_profile_cache';

    type ProfileCache = { user: User; role: UserProfile['role']; assignedRegionId: number | null };

    const restoreProfileFromCache = useCallback(() => {
        try {
            const raw = localStorage.getItem(PROFILE_CACHE_KEY);
            if (raw) {
                const cached = JSON.parse(raw) as ProfileCache;
                if (cached.user) {
                    setUser(cached.user);
                    setRole(cached.role);
                    setAssignedRegionId(cached.assignedRegionId);
                }
            }
        } catch { /* localStorage unavailable or stale JSON */ }
    }, []);

    const fetchProfile = useCallback(async () => {
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
                    setRole(data.role);
                    setAssignedRegionId(data.assignedRegionId);
                    try {
                        localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({
                            user: data.user,
                            role: data.role,
                            assignedRegionId: data.assignedRegionId,
                        }));
                    } catch { /* private mode */ }
                } else {
                    setUser(null);
                    setRole(null);
                    setAssignedRegionId(null);
                    localStorage.removeItem(PROFILE_CACHE_KEY);
                }
            } else if (res.status === 503) {
                restoreProfileFromCache();
            } else {
                setUser(null);
                setRole(null);
                setAssignedRegionId(null);
                localStorage.removeItem(PROFILE_CACHE_KEY);
            }
        } catch (err) {
            restoreProfileFromCache();
            console.error('[AuthContext] fetchProfile: initialization failed:', err);
        } finally {
            setLoading(false);
        }
    }, [refreshAccessToken, restoreProfileFromCache]);

    // ─── Initial session load ───────────────────────────────────────────────────
    useEffect(() => {
        fetchProfile();
    }, [fetchProfile]);

    // ─── Proactive token refresh + visibility handling ───────────────────────────
    // interval: every 4 min — rotates the cookie before the 5-min access token expires
    // visibilitychange: tab becomes visible — silent refresh without disturbing state
    // navigator.locks gate: prevents refreshTokenMaxReuse:0 race across tabs
    useEffect(() => {
        if (!user) {
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
                // Tab became visible — silently refresh the token.
                // Does NOT call fetchProfile() — that re-fetches user state from
                // /api/auth/session which races with other tabs and can result
                // in a full session kill when refreshTokenMaxReuse:0.
                void proactivelyRefreshJwtOnly();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.clearInterval(intervalId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [user, refreshAccessToken]);

    const signOut = async () => {
        localStorage.removeItem(PROFILE_CACHE_KEY);
        await fetch('/api/auth/logout', { method: 'POST' });
        setUser(null);
        setRole(null);
        setAssignedRegionId(null);
        router.push('/login');
    };

    return (
        <AuthContext.Provider value={{ user, role, assignedRegionId, loading, signOut, refreshProfile: fetchProfile }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useUserProfile = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useUserProfile must be used within an AuthProvider');
    }
    return context;
};
