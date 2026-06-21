'use client';

import { MapContainer, TileLayer, Marker, Circle } from 'react-leaflet';
import L from 'leaflet';
import type { TriageReportEntry } from '@/lib/api';
import { firePinIcon } from '@/components/map/leafletIcons';

/* BFP maroon pin for primary cluster members */
const clusterPin = firePinIcon;

/* Teal pin for suggested merge-candidate members */
const suggestedPin = L.divIcon({
  className: 'leaflet-suggested-pin',
  html: `<svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
    <path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0z" fill="#0D9488"/>
    <circle cx="12.5" cy="12.5" r="5" fill="#fff"/>
  </svg>`,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

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
            icon={isSuggested ? suggestedPin : clusterPin}
            title={`#${report.report_id} (${report.category ?? '?'}/${report.sub_category ?? '?'})`}
          />
        );
      })}
    </MapContainer>
  );
}