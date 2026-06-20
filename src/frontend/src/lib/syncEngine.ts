/**
 * syncEngine — offline operations sync (FR-3B, FR-3F).
 *
 * Reads pending ops from the offlineOps IndexedDB store and replays them
 * against the regional encoder API endpoints in creation order.
 * Sequential processing preserves the dependency chain: a create must
 * succeed before its linked submit or update ops can be sent.
 *
 * Auth: checks the current session before replay and only refreshes when the
 * access session is gone, so fresh logins are not blocked by refresh issues.
 *
 * Conflict handling:
 *  - 409 DUPLICATE_DETECTED → marks op 'conflict/409_duplicate', stops that op (no retry)
 *  - 409 CONFLICT (OCC) → marks op 'conflict/409_conflict' with server_version for merge UI
 *  - network error → marks op 'error', aborts entire batch (still offline)
 *  - 4xx (non-409, retryCount < 5) → marks op 'error', continues next op
 *  - 4xx (retryCount ≥ 5) → marks op 'error', continues next op (skip)
 */

import {
  getPendingOps, getPendingIncidents, markSynced, markOpSyncing, markOpPending, markOpSynced, markOpConflict, markOpError, markOpFailed,
  purgeSyncedOps, evictStaleCachedIncidents, cacheIncident, getCachedIncident,
  type ArchiveActionPayload, type OfflineOpDecrypted, type OfflineOpType, type PendingIncident, type VerifyPayload,
} from './offlineStore';
import { refreshToken } from './auth-refresh';
import { isReachable, markConnectivityOffline } from './connectivity';

const MAX_RETRY = 5;
const MAX_BACKOFF_MS = 64_000; // 64s cap on exponential backoff

/**
 * Compute exponential backoff delay with ±20% jitter.
 * Formula: min(2^retryCount * 1000, 64s) + jitter.
 * Accepts an optional random function for deterministic testing.
 */
export function computeBackoffDelay(retryCount: number, random = Math.random): number {
  const base = Math.pow(2, retryCount) * 1000;
  const capped = Math.min(base, MAX_BACKOFF_MS);
  const jitter = (random() * 0.4 - 0.2) * capped; // ±20%
  return Math.max(0, capped + jitter);
}

/**
 * Return true when an op is within its backoff window and should not be retried yet.
 */
export function isWithinBackoffWindow(op: { retryCount: number; lastAttemptAt: number | null }): boolean {
  if (op.lastAttemptAt === null) return false;
  if (op.retryCount === 0) return false;
  const delay = computeBackoffDelay(op.retryCount - 1); // retryCount was already incremented
  return Date.now() - op.lastAttemptAt < delay;
}

const CREATE_ENDPOINT = '/api/regional/incidents';
// Offline creates replay through the same full-fidelity bundle endpoint the online
// form uses, so all nested detail (resources, timeline, casualties, encrypted PII)
// is preserved on sync. The flat /api/regional/incidents endpoint only persists
// scalar columns and would silently drop the nested blobs.
const CREATE_BUNDLE_ENDPOINT = '/api/incidents/upload-bundle';

export interface SyncError {
  localId: string;
  operation: string;
  status?: number;
  error?: string;
}

export interface SyncedIncidentSummary {
  serverId: number;
  category: string;
  location: string;
  // Which offline action was replayed for this incident. When several ops for the
  // same incident sync in one batch (e.g. create + submit), this reflects the
  // highest-order action so the encoder sees the final outcome.
  operation: OfflineOpType;
  // Human-readable resulting status, e.g. "Saved as draft", "Submitted for review".
  result: string;
}

const OP_RESULT_LABEL: Record<OfflineOpType, string> = {
  create: 'Saved as draft',
  update: 'Changes saved',
  submit: 'Submitted for review',
  delete: 'Deleted',
  verify: 'Verification synced',
  archive_action: 'Archive action synced',
};

// Higher number = higher-order action. Used to decide which operation label wins
// when one incident has several ops synced in the same batch.
const OP_PRECEDENCE: Record<OfflineOpType, number> = {
  create: 0,
  update: 1,
  submit: 2,
  verify: 2,
  archive_action: 2,
  delete: 3,
};

