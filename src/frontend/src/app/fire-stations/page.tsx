'use client';

// Issue #654 — Fire Stations (/fire-stations) public-surface migration.
// The shared header, footer, theme provider, and day/night toggle are supplied
// centrally by LayoutShell (which wraps this civilian route in PublicThemeProvider
// and renders PublicHeader + footer). This page is content-only: it must not
// import or configure PublicThemeProvider, nor add page-owned chrome/navigation.
// Visual treatment follows the public-surface prototype (scene 6): split map +
// directory, ps-* card chrome, token-based theming. The split-view layout (#616)
// and selection-sync behavior are preserved.

import { useEffect, useMemo, useState } from 'react';
import { Shield, Phone, MapPin, Navigation, AlertTriangle } from 'lucide-react';
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

    return (
        <div className="ps-content ps-has-mesh">
            <div className="ps-info-inner">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        <Shield className="w-6 h-6" style={{ color: 'var(--red)' }} aria-hidden="true" />
                        BFP Fire Stations
                    </h1>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                        Bureau of Fire Protection — Republic of the Philippines
                    </p>
                </div>

                <div className="ps-card">
                    <div className="flex items-center gap-2 mb-3">
                        <Phone className="w-5 h-5" style={{ color: 'var(--red)' }} aria-hidden="true" />
                        <h2 className="font-bold" style={{ color: 'var(--text-primary)' }}>Emergency Hotlines</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <a href="tel:911" className="flex items-center gap-3 p-3 rounded-[var(--radius)] bg-[var(--red-bg)] hover:opacity-90">
                            <span className="text-2xl font-black" style={{ color: 'var(--red)' }}>911</span>
                            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>National Emergency</span>
                        </a>
                        <div className="flex items-center gap-3 p-3 rounded-[var(--radius)] bg-[var(--bg-surface)]">
                            <span className="text-lg font-black" style={{ color: 'var(--red)' }}>8888</span>
                            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Citizen&apos;s Complaint</span>
                        </div>
                    </div>
                    <p className="text-xs mt-3 text-center" style={{ color: 'var(--text-secondary)' }}>
                        For life-threatening emergencies, call <strong>911</strong> immediately.
                    </p>
                </div>

                <div className="ps-card">
                    <h2 className="font-bold text-sm mb-2" style={{ color: 'var(--text-primary)' }}>About BFP</h2>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        The Bureau of Fire Protection (BFP) is the government agency mandated to prevent and suppress destructive fires, enforce the Fire Code, and respond to man-made and natural disasters and other emergencies. The BFP operates under the Department of the Interior and Local Government (DILG).
                    </p>
                    <p className="text-xs leading-relaxed mt-2" style={{ color: 'var(--text-muted)' }}>
                        Ang Kawanihan ng Pagtatanggol sa Sunog (BFP) ay ahensya ng gobyerno na may mandatong pigilan at sugpuin ang mga mapanirang sunog, ipatupad ang Fire Code, at tumugon sa mga sakuna at iba pang emergency. Ang BFP ay nasa ilalim ng DILG.
                    </p>
                </div>

                <section
                    className="rounded-[var(--radius-lg)] border overflow-hidden flex flex-col xl:flex-row xl:h-[600px]"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}
                    data-testid="station-split-view"
                >
                    {/* Map side — collapses to a fixed-height panel on top for mobile, expands to
                        fill the remaining width side-by-side with the directory on xl+ screens. */}
                    <div
                        className="relative h-64 xl:h-full xl:flex-1 border-b xl:border-b-0 xl:border-r"
                        style={{ borderColor: 'var(--border)' }}
                        id="station-map"
                    >
                        {loading ? (
                            <p className="p-5 text-sm" role="status">Loading fire stations…</p>
                        ) : failed || stations === null ? (
                            <p className="p-5 text-sm" style={{ color: 'var(--red)' }} role="alert">Failed to load fire stations. Please try again when online.</p>
                        ) : mapFailed ? (
                            <div className="p-6 text-sm" role="status">
                                <AlertTriangle className="w-5 h-5 inline mr-2" style={{ color: 'var(--orange)' }} aria-hidden="true" />
                                Map tiles are unavailable. The complete searchable station list remains available in the directory.
                            </div>
                        ) : filteredStations.length > 0 ? (
                            <div className="h-full">
                                <FireStationsMapInner stations={filteredStations} userLocation={userLocation} selectedStationId={visibleSelectedStationId} onSelectStation={selectStation} onMapError={() => setMapFailed(true)} />
                            </div>
                        ) : (
                            <p className="p-5 text-sm" style={{ color: 'var(--text-secondary)' }}>No map pins available for the current search.</p>
                        )}
                    </div>

                    {/* Directory side — scrolls independently on xl+ screens (fixed panel height);
                        on mobile it flows below the map and scrolls with the page. */}
                    <div className="xl:w-[380px] xl:flex-shrink-0 xl:h-full xl:overflow-y-auto flex flex-col min-h-0">
                        <div className="px-5 py-4 border-b flex items-center gap-2 flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
                            <Navigation className="w-4 h-4" style={{ color: 'var(--red)' }} aria-hidden="true" />
                            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Station Directory</h2>
                            {stations && <span className="text-xs ml-auto" style={{ color: 'var(--text-secondary)' }}>{filteredStations.length} of {stations.length} stations</span>}
                        </div>
                        <div className="p-4 flex-shrink-0">
                            <label htmlFor="station-search" className="sr-only">Search fire stations</label>
                            <input id="station-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search stations by name or coordinates" className="w-full rounded-[var(--radius)] border px-3 py-2 text-sm bg-[var(--bg-base)]" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
                        </div>
                        {loading && <p className="px-5 pb-5 text-sm" role="status">Loading fire stations…</p>}
                        {failed && <p className="px-5 pb-5 text-sm" style={{ color: 'var(--red)' }} role="alert">Failed to load fire stations. Please try again when online.</p>}
                        {!loading && !failed && stations && filteredStations.length === 0 && <p className="px-5 pb-5 text-sm" role="status">No fire stations match your search.</p>}
                        {filteredStations.length > 0 && <div className="divide-y max-h-[400px] xl:max-h-none overflow-y-auto xl:overflow-visible" style={{ borderColor: 'var(--border)' }}>
                            {filteredStations.map((station) => (
                                <button
                                    key={station.station_id}
                                    type="button"
                                    aria-pressed={visibleSelectedStationId === station.station_id}
                                    onClick={() => selectStation(station)}
                                    className="w-full text-left px-5 py-3 flex items-start gap-3 hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2"
                                    style={{ outlineColor: 'var(--red)' }}
                                >
                                    <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--red)' }} aria-hidden="true" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{station.station_name}</span>
                                        <span className="block text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{station.latitude.toFixed(4)}, {station.longitude.toFixed(4)}</span>
                                    </span>
                                    {station.distance_m !== null && <span className="text-xs font-semibold" style={{ color: 'var(--primary)' }}>{(station.distance_m / 1000).toFixed(1)} km</span>}
                                </button>
                            ))}
                        </div>}
                    </div>
                </section>
            </div>
        </div>
    );
}
