/**
 * offlineCivilian — offline-aware wrappers for the public civilian reporting flow
 * (FR-CIV-OFFLINE).
 *
 * Three operations are wrapped: submit, append, followup. Each follows the
 * validator-style Pattern B from the handoff:
 *
 *   1. If `shouldServeOffline()` is true → queue to the publicOfflineOps store
 *      and return { queued: true, localId }. No network attempt.
 *   2. Otherwise call the underlying legacy API. On success, return
 *      { queued: false, response }. On a network error (TypeError / fetch fail)
 *      → mark connectivity offline and queue, returning { queued: true }. On a
 *      non-network error (e.g. 422) → re-throw to the caller.
 *
 * The `linkedLocalId` parameter on append/followup is what lets the sync engine
 * reconstruct the dependency chain: a submit that succeeds at server id=42 is
 * the parent of any append/followup whose linkedLocalId points to that submit's
 * localId. The sync engine walks the chain in createdAt order.
 *
 * These wrappers are intentionally separate from offlineValidator.ts so the
 * auth boundary stays obvious — this file never touches the auth session.
 */

import {
  submitCivilianReportV2,
  appendCivilianReport,
  submitFollowup,
  type CivilianReportV2Payload,
  type CivilianReportV2Response,
  type CivilianReportTrackingResponse,
  type CivilianFollowupResponse,
} from './legacy';
import { queuePublicOfflineOp, type PublicOfflineOp } from '../offlineStore';
import { markConnectivityOffline } from '../connectivity';
import { isNetworkError, shouldServeOffline } from './offlineBase';

export interface OfflineQueueResult {
  queued: boolean;
  localId: string;
}

export type OfflineAwareResult<T> =
  | { queued: false; response: T }
  | { queued: true; localId: string };

/**
 * Generate a localId for a queued op. Uses crypto.randomUUID() in secure
 * contexts (HTTPS / localhost); falls back to a Math.random() variant when
 * crypto.randomUUID is unavailable (e.g. plain HTTP during local dev — the
 * handoff's gotcha #3).
 */
function generateLocalId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  // 36-char hex-with-dashes matching UUID v4 shape
  const hex = (n: number) => Math.floor(Math.random() * Math.pow(16, n)).toString(16).padStart(n, '0');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}

/**
 * Submit a civilian fire report with offline-first behaviour.
 *
 * @param payload  The structured Phase 2 payload (validated server-side).
 * @param deviceId Browser-bound identity from localStorage. Required for both
 *                 the queued payload and the server's zero-trust device check.
 */
export async function submitCivilianReportOfflineAware(
  payload: CivilianReportV2Payload,
  deviceId: string
): Promise<OfflineAwareResult<CivilianReportV2Response>> {
  if (shouldServeOffline()) {
    return queueSubmit(payload, deviceId);
  }

  try {
    const response = await submitCivilianReportV2(payload);
    return { queued: false, response };
  } catch (err) {
    if (isNetworkError(err)) {
      markConnectivityOffline();
      return queueSubmit(payload, deviceId);
    }
    throw err;
  }
}

function queueSubmit(payload: CivilianReportV2Payload, deviceId: string): { queued: true; localId: string } {
  const localId = generateLocalId();
  const op: PublicOfflineOp = {
    localId,
    deviceId,
    operation: 'submit',
    payload: { ...payload },
    linkedLocalId: null,
    serverId: null,
    createdAt: Date.now(),
    status: 'pending',
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    lastAttemptAt: null,
  };
  // queuePublicOfflineOp returns a Promise; we deliberately fire-and-forget here
  // to keep the public API synchronous-feeling. The actual write completes in
  // the next microtask and the test suite verifies the call was made.
  void queuePublicOfflineOp(op);
  return { queued: true, localId };
}

/**
 * Append additional data to an existing civilian report. Queues when offline
 * with `linkedLocalId` set to the parent submit's localId so the sync engine
 * can PATCH the right /reports/{serverId}/append endpoint after the parent
 * submit succeeds.
 *
 * If `parentLocalId` is omitted, the op is queued as a top-level op (rare —
 * only happens if a user appends before the parent submit has been queued).
 */
