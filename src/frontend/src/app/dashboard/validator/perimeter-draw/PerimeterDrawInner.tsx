'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMapEvents, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import { Check, Crosshair, Eraser, MapPin, Save, Undo2 } from 'lucide-react';
import { saveManualPerimeter, type PerimeterGeometry, type PerimeterResponse } from '@/lib/api';

type Vertex = { lat: number; lng: number };

type Incident = {
  id?: number | null;
  description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  province?: string | null;
  region?: string | null;
};

const PHILIPPINES_CENTER: [number, number] = [14.5995, 120.9842];
const SNAP_DISTANCE_PX = 14;
const EARTH_RADIUS_METERS = 6_371_008.8;

function toPositions(vertices: Vertex[]): [number, number][] {
  return vertices.map((vertex) => [vertex.lat, vertex.lng]);
}

function toVertices(geometry: PerimeterGeometry | null): Vertex[] {
  const ring = geometry?.coordinates[0];
  if (!ring || ring.length < 4) return [];
  return ring.slice(0, -1).map(([lng, lat]) => ({ lat, lng }));
}

function geometryFor(vertices: Vertex[]): PerimeterGeometry {
  return {
    type: 'Polygon',
    coordinates: [[...vertices, vertices[0]].map((vertex) => [vertex.lng, vertex.lat])],
  };
}

function areaHectares(vertices: Vertex[]): number {
  if (vertices.length < 3) return 0;
  const meanLatitude = vertices.reduce((sum, vertex) => sum + vertex.lat, 0) / vertices.length;
  const cosLatitude = Math.cos((meanLatitude * Math.PI) / 180);
  const projected = vertices.map((vertex) => ({
    x: (vertex.lng * Math.PI * EARTH_RADIUS_METERS * cosLatitude) / 180,
    y: (vertex.lat * Math.PI * EARTH_RADIUS_METERS) / 180,
  }));
  const doubleArea = projected.reduce((sum, current, index) => {
    const next = projected[(index + 1) % projected.length];
    return sum + current.x * next.y - next.x * current.y;
  }, 0);
  return Math.abs(doubleArea) / 20_000;
}

