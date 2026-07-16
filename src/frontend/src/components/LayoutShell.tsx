'use client';

import { ReactNode, useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { PublicHeader } from './PublicHeader';
import { PublicThemeProvider } from './public/PublicThemeProvider';
import { usePathname } from 'next/navigation';
import { isPublicRoute, isCivilianRoute } from '@/lib/routeUtils';
import { registerServiceWorker } from '@/lib/swRegistration';
import { useNetworkStatus } from '@/lib/useNetworkStatus';
import { maybePruneCaches } from '@/lib/offlineStore';
import { usePreloadDashboardData } from '@/lib/usePreloadDashboardData';
import { PwaInstallPrompt } from './PwaInstallPrompt';

export function LayoutShell({ children }: { children: ReactNode }) {
    const { user, loading, loggingOut, login, serverValidated } = useAuth();
    const { isOnline } = useNetworkStatus();
    const pathname = usePathname();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Preload dashboard data as soon as auth resolves. This fires before
    // the dashboard page mounts, so the IndexedDB cache is warm by the time
    // the ghost panels swap to real content.
    usePreloadDashboardData();

    useEffect(() => {
        registerServiceWorker();
    }, []);

    // Task 10: boot-guard eviction trigger. Runs `maybePruneCaches()` once on
    // mount — it self-gates via `wims:cachePruneAt` localStorage timestamp to
    // fire at most once per hour, so calling it on every mount is cheap.
    // Best-effort: maybePruneCaches swallows its own errors, but we still
    // wrap in try/catch to be defensive against import-time failures.
    useEffect(() => {
        try {
            void maybePruneCaches();
        } catch {
            // noop — never block render
        }
    }, []);

    useEffect(() => {
        if (!loading && !user && !loggingOut) {
            if (!isPublicRoute(pathname)) {
                // Don't redirect to Keycloak when offline — it's unreachable too.
                // The session cache in AuthContext restores the user offline, so
                // reaching here with user=null while offline means no cached session
                // exists; we wait until online before redirecting.
                if (!isOnline) return;

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
    }, [user, loading, loggingOut, pathname, login, isOnline]);

    // Close sidebar on route change (mobile)
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSidebarOpen(false);
    }, [pathname]);

    if (loading) {
        return (
            <div className="h-screen flex items-center justify-center bg-theme-surface-subtle">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-4 border-theme-border border-t-theme-brand-primary rounded-full animate-spin" />
                    <span className="text-sm text-theme-text-secondary font-medium">Loading WIMS-BFP...</span>
                </div>
            </div>
        );
    }

    // Public surface (anonymous or civilian) — uses PublicHeader
    // Landing page (/) uses its own immersive floating header from page.tsx
    if (isPublicRoute(pathname) || isCivilianRoute(pathname)) {
        return (
            <PublicThemeProvider showHeader={false}>
                {pathname !== '/' && <PublicHeader />}
                {children}
            </PublicThemeProvider>
        );
    }

    // Staff surface (encoder, validator, analyst, admin) — uses Sidebar + Header
    return (
        <div className="flex h-screen overflow-hidden bg-theme-surface-subtle">
            {/* Sidebar */}
            <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            {/* Main content area */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Header */}
                <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />

                {/* PWA install prompt — shown to REGIONAL_ENCODER once, before any other banner */}
                <PwaInstallPrompt />

                {/* Offline session banner — shown when identity restored from cache but server not yet reachable */}
                {!serverValidated && !isOnline && user !== null && (
                    <div className="flex items-center gap-2 bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
                        <WifiOff className="h-4 w-4 flex-shrink-0" aria-hidden />
                        <span>Offline session — your changes will save locally and upload when you reconnect.</span>
                    </div>
                )}

                {/* Page content */}
                <main className="flex-1 overflow-y-auto p-4 lg:p-6 wims-main-zoom">
                    <div className="max-w-7xl mx-auto">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}
