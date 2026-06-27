/**
 * offlineEnable — explicit "Enable offline mode" preparation flow (item E10).
 *
 * Supersedes the ad-hoc router.prefetch + eager-import approach with a single,
 * user-triggered action that:
 *   1. Pre-fetches the navigation routes the encoder needs offline (RSC + chunks).
 *   2. Warms the heavy JS chunks (manual entry form, wildland form, map) so the
 *      service worker / browser HTTP cache holds them.
 *   3. Pre-populates the encrypted IndexedDB cache with the encoder's incident
 *      list AND a capped batch of full incident details, so dashboards and
 *      detail/edit views work offline without a prior manual visit.
 *
 * The previous prefetch/import calls remain in place as a passive fallback.
 */

import {
  fetchRegionalIncidentsOfflineAware,
  fetchRegionalIncidentOfflineAware,
} from './api/offlineRegional';
import { getConnectivitySnapshot } from './connectivity';
import {
  isOfflineModeEnabled,
  markOfflineModeEnabled,
  clearOfflineModeEnabled,
} from './offlineModeFlags';

// Cap how many full detail records we pull so enabling offline mode stays quick
// and doesn't hammer the API. List items are always cached (cheap); details are
// the expensive part.
const DETAIL_CACHE_CAP = 40;
const LIST_FETCH_LIMIT = 100;

export interface OfflineEnableProgress {
  step: string;
  done: number;
  total: number;
  /** High-level phase name (e.g. 'pages', 'chunks', 'list', 'details'). */
  phase?: string;
  /** Human-readable description of the current sub-step. */
  currentLabel?: string;
}

export interface OfflineEnableResult {
  ok: boolean;
  cachedDetails: number;
  cachedList: number;
  error?: string;
}

// Flag helpers (isOfflineModeEnabled, markOfflineModeEnabled, clearOfflineModeEnabled)
// imported from offlineModeFlags to avoid circular dependency.

/**
 * Download the JS chunks needed for offline encoding. Resolving these import()
 * calls forces Next.js to fetch the chunks, which the service worker then caches
 * under /_next/static (cache-first).
 */
async function warmChunks(): Promise<void> {
  await Promise.allSettled([
    import('@/components/IncidentForm'),
    import('@/components/MapPicker'),
    import('@/components/MapPickerInner'),
  ]);
}

/**
 * Run the full offline-enable preparation. Must be online.
 *
 * @param encoderId Current encoder's keycloak sub/id (cache is per-user scoped).
 * @param opts.prefetch Optional Next router.prefetch passthrough (for RSC nav).
 * @param opts.onProgress Optional progress callback for UI.
 */
export async function enableOfflineMode(
  encoderId: string,
  opts: {
    prefetch?: (href: string) => void;
    onProgress?: (p: OfflineEnableProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<OfflineEnableResult> {
  const { prefetch, onProgress, signal } = opts;

  if (!encoderId) {
    return { ok: false, cachedDetails: 0, cachedList: 0, error: 'No active encoder session.' };
  }
  if (signal?.aborted) {
    return { ok: false, cachedDetails: 0, cachedList: 0, error: 'Offline setup cancelled.' };
  }
  if (!getConnectivitySnapshot().isOnline) {
    return { ok: false, cachedDetails: 0, cachedList: 0, error: 'You must be online to enable offline mode.' };
  }

  try {
    // 1. Pre-cache navigation routes (RSC payloads + page shells).
    onProgress?.({ step: 'Preparing pages…', phase: 'pages', done: 0, total: 1 });
    if (signal?.aborted) throwCancelled();
    prefetch?.('/afor/create');
    prefetch?.('/afor/import');
    prefetch?.('/dashboard/regional');
    prefetch?.('/dashboard/regional/audit');

    // 2. Warm the heavy form/map chunks.
    onProgress?.({ step: 'Downloading encoding forms…', phase: 'chunks', done: 0, total: 1 });
    if (signal?.aborted) throwCancelled();
    await warmChunks();

    // 3. Populate the incident list cache (writes every list item to IndexedDB).
    onProgress?.({ step: 'Downloading your incidents…', phase: 'list', done: 0, total: 1 });
    if (signal?.aborted) throwCancelled();
    const { response } = await fetchRegionalIncidentsOfflineAware(
      { limit: LIST_FETCH_LIMIT, offset: 0 },
      encoderId,
    );
    const items = response.items ?? [];

    // 4. Pull full detail for a capped batch so detail/edit views work offline.
    const ids = items.slice(0, DETAIL_CACHE_CAP).map((i) => i.incident_id);

    // Prefetch ONE real incident-detail route so the service worker caches the
    // detail page shell + RSC under its canonical key. Because all incident-detail
    // URLs share one canonical SW key, this makes every incident — including
    // offline-created local UUIDs — navigable offline.
    if (ids.length > 0) prefetch?.(`/dashboard/regional/incidents/${ids[0]}`);

    let done = 0;
    for (const id of ids) {
      if (signal?.aborted) throwCancelled();
      try {
        await fetchRegionalIncidentOfflineAware(id, encoderId);
      } catch {
        // Skip individual failures — partial caching is still useful.
      }
      done += 1;
      onProgress?.({
        step: 'Caching incident details…',
        phase: 'details',
        currentLabel: `Incident #${id}`,
        done,
        total: ids.length,
      });
    }

    markOfflineModeEnabled();
    return { ok: true, cachedDetails: ids.length, cachedList: items.length };
  } catch (e: unknown) {
    // AbortError is intentional — return clean result, not a re-throw.
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { ok: false, cachedDetails: 0, cachedList: 0, error: 'Offline setup cancelled.' };
    }
    return {
      ok: false,
      cachedDetails: 0,
      cachedList: 0,
      error: e instanceof Error ? e.message : 'Failed to enable offline mode.',
    };
  }
}

/** Throws AbortError when the user cancels. */
function throwCancelled(): never {
  throw new DOMException('The operation was aborted.', 'AbortError');
}
