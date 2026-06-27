/**
 * Safe cancellation/withdraw actions for queued offline operations.
 *
 * Wraps the low-level IndexedDB delete helpers with guards against
 * cancelling ops that are currently being synced, and cascades for
 * create ops that may have linked submit/update ops.
 */

import { deleteOfflineOp, deleteOfflineOpCascade, type OfflineOpDecrypted } from './offlineStore';

/**
 * Cancel (delete) a queued offline operation.
 *
 * - Creates: cascades to linked submit/update ops via `deleteOfflineOpCascade`.
 * - Other operations (update, submit, delete, archive_action): single op delete.
 * - Throws if `op.syncStatus === 'syncing'` — cancelling an op mid-sync
 *   would corrupt the sync queue.
 *
 * @throws {Error} with message 'Cannot cancel syncing operation' if syncing.
 */
export async function cancelOfflineOperation(op: OfflineOpDecrypted): Promise<void> {
  if (op.syncStatus === 'syncing') {
    throw new Error('Cannot cancel syncing operation');
  }

  if (op.operation === 'create') {
    await deleteOfflineOpCascade(op.localId);
  } else {
    await deleteOfflineOp(op.localId);
  }
}
