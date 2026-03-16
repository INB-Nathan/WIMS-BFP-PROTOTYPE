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
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (loading) {
      console.log('[AuthContext] loading=true - session check in progress. If stuck, verify authority URL is reachable: http://localhost/auth/realms/bfp');
    }
  }, [loading]);

  const fetchSession = useCallback(async () => {
    console.log('[AuthContext] fetchSession: starting');
    try {
      const res = await fetch('/api/auth/session');
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
          console.log('[AuthContext] fetchSession: user loaded', data.user?.email ?? data.user?.id);
        } else {
          setUser(null);
          console.log('[AuthContext] fetchSession: no user in session');
        }
      } else {
        setUser(null);
        console.log('[AuthContext] fetchSession: session fetch not ok', res.status);
      }
    } catch (err) {
      setUser(null);
      console.error('[AuthContext] fetchSession: initialization failed:', err);
    } finally {
      setLoading(false);
      console.log('[AuthContext] fetchSession: loading=false');
    }
  }, []);

  useEffect(() => {
    console.log('[AuthContext] useEffect: initializing auth');
    fetchSession();
  }, [fetchSession]);

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
    try {
      console.log('[AuthContext] logout: clearing local session');
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      
      console.log('[AuthContext] logout: calling Keycloak signoutRedirect');
      const userManager = createUserManager();
      // This will redirect to Keycloak's end_session_endpoint and then back to post_logout_redirect_uri (baseUrl)
      await userManager.signoutRedirect();
    } catch (err) {
      console.error('[AuthContext] logout: failed during signoutRedirect', err);
      router.push('/login');
    }
  }, [router]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
        login,
        logout,
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
