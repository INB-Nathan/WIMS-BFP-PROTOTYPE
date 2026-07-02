'use client';

import { useEffect, useState } from 'react';
import { useMapEvents, MapContainer, TileLayer, CircleMarker, Marker, Popup, Circle } from 'react-leaflet';
import L from 'leaflet';
import Link from 'next/link';
import { fetchValidatorFireStations, fetchOperations, type MapClusterItem, type StationItem, type Operation } from '@/lib/api';
import { firePinIcon } from '@/components/map/leafletIcons';

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

// ── Operation status colours (mirrors OperationsMap.tsx) ─────────────────────

const OPERATION_COLORS: Record<string, string> = {
  ACTIVE: '#dc2626',
  CONTAINED: '#ea580c',
  FIRE_OUT: '#16a34a',
};

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
  const [showStations, setShowStations] = useState(false);
  const [stations, setStations] = useState<StationItem[]>([]);
  const [stationsError, setStationsError] = useState(false);
  const [showOperations, setShowOperations] = useState(false);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [operationsError, setOperationsError] = useState(false);

  // Fetch stations once on mount
  useEffect(() => {
    let cancelled = false;
    fetchValidatorFireStations()
      .then((data) => {
        if (!cancelled) setStations(data);
      })
      .catch(() => {
        if (!cancelled) setStationsError(true);
      });
    return () => { cancelled = true; };
  }, []);

  // Fetch operations once on mount
  useEffect(() => {
    let cancelled = false;
    fetchOperations()
      .then((data) => {
        if (!cancelled) setOperations(data);
      })
      .catch(() => {
        if (!cancelled) setOperationsError(true);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="relative h-full w-full">
      {/* Floating layer toggles — right side to avoid Leaflet zoom controls */}
      <div className="absolute top-3 right-3 z-[1000] flex gap-2">
        <button
          onClick={() => setShowStations((prev) => !prev)}
          className={`text-xs font-medium px-3 py-1.5 rounded-md border shadow-sm transition-colors ${
            showStations
              ? 'bg-red-700 text-white border-red-800 hover:bg-red-800'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
          }`}
          aria-label={showStations ? 'Hide fire stations' : 'Show fire stations'}
        >
          🔥 Stations{stationsError ? ' (unavailable)' : ` (${stations.length})`}
        </button>
        <button
          onClick={() => setShowOperations((prev) => !prev)}
          className={`text-xs font-medium px-3 py-1.5 rounded-md border shadow-sm transition-colors ${
            showOperations
              ? 'bg-amber-700 text-white border-amber-800 hover:bg-amber-800'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
          }`}
          aria-label={showOperations ? 'Hide operations' : 'Show operations'}
        >
          🚒 Operations{operationsError ? ' (unavailable)' : ` (${operations.length})`}
        </button>
      </div>

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

      {/* Fire station markers layer */}
      {showStations && stations.map((s) => (
        <Marker
          key={`station-${s.station_id}`}
          position={[s.latitude, s.longitude]}
          icon={firePinIcon}
        >
          <Popup>
            <div className="text-xs min-w-[120px]">
              <p className="font-semibold text-sm">{s.station_name}</p>
              {s.address && <p className="text-slate-500 mt-0.5">{s.address}</p>}
              {s.region_name && <p className="text-slate-400 mt-0.5">{s.region_name}</p>}
            </div>
          </Popup>
        </Marker>
      ))}

      {/* Active operations overlay */}
      {showOperations && operations.map((op) => (
        <Circle
          key={`op-${op.operation_id}`}
          center={[op.latitude!, op.longitude!]}
          radius={op.radius_meters || 500}
          pathOptions={{
            color: OPERATION_COLORS[op.fire_status] || '#dc2626',
            fillColor: OPERATION_COLORS[op.fire_status] || '#dc2626',
            fillOpacity: 0.28,
            weight: 1,
          }}
        >
          <Popup>
            <div className="text-xs min-w-[140px]">
              <p className="font-semibold text-sm">{op.location}</p>
              <span
                className="inline-block rounded-full px-2 py-0.5 text-xs font-medium mt-1"
                style={{ backgroundColor: OPERATION_COLORS[op.fire_status] || '#dc2626', color: '#fff' }}
              >
                {op.fire_status.replace('_', ' ')}
              </span>
              {op.size_hectares != null && <p className="text-slate-500 mt-1">Size: {op.size_hectares} ha</p>}
              <p className="text-slate-400 mt-0.5">{new Date(op.start_time).toLocaleString()}</p>
            </div>
          </Popup>
        </Circle>
      ))}

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
                {/* Drill link */}
                <Link
                  href={c.region_id ? `/dashboard/validator?status=PENDING&region_id=${c.region_id}` : '/dashboard/validator?status=PENDING'}
                  className="inline-block mt-1.5 text-[11px] font-medium text-blue-700 hover:text-blue-900 hover:underline"
                >
                  View {c.status_breakdown?.PENDING ?? 0} pending incidents →
                </Link>
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
                <Link
                  href={c.region_id ? `/dashboard/validator?status=PENDING&region_id=${c.region_id}` : '/dashboard/validator?status=PENDING'}
                  className="inline-block mt-1.5 text-[11px] font-medium text-blue-700 hover:text-blue-900 hover:underline"
                >
                  View pending incidents →
                </Link>
              </div>
            )}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
    </div>
  );
}
