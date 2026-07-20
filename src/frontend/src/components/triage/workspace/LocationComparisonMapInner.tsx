'use client';

import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { Circle, MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet';
import type { EvidenceLocation, WorkspaceReport } from '@/types/triage-workspace';

const DEFAULT_CENTER: [number, number] = [14.5995, 120.9842];

const SOURCES = [
  { key: 'report', label: 'Incident pin', symbol: '●', className: 'bg-red-700' },
  { key: 'device', label: 'Device GPS', symbol: '◆', className: 'bg-blue-700' },
  { key: 'exif', label: 'Image EXIF GPS', symbol: '▲', className: 'bg-emerald-700' },
  { key: 'ip', label: 'IP city centroid', symbol: '■', className: 'bg-amber-700' },
] as const;

function ValidatedMapView({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 1) map.fitBounds(positions, { padding: [30, 30] });
    else if (positions.length === 1) map.setView(positions[0], 14);
    const timer = window.setTimeout(() => map.invalidateSize(), 100);
    return () => window.clearTimeout(timer);
  }, [map, positions]);
  return null;
}

function position(location: EvidenceLocation): [number, number] | null {
  if (!location.available || location.latitude === null || location.longitude === null) return null;
  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return null;
  if (Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) return null;
  return [location.latitude, location.longitude];
}

function markerIcon(symbol: string, className: string) {
  return L.divIcon({
    className: '',
    html: `<span aria-hidden="true" class="${className}" style="display:flex;width:28px;height:28px;align-items:center;justify-content:center;border:2px solid white;border-radius:6px;color:white;box-shadow:0 1px 4px rgba(0,0,0,.4)">${symbol}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export default function LocationComparisonMapInner({ report }: { report: WorkspaceReport }) {
  const evidence = useMemo(() => ({
    report: report.report_location,
    device: report.device_location,
    exif: report.photos.find((photo) => photo.exif_location.available)?.exif_location ?? {
      source: 'image_exif_gps', available: false, latitude: null, longitude: null,
      accuracy_m: null, approximate: false, distance_to_report_m: null,
    },
    ip: report.ip_location,
  }), [report.device_location, report.ip_location, report.photos, report.report_location]);
  const positions = SOURCES.flatMap((source) => {
    const point = position(evidence[source.key]);
    return point ? [point] : [];
  });
  const reportPosition = position(evidence.report);

  return (
    <section aria-labelledby="location-comparison-heading" className="space-y-3">
      <div>
        <h2 id="location-comparison-heading" className="text-lg font-semibold text-slate-950">Location comparison</h2>
        <p className="text-sm text-slate-600">Mismatch signals are investigative aids, not truth determinations or action recommendations.</p>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <MapContainer center={positions[0] ?? DEFAULT_CENTER} zoom={13} style={{ minHeight: 360, width: '100%' }}>
          <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ValidatedMapView positions={positions} />
          {SOURCES.map((source) => {
            const point = position(evidence[source.key]);
            return point ? <Marker key={source.key} position={point} icon={markerIcon(source.symbol, source.className)} title={source.label} /> : null;
          })}
          {reportPosition && SOURCES.filter((source) => source.key !== 'report').map((source) => {
            const point = position(evidence[source.key]);
            return point ? <Polyline key={`line-${source.key}`} positions={[reportPosition, point]} pathOptions={{ color: '#475569', dashArray: '6 6', weight: 2 }} /> : null;
          })}
          {position(evidence.ip) && evidence.ip.accuracy_m !== null && (
            <Circle center={position(evidence.ip)!} radius={evidence.ip.accuracy_m} pathOptions={{ color: '#a16207', fillOpacity: 0.08 }} />
          )}
        </MapContainer>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2" aria-label="Location evidence legend">
        {SOURCES.map((source) => {
          const location = evidence[source.key];
          return (
            <li key={source.key} className="rounded-lg border border-slate-200 p-3 text-sm">
              <span aria-hidden="true" className="mr-2 font-bold">{source.symbol}</span>
              <strong>{source.label}</strong>: {location.available ? 'Available' : 'Unavailable'}
              {location.distance_to_report_m !== null && ` · ${Math.round(location.distance_to_report_m)} m from incident pin`}
              {source.key === 'ip' && <span className="block text-xs text-slate-600">Approximate city-level evidence{location.accuracy_m !== null ? `, accuracy radius ${Math.round(location.accuracy_m)} m` : ''}.</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
