'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { SyncStatusBar } from './SyncStatusBar';
import { usePathname } from 'next/navigation';

export function LayoutShell({ children }: { children: ReactNode }) {
    const { user, loading, loggingOut, login } = useAuth();
    const pathname = usePathname();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    useEffect(() => {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker
                .register('/sw.js')
                .then((registration) => console.log('Scope: ', registration.scope))
                .catch((err) => console.log('SW Registration Failed: ', err));
        }
    }, []);

    useEffect(() => {
        if (!loading && !user && !loggingOut) {
            const publicRoutes = ['/', '/login', '/callback', '/report'];
            const isPublic = publicRoutes.includes(pathname) || pathname.startsWith('/login');

            if (!isPublic) {
                // Defensive: wait 500ms before auto-redirecting to Keycloak.
                // The callback page calls refreshSession() before navigating, but
                // if there's a race condition or the session backend is slow, this
                // debounce prevents a premature redirect loop.
                const timer = setTimeout(() => {
                    // Re-check state before redirecting — refreshSession may have completed
                    // during the debounce window.
                    login();
                }, 500);
                return () => clearTimeout(timer);
            }
        }
    }, [user, loading, loggingOut, pathname, login]);

    // Close sidebar on route change (mobile)
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSidebarOpen(false);
    }, [pathname]);

    if (loading) {
        console.log('[LayoutShell] loading=true - blocking render.');
        return (
            <div className="h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--content-bg)' }}>
                <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-4 border-gray-300 border-t-red-700 rounded-full animate-spin" />
                    <span className="text-sm text-gray-500 font-medium">Loading WIMS-BFP...</span>
                </div>
            </div>
        );
    }

    // Public routes: no sidebar, no header
    const publicRoutes = ['/', '/login', '/callback', '/report'];
    const isPublicRoute = publicRoutes.includes(pathname) || pathname.startsWith('/login');

    if (isPublicRoute) {
        return <>{children}</>;
    }

    return (
        <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--content-bg)' }}>
            {/* Sidebar */}
            <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            {/* Main content area */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Header */}
                <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />

                {/* Page content */}
                <main className="flex-1 overflow-y-auto p-4 lg:p-6">
                    <div className="max-w-7xl mx-auto">
                        <SyncStatusBar />
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}
