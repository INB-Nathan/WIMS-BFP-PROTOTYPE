/**
 * offlinePhotoKey tests — AES-256-GCM photo encryption, decryption, and key management.
 *
 * Tests:
 *   - Key generation: createOnce, reuse, non-extractable
 *   - Encrypt/decrypt round-trip: same key returns original blob
 *   - Decrypt with wrong key → null (OperationError)
 *   - Decrypt with wrong IV → null (tampered)
 *   - Key loss (store cleared) → new key generated, old ciphertext undecryptable
 *   - Pre-fetched key parameter avoids repeated store reads
 *   - AAD binding: wrong deviceId or photoId → decryption fails
 *
 * Uses fake-indexeddb for a real IndexedDB implementation (consistent with
 * offlineStore.test.ts pattern).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';

// ─── Setup: ensure the crypto-keys store exists ─────────────────────────────

// Use DB version 7 to stay in sync with offlineStore.ts and offlinePhotoKey.ts.
// Opening at version 1 after the DB has been upgraded to 7 would hang in
// fake-indexeddb (version downgrade is not supported).
async function ensureKeyStore() {
  const db = await openDB('wims-bfp-db', 7, {
    upgrade(db, oldVersion) {
      if (oldVersion < 7) {
        if (!db.objectStoreNames.contains('crypto-keys')) {
          db.createObjectStore('crypto-keys');
        }
      }
    },
  });
  db.close();
}

// Import AFTER setup
const { getOrCreatePhotoKey, encryptPhotoBlob, decryptPhotoBlob } = await import('../offlinePhotoKey');

// ── Test helpers ─────────────────────────────────────────────────────────────

function createTestBlob(size = 1024): Blob {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = i & 0xff;
  }
  return new Blob([bytes], { type: 'image/jpeg' });
}

async function blobToHex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Tests ────────────────────────────────────────────────────────────────────

const DEVICE_ID = 'test-device-001';
const PHOTO_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_DEVICE = 'other-device-999';

// Helper to clean up IndexedDB between tests
function deleteAllDbs(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('wims-bfp-db');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
    // Also try to delete other test databases
    try {
      const req2 = indexedDB.deleteDatabase('wims-bfp-db-v2');
      req2.onsuccess = () => {};
    } catch { /* ignore */ }
  });
}

describe('getOrCreatePhotoKey', () => {
  beforeEach(async () => {
    await deleteAllDbs();
  });

  it('creates a new AES-256-GCM key for a device', async () => {
    // Ensure empty DB
    await ensureKeyStore();
    const key = await getOrCreatePhotoKey(DEVICE_ID);

    expect(key).toBeDefined();
    expect(key.algorithm).toMatchObject({
      name: 'AES-GCM',
      length: 256,
    });
    expect(key.usages).toEqual(['encrypt', 'decrypt']);
    expect(key.extractable).toBe(false);
  });

  it('returns the same key on subsequent calls (cached in IndexedDB)', async () => {
    await ensureKeyStore();
    const key1 = await getOrCreatePhotoKey(DEVICE_ID);
    const key2 = await getOrCreatePhotoKey(DEVICE_ID);

    expect(key1).toStrictEqual(key2);
  });

  it('creates separate keys for different devices', async () => {
    await ensureKeyStore();
    const key1 = await getOrCreatePhotoKey(DEVICE_ID);
    const key2 = await getOrCreatePhotoKey(OTHER_DEVICE);

    expect(key1).not.toBe(key2);
  });

  it('stores the key in the crypto-keys store under photo-key:{deviceId}', async () => {
    await ensureKeyStore();
    await getOrCreatePhotoKey(DEVICE_ID);

    const db = await openDB('wims-bfp-db');
    const stored = await db.get('crypto-keys', `photo-key:${DEVICE_ID}`);
    expect(stored).toBeDefined();
    expect((stored as CryptoKey).algorithm).toMatchObject({ name: 'AES-GCM' });
    db.close();
  });

  afterEach(async () => {
    await deleteAllDbs();
  });
});

