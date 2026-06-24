'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Circle, CircleMarker, Popup, useMap } from 'react-leaflet';
import type { LinkedReportDetail, Operation } from '@/lib/api/operations';

// ── Status color helpers ────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#dc2626',
  CONTAINED: '#ea580c',
  FIRE_OUT: '#16a34a',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  CONTAINED: 'Contained',
  FIRE_OUT: 'Fire Out',
};

// ── Props ───────────────────────────────────────────────────────────────────

interface OperationsMapProps {
  operations: Operation[];
  selectedOperationId?: number | null;
  linkedReports?: LinkedReportDetail[];
}

// ── Selected operation centering sub-component ──────────────────────────────

function SelectedOperationCenter({ operation }: { operation: Operation | null }) {
  const map = useMap();

  useEffect(() => {
    if (operation?.latitude != null && operation.longitude != null) {
      map.setView([operation.latitude, operation.longitude], 12, { animate: true });
    }
  }, [map, operation]);

  return null;
}

// ── Main component ──────────────────────────────────────────────────────────

export default function OperationsMap({
  operations,
  selectedOperationId = null,
  linkedReports = [],
}: OperationsMapProps) {
  const opsWithCoords = operations.filter(
    (op) => op.latitude != null && op.longitude != null,
  );
  const selectedOperation = operations.find((op) => op.operation_id === selectedOperationId) ?? null;
  const reportsWithCoords = linkedReports.filter(
    (report) => report.latitude != null && report.longitude != null,
  );

  return (
    <MapContainer
      center={[12.8, 121.8]}
      zoom={6}
      style={{ height: 'min(68vh, 680px)', minHeight: '420px', width: '100%', borderRadius: '0.75rem' }}
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <SelectedOperationCenter operation={selectedOperation} />

      {opsWithCoords.map((op) => (
        <Circle
          key={op.operation_id}
          center={[op.latitude!, op.longitude!]}
          radius={op.radius_meters || 500}
          pathOptions={{
            color: STATUS_COLORS[op.fire_status] || '#dc2626',
            fillColor: STATUS_COLORS[op.fire_status] || '#dc2626',
            fillOpacity: op.operation_id === selectedOperationId ? 0.5 : 0.28,
            weight: op.operation_id === selectedOperationId ? 3 : 1,
          }}
        >
          <Popup>
            <div className="text-xs min-w-[140px]">
              <p className="font-semibold text-sm">{op.location}</p>
              <span
                className="inline-block rounded-full px-2 py-0.5 text-xs font-medium mt-1"
                style={{ backgroundColor: STATUS_COLORS[op.fire_status] || '#dc2626', color: '#fff' }}
              >
                {STATUS_LABELS[op.fire_status] || op.fire_status}
              </span>
              {op.size_hectares != null && <p className="text-slate-500 mt-1">Size: {op.size_hectares} ha</p>}
              <p className="text-slate-400 mt-0.5">{new Date(op.start_time).toLocaleString()}</p>
            </div>
          </Popup>
        </Circle>
      ))}

      {reportsWithCoords.map((report) => (
        <CircleMarker
          key={report.report_id}
          center={[report.latitude!, report.longitude!]}
          radius={7}
          pathOptions={{ color: '#1d4ed8', fillColor: '#60a5fa', fillOpacity: 0.85, weight: 2 }}
        >
          <Popup>
            <div className="text-xs min-w-[150px]">
              <p className="font-semibold text-sm">Report #{report.report_id}</p>
              <p className="text-slate-600">{report.category}{report.sub_category ? ` / ${report.sub_category}` : ''}</p>
              <p className="text-slate-500">Status: {report.status}</p>
              {report.distance_meters != null && <p className="text-slate-500">{Math.round(report.distance_meters)} m from operation</p>}
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
