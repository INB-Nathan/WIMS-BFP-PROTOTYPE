import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'wims-bfp-db';
const DB_VERSION = 3;
const STORE_NAME = 'incident-queue';
const KEY_STORE = 'crypto-keys';
const ANALYTICS_STORE = 'analytics-cache';

// Advisory offline storage cap (MB). Default 50; overridden via initOfflineStorageLimit().
// This is client-side enforcement only — no server eviction occurs.
let _offlineStorageLimitMb = 50;

export type OfflineOpType = 'create' | 'verify' | 'archive_action';

export interface VerifyPayload {
    incident_id: number;
    action: string;
    notes?: string | null;
}

export interface ArchiveActionPayload {
    incident_id: number;
    action: 'archive' | 'unarchive';
}

interface PendingIncident {
    id: number;
    opType?: OfflineOpType;
    localId?: string;
    payload: Record<string, unknown>;
    createdAt: number;
    status: 'pending' | 'synced';
}

interface EncryptedPayload {
    iv: number[];
    data: number[];
}

interface CachedAnalyticsRecord {
    key: string;
    encrypted: EncryptedPayload;
    cachedAt: number;
}

export interface CachedAnalyticsResponse<T = unknown> {
    key: string;
    data: T;
    cachedAt: number;
}

interface QueuedRecord {
    id?: number;
    encrypted: EncryptedPayload;
    createdAt: number;
    status: 'pending' | 'synced';
}

async function getDB(): Promise<IDBPDatabase> {
    return openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion) {
            if (oldVersion < 2) {
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains(KEY_STORE)) {
                    db.createObjectStore(KEY_STORE);
                }
            }
            if (oldVersion < 3) {
                if (!db.objectStoreNames.contains(ANALYTICS_STORE)) {
                    const analyticsStore = db.createObjectStore(ANALYTICS_STORE, { keyPath: 'key' });
                    analyticsStore.createIndex('by_cachedAt', 'cachedAt');
                }
            }
        },
    });
}

async function getOrCreateKey(): Promise<CryptoKey> {
    const db = await getDB();
    const existing = await db.get(KEY_STORE, 'aes-gcm-key');
    if (existing) return existing as CryptoKey;
    const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
    await db.put(KEY_STORE, key, 'aes-gcm-key');
    return key;
}

async function encryptPayload(payload: unknown): Promise<EncryptedPayload> {
    const key = await getOrCreateKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return { iv: Array.from(iv), data: Array.from(new Uint8Array(ciphertext)) };
}

async function decryptPayload<T = unknown>(enc: EncryptedPayload): Promise<T> {
    const key = await getOrCreateKey();
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(enc.iv) },
        key,
        new Uint8Array(enc.data)
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

/** Override the advisory offline storage cap at app init time. */
export function initOfflineStorageLimit(limitMb: number): void {
    _offlineStorageLimitMb = limitMb;
}

export async function queueIncident(payload: Record<string, unknown>): Promise<void> {
    const db = await getDB();

    // Advisory size guard: estimate total queue bytes and warn/throw if over cap.
    const all: QueuedRecord[] = await db.getAll(STORE_NAME);
    const totalBytes = all.reduce((sum, item) => sum + (item.encrypted?.data?.length ?? 0), 0);
    const limitBytes = _offlineStorageLimitMb * 1024 * 1024;
    if (totalBytes >= limitBytes) {
        const usedMb = (totalBytes / 1024 / 1024).toFixed(1);
        console.warn(
            `[offlineStore] Queue ~${usedMb}MB exceeds advisory cap of ${_offlineStorageLimitMb}MB. Skipping.`
        );
        throw new Error(
            `Offline storage cap reached (${_offlineStorageLimitMb}MB). ` +
            `Connect to the network to sync, or contact your administrator.`
        );
    }

    const encrypted = await encryptPayload(payload);
    await db.add(STORE_NAME, {
        encrypted,
        createdAt: Date.now(),
        status: 'pending',
    });
}

export async function getPendingIncidents(): Promise<PendingIncident[]> {
    const db = await getDB();
    const all = await db.getAll(STORE_NAME);
    const pending = all.filter((item: QueuedRecord) => item.status === 'pending');
    const result: PendingIncident[] = [];
    for (const item of pending) {
        const payload = await decryptPayload<Record<string, unknown>>(item.encrypted);
        result.push({
            id: item.id!,
            payload,
            createdAt: item.createdAt,
            status: item.status,
        });
    }
    return result;
}

export async function getQueuedIncident(id: number): Promise<PendingIncident | undefined> {
    const db = await getDB();
    const item: QueuedRecord | undefined = await db.get(STORE_NAME, id);
    if (!item) return undefined;
    const payload = await decryptPayload<Record<string, unknown>>(item.encrypted);
    return {
        id: item.id!,
        payload,
        createdAt: item.createdAt,
        status: item.status,
    };
}

export async function updateQueuedIncident(id: number, payload: Record<string, unknown>) {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const item: QueuedRecord | undefined = await store.get(id);
    if (!item) {
        await tx.done;
        throw new Error(`Queued incident ${id} not found`);
    }
    if (item.status === 'synced') {
        await tx.done;
        throw new Error('Cannot edit an already-synced incident');
    }
    item.encrypted = await encryptPayload(payload);
    await store.put(item);
    await tx.done;
}

// NOTE: operates on the raw stored record (has `encrypted`, not `payload`);
    // only touches `status`, never reads payload, so no decryption needed.
export async function markSynced(id: number) {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const item = await store.get(id);
    if (item) {
        item.status = 'synced';
        await store.put(item);
        await store.delete(id);
    }
    await tx.done;
}

export async function deleteQueuedIncident(id: number) {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await store.delete(id);
    await tx.done;
}

export async function clearSynced() {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    let cursor = await store.openCursor();
    while (cursor) {
        if (cursor.value.status === 'synced') {
            await cursor.delete();
        }
        cursor = await cursor.continue();
    }
    await tx.done;
}

export async function cacheAnalyticsResponse<T = unknown>(
    key: string,
    data: T,
    cachedAt = Date.now()
): Promise<void> {
    const db = await getDB();
    const encrypted = await encryptPayload(data);
    const record: CachedAnalyticsRecord = {
        key,
        encrypted,
        cachedAt,
    };
    await db.put(ANALYTICS_STORE, record);
}

export async function getCachedAnalyticsResponse<T = unknown>(
    key: string
): Promise<CachedAnalyticsResponse<T> | undefined> {
    const db = await getDB();
    const item: CachedAnalyticsRecord | undefined = await db.get(ANALYTICS_STORE, key);
    if (!item) return undefined;
    const data = await decryptPayload<T>(item.encrypted);
    return {
        key: item.key,
        data,
        cachedAt: item.cachedAt,
    };
}

export async function clearAnalyticsCache(): Promise<void> {
    const db = await getDB();
    await db.clear(ANALYTICS_STORE);
}
