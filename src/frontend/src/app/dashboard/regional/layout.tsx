'use client';

import { ReactNode, useEffect } from 'react';
import { SyncStatusBar } from '@/components/SyncStatusBar';
import { usePreloadDashboardData } from '@/lib/usePreloadDashboardData';

/**
 * Layout for all Regional Encoder dashboard routes.
 * Renders the offline sync status bar above all encoder pages.
 * Pre-loads dashboard data as soon as auth resolves so cached data
 * is ready when the page component mounts.
 */
export default function RegionalLayout({ children }: { children: ReactNode }) {
    // Preload dashboard data once auth resolves (caches into IndexedDB
    // via offlineAware wrappers — the page finds it instantly on mount).
    usePreloadDashboardData();

    // Eagerly download the IncidentForm chunk when the regional layout mounts
    // (i.e. as soon as the encoder loads any dashboard page while online).
    // This puts the bundle in the browser's HTTP cache so that client-side
    // navigation to /afor/create succeeds even when the user is later offline.
    useEffect(() => {
        void import('@/components/IncidentForm').catch(() => {});
    }, []);

    return (
        <div className="flex flex-col gap-4">
            <SyncStatusBar />
            {children}
        </div>
    );
}