export interface AppendInput {
  parentLocalId?: string | null;
  reportId?: number | null;     // present only when the parent already has a serverId
  latitude?: number;
  longitude?: number;
  category?: string;
  sub_category?: string;
  reported_at?: string;
  device_id: string;
  reporting_context?: string;
  safety_status?: string;
  phone_latitude?: number;
  phone_longitude?: number;
  gps_distance_m?: number;
  gps_warning_confirmed?: boolean;
  witness_name?: string;
  witness_phone?: string;
  description: string;
}

export async function appendCivilianReportOfflineAware(
  input: AppendInput,
  deviceId: string
): Promise<OfflineAwareResult<CivilianReportTrackingResponse>> {
  if (shouldServeOffline()) {
    return queueAppend(input, deviceId);
  }

  if (!input.reportId) {
    // Online but no serverId known → must queue; the parent submit hasn't
    // been synced yet.
    return queueAppend(input, deviceId);
  }

  try {
    const { reportId, ...payload } = input;
    const response = await appendCivilianReport(reportId, payload);
    return { queued: false, response };
  } catch (err) {
    if (isNetworkError(err)) {
      markConnectivityOffline();
      return queueAppend(input, deviceId);
    }
    throw err;
  }
}

function queueAppend(input: AppendInput, deviceId: string): { queued: true; localId: string } {
  const localId = generateLocalId();
  const { reportId: _reportId, ...payload } = input;
  void _reportId;
  const op: PublicOfflineOp = {
    localId,
    deviceId,
    operation: 'append',
    payload,
    linkedLocalId: input.parentLocalId ?? null,
    serverId: input.reportId ?? null,
    createdAt: Date.now(),
    status: 'pending',
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    lastAttemptAt: null,
  };
  void queuePublicOfflineOp(op);
  return { queued: true, localId };
}

/**
 * Submit a followup comment to an existing report. Same offline-first pattern
 * as append.
 */
export interface FollowupInput {
  parentLocalId?: string | null;
  reportId?: number | null;
  followupText: string;
  device_id: string;
}

export async function submitFollowupOfflineAware(
  input: FollowupInput,
  deviceId: string
): Promise<OfflineAwareResult<CivilianFollowupResponse>> {
  if (shouldServeOffline()) {
    return queueFollowup(input, deviceId);
  }

  if (!input.reportId) {
    return queueFollowup(input, deviceId);
  }

  try {
    const response = await submitFollowup(input.reportId, input.followupText, input.device_id);
    return { queued: false, response };
  } catch (err) {
    if (isNetworkError(err)) {
      markConnectivityOffline();
      return queueFollowup(input, deviceId);
    }
    throw err;
  }
}

function queueFollowup(input: FollowupInput, deviceId: string): { queued: true; localId: string } {
  const localId = generateLocalId();
  const op: PublicOfflineOp = {
    localId,
    deviceId,
    operation: 'followup',
    payload: { followup_text: input.followupText, device_id: input.device_id },
    linkedLocalId: input.parentLocalId ?? null,
    serverId: input.reportId ?? null,
    createdAt: Date.now(),
    status: 'pending',
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    lastAttemptAt: null,
  };
  void queuePublicOfflineOp(op);
  return { queued: true, localId };
}

// ── Review eligibility gate ─────────────────────────────────────────

/**
 * The review step requires an online duplicate-suggestion fetch (handoff
 * decision #6: block review when offline so users can see if a similar report
 * already exists before submitting). Call this from page.tsx before fetching
 * duplicate suggestions — throws a bilingual message the page can render.
 */
export function checkReviewEligibility(): void {
  if (shouldServeOffline()) {
    throw new Error(
      'Connect to the internet to check for similar reports. ' +
        'Kailangang mag-online para suriin kung may katulad na report.'
    );
  }
}
