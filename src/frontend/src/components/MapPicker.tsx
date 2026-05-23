'use client';

import dynamic from 'next/dynamic';

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
}

export function MapPicker(props: MapPickerProps) {
    return <MapPickerInner {...props} />;
}
