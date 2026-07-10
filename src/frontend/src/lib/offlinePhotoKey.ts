/**
 * offlinePhotoKey — AES-256-GCM key management for offline photo encryption.
 *
 * A non-extractable CryptoKey is generated per device and stored via
 * IndexedDB structured clone (supports CryptoKey natively). No
 * exportKey/importKey needed — the CryptoKey object is cloneable.
 *
 * On key loss (store cleared): existing encrypted photos become
 * undecryptable. decryptPhotoBlob catches OperationError and returns
 * null; callers mark permanentFailure.
 *
 * AAD format: photo:{photoId}:{deviceId} (bound to both the photo ID
 * and the device identity).
 */

const KEY_STORE_NAME = 'crypto-keys';

function getKeyStorageName(deviceId: string): string {
  return `photo-key:${deviceId}`;
}

/**
 * Get or create the AES-256-GCM key for the given device.
 * The key is non-extractable and stored via structured clone in KEY_STORE.
 */
export async function getOrCreatePhotoKey(deviceId: string): Promise<CryptoKey> {
  // Dynamic import to avoid circular deps — offlineStore opens the DB
  const { openDB } = await import('idb');
  const db = await openDB('wims-bfp-db', 7, {
    upgrade() { /* upgrade handled by offlineStore */ },
  });

  const keyName = getKeyStorageName(deviceId);
  const existing = await db.get(KEY_STORE_NAME, keyName);
  if (existing) {
    db.close();
    return existing as CryptoKey;
  }

  // Generate new non-extractable AES-256-GCM key
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt'],
  );

  await db.put(KEY_STORE_NAME, key, keyName);
  db.close();
  return key;
}

/**
 * Encrypt a Blob using AES-256-GCM with AAD binding.
 *
 * @param blob - The raw JPEG/PNG blob to encrypt.
 * @param deviceId - Device identity for key lookup and AAD.
 * @param photoId - UUID of the photo record (used in AAD).
 * @param key - Optional pre-fetched key to avoid repeated DB reads.
 * @returns Encrypted ArrayBuffer and base64 IV.
 */
export async function encryptPhotoBlob(
  blob: Blob,
  deviceId: string,
  photoId: string,
  key?: CryptoKey,
): Promise<{ encrypted: ArrayBuffer; iv: string }> {
  const encryptionKey = key ?? (await getOrCreatePhotoKey(deviceId));

  // Generate random 12-byte IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encode AAD: photo:{photoId}:{deviceId}
  const aad = new TextEncoder().encode(`photo:${photoId}:${deviceId}`);

  // Encrypt
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    encryptionKey,
    await blob.arrayBuffer(),
  );

  // Base64 encode IV for storage
  const ivBase64 = btoa(String.fromCharCode(...new Uint8Array(iv)));

  return { encrypted, iv: ivBase64 };
}

/**
 * Decrypt a Blob using AES-256-GCM with AAD binding.
 *
 * @param encrypted - The encrypted ArrayBuffer from OFFLINE_PHOTOS_STORE.
 * @param iv - Base64-encoded IV (12 bytes).
 * @param deviceId - Device identity for key lookup and AAD.
 * @param photoId - UUID of the photo record (used in AAD).
 * @param key - Optional pre-fetched key to avoid repeated DB reads.
 * @returns Decrypted Blob, or null if decryption fails (key lost / tampered).
 */
export async function decryptPhotoBlob(
  encrypted: ArrayBuffer,
  iv: string,
  deviceId: string,
  photoId: string,
  key?: CryptoKey,
): Promise<Blob | null> {
  try {
    const encryptionKey = key ?? (await getOrCreatePhotoKey(deviceId));

    // Decode IV from base64
    const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));

    // Encode AAD: photo:{photoId}:{deviceId}
    const aad = new TextEncoder().encode(`photo:${photoId}:${deviceId}`);

    // Decrypt
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes, additionalData: aad },
      encryptionKey,
      encrypted,
    );

    return new Blob([plaintext], { type: 'image/jpeg' });
  } catch (err) {
    // OperationError = wrong key, wrong IV, tampered ciphertext, or wrong AAD
    // Also catches key not found, store cleared, etc.
    // Check both instanceof DOMException (browser) and err.name (node/webcrypto)
    const isOperationError =
      (err instanceof DOMException && err.name === 'OperationError') ||
      (err && typeof err === 'object' && 'name' in err && (err as Error).name === 'OperationError');
    if (isOperationError) {
      return null;
    }
    // Re-throw unexpected errors
    throw err;
  }
}
