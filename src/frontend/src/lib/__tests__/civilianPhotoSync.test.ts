/**
 * Tests for civilianPhotoSync — syncPendingPhotos.
 *
 * Covers: empty queue, key loss, happy path, duplicate detection,
 * null parentServerReportId skip, permanent failure skip, retry cap,
 * backoff window, decryption failure, network/4xx/5xx error handling,
 * and retry-count persistence via markPhotoRetry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OfflinePhotoRecord } from '../offlineStore';

const DEVICE_ID = 'test-device-001';

function makePhoto(overrides: Partial<OfflinePhotoRecord> = {}): OfflinePhotoRecord {
  return {
    id: 'photo-1',
    encryptedBlob: new Blob(['encrypted']),
    encryptionIv: new Uint8Array(12),
    filename: 'photo.jpg',
    mimeType: 'image/jpeg',
    fileSizeBytes: 1000,
    width: 640,
    height: 480,
    parentLocalId: 'report-1',
    parentServerReportId: 42,
    deviceId: DEVICE_ID,
    browserGps: null,
    exifGps: null,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    lastAttemptAt: null,
    permanentFailure: false,
    ...overrides,
  };
}

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockGetPendingPhotosForSync = vi.fn<() => Promise<OfflinePhotoRecord[]>>();
const mockMarkPhotoUploaded = vi.fn();
const mockMarkPhotoPermanentFailure = vi.fn();
const mockMarkPhotoRetry = vi.fn();
const mockDecryptPhotoBlob = vi.fn();
const mockGetOrCreatePhotoKey = vi.fn();
const mockUploadCivilianReportPhoto = vi.fn();

vi.mock('../offlineStore', () => ({
  getPendingPhotosForSync: (...args: unknown[]) => mockGetPendingPhotosForSync(...args as [string]),
  markPhotoUploaded: (...args: unknown[]) => mockMarkPhotoUploaded(...args as [string]),
  markPhotoPermanentFailure: (...args: unknown[]) => mockMarkPhotoPermanentFailure(...args as [string]),
  markPhotoRetry: (...args: unknown[]) => mockMarkPhotoRetry(...args as [string]),
}));

vi.mock('../offlinePhotoKey', () => ({
  decryptPhotoBlob: (...args: unknown[]) => mockDecryptPhotoBlob(...args as [Blob, Uint8Array, string, string, CryptoKey]),
  getOrCreatePhotoKey: (...args: unknown[]) => mockGetOrCreatePhotoKey(...args as [string]),
}));

vi.mock('../api/civilian', () => ({
  uploadCivilianReportPhoto: (...args: unknown[]) => mockUploadCivilianReportPhoto(...args as [number, File, string, unknown, unknown, string]),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('syncPendingPhotos', () => {
  it('returns zeros when no photos are pending', async () => {
    mockGetPendingPhotosForSync.mockResolvedValue([]);
    const { syncPendingPhotos } = await import('../civilianPhotoSync');
    const result = await syncPendingPhotos(DEVICE_ID);
    expect(result).toEqual({ synced: 0, duplicated: 0, failed: 0, keyLost: 0 });
    expect(mockGetOrCreatePhotoKey).not.toHaveBeenCalled();
  });

  it('marks all photos as permanent failure when key store is unavailable', async () => {
    mockGetPendingPhotosForSync.mockResolvedValue([makePhoto(), makePhoto({ id: 'photo-2' })]);
    mockGetOrCreatePhotoKey.mockRejectedValue(new Error('IndexedDB unavailable'));
    const { syncPendingPhotos } = await import('../civilianPhotoSync');
    const result = await syncPendingPhotos(DEVICE_ID);
    expect(result.keyLost).toBe(2);
    expect(result.synced).toBe(0);
    expect(mockMarkPhotoPermanentFailure).toHaveBeenCalledTimes(2);
  });

  it('skips photos with null parentServerReportId', async () => {
    mockGetPendingPhotosForSync.mockResolvedValue([
      makePhoto({ id: 'photo-1', parentServerReportId: null }),
      makePhoto({ id: 'photo-2', parentServerReportId: 99 }),
    ]);
    mockGetOrCreatePhotoKey.mockResolvedValue({} as CryptoKey);
    mockDecryptPhotoBlob.mockResolvedValue(new ArrayBuffer(100));
    mockUploadCivilianReportPhoto.mockResolvedValue({ report_id: 99, photo_id: 'p99', mime_type: 'image/jpeg' });

    const { syncPendingPhotos } = await import('../civilianPhotoSync');
    const result = await syncPendingPhotos(DEVICE_ID);

    // photo-1 (null parentServerReportId) skipped, photo-2 synced
    expect(result.synced).toBe(1);
    expect(mockUploadCivilianReportPhoto).toHaveBeenCalledTimes(1);
    expect(mockUploadCivilianReportPhoto).toHaveBeenCalledWith(
      99, expect.any(File), DEVICE_ID, undefined, undefined, 'photo-2'
    );
  });

  it('skips permanent failure photos', async () => {
    mockGetPendingPhotosForSync.mockResolvedValue([
      makePhoto({ permanentFailure: true }),
      makePhoto({ id: 'photo-2' }),
    ]);
    mockGetOrCreatePhotoKey.mockResolvedValue({} as CryptoKey);
    mockDecryptPhotoBlob.mockResolvedValue(new ArrayBuffer(100));
    mockUploadCivilianReportPhoto.mockResolvedValue({ report_id: 99, photo_id: 'p99', mime_type: 'image/jpeg' });

    const { syncPendingPhotos } = await import('../civilianPhotoSync');
    const result = await syncPendingPhotos(DEVICE_ID);
    expect(result.synced).toBe(1);
    expect(mockMarkPhotoPermanentFailure).not.toHaveBeenCalled();
  });

  it('marks retry >= 5 as permanent failure', async () => {
    mockGetPendingPhotosForSync.mockResolvedValue([makePhoto({ retryCount: 5 })]);
    mockGetOrCreatePhotoKey.mockResolvedValue({} as CryptoKey);

    const { syncPendingPhotos } = await import('../civilianPhotoSync');
    const result = await syncPendingPhotos(DEVICE_ID);
    expect(result.failed).toBe(1);
    expect(mockMarkPhotoPermanentFailure).toHaveBeenCalledWith('photo-1');
  });

  it('skips photos within backoff window', async () => {
    mockGetPendingPhotosForSync.mockResolvedValue([makePhoto({
      retryCount: 1,
      lastAttemptAt: Date.now(), // just now — within backoff
    })]);
    mockGetOrCreatePhotoKey.mockResolvedValue({} as CryptoKey);

    const { syncPendingPhotos } = await import('../civilianPhotoSync');
    const result = await syncPendingPhotos(DEVICE_ID);
    expect(result.synced).toBe(0);
    expect(mockUploadCivilianReportPhoto).not.toHaveBeenCalled();
  });

  it('handles decryption failure (null) as key loss', async () => {
    mockGetPendingPhotosForSync.mockResolvedValue([makePhoto()]);
    mockGetOrCreatePhotoKey.mockResolvedValue({} as CryptoKey);
    mockDecryptPhotoBlob.mockResolvedValue(null);

    const { syncPendingPhotos } = await import('../civilianPhotoSync');
    const result = await syncPendingPhotos(DEVICE_ID);
    expect(result.keyLost).toBe(1);
    expect(mockMarkPhotoPermanentFailure).toHaveBeenCalledWith('photo-1');
  });

  it('happy path: decrypt → upload → mark uploaded → synced', async () => {
    mockGetPendingPhotosForSync.mockResolvedValue([makePhoto()]);
    mockGetOrCreatePhotoKey.mockResolvedValue({} as CryptoKey);
    mockDecryptPhotoBlob.mockResolvedValue(new ArrayBuffer(100));
    mockUploadCivilianReportPhoto.mockResolvedValue({ report_id: 99, photo_id: 'p99', mime_type: 'image/jpeg' });

    const { syncPendingPhotos } = await import('../civilianPhotoSync');
    const result = await syncPendingPhotos(DEVICE_ID);
    expect(result.synced).toBe(1);
    expect(mockMarkPhotoUploaded).toHaveBeenCalledWith('photo-1');
  });

  it('duplicate response increments duplicated count', async () => {
    mockGetPendingPhotosForSync.mockResolvedValue([makePhoto()]);
    mockGetOrCreatePhotoKey.mockResolvedValue({} as CryptoKey);
    mockDecryptPhotoBlob.mockResolvedValue(new ArrayBuffer(100));
    mockUploadCivilianReportPhoto.mockResolvedValue({ photo_id: null, report_id: 99, duplicate: true });

    const { syncPendingPhotos } = await import('../civilianPhotoSync');
    const result = await syncPendingPhotos(DEVICE_ID);
    expect(result.duplicated).toBe(1);
    expect(mockMarkPhotoUploaded).toHaveBeenCalledWith('photo-1');
  });

  it('network error (status undefined) calls markPhotoRetry', async () => {
    mockGetPendingPhotosForSync.mockResolvedValue([makePhoto()]);
    mockGetOrCreatePhotoKey.mockResolvedValue({} as CryptoKey);
    mockDecryptPhotoBlob.mockResolvedValue(new ArrayBuffer(100));
    const networkError = new TypeError('Failed to fetch');
    mockUploadCivilianReportPhoto.mockRejectedValue(networkError);

    const { syncPendingPhotos } = await import('../civilianPhotoSync');
    const result = await syncPendingPhotos(DEVICE_ID);
    expect(result.failed).toBe(1);
    expect(mockMarkPhotoRetry).toHaveBeenCalledWith('photo-1');
  });

  it('retryable 4xx (408) calls markPhotoRetry', async () => {
    mockGetPendingPhotosForSync.mockResolvedValue([makePhoto()]);
    mockGetOrCreatePhotoKey.mockResolvedValue({} as CryptoKey);
    mockDecryptPhotoBlob.mockResolvedValue(new ArrayBuffer(100));
    const err = new Error('Timeout') as Error & { status?: number };
    err.status = 408;
    mockUploadCivilianReportPhoto.mockRejectedValue(err);

    const { syncPendingPhotos } = await import('../civilianPhotoSync');
    const result = await syncPendingPhotos(DEVICE_ID);
    expect(result.failed).toBe(1);
    expect(mockMarkPhotoRetry).toHaveBeenCalledWith('photo-1');
  });

  it('retryable 4xx (429) calls markPhotoRetry', async () => {
    mockGetPendingPhotosForSync.mockResolvedValue([makePhoto()]);
    mockGetOrCreatePhotoKey.mockResolvedValue({} as CryptoKey);
    mockDecryptPhotoBlob.mockResolvedValue(new ArrayBuffer(100));
    const err = new Error('Too Many Requests') as Error & { status?: number };
    err.status = 429;
    mockUploadCivilianReportPhoto.mockRejectedValue(err);

    const { syncPendingPhotos } = await import('../civilianPhotoSync');
    const result = await syncPendingPhotos(DEVICE_ID);
    expect(result.failed).toBe(1);
    expect(mockMarkPhotoRetry).toHaveBeenCalledWith('photo-1');
  });

  it('permanent 4xx (422) calls markPhotoPermanentFailure', async () => {
    mockGetPendingPhotosForSync.mockResolvedValue([makePhoto()]);
    mockGetOrCreatePhotoKey.mockResolvedValue({} as CryptoKey);
    mockDecryptPhotoBlob.mockResolvedValue(new ArrayBuffer(100));
    const err = new Error('Validation error') as Error & { status?: number };
    err.status = 422;
    mockUploadCivilianReportPhoto.mockRejectedValue(err);

    const { syncPendingPhotos } = await import('../civilianPhotoSync');
    const result = await syncPendingPhotos(DEVICE_ID);
    expect(result.failed).toBe(1);
    expect(mockMarkPhotoPermanentFailure).toHaveBeenCalledWith('photo-1');
  });

  it('5xx error calls markPhotoRetry', async () => {
    mockGetPendingPhotosForSync.mockResolvedValue([makePhoto()]);
    mockGetOrCreatePhotoKey.mockResolvedValue({} as CryptoKey);
    mockDecryptPhotoBlob.mockResolvedValue(new ArrayBuffer(100));
    const err = new Error('Server error') as Error & { status?: number };
    err.status = 502;
    mockUploadCivilianReportPhoto.mockRejectedValue(err);

    const { syncPendingPhotos } = await import('../civilianPhotoSync');
    const result = await syncPendingPhotos(DEVICE_ID);
    expect(result.failed).toBe(1);
    expect(mockMarkPhotoRetry).toHaveBeenCalledWith('photo-1');
  });
});
