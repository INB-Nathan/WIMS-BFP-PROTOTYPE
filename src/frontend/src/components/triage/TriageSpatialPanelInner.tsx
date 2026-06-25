'use client';

import { useEffect } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import type { TriageClusterEntry } from '@/lib/api';
import { firePinIcon } from '@/components/map/leafletIcons';
import { deriveClusterGeometry } from './triageGeometry';

interface TriageSpatialPanelInnerProps {
  cluster: TriageClusterEntry;
  selectedReportId: number | null;
  suggestedReportIds: number[];
  inspectionMode: 'cluster' | 'singleton';
  onSelectReport: (reportId: number) => void;
}

const DEFAULT_CENTER: [number, number] = [14.5995, 120.9842];

function InvalidateSizeOnMount() {
  const map = useMap();
  useEffect(() => {
    const timer = window.setTimeout(() => map.invalidateSize(), 120);
    return () => window.clearTimeout(timer);
  }, [map]);
  return null;
}

export default function TriageSpatialPanelInner({
  cluster,
  selectedReportId,
  suggestedReportIds,
  inspectionMode,
  onSelectReport,
}: TriageSpatialPanelInnerProps) {
  const geometry = deriveClusterGeometry(cluster);
  const center = geometry.centroid ?? DEFAULT_CENTER;
  const suggestedSet = new Set(suggestedReportIds);

  return (
    <div data-testid="triage-spatial-panel" className="triage-spatial-panel">
      <div className="triage-spatial-panel__header">
        <span>{inspectionMode === 'cluster' ? 'Cluster spatial spread' : 'Report location'}</span>
        {geometry.invalidReports.length > 0 && (
          <strong>{geometry.invalidReports.length} no usable location</strong>
        )}
      </div>
      <MapContainer
        center={center}
        zoom={14}
        style={{ height: '100%', minHeight: '320px', width: '100%' }}
        zoomControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <InvalidateSizeOnMount />
        {inspectionMode === 'cluster' && geometry.centroid && geometry.radiusMeters && (
          <Circle
            center={geometry.centroid}
            radius={geometry.radiusMeters}
            pathOptions={{
              color: '#b91c1c',
              fillColor: '#ef4444',
              fillOpacity: 0.08,
              weight: 2,
            }}
          />
        )}
        {geometry.validReports.map(({ report, lat, lng }) => (
          <Marker
            key={report.report_id}
            position={[lat, lng]}
            icon={firePinIcon}
            zIndexOffset={
              report.report_id === selectedReportId
                ? 1000
                : suggestedSet.has(report.report_id)
                  ? 500
                  : 0
            }
            title={`#${report.report_id}`}
            eventHandlers={{ click: () => onSelectReport(report.report_id) }}
          />
        ))}
      </MapContainer>
    </div>
  );
}
