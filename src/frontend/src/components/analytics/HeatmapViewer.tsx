'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet';
import { Maximize2, Minimize2 } from 'lucide-react';
/* leaflet.css loaded globally in app/globals.css */
import type { HeatmapGeoJSON } from '@/lib/api';

const DEFAULT_CENTER: [number, number] = [14.5995, 120.9842];
const DEFAULT_ZOOM = 6;

export interface HeatmapViewerProps {
  geojson: HeatmapGeoJSON;
  className?: string;
  emptyMessage?: string;
}

export function HeatmapViewer({
  geojson,
  className = 'h-[400px]',
  emptyMessage = 'No incidents to display on map',
}: HeatmapViewerProps) {
  const { features } = geojson;
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  const renderMap = (mapClassName: string) => {
    if (!features || features.length === 0) {
      return (
        <div className={`flex items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-500 ${mapClassName}`}>
          <p className="text-sm font-medium">{emptyMessage}</p>
        </div>
      );
    }

    return (
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        style={{ width: '100%' }}
        className={`rounded-md z-0 ${mapClassName}`}
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
  };

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          className="absolute right-3 top-3 z-[500] inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white/95 px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
          aria-label="Open heatmap fullscreen"
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          Fullscreen
        </button>
        {renderMap(className)}
      </div>

      {fullscreen && (
        <div
          className="fixed z-[100] bg-black/70 p-4 sm:p-6"
          role="dialog" aria-modal="true" aria-label="Fullscreen heatmap"
          style={{ top: 'var(--header-height)', left: 'var(--sidebar-width)', right: 0, bottom: 0 }}
        >
          <div className="relative h-full w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="absolute right-4 top-4 z-[500] inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white/95 px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
              aria-label="Exit heatmap fullscreen"
            >
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
              Exit fullscreen
            </button>
            <div className="h-full p-4 pt-16 sm:p-6 sm:pt-20">
              {renderMap('h-full min-h-[320px]')}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
