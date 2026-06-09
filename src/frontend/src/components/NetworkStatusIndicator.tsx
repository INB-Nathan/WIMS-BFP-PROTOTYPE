'use client';

import { Wifi, WifiOff } from 'lucide-react';
import { useNetworkStatus } from '@/lib/useNetworkStatus';

export function NetworkStatusIndicator() {
    const { isOnline, isChecking, isReconnecting } = useNetworkStatus();

    if (isChecking) {
        return (
            <div className="flex items-center gap-2 text-slate-600 text-sm font-medium">
                <Wifi className="w-4 h-4" />
                <span>Checking</span>
            </div>
        );
    }

    if (isReconnecting) {
        return (
            <div className="flex items-center gap-2 text-blue-600 text-sm font-medium">
                <Wifi className="w-4 h-4" />
                <span>Reconnecting</span>
            </div>
        );
    }

    if (isOnline) {
        return (
            <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
                <Wifi className="w-4 h-4" />
                <span>Online</span>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2 text-red-600 text-sm font-medium animate-pulse">
            <WifiOff className="w-4 h-4" />
            <span>Offline</span>
        </div>
    );
}
