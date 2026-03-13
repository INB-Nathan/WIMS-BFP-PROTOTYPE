'use client';

import { useState, useEffect } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

export function NetworkStatusIndicator() {
    const [isOnline, setIsOnline] = useState(true);

    useEffect(() => {
        // Initial check
        setIsOnline(navigator.onLine);

        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

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