export interface SyncResult {
  synced: number;
  conflicts: number;
  failed: number;
  errors: SyncError[];
  abortReason?: 'auth' | 'offline';
  syncedIncidents?: SyncedIncidentSummary[];
}

type AuthCheckResult = 'authenticated' | 'auth' | 'offline';

// ── Internal helpers ─────────────────────────────────────────────────────────

type ApiFetchResult =
  | { ok: boolean; status: number; body: Record<string, unknown> }
  | { ok: false; status: 0; error: string }
  | { ok: false; status: number; body: Record<string, unknown>; error: string };

async function apiFetch(
  path: string,
  options: RequestInit
): Promise<ApiFetchResult> {
  try {
    const res = await fetch(path, {
      ...options,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    });

    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Malformed response body — return an error result with the status
      if (!res.ok) {
        return { ok: false, status: res.status, body: {} };
      }
      return { ok: false, status: res.status, body: {}, error: 'ParseError' };
    }

    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    // Network error — connectivity lost
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Network error' };
  }
}

async function checkSession(): Promise<AuthCheckResult> {
  try {
    const res = await fetch('/api/auth/session', {
      credentials: 'include',
      cache: 'no-store',
    });

    if (res.ok) return 'authenticated';
    if (res.status === 401 || res.status === 403) return 'auth';
    // 429 / 5xx are server-side errors, not connectivity loss — treat as auth
    // so callers surface "session issue" rather than the misleading "offline" message.
    if (res.status >= 500 || res.status === 429) return 'auth';
    return 'auth';
  } catch {
    return 'offline';
  }
}

async function ensureAuthenticatedForSync(): Promise<{ ok: true } | { ok: false; reason: 'auth' | 'offline' }> {
  const session = await checkSession();
  if (session === 'authenticated') return { ok: true };
  if (session === 'offline') return { ok: false, reason: 'offline' };

  const tokenResult = await refreshToken();
  if (!tokenResult.ok) return { ok: false, reason: tokenResult.reason };

  const refreshedSession = await checkSession();
  if (refreshedSession === 'authenticated') return { ok: true };
  return { ok: false, reason: refreshedSession === 'offline' ? 'offline' : 'auth' };
}

/**
 * Resolve the serverId for an op whose create hasn't synced yet.
 * Walks the linkedLocalId chain to find the serverId assigned after sync.
 */
function resolveServerId(
  op: OfflineOpDecrypted,
  syncedServerIds: Map<string, number>
): number | null {
  if (op.serverId !== null) return op.serverId;
  if (op.linkedLocalId) return syncedServerIds.get(op.linkedLocalId) ?? null;
  return null;
}

// ── Op processors ─────────────────────────────────────────────────────────────

async function processCreate(
  op: OfflineOpDecrypted,
  syncedServerIds: Map<string, number>
): Promise<{ ok: boolean; serverId?: number; conflictCode?: string; serverVersion?: Record<string, unknown>; status?: number; error?: string }> {
  // op.payload is the full nested incident object (latitude/longitude/region_id at
  // the top level, plus incident_nonsensitive_details + incident_sensitive_details).
  // Wrap it in the bundle envelope and tag it with the idempotency key.
  const incidentItem = { ...op.payload, client_id: op.localId };
  const body = { region_id: op.regionId, incidents: [incidentItem] };

  const res = await apiFetch(CREATE_BUNDLE_ENDPOINT, { method: 'POST', body: JSON.stringify(body) });

  if (res.ok) {
    const resBody = 'body' in res ? res.body : {};
    const ids = resBody.incident_ids as number[] | undefined;
    const serverId = Array.isArray(ids) && ids.length > 0
      ? ids[0]
      : (resBody.incident_id as number | undefined);
    if (!serverId) {
      // Bundle accepted (200) but nothing imported — treat as a retryable error so
      // the op stays queued rather than being marked synced with no server record.
      const failed = resBody.failed as Array<{ reason?: string }> | undefined;
      const reason = failed?.[0]?.reason ?? 'upload-bundle returned no incident id';
      return { ok: false, status: res.status, error: reason };
    }
    syncedServerIds.set(op.localId, serverId);
    return { ok: true, serverId };
  }

  if (res.status === 0) return { ok: false, status: 0, error: 'error' in res ? res.error : 'Network error' };

  const createBody = 'body' in res ? res.body : {};
  if (res.status === 409) {
    const code = (createBody.detail as Record<string, string> | null)?.code ?? createBody.code as string;
    if (code === 'DUPLICATE_DETECTED') return { ok: false, conflictCode: '409_duplicate', status: 409 };
    return { ok: false, conflictCode: '409_conflict', serverVersion: createBody.server_version as Record<string, unknown>, status: 409 };
  }

  return { ok: false, status: res.status, error: (createBody.detail as string) ?? `HTTP ${res.status}` };
}

