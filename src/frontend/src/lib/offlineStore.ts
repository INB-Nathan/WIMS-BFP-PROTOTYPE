import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'wims-bfp-db';
const DB_VERSION = 4;
const STORE_NAME = 'incident-queue';      // legacy — Phase 1A compat
const KEY_STORE = 'crypto-keys';
const OPS_STORE = 'offlineOps';           // Phase 1B+
const CACHE_STORE = 'cachedIncidents';    // Phase 1D+
const ANALYTICS_STORE = 'analytics-cache'; // PR #272 offline read cache

// ─── Legacy types (incident-queue) ────────────────────────────────────────

// Advisory offline storage cap (MB). Default 50; overridden via initOfflineStorageLimit().
// This is client-side enforcement only — no server eviction occurs.
let _offlineStorageLimitMb = 50;

export type OfflineOpType = 'create' | 'update' | 'submit' | 'delete' | 'verify' | 'archive_action';
export type LegacyOfflineOpType = 'create' | 'verify' | 'archive_action';
export type VerifyAction = 'accept' | 'accept_replace' | 'reject';

export interface VerifyPayload {
    incident_id: number;
    action: VerifyAction;
    notes: string | null;
    original_incident_id?: number;
}

export interface ArchiveActionPayload {
    incident_id: number;
    action: 'archive' | 'unarchive';
}

export interface QueueIncidentOptions {
    opType?: LegacyOfflineOpType;
    localId?: string;
}

export interface PendingIncident {
    id: number;
    opType?: LegacyOfflineOpType;
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
    opType?: LegacyOfflineOpType;
    localId?: string;
    encrypted: EncryptedPayload;
    createdAt: number;
    status: 'pending' | 'synced';
}

// ─── Offline operations types (offlineOps) ────────────────────────────────
export type OfflineSyncStatus = 'draft' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'error';
export type OfflineErrorCode = '409_duplicate' | '409_conflict' | '403' | '4xx' | 'network' | null;

export interface OfflineOp {
    localId: string;               // UUID — idempotency key
    operation: OfflineOpType;
    serverId: number | null;       // null for creates not yet synced
    linkedLocalId: string | null;  // links submit/update ops to their create op
    serverUpdatedAt: string | null; // ISO timestamp for OCC on updates
    regionId: number;
    encoderId: string;             // keycloak sub of the encoder who queued this
    payload: EncryptedPayload;
    createdAt: number;
    syncStatus: OfflineSyncStatus;
    errorCode: OfflineErrorCode;
    errorMessage: string | null;
    serverVersion: Record<string, unknown> | null; // stored on 409_conflict
    retryCount: number;
    lastAttemptAt: number | null;
}

// Decrypted version returned to callers
export interface OfflineOpDecrypted extends Omit<OfflineOp, 'payload'> {
    payload: Record<string, unknown>;
}

// ─── Cached incidents types (cachedIncidents) ─────────────────────────────

export interface CachedIncident {
    serverId: number;              // PK
    data: EncryptedPayload;
    cachedAt: number;
    encoderId: string;
}

export interface CachedIncidentDecrypted extends Omit<CachedIncident, 'data'> {
    data: Record<string, unknown>;
}

// ─── DB initialisation ────────────────────────────────────────────────────

async function getDB(): Promise<IDBPDatabase> {
    return openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion) {
            // v2: original stores
            if (oldVersion < 2) {
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains(KEY_STORE)) {
                    db.createObjectStore(KEY_STORE);
                }
            }
            // v3: offline operations queue + read-path cache
            if (oldVersion < 3) {
                if (!db.objectStoreNames.contains(OPS_STORE)) {
                    const opsStore = db.createObjectStore(OPS_STORE, { keyPath: 'localId' });
                    opsStore.createIndex('by_status', 'syncStatus');
                    opsStore.createIndex('by_encoder', 'encoderId');
                    opsStore.createIndex('by_createdAt', 'createdAt');
                }
                if (!db.objectStoreNames.contains(CACHE_STORE)) {
                    const cacheStore = db.createObjectStore(CACHE_STORE, { keyPath: 'serverId' });
                    cacheStore.createIndex('by_encoder', 'encoderId');
                    cacheStore.createIndex('by_cachedAt', 'cachedAt');
                }
            }
            // v4: PR #272 analytics/admin/validator encrypted read cache. Separate
            // version because both branches used v3 for different stores.
            if (oldVersion < 4) {
                if (!db.objectStoreNames.contains(ANALYTICS_STORE)) {
                    const analyticsStore = db.createObjectStore(ANALYTICS_STORE, { keyPath: 'key' });
                    analyticsStore.createIndex('by_cachedAt', 'cachedAt');
                }
            }
        },
    });
}

