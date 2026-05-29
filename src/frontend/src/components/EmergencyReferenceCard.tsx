'use client';

import Link from 'next/link';
import { Phone, Shield, ChevronRight } from 'lucide-react';

/**
 * Compact emergency reference card — shared by the civilian report
 * and tracking pages. Shows 911 / 8888 hotlines + a link to the
 * full BFP Fire Stations reference page.
 */
export function EmergencyReferenceCard({ compact = false }: { compact?: boolean }) {
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
