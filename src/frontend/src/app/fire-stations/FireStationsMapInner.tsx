'use client';

import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { firePinIcon, userLocationIcon } from '@/components/map/leafletIcons';
import type { EmergencyServiceStation } from '@/lib/api';

// Marker uses the centralized BFP maroon `firePinIcon` from `leafletIcons.ts`.
// Replaces the previous hardcoded third-party PNG URL so the icon matches every
// other map in the app (public fire map, map picker, validator/analyst maps),
// stays self-hosted (no CSP / raw.githubusercontent.com dependency), and follows
// the project's `divIcon`-first convention for fire/incident markers.
const StationIcon = firePinIcon;

function FitBounds({
    points,
    userLocation,
    selectedStation,
}: {
    points: [number, number][];
    userLocation?: [number, number] | null;
    selectedStation?: EmergencyServiceStation | null;
}) {
    const map = useMap();
    useEffect(() => {
        if (selectedStation) {
            map.setView([selectedStation.latitude, selectedStation.longitude], 14);
            return;
        }
        if (userLocation) {
            map.setView(userLocation, 12);
            return;
        }
        if (points.length === 0) {
            map.setView([12.8797, 121.7740], 6);
            return;
        }
        if (points.length === 1) {
            map.setView(points[0], 14);
            return;
        }
        const bounds = L.latLngBounds(points);
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    }, [map, points, userLocation, selectedStation]);
    return null;
}

export interface FireStationsMapInnerProps {
    stations: EmergencyServiceStation[];
    userLocation?: [number, number] | null;
    selectedStationId?: number | null;
    onSelectStation?: (station: EmergencyServiceStation) => void;
    onMapError?: () => void;
}

export function FireStationsMapInner({
    stations,
    userLocation = null,
    selectedStationId = null,
    onSelectStation,
    onMapError,
}: FireStationsMapInnerProps) {
    const points = useMemo(
        () => stations.map((s): [number, number] => [s.latitude, s.longitude]),
        [stations]
    );

    return (
        <MapContainer
            center={userLocation ?? [12.8797, 121.7740]}
            zoom={userLocation ? 12 : 6}
            style={{ height: '100%', width: '100%', zIndex: 0 }}
            scrollWheelZoom={false}
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                eventHandlers={{ tileerror: onMapError }}
            />
            <FitBounds
                points={points}
                userLocation={userLocation}
                selectedStation={stations.find((station) => station.station_id === selectedStationId)}
            />
            {userLocation && (
                <Marker position={userLocation} icon={userLocationIcon}>
                    <Popup>Your location</Popup>
                </Marker>
            )}
            {stations.map((s) => (
                <Marker
                    key={s.station_id}
                    position={[s.latitude, s.longitude]}
                    icon={StationIcon}
                    opacity={selectedStationId === null || selectedStationId === s.station_id ? 1 : 0.55}
                    eventHandlers={{ click: () => onSelectStation?.(s) }}
                >
                    <Popup>
                        <button type="button" onClick={() => onSelectStation?.(s)} className="font-semibold underline">
                            {s.station_name}
                        </button>
                    </Popup>
                </Marker>
            ))}
        </MapContainer>
    );
}
