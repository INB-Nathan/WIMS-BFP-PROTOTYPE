import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

vi.stubGlobal('crypto', webcrypto);

const {
  decryptOfflineReporterIdentity,
  encryptOfflineReporterIdentity,
} = await import('../offlineReporterIdentity');
const { getDB, queuePublicOfflineOp, markPublicOpSynced } = await import('../offlineStore');

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});

describe('offline reporter identity', () => {
  it('round-trips with report-bound AAD and rejects a changed association', async () => {
    const envelope = await encryptOfflineReporterIdentity('report-client-1', {
      reporter_name: 'Juan Dela Cruz',
      reporter_phone: '09171234567',
    });

    await expect(decryptOfflineReporterIdentity(envelope)).resolves.toEqual({
      reporter_name: 'Juan Dela Cruz',
      reporter_phone: '09171234567',
    });
    await expect(
      decryptOfflineReporterIdentity({ ...envelope, clientReportId: 'report-client-2' }),
    ).rejects.toThrow();
  });

  it('stores no plaintext reporter PII and clears envelope after sync', async () => {
    const reporterIdentity = await encryptOfflineReporterIdentity('report-client-1', {
      reporter_name: 'Juan Dela Cruz',
      reporter_phone: '09171234567',
    });
    await queuePublicOfflineOp({
      localId: 'op-1',
      deviceId: 'device-1',
      operation: 'submit',
      payload: { client_report_id: 'report-client-1', category: 'STRUCTURAL' },
      reporterIdentity,
      linkedLocalId: null,
      serverId: null,
      createdAt: 1,
      status: 'pending',
      errorCode: null,
      errorMessage: null,
      retryCount: 0,
      lastAttemptAt: null,
    });

    const db = await getDB();
    const stored = await db.get('publicOfflineOps', 'op-1');
    expect(JSON.stringify(stored)).not.toContain('Juan Dela Cruz');
    expect(JSON.stringify(stored)).not.toContain('09171234567');

    await markPublicOpSynced('op-1', 42);
    const synced = await db.get('publicOfflineOps', 'op-1');
    expect(synced.reporterIdentity).toBeUndefined();
  });
});
