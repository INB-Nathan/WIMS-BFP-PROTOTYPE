'use client';

import { useState, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
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

function ClickHandler({ onChange }: { onChange?: (lat: number, lng: number) => void }) {
    useMapEvents({
        click(e) {
            const { lat, lng } = e.latlng;
            onChange?.(lat, lng);
        },
    });
    return null;
}

export function MapPickerInner({
    center = DEFAULT_CENTER,
    zoom = DEFAULT_ZOOM,
    value,
    onChange,
}: MapPickerInnerProps) {
    const [position, setPosition] = useState<{ lat: number; lng: number } | null>(value ?? null);

    useEffect(() => {
        setPosition(value ?? null);
    }, [value]);

    const handleChange = useCallback(
        (lat: number, lng: number) => {
            setPosition({ lat, lng });
            onChange?.(lat, lng);
        },
        [onChange]
    );

    const displayPosition = value ?? position;

    return (
        <MapContainer
            center={center}
            zoom={zoom}
            style={{ height: '500px', width: '100%' }}
            className="rounded-md z-0"
            scrollWheelZoom
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ClickHandler onChange={handleChange} />
            {displayPosition && <Marker position={[displayPosition.lat, displayPosition.lng]} />}
        </MapContainer>
    );
}