// ─── Per-user crypto isolation (item F12) ─────────────────────────────────
//
// Each encoder account on a shared device gets its OWN AES-256-GCM key. The key
// is a *non-extractable* CryptoKey, so even code that reads it back from
// IndexedDB cannot export the raw bytes. Its storage slot is named after
// SHA-256(per-install random salt ‖ userId) rather than a guessable plaintext
// string, so another account cannot locate the prior user's key by deriving the
// name from a known uid alone — the random salt is required.
//
// The decisive protection is destruction-on-switch: when a *different* uid logs
// in (see setActiveOfflineUser), every stored key, queued op, and cached
// incident is cleared, so the previous user's encrypted blobs are both deleted
// and rendered permanently undecryptable.
//
// Browser limitation (documented honestly): while a given user is the active
// session, same-origin code running under that session can decrypt that user's
// own data — there is no way around this in a pure client-side PWA without a
// server-held or user-supplied secret. The guarantee here is strictly
// cross-account: account B can never read account A's offline data.

const LEGACY_KEY_NAME = 'aes-gcm-key';
const KEY_SALT_NAME = '__wims_key_salt__';
const ACTIVE_UID_LS_KEY = 'wims:offline_active_uid';

let activeUserId: string | null = null;
let saltCache: Uint8Array | null = null;

