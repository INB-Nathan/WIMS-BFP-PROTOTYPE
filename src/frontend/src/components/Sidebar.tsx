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
    ShieldX,
    Users,
    Settings,
    X,
    UserCircle,
    History,
    BarChart3,
    Clock,
    ListChecks,
    MapPinned,
    Search,
    TrendingUp,
    Map,
    SlidersHorizontal,
    Activity,
} from 'lucide-react';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
    const { user } = useAuth();
    const role = (user as { role?: string })?.role ?? null;
    const pathname = usePathname();

    const isActive = (path: string) => {
        // /incidents/triage has its own nav item — don't also highlight /incidents
        if (path === '/incidents' && pathname?.startsWith('/incidents/triage')) return false;
        // /dashboard/validator should not stay active when the user navigates to /incidents
        if (path === '/dashboard/validator' && (pathname?.startsWith('/incidents'))) return false;
        if (path === '/dashboard/analyst' && pathname !== '/dashboard/analyst') return false;
        // parent dashboard routes must not match their own sub-pages (e.g. /audit)
        if (path === '/dashboard/regional' && pathname?.startsWith('/dashboard/regional/')) return false;
        if (path === '/dashboard/validator' && pathname?.startsWith('/dashboard/validator/')) return false;
        return pathname === path || pathname?.startsWith(`${path}/`);
    };

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
                    w-64 flex flex-col
                    sidebar-transition sidebar-scroll overflow-hidden
                    ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
                `}
                style={{ backgroundColor: 'var(--sidebar-bg)' }}
            >
                {/* Logo area */}
                <div className="flex items-center justify-between px-5 py-5 border-b border-white/10 flex-shrink-0">
                    <Link href="/dashboard" className="flex items-center gap-3 min-w-0">
                        <div className="relative w-9 h-9 flex-shrink-0">
                            <Image
                                src="/bfp-logo.svg"
                                alt="BFP"
                                fill
                                className="object-contain"
                            />
                        </div>
                        <div className="leading-tight min-w-0">
                            <div className="text-sm font-bold tracking-wide text-white">WIMS-BFP</div>
                            <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--sidebar-text-muted)' }}>Prototype</div>
                        </div>
                    </Link>
                    <button
                        onClick={onClose}
                        className="md:hidden p-1.5 rounded-md hover:bg-white/10 transition-colors flex-shrink-0"
                        aria-label="Close sidebar"
                    >
                        <X className="w-4 h-4 text-white/70" />
                    </button>
                </div>

                {/* Navigation */}
                <nav className="flex-1 overflow-y-auto py-3 sidebar-scroll">
                    {navSections.map((section, sIdx) => (
                        <div key={sIdx} className="mb-2">
                            {section.label && (
                                <div
                                    className="px-5 pt-4 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em]"
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
                                            flex items-center gap-3 mx-3 px-3 py-2.5 text-sm font-medium rounded-lg
                                            transition-all duration-150 relative group
                                            ${active
                                                ? 'text-[#C62828]'
                                                : 'hover:translate-x-1'
                                            }
                                        `}
                                        style={active ? {
                                            backgroundColor: '#FDECEC',
                                            borderLeft: '3px solid #C62828',
                                            paddingLeft: '9px',
                                        } : {
                                            color: 'rgba(255,255,255,0.75)',
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!active) {
                                                (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.07)';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!active) {
                                                (e.currentTarget as HTMLElement).style.backgroundColor = '';
                                            }
                                        }}
                                    >
                                        <span
                                            className="flex-shrink-0 w-[17px] h-[17px] flex items-center justify-center"
                                            style={{ color: active ? '#C62828' : 'inherit' }}
                                        >
                                            <item.icon className="w-[17px] h-[17px]" />
                                        </span>
                                        <span className="truncate">{item.label}</span>
                                        {item.badge && (
                                            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-red-500 text-white font-bold flex-shrink-0">
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
                <div className="px-5 py-3 border-t border-white/10 text-[10px] text-center flex-shrink-0" style={{ color: 'var(--sidebar-text-muted)' }}>
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
        { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
        { label: 'Operations', href: '/home', icon: Home },
    ];

    if (role === 'SYSTEM_ADMIN') {
        sections.push({ label: 'Navigation', items: navItems });
        sections.push({
            label: 'Administration',
            items: [
                { label: 'Governance', href: '/admin/system#governance', icon: Users },
                { label: 'Security Monitoring', href: '/admin/monitoring', icon: ShieldAlert },
                { label: 'Telemetry', href: '/admin/system#telemetry', icon: ShieldAlert },
                { label: 'Breach Notifications', href: '/admin/breach', icon: ShieldX },
                { label: 'System Audit', href: '/admin/audit', icon: Settings },
                { label: 'Anomaly Detection', href: '/admin/anomalies', icon: Activity },
                { label: 'Configuration', href: '/admin/system/config', icon: SlidersHorizontal },
            ],
        });
        sections.push({ label: 'Account', items: [{ label: 'My Profile', href: '/profile', icon: UserCircle }] });
        return sections;
    }

    if (role === 'REGIONAL_ENCODER') {
        sections.push({
            label: 'Navigation',
            items: [
                { label: 'Dashboard', href: '/dashboard/regional', icon: LayoutDashboard },
                { label: 'Operations', href: '/home', icon: Home },
            ]
        });

        sections.push({
            label: 'Management',
            items: [
                { label: 'Manual Entry', href: '/afor/create', icon: FileText },
                { label: 'Import AFOR', href: '/afor/import', icon: Upload },
                { label: 'Activity Log', href: '/dashboard/regional/audit', icon: History },
            ]
        });

        sections.push({ label: 'Account', items: [{ label: 'My Profile', href: '/profile', icon: UserCircle }] });

        return sections;
    }

    if (role === 'NATIONAL_VALIDATOR') {
        sections.push({
            label: 'Navigation',
            items: [
                { label: 'Dashboard', href: '/dashboard/validator', icon: LayoutDashboard },
                { label: 'Operations', href: '/home', icon: Home },
                { label: 'Incidents', href: '/incidents', icon: Flame },
            ],
        });
        sections.push({
            label: 'Workflow',
            items: [
                { label: 'Triage Queue', href: '/incidents/triage', icon: ClipboardList },
                { label: 'Operational Map', href: '/dashboard/validator/map', icon: Map },
                { label: 'Audit Trail', href: '/dashboard/validator/audit', icon: History },
            ],
        });
        sections.push({ label: 'Account', items: [{ label: 'My Profile', href: '/profile', icon: UserCircle }] });
        return sections;
    }

    if (role === 'NATIONAL_ANALYST') {
        sections.push({
            label: 'Navigation',
            items: [
                { label: 'Operations', href: '/home', icon: Home },
                { label: 'Analyst Dashboard', href: '/dashboard/analyst', icon: LayoutDashboard },
            ],
        });
        sections.push({
            label: 'Analysis',
            items: [
                { label: 'Comparative', href: '/dashboard/analyst/comparative', icon: BarChart3 },
                { label: 'Heatmap', href: '/dashboard/analyst/heatmap', icon: MapPinned },
                { label: 'Trends', href: '/dashboard/analyst/trends', icon: TrendingUp },
                { label: 'Response Time', href: '/dashboard/analyst/response-time', icon: Clock },
                { label: 'Top-N Hotspots', href: '/dashboard/analyst/top-n', icon: ListChecks },
                { label: 'Incident Explorer', href: '/dashboard/analyst/incident-explorer', icon: Search },
            ],
        });
        sections.push({ label: 'Account', items: [{ label: 'My Profile', href: '/profile', icon: UserCircle }] });
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

    if (mgmtItems.length > 0) {
        sections.push({ label: 'Management', items: mgmtItems });
    }

    // All roles get a profile link
    sections.push({ label: 'Account', items: [{ label: 'My Profile', href: '/profile', icon: UserCircle }] });

    return sections;
}
