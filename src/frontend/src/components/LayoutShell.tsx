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
            navigator.serviceWorker.getRegistrations()
                .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
                .catch((err) => console.log('SW unregister failed: ', err));
        }

        if ('caches' in window) {
            caches.keys()
                .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
                .catch((err) => console.log('Cache cleanup failed: ', err));
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
            <div className="h-screen flex items-center justify-center bg-theme-surface-subtle">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-4 border-theme-border border-t-theme-brand-primary rounded-full animate-spin" />
                    <span className="text-sm text-theme-text-secondary font-medium">Loading WIMS-BFP...</span>
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
        <div className="flex h-screen overflow-hidden bg-theme-surface-subtle">
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
