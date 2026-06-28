import { openDB, IDBPDatabase } from 'idb';
import { validateOfflinePayload } from './validation/offlineIncident';
import { clearOfflineModeEnabled } from './offlineModeFlags';

const DB_NAME = 'wims-bfp-db';
const DB_VERSION = 6;
const STORE_NAME = 'incident-queue';      // legacy — Phase 1A compat
const KEY_STORE = 'crypto-keys';
const OPS_STORE = 'offlineOps';           // Phase 1B+
const CACHE_STORE = 'cachedIncidents';    // Phase 1D+
const READ_CACHE_STORE = 'analytics-cache'; // PR #272 + Task 1 generic encrypted read cache
const REFERENCE_STORE = 'reference-cache'; // Task 1 — unencrypted, per-user, long-TTL reference data
const PUBLIC_OPS_STORE = 'publicOfflineOps'; // v5 — civilian anonymous offline submission queue

// Back-compat default TTL for records predating the per-record ttlMs schema
// (pushback P3). Longest-TTL-on-read ensures pre-v3 records are not wrongly
// evicted before the next online refresh overwrites them with a ttlMs-bearing
// record.
const DEFAULT_BACK_COMPAT_TTL_MS = 30 * 60 * 1000;
// Cap deletions per eviction pass so a single prune never holds an unbounded
// IDB transaction open (Task 1 + Task 10 hard constraints).
const MAX_EVICTIONS_PER_PASS = 500;

// ─── Legacy types (incident-queue) ────────────────────────────────────────

// Advisory offline storage cap (MB). Default 50; overridden via initOfflineStorageLimit().
// This is client-side enforcement only — no server eviction occurs.
let _offlineStorageLimitMb = 50;

export type OfflineOpType = 'create' | 'update' | 'submit' | 'delete' | 'verify' | 'archive_action';
// Issue #17: the previous `LegacyOfflineOpType = 'create' | 'verify' | 'archive_action'`
// was a parallel string union. It is now expressed as an Extract of OfflineOpType
// so the subset relationship is enforced at the type level — adding a new
// `LegacyOfflineOpType` member that is not in OfflineOpType would no longer
// compile. (Note: `Pick<>` only works on object types; `Extract<>` is the
// string-union equivalent.)
export type LegacyOfflineOpType = Extract<OfflineOpType, 'create' | 'verify' | 'archive_action'>;
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
    scope?: 'validator' | 'encoder';
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

// Issue #16: the previous CachedReadRecord and CachedReferenceRecord were
// near-duplicates differing only in the payload field. They are now derived
// from a single generic CachedRecord<TPayload>.
interface CachedRecord<TPayload> {
    key: string;
    data: TPayload;
    cachedAt: number;
    ttlMs: number;
}

type CachedReadRecord = CachedRecord<EncryptedPayload>;
type CachedReferenceRecord = CachedRecord<unknown>;

export interface CachedResponse<T = unknown> {
    key: string;
    data: T;
    cachedAt: number;
    ttlMs: number;
}

// Back-compat alias — older callers that still import CachedAnalyticsResponse.
// New code should import CachedResponse.
export type CachedAnalyticsResponse<T = unknown> = CachedResponse<T>;

interface QueuedRecord {
    id?: number;
    opType?: LegacyOfflineOpType;
    localId?: string;
    encrypted: EncryptedPayload;
    createdAt: number;
    status: 'pending' | 'synced';
}

