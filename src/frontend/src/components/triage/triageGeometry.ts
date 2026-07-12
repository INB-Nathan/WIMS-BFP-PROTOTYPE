import type { TriageClusterEntry, TriageReportEntry, TriageSeverity } from '@/lib/api';

export type TriageItemType = 'cluster' | 'singleton';

export interface TriageItemIdentity {
  type: TriageItemType;
  id: number;
}

export interface ValidReportCoordinate {
  report: TriageReportEntry;
  lat: number;
  lng: number;
}

export interface ClusterGeometry {
  centroid: [number, number] | null;
  radiusMeters: number | null;
  bounds: [[number, number], [number, number]] | null;
  validReports: ValidReportCoordinate[];
  invalidReports: TriageReportEntry[];
}

const PHILIPPINES_BOUNDS = {
  minLat: 4,
  maxLat: 22,
  minLng: 116,
  maxLng: 127,
};

const MIN_VISIBLE_CLUSTER_RADIUS_METERS = 75;

const SEVERITY_SCORE: Record<TriageSeverity, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

// Single source of truth for the life-safety/severity tone thresholds shared
// by TriageEvidenceCard and the Investigation Board's table rows — do not
// drift these independently.
const LIFE_SAFETY_STATUSES = new Set(['I_NEED_HELP', 'SOMEONE_ELSE_NEEDS_HELP']);

export function hasLifeSafetySignal(report: TriageReportEntry): boolean {
  return LIFE_SAFETY_STATUSES.has(report.safety_status ?? '');
}

/** Severity/trust tone classes: life-safety red > timeout amber > high-trust emerald > default. */
export function statusTone(report: TriageReportEntry): string {
  if (hasLifeSafetySignal(report)) return 'border-red-300 bg-red-50 text-red-900';
  if (report.is_timeout_risk) return 'border-amber-300 bg-amber-50 text-amber-900';
  if (report.trust_breakdown.score >= 75) return 'border-emerald-300 bg-emerald-50 text-emerald-900';
  return 'border-slate-200 bg-white text-slate-900';
}

export function isValidPhilippinesCoordinate(lat: unknown, lng: unknown): lat is number {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return (
    lat >= PHILIPPINES_BOUNDS.minLat &&
    lat <= PHILIPPINES_BOUNDS.maxLat &&
    lng >= PHILIPPINES_BOUNDS.minLng &&
    lng <= PHILIPPINES_BOUNDS.maxLng
  );
}

export function getTriageItemIdentity(item: TriageClusterEntry): TriageItemIdentity | null {
  if (item.cluster_id !== null && item.cluster_id !== undefined) {
    return { type: 'cluster', id: item.cluster_id };
  }
  const reportId = item.anchor_report_id ?? item.reports[0]?.report_id;
  return typeof reportId === 'number' ? { type: 'singleton', id: reportId } : null;
}

function distanceMeters(a: [number, number], b: [number, number]): number {
  const earthRadiusMeters = 6_371_000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

export function deriveClusterGeometry(item: TriageClusterEntry): ClusterGeometry {
  const validReports: ValidReportCoordinate[] = [];
  const invalidReports: TriageReportEntry[] = [];

  item.reports.forEach((report) => {
    if (isValidPhilippinesCoordinate(report.latitude, report.longitude)) {
      validReports.push({ report, lat: report.latitude, lng: report.longitude });
    } else {
      invalidReports.push(report);
    }
  });

  if (validReports.length === 0) {
    return { centroid: null, radiusMeters: null, bounds: null, validReports, invalidReports };
  }

  const centroid: [number, number] = [
    validReports.reduce((sum, entry) => sum + entry.lat, 0) / validReports.length,
    validReports.reduce((sum, entry) => sum + entry.lng, 0) / validReports.length,
  ];

  const radiusMeters = Math.max(
    MIN_VISIBLE_CLUSTER_RADIUS_METERS,
    ...validReports.map((entry) => distanceMeters(centroid, [entry.lat, entry.lng])),
  );

  const lats = validReports.map((entry) => entry.lat);
  const lngs = validReports.map((entry) => entry.lng);
  const bounds: [[number, number], [number, number]] = [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];

  return { centroid, radiusMeters, bounds, validReports, invalidReports };
}

export function sortTriageItemsByPriority(items: TriageClusterEntry[]): TriageClusterEntry[] {
  return [...items].sort((a, b) => {
    if (a.has_life_safety !== b.has_life_safety) return a.has_life_safety ? -1 : 1;
    if (a.is_danger !== b.is_danger) return a.is_danger ? -1 : 1;
    if (a.is_timeout_risk !== b.is_timeout_risk) return a.is_timeout_risk ? -1 : 1;
    const severityDelta = (SEVERITY_SCORE[b.severity] ?? 0) - (SEVERITY_SCORE[a.severity] ?? 0);
    if (severityDelta !== 0) return severityDelta;
    if (a.member_count !== b.member_count) return b.member_count - a.member_count;
    return new Date(a.oldest_report_at).getTime() - new Date(b.oldest_report_at).getTime();
  });
}
