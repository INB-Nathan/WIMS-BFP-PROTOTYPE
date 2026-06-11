'use client';

import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useNetworkStatus } from '@/lib/useNetworkStatus';

function isChunkLoadError(error: Error): boolean {
    return (
        error.name === 'ChunkLoadError' ||
        error.message.includes('Loading chunk') ||
        error.message.includes('Failed to load chunk') ||
        error.message.includes('Unexpected token')
    );
}

export default function AforError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const { isOnline, isChecking } = useNetworkStatus();

    useEffect(() => {
        console.error('[afor/error]', error);
    }, [error]);

    // When the user is confirmed online and there's a chunk error, the chunks
    // are stale (e.g. a new deployment happened while they were offline).
    // Hard-reload immediately to get the fresh bundle instead of showing an
    // error screen.
    useEffect(() => {
        if (isOnline && isChunkLoadError(error)) {
            window.location.reload();
        }
    }, [isOnline, error]);

    // While the connectivity probe is still in flight we don't know if we're
    // online — don't show any message yet.
    if (isChecking && isChunkLoadError(error)) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center text-gray-500 text-sm">
                Reconnecting…
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center p-8">
            <h2 className="text-lg font-semibold text-gray-600">
                {isChunkLoadError(error) ? 'Page failed to load' : 'Something went wrong'}
            </h2>
            <p className="text-sm text-gray-400 max-w-sm">
                {isChunkLoadError(error)
                    ? 'A required script could not be loaded. This can happen after reconnecting or if the page hasn’t been cached yet. Try again or go back to the dashboard.'
                    : (error.message || 'An unexpected error occurred loading this page.')}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                    onClick={() => window.location.reload()}
                    className="inline-flex items-center gap-2 rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 transition-colors"
                >
                    <RefreshCw className="w-4 h-4" />
                    Reload page
                </button>
                <a
                    href="/dashboard/regional"
                    className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                    Back to Dashboard
                </a>
            </div>
        </div>
    );
}