async function processUpdate(
  op: OfflineOpDecrypted,
  syncedServerIds: Map<string, number>
): Promise<{ ok: boolean; conflictCode?: string; serverVersion?: Record<string, unknown>; status?: number; error?: string }> {
  const serverId = resolveServerId(op, syncedServerIds);
  if (!serverId) return { ok: false, error: 'serverId not yet resolved (create may have failed)', status: undefined };

  const body = { ...op.payload, client_updated_at: op.serverUpdatedAt };
  const res = await apiFetch(`${CREATE_ENDPOINT}/${serverId}`, { method: 'PUT', body: JSON.stringify(body) });

  if (res.ok) return { ok: true };
  if (res.status === 0) return { ok: false, status: 0, error: 'error' in res ? res.error : 'Network error' };
  if (res.status === 409) {
    const body = 'body' in res ? res.body : {};
    return { ok: false, conflictCode: '409_conflict', serverVersion: body.server_version as Record<string, unknown>, status: 409 };
  }
  const updateBody = 'body' in res ? res.body : {};
  return { ok: false, status: res.status, error: (updateBody.detail as string) ?? `HTTP ${res.status}` };
}

async function processSubmit(
  op: OfflineOpDecrypted,
  syncedServerIds: Map<string, number>
): Promise<{ ok: boolean; conflictCode?: string; status?: number; error?: string }> {
  const serverId = resolveServerId(op, syncedServerIds);
  if (!serverId) return { ok: false, error: 'serverId not yet resolved (create may have failed)', status: undefined };

  const res = await apiFetch(`${CREATE_ENDPOINT}/${serverId}/submit`, { method: 'PATCH', body: '{}' });

  if (res.ok) return { ok: true };
  if (res.status === 0) return { ok: false, status: 0, error: 'error' in res ? res.error : 'Network error' };
  if (res.status === 409) {
    const submitBody = 'body' in res ? res.body : {};
    const code = (submitBody.detail as Record<string, string> | null)?.code ?? submitBody.code as string;
    return { ok: false, conflictCode: code === 'DUPLICATE_DETECTED' ? '409_duplicate' : '409_conflict', status: 409 };
  }
  const submitErrBody = 'body' in res ? res.body : {};
  return { ok: false, status: res.status, error: (submitErrBody.detail as string) ?? `HTTP ${res.status}` };
}

async function processDelete(
  op: OfflineOpDecrypted,
  syncedServerIds: Map<string, number>
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const serverId = resolveServerId(op, syncedServerIds);
  if (!serverId) {
    // Draft was never synced — just remove the local op, nothing to delete on server
    return { ok: true };
  }
  const res = await apiFetch(`${CREATE_ENDPOINT}/draft/${serverId}`, { method: 'DELETE' });
  if (res.ok) return { ok: true };
  if (res.status === 0) return { ok: false, status: 0, error: 'error' in res ? res.error : 'Network error' };
  if (res.status === 404) return { ok: true }; // already deleted on server — treat as success
  const deleteBody = 'body' in res ? res.body : {};
  return { ok: false, status: res.status, error: (deleteBody.detail as string) ?? `HTTP ${res.status}` };
}