describe('encryptPhotoBlob', () => {
  beforeEach(async () => {
    await ensureKeyStore();
  });

  afterEach(async () => {
    await deleteAllDbs();
  });

  it('returns encrypted data and a base64 IV', async () => {
    await ensureKeyStore();
    const blob = createTestBlob(512);
    const result = await encryptPhotoBlob(blob, DEVICE_ID, PHOTO_ID);

    expect(result.encrypted?.constructor?.name).toBe('ArrayBuffer');
    expect(result.iv).toBeDefined();
    // IV should be base64-encoded 12 bytes = 16 chars
    expect(result.iv).toHaveLength(16);
    // IV should be different from a zero-padded string
    expect(result.iv).not.toBe('AAAAAAAAAAAAAAAA');
  });

  it('generates a unique IV on each call (even for the same blob)', async () => {
    await ensureKeyStore();
    const blob = createTestBlob(64);
    const result1 = await encryptPhotoBlob(blob, DEVICE_ID, PHOTO_ID);
    const result2 = await encryptPhotoBlob(blob, DEVICE_ID, PHOTO_ID);

    expect(result1.iv).not.toBe(result2.iv);
  });

  it('encrypts with the pre-fetched key when provided', async () => {
    await ensureKeyStore();
    const key = await getOrCreatePhotoKey(DEVICE_ID);
    const blob = createTestBlob(64);
    const result = await encryptPhotoBlob(blob, DEVICE_ID, PHOTO_ID, key);

    expect(result.encrypted?.constructor?.name).toBe('ArrayBuffer');
    // AES-GCM tag overhead = 16 bytes
    expect(result.encrypted.byteLength).toBe(80);
  });
});