function DrawInteraction({ vertices, closed, onAddVertex, onClose }: {
  vertices: Vertex[];
  closed: boolean;
  onAddVertex: (vertex: Vertex) => void;
  onClose: () => void;
}) {
  const map = useMapEvents({
    click(event) {
      if (closed) return;
      const clickPoint = map.latLngToContainerPoint(event.latlng);
      const snapped = vertices.find((vertex) => map.latLngToContainerPoint([vertex.lat, vertex.lng]).distanceTo(clickPoint) <= SNAP_DISTANCE_PX);
      if (snapped === vertices[0] && vertices.length >= 3) onClose();
      else onAddVertex(snapped ?? { lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

export default function PerimeterDrawInner({ incident, perimeter, onSaved, error }: {
  incident: Incident | null;
  perimeter: PerimeterResponse | null;
  onSaved: (perimeter: PerimeterResponse) => void;
  error?: string | null;
}) {
  const [vertices, setVertices] = useState<Vertex[]>(() => toVertices(perimeter?.geometry ?? null));
  const [closed, setClosed] = useState(Boolean(perimeter));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const previewHectares = useMemo(() => areaHectares(vertices), [vertices]);
  const hasIncident = incident?.id != null;
  const baseLatitude = incident?.latitude ?? PHILIPPINES_CENTER[0];
  const baseLongitude = incident?.longitude ?? PHILIPPINES_CENTER[1];
  const baseCenter = useMemo<[number, number]>(() => [baseLatitude, baseLongitude], [baseLatitude, baseLongitude]);
  const centroid = useMemo<[number, number]>(() => {
    if (vertices.length === 0) return baseCenter;
    return [
      vertices.reduce((sum, vertex) => sum + vertex.lat, 0) / vertices.length,
      vertices.reduce((sum, vertex) => sum + vertex.lng, 0) / vertices.length,
    ];
  }, [baseCenter, vertices]);
  const canClose = vertices.length >= 3 && !closed;
  const geometry = closed ? geometryFor(vertices) : null;
  const authoritativeAcres = perimeter?.gis_acres;

  const addVertex = useCallback((vertex: Vertex) => {
    setVertices((current) => [...current, vertex]);
    setMessage(null);
  }, []);
  const closePolygon = useCallback(() => {
    if (vertices.length >= 3) setClosed(true);
  }, [vertices.length]);
  const undo = useCallback(() => {
    setClosed(false);
    setVertices((current) => current.slice(0, -1));
    setMessage(null);
  }, []);
  const clear = useCallback(() => {
    setVertices([]);
    setClosed(false);
    setMessage(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      undo();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo]);

  async function persist() {
    if (!geometry || !hasIncident || incident.id == null) return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveManualPerimeter(incident.id, geometry, Boolean(perimeter));
      onSaved(saved);
      setMessage('Perimeter saved. Area below is calculated by PostGIS.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save perimeter.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-100 lg:flex-row">
      <section className="relative min-h-[52vh] flex-1 overflow-hidden border-b border-slate-200 lg:min-h-0 lg:border-b-0 lg:border-r">
        <div className="absolute left-3 top-3 z-[1000] max-w-[19rem] rounded-md border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700"><Crosshair className="h-4 w-4 text-[#991B1B]" />{closed ? 'Perimeter closed — review before saving' : 'Click map to place perimeter vertices'}</div>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">Click the amber first vertex to close. Existing vertices snap within {SNAP_DISTANCE_PX}px.</p>
        </div>
        <MapContainer key={hasIncident ? `incident-${incident.id}` : 'standalone'} center={baseCenter} zoom={14} style={{ height: '100%', minHeight: '420px', width: '100%' }} zoomControl={false}>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ZoomControl position="topright" />
          <DrawInteraction vertices={vertices} closed={closed} onAddVertex={addVertex} onClose={closePolygon} />
          {vertices.length >= 2 && !closed && <Polyline positions={toPositions(vertices)} pathOptions={{ color: '#991B1B', weight: 3, dashArray: '6 7' }} />}
          {closed && <Polygon positions={toPositions(vertices)} pathOptions={{ color: '#991B1B', fillColor: '#b91c1c', fillOpacity: 0.2, weight: 3 }} />}
          {vertices.map((vertex, index) => {
            const first = index === 0 && !closed;
            return <CircleMarker key={`${vertex.lat}-${vertex.lng}-${index}`} center={[vertex.lat, vertex.lng]} radius={first ? 8 : 6} pathOptions={{ color: first ? '#b45309' : '#991B1B', fillColor: first ? '#f59e0b' : '#fff', fillOpacity: 1, weight: 2 }} eventHandlers={first ? { click: (event) => { L.DomEvent.stopPropagation(event.originalEvent); closePolygon(); } } : undefined}><Tooltip direction="top" offset={[0, -8]}>{first ? 'Close polygon' : `Vertex ${index + 1}`}</Tooltip></CircleMarker>;
          })}
        </MapContainer>
      </section>

      <aside className="flex w-full shrink-0 flex-col overflow-y-auto bg-white lg:w-[23rem]">
        <div className="border-b border-slate-200 px-5 py-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manual perimeter</p>{hasIncident ? (<><h2 className="mt-1 text-base font-bold text-slate-800">Incident #{incident.id}</h2><p className="mt-1 text-xs text-slate-500">{incident.description ?? ''}{incident.province || incident.region ? ` · ${incident.province ?? ''}${incident.province && incident.region ? ', ' : ''}${incident.region ?? ''}` : ''}</p></>) : (<><h2 className="mt-1 text-base font-bold text-slate-800">Unsaved draft</h2><p className="mt-1 text-xs text-slate-500">Load a verified incident to associate and save this perimeter.</p></>)}</div><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${closed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{closed ? 'CLOSED' : 'DRAWING'}</span></div></div>
        <div className="grid grid-cols-2 border-b border-slate-200"><div className="border-r border-slate-200 px-5 py-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Area {authoritativeAcres != null ? 'authoritative' : 'preview'}</p><p className="mt-1 text-2xl font-bold text-slate-800">{authoritativeAcres != null ? (authoritativeAcres / 2.47105).toFixed(2) : previewHectares.toFixed(2)}</p><p className="text-xs text-slate-500">hectares{authoritativeAcres != null ? ' · PostGIS' : ''}</p></div><div className="px-5 py-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vertices</p><p className="mt-1 text-2xl font-bold text-slate-800">{vertices.length}</p><p className="text-xs text-slate-500">points</p></div></div>
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3 text-xs text-slate-600"><MapPin className="h-4 w-4 shrink-0 text-[#991B1B]" /><span>{hasIncident && (incident.province || incident.region) ? (<><span className="font-semibold text-slate-800">{incident.province ?? ''}</span>{incident.region ? `, ${incident.region}` : ''} · </>) : null}{centroid[0].toFixed(4)}, {centroid[1].toFixed(4)}</span></div>
        <div className="space-y-3 border-b border-slate-200 p-5"><button type="button" onClick={closePolygon} disabled={!canClose} className="flex w-full items-center justify-center gap-2 rounded-md bg-[#991B1B] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#7f1d1d] disabled:cursor-not-allowed disabled:bg-slate-300"><Check className="h-4 w-4" />Close polygon</button><div className="grid grid-cols-2 gap-2"><button type="button" onClick={undo} disabled={vertices.length === 0} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400"><Undo2 className="h-3.5 w-3.5" />Undo</button><button type="button" onClick={clear} disabled={vertices.length === 0} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400"><Eraser className="h-3.5 w-3.5" />Clear</button></div><p className="text-[11px] leading-4 text-slate-500">Ctrl/Cmd + Z removes the latest vertex. Preview area is not persisted.</p></div>
        <div className="space-y-3 p-5"><div><h3 className="text-sm font-bold text-slate-800">GeoJSON inspection</h3><p className="mt-0.5 text-xs text-slate-500">The saved feature is validated and measured by PostGIS.</p></div>{geometry ? <pre className="max-h-52 overflow-auto rounded-md border border-slate-200 bg-slate-100 p-3 text-[11px] leading-4 text-slate-800">{JSON.stringify({ type: 'Feature', geometry, properties: { map_method: 'MANUAL_DRAW' } }, null, 2)}</pre> : <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">Close a polygon to inspect its GeoJSON Feature.</div>}<button type="button" onClick={() => void persist()} disabled={!geometry || saving || !hasIncident} className="flex w-full items-center justify-center gap-2 rounded-md bg-[#991B1B] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#7f1d1d] disabled:cursor-not-allowed disabled:bg-slate-300"><Save className="h-4 w-4" />{saving ? 'Saving...' : perimeter ? 'Update perimeter' : 'Save perimeter'}</button>{!hasIncident && geometry && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">Load a verified incident above, then click Save perimeter to persist this drawing.</p>}{message && <p className={`rounded-md border px-3 py-2 text-xs ${message.startsWith('Perimeter saved') ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`} role="status">{message}</p>}{error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</p>}</div>
      </aside>
    </div>
  );
}
