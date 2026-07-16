'use client';

/**
 * Disposable #637 drawing prototype. All incident/report context below is
 * synthetic; this component deliberately does not import or call an API client.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMapEvents,
  ZoomControl,
} from 'react-leaflet';
import L from 'leaflet';
import {
  Check,
  Copy,
  Crosshair,
  Download,
  Eraser,
  MapPin,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import { firePinIcon } from '@/components/map/leafletIcons';

type Vertex = { lat: number; lng: number };

type PrototypeFeature = {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  properties: {
    perimeter_id: number;
    incident_id: number;
    gis_acres: number;
    map_method: 'MANUAL_DRAW';
    created_by: string;
    created_at: string;
    updated_at: string;
    linked_reports: number[];
  };
};

const INCIDENT_CENTER: [number, number] = [14.0534, 121.0537];
const SNAP_DISTANCE_PX = 14;
const EARTH_RADIUS_METERS = 6_371_008.8;

// Lightweight client-side reverse-geocode for the prototype (no backend).
// Bounding boxes cover CALABARZON + NCR; anything else falls back to the
// nearest known centroid. Production must use an authoritative geocoder.
interface LocationBox {
  province: string;
  region: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}
const LOCATION_BOXES: LocationBox[] = [
  { province: 'Metro Manila', region: 'National Capital Region', minLat: 14.42, maxLat: 14.85, minLng: 120.92, maxLng: 121.15 },
  { province: 'Rizal', region: 'CALABARZON', minLat: 14.42, maxLat: 14.78, minLng: 121.15, maxLng: 121.55 },
  { province: 'Laguna', region: 'CALABARZON', minLat: 14.05, maxLat: 14.45, minLng: 121.0, maxLng: 121.55 },
  { province: 'Quezon', region: 'CALABARZON', minLat: 13.45, maxLat: 14.45, minLng: 121.55, maxLng: 122.35 },
  { province: 'Batangas', region: 'CALABARZON', minLat: 13.55, maxLat: 14.18, minLng: 120.55, maxLng: 121.3 },
  { province: 'Cavite', region: 'CALABARZON', minLat: 14.05, maxLat: 14.45, minLng: 120.55, maxLng: 121.05 },
];
const FALLBACK_LOCATION = { province: 'Batangas', region: 'CALABARZON' };

function locationForLatLng(lat: number, lng: number): { province: string; region: string } {
  const hit = LOCATION_BOXES.find(
    (box) => lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng,
  );
  return hit ? { province: hit.province, region: hit.region } : FALLBACK_LOCATION;
}

const SYNTHETIC_REPORTS = [
  { id: 901, position: [14.0548, 121.0514] as [number, number], label: 'Civilian report #901' },
  { id: 902, position: [14.0518, 121.0561] as [number, number], label: 'Civilian report #902' },
  { id: 903, position: [14.0552, 121.0564] as [number, number], label: 'Civilian report #903' },
];

function toPositions(vertices: Vertex[]): [number, number][] {
  return vertices.map((vertex) => [vertex.lat, vertex.lng]);
}

/**
 * Local planar approximation for a live UI preview only. Production must use
 * PostGIS as the authoritative source for validated area and geometry.
 */
