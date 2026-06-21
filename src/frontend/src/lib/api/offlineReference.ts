/**
 * Offline-aware wrappers for unencrypted reference data.
 *
 * Reference data (regions / provinces / cities) is small, public, and changes
 * rarely — so it lives in the unencrypted REFERENCE_STORE keyed by userId
 * (pushback P1 from plan) with a 7-day TTL.
 *
 * Wrappers:
 *   fetchRegionsOfflineAware(userId)
 *   fetchProvincesOfflineAware(userId, regionId)
 *   fetchCitiesOfflineAware(userId, provinceId)
 */
import {
  fetchRegions as legacyFetchRegions,
  fetchProvinces as legacyFetchProvinces,
  fetchCities as legacyFetchCities,
} from './legacy';
import type { Region, Province, City } from './legacy';
import { OfflineResult, offlineAwareReference } from './offlineBase';

const REF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_REF_ERROR =
  'Reference data is unavailable offline. Reconnect to refresh.';

export type OfflineReferenceResult<T> = OfflineResult<T>;

export function fetchRegionsOfflineAware(
  userId: string,
): Promise<OfflineReferenceResult<Region[]>> {
  return offlineAwareReference<Region[]>(
    'regions',
    [],
    'reference',
    REF_TTL_MS,
    userId,
    () => legacyFetchRegions(),
    OFFLINE_REF_ERROR,
  );
}

export function fetchProvincesOfflineAware(
  userId: string,
  regionId: string | number,
): Promise<OfflineReferenceResult<Province[]>> {
  return offlineAwareReference<Province[]>(
    'provinces',
    [regionId],
    'reference',
    REF_TTL_MS,
    userId,
    () => legacyFetchProvinces(regionId),
    OFFLINE_REF_ERROR,
  );
}

export function fetchCitiesOfflineAware(
  userId: string,
  provinceId: string | number,
): Promise<OfflineReferenceResult<City[]>> {
  return offlineAwareReference<City[]>(
    'cities',
    [provinceId],
    'reference',
    REF_TTL_MS,
    userId,
    () => legacyFetchCities(provinceId),
    OFFLINE_REF_ERROR,
  );
}
