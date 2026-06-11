'use client';

import { useEffect } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useNetworkStatus } from '@/lib/useNetworkStatus';

function isChunkLoadError(error: Error): boolean {
    return (
        error.name === 'ChunkLoadError' ||
        error.message.includes('Loading chunk') ||
        error.message.includes('Failed to load chunk') ||
        error.message.includes('Unexpected token') // minified chunk parse error
    );
}

export default function AforError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const { isOnline } = useNetworkStatus();

    useEffect(() => {
        console.error('[afor/error]', error);
    }, [error]);

    if (!isOnline && isChunkLoadError(error)) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center p-8">
                <WifiOff className="w-12 h-12 text-gray-300" />
                <h2 className="text-lg font-semibold text-gray-600">Form Not Available Offline</h2>
                <p className="text-sm text-gray-400 max-w-sm">
                    The incident creation form hasn&apos;t been cached on this device yet. Visit this page
                    at least once while connected to the internet — after that it will work offline.
                </p>
                <a
                    href="/dashboard/regional"
                    className="inline-flex items-center gap-2 rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 transition-colors"
                >
                    Back to Dashboard
                </a>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center p-8">
            <h2 className="text-lg font-semibold text-gray-600">Something went wrong</h2>
            <p className="text-sm text-gray-400 max-w-sm">
                {error.message || 'An unexpected error occurred loading this page.'}
            </p>
            <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 transition-colors"
            >
                <RefreshCw className="w-4 h-4" />
                Try again
            </button>
        </div>
    );
}
