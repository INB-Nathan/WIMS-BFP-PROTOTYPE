'use client';

import { ReactNode, useEffect } from 'react';
import { SyncStatusBar } from '@/components/SyncStatusBar';

/**
 * Layout for all Regional Encoder dashboard routes.
 * Renders the offline sync status bar above all encoder pages.
 */
export default function RegionalLayout({ children }: { children: ReactNode }) {
    // Eagerly download the IncidentForm chunk when the regional layout mounts
    // (i.e. as soon as the encoder loads any dashboard page while online).
    // This puts the bundle in the browser's HTTP cache so that client-side
    // navigation to /afor/create succeeds even when the user is later offline.
    useEffect(() => {
        void import('@/components/IncidentForm').catch(() => {});
        void import('@/components/WildlandAforManualForm').catch(() => {});
    }, []);

    return (
        <div className="flex flex-col gap-4">
            <SyncStatusBar />
            {children}
        </div>
    );
}
