'use client';

import Link from 'next/link';
import { Phone, Shield, ChevronRight } from 'lucide-react';

/**
 * Compact emergency reference card — shared by the civilian report
 * and tracking pages. Shows 911 / 8888 hotlines + a link to the
 * full BFP Fire Stations reference page.
 *
 * `dark` renders it against the locked black/red/blue dark palette
 * (#111116 base, #dc2626 red) used by the restyled public-surface pages
 * (see PublicHeader.tsx). Defaults to `false` so existing callers (e.g. the
 * legacy `/tracking` shim) keep their current light appearance.
 */
export function EmergencyReferenceCard({ compact = false, dark = false }: { compact?: boolean; dark?: boolean }) {
    if (!dark) {
        return (
            <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4">
                <div className="flex items-center gap-2 mb-3">
                    <Phone className="w-4 h-4 text-red-600 flex-shrink-0" />
                    <h3 className="text-sm font-bold text-red-700">Emergency Hotlines</h3>
                </div>
                <div className={`grid gap-2 mb-3 ${compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
                    <a
                        href="tel:911"
                        className="flex items-center gap-3 p-3 rounded-lg bg-red-100 hover:bg-red-200 transition-colors"
                    >
                        <span className="text-xl font-black text-red-700">911</span>
                        <div>
                            <p className="text-xs font-semibold text-red-800">National Emergency</p>
                            <p className="text-[11px] text-red-600">Pambansang Emergency</p>
                        </div>
                    </a>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-red-100/60">
                        <span className="text-base font-black text-red-600">8888</span>
                        <div>
                            <p className="text-xs font-semibold text-red-800">Citizen&apos;s Complaint</p>
                            <p className="text-[11px] text-red-600">Reklamo ng Mamamayan</p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center justify-between">
                    <p className="text-[11px] text-red-600">
                        For immediate danger, call <strong>911</strong>. This tool does not replace an emergency call.
                    </p>
                    <Link
                        href="/fire-stations"
                        className="flex items-center gap-1 text-xs font-semibold text-red-700 hover:text-red-900 transition-colors flex-shrink-0 ml-2"
                    >
                        <Shield className="w-3 h-3" />
                        Fire Stations
                        <ChevronRight className="w-3 h-3" />
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div
            className="rounded-xl p-4"
            style={{ border: '1px solid rgba(220,38,38,0.3)', background: 'rgba(220,38,38,0.1)' }}
        >
            <div className="flex items-center gap-2 mb-3">
                <Phone className="w-4 h-4 flex-shrink-0" style={{ color: '#ef4444' }} />
                <h3 className="text-sm font-bold" style={{ color: '#ef4444' }}>Emergency Hotlines</h3>
            </div>
            <div className={`grid gap-2 mb-3 ${compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
                <a
                    href="tel:911"
                    className="flex items-center gap-3 p-3 rounded-lg transition-colors"
                    style={{ background: 'rgba(220,38,38,0.15)' }}
                >
                    <span className="text-xl font-black" style={{ color: '#ef4444' }}>911</span>
                    <div>
                        <p className="text-xs font-semibold" style={{ color: '#e8e8ed' }}>National Emergency</p>
                        <p className="text-[11px]" style={{ color: 'rgba(232,232,237,0.65)' }}>Pambansang Emergency</p>
                    </div>
                </a>
                <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'rgba(220,38,38,0.08)' }}>
                    <span className="text-base font-black" style={{ color: '#ef4444' }}>8888</span>
                    <div>
                        <p className="text-xs font-semibold" style={{ color: '#e8e8ed' }}>Citizen&apos;s Complaint</p>
                        <p className="text-[11px]" style={{ color: 'rgba(232,232,237,0.65)' }}>Reklamo ng Mamamayan</p>
                    </div>
                </div>
            </div>
            <div className="flex items-center justify-between">
                <p className="text-[11px]" style={{ color: 'rgba(232,232,237,0.65)' }}>
                    For immediate danger, call <strong>911</strong>. This tool does not replace an emergency call.
                </p>
                <Link
                    href="/fire-stations"
                    className="flex items-center gap-1 text-xs font-semibold transition-colors flex-shrink-0 ml-2"
                    style={{ color: '#ef4444' }}
                >
                    <Shield className="w-3 h-3" />
                    Fire Stations
                    <ChevronRight className="w-3 h-3" />
                </Link>
            </div>
        </div>
    );
}
