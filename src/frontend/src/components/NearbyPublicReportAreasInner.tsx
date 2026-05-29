'use client';

import { useEffect, useMemo } from 'react';
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ReportClusterArea } from '@/lib/api/civilian';

const UserIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
    iconRetinaUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
});

function FitBounds({ points, nationalCenter }: { points: [number, number][], nationalCenter: [number, number] }) {
    const map = useMap();
    useEffect(() => {
        if (points.length === 0) {
            map.setView(nationalCenter, 5);
            return;
        }
        if (points.length === 1) {
            map.setView(points[0], 13);
            return;
        }
        const bounds = L.latLngBounds(points);
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }, [map, points, nationalCenter]);
    return null;
}

export interface NearbyPublicReportAreasInnerProps {
    anchorLat: number | null;
    anchorLon: number | null;
    areas: ReportClusterArea[];
}

export function NearbyPublicReportAreasInner({ anchorLat, anchorLon, areas }: NearbyPublicReportAreasInnerProps) {
    const defaultCenter: [number, number] = [12.8797, 121.7740]; // Philippines Center

    const allPoints: [number, number][] = useMemo(() => {
        const pts: [number, number][] = [];
        if (anchorLat !== null && anchorLon !== null) {
            pts.push([anchorLat, anchorLon]);
            areas.forEach(c => pts.push([c.latitude, c.longitude]));
            return pts;
        }
        areas.forEach(c => pts.push([c.latitude, c.longitude]));
        return pts;
    }, [anchorLat, anchorLon, areas]);

    return (
        <MapContainer
            center={anchorLat !== null && anchorLon !== null ? [anchorLat, anchorLon] : defaultCenter}
            zoom={anchorLat !== null ? 13 : 5}
            style={{ height: '100%', width: '100%', zIndex: 0 }}
            scrollWheelZoom={false}
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds points={allPoints} nationalCenter={defaultCenter} />

            {anchorLat !== null && anchorLon !== null && (
                <Marker position={[anchorLat, anchorLon]} icon={UserIcon}>
                    <Popup>Selected fire area</Popup>
                </Marker>
            )}

            {areas.map((c) => (
                <Circle
                    key={c.area_id}
                    center={[c.latitude, c.longitude]}
                    radius={c.radius_m}
                    pathOptions={{ color: '#dc2626', fillColor: '#ef4444', fillOpacity: 0.22, weight: 2 }}
                >
                    <Popup>
                        <div className="text-center p-1">
                            <strong className="text-red-700">{c.count_bucket} reports</strong>
                            <br />
                            <span className="text-xs text-gray-600">Updated: {c.age_bucket}</span>
                        </div>
                    </Popup>
                </Circle>
            ))}
        </MapContainer>
    );
}
