import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'wims-bfp-db';
const DB_VERSION = 2;
const STORE_NAME = 'incident-queue';
const KEY_STORE = 'crypto-keys';

interface PendingIncident {
    id?: number;
    payload: Record<string, unknown>;
    createdAt: number;
    status: 'pending' | 'synced';
}

interface EncryptedPayload {
    iv: number[];
    data: number[];
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

async function encryptPayload(payload: Record<string, unknown>): Promise<EncryptedPayload> {
    const key = await getOrCreateKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return { iv: Array.from(iv), data: Array.from(new Uint8Array(ciphertext)) };
}

async function decryptPayload(enc: EncryptedPayload): Promise<Record<string, unknown>> {
    const key = await getOrCreateKey();
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(enc.iv) },
        key,
        new Uint8Array(enc.data)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
}

export async function queueIncident(payload: Record<string, unknown>) {
    const db = await getDB();
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
        const payload = await decryptPayload(item.encrypted);
        result.push({
            id: item.id,
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
    const payload = await decryptPayload(item.encrypted);
    return {
        id: item.id,
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
    if (item) {
        item.encrypted = await encryptPayload(payload);
        await store.put(item);
    }
    await tx.done;
}

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

export async function getQueuedIncident(id: number) {
    const db = await getDB();
    return db.get(STORE_NAME, id);
}

export async function updateQueuedIncident(
    id: number,
    payload: Record<string, unknown>
): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const existing = await store.get(id);
    if (!existing) throw new Error(`Queued incident ${id} not found`);
    if (existing.status === 'synced') {
        throw new Error('Cannot edit an already-synced incident');
    }
    await store.put({ ...existing, payload, updatedAt: Date.now() });
    await tx.done;
}

export async function deleteQueuedIncident(id: number): Promise<void> {
    const db = await getDB();
    await db.delete(STORE_NAME, id);
}
