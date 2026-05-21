'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { refreshToken } from '@/lib/auth-refresh';

export interface User {
    id: string;
    email?: string;
}

interface UserProfile {
    user: User | null;
    role: 'ENCODER' | 'VALIDATOR' | 'ANALYST' | 'ADMIN' | 'SYSTEM_ADMIN' | 'REGIONAL_ENCODER' | null;
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

    // Delegates to the module-level singleton — deduplicates across concurrent
    // calls within this tab and uses navigator.locks for cross-tab coordination.
    const refreshAccessToken = useCallback((): Promise<boolean> => {
        return refreshToken();
    }, []);

    // ─── Session re-hydration ─────────────────────────────────────────────────
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
                } else {
                    setUser(null);
                    setRole(null);
                    setAssignedRegionId(null);
                }
            }
        } catch (err) {
            console.error('[AuthContext] fetchProfile: initialization failed:', err);
        } finally {
            setLoading(false);
        }
    }, [refreshAccessToken]);

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

        // When an API call fails with 401 and skipAuthRedirect is set, it fires this
        // event instead of hard-redirecting. We re-check the session here — if the
        // OIDC session is still alive, fetchProfile() will restore the token without
        // requiring a manual page refresh. If it's truly gone, user becomes null and
        // the auth guards redirect to /login.
        const handleAuthFailed = () => { void fetchProfile(); };
        window.addEventListener('wims:auth-failed', handleAuthFailed);

        return () => {
            window.clearInterval(intervalId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('wims:auth-failed', handleAuthFailed);
        };
    }, [user, refreshAccessToken, fetchProfile]);

    const signOut = async () => {
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
