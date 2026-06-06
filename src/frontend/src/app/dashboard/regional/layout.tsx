'use client';

import { ReactNode } from 'react';
import { SyncStatusBar } from '@/components/SyncStatusBar';

/**
 * Layout for all Regional Encoder dashboard routes.
 * Renders the offline sync status bar above all encoder pages.
 */
export default function RegionalLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex flex-col gap-4">
            <SyncStatusBar />
            {children}
        </div>
    );
}
