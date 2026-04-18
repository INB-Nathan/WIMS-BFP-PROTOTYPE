'use client';

import { useState, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default marker icons in react-leaflet (webpack/Next.js)
const DefaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

export interface MapPickerInnerProps {
    center?: [number, number];
    zoom?: number;
    value?: { lat: number; lng: number } | null;
    onChange?: (lat: number, lng: number) => void;
}

const DEFAULT_CENTER: [number, number] = [14.5995, 120.9842]; // Manila area
const DEFAULT_ZOOM = 10;

type GeoSuggestion = {
    lat: string;
    lon: string;
    display_name: string;
};

const PH_LOCAL_SUGGESTIONS: GeoSuggestion[] = [
    { lat: '14.5995', lon: '120.9842', display_name: 'Manila, Metro Manila, Philippines' },
    { lat: '14.6511', lon: '121.0486', display_name: 'Quezon City, Metro Manila, Philippines' },
    { lat: '14.5547', lon: '121.0244', display_name: 'Makati, Metro Manila, Philippines' },
    { lat: '14.6760', lon: '121.0437', display_name: 'Sampaloc, Manila, Philippines' },
    { lat: '14.4793', lon: '120.8969', display_name: 'Paranaque, Metro Manila, Philippines' },
    { lat: '14.5869', lon: '121.0614', display_name: 'Pasig, Metro Manila, Philippines' },
    { lat: '14.5176', lon: '121.0509', display_name: 'Taguig, Metro Manila, Philippines' },
    { lat: '10.3157', lon: '123.8854', display_name: 'Cebu City, Cebu, Philippines' },
    { lat: '7.0731', lon: '125.6128', display_name: 'Davao City, Davao del Sur, Philippines' },
    { lat: '16.4023', lon: '120.5960', display_name: 'Baguio, Benguet, Philippines' },
    { lat: '15.1460', lon: '120.5865', display_name: 'Angeles, Pampanga, Philippines' },
    { lat: '13.9411', lon: '121.1630', display_name: 'Batangas City, Batangas, Philippines' },
    { lat: '10.7202', lon: '122.5621', display_name: 'Iloilo City, Iloilo, Philippines' },
    { lat: '8.4542', lon: '124.6319', display_name: 'Cagayan de Oro, Misamis Oriental, Philippines' },
    { lat: '11.2450', lon: '125.0000', display_name: 'Tacloban, Leyte, Philippines' },
];

function mergeSuggestions(local: GeoSuggestion[], remote: GeoSuggestion[]): GeoSuggestion[] {
    const seen = new Set<string>();
    const combined = [...local, ...remote];
    return combined.filter((item) => {
        const key = item.display_name.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function ClickHandler({ onChange }: { onChange?: (lat: number, lng: number) => void }) {
    useMapEvents({
        click(e) {
            const { lat, lng } = e.latlng;
            onChange?.(lat, lng);
        },
    });
    return null;
}

function RecenterMap({ center }: { center: [number, number] }) {
    const map = useMap();

    useEffect(() => {
        map.setView(center, map.getZoom(), { animate: true });
    }, [center, map]);

    return null;
}

export function MapPickerInner({
    center = DEFAULT_CENTER,
    zoom = DEFAULT_ZOOM,
    value,
    onChange,
}: MapPickerInnerProps) {
    const [position, setPosition] = useState<{ lat: number; lng: number } | null>(value ?? null);
    const [mapCenter, setMapCenter] = useState<[number, number]>(
        value ? [value.lat, value.lng] : center
    );
    const [searchText, setSearchText] = useState('');
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [suggestions, setSuggestions] = useState<GeoSuggestion[]>([]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => {
        setPosition(value ?? null);
        if (value) {
            setMapCenter([value.lat, value.lng]);
        }
    }, [value]);

    const handleChange = useCallback(
        (lat: number, lng: number) => {
            setPosition({ lat, lng });
            setMapCenter([lat, lng]);
            onChange?.(lat, lng);
        },
        [onChange]
    );

    const handleSearch = useCallback(async () => {
        const q = searchText.trim();
        if (!q) {
            setSearchError('Enter a location to search.');
            return;
        }

        setSearching(true);
        setSearchError(null);
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ph&limit=1&q=${encodeURIComponent(q)}`;
            const response = await fetch(url, {
                headers: {
                    Accept: 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error('Search request failed.');
            }

            const data = (await response.json()) as Array<{ lat: string; lon: string }>;
            const first = data[0];
            if (!first) {
                setSearchError('No location found. Try a more specific place name.');
                return;
            }

            const lat = Number(first.lat);
            const lng = Number(first.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                setSearchError('Unable to read coordinates from search result.');
                return;
            }

            handleChange(lat, lng);
        } catch {
            setSearchError('Search failed. Please try again.');
        } finally {
            setSearching(false);
        }
    }, [handleChange, searchText]);

    useEffect(() => {
        const q = searchText.trim();
        if (q.length < 2) {
            setSuggestions([]);
            return;
        }

        const local = PH_LOCAL_SUGGESTIONS.filter((entry) =>
            entry.display_name.toLowerCase().includes(q.toLowerCase())
        ).slice(0, 5);
        setSuggestions(local);

        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            try {
                const suggestUrl = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ph&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`;
                const response = await fetch(suggestUrl, {
                    signal: controller.signal,
                    headers: {
                        Accept: 'application/json',
                    },
                });
                if (!response.ok) return;
                const data = (await response.json()) as GeoSuggestion[];
                setSuggestions((prev) => mergeSuggestions(prev.length ? prev : local, data).slice(0, 7));
            } catch {
                // Keep local suggestions when network lookup fails.
                setSuggestions(local);
            }
        }, 300);

        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [searchText]);

    const displayPosition = value ?? position;

    return (
        <div className="space-y-2">
            <div className="flex flex-col md:flex-row gap-2">
                <input
                    type="text"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleSearch();
                        }
                    }}
                    placeholder="Search place/address to set marker"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
                <button
                    type="button"
                    onClick={() => void handleSearch()}
                    disabled={searching}
                    className="px-4 py-2 text-sm font-semibold text-white rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-70"
                >
                    {searching ? 'Searching...' : 'Search'}
                </button>
            </div>
            {searchText.trim().length > 0 && searchText.trim().length < 2 && (
                <p className="text-xs text-gray-600">Type at least 2 characters to see Philippines suggestions.</p>
            )}
            {suggestions.length > 0 && (
                <div className="border border-gray-200 rounded bg-white">
                    {suggestions.map((s, idx) => (
                        <button
                            key={`${s.lat}-${s.lon}-${idx}`}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                            onClick={() => {
                                setSearchText(s.display_name);
                                setSuggestions([]);
                                const lat = Number(s.lat);
                                const lng = Number(s.lon);
                                if (Number.isFinite(lat) && Number.isFinite(lng)) {
                                    handleChange(lat, lng);
                                }
                            }}
                        >
                            {s.display_name}
                        </button>
                    ))}
                </div>
            )}
            {searchError && <p className="text-xs text-red-600">{searchError}</p>}

            <MapContainer
                center={mapCenter}
                zoom={zoom}
                style={{ height: '500px', width: '100%' }}
                className="rounded-md z-0"
                scrollWheelZoom
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <RecenterMap center={mapCenter} />
                <ClickHandler onChange={handleChange} />
                {displayPosition && <Marker position={[displayPosition.lat, displayPosition.lng]} />}
            </MapContainer>
        </div>
    );
}
