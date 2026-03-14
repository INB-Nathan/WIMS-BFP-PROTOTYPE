'use client';

import { ReactNode, useEffect } from 'react';
import { NetworkStatusIndicator } from './NetworkStatusIndicator';
import { useAuth } from '@/context/AuthContext';
import { Header } from './Header';
import { usePathname } from 'next/navigation';

export function LayoutShell({ children }: { children: ReactNode }) {
    const { user, loading, login, logout } = useAuth();
    const pathname = usePathname();

    useEffect(() => {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker
                .register('/sw.js')
                .then((registration) => console.log('Scope: ', registration.scope))
                .catch((err) => console.log('SW Registration Failed: ', err));
        }
    }, []);

    useEffect(() => {
        if (!loading && !user) {
            const publicRoutes = ['/', '/login', '/callback', '/report'];
            const isPublic = publicRoutes.includes(pathname) || pathname.startsWith('/login');

            if (!isPublic) {
                login();
            }
        }
    }, [user, loading, pathname, login]);

    if (loading) {
        console.log('[LayoutShell] loading=true - blocking render. Check AuthContext logs for fetchSession/authority.');
        return <div className="h-screen flex items-center justify-center">Loading...</div>;
    }

    return (
        <div className="min-h-screen bg-theme-surface-subtle flex flex-col font-sans">
            <Header />

            {/* Sub-header for User Controls - MOVED TO HEADER */}
            {/* Main Content */}

            {/* Main Content */}
            <main className="flex-1 max-w-7xl w-full mx-auto p-4">
                {children}
            </main>
        </div>
    );
}
