'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { LogOut, Menu, X, User as UserIcon } from 'lucide-react';
import { NetworkStatusIndicator } from './NetworkStatusIndicator';

export function Header() {
    const [currentTime, setCurrentTime] = useState<string>('');
    const { user, logout } = useAuth();
    const role = (user as { role?: string })?.role ?? null;
    const pathname = usePathname();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    useEffect(() => {
        // Philippine Standard Time (PST) is UTC+8
        const updateTime = () => {
            const now = new Date();
            const options: Intl.DateTimeFormatOptions = {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
                timeZone: 'Asia/Manila'
            };
            setCurrentTime(new Intl.DateTimeFormat('en-PH', options).format(now));
        };

        updateTime();
        const timer = setInterval(updateTime, 1000);
        return () => clearInterval(timer);
    }, []);

    const isActive = (path: string) => pathname === path || pathname?.startsWith(`${path}/`);

    // Navigation Links based on Role
    const getNavLinks = () => {
        const links = [
            { label: 'Home', href: '/home' },
            { label: 'Dashboard', href: '/dashboard' }
        ];

        switch (role) {
            case 'ENCODER':
                links.push({ label: 'Incidents', href: '/incidents' });
                break;
            case 'VALIDATOR':
                links.push({ label: 'Incidents', href: '/incidents' });
                // links.push({ label: 'Pending Validation', href: '/incidents?status=PENDING' }); // Future
                break;
            case 'ANALYST':
                links.push({ label: 'Incidents', href: '/incidents' });
                break;
            case 'ADMIN':
                links.push({ label: 'Incidents', href: '/incidents' });
                break;
            case 'SYSTEM_ADMIN':
                // Admin Hub: hide Incidents/Map; show Governance, Telemetry, System Audit
                links.push({ label: 'Governance', href: '/admin/system#governance' });
                links.push({ label: 'Telemetry', href: '/admin/system#telemetry' });
                links.push({ label: 'System Audit', href: '/admin/system#audit' });
                break;
        }
        return links;
    };

    const navLinks = user ? getNavLinks() : [];

    return (
        <header className="bg-red-800 text-white shadow-md relative z-50 flex flex-col">
            {/* Top Bar: Branding & Clock */}
            <div className="w-full px-4 lg:px-8 py-[3px] flex flex-col md:flex-row items-center justify-between gap-4">
                {/* Branding Section */}
                <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-start">
                    {/* Banner */}
                    <div className="relative h-20 md:h-24 w-72 md:w-[32rem]">
                        <Image
                            src="/bfp-banner.png"
                            alt="BFP Banner"
                            fill
                            className="object-contain object-left"
                            priority
                        />
                    </div>

                    {/* Mobile Menu Toggle */}
                    <button
                        className="md:hidden p-2 text-white"
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                    >
                        {isMobileMenuOpen ? <X /> : <Menu />}
                    </button>
                </div>

                {/* Clock Section (Hidden on small mobile if needed, or stacked) */}
                <div className="hidden md:block text-right text-sm font-medium bg-red-900/50 px-4 py-2 rounded-lg border border-red-700/50 backdrop-blur-sm">
                    <div className="text-xs text-yellow-300 uppercase mb-0.5">Philippine Standard Time</div>
                    <div suppressHydrationWarning className="font-mono text-white">
                        {currentTime || 'Loading time...'}
                    </div>
                </div>
            </div>

            {/* Navigation Bar & User Controls */}
            <div className="bg-white border-b border-gray-200 shadow-sm">
                <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between">
                    {/* PC Nav */}
                    <nav className={`${isMobileMenuOpen ? 'flex' : 'hidden'} md:flex flex-col md:flex-row w-full md:w-auto gap-1 md:gap-6 py-2 md:py-0 border-b md:border-none border-gray-100`}>
                        {navLinks.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={`
                                    px-3 py-3 text-sm font-medium transition-colors border-b-2 
                                    ${isActive(link.href)
                                        ? 'border-red-700 text-red-800 bg-red-50 md:bg-transparent'
                                        : 'border-transparent text-gray-600 hover:text-red-700 hover:border-red-300'
                                    }
                                `}
                            >
                                {link.label}
                            </Link>
                        ))}
                    </nav>

                    {/* User Controls */}
                    <div className={`${isMobileMenuOpen ? 'flex' : 'hidden'} md:flex items-center gap-4 py-2 md:py-0 w-full md:w-auto justify-end`}>
                        <NetworkStatusIndicator />

                        {user && (
                            <div className="flex items-center gap-3 border-l pl-4 ml-2 border-gray-200">
                                <div className="text-right hidden sm:block">
                                    <div className="text-xs font-bold text-gray-700 uppercase">{role}</div>
                                    <div className="text-[10px] text-gray-500">{user.email || user.preferred_username || user.id}</div>
                                </div>

                                <button
                                    onClick={logout}
                                    className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700 font-medium px-3 py-1.5 rounded hover:bg-red-50 transition"
                                    title="Sign Out"
                                >
                                    <LogOut className="w-4 h-4" />
                                    <span className="md:hidden">Sign Out</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Decorative bottom border */}
            <div className="h-1 w-full bg-gradient-to-r from-blue-600 via-red-500 to-yellow-400"></div>
        </header>
    );
}