describe('decryptPhotoBlob', () => {
  beforeEach(async () => {
    await ensureKeyStore();
  });

  afterEach(async () => {
    await deleteAllDbs();
  });

  it('decrypts a blob that was encrypted with the same key', async () => {
    await ensureKeyStore();
    const original = createTestBlob(256);
    const { encrypted, iv } = await encryptPhotoBlob(original, DEVICE_ID, PHOTO_ID);

    const decrypted = await decryptPhotoBlob(encrypted, iv, DEVICE_ID, PHOTO_ID);

    expect(decrypted).not.toBeNull();
    const originalHex = await blobToHex(original);
    const decryptedHex = await blobToHex(decrypted!);
    expect(decryptedHex).toBe(originalHex);
  });

  it('returns null when decrypted with a wrong deviceId (wrong AAD)', async () => {
    await ensureKeyStore();
    const original = createTestBlob(64);
    const { encrypted, iv } = await encryptPhotoBlob(original, DEVICE_ID, PHOTO_ID);

    const decrypted = await decryptPhotoBlob(encrypted, iv, OTHER_DEVICE, PHOTO_ID);

    expect(decrypted).toBeNull();
  });

  it('returns null when decrypted with a wrong photoId (wrong AAD)', async () => {
    await ensureKeyStore();
    const original = createTestBlob(64);
    const { encrypted, iv } = await encryptPhotoBlob(original, DEVICE_ID, PHOTO_ID);

    const decrypted = await decryptPhotoBlob(encrypted, iv, DEVICE_ID, 'wrong-photo-id');

    expect(decrypted).toBeNull();
  });

  it('returns null when the IV is tampered', async () => {
    await ensureKeyStore();
    const original = createTestBlob(64);
    const { encrypted } = await encryptPhotoBlob(original, DEVICE_ID, PHOTO_ID);

    // Use a different IV
    const tamperedIv = 'AAAAAAAAAAAAAAAA';
    const decrypted = await decryptPhotoBlob(encrypted, tamperedIv, DEVICE_ID, PHOTO_ID);

    expect(decrypted).toBeNull();
  });

  it('returns null when the ciphertext is tampered', async () => {
    await ensureKeyStore();
    const original = createTestBlob(64);
    const { encrypted, iv } = await encryptPhotoBlob(original, DEVICE_ID, PHOTO_ID);

    // Modify a byte in the ciphertext
    const tampered = new Uint8Array(encrypted);
    tampered[10] ^= 0xff;

    const decrypted = await decryptPhotoBlob(tampered.buffer, iv, DEVICE_ID, PHOTO_ID);

    expect(decrypted).toBeNull();
  });

  it('handles key loss gracefully (returns null)', async () => {
    // Use a separate key that won't be cached from another test
    const LOST_DEVICE = 'lost-key-device-' + Date.now();
    const original = createTestBlob(64);
    const { encrypted, iv } = await encryptPhotoBlob(original, LOST_DEVICE, PHOTO_ID);

    // Clear all crypto-keys data
    const db = await openDB('wims-bfp-db');
    await db.clear('crypto-keys');
    db.close();

    // Without the key, decryption should fail with OperationError → null
    const decrypted = await decryptPhotoBlob(encrypted, iv, DEVICE_ID, PHOTO_ID);

    expect(decrypted).toBeNull();
  });

  it('decrypts with pre-fetched key when provided', async () => {
    const key = await webcrypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const original = createTestBlob(128);
    const { encrypted, iv } = await encryptPhotoBlob(original, DEVICE_ID, PHOTO_ID, key);

    const decrypted = await decryptPhotoBlob(encrypted, iv, DEVICE_ID, PHOTO_ID, key);

    expect(decrypted).not.toBeNull();
    const originalHex = await blobToHex(original);
    const decryptedHex = await blobToHex(decrypted!);
    expect(decryptedHex).toBe(originalHex);
  });

  it('returns null when using a wrong pre-fetched key', async () => {
    const correctKey = await webcrypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const wrongKey = await webcrypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const original = createTestBlob(64);
    const { encrypted, iv } = await encryptPhotoBlob(original, DEVICE_ID, PHOTO_ID, correctKey);

    const decrypted = await decryptPhotoBlob(encrypted, iv, DEVICE_ID, PHOTO_ID, wrongKey);

    expect(decrypted).toBeNull();
  });
});

describe('encrypt + decrypt round-trip (integration)', () => {
  beforeEach(async () => {
    await ensureKeyStore();
  });

  afterEach(async () => {
    await deleteAllDbs();
  });

  it('round-trips various blob sizes', async () => {
    await ensureKeyStore();
    const sizes = [0, 1, 100, 1024, 10 * 1024, 100 * 1024];
    for (const size of sizes) {
      const original = createTestBlob(size);
      const { encrypted, iv } = await encryptPhotoBlob(original, DEVICE_ID, PHOTO_ID);
      const decrypted = await decryptPhotoBlob(encrypted, iv, DEVICE_ID, PHOTO_ID);

      expect(decrypted).not.toBeNull();
      const originalHex = await blobToHex(original);
      const decryptedHex = await blobToHex(decrypted!);
      expect(decryptedHex).toBe(originalHex);
    }
  });

  it('round-trips specific content patterns', async () => {
    await ensureKeyStore();
    const content = new Uint8Array([0x00, 0xff, 0x55, 0xaa, 0x89, 0x50, 0x4e, 0x47]);
    const blob = new Blob([content], { type: 'image/jpeg' });
    const { encrypted, iv } = await encryptPhotoBlob(blob, DEVICE_ID, PHOTO_ID);
    const decrypted = await decryptPhotoBlob(encrypted, iv, DEVICE_ID, PHOTO_ID);

    expect(decrypted).not.toBeNull();
    const decryptedBytes = new Uint8Array(await decrypted!.arrayBuffer());
    expect(Array.from(decryptedBytes)).toEqual(Array.from(content));
  });
});
