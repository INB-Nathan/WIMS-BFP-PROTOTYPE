import { describe, expect, it } from 'vitest';
import type { TriageClusterEntry, TriageReportEntry } from '@/lib/api';
import {
  deriveClusterGeometry,
  getTriageItemIdentity,
  isValidPhilippinesCoordinate,
  sortTriageItemsByPriority,
} from './triageGeometry';

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
    ...overrides,
  };
}

function cluster(overrides: Partial<TriageClusterEntry>): TriageClusterEntry {
  return {
    cluster_id: 42,
    anchor_report_id: 1,
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
    reports: [report({ report_id: 1 }), report({ report_id: 2, latitude: 14.501, longitude: 121.001 })],
    station: { name: 'Balayan FS', distance_m: 1200, phone_available: true },
    ...overrides,
  };
}

describe('triageGeometry', () => {
  it('accepts expected Philippines coordinates and rejects invalid runtime values', () => {
    expect(isValidPhilippinesCoordinate(14.5995, 120.9842)).toBe(true);
    expect(isValidPhilippinesCoordinate(Number.NaN, 120.9842)).toBe(false);
    expect(isValidPhilippinesCoordinate(0, 0)).toBe(false);
    expect(isValidPhilippinesCoordinate(60, 120)).toBe(false);
    expect(isValidPhilippinesCoordinate(14.5, null)).toBe(false);
  });

  it('derives centroid, radius, bounds, and invalid reports from member coordinates', () => {
    const item = cluster({
      reports: [
        report({ report_id: 10, latitude: 14.5, longitude: 121.0 }),
        report({ report_id: 11, latitude: 14.502, longitude: 121.002 }),
        report({ report_id: 12, latitude: 0 as number, longitude: 0 as number }),
      ],
    });

    const geometry = deriveClusterGeometry(item);

    expect(geometry.validReports.map((entry) => entry.report.report_id)).toEqual([10, 11]);
    expect(geometry.invalidReports.map((entry) => entry.report_id)).toEqual([12]);
    expect(geometry.centroid?.[0]).toBeCloseTo(14.501, 3);
    expect(geometry.centroid?.[1]).toBeCloseTo(121.001, 3);
    expect(geometry.radiusMeters).toBeGreaterThanOrEqual(75);
    expect(geometry.bounds).toEqual([[14.5, 121.0], [14.502, 121.002]]);
  });

  it('identifies clusters and singleton reports with stable ids', () => {
    expect(getTriageItemIdentity(cluster({ cluster_id: 42 }))).toEqual({ type: 'cluster', id: 42 });
    expect(getTriageItemIdentity(cluster({ cluster_id: null, anchor_report_id: 77, reports: [report({ report_id: 77 })] }))).toEqual({ type: 'singleton', id: 77 });
  });

  it('sorts life safety, timeout risk, severity, member count, and age before low-priority items', () => {
    const low = cluster({ cluster_id: 1, severity: 'LOW', oldest_report_at: '2026-06-25T00:20:00Z' });
    const timeout = cluster({ cluster_id: 2, is_timeout_risk: true, severity: 'MEDIUM' });
    const lifeSafety = cluster({ cluster_id: 3, has_life_safety: true, severity: 'HIGH' });

    expect(sortTriageItemsByPriority([low, timeout, lifeSafety]).map((item) => item.cluster_id)).toEqual([3, 2, 1]);
  });
});