function areaHectares(vertices: Vertex[]): number {
  if (vertices.length < 3) return 0;
  const meanLatitude =
    vertices.reduce((total, vertex) => total + vertex.lat, 0) / vertices.length;
  const cosLatitude = Math.cos((meanLatitude * Math.PI) / 180);
  const projected = vertices.map((vertex) => ({
    x: (vertex.lng * Math.PI * EARTH_RADIUS_METERS * cosLatitude) / 180,
    y: (vertex.lat * Math.PI * EARTH_RADIUS_METERS) / 180,
  }));

  let doubleArea = 0;
  for (let index = 0; index < projected.length; index += 1) {
    const next = projected[(index + 1) % projected.length];
    const current = projected[index];
    doubleArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(doubleArea) / 2 / 10_000;
}

function DrawInteraction({
  vertices,
  closed,
  onAddVertex,
  onClose,
}: {
  vertices: Vertex[];
  closed: boolean;
  onAddVertex: (vertex: Vertex) => void;
  onClose: () => void;
}) {
  const map = useMapEvents({
    click(event) {
      if (closed) return;
      const clickPoint = map.latLngToContainerPoint(event.latlng);
      const snappedVertex = vertices.find((vertex) => {
        const point = map.latLngToContainerPoint([vertex.lat, vertex.lng]);
        return point.distanceTo(clickPoint) <= SNAP_DISTANCE_PX;
      });

      if (snappedVertex && vertices.length >= 3 && snappedVertex === vertices[0]) {
        onClose();
        return;
      }
      onAddVertex(snappedVertex ?? { lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });

  return null;
}

export default function PerimeterDrawInner() {
  const [vertices, setVertices] = useState<Vertex[]>([]);
  const [closed, setClosed] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [exportMessage, setExportMessage] = useState('');

  const hectares = useMemo(() => areaHectares(vertices), [vertices]);
  const canClose = vertices.length >= 3 && !closed;
  const canExport = vertices.length >= 3 && closed;

  // Centroid of the drawn polygon (or the incident seed before drawing) —
  // drives the dynamic location readout.
  const centroid = useMemo<[number, number]>(() => {
    if (vertices.length === 0) return INCIDENT_CENTER;
    const sumLat = vertices.reduce((total, vertex) => total + vertex.lat, 0);
    const sumLng = vertices.reduce((total, vertex) => total + vertex.lng, 0);
    return [sumLat / vertices.length, sumLng / vertices.length];
  }, [vertices]);

  const location = useMemo(
    () => locationForLatLng(centroid[0], centroid[1]),
    [centroid],
  );
  const feature = useMemo<PrototypeFeature | null>(() => {
    if (!canExport) return null;
    const ring = [...vertices, vertices[0]].map((vertex) => [vertex.lng, vertex.lat]);
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {
        perimeter_id: -482,
        incident_id: 482,
        gis_acres: Number((hectares * 2.47105).toFixed(4)),
        map_method: 'MANUAL_DRAW',
        province: location.province,
        region: location.region,
        created_by: 'prototype-validator',
        created_at: '2026-07-16T08:30:00Z',
        updated_at: '2026-07-16T08:30:00Z',
        linked_reports: SYNTHETIC_REPORTS.map((report) => report.id),
      },
    };
  }, [canExport, hectares, vertices, location]);

  const addVertex = useCallback(
    (vertex: Vertex) => {
      if (closed) return;
      setVertices((current) => [...current, vertex]);
      setExportMessage('');
    },
    [closed],
  );

  const closePolygon = useCallback(() => {
    if (vertices.length < 3) return;
    setClosed(true);
    setPreviewVisible(true);
    setExportMessage('Polygon closed. Review the GeoJSON before production submission is implemented.');
  }, [vertices.length]);

  const undoLastVertex = useCallback(() => {
    if (vertices.length === 0) return;
    setClosed(false);
    setVertices((current) => current.slice(0, -1));
    setPreviewVisible(false);
    setExportMessage('');
  }, [vertices.length]);

  const clearPolygon = useCallback(() => {
    setVertices([]);
    setClosed(false);
    setPreviewVisible(false);
    setExportMessage('Drawing cleared.');
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      undoLastVertex();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoLastVertex]);

  async function exportGeoJson() {
    if (!feature) return;
    const text = JSON.stringify(feature, null, 2);
    setPreviewVisible(true);
    try {
      await navigator.clipboard.writeText(text);
      setExportMessage('GeoJSON copied to clipboard. This prototype does not submit it.');
    } catch {
      setExportMessage('GeoJSON is ready below. Copy it manually; clipboard access was unavailable.');
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100 lg:flex-row">
      <section className="relative min-h-[52vh] flex-1 overflow-hidden border-b border-slate-200 lg:min-h-0 lg:border-b-0 lg:border-r">
        <div className="absolute left-3 top-3 z-[1000] max-w-[19rem] rounded-md border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <Crosshair className="h-4 w-4 text-[#991B1B]" aria-hidden="true" />
            {closed ? 'Perimeter closed — inspect before export' : 'Click map to place perimeter vertices'}
          </div>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">
            Click the amber first vertex to close. Existing vertices snap within {SNAP_DISTANCE_PX}px.
          </p>
        </div>

        <div className="absolute bottom-3 left-3 z-[1000] flex items-center gap-2 rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#991B1B]" aria-hidden="true" />
          Validated incident
          <span className="mx-1 h-4 border-l border-slate-200" aria-hidden="true" />
          <MapPin className="h-3.5 w-3.5 text-[#991B1B]" aria-hidden="true" />
          Civilian report
        </div>

        <MapContainer
          center={INCIDENT_CENTER}
          zoom={14}
          style={{ height: '100%', minHeight: '420px', width: '100%' }}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ZoomControl position="topright" />
          <DrawInteraction
            vertices={vertices}
            closed={closed}
            onAddVertex={addVertex}
            onClose={closePolygon}
          />

          <Circle
            center={INCIDENT_CENTER}
            radius={310}
            pathOptions={{ color: '#991B1B', fillColor: '#991B1B', fillOpacity: 0.08, weight: 2 }}
          >
            <Popup>
              <div className="min-w-[180px] text-xs">
                <p className="font-semibold text-sm text-slate-800">Synthetic incident #482</p>
                <p className="mt-1 text-slate-500">Validated brush fire · {location.province}, {location.region}</p>
                <p className="mt-1 text-slate-400">Context only — no live incident data.</p>
              </div>
            </Popup>
          </Circle>

          {SYNTHETIC_REPORTS.map((report) => (
            <Marker key={report.id} position={report.position} icon={firePinIcon}>
              <Popup>
                <div className="min-w-[150px] text-xs">
                  <p className="font-semibold text-slate-800">{report.label}</p>
                  <p className="mt-1 text-slate-500">Synthetic civilian signal</p>
                </div>
              </Popup>
            </Marker>
          ))}

          {vertices.length >= 2 && !closed && (
            <Polyline positions={toPositions(vertices)} pathOptions={{ color: '#991B1B', weight: 3, dashArray: '6 7' }} />
          )}
          {closed && (
            <Polygon
              positions={toPositions(vertices)}
              pathOptions={{ color: '#991B1B', fillColor: '#b91c1c', fillOpacity: 0.2, weight: 3 }}
            />
          )}
          {vertices.map((vertex, index) => {
            const first = index === 0 && !closed;
            return (
              <CircleMarker
                key={`${vertex.lat}-${vertex.lng}-${index}`}
                center={[vertex.lat, vertex.lng]}
                radius={first ? 8 : 6}
                pathOptions={{
                  color: first ? '#b45309' : '#991B1B',
                  fillColor: first ? '#f59e0b' : '#fff',
                  fillOpacity: 1,
                  weight: 2,
                }}
                eventHandlers={
                  first
                    ? {
                        click: (event) => {
                          L.DomEvent.stopPropagation(event.originalEvent);
                          closePolygon();
                        },
                      }
                    : undefined
                }
              >
                <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                  {first ? 'Close polygon' : `Vertex ${index + 1}`}
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </section>

      <aside className="flex w-full shrink-0 flex-col overflow-y-auto bg-white lg:w-[23rem]">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manual perimeter</p>
              <h2 className="mt-1 text-base font-bold text-slate-800">Incident #482</h2>
              <p className="mt-1 text-xs text-slate-500">
                Validated brush fire · {location.province}, {location.region}
              </p>
            </div>
            <span
              className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                closed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}
            >
              {closed ? 'CLOSED' : 'DRAWING'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 border-b border-slate-200">
          <div className="border-r border-slate-200 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Area preview</p>
            <p className="mt-1 text-2xl font-bold text-slate-800">{hectares.toFixed(2)}</p>
            <p className="text-xs text-slate-500">hectares</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vertices</p>
            <p className="mt-1 text-2xl font-bold text-slate-800">{vertices.length}</p>
            <p className="text-xs text-slate-500">{vertices.length === 1 ? 'point' : 'points'}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3 text-xs text-slate-600">
          <MapPin className="h-4 w-4 shrink-0 text-[#991B1B]" aria-hidden="true" />
          <span>
            <span className="font-semibold text-slate-800">{location.province}</span>, {location.region} ·{' '}
            {centroid[0].toFixed(4)}, {centroid[1].toFixed(4)}
          </span>
        </div>

        <div className="space-y-3 border-b border-slate-200 p-5">
          <button
            type="button"
            onClick={closePolygon}
            disabled={!canClose}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-[#991B1B] px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#7f1d1d] disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Close polygon
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={undoLastVertex}
              disabled={vertices.length === 0}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              Undo
            </button>
            <button
              type="button"
              onClick={clearPolygon}
              disabled={vertices.length === 0}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
              Clear
            </button>
          </div>
          <p className="flex items-center gap-1.5 text-[11px] leading-4 text-slate-500">
            <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Ctrl/Cmd + Z removes the latest vertex. Area is a client-side preview only.
          </p>
        </div>

        <div className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-800">GeoJSON inspection</h3>
              <p className="mt-0.5 text-xs text-slate-500">Feature shape for the perimeter API contract.</p>
            </div>
            <button
              type="button"
              onClick={() => void exportGeoJson()}
              disabled={!canExport}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#991B1B] px-2.5 py-1.5 text-xs font-semibold text-[#991B1B] transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export
            </button>
          </div>

          {exportMessage && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-4 text-amber-800" role="status">
              {exportMessage}
            </p>
          )}

          {previewVisible && feature ? (
            <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-100">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">GeoJSON Feature</span>
                <Copy className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              </div>
              <pre className="max-h-60 overflow-auto p-3 text-[11px] leading-4 text-slate-800">
                {JSON.stringify(feature, null, 2)}
              </pre>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs leading-4 text-slate-500">
              Close a polygon to inspect its GeoJSON Feature and export it for review.
            </div>
          )}

          <p className="border-l-2 border-[#991B1B] pl-3 text-[11px] leading-4 text-slate-500">
            Prototype only: export is local inspection. Production must validate and calculate authoritative area with PostGIS before persistence.
          </p>
        </div>
      </aside>
    </div>
  );
}
