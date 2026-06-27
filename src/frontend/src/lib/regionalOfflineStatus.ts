/**
 * Offline op status summaries mapped to server incidents.
 *
 * Maps queued offline operations (excluding local create ops) to their
 * server incident IDs so the dashboard can display overlay badges on
 * incident cards.
 *
 * Operation → badge label mapping:
 *   update          → 'Update queued'
 *   submit          → 'Submit queued'
 *   delete          → 'Delete queued'
 *   archive_action  → 'Archive queued' | 'Restore queued'  (based on payload.action)
 *   conflict        → 'Conflict'
 *   failed          → 'Sync failed'
 */

import type { OfflineOpDecrypted } from './offlineStore';

export type OfflineStatusSeverity = 'pending' | 'failed' | 'conflict';

export interface OfflineOpStatus {
  operation: string;
  syncStatus: string;
  localId: string;
}

export interface RegionalIncidentOfflineStatus {
  serverId: number;
  labels: string[];
  severity: OfflineStatusSeverity;
  operations: OfflineOpStatus[];
  localIds: string[];
}

const SEVERITY_ORDER: Record<OfflineStatusSeverity, number> = {
  conflict: 0,
  failed: 1,
  pending: 2,
};

const OP_LABEL_MAP: Record<string, string> = {
  update: 'Update queued',
  submit: 'Submit queued',
  delete: 'Delete queued',
};

/**
 * Derive a display label for an archive_action operation.
 */
function archiveLabel(payload: Record<string, unknown>): string {
  return payload.action === 'unarchive' ? 'Restore queued' : 'Archive queued';
}

/**
 * Build the severity for a single op.
 */
function opSeverity(syncStatus: string): OfflineStatusSeverity {
  if (syncStatus === 'conflict') return 'conflict';
  if (syncStatus === 'failed') return 'failed';
  return 'pending';
}

/**
 * Resolve the server incident ID from an offline op.
 *
 * Priority:
 *   1. op.serverId (set for ops referencing an existing server incident)
 *   2. payload.incident_id (used by archive_action / submit payloads)
 */
function resolveServerId(op: OfflineOpDecrypted): number | null {
  if (op.serverId !== null) return op.serverId;
  const payloadId = (op.payload as Record<string, unknown>).incident_id;
  if (typeof payloadId === 'number') return payloadId;
  return null;
}

/**
 * Map a list of offline ops to per-server-incident status summaries.
 *
 * @param ops - Decrypted offline operations (can include any syncStatus)
 * @returns A Map keyed by server incident ID.
 *
 * Only ops that target an existing server incident are included.
 * Local create ops (no serverId, no payload.incident_id) are skipped
 * since they already have their own PENDING_SYNC card.
 */
export function buildOfflineStatusByServerId(
  ops: OfflineOpDecrypted[],
): Map<number, RegionalIncidentOfflineStatus> {
  const map = new Map<number, RegionalIncidentOfflineStatus>();

  for (const op of ops) {
    // Skip local create ops — they get their own card
    if (op.operation === 'create') continue;

    const serverId = resolveServerId(op);
    if (serverId === null) continue;

    const label =
      op.operation === 'archive_action'
        ? archiveLabel(op.payload as Record<string, unknown>)
        : OP_LABEL_MAP[op.operation] || `${op.operation} queued`;

    const severity = opSeverity(op.syncStatus);
    const existing = map.get(serverId);

    if (existing) {
      existing.labels.push(label);
      existing.operations.push({
        operation: op.operation,
        syncStatus: op.syncStatus,
        localId: op.localId,
      });
      existing.localIds.push(op.localId);

      // Upgrade severity if the new op is more severe
      if (SEVERITY_ORDER[severity] < SEVERITY_ORDER[existing.severity]) {
        existing.severity = severity;
      }
    } else {
      map.set(serverId, {
        serverId,
        labels: [label],
        severity,
        operations: [
          {
            operation: op.operation,
            syncStatus: op.syncStatus,
            localId: op.localId,
          },
        ],
        localIds: [op.localId],
      });
    }
  }

  return map;
}