async function getKeySalt(db: IDBPDatabase): Promise<Uint8Array> {
    if (saltCache) return saltCache;
    const stored = await db.get(KEY_STORE, KEY_SALT_NAME);
    if (stored) {
        saltCache = stored instanceof Uint8Array ? stored : new Uint8Array(stored as ArrayBuffer);
        return saltCache;
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await db.put(KEY_STORE, salt, KEY_SALT_NAME);
    saltCache = salt;
    return salt;
}

async function keyStorageName(db: IDBPDatabase): Promise<string> {
    // No active user set yet (e.g. unit tests, or pre-login) → legacy single key.
    if (!activeUserId) return LEGACY_KEY_NAME;
    const salt = await getKeySalt(db);
    const uidBytes = new TextEncoder().encode(activeUserId);
    const buf = new Uint8Array(salt.length + uidBytes.length);
    buf.set(salt, 0);
    buf.set(uidBytes, salt.length);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    return `aeskey:${hex}`;
}

async function getOrCreateKey(): Promise<CryptoKey> {
    const db = await getDB();
    const name = await keyStorageName(db);
    const existing = await db.get(KEY_STORE, name);
    if (existing) return existing as CryptoKey;
    const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
    await db.put(KEY_STORE, key, name);
    return key;
}

/**
 * Destroy ALL offline state on this device — every queued op, cached incident,
 * and stored crypto key. Used when a different account logs in so the prior
 * user's encrypted data cannot be carried over or decrypted.
 */
async function wipeAllOfflineData(): Promise<void> {
    const db = await getDB();
    await db.clear(OPS_STORE);
    await db.clear(CACHE_STORE);
    await db.clear(KEY_STORE);
    saltCache = null;
}

/**
 * Bind the offline store to the currently logged-in encoder. Call once whenever
 * the authenticated user is (re)established.
 *
 * - Same uid as last time → no-op beyond ensuring the key exists (unsynced work
 *   survives a re-login).
 * - Different uid than last time → full wipe of the previous user's ops, cache,
 *   and keys BEFORE the new user's key is created (item F12, requirement b:
 *   covers the "forgot to log out" case — clearing happens on the new login,
 *   not only on the prior user's logout).
 */
export async function setActiveOfflineUser(userId: string): Promise<void> {
    if (!userId) return;
    let prev: string | null = null;
    try { prev = localStorage.getItem(ACTIVE_UID_LS_KEY); } catch { /* private mode */ }

    activeUserId = userId;
    try { localStorage.setItem(ACTIVE_UID_LS_KEY, userId); } catch { /* private mode */ }

    if (prev && prev !== userId) {
        await wipeAllOfflineData();
    } else if (!prev) {
        // First run under per-user keying: adopt any legacy single key so this
        // user's existing offline work isn't orphaned by the upgrade.
        const db = await getDB();
        const name = await keyStorageName(db);
        const derived = await db.get(KEY_STORE, name);
        const legacy = await db.get(KEY_STORE, LEGACY_KEY_NAME);
        if (!derived && legacy) {
            await db.put(KEY_STORE, legacy, name);
            await db.delete(KEY_STORE, LEGACY_KEY_NAME);
        }
    }

    await getOrCreateKey();
}

/**
 * Manual "clear offline data" for the current device (item F11). Wipes all
 * queued ops, cached incidents, and keys. The caller should re-bind the active
 * user afterwards (setActiveOfflineUser) before queueing new work.
 */
export async function clearAllOfflineData(): Promise<void> {
    await wipeAllOfflineData();
    activeUserId = null;
    try { localStorage.removeItem(ACTIVE_UID_LS_KEY); } catch { /* private mode */ }
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

/**
 * Clear the active user's AES-GCM key (and any legacy single key) so cached data
 * becomes unreadable on shared devices. Note: logout does NOT call this — unsynced
 * ops must survive a same-user re-login. A different-user login wipes everything
 * via setActiveOfflineUser instead.
 */
export async function clearCryptoKey(): Promise<void> {
    const db = await getDB();
    const name = await keyStorageName(db);
    await db.delete(KEY_STORE, name);
    await db.delete(KEY_STORE, LEGACY_KEY_NAME);
}

// ─── Legacy API (incident-queue) — Phase 1A compat ────────────────────────

/** Override the advisory offline storage cap at app init time. */
export function initOfflineStorageLimit(limitMb: number): void {
    _offlineStorageLimitMb = limitMb;
}

export async function queueIncident(
    payload: Record<string, unknown>,
    options: QueueIncidentOptions = {}
): Promise<void> {
    const db = await getDB();

    // Advisory size guard: estimate total queue bytes and warn/throw if over cap.
    const all: QueuedRecord[] = await db.getAll(STORE_NAME);
    const totalBytes = all.reduce((sum, item) => sum + (item.encrypted?.data?.length ?? 0), 0);
    const limitBytes = _offlineStorageLimitMb * 1024 * 1024;
    if (totalBytes >= limitBytes) {
        if (process.env.NODE_ENV !== 'production') {
            const usedMb = (totalBytes / 1024 / 1024).toFixed(1);
            console.warn(
                `[offlineStore] Queue ~${usedMb}MB exceeds advisory cap of ${_offlineStorageLimitMb}MB. Skipping.`
            );
        }
        throw new Error(
            `Offline storage cap reached (${_offlineStorageLimitMb}MB). ` +
            `Connect to the network to sync, or contact your administrator.`
        );
    }

    const encrypted = await encryptPayload(payload);
    await db.add(STORE_NAME, {
        opType: options.opType,
        localId: options.localId,
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
            opType: item.opType,
            localId: item.localId,
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
        opType: item.opType,
        localId: item.localId,
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

export async function markSynced(id: number) {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await store.delete(id);
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

// ─── Offline Operations API (offlineOps) — Phase 1B+ ─────────────────────

/**
 * Queue a new offline operation. Payload is encrypted at rest.
 */
export async function queueOfflineOp(
    op: Omit<OfflineOp, 'payload' | 'syncStatus' | 'errorCode' | 'errorMessage' | 'serverVersion' | 'retryCount' | 'lastAttemptAt'> & {
        payload: Record<string, unknown>;
    }
): Promise<void> {
    const db = await getDB();
    const encrypted = await encryptPayload(op.payload);
    const record: OfflineOp = {
        ...op,
        payload: encrypted,
        syncStatus: 'pending',
        errorCode: null,
        errorMessage: null,
        serverVersion: null,
        retryCount: 0,
        lastAttemptAt: null,
    };
    await db.put(OPS_STORE, record);
}

/**
 * Update an existing offline op's payload (e.g. re-save a draft in progress).
 * Only allowed for ops still in 'pending' status.
 */
export async function updateOfflineOp(
    localId: string,
    payload: Record<string, unknown>
): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(OPS_STORE, 'readwrite');
    const store = tx.objectStore(OPS_STORE);
    const existing: OfflineOp | undefined = await store.get(localId);
    if (!existing || existing.syncStatus !== 'pending') {
        await tx.done;
        return;
    }
    existing.payload = await encryptPayload(payload);
    await store.put(existing);
    await tx.done;
}

/**
 * Get all ops for a given encoder that are in pending or error state,
 * ordered by createdAt ascending (oldest first for sequential sync).
 */
export async function getPendingOps(encoderId: string): Promise<OfflineOpDecrypted[]> {
    const db = await getDB();
    const all: OfflineOp[] = await db.getAllFromIndex(OPS_STORE, 'by_encoder', encoderId);
    const actionable = all
        .filter((op) => op.syncStatus === 'pending' || op.syncStatus === 'error')
        .sort((a, b) => a.createdAt - b.createdAt);

    const result: OfflineOpDecrypted[] = [];
    for (const op of actionable) {
        const payload = await decryptPayload<Record<string, unknown>>(op.payload);
        result.push({ ...op, payload });
    }
    return result;
}

/**
 * Get all ops in 'conflict' state for the encoder — these need user action.
 */
export async function getConflictOps(encoderId: string): Promise<OfflineOpDecrypted[]> {
    const db = await getDB();
    const all: OfflineOp[] = await db.getAllFromIndex(OPS_STORE, 'by_encoder', encoderId);
    const conflicts = all.filter((op) => op.syncStatus === 'conflict');
    const result: OfflineOpDecrypted[] = [];
    for (const op of conflicts) {
        const payload = await decryptPayload<Record<string, unknown>>(op.payload);
        result.push({ ...op, payload });
    }
    return result;
}

/**
 * Count of pending + error + conflict ops for this encoder (for badge display).
 */
export async function getPendingOpsCount(encoderId: string): Promise<number> {
    const db = await getDB();
    const all: OfflineOp[] = await db.getAllFromIndex(OPS_STORE, 'by_encoder', encoderId);
    return all.filter(
        (op) => op.syncStatus === 'pending' || op.syncStatus === 'error' || op.syncStatus === 'conflict'
    ).length;
}

export async function markOpSyncing(localId: string): Promise<void> {
    await _patchOp(localId, { syncStatus: 'syncing', lastAttemptAt: Date.now() });
}

export async function markOpPending(localId: string, errorMessage?: string): Promise<void> {
    await _patchOp(localId, {
        syncStatus: 'pending',
        errorCode: null,
        errorMessage: errorMessage ?? null,
    });
}

export async function markOpSynced(localId: string, serverId?: number): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(OPS_STORE, 'readwrite');
    const store = tx.objectStore(OPS_STORE);
    const op: OfflineOp | undefined = await store.get(localId);
    if (op) {
        op.syncStatus = 'synced';
        if (serverId !== undefined) op.serverId = serverId;
        await store.put(op);
    }
    await tx.done;
}

export async function markOpConflict(
    localId: string,
    errorCode: '409_duplicate' | '409_conflict',
    serverVersion?: Record<string, unknown>
): Promise<void> {
    await _patchOp(localId, {
        syncStatus: 'conflict',
        errorCode,
        serverVersion: serverVersion ?? null,
    });
}

export async function markOpError(
    localId: string,
    errorCode: OfflineErrorCode,
    errorMessage: string
): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(OPS_STORE, 'readwrite');
    const store = tx.objectStore(OPS_STORE);
    const op: OfflineOp | undefined = await store.get(localId);
    if (op) {
        op.syncStatus = 'error';
        op.errorCode = errorCode;
        op.errorMessage = errorMessage;
        op.retryCount += 1;
        op.lastAttemptAt = Date.now();
        await store.put(op);
    }
    await tx.done;
}

/**
 * Resolve a conflict op — replace its payload with the merged result and
 * reset it to 'pending' so the sync engine picks it up again.
 */
export async function resolveConflictOp(
    localId: string,
    mergedPayload: Record<string, unknown>
): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(OPS_STORE, 'readwrite');
    const store = tx.objectStore(OPS_STORE);
    const op: OfflineOp | undefined = await store.get(localId);
    if (op) {
        op.payload = await encryptPayload(mergedPayload);
        op.syncStatus = 'pending';
        op.errorCode = null;
        op.errorMessage = null;
        op.serverVersion = null;
        op.retryCount = 0;
        await store.put(op);
    }
    await tx.done;
}

export async function deleteOfflineOp(localId: string): Promise<void> {
    const db = await getDB();
    await db.delete(OPS_STORE, localId);
}

/**
 * Find a not-yet-synced submit op linked to a given create op's localId.
 * Used to enforce "withdraw before edit" on offline-originated pending incidents
 * (item C8): a PENDING_SYNC incident with a queued submit must be withdrawn
 * (the submit op removed) before it can be edited.
 */
export async function getLinkedSubmitOpLocalId(createLocalId: string): Promise<string | null> {
    const db = await getDB();
    const all: OfflineOp[] = await db.getAll(OPS_STORE);
    const match = all.find(
        (op) => op.operation === 'submit' && op.linkedLocalId === createLocalId && op.syncStatus !== 'synced',
    );
    return match?.localId ?? null;
}

export async function deleteOfflineOpCascade(localId: string): Promise<void> {
    const db = await getDB();
    const all: OfflineOp[] = await db.getAll(OPS_STORE);
    const idsToDelete = new Set<string>([localId]);

    let foundLinkedOp = true;
    while (foundLinkedOp) {
        foundLinkedOp = false;
        for (const op of all) {
            if (op.linkedLocalId && idsToDelete.has(op.linkedLocalId) && !idsToDelete.has(op.localId)) {
                idsToDelete.add(op.localId);
                foundLinkedOp = true;
            }
        }
    }

    await Promise.all([...idsToDelete].map((id) => db.delete(OPS_STORE, id)));
}

/**
 * After a successful sync batch, delete all ops marked 'synced'
 * older than retentionMs (default: 7 days) to cap storage growth.
 */
export async function purgeSyncedOps(retentionMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    const db = await getDB();
    const cutoff = Date.now() - retentionMs;
    const all: OfflineOp[] = await db.getAll(OPS_STORE);
    const tx = db.transaction(OPS_STORE, 'readwrite');
    const store = tx.objectStore(OPS_STORE);
    for (const op of all) {
        if (op.syncStatus === 'synced' && op.createdAt < cutoff) {
            await store.delete(op.localId);
        }
    }
    await tx.done;
}

/**
 * Save or overwrite an in-progress form draft in IndexedDB.
 * A draft op has syncStatus='draft' and is never picked up by the sync engine.
 * Use this for autosave while the encoder is still editing.
 */
export async function saveDraftOp(
    localId: string,
    encoderId: string,
    regionId: number,
    draftPayload: Record<string, unknown>
): Promise<void> {
    const db = await getDB();
    const encrypted = await encryptPayload(draftPayload);
    const existing: OfflineOp | undefined = await db.get(OPS_STORE, localId);
    const record: OfflineOp = {
        localId,
        operation: 'create',
        serverId: null,
        linkedLocalId: null,
        serverUpdatedAt: null,
        regionId,
        encoderId,
        payload: encrypted,
        createdAt: existing?.createdAt ?? Date.now(),
        syncStatus: 'draft',
        errorCode: null,
        errorMessage: null,
        serverVersion: null,
        retryCount: 0,
        lastAttemptAt: null,
    };
    await db.put(OPS_STORE, record);
}

/**
 * Find a create op whose serverId matches (set by the sync engine after a
 * successful POST). Used to reconstruct the incident detail view offline when
 * the full detail was never fetched from the server into cachedIncidents.
 */
export async function getOfflineOpByServerId(
    serverId: number,
    encoderId: string,
): Promise<OfflineOpDecrypted | null> {
    const db = await getDB();
    const all: OfflineOp[] = await db.getAllFromIndex(OPS_STORE, 'by_encoder', encoderId);
    const match = all.find((op) => op.operation === 'create' && op.serverId === serverId);
    if (!match) return null;
    const payload = await decryptPayload<Record<string, unknown>>(match.payload);
    return { ...match, payload };
}

/**
 * Get a single offline op by localId, decrypted.
 * Returns undefined if not found.
 */
export async function getOfflineOp(localId: string): Promise<OfflineOpDecrypted | undefined> {
    const db = await getDB();
    const op: OfflineOp | undefined = await db.get(OPS_STORE, localId);
    if (!op) return undefined;
    const payload = await decryptPayload<Record<string, unknown>>(op.payload);
    return { ...op, payload };
}

/**
 * On app startup or before sync, reset any ops stuck in 'syncing' state
 * (e.g. the tab closed mid-sync) back to 'pending' so they are retried.
 *
 * An op is considered stale when its lastAttemptAt is older than staleThresholdMs
 * (default 5 minutes). Ops with no lastAttemptAt are always reset — they were
 * marked syncing but never attempted (shouldn't happen, but handle defensively).
 */
export async function recoverStaleSyncingOps(
    encoderId: string,
    staleThresholdMs = 5 * 60 * 1000,
): Promise<number> {
    const db = await getDB();
    const all: OfflineOp[] = await db.getAllFromIndex(OPS_STORE, 'by_encoder', encoderId);
    const cutoff = Date.now() - staleThresholdMs;
    const stale = all.filter(
        (op) =>
            op.syncStatus === 'syncing' &&
            (op.lastAttemptAt === null || op.lastAttemptAt < cutoff),
    );
    if (stale.length === 0) return 0;

    const tx = db.transaction(OPS_STORE, 'readwrite');
    const store = tx.objectStore(OPS_STORE);
    for (const op of stale) {
        await store.put({ ...op, syncStatus: 'pending' });
    }
    await tx.done;
    return stale.length;
}

/**
 * Get all draft ops for this encoder (create ops with syncStatus='draft').
 * Sorted newest first for draft recovery UI.
 */
export async function getDraftOps(encoderId: string): Promise<OfflineOpDecrypted[]> {
    const db = await getDB();
    const all: OfflineOp[] = await db.getAllFromIndex(OPS_STORE, 'by_encoder', encoderId);
    const drafts = all
        .filter((op) => op.syncStatus === 'draft' && op.operation === 'create')
        .sort((a, b) => b.createdAt - a.createdAt);
    const result: OfflineOpDecrypted[] = [];
    for (const op of drafts) {
        const payload = await decryptPayload<Record<string, unknown>>(op.payload);
        result.push({ ...op, payload });
    }
    return result;
}

async function _patchOp(localId: string, patch: Partial<OfflineOp>): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(OPS_STORE, 'readwrite');
    const store = tx.objectStore(OPS_STORE);
    const op: OfflineOp | undefined = await store.get(localId);
    if (op) {
        await store.put({ ...op, ...patch });
    }
    await tx.done;
}

// ─── Cached Incidents API (cachedIncidents) — Phase 1D+ ──────────────────

/**
 * Write or overwrite a cached incident response from the server.
 */
export async function cacheIncident(
    serverId: number,
    data: Record<string, unknown>,
    encoderId: string
): Promise<void> {
    const db = await getDB();
    const encrypted = await encryptPayload(data);
    const record: CachedIncident = {
        serverId,
        data: encrypted,
        cachedAt: Date.now(),
        encoderId,
    };
    await db.put(CACHE_STORE, record);
}

/**
 * Get all cached incidents for this encoder, newest first.
 */
export async function getCachedIncidents(encoderId: string): Promise<CachedIncidentDecrypted[]> {
    const db = await getDB();
    const all: CachedIncident[] = await db.getAllFromIndex(CACHE_STORE, 'by_encoder', encoderId);
    all.sort((a, b) => b.cachedAt - a.cachedAt);
    const result: CachedIncidentDecrypted[] = [];
    for (const item of all) {
        const data = await decryptPayload<Record<string, unknown>>(item.data);
        result.push({ ...item, data });
    }
    return result;
}

/**
 * Get a single cached incident by server ID.
 */
export async function getCachedIncident(serverId: number): Promise<CachedIncidentDecrypted | undefined> {
    const db = await getDB();
    const item: CachedIncident | undefined = await db.get(CACHE_STORE, serverId);
    if (!item) return undefined;
    const data = await decryptPayload<Record<string, unknown>>(item.data);
    return { ...item, data };
}

/**
 * Evict cached incidents older than retentionMs (default: 7 days).
 * Call after a successful online sync to keep the cache fresh.
 */
export async function evictStaleCachedIncidents(
    encoderId: string,
    retentionMs = 7 * 24 * 60 * 60 * 1000
): Promise<void> {
    const db = await getDB();
    const cutoff = Date.now() - retentionMs;
    const all: CachedIncident[] = await db.getAllFromIndex(CACHE_STORE, 'by_encoder', encoderId);
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    const store = tx.objectStore(CACHE_STORE);
    for (const item of all) {
        if (item.cachedAt < cutoff) {
            await store.delete(item.serverId);
        }
    }
    await tx.done;
}

/**
 * Clear ALL cached incidents for this encoder (e.g. on logout).
 */
export async function clearCachedIncidents(encoderId: string): Promise<void> {
    const db = await getDB();
    const all: CachedIncident[] = await db.getAllFromIndex(CACHE_STORE, 'by_encoder', encoderId);
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    const store = tx.objectStore(CACHE_STORE);
    for (const item of all) {
        await store.delete(item.serverId);
    }
    await tx.done;
}

/**
 * Clear the entire read cache regardless of which encoder keyed it.
 * Used on logout for shared-device privacy: cached incident PII must not
 * linger for the next user. Pending offline ops (offlineOps) are deliberately
 * preserved — they are encrypted and encoder-scoped, so unsynced work survives
 * a re-login instead of being silently dropped.
 */
export async function clearAllCachedIncidents(): Promise<void> {
    const db = await getDB();
    await db.clear(CACHE_STORE);

}
