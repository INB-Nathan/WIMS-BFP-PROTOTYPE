'use client';

import { MapContainer, TileLayer, Marker, Circle } from 'react-leaflet';
import L from 'leaflet';
import type { TriageReportEntry } from '@/lib/api';

// Fix default marker icons in Next.js — self-hosted under /leaflet/.
const RedIcon = L.icon({
  iconUrl: '/leaflet/marker-icon.png',
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  shadowUrl: '/leaflet/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  className: 'bg-red-600',
});
const BlueIcon = L.icon({
  iconUrl: '/leaflet/marker-icon.png',
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  shadowUrl: '/leaflet/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  className: 'bg-blue-500',
});
L.Marker.prototype.options.icon = RedIcon;

interface ClusterMapInnerProps {
  center: [number, number];
  reports: TriageReportEntry[];
  suggestedReportIds: number[];
}

export default function ClusterMapInner({ center, reports, suggestedReportIds }: ClusterMapInnerProps) {
  const suggestedSet = new Set(suggestedReportIds);

  return (
    <MapContainer
      center={center}
      zoom={14}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {/* 100m radius around anchor (first cluster member) */}
      {reports.length > 0 && (
        <Circle
          center={[reports[0].latitude, reports[0].longitude]}
          radius={100}
          pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.08, weight: 1 }}
        />
      )}
      {reports.map((report) => {
        const isSuggested = suggestedSet.has(report.report_id);
        return (
          <Marker
            key={report.report_id}
            position={[report.latitude, report.longitude]}
            icon={isSuggested ? BlueIcon : RedIcon}
            title={`#${report.report_id} (${report.category ?? '?'}/${report.sub_category ?? '?'})`}
          />
        );
      })}
    </MapContainer>
  );
}