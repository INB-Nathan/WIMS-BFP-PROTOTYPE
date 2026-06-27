/**
 * Safe cancellation/withdraw actions for queued offline operations.
 *
 * Wraps the low-level IndexedDB delete helpers with guards against
 * cancelling ops that are currently being synced, and cascades for
 * create ops that may have linked submit/update ops.
 */

import { deleteOfflineOp, deleteOfflineOpCascade, getOfflineOp, type OfflineOpDecrypted } from './offlineStore';

/**
 * Cancel (delete) a queued offline operation.
 *
 * - Creates: cascades to linked submit/update ops via `deleteOfflineOpCascade`.
 * - Other operations (update, submit, delete, archive_action): single op delete.
 * - Re-reads the op from IndexedDB before deleting so a stale UI copy cannot
 *   cancel an op that has since moved into `syncing`.
 * - Throws if the latest op has `syncStatus === 'syncing'` — cancelling an op
 *   mid-sync would corrupt the sync queue.
 *
 * @throws {Error} with message 'Cannot cancel syncing operation' if syncing.
 */
export async function cancelOfflineOperation(op: OfflineOpDecrypted): Promise<void> {
  const latestOp = await getOfflineOp(op.localId);
  const opToCancel = latestOp ?? op;

  if (opToCancel.syncStatus === 'syncing') {
    throw new Error('Cannot cancel syncing operation');
  }

  if (opToCancel.operation === 'create') {
    await deleteOfflineOpCascade(opToCancel.localId);
  } else {
    await deleteOfflineOp(opToCancel.localId);
  }
}
