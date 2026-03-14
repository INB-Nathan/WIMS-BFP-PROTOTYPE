import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'wims-bfp-db';
const STORE_NAME = 'incident-queue';

interface PendingIncident {
    id?: number;
    payload: any;
    createdAt: number;
    status: 'pending' | 'synced';
}

async function getDB(): Promise<IDBPDatabase> {
    return openDB(DB_NAME, 1, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        },
    });
}

export async function queueIncident(payload: any) {
    const db = await getDB();
    await db.add(STORE_NAME, {
        payload,
        createdAt: Date.now(),
        status: 'pending',
    });
}

export async function getPendingIncidents(): Promise<PendingIncident[]> {
    const db = await getDB();
    const all = await db.getAll(STORE_NAME);
    return all.filter((item) => item.status === 'pending');
}

export async function markSynced(id: number) {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const item = await store.get(id);
    if (item) {
        item.status = 'synced';
        await store.put(item);
        // Optionally delete: await store.delete(id);
        await store.delete(id); // Let's delete to keep it clean for prototype
    }
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