async function processVerify(
  op: OfflineOpDecrypted
): Promise<{ ok: boolean; conflictCode?: string; status?: number; error?: string }> {
  const payload = op.payload as unknown as VerifyPayload;
  const res = await apiFetch(`/api/regional/incidents/${payload.incident_id}/verification`, {
    method: 'PATCH',
    body: JSON.stringify({
      action: payload.action,
      notes: payload.notes ?? null,
      client_id: op.localId,
      ...(payload.original_incident_id !== undefined ? { original_incident_id: payload.original_incident_id } : {}),
    }),
  });
  if (res.ok) return { ok: true };
  if (res.status === 0) return { ok: false, status: 0, error: 'error' in res ? res.error : 'Network error' };
  const body = 'body' in res ? res.body : {};
  const detail = body.detail as string | Record<string, unknown> | undefined;
  const code = typeof detail === 'object' ? detail.code : body.code;
  if (res.status === 409) {
    return { ok: false, conflictCode: code === 'DUPLICATE_DETECTED' ? '409_duplicate' : '409_conflict', status: 409 };
  }
  return { ok: false, status: res.status, error: typeof detail === 'string' ? detail : `HTTP ${res.status}` };
}

async function processArchiveAction(
  op: OfflineOpDecrypted
): Promise<{ ok: boolean; conflictCode?: string; status?: number; error?: string }> {
  const payload = op.payload as unknown as ArchiveActionPayload;
  const endpoint = payload.action === 'archive'
    ? `/api/regional/validator/incidents/${payload.incident_id}/archive`
    : `/api/regional/validator/incidents/${payload.incident_id}/unarchive`;
  const res = await apiFetch(endpoint, {
    method: 'PATCH',
    body: JSON.stringify({ client_id: op.localId }),
  });
  if (res.ok) return { ok: true };
  if (res.status === 0) return { ok: false, status: 0, error: 'error' in res ? res.error : 'Network error' };
  const body = 'body' in res ? res.body : {};
  const detail = body.detail as string | Record<string, unknown> | undefined;
  const code = typeof detail === 'object' ? detail.code : body.code;
  if (res.status === 409) {
    return { ok: false, conflictCode: code === 'DUPLICATE_DETECTED' ? '409_duplicate' : '409_conflict', status: 409 };
  }
  return { ok: false, status: res.status, error: typeof detail === 'string' ? detail : `HTTP ${res.status}` };
}

async function processLegacyCreate(item: PendingIncident): Promise<{ ok: boolean; status?: number; error?: string }> {
  const res = await apiFetch('/api/v1/public/report', {
    method: 'POST',
    body: JSON.stringify(item.payload),
  });
  if (res.ok) return { ok: true };
  if (res.status === 0) return { ok: false, status: 0, error: 'error' in res ? res.error : 'Network error' };
  const body = 'body' in res ? res.body : {};
  return { ok: false, status: res.status, error: (body.detail as string) ?? `HTTP ${res.status}` };
}

async function processLegacyVerify(item: PendingIncident): Promise<{ ok: boolean; status?: number; error?: string }> {
  const payload = item.payload as unknown as VerifyPayload;
  const res = await apiFetch(`/api/regional/incidents/${payload.incident_id}/verification`, {
    method: 'PATCH',
    body: JSON.stringify({
      action: payload.action,
      notes: payload.notes ?? null,
      client_id: item.localId ?? null,
      ...(payload.original_incident_id !== undefined ? { original_incident_id: payload.original_incident_id } : {}),
    }),
  });
  if (res.ok) return { ok: true };
  if (res.status === 0) return { ok: false, status: 0, error: 'error' in res ? res.error : 'Network error' };
  if (res.status === 409) return { ok: false, status: 409, error: 'Conflict: DUPLICATE_DETECTED' };
  const body = 'body' in res ? res.body : {};
  return { ok: false, status: res.status, error: (body.detail as string) ?? `HTTP ${res.status}` };
}

async function processLegacyArchiveAction(item: PendingIncident): Promise<{ ok: boolean; status?: number; error?: string }> {
  const payload = item.payload as unknown as ArchiveActionPayload;
  const endpoint = payload.action === 'archive'
    ? `/api/regional/validator/incidents/${payload.incident_id}/archive`
    : `/api/regional/validator/incidents/${payload.incident_id}/unarchive`;
  const res = await apiFetch(endpoint, {
    method: 'PATCH',
    body: JSON.stringify({ client_id: item.localId ?? null }),
  });
  if (res.ok) return { ok: true };
  if (res.status === 0) return { ok: false, status: 0, error: 'error' in res ? res.error : 'Network error' };
  if (res.status === 409) return { ok: false, status: 409, error: 'Conflict: DUPLICATE_DETECTED' };
  const body = 'body' in res ? res.body : {};
  return { ok: false, status: res.status, error: (body.detail as string) ?? `HTTP ${res.status}` };
}

