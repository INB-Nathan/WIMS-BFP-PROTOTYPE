'use client';

import { MapContainer, TileLayer, Circle, Popup } from 'react-leaflet';
import type { Operation } from '@/lib/api/operations';

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
}

// ── Main component ──────────────────────────────────────────────────────────

export default function OperationsMap({ operations }: OperationsMapProps) {
  const opsWithCoords = operations.filter(
    (op) => op.latitude != null && op.longitude != null,
  );

  return (
    <MapContainer
      center={[12.8, 121.8]}
      zoom={6}
      style={{ height: '500px', width: '100%', borderRadius: '0.375rem' }}
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {opsWithCoords.map((op) => (
        <Circle
          key={op.operation_id}
          center={[op.latitude!, op.longitude!]}
          radius={op.radius_meters || 500}
          pathOptions={{
            color: STATUS_COLORS[op.fire_status] || '#dc2626',
            fillColor: STATUS_COLORS[op.fire_status] || '#dc2626',
            fillOpacity: 0.4,
            weight: 1,
          }}
        >
          <Popup>
            <div className="text-xs min-w-[140px]">
              <p className="font-semibold text-sm">{op.location}</p>
              <span
                className="inline-block rounded-full px-2 py-0.5 text-xs font-medium mt-1"
                style={{
                  backgroundColor: STATUS_COLORS[op.fire_status] || '#dc2626',
                  color: '#fff',
                }}
              >
                {STATUS_LABELS[op.fire_status] || op.fire_status}
              </span>
              {op.size_hectares != null && (
                <p className="text-slate-500 mt-1">
                  Size: {op.size_hectares} ha
                </p>
              )}
              <p className="text-slate-400 mt-0.5">
                {new Date(op.start_time).toLocaleString()}
              </p>
            </div>
          </Popup>
        </Circle>
      ))}
    </MapContainer>
  );
}
