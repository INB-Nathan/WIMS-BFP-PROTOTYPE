'use client';

import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet';
/* leaflet.css loaded globally in app/globals.css */
import type { HeatmapGeoJSON } from '@/lib/api';

const DEFAULT_CENTER: [number, number] = [14.5995, 120.9842];
const DEFAULT_ZOOM = 6;

export interface HeatmapViewerProps {
  geojson: HeatmapGeoJSON;
  className?: string;
}

export function HeatmapViewer({ geojson, className = 'h-[400px]' }: HeatmapViewerProps) {
  const { features } = geojson;

  if (!features || features.length === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-500 ${className}`}
      >
        <p className="text-sm font-medium">No incidents to display on map</p>
      </div>
    );
  }

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      style={{ width: '100%' }}
      className={`rounded-md z-0 ${className}`}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {features.map((f, i) => {
        const coords = f.geometry?.coordinates;
        if (!coords || coords.length < 2) return null;
        const [lon, lat] = coords;
        return (
          <CircleMarker
            key={f.properties?.incident_id ?? i}
            center={[lat, lon]}
            radius={6}
            pathOptions={{ color: '#b91c1c', fillColor: '#dc2626', fillOpacity: 0.7, weight: 1 }}
          />
        );
      })}
    </MapContainer>
  );
}
