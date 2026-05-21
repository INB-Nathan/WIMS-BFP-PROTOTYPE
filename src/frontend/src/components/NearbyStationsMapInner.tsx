'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { FireStation } from '@/lib/api';

// Fix default marker icons in react-leaflet (webpack/Next.js)
const DefaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
});

const IncidentIcon = L.icon({
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
        if (points.length === 0) return;
        if (points.length === 1) {
            map.setView(points[0], 14);
            return;
        }
        const bounds = L.latLngBounds(points);
        map.fitBounds(bounds, { padding: [40, 40] });
    }, [map, points]);
    return null;
}

export interface NearbyStationsMapInnerProps {
    reportLat: number;
    reportLon: number;
    stations: FireStation[];
}

export function NearbyStationsMapInner({ reportLat, reportLon, stations }: NearbyStationsMapInnerProps) {
    const reportPos: [number, number] = [reportLat, reportLon];
    const allPoints: [number, number][] = [
        reportPos,
        ...stations.map((s): [number, number] => [s.latitude, s.longitude]),
    ];

    return (
        <div className="space-y-3">
            <div style={{ borderRadius: '0.5rem', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                <MapContainer
                    center={reportPos}
                    zoom={13}
                    style={{ height: '300px', width: '100%' }}
                    className="z-0"
                    scrollWheelZoom={false}
                >
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <FitBounds points={allPoints} />
                    <Marker position={reportPos} icon={IncidentIcon}>
                        <Popup>Your reported location</Popup>
                    </Marker>
                    {stations.map((s) => (
                        <Marker key={s.station_id} position={[s.latitude, s.longitude]} icon={DefaultIcon}>
                            <Popup>
                                <strong>{s.station_name}</strong>
                                {s.address && <><br />{s.address}</>}
                                {s.distance_m !== null && (
                                    <><br />{(s.distance_m / 1000).toFixed(1)} km away</>
                                )}
                            </Popup>
                        </Marker>
                    ))}
                </MapContainer>
            </div>

            {stations.length > 0 && (
                <ul className="space-y-1">
                    {stations.map((s, i) => (
                        <li key={s.station_id} className="flex items-start gap-3 text-sm py-2 border-b last:border-b-0" style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                            <div className="min-w-0">
                                <p className="font-medium leading-snug">{s.station_name}</p>
                                {s.address && <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{s.address}</p>}
                            </div>
                            {s.distance_m !== null && (
                                <span className="ml-auto flex-shrink-0 text-xs font-semibold text-blue-600">
                                    {(s.distance_m / 1000).toFixed(1)} km
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
