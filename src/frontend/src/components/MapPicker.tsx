'use client';

import dynamic from 'next/dynamic';
import type L from 'leaflet';

const MapPickerInner = dynamic(() => import('./MapPickerInner').then((m) => m.MapPickerInner), {
    ssr: false,
});

export interface MapPickerProps {
    center?: [number, number];
    zoom?: number;
    value?: { lat: number; lng: number } | null;
    onChange?: (lat: number, lng: number) => void;
    mapHeight?: string;
    /** Pre-fill the search box and auto-pin to this address (forward geocode). */
    searchQuery?: string;
    /** Optional Leaflet icon for the drop pin. Defaults to BFP maroon `firePinIcon`. */
    icon?: L.Icon | L.DivIcon;
}

export function MapPicker(props: MapPickerProps) {
    return <MapPickerInner {...props} />;
}
