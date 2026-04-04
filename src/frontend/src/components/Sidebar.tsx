'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import {
    LayoutDashboard,
    Home,
    Flame,
    FileText,
    Upload,
    ClipboardList,
    ShieldAlert,
    Users,
    Settings,
    X,
} from 'lucide-react';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
    const { user } = useAuth();
    const role = (user as { role?: string })?.role ?? null;
    const pathname = usePathname();

    const isActive = (path: string) =>
        pathname === path || pathname?.startsWith(`${path}/`);

    // Navigation items based on role
    const navSections = getNavSections(role);

    return (
        <>
            {/* Mobile overlay */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden"
                    onClick={onClose}
                />
            )}

            {/* Sidebar */}
            <aside
                className={`
                    fixed md:sticky top-0 left-0 z-50 h-screen
                    w-64 bg-sidebar-bg text-white
                    flex flex-col
                    sidebar-transition sidebar-scroll
                    ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
                `}
                style={{ backgroundColor: 'var(--sidebar-bg)' }}
            >
                {/* Logo area */}
                <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
                    <Link href="/dashboard" className="flex items-center gap-3">
                        <div className="relative w-10 h-10 flex-shrink-0">
                            <Image
                                src="/bfp-logo.svg"
                                alt="BFP"
                                fill
                                className="object-contain"
                            />
                        </div>
                        <div className="leading-tight">
                            <div className="text-sm font-bold tracking-wide">WIMS-BFP</div>
                            <div className="text-[10px] opacity-50 uppercase tracking-widest">Prototype</div>
                        </div>
                    </Link>
                    <button
                        onClick={onClose}
                        className="md:hidden p-1 rounded hover:bg-white/10 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Navigation */}
                <nav className="flex-1 overflow-y-auto py-4 sidebar-scroll">
                    {navSections.map((section, sIdx) => (
                        <div key={sIdx} className="mb-4">
                            {section.label && (
                                <div
                                    className="px-6 py-2 text-[10px] font-bold uppercase tracking-widest"
                                    style={{ color: 'var(--sidebar-text-muted)' }}
                                >
                                    {section.label}
                                </div>
                            )}
                            {section.items.map((item) => {
                                const active = isActive(item.href);
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={onClose}
                                        className={`
                                            flex items-center gap-3 px-6 py-2.5 text-sm font-medium
                                            transition-all duration-150 relative
                                            ${active
                                                ? 'bg-white/10 text-white'
                                                : 'text-white/70 hover:text-white hover:bg-white/5'
                                            }
                                        `}
                                    >
                                        {/* Active indicator */}
                                        {active && (
                                            <div
                                                className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r"
                                                style={{ backgroundColor: 'var(--sidebar-active)' }}
                                            />
                                        )}
                                        <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
                                        <span>{item.label}</span>
                                        {item.badge && (
                                            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-red-500 text-white font-bold">
                                                {item.badge}
                                            </span>
                                        )}
                                    </Link>
                                );
                            })}
                        </div>
                    ))}
                </nav>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-white/10 text-[10px] text-white/30 text-center">
                    BFP © 2026
                </div>
            </aside>
        </>
    );
}

interface NavItem {
    label: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
}

interface NavSection {
    label: string | null;
    items: NavItem[];
}

function getNavSections(role: string | null): NavSection[] {
    if (!role) return [];

    const sections: NavSection[] = [];

    // Common nav
    const navItems: NavItem[] = [
        { label: 'Home', href: '/home', icon: Home },
        { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    ];

    if (role === 'SYSTEM_ADMIN') {
        sections.push({ label: 'Navigation', items: navItems });
        sections.push({
            label: 'Administration',
            items: [
                { label: 'Governance', href: '/admin/system#governance', icon: Users },
                { label: 'Telemetry', href: '/admin/system#telemetry', icon: ShieldAlert },
                { label: 'System Audit', href: '/admin/system#audit', icon: Settings },
            ],
        });
        return sections;
    }

    if (role === 'REGIONAL_ENCODER') {
        sections.push({
            label: 'Navigation',
            items: [
                { label: 'Home', href: '/home', icon: Home },
                { label: 'Regional Dashboard', href: '/dashboard/regional', icon: LayoutDashboard },
            ]
        });

        sections.push({
            label: 'Management',
            items: [
                { label: 'Manual Entry', href: '/afor/create', icon: FileText },
                { label: 'Import AFOR', href: '/afor/import', icon: Upload },
            ]
        });
        
        return sections;
    }

    // Add Incidents for non-system-admin and non-regional-encoder roles
    navItems.push({ label: 'Incidents', href: '/incidents', icon: Flame });
    sections.push({ label: 'Navigation', items: navItems });

    // Role-specific management section
    const mgmtItems: NavItem[] = [];

    if (role === 'ENCODER') {
        mgmtItems.push({ label: 'Manual Entry', href: '/incidents/create', icon: FileText });
        mgmtItems.push({ label: 'Import Data', href: '/incidents/import', icon: Upload });
        mgmtItems.push({ label: 'Triage Queue', href: '/incidents/triage', icon: ClipboardList });
    }

    if (role === 'VALIDATOR') {
        mgmtItems.push({ label: 'Triage Queue', href: '/incidents/triage', icon: ClipboardList });
    }

    if (mgmtItems.length > 0) {
        sections.push({ label: 'Management', items: mgmtItems });
    }

    return sections;
}
