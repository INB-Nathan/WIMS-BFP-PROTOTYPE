/**
 * Tests for offline operation cancellation — cancelOfflineOperation.
 *
 * Covers:
 *  - Create ops cascade to deleteOfflineOpCascade
 *  - Non-create ops (update, submit, delete) use deleteOfflineOp
 *  - Syncing ops throw and are not deleted
 *  - Already-deleted ops are treated as success
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as offlineStore from '../offlineStore';

// Must be hoisted before module import
const { deleteOfflineOp, deleteOfflineOpCascade } = await vi.hoisted(async () => {
  const mockDelete = vi.fn();
  const mockCascade = vi.fn();
  return { deleteOfflineOp: mockDelete, deleteOfflineOpCascade: mockCascade };
});

vi.mock('../offlineStore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    deleteOfflineOp,
    deleteOfflineOpCascade,
  };
});

const { cancelOfflineOperation } = await import('../offlineOpActions');

function makeOp(overrides: Partial<Parameters<typeof cancelOfflineOperation>[0]> = {}) {
  return {
    localId: 'test-local-id',
    operation: 'create' as const,
    serverId: null,
    linkedLocalId: null,
    serverUpdatedAt: null,
    regionId: 1,
    encoderId: 'test-encoder',
    payload: { foo: 'bar' },
    createdAt: Date.now(),
    syncStatus: 'pending' as const,
    errorCode: null as string | null,
    errorMessage: null as string | null,
    serverVersion: null,
    retryCount: 0,
    lastAttemptAt: null,
    ...overrides,
  };
}

describe('cancelOfflineOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses deleteOfflineOpCascade for create ops', async () => {
    const op = makeOp({ operation: 'create', syncStatus: 'pending' });
    await cancelOfflineOperation(op);
    expect(deleteOfflineOpCascade).toHaveBeenCalledWith('test-local-id');
    expect(deleteOfflineOp).not.toHaveBeenCalled();
  });

  it('uses deleteOfflineOp for update ops', async () => {
    const op = makeOp({ operation: 'update', serverId: 42, syncStatus: 'pending' });
    await cancelOfflineOperation(op);
    expect(deleteOfflineOp).toHaveBeenCalledWith('test-local-id');
    expect(deleteOfflineOpCascade).not.toHaveBeenCalled();
  });

  it('uses deleteOfflineOp for submit ops', async () => {
    const op = makeOp({ operation: 'submit', serverId: 42, syncStatus: 'pending' });
    await cancelOfflineOperation(op);
    expect(deleteOfflineOp).toHaveBeenCalledWith('test-local-id');
    expect(deleteOfflineOpCascade).not.toHaveBeenCalled();
  });

  it('uses deleteOfflineOp for delete ops', async () => {
    const op = makeOp({ operation: 'delete', serverId: 99, syncStatus: 'pending' });
    await cancelOfflineOperation(op);
    expect(deleteOfflineOp).toHaveBeenCalledWith('test-local-id');
    expect(deleteOfflineOpCascade).not.toHaveBeenCalled();
  });

  it('uses deleteOfflineOp for archive_action ops', async () => {
    const op = makeOp({ operation: 'archive_action', serverId: 55, syncStatus: 'pending', payload: { incident_id: 55, action: 'archive' } });
    await cancelOfflineOperation(op);
    expect(deleteOfflineOp).toHaveBeenCalledWith('test-local-id');
    expect(deleteOfflineOpCascade).not.toHaveBeenCalled();
  });

  it('throws when syncStatus is syncing', async () => {
    const op = makeOp({ operation: 'update', serverId: 42, syncStatus: 'syncing' });
    await expect(cancelOfflineOperation(op)).rejects.toThrow('Cannot cancel syncing operation');
    expect(deleteOfflineOp).not.toHaveBeenCalled();
    expect(deleteOfflineOpCascade).not.toHaveBeenCalled();
  });

  it('treats already-deleted ops as success (no-op)', async () => {
    // Simulate non-existent op: deleteOfflineOp succeeds silently
    const op = makeOp({ operation: 'update', serverId: 42, syncStatus: 'pending' });
    await cancelOfflineOperation(op);
    expect(deleteOfflineOp).toHaveBeenCalledWith('test-local-id');
  });
});
