'use client';

import { useEffect, useState } from 'react';
import { Shield, Phone, MapPin, Navigation, ChevronLeft, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { fetchEmergencyServices } from '@/lib/api';
import type { EmergencyServiceStation } from '@/lib/api';

const FireStationsMapInner = dynamic(
    () => import('./FireStationsMapInner').then((m) => m.FireStationsMapInner),
    { ssr: false }
);

export default function FireStationsPage() {
    const [stations, setStations] = useState<EmergencyServiceStation[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchEmergencyServices()
            .then((res) => {
                setStations(res.stations);
            })
            .catch(() => setFailed(true))
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="min-h-screen" style={{ background: 'var(--content-bg)' }}>
            {/* Hero */}
            <div className="text-center py-8 px-4" style={{ background: 'var(--bfp-gradient)' }}>
                <Shield className="w-12 h-12 mx-auto mb-3 text-white/90" />
                <h1 className="text-2xl font-bold text-white">BFP Fire Stations</h1>
                <p className="text-xs text-white/60 mt-1">
                    Bureau of Fire Protection — Republic of the Philippines
                </p>
                <p className="text-xs text-white/50 mt-0.5">
                    Kawanihan ng Pagtatanggol sa Sunog
                </p>
            </div>

            {/* Emergency Numbers */}
            <div className="max-w-3xl mx-auto px-4 -mt-4">
                <div className="rounded-xl border-2 border-red-200 bg-red-50 p-5 mb-6">
                    <div className="flex items-center gap-2 mb-3">
                        <Phone className="w-5 h-5 text-red-600 flex-shrink-0" />
                        <h2 className="font-bold text-red-700">Emergency Hotlines</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <a
                            href="tel:911"
                            className="flex items-center gap-3 p-3 rounded-lg bg-red-100 hover:bg-red-200 transition-colors"
                        >
                            <span className="text-2xl font-black text-red-700">911</span>
                            <div>
                                <p className="text-sm font-semibold text-red-800">National Emergency</p>
                                <p className="text-xs text-red-600">Pambansang Emergency</p>
                            </div>
                        </a>
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-red-100/60">
                            <span className="text-lg font-black text-red-600">8888</span>
                            <div>
                                <p className="text-sm font-semibold text-red-800">Citizen&apos;s Complaint</p>
                                <p className="text-xs text-red-600">Reklamo ng Mamamayan</p>
                            </div>
                        </div>
                    </div>
                    <p className="text-xs text-red-600 mt-3 text-center">
                        For life-threatening emergencies, call {''}
                        <strong>911</strong> immediately. This tool does not replace an emergency call.
                    </p>
                </div>
            </div>

            {/* BFP Info */}
            <div className="max-w-3xl mx-auto px-4 mb-6">
                <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)' }}>
                    <h2 className="font-bold text-sm mb-2" style={{ color: 'var(--text-primary)' }}>About BFP</h2>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        The Bureau of Fire Protection (BFP) is the government agency mandated to prevent and suppress
                        destructive fires, enforce the Fire Code, and respond to man-made and natural disasters and
                        other emergencies. The BFP operates under the Department of the Interior and Local Government
                        (DILG).
                    </p>
                    <p className="text-xs leading-relaxed mt-2" style={{ color: 'var(--bilingual-color)' }}>
                        Ang Kawanihan ng Pagtatanggol sa Sunog (BFP) ay ahensya ng gobyerno na may mandatong
                        pigilan at sugpuin ang mga mapanirang sunog, ipatupad ang Fire Code, at tumugon sa mga
                        sakuna at iba pang emergency. Ang BFP ay nasa ilalim ng DILG.
                    </p>
                </div>
            </div>

            {/* Map */}
            <div className="max-w-5xl mx-auto px-4 mb-8">
                <div className="rounded-xl border overflow-hidden shadow-sm" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)' }}>
                        <MapPin className="w-4 h-4" style={{ color: 'var(--bfp-maroon)' }} />
                        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            All Fire Stations Nationwide
                        </span>
                        {stations !== null && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium ml-auto">
                                {stations.length} stations
                            </span>
                        )}
                    </div>
                    <div className="h-[450px] relative">
                        {loading && (
                            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-sm">
                                <div className="w-8 h-8 border-4 border-[var(--bfp-maroon)] border-t-transparent rounded-full animate-spin"></div>
                            </div>
                        )}
                        {failed ? (
                            <div className="h-full flex items-center justify-center" style={{ backgroundColor: 'var(--content-bg)' }}>
                                <div className="text-center">
                                    <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                                    <p className="text-sm text-red-600">Failed to load fire stations.</p>
                                </div>
                            </div>
                        ) : stations && stations.length > 0 ? (
                            <FireStationsMapInner stations={stations} />
                        ) : stations && stations.length === 0 ? (
                            <div className="h-full flex items-center justify-center" style={{ backgroundColor: 'var(--content-bg)' }}>
                                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                    No fire stations found in the database.
                                </p>
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* Station list */}
                {stations && stations.length > 0 && (
                    <div className="mt-4 rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                        <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)' }}>
                            <Navigation className="w-4 h-4" style={{ color: 'var(--bfp-maroon)' }} />
                            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                Station Directory
                            </span>
                        </div>
                        <div className="divide-y" style={{ borderColor: 'var(--border-color)', maxHeight: '400px', overflowY: 'auto' }}>
                            {stations.map((s) => (
                                <div key={s.station_id} className="px-5 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors">
                                    <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--bfp-maroon)' }} />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                            {s.station_name}
                                        </p>
                                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                                            {s.latitude.toFixed(4)}, {s.longitude.toFixed(4)}
                                        </p>
                                    </div>
                                    {s.distance_m !== null && (
                                        <span className="text-xs font-semibold text-blue-600 flex-shrink-0 mt-0.5">
                                            {(s.distance_m / 1000).toFixed(1)} km
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Footer nav */}
            <div className="text-center pb-8 px-4">
                <Link
                    href="/"
                    className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
                    style={{ color: 'var(--bfp-red, #dc2626)' }}
                >
                    <ChevronLeft className="w-4 h-4" />
                    Back to Report Emergency
                </Link>
            </div>
        </div>
    );
}