// ─── Offline operations types (offlineOps) ────────────────────────────────
export type OfflineSyncStatus = 'draft' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'error' | 'failed';
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
                if (!db.objectStoreNames.contains(READ_CACHE_STORE)) {
                    const analyticsStore = db.createObjectStore(READ_CACHE_STORE, { keyPath: 'key' });
                    analyticsStore.createIndex('by_cachedAt', 'cachedAt');
                }
            }
            // v5: civilian anonymous offline submission queue. Plaintext by design
            // (no per-user key — civilians are unauthenticated) and keyed by
            // localId (UUID) so the sync engine can resolve linkedLocalId chains
            // (submit → append → followup) after server-id assignment.
            if (oldVersion < 5) {
                if (!db.objectStoreNames.contains(PUBLIC_OPS_STORE)) {
                    const publicOpsStore = db.createObjectStore(PUBLIC_OPS_STORE, { keyPath: 'localId' });
                    publicOpsStore.createIndex('by_deviceId', 'deviceId');
                    publicOpsStore.createIndex('by_status', 'status');
                    publicOpsStore.createIndex('by_createdAt', 'createdAt');
                }
            }
            // v6: unencrypted per-user reference cache (Task 1). Created via
            // createObjectStore only — NEVER recreate or drop any of the
            // existing stores (DB upgrade hard constraint).
            if (oldVersion < 6) {
                if (!db.objectStoreNames.contains(REFERENCE_STORE)) {
                    const referenceStore = db.createObjectStore(REFERENCE_STORE, { keyPath: 'key' });
                    referenceStore.createIndex('by_cachedAt', 'cachedAt');
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
 *
 * Also clears the legacy Phase 1A 'incident-queue' store (item F1) so the
 * prior user's pre-Phase 1B queued incidents cannot be carried over.
 */
async function wipeAllOfflineData(): Promise<void> {
    const db = await getDB();
    await db.clear(OPS_STORE);
    await db.clear(CACHE_STORE);
    await db.clear(KEY_STORE);
    await db.clear(STORE_NAME);
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
        clearOfflineModeEnabled();
        // Pushback P1: the unencrypted REFERENCE_STORE has no per-user crypto
        // isolation, so the prior user's plaintext RLS-scoped ref data must
        // be wiped on user-switch (in addition to the crypto-key wipe above).
        // Best-effort — a failed sweep must not block login.
        try {
            await clearReferenceDataForUser(prev);
        } catch (err) {
            devWarn(
                `[offlineStore] clearReferenceDataForUser(${prev}) failed on user switch:`,
                err,
            );
        }
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
    clearOfflineModeEnabled();
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
            devWarn(
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
    // Encrypt BEFORE opening the transaction. IndexedDB readwrite transactions
    // auto-commit when control returns to the event loop, so awaiting
    // encryptPayload between store.get and store.put would kill the tx.
    const encrypted = await encryptPayload(payload);
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
    item.encrypted = encrypted;
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

export async function cacheReadResponse<T = unknown>(
    key: string,
    data: T,
    ttlMs: number,
    cachedAt: number = Date.now()
): Promise<void> {
    const db = await getDB();
    const encrypted = await encryptPayload(data);
    const record: CachedReadRecord = {
        key,
        data: encrypted,
        cachedAt,
        ttlMs,
    };
    await db.put(READ_CACHE_STORE, record);
}

export async function getReadCachedResponse<T = unknown>(
    key: string
): Promise<CachedResponse<T> | undefined> {
    const db = await getDB();
    const item: CachedReadRecord | undefined = await db.get(READ_CACHE_STORE, key);
    if (!item) return undefined;
    const data = await decryptPayload<T>(item.data);
    return {
        key: item.key,
        data,
        cachedAt: item.cachedAt,
        ttlMs: item.ttlMs,
    };
}

export async function clearAnalyticsCache(): Promise<void> {
    const db = await getDB();
    await db.clear(READ_CACHE_STORE);
}

// ─── Reference (unencrypted) read cache — Task 1 / spec v3 ───────────
//
// Reference data (regions/provinces/cities) is non-sensitive and shared
// across roles, so the per-record crypto cost of the encrypted path is
// unjustified. The store is plaintext; isolation is achieved by
// userId-namespaced keys (`reference:{userId}:...`) and by wiping the
// prior user's prefix on user switch (see setActiveOfflineUser).
//
// Callers build the userId-namespaced key — this module does not hardcode
// the active user, so per-user key construction stays in the wrapper layer.

export async function cacheReferenceData<T = unknown>(
    key: string,
    data: T,
    ttlMs: number,
    cachedAt: number = Date.now()
): Promise<void> {
    // Issue #10: the REFERENCE_STORE is plaintext and shared across users
    // on the same device (per-user isolation relies entirely on the
    // canonical `reference:` key prefix). A future caller that accidentally
    // caches a non-public payload here would silently break the threat
    // model. Guard the key shape in non-production builds to fail loud.
    if (!key.startsWith('reference:') && process.env.NODE_ENV !== 'production') {
        throw new Error(
            `[offlineStore] cacheReferenceData: key must start with "reference:" (got "${key}"). ` +
            'The plaintext REFERENCE_STORE is not a safe place for non-public payloads.',
        );
    }
    const db = await getDB();
    const record: CachedReferenceRecord = {
        key,
        data: data as unknown,
        cachedAt,
        ttlMs,
    };
    await db.put(REFERENCE_STORE, record);
}

export async function getCachedReferenceData<T = unknown>(
    key: string
): Promise<CachedResponse<T> | undefined> {
    const db = await getDB();
    const item: CachedReferenceRecord | undefined = await db.get(REFERENCE_STORE, key);
    if (!item) return undefined;
    return {
        key: item.key,
        data: item.data as T,
        cachedAt: item.cachedAt,
        ttlMs: item.ttlMs,
    };
}

// Escape a string for safe inclusion inside a RegExp constructor.
function escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Delete every REFERENCE_STORE entry whose key starts with `reference:{userId}:`.
 * Used by setActiveOfflineUser on user-switch (pushback P1) to ensure plaintext
 * ref data does not survive across accounts. Best-effort — never throws.
 */
export async function clearReferenceDataForUser(userId: string): Promise<number> {
    if (!userId) return 0;
    const re = new RegExp(`^reference:${escapeRegex(userId)}:`);
    try {
        const db = await getDB();
        const tx = db.transaction(REFERENCE_STORE, 'readwrite');
        const store = tx.objectStore(REFERENCE_STORE);
        let cursor = await store.openCursor();
        let deleted = 0;
        while (cursor) {
            if (re.test(String(cursor.key))) {
                await cursor.delete();
                deleted += 1;
            }
            cursor = await cursor.continue();
        }
        await tx.done;
        return deleted;
    } catch (err) {
        devWarn(`[offlineStore] clearReferenceDataForUser(${userId}) failed:`, err);
        return 0;
    }
}

// ─── Per-record-TTL eviction (pushback P3) ─────────────────────────
//
// Each record carries its own ttlMs so a 60s security-logs entry is pruned
// at ~60s while a 30min config entry survives. Records missing ttlMs
// (pre-v3 back-compat) use DEFAULT_BACK_COMPAT_TTL_MS so they aren't
// wrongly evicted before the next online refresh overwrites them with a
// ttlMs-bearing record.

/**
 * Dev-only warning helper. Issue #15: replaces the 9 repeated
 * `if (process.env.NODE_ENV !== 'production') console.warn(...)` blocks
 * scattered through this module with a single shared function.
 */
export function devWarn(...args: unknown[]): void {
    if (process.env.NODE_ENV !== 'production') {
        console.warn(...args);
    }
}

/**
 * Scan a record-shaped IndexedDB object store and delete every record
 * whose `cachedAt + ttlMs < Date.now()` using the record's own ttlMs.
 * Bounded at MAX_EVICTIONS_PER_PASS deletions per call. Best-effort.
 *
 * Issue #12: the previous `evictExpiredReadCache` and
 * `evictExpiredReferenceData` were byte-identical except for the store
 * name; this helper accepts the store name as a parameter so the same
 * algorithm covers both.
 */
export async function evictExpiredInStore(storeName: string): Promise<number> {
    try {
        const db = await getDB();
        const now = Date.now();
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        let cursor = await store.openCursor();
        let deleted = 0;
        while (cursor && deleted < MAX_EVICTIONS_PER_PASS) {
            const value = cursor.value as { ttlMs?: unknown; cachedAt?: unknown };
            const ttl = typeof value.ttlMs === 'number' ? value.ttlMs : DEFAULT_BACK_COMPAT_TTL_MS;
            const cachedAt = typeof value.cachedAt === 'number' ? value.cachedAt : 0;
            if (cachedAt + ttl < now) {
                await cursor.delete();
                deleted += 1;
            }
            cursor = await cursor.continue();
        }
        await tx.done;
        return deleted;
    } catch (err) {
        devWarn(`[offlineStore] evictExpiredInStore(${storeName}) failed:`, err);
        return 0;
    }
}

/**
 * Scan READ_CACHE_STORE and delete every record whose
 * cachedAt + ttlMs < Date.now() using the record's own ttlMs.
 * Bounded at MAX_EVICTIONS_PER_PASS deletions per call. Best-effort.
 *
 * Kept as a thin wrapper around `evictExpiredInStore` (issue #12) so
 * existing callers and the boot-guard / every-25-writes trigger
 * contract do not need to change.
 */
export function evictExpiredReadCache(): Promise<number> {
    return evictExpiredInStore(READ_CACHE_STORE);
}

/**
 * Scan REFERENCE_STORE and delete every record whose
 * cachedAt + ttlMs < Date.now() using the record's own ttlMs.
 * Bounded at MAX_EVICTIONS_PER_PASS deletions per call. Best-effort.
 *
 * Thin wrapper around `evictExpiredInStore` (issue #12).
 */
export function evictExpiredReferenceData(): Promise<number> {
    return evictExpiredInStore(REFERENCE_STORE);
}

// ─── Eviction triggers (Task 10) ──────────────────────────────────────
//
// Two best-effort helpers wire `evictExpiredReadCache` + `evictExpiredReferenceData`
// into the four user-facing triggers called out in the offline-cache-every-role
// spec (boot guard, every-25-writes, sync completion, user-switch):
//
//   - `incrementCacheWriteCount()` is called after every successful cache write
//     in `offlineBase.offlineAware` / `offlineAwareReference`. Once the counter
//     crosses the threshold, both eviction passes run and the counter resets.
//
//   - `maybePruneCaches()` is called on app boot (LayoutShell mount) and after
//     every successful sync-completion event. A localStorage timestamp
//     (`wims:cachePruneAt`) ensures the boot guard fires at most once per hour.
//
// The user-switch trigger is handled inside `setActiveOfflineUser` (T1) via
// `clearReferenceDataForUser` — see the pushback-P1 paragraph there.
//
// All failures are caught and warned — eviction must never break the caller.

const CACHE_WRITE_COUNT_LS_KEY = 'wims:cacheWriteCount';
const CACHE_PRUNE_AT_LS_KEY = 'wims:cachePruneAt';
const CACHE_WRITE_PRUNE_THRESHOLD = 25;
const CACHE_PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function safeLocalStorageGet(key: string): string | null {
    try {
        return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    } catch {
        return null; // private mode / disabled storage
    }
}

function safeLocalStorageSet(key: string, value: string): void {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(key, value);
        }
    } catch {
        // private mode / disabled storage — best-effort, never block
    }
}

/**
 * Best-effort wrapper around the read+reference eviction pair. Each call is
 * isolated in its own try/catch so one failing store cannot prevent the other
 * from running. Failures are warned (dev only) but never re-thrown.
 */
async function runBothEvictions(): Promise<void> {
    try {
        await evictExpiredReadCache();
    } catch (err) {
        devWarn('[offlineStore] evictExpiredReadCache (trigger) failed:', err);
    }
    try {
        await evictExpiredReferenceData();
    } catch (err) {
        devWarn('[offlineStore] evictExpiredReferenceData (trigger) failed:', err);
    }
}

/**
 * Increment the write counter (stored at `wims:cacheWriteCount`). On hitting
 * `CACHE_WRITE_PRUNE_THRESHOLD` (25), reset the counter to 0 and run both
 * eviction passes best-effort. Called from `offlineBase.offlineAware` and
 * `offlineAwareReference` after every successful cache write.
 *
 * Best-effort: a failing read of the counter or a failing setItem is silently
 * absorbed (no-op). A failing eviction is caught inside `runBothEvictions`
 * and does not propagate. The counter is reset to 0 in all cases once the
 * threshold is reached, so a transient eviction failure does not re-fire the
 * prune on the very next write.
 */
export async function incrementCacheWriteCount(): Promise<void> {
    const raw = safeLocalStorageGet(CACHE_WRITE_COUNT_LS_KEY);
    const current = raw == null ? 0 : Number.parseInt(raw, 10);
    const next = (Number.isFinite(current) ? current : 0) + 1;
    safeLocalStorageSet(CACHE_WRITE_COUNT_LS_KEY, String(next));

    if (next >= CACHE_WRITE_PRUNE_THRESHOLD) {
        // Reset BEFORE the eviction call so a slow or failing eviction does not
        // cause the next write to also be at 25. Best-effort set.
        safeLocalStorageSet(CACHE_WRITE_COUNT_LS_KEY, '0');
        await runBothEvictions();
    }
}

/**
 * Boot-guard / sync-completion prune. Reads `wims:cachePruneAt` (default 0).
 * If the timestamp is older than `CACHE_PRUNE_INTERVAL_MS` (1h) — or absent —
 * run both eviction passes best-effort and stamp the current time.
 *
 * Best-effort: a missing/invalid timestamp is treated as "never pruned". A
 * failing eviction does not propagate (caught in `runBothEvictions`).
 */
export async function maybePruneCaches(): Promise<void> {
    const raw = safeLocalStorageGet(CACHE_PRUNE_AT_LS_KEY);
    const last = raw == null ? 0 : Number.parseInt(raw, 10);
    const lastValid = Number.isFinite(last) ? last : 0;

    if (Date.now() - lastValid <= CACHE_PRUNE_INTERVAL_MS) {
        return;
    }

    safeLocalStorageSet(CACHE_PRUNE_AT_LS_KEY, String(Date.now()));
    await runBothEvictions();
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
    // Validate payload before encrypting (D10). Errors propagate to the UI
    // hook layer (offlineRegionalActions wraps queueOfflineOp in try/catch).
    if (op.operation === 'create' || op.operation === 'update') {
        validateOfflinePayload({ operation: op.operation, payload: op.payload }, "encrypt");
    }
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
    if (!existing) {
        await tx.done;
        throw new Error('Operation not found — it may have been cancelled, deleted, or already synced.');
    }
    if (existing.syncStatus !== 'pending') {
        await tx.done;
        throw new Error(
            `Operation cannot be edited right now (status: ${existing.syncStatus}). ` +
            'Only pending operations can be modified. If it is syncing, wait for sync to complete.'
        );
    }
    // Validate payload before encrypting (D10). Errors propagate to the UI
    // hook layer (offlineRegionalActions wraps updateOfflineOp in try/catch).
    if (existing.operation === 'create' || existing.operation === 'update') {
        validateOfflinePayload({ operation: existing.operation, payload }, "encrypt");
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
 * Get all ops in 'failed' state for this encoder — these have hit the retry ceiling.
 */
export async function getFailedOps(encoderId: string): Promise<OfflineOpDecrypted[]> {
    const db = await getDB();
    const all: OfflineOp[] = await db.getAllFromIndex(OPS_STORE, 'by_encoder', encoderId);
    const failed = all.filter((op) => op.syncStatus === 'failed');
    const result: OfflineOpDecrypted[] = [];
    for (const op of failed) {
        const payload = await decryptPayload<Record<string, unknown>>(op.payload);
        result.push({ ...op, payload });
    }
    return result;
}

/**
 * Typed offline queue counts broken down by status bucket.
 *
 * `pendingCount` = syncable ops (pending + error)
 * `failedCount`  = hit retry ceiling
 * `conflictCount`= needs user resolution
 * `totalActionableCount` = sum of all three
 *
 * Excludes `draft`, `synced`, and `syncing`.
 */
export interface OfflineOpsCounts {
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  totalActionableCount: number;
}

/**
 * Count of pending + error syncable ops for this encoder.
 * Does NOT include conflict or failed — use getOfflineOpsCounts for the full breakdown.
 */
export async function getPendingOpsCount(encoderId: string): Promise<number> {
    const db = await getDB();
    const all: OfflineOp[] = await db.getAllFromIndex(OPS_STORE, 'by_encoder', encoderId);
    return all.filter(
        (op) => op.syncStatus === 'pending' || op.syncStatus === 'error'
    ).length;
}

/**
 * Returns separate pending, failed, and conflict counts for the encoder.
 * Call this instead of getPendingOpsCount when you need the full breakdown.
 */
export async function getOfflineOpsCounts(encoderId: string): Promise<OfflineOpsCounts> {
    const db = await getDB();
    const all: OfflineOp[] = await db.getAllFromIndex(OPS_STORE, 'by_encoder', encoderId);
    let pendingCount = 0;
    let failedCount = 0;
    let conflictCount = 0;
    for (const op of all) {
        if (op.syncStatus === 'pending' || op.syncStatus === 'error') {
            pendingCount++;
        } else if (op.syncStatus === 'failed') {
            failedCount++;
        } else if (op.syncStatus === 'conflict') {
            conflictCount++;
        }
    }
    return {
        pendingCount,
        failedCount,
        conflictCount,
        totalActionableCount: pendingCount + failedCount + conflictCount,
    };
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
 * Mark an op as permanently failed after exhausting all retries.
 */
export async function markOpFailed(
    localId: string,
    errorCode: OfflineErrorCode,
    errorMessage: string
): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(OPS_STORE, 'readwrite');
    const store = tx.objectStore(OPS_STORE);
    const op: OfflineOp | undefined = await store.get(localId);
    if (op) {
        op.syncStatus = 'failed';
        op.errorCode = errorCode;
        op.errorMessage = errorMessage;
        // retryCount already at MAX_RETRY ceiling — don't double-increment
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

/**
 * Reset a failed op back to 'pending' for retry — preserves the original
 * encrypted payload so the sync engine replays the same operation.
 * Unlike resolveConflictOp, this does not replace the payload.
 */
export async function resetFailedOp(localId: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(OPS_STORE, 'readwrite');
    const store = tx.objectStore(OPS_STORE);
    const op: OfflineOp | undefined = await store.get(localId);
    if (op) {
        op.syncStatus = 'pending';
        op.errorCode = null;
        op.errorMessage = null;
        op.serverVersion = null;
        op.retryCount = 0;
        op.lastAttemptAt = null;
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

/**
 * Get all unsynced create ops for an encoder as displayable draft summaries.
 * Includes draft, pending, error, and failed statuses — any create op that
 * hasn't been confirmed by the server yet. Sorted newest first.
 * Used to show locally-created incidents in the drafts list while offline.
 */
export async function getDraftOpsForEncoder(encoderId: string): Promise<OfflineOpDecrypted[]> {
    const db = await getDB();
    const all: OfflineOp[] = await db.getAllFromIndex(OPS_STORE, 'by_encoder', encoderId);
    const unsynced = all
        .filter(
            (op) =>
                op.operation === 'create' &&
                (['draft', 'pending', 'error', 'failed'] as OfflineSyncStatus[]).includes(op.syncStatus),
        )
        .sort((a, b) => b.createdAt - a.createdAt);
    const result: OfflineOpDecrypted[] = [];
    for (const op of unsynced) {
        try {
            const payload = await decryptPayload<Record<string, unknown>>(op.payload);
            result.push({ ...op, payload });
        } catch {
            // Skip ops with decryption failures (e.g. key mismatch after device wipe)
        }
    }
    return result;
}

/**
 * Reconstruct a partial incident detail object from a locally-queued create op.
 * Used as a third fallback when fetchRegionalIncidentOfflineAware returns null
 * and the incident hasn't been synced to the server yet.
 * Returns null if no matching op is found for this localId.
 */
export async function getOfflineOpAsIncidentDetail(
    localId: string,
    encoderId: string,
): Promise<{ data: Record<string, unknown>; isLocalDraft: true } | null> {
    const db = await getDB();
    const all: OfflineOp[] = await db.getAllFromIndex(OPS_STORE, 'by_encoder', encoderId);
    const op = all.find((o) => o.localId === localId && o.operation === 'create');
    if (!op) return null;
    try {
        const payload = await decryptPayload<Record<string, unknown>>(op.payload);
        return {
            data: {
                ...payload,
                _localId: localId,
                _syncStatus: op.syncStatus,
                _queuedAt: op.createdAt,
            },
            isLocalDraft: true,
        };
    } catch {
        return null;
    }
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
export async function getCachedIncident(serverId: number, encoderId: string): Promise<CachedIncidentDecrypted | undefined> {
    const db = await getDB();
    const item: CachedIncident | undefined = await db.get(CACHE_STORE, serverId);
    if (!item) return undefined;
    if (item.encoderId !== encoderId) return undefined;
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
 * Clear the entire read cache, encrypted analytics cache, and plaintext
 * reference cache regardless of which encoder keyed them. Used on logout
 * for shared-device privacy: cached incident PII, the encrypted read cache,
 * and the plaintext reference cache must not linger for the next user.
 * Pending offline ops (offlineOps) are deliberately preserved — they are
 * encrypted and encoder-scoped, so unsynced work survives a re-login
 * instead of being silently dropped.
 *
 * Issue #2: prior version only cleared CACHE_STORE, leaving the plaintext
 * REFERENCE_STORE on disk for the next user to read. This version clears
 * all three (CACHE_STORE, READ_CACHE_STORE, REFERENCE_STORE).
 */
export async function clearAllCachedIncidents(): Promise<void> {
    const db = await getDB();
    await db.clear(CACHE_STORE);
    await db.clear(READ_CACHE_STORE);
    await db.clear(REFERENCE_STORE);

}

// ─── Public Offline Operations API (publicOfflineOps) — Civilian Phase ────────
//
// Unauthenticated civilians have no per-user key material, so this store is
// plaintext by design (handoff decision #2). The threat model accepts that any
// other script running on the device can read queued civilian submissions; the
// compensating controls are (a) device-bound identity via localStorage and
// (b) server-side device_id + report_id pair validation on append/followup.
//
// A separate store from offlineOps keeps the operational boundary clear: this
// queue is replayed by the public sync engine, which uses credentials: 'omit'
// and never touches the auth session. Reusing offlineOps would force the
// public sync path to inherit the encryption model and encoder-scoped
// invariants that don't apply here (handoff decision #1).

export type PublicOpType = 'submit' | 'append' | 'followup';
export type PublicOpStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'retryable';

export interface PublicOfflineOp {
    localId: string;                       // UUID — idempotency key, also keyPath
    deviceId: string;                      // browser-bound identity (localStorage)
    operation: PublicOpType;
    payload: Record<string, unknown>;      // plaintext — see threat model note above
    linkedLocalId: string | null;          // append/followup → parent submit's localId
    serverId: number | null;               // assigned by the sync engine on success
    createdAt: number;
    status: PublicOpStatus;
    errorCode: string | null;
    errorMessage: string | null;
    retryCount: number;
    lastAttemptAt: number | null;
}

/**
 * Queue a new public offline op. Plaintext storage is intentional — see
 * module-level comment. The localId MUST be a UUID generated by the caller
 * (the wrapper layer does this via crypto.randomUUID()).
 */
export async function queuePublicOfflineOp(op: PublicOfflineOp): Promise<void> {
    const db = await getDB();
    await db.put(PUBLIC_OPS_STORE, op);
}

/**
 * Get all pending ops for a given deviceId, sorted oldest first so the sync
 * engine processes them in the same order the user created them. Includes
 * 'retryable' (transient 5xx / network) ops that the sync engine can replay.
 */
export async function getPendingPublicOps(deviceId: string): Promise<PublicOfflineOp[]> {
    const db = await getDB();
    const all: PublicOfflineOp[] = await db.getAllFromIndex(PUBLIC_OPS_STORE, 'by_deviceId', deviceId);
    return all
        .filter((op) => op.status === 'pending' || op.status === 'retryable')
        .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Get a single public op by localId. Returns undefined when not present.
 */
export async function getPublicOp(localId: string): Promise<PublicOfflineOp | undefined> {
    const db = await getDB();
    return (await db.get(PUBLIC_OPS_STORE, localId)) as PublicOfflineOp | undefined;
}

/**
 * Mark a public op as successfully synced, storing the serverId so dependent
 * ops (append, followup) can resolve their parent.
 */
export async function markPublicOpSynced(localId: string, serverId: number): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(PUBLIC_OPS_STORE, 'readwrite');
    const store = tx.objectStore(PUBLIC_OPS_STORE);
    const op: PublicOfflineOp | undefined = await store.get(localId);
    if (op) {
        op.status = 'synced';
        op.serverId = serverId;
        op.errorCode = null;
        op.errorMessage = null;
        await store.put(op);
    }
    await tx.done;
}

const PUBLIC_MAX_RETRY = 5;

/**
 * Mark a public op as failed. Retries up to PUBLIC_MAX_RETRY times before
 * transitioning to a permanent 'failed' status — beyond which the user must
 * explicitly re-submit. The sync engine records the failure reason in
 * errorCode/errorMessage for the hook layer to surface as a notification.
 */
export async function markPublicOpFailed(
    localId: string,
    errorCode: string,
    errorMessage: string
): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(PUBLIC_OPS_STORE, 'readwrite');
    const store = tx.objectStore(PUBLIC_OPS_STORE);
    const op: PublicOfflineOp | undefined = await store.get(localId);
    if (op) {
        op.retryCount += 1;
        op.lastAttemptAt = Date.now();
        op.errorCode = errorCode;
        op.errorMessage = errorMessage;
        // Mark permanently failed once the retry ceiling is reached.
        op.status = op.retryCount >= PUBLIC_MAX_RETRY ? 'failed' : 'retryable';
        await store.put(op);
    }
    await tx.done;
}

/**
 * Mark a public op as currently syncing. The sync engine calls this before each
 * HTTP attempt so a stale-sync recovery (similar to recoverStaleSyncingOps) can
 * re-arm ops stuck in this state from a previous tab close.
 */
export async function markPublicOpSyncing(localId: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(PUBLIC_OPS_STORE, 'readwrite');
    const store = tx.objectStore(PUBLIC_OPS_STORE);
    const op: PublicOfflineOp | undefined = await store.get(localId);
    if (op) {
        op.status = 'syncing';
        op.lastAttemptAt = Date.now();
        await store.put(op);
    }
    await tx.done;
}

/**
 * Find all ops linked to a given submit's localId, sorted by createdAt ascending.
 * Used by the sync engine to resolve the dependency chain: a submit that
 * succeeds assigns serverId=N; subsequent append/followup ops with
 * linkedLocalId=<submit.localId> then PATCH against /reports/N/...
 */
export async function getLinkedPublicOp(linkedLocalId: string): Promise<PublicOfflineOp[]> {
    const db = await getDB();
    const all: PublicOfflineOp[] = await db.getAll(PUBLIC_OPS_STORE);
    return all
        .filter((op) => op.linkedLocalId === linkedLocalId)
        .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Delete synced ops older than retentionMs (default 7 days). Called after a
 * successful sync batch to cap storage growth on long-running browsers.
 */
export async function purgeSyncedPublicOps(retentionMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    const db = await getDB();
    const cutoff = Date.now() - retentionMs;
    const all: PublicOfflineOp[] = await db.getAll(PUBLIC_OPS_STORE);
    const tx = db.transaction(PUBLIC_OPS_STORE, 'readwrite');
    const store = tx.objectStore(PUBLIC_OPS_STORE);
    for (const op of all) {
        if (op.status === 'synced' && op.createdAt < cutoff) {
            await store.delete(op.localId);
        }
    }
    await tx.done;
}

/**
 * Count pending+retryable ops for the deviceId, for the "queued reports" badge.
 */
export async function getPendingPublicOpsCount(deviceId: string): Promise<number> {
    const db = await getDB();
    const all: PublicOfflineOp[] = await db.getAllFromIndex(PUBLIC_OPS_STORE, 'by_deviceId', deviceId);
    return all.filter((op) => op.status === 'pending' || op.status === 'retryable').length;
}
