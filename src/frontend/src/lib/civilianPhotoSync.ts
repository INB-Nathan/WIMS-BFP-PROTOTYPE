/**
 * civilianPhotoSync — Sync pending offline photos when connectivity is restored.
 *
 * Reads encrypted photos from OFFLINE_PHOTOS_STORE, decrypts using the
 * device-bound AES-256-GCM key, uploads to the server with client_photo_id
 * for idempotency, and deletes on success.
 *
 * Backoff: exponential with jitter, capped at 30s, max 5 retries.
 * Key loss: decryption failure (OperationError) → mark permanentFailure.
 */

import {
  getPendingPhotosForSync,
  markPhotoUploaded,
  markPhotoPermanentFailure,
} from './offlineStore';
import { decryptPhotoBlob } from './offlinePhotoKey';
import { uploadCivilianReportPhoto } from './api/civilian';

export interface PhotoSyncResult {
  synced: number;
  duplicated: number;
  failed: number;
  keyLost: number;
}

/**
 * Backoff delay with jitter for retryable failures.
 */
function computeBackoffDelay(retryCount: number): number {
  const base = Math.min(Math.pow(2, retryCount) * 1000, 30000);
  const jitter = (Math.random() * 0.5 - 0.25) * base; // ±25%
  return Math.max(0, base + jitter);
}

/**
 * Sync all pending photos for a device.
 *
 * @param deviceId - Browser-bound device identity.
 * @returns PhotoSyncResult with counts of synced, duplicated, failed, and key-lost photos.
 */
export async function syncPendingPhotos(deviceId: string): Promise<PhotoSyncResult> {
  const result: PhotoSyncResult = { synced: 0, duplicated: 0, failed: 0, keyLost: 0 };

  const photos = await getPendingPhotosForSync(deviceId);
  if (photos.length === 0) return result;

  // Pre-fetch the encryption key once to avoid repeated KEY_STORE reads
  let encryptionKey: CryptoKey | undefined;
  try {
    const { getOrCreatePhotoKey } = await import('./offlinePhotoKey');
    encryptionKey = await getOrCreatePhotoKey(deviceId);
  } catch {
    // Key store unavailable — all photos become permanent failures
    for (const photo of photos) {
      await markPhotoPermanentFailure(photo.id);
      result.keyLost++;
    }
    return result;
  }

  for (const photo of photos) {
    if (photo.permanentFailure) continue;

    if (photo.retryCount >= 5) {
      await markPhotoPermanentFailure(photo.id);
      result.failed++;
      continue;
    }

    // Apply backoff if retrying
    if (photo.retryCount > 0 && photo.lastAttemptAt !== null) {
      const delay = computeBackoffDelay(photo.retryCount - 1);
      if (Date.now() - photo.lastAttemptAt < delay) {
        continue; // Still within backoff window — skip for now
      }
    }

    try {
      // Decrypt using shared key
      const decrypted = await decryptPhotoBlob(
        photo.encryptedBlob,
        photo.encryptionIv,
        deviceId,
        photo.id,
        encryptionKey,
      );

      if (decrypted === null) {
        // Key lost, tampered ciphertext, or wrong AAD — permanent failure
        await markPhotoPermanentFailure(photo.id);
        result.keyLost++;
        continue;
      }

      // Create File from decrypted blob
      const file = new File([decrypted], photo.filename, { type: photo.mimeType });

      // Upload with client_photo_id for server-side idempotency.
      // Also pass browser GPS and EXIF GPS data that was captured before compression.
      const response = await uploadCivilianReportPhoto(
        photo.parentServerReportId!,
        file,
        deviceId,
        photo.browserGps ?? undefined,
        photo.exifGps ?? undefined,
        photo.id, // clientPhotoId — server deduplicates on this
      );

      await markPhotoUploaded(photo.id);
      if ((response as unknown as { duplicate?: boolean }).duplicate) {
        result.duplicated++;
      } else {
        result.synced++;
      }
    } catch (err: unknown) {
      const status =
        err && typeof err === 'object' && 'status' in err
          ? (err as { status?: number }).status
          : undefined;

      // Network error (fetch failed, timeout) — retryable
      if (status === undefined || status === 0) {
        result.failed++;
        continue;
      }

      // 4xx errors: some are retryable, most are permanent
      if (status >= 400 && status < 500) {
        if (status === 408 || status === 425 || status === 429) {
          // Retryable 4xx
          result.failed++;
          continue;
        }
        // 404, 422, 400, 403, etc. — permanent failure
        await markPhotoPermanentFailure(photo.id);
        result.failed++;
        continue;
      }

      // 5xx — retryable
      result.failed++;
    }
  }

  return result;
}
