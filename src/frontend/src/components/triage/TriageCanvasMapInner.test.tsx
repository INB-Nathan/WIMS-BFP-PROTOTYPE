import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TriageClusterEntry, TriageReportEntry } from '@/lib/api';
import TriageCanvasMapInner from './TriageCanvasMapInner';

const mapMocks = vi.hoisted(() => ({
  setView: vi.fn(),
  fitBounds: vi.fn(),
  getZoom: vi.fn(() => 10),
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => <div data-testid="tile-layer" />,
  Circle: ({ children }: { children?: React.ReactNode }) => <div data-testid="cluster-circle">{children}</div>,
  CircleMarker: ({ children }: { children?: React.ReactNode }) => <div data-testid="report-marker">{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMap: () => mapMocks,
}));

function report(overrides: Partial<TriageReportEntry>): TriageReportEntry {
  return {
    report_id: 1,
    latitude: 14.5,
    longitude: 121.0,
    category: 'STRUCTURAL',
    sub_category: 'RESIDENTIAL',
    reporting_context: 'someone_else_needs_help',
    safety_status: 'life_safety',
    status: 'PENDING',
    status_explanation: null,
    trust_breakdown: {
      score: 75,
      included_signals: ['gps_match'],
      missing_signals: [],
      gps_mismatch: false,
      duplicate_device_count_30m: 0,
    },
    severity: 'HIGH',
    related_count: 0,
    linked_count: 0,
    created_at: '2026-06-25T00:00:00Z',
    reported_at: '2026-06-25T00:00:00Z',
    is_aging: false,
    is_timeout_risk: false,
    previous_report_id: null,
    station: { name: 'Balayan FS', distance_m: 1200, phone_available: true },
    followups: [],
    ...overrides,
  };
}

function cluster(overrides: Partial<TriageClusterEntry>): TriageClusterEntry {
  return {
    cluster_id: 131,
    anchor_report_id: 475,
    cluster_status: 'OPEN',
    assigned_to: null,
    review_started_at: null,
    member_count: 2,
    has_life_safety: false,
    severity: 'MEDIUM',
    avg_trust: 70,
    oldest_report_at: '2026-06-25T00:00:00Z',
    is_aging: false,
    is_timeout_risk: false,
    is_danger: false,
    related_count: 0,
    reports: [
      report({ report_id: 475, latitude: 14.5, longitude: 121.0 }),
      report({ report_id: 476, latitude: 14.502, longitude: 121.002 }),
    ],
    station: { name: 'Balayan FS', distance_m: 1200, phone_available: true },
    ...overrides,
  };
}

describe('TriageCanvasMapInner viewport focus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mapMocks.getZoom.mockReturnValue(10);
  });

  it('fits to selected cluster bounds when a cluster is selected without a selected report', async () => {
    render(
      <TriageCanvasMapInner
        items={[cluster({})]}
        selectedIdentity={{ type: 'cluster', id: 131 }}
        selectedReportId={null}
        onSelectItem={vi.fn()}
        onSelectReport={vi.fn()}
      />,
    );

    await waitFor(() => expect(mapMocks.fitBounds).toHaveBeenCalled());
    expect(mapMocks.fitBounds).toHaveBeenCalledWith(
      [[14.5, 121.0], [14.502, 121.002]],
      { animate: true, maxZoom: 15, padding: [32, 32] },
    );
    expect(mapMocks.setView).not.toHaveBeenCalled();
  });

  it('centers tightly on the selected report within a cluster', async () => {
    render(
      <TriageCanvasMapInner
        items={[cluster({})]}
        selectedIdentity={{ type: 'cluster', id: 131 }}
        selectedReportId={475}
        onSelectItem={vi.fn()}
        onSelectReport={vi.fn()}
      />,
    );

    await waitFor(() => expect(mapMocks.setView).toHaveBeenCalled());
    expect(mapMocks.setView).toHaveBeenCalledWith([14.5, 121.0], 15, { animate: true });
    expect(mapMocks.fitBounds).not.toHaveBeenCalled();
  });
});