// ── Main sync function ────────────────────────────────────────────────────────

/**
 * Sync all pending offline operations for the given encoder.
 *
 * @param encoderId - The Keycloak sub/id of the currently logged-in encoder.
 *                    Operations from other encoders are skipped (shared device safety).
 */
export async function syncPendingIncidents(
  encoderId?: string,
  options: { bypassBackoff?: boolean } = {}
): Promise<SyncResult> {
  if (!(await isReachable())) {
    return { synced: 0, conflicts: 0, failed: 0, errors: [], syncedIncidents: [], abortReason: 'offline' };
  }

  const ops = encoderId ? await getPendingOps(encoderId) : [];
  const legacyItems = await getPendingIncidents();
  if (ops.length === 0 && legacyItems.length === 0) {
    return { synced: 0, conflicts: 0, failed: 0, errors: [], syncedIncidents: [] };
  }

  if (ops.length > 0 || encoderId) {
    const authResult = await ensureAuthenticatedForSync();
    if (!authResult.ok) {
      return { synced: 0, conflicts: 0, failed: 0, errors: [], syncedIncidents: [], abortReason: authResult.reason };
    }
  }

  let synced = 0;
  let conflicts = 0;
  let failed = 0;
  const errors: SyncError[] = [];
  // Keyed by serverId so create + linked submit (etc.) collapse into one entry
  // showing the final outcome. Negative keys hold ops whose serverId is unknown
  // (e.g. an offline create that synced but returned no usable id path).
  const syncedSummaries = new Map<number, SyncedIncidentSummary>();
  // Map from localId → serverId for create ops that succeed during this batch.
  // Needed so linked submit/update ops can resolve their serverId.
  const syncedServerIds = new Map<string, number>();

  // Build/merge a summary entry for a synced op (item A2). Pulls category/location
  // from the op payload when present, otherwise from the read cache, otherwise from
  // an earlier op for the same incident in this batch.
  const recordSynced = async (serverId: number, op: OfflineOpDecrypted) => {
    const existing = syncedSummaries.get(serverId);
    const payload = (op.payload ?? {}) as Record<string, unknown>;
    const ns = (payload.incident_nonsensitive_details as Record<string, unknown>) ?? payload;
    let category = (ns.general_category || ns.classification_of_involved || '') as string;
    let location = (ns.incident_address || ns.street_address || '') as string;

    if ((!category || !location) && existing) {
      category = category || existing.category;
      location = location || existing.location;
    }
    // Submit/delete ops carry an empty payload — fall back to the cached incident.
    if (!category && !location) {
      const cached = await getCachedIncident(serverId, op.encoderId).catch(() => undefined);
      const cd = (cached?.data ?? {}) as Record<string, unknown>;
      const cns = (cd.nonsensitive as Record<string, unknown>) ?? cd;
      category = (cns.general_category || cns.classification_of_involved || '') as string;
      location = (cns.incident_address || cns.street_address || cd.location_display || '') as string;
    }

    const winningOp =
      existing && OP_PRECEDENCE[existing.operation] >= OP_PRECEDENCE[op.operation]
        ? existing.operation
        : op.operation;

    syncedSummaries.set(serverId, {
      serverId,
      category: category || existing?.category || '',
      location: location || existing?.location || '',
      operation: winningOp,
      result: OP_RESULT_LABEL[winningOp],
    });
  };

  for (const op of ops) {
    // Skip ops already marked as permanently failed
    if (op.syncStatus === 'failed') {
      continue;
    }
    // Mark as permanently failed after exhausting all retries
    if (op.retryCount >= MAX_RETRY) {
      await markOpFailed(op.localId, op.errorCode ?? 'network', op.errorMessage ?? 'max retries exceeded');
      // Report to backend so admin dashboard can surface this op
      fetch('/api/admin/sync/report', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          localId: op.localId,
          operation: op.operation,
          errorCode: op.errorCode,
          errorMessage: op.errorMessage,
          encoderId: op.encoderId,
          regionId: op.regionId,
          retryCount: op.retryCount,
        }),
      }).catch(() => { /* best-effort; IndexedDB is the source of truth */ });
      failed++;
      errors.push({ localId: op.localId, operation: op.operation, error: 'max retries exceeded' });
      continue;
    }
    // Skip ops within exponential backoff window
    if (!options.bypassBackoff && isWithinBackoffWindow(op)) {
      continue;
    }

    await markOpSyncing(op.localId);

    let result: { ok: boolean; serverId?: number; conflictCode?: string; serverVersion?: Record<string, unknown>; status?: number; error?: string };

    switch (op.operation) {
      case 'create':         result = await processCreate(op, syncedServerIds); break;
      case 'update':         result = await processUpdate(op, syncedServerIds); break;
      case 'submit':         result = await processSubmit(op, syncedServerIds); break;
      case 'delete':         result = await processDelete(op, syncedServerIds); break;
      case 'verify':         result = await processVerify(op); break;
      case 'archive_action': result = await processArchiveAction(op); break;
      default:               result = { ok: false, error: `unknown operation: ${op.operation}` };
    }

    if (result.ok) {
      await markOpSynced(op.localId, result.serverId);
      // Resolve the serverId this op acted on so its summary merges correctly.
      const summaryServerId =
        op.operation === 'create'
          ? result.serverId ?? null
          : resolveServerId(op, syncedServerIds);
      if (op.operation === 'create' && result.serverId) {
        // Cache the created incident so dashboard shows it offline immediately
        await cacheIncident(result.serverId, op.payload, encoderId!);
      }
      if (summaryServerId !== null) {
        await recordSynced(summaryServerId, op);
      }
      synced++;
    } else if (result.conflictCode) {
      await markOpConflict(
        op.localId,
        result.conflictCode as '409_duplicate' | '409_conflict',
        result.serverVersion
      );
      conflicts++;
      errors.push({ localId: op.localId, operation: op.operation, status: result.status, error: result.conflictCode });
    } else if (result.status === 0) {
      // Network error — connectivity lost again; stop the batch
      markConnectivityOffline();
      await markOpError(op.localId, 'network', result.error ?? 'Network error');
      failed++;
      errors.push({ localId: op.localId, operation: op.operation, error: result.error });
      break;
    } else if (result.status === 401) {
      await markOpPending(op.localId, 'Session expired before this operation could sync.');
      errors.push({ localId: op.localId, operation: op.operation, status: 401, error: result.error ?? 'Session expired' });
      return { synced, conflicts, failed, errors, syncedIncidents: [...syncedSummaries.values()], abortReason: 'auth' };
    } else {
      const errorCode = result.status === 403 ? '403' : result.status ? '4xx' : 'network';
      await markOpError(op.localId, errorCode, result.error ?? `HTTP ${result.status}`);
      failed++;
      errors.push({ localId: op.localId, operation: op.operation, status: result.status, error: result.error });
    }
  }

  for (const item of legacyItems) {
    let result: { ok: boolean; status?: number; error?: string };
    switch (item.opType) {
      case 'verify':
        result = await processLegacyVerify(item);
        break;
      case 'archive_action':
        result = await processLegacyArchiveAction(item);
        break;
      default:
        result = await processLegacyCreate(item);
        break;
    }

    if (result.ok) {
      await markSynced(item.id);
      synced++;
    } else {
      failed++;
      errors.push({
        localId: item.localId ?? String(item.id),
        operation: item.opType ?? 'create',
        status: result.status,
        error: result.error,
      });
      if (!result.status) {
        markConnectivityOffline();
        break;
      }
    }
  }

  // Housekeeping on successful batch
  if (synced > 0) {
    await purgeSyncedOps();
    if (encoderId) await evictStaleCachedIncidents(encoderId);
  }

  return { synced, conflicts, failed, errors, syncedIncidents: [...syncedSummaries.values()] };
}
