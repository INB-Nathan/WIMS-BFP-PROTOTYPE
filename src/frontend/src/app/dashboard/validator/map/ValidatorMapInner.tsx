'use client';

import { useEffect, useState } from 'react';
import { useMapEvents } from 'react-leaflet';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import L from 'leaflet';
import type { MapClusterItem } from '@/lib/api';

// ── Severity helpers ────────────────────────────────────────────────────────

function severityColor(severity: string): string {
  switch (severity) {
    case 'high':   return '#dc2626';
    case 'medium': return '#ea580c';
    default:       return '#eab308';
  }
}

function markerRadius(count: number, zoom: number): number {
  const zoomCap = zoom <= 7 ? 16 : zoom <= 9 ? 22 : 30;
  return Math.min(7 + Math.log2(count + 1) * 3, zoomCap);
}

function severityFillOpacity(count: number): number {
  if (count >= 20) return 0.7;
  if (count >= 10) return 0.55;
  if (count >= 5)  return 0.4;
  return 0.25;
}

// ── Props ───────────────────────────────────────────────────────────────────

interface ValidatorMapInnerProps {
  onViewportChange: (bounds: L.LatLngBounds, zoom: number) => void;
  clusters: MapClusterItem[];
}

// ── Viewport handler ────────────────────────────────────────────────────────

function ViewportHandler({
  onViewportChange,
  onZoomChange,
}: {
  onViewportChange: (bounds: L.LatLngBounds, zoom: number) => void;
  onZoomChange: (zoom: number) => void;
}) {
  const map = useMapEvents({
    moveend: () => {
      const zoom = map.getZoom();
      onZoomChange(zoom);
      onViewportChange(map.getBounds(), zoom);
    },
  });

  useEffect(() => {
    const zoom = map.getZoom();
    onZoomChange(zoom);
    onViewportChange(map.getBounds(), zoom);
  }, [map, onViewportChange, onZoomChange]);

  return null;
}

// ── Main component ──────────────────────────────────────────────────────────

export default function ValidatorMapInner({
  onViewportChange,
  clusters,
}: ValidatorMapInnerProps) {
  const [currentZoom, setCurrentZoom] = useState(10);

  return (
    <MapContainer
      center={[14.5995, 120.9842]}
      zoom={10}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <ViewportHandler onViewportChange={onViewportChange} onZoomChange={setCurrentZoom} />

      {clusters.map((c, i) => (
        <CircleMarker
          key={`${c.lat}-${c.lng}-${i}`}
          center={[c.lat, c.lng]}
          radius={markerRadius(c.count, currentZoom)}
          pathOptions={{
            color: severityColor(c.severity),
            fillColor: severityColor(c.severity),
            fillOpacity: severityFillOpacity(c.count),
            weight: 2,
          }}
        >
          <Popup>
            <div className="text-xs min-w-[120px]">
              <p className="font-semibold text-sm">
                {c.count} incident{c.count !== 1 ? 's' : ''}
              </p>
              <p className="text-slate-500 mt-0.5">
                Severity: <span className="font-medium">{c.severity}</span>
              </p>
              {c.latest_at && (
                <p className="text-slate-400 mt-0.5">
                  Latest: {new Date(c.latest_at).toLocaleDateString()}
                </p>
              )}
              <p className="text-slate-400">
                {c.lat.toFixed(4)}, {c.lng.toFixed(4)}
              </p>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
