/**
 * offlineCivilianReads — offline-aware cached wrappers for civilian read
 * endpoints (tracking page / PWA instant-load).
 *
 * Wraps three public GET endpoints with the established `offlineAware()`
 * pattern so the first online fetch populates IndexedDB. Subsequent PWA
 * loads serve from cache without a network round-trip.
 *
 * TTLs (chosen for PWA "loads instantly on return" behaviour):
 *   - My reports list:  10 min (doesn't change frequently per device)
 *   - Single report:     5 min (status may update on server)
 *   - Timeline:          5 min (follow-ups may appear)
 *
 * All three are public (unauthenticated), keyed by deviceId.
 */

import { offlineAware, type OfflineResult } from './offlineBase';
import { publicApiFetch } from './public-transport';
import type {
  CivilianReportTrackingResponse,
  CivilianReportTimelineResult,
  MyReportItem,
} from './legacy';

// Re-export the shared result type so the page can destructure it uniformly.
export type { OfflineResult };

// Device-bound cache TTLs
const MY_REPORTS_TTL_MS = 10 * 60 * 1000;   // 10 minutes
const REPORT_DETAIL_TTL_MS = 5 * 60 * 1000;  // 5 minutes
const TIMELINE_TTL_MS = 5 * 60 * 1000;        // 5 minutes

// Offline error messages
const OFFLINE_MY_REPORTS_MSG =
  'Your reports are unavailable offline. Connect to the internet to refresh this list.';
const OFFLINE_REPORT_MSG =
  'This report is unavailable offline. Connect to the internet to check its status.';
const OFFLINE_TIMELINE_MSG =
  'The timeline is unavailable offline. Connect to the internet to see updates.';

/**
 * Fetch all reports for this device, served from IndexedDB cache on repeat
 * visits or when offline.
 */
export function fetchMyReportsOfflineAware(
  deviceId: string,
): Promise<OfflineResult<{ reports: MyReportItem[] }>> {
  return offlineAware<{ reports: MyReportItem[] }>(
    'my-reports',
    [deviceId],
    'civilian',
    MY_REPORTS_TTL_MS,
    () => publicApiFetch<{ reports: MyReportItem[] }>(
      `/civilian/reports?device_id=${encodeURIComponent(deviceId)}`,
    ),
    OFFLINE_MY_REPORTS_MSG,
  );
}

/**
 * Fetch a single report's full status, served from cache on repeat visits.
 */
export function fetchReportStatusOfflineAware(
  reportId: string | number,
  deviceId: string,
): Promise<OfflineResult<CivilianReportTrackingResponse>> {
  return offlineAware<CivilianReportTrackingResponse>(
    'report-status',
    [String(reportId), deviceId],
    'civilian',
    REPORT_DETAIL_TTL_MS,
    () => publicApiFetch<CivilianReportTrackingResponse>(
      `/civilian/reports/${reportId}?device_id=${encodeURIComponent(deviceId)}`,
    ),
    OFFLINE_REPORT_MSG,
  );
}

/**
 * Fetch a report's timeline (parent + children + follow-ups), served from
 * cache on repeat visits.
 */
export function fetchReportTimelineOfflineAware(
  reportId: string | number,
  deviceId: string,
): Promise<OfflineResult<CivilianReportTimelineResult>> {
  return offlineAware<CivilianReportTimelineResult>(
    'report-timeline',
    [String(reportId), deviceId],
    'civilian',
    TIMELINE_TTL_MS,
    async () => {
      const json = await publicApiFetch<{
        timeline?: CivilianReportTimelineResult['timeline'];
        followups?: CivilianReportTimelineResult['followups'];
      }>(`/civilian/reports/${reportId}/timeline?device_id=${encodeURIComponent(deviceId)}`);
      return {
        timeline: json.timeline ?? [],
        followups: json.followups ?? [],
      };
    },
    OFFLINE_TIMELINE_MSG,
  );
}
