'use client';

import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { EmergencyServiceStation } from '@/lib/api';

const StationIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
    iconRetinaUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
});

function FitBounds({ points }: { points: [number, number][] }) {
    const map = useMap();
    useEffect(() => {
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
    }, [map, points]);
    return null;
}

export interface FireStationsMapInnerProps {
    stations: EmergencyServiceStation[];
}

export function FireStationsMapInner({ stations }: FireStationsMapInnerProps) {
    const points = useMemo(
        () => stations.map((s): [number, number] => [s.latitude, s.longitude]),
        [stations]
    );

    return (
        <MapContainer
            center={[12.8797, 121.7740]}
            zoom={6}
            style={{ height: '100%', width: '100%', zIndex: 0 }}
            scrollWheelZoom={false}
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds points={points} />
            {stations.map((s) => (
                <Marker key={s.station_id} position={[s.latitude, s.longitude]} icon={StationIcon}>
                    <Popup>
                        <strong>{s.station_name}</strong>
                    </Popup>
                </Marker>
            ))}
        </MapContainer>
    );
}
