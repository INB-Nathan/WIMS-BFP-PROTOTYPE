import { publicApiFetch } from './public-transport';
import { API_BASE } from './transport';

export type EmergencySeverity = 'critical' | 'high' | 'moderate' | 'low';
export type EmergencyStatus = 'ongoing' | 'contained' | 'monitoring' | 'resolved';
export type AnnouncementUrgency = 'urgent' | 'advisory' | 'general';

export interface EmergencyResponse {
  id: number;
  title: string;
  location: string;
  description: string;
  severity: EmergencySeverity;
  status: EmergencyStatus;
  promoted_from_incident_id: number | null;
  latitude: number | null;
  longitude: number | null;
  perimeter: {
    type: 'Feature';
    geometry: { type: 'Polygon'; coordinates: number[][][] };
    properties: { incident_id: number | null };
  } | null;
  /** Coarse count of unresolved civilian reports inside the verified perimeter.
   *  Always present; 0 when no eligible signals. Never exposes who/where. */
  civilian_signal_count: number;
  published: boolean;
  published_at: string | null;
  created_at: string;
}

/** Privacy-preserving civilian-signal activity entry: timestamps only. */
export interface CivilianSignalTimestampResponse {
  submitted_at: string;
}

export interface AnnouncementResponse {
  id: number;
  title: string;
  body: string;
  urgency: AnnouncementUrgency;
  image_path: string | null;
  published: boolean;
  published_at: string | null;
  created_at: string;
}

/**
 * The Information endpoints are public reads (no auth). Use the zero-trust
 * `publicApiFetch` so an anonymous request never sends cookies or triggers a
 * login redirect, even though the page itself is auth-gated for civilians.
 */
export function fetchEmergencies(): Promise<EmergencyResponse[]> {
  return publicApiFetch<EmergencyResponse[]>('/information/emergencies', {
    cache: 'no-store',
  });
}

export function fetchAnnouncements(): Promise<AnnouncementResponse[]> {
  return publicApiFetch<AnnouncementResponse[]>('/information/announcements', {
    cache: 'no-store',
  });
}

/**
 * Fetch the privacy-preserving civilian-signal timestamps for one published
 * emergency. Returns null when the emergency is not a valid public source
 * (e.g. not published/verified) — callers should treat null as "no data".
 * Only `submitted_at` timestamps are returned; never locations, IDs, or PII.
 */
export function fetchCivilianSignals(
  emergencyId: number,
): Promise<CivilianSignalTimestampResponse[] | null> {
  return publicApiFetch<CivilianSignalTimestampResponse[] | null>(
    `/information/emergencies/${emergencyId}/civilian-signals`,
    { cache: 'no-store' },
  );
}

/**
 * Announcement images are stored as paths on the API host. Resolve a usable
 * browser URL: absolute URLs pass through, leading-slash paths are served from
 * the API origin, and bare paths are prefixed with the API base.
 */
export function resolveAnnouncementImageUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  if (/^https?:\/\//i.test(imagePath)) return imagePath;
  const base = API_BASE.replace(/\/$/, '');
  if (imagePath.startsWith('/')) return `${base}${imagePath}`;
  return `${base}/${imagePath}`;
}
