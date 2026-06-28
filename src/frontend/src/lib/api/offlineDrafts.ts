/**
 * Offline-aware draft list wrapper.
 *
 * Online  → fetch fresh from server, cache result in analytics-cache store.
 * Offline → merge locally-queued unsynced create ops with last cached server result.
 * Network error → fall back to same offline merge path.
 */

import { listEncoderDrafts, type DraftSummary } from './legacy';
import {
  getDraftOpsForEncoder,
  cacheReadResponse,
  getReadCachedResponse,
  type OfflineOpDecrypted,
} from '../offlineStore';
import { getConnectivitySnapshot, markConnectivityOffline } from '../connectivity';
import { isNetworkError } from './offlineBase';

const DRAFT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

export interface LocalDraftItem {
  incident_id: 0;
  localId: string;
  isLocal: true;
  syncStatus: string;
  region_id: number;
  created_at: string | null;
  updated_at: string | null;
  notification_dt: string | null;
  general_category: string | null;
  alarm_level: string | null;
  fire_station_name: string | null;
}

export type AnyDraftItem = DraftSummary | LocalDraftItem;

function opToLocalDraftItem(op: OfflineOpDecrypted): LocalDraftItem {
  return {
    incident_id: 0,
    localId: op.localId,
    isLocal: true,
    syncStatus: op.syncStatus,
    region_id: op.regionId,
    created_at: new Date(op.createdAt).toISOString(),
    updated_at: new Date(op.createdAt).toISOString(),
    notification_dt: (op.payload.notification_dt as string | null) ?? null,
    general_category: (op.payload.general_category as string | null) ?? null,
    alarm_level: (op.payload.alarm_level as string | null) ?? null,
    fire_station_name: (op.payload.fire_station_name as string | null) ?? null,
  };
}

export async function listEncoderDraftsOfflineAware(
  encoderId: string,
  limit: number,
  offset: number,
): Promise<{ items: AnyDraftItem[]; total: number; fromCache: boolean }> {
  const cacheKey = `drafts:${encoderId}:v1`;
  const snap = getConnectivitySnapshot();
  const isOffline = snap.state === 'offline';

  // Always read locally-queued unsynced create ops from IndexedDB (no network needed).
  const localOps = await getDraftOpsForEncoder(encoderId);
  const localItems = localOps.map(opToLocalDraftItem);

  if (isOffline) {
    const cached = await getReadCachedResponse<{ items: DraftSummary[]; total: number }>(cacheKey);
    const serverItems = cached?.data?.items ?? [];
    const combined: AnyDraftItem[] = [...localItems, ...serverItems];
    return { items: combined, total: combined.length, fromCache: true };
  }

  try {
    const result = await listEncoderDrafts(limit, offset);
    void cacheReadResponse(cacheKey, result, DRAFT_CACHE_TTL_MS);
    // Local items first (most recently created offline), then server drafts.
    const combined: AnyDraftItem[] = [...localItems, ...result.items];
    return { items: combined, total: combined.length, fromCache: false };
  } catch (err) {
    if (isNetworkError(err)) {
      markConnectivityOffline();
      const cached = await getReadCachedResponse<{ items: DraftSummary[]; total: number }>(cacheKey);
      const serverItems = cached?.data?.items ?? [];
      const combined: AnyDraftItem[] = [...localItems, ...serverItems];
      return { items: combined, total: combined.length, fromCache: true };
    }
    throw err;
  }
}
