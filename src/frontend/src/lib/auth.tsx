'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

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

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [role, setRole] = useState<UserProfile['role']>(null);
    const [assignedRegionId, setAssignedRegionId] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    const fetchProfile = useCallback(async () => {
        try {
            // Fetch from our HttpOnly cookie session endpoint instead of Supabase client
            const res = await fetch('/api/auth/session');
            if (res.ok) {
                const data = await res.json();
                if (data.user) {
                    setUser(data.user);
                    setRole(data.role);
                    setAssignedRegionId(data.assignedRegionId);
                }
            }
        } catch (err) {
            console.error("initAuth: Initialization failed:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchProfile();
    }, [fetchProfile]);

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
