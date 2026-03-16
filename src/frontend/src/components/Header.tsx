'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { LogOut, Menu, Bell } from 'lucide-react';
import { NetworkStatusIndicator } from './NetworkStatusIndicator';

interface HeaderProps {
    onMenuToggle: () => void;
}

export function Header({ onMenuToggle }: HeaderProps) {
    const [currentTime, setCurrentTime] = useState<string>('');
    const { user, logout } = useAuth();
    const role = (user as { role?: string })?.role ?? null;
    const pathname = usePathname();

    useEffect(() => {
        const updateTime = () => {
            const now = new Date();
            const options: Intl.DateTimeFormatOptions = {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                timeZone: 'Asia/Manila',
            };
            setCurrentTime(new Intl.DateTimeFormat('en-PH', options).format(now));
        };
        updateTime();
        const timer = setInterval(updateTime, 1000);
        return () => clearInterval(timer);
    }, []);

    // Generate breadcrumb from pathname
    const breadcrumbs = getBreadcrumbs(pathname);

    return (
        <header
            className="sticky top-0 z-30 flex items-center justify-between px-4 lg:px-6 bg-white border-b"
            style={{
                height: 'var(--header-height)',
                borderColor: 'var(--border-color)',
            }}
        >
            {/* Left: hamburger + breadcrumb */}
            <div className="flex items-center gap-3">
                <button
                    onClick={onMenuToggle}
                    className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
                    aria-label="Toggle Menu"
                >
                    <Menu className="w-5 h-5" />
                </button>

                <nav className="hidden sm:flex items-center gap-1 text-sm">
                    {breadcrumbs.map((crumb, i) => (
                        <span key={i} className="flex items-center gap-1">
                            {i > 0 && <span className="text-gray-300 mx-1">/</span>}
                            {i === breadcrumbs.length - 1 ? (
                                <span className="font-medium text-gray-800">{crumb}</span>
                            ) : (
                                <span className="text-gray-400">{crumb}</span>
                            )}
                        </span>
                    ))}
                </nav>
            </div>

            {/* Right: clock, network, user */}
            <div className="flex items-center gap-2 md:gap-4">
                {/* PST clock */}
                <div
                    suppressHydrationWarning
                    className="hidden md:block text-xs font-medium text-gray-500 tabular-nums"
                >
                    {currentTime || '...'}
                    <span className="ml-1 text-[10px] text-gray-400">PST</span>
                </div>

                <NetworkStatusIndicator />

                {user && (
                    <div className="flex items-center gap-3 pl-3 border-l" style={{ borderColor: 'var(--border-color)' }}>
                        {/* Role badge */}
                        <div className="hidden sm:flex flex-col items-end">
                            <span className="text-xs font-bold text-gray-700">
                                {user.email || user.preferred_username || 'User'}
                            </span>
                            <span
                                className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                style={{
                                    backgroundColor: getRoleBadgeColor(role).bg,
                                    color: getRoleBadgeColor(role).text,
                                }}
                            >
                                {role}
                            </span>
                        </div>

                        <button
                            onClick={logout}
                            className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                            title="Sign Out"
                        >
                            <LogOut className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </div>
        </header>
    );
}

function getBreadcrumbs(pathname: string): string[] {
    if (!pathname || pathname === '/') return ['Home'];

    const segments = pathname.split('/').filter(Boolean);
    const crumbs = ['Home'];

    const labelMap: Record<string, string> = {
        home: 'Operations',
        dashboard: 'Dashboard',
        incidents: 'Incidents',
        create: 'Manual Entry',
        import: 'Import',
        triage: 'Triage Queue',
        new: 'New Report',
        admin: 'Admin',
        system: 'System Hub',
        report: 'Emergency Report',
        login: 'Login',
        callback: 'Signing In',
    };

    for (const seg of segments) {
        crumbs.push(labelMap[seg] || seg.charAt(0).toUpperCase() + seg.slice(1));
    }

    return crumbs;
}

function getRoleBadgeColor(role: string | null): { bg: string; text: string } {
    switch (role) {
        case 'SYSTEM_ADMIN':
            return { bg: '#fee2e2', text: '#991b1b' };
        case 'ADMIN':
            return { bg: '#fef3c7', text: '#92400e' };
        case 'VALIDATOR':
            return { bg: '#dbeafe', text: '#1e40af' };
        case 'ANALYST':
            return { bg: '#ede9fe', text: '#5b21b6' };
        case 'ENCODER':
            return { bg: '#d1fae5', text: '#065f46' };
        default:
            return { bg: '#f3f4f6', text: '#6b7280' };
    }
}
