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
            {c.status_breakdown ? (
              /* Rich layout with enriched AFOR data */
              <div className="text-xs min-w-[160px]">
                <p className="font-semibold text-sm mb-1">
                  AFOR Cluster — {c.count} AFOR{c.count !== 1 ? 's' : ''}
                </p>

                {/* Status breakdown */}
                {c.status_breakdown && (
                  <div className="mb-1.5">
                    <p className="text-slate-500 text-[10px] uppercase tracking-wide font-semibold mb-0.5">
                      Status
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(c.status_breakdown).map(([status, count]) =>
                        count > 0 ? (
                          <span
                            key={status}
                            className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor:
                                status === 'PENDING'
                                  ? '#fef9c3'
                                  : status === 'PENDING_VALIDATION'
                                    ? '#dbeafe'
                                    : status === 'VERIFIED'
                                      ? '#dcfce7'
                                      : '#fee2e2',
                              color:
                                status === 'PENDING'
                                  ? '#854d0e'
                                  : status === 'PENDING_VALIDATION'
                                    ? '#1e40af'
                                    : status === 'VERIFIED'
                                      ? '#166534'
                                      : '#991b1b',
                            }}
                          >
                            {count} {status.replace('_', ' ')}
                          </span>
                        ) : null
                      )}
                    </div>
                  </div>
                )}

                {/* Category badges */}
                {c.category_mix && c.category_mix.length > 0 && (
                  <p className="text-slate-500 mb-1">
                    Categories:{' '}
                    <span className="font-medium text-slate-700">
                      {c.category_mix.join(', ')}
                    </span>
                  </p>
                )}

                {/* Damage */}
                {c.total_damage_php != null && (
                  <p className="text-slate-500 mb-0.5">
                    Damage:{' '}
                    <span className="font-medium text-slate-700">
                      PHP {c.total_damage_php.toLocaleString()}
                    </span>
                  </p>
                )}

                {/* Casualties */}
                {c.total_casualties != null && c.total_casualties > 0 && (
                  <p className="text-slate-500 mb-0.5">
                    Casualties:{' '}
                    <span className="font-medium text-red-700">
                      {c.total_casualties}
                    </span>
                  </p>
                )}

                {/* Date range */}
                {c.earliest_at && c.latest_at && (
                  <p className="text-slate-400 mb-1">
                    {new Date(c.earliest_at).toLocaleDateString()} –{' '}
                    {new Date(c.latest_at).toLocaleDateString()}
                  </p>
                )}

                {/* Coordinates */}
                <p className="text-slate-400 text-[10px]">
                  {c.lat.toFixed(4)}, {c.lng.toFixed(4)}
                </p>
              </div>
            ) : (
              /* Simple fallback layout — no enriched data */
              <div className="text-xs min-w-[120px]">
                <p className="font-semibold text-sm">
                  AFOR Cluster — {c.count} AFOR{c.count !== 1 ? 's' : ''}
                </p>
                <p className="text-slate-500 mt-0.5">
                  Severity:{' '}
                  <span className="font-medium">{c.severity}</span>
                </p>
                {c.latest_at && (
                  <p className="text-slate-400 mt-0.5">
                    Latest:{' '}
                    {new Date(c.latest_at).toLocaleDateString()}
                  </p>
                )}
                <p className="text-slate-400 text-[10px] mt-0.5">
                  {c.lat.toFixed(4)}, {c.lng.toFixed(4)}
                </p>
              </div>
            )}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
