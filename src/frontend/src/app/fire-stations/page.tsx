'use client';

import { useEffect, useMemo, useState } from 'react';
import { Shield, Phone, MapPin, Navigation, ChevronLeft, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { fetchEmergencyServices } from '@/lib/api';
import type { EmergencyServiceStation } from '@/lib/api';

const FireStationsMapInner = dynamic(
    () => import('./FireStationsMapInner').then((m) => m.FireStationsMapInner),
    { ssr: false },
);

export default function FireStationsPage() {
    const [stations, setStations] = useState<EmergencyServiceStation[] | null>(null);
    const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
    const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
    const [query, setQuery] = useState('');
    const [failed, setFailed] = useState(false);
    const [mapFailed, setMapFailed] = useState(false);
    const [showMap, setShowMap] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchEmergencyServices()
            .then((res) => setStations(res.stations))
            .catch(() => setFailed(true))
            .finally(() => setLoading(false));
    }, []);

    // Location is display-only and optional. It never changes the nationwide list.
    useEffect(() => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => setUserLocation([coords.latitude, coords.longitude]),
            () => undefined,
            { timeout: 10_000, maximumAge: 30_000 },
        );
    }, []);

    const filteredStations = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!stations) return [];
        if (!normalized) return stations;
        return stations.filter((station) =>
            `${station.station_name} ${station.latitude} ${station.longitude}`.toLowerCase().includes(normalized),
        );
    }, [stations, query]);

    const visibleSelectedStationId = filteredStations.some(
        (station) => station.station_id === selectedStationId,
    )
        ? selectedStationId
        : null;

    const selectStation = (station: EmergencyServiceStation) => setSelectedStationId(station.station_id);
    const toggleMap = () => {
        setShowMap((visible) => {
            const nextVisible = !visible;
            if (nextVisible) {
                setMapFailed(false);
            }
            return nextVisible;
        });
    };

    return (
        <div className="min-h-screen" style={{ background: 'var(--content-bg)' }}>
            <div className="text-center py-8 px-4" style={{ background: 'var(--bfp-gradient)' }}>
                <Shield className="w-12 h-12 mx-auto mb-3 text-white/90" />
                <h1 className="text-2xl font-bold text-white">BFP Fire Stations</h1>
                <p className="text-xs text-white/60 mt-1">Bureau of Fire Protection — Republic of the Philippines</p>
                <p className="text-xs text-white/50 mt-0.5">Kawanihan ng Pagtatanggol sa Sunog</p>
            </div>

            <div className="max-w-3xl mx-auto px-4 -mt-4">
                <div className="rounded-xl border-2 border-red-200 bg-red-50 p-5 mb-6">
                    <div className="flex items-center gap-2 mb-3"><Phone className="w-5 h-5 text-red-600" /><h2 className="font-bold text-red-700">Emergency Hotlines</h2></div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <a href="tel:911" className="flex items-center gap-3 p-3 rounded-lg bg-red-100 hover:bg-red-200"><span className="text-2xl font-black text-red-700">911</span><span className="text-sm font-semibold text-red-800">National Emergency</span></a>
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-red-100/60"><span className="text-lg font-black text-red-600">8888</span><span className="text-sm font-semibold text-red-800">Citizen&apos;s Complaint</span></div>
                    </div>
                    <p className="text-xs text-red-600 mt-3 text-center">For life-threatening emergencies, call <strong>911</strong> immediately.</p>
                </div>
            </div>
            <div className="max-w-3xl mx-auto px-4 mb-6">
                <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)' }}>
                    <h2 className="font-bold text-sm mb-2" style={{ color: 'var(--text-primary)' }}>About BFP</h2>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        The Bureau of Fire Protection (BFP) is the government agency mandated to prevent and suppress destructive fires, enforce the Fire Code, and respond to man-made and natural disasters and other emergencies. The BFP operates under the Department of the Interior and Local Government (DILG).
                    </p>
                    <p className="text-xs leading-relaxed mt-2" style={{ color: 'var(--bilingual-color)' }}>
                        Ang Kawanihan ng Pagtatanggol sa Sunog (BFP) ay ahensya ng gobyerno na may mandatong pigilan at sugpuin ang mga mapanirang sunog, ipatupad ang Fire Code, at tumugon sa mga sakuna at iba pang emergency. Ang BFP ay nasa ilalim ng DILG.
                    </p>
                </div>
            </div>

            <main className="max-w-5xl mx-auto px-4 pb-8">
                <section className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)' }}>
                    <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: 'var(--border-color)' }}>
                        <Navigation className="w-4 h-4" style={{ color: 'var(--bfp-maroon)' }} />
                        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Station Directory</h2>
                        {stations && <span className="text-xs ml-auto">{filteredStations.length} of {stations.length} stations</span>}
                    </div>
                    <div className="p-4">
                        <label htmlFor="station-search" className="sr-only">Search fire stations</label>
                        <input id="station-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search stations by name or coordinates" className="w-full rounded-lg border px-3 py-2 text-sm" />
                    </div>
                    {loading && <p className="px-5 pb-5 text-sm" role="status">Loading fire stations…</p>}
                    {failed && <p className="px-5 pb-5 text-sm text-red-600" role="alert">Failed to load fire stations. Please try again when online.</p>}
                    {!loading && !failed && stations && filteredStations.length === 0 && <p className="px-5 pb-5 text-sm" role="status">No fire stations match your search.</p>}
                    {filteredStations.length > 0 && <div className="divide-y max-h-[400px] overflow-y-auto">
                        {filteredStations.map((station) => <button key={station.station_id} type="button" aria-pressed={visibleSelectedStationId === station.station_id} onClick={() => selectStation(station)} className="w-full text-left px-5 py-3 flex items-start gap-3 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600">
                            <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--bfp-maroon)' }} />
                            <span className="min-w-0 flex-1"><span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{station.station_name}</span><span className="block text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{station.latitude.toFixed(4)}, {station.longitude.toFixed(4)}</span></span>
                            {station.distance_m !== null && <span className="text-xs font-semibold text-blue-600">{(station.distance_m / 1000).toFixed(1)} km</span>}
                        </button>)}
                    </div>}
                </section>

                <section className="mt-4">
                    <button type="button" aria-expanded={showMap} aria-controls="station-map" onClick={toggleMap} className="w-full rounded-xl border px-5 py-3 flex items-center gap-2 text-left" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)' }}>
                        <MapPin className="w-4 h-4" style={{ color: 'var(--bfp-maroon)' }} /><span className="text-sm font-semibold">{showMap ? 'Hide map' : 'Show map'}</span>{stations && <span className="text-xs ml-auto">{stations.length} pins</span>}
                    </button>
                    {showMap && <div id="station-map" className="mt-2 rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                        {loading ? <p className="p-5 text-sm" role="status">Loading fire stations…</p> : failed || stations === null ? <p className="p-5 text-sm text-red-600" role="alert">Failed to load fire stations. Please try again when online.</p> : mapFailed ? <div className="p-6 text-sm" role="status"><AlertTriangle className="w-5 h-5 text-amber-600 inline mr-2" />Map tiles are unavailable. The complete searchable station list remains available above.</div> : filteredStations.length > 0 ? <div className="h-[450px]"><FireStationsMapInner stations={filteredStations} userLocation={userLocation} selectedStationId={visibleSelectedStationId} onSelectStation={selectStation} onMapError={() => setMapFailed(true)} /></div> : <p className="p-5 text-sm">No map pins available for the current search.</p>}
                    </div>}
                </section>
            </main>
            <div className="text-center pb-8 px-4"><Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--bfp-red, #dc2626)' }}><ChevronLeft className="w-4 h-4" />Back to Report Emergency</Link></div>
        </div>
    );
}
