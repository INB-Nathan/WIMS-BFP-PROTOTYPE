import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LocationComparisonMapInner from '../LocationComparisonMapInner';
import type { WorkspaceReport } from '@/types/triage-workspace';

vi.mock('leaflet', () => ({ default: { divIcon: vi.fn(() => ({})) } }));
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Marker: ({ title }: { title: string }) => <span data-testid="marker">{title}</span>,
  Polyline: () => <span data-testid="comparison-line" />,
  Circle: () => <span data-testid="accuracy-radius" />,
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn(), invalidateSize: vi.fn() }),
}));

const unavailable = (source: string) => ({ source, available: false, latitude: null, longitude: null, accuracy_m: null, approximate: false, distance_to_report_m: null });
const report = {
  report_id: 7,
  status: 'PENDING',
  status_explanation: null,
  category: 'FIRE',
  sub_category: null,
  description: null,
  safety_status: null,
  reporting_context: null,
  created_at: '2026-07-20T00:00:00Z',
  reported_at: null,
  trust_score: 75,
  previous_report_id: null,
  report_location: { source: 'report_location', available: true, latitude: 14.6, longitude: 121, accuracy_m: null, approximate: false, distance_to_report_m: 0 },
  device_location: unavailable('device_gps'),
  ip_location: { source: 'ip_city_centroid', available: true, latitude: 14.61, longitude: 121.01, accuracy_m: 15000, approximate: true, distance_to_report_m: 1000 },
  photos: [],
  contributor: { authenticated: false, badge: null, trust_score: 75, total_reports: null, actioned_reports: null, pending_reports: null, evidence_quality: null, active_months: null },
  followups: [],
  feedback: [],
  contact_reveal_url: '/api/triage/reports/7/reporter-contact',
} as WorkspaceReport;

describe('LocationComparisonMap', () => {
  it('uses source labels, distinct markers, approximate radius, and explicit unavailable states', () => {
    render(<LocationComparisonMapInner report={report} />);
    expect(screen.getAllByTestId('marker')).toHaveLength(2);
    expect(screen.getByTestId('accuracy-radius')).toBeInTheDocument();
    expect(screen.getByText(/Device GPS/).parentElement).toHaveTextContent('Unavailable');
    expect(screen.getByText(/Mismatch signals are investigative aids/)).toBeInTheDocument();
  });
});
