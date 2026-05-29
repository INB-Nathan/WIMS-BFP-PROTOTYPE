/**
 * Geocoding utilities — all calls proxy through the backend (/api/geocode/*)
 * so that fire incident coordinates never leave the server to a third party.
 */

export interface ReverseGeocodeResult {
  barangay: string;
  city: string;
  province: string;
  state: string;
}

export interface GeoSearchResult {
  lat: string;
  lon: string;
  display_name?: string;
  type?: string;
  class?: string;
  address?: Record<string, string>;
}

/**
 * Reverse-geocode a lat/lon to a Philippine address hierarchy.
 * Philippine Nominatim hierarchy:
 *   barangay  → quarter > suburb > village > neighbourhood > hamlet
 *   city/muni → city_district > town > municipality > city (deprioritise addr.city in NCR)
 *   province  → county (province outside NCR)
 *   state     → state (region name, last resort)
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<ReverseGeocodeResult | null> {
  try {
    const res = await fetch(
      `/api/geocode/reverse?lat=${lat}&lon=${lng}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};

    const barangay =
      addr.quarter || addr.suburb || addr.village || addr.neighbourhood || addr.hamlet || '';
    const city =
      addr.city_district || addr.town || addr.municipality ||
      (addr.city && addr.city !== addr.state ? addr.city : '') || '';
    const province = addr.county || '';
    const state = addr.state || '';

    return { barangay, city, province, state };
  } catch {
    return null;
  }
}

/**
 * Forward-geocode an address string. Returns an array of candidates
 * (typically limit=1 for auto-pin, limit=5 for suggestions).
 */
export async function searchGeocode(
  q: string,
  limit = 5,
  addressdetails = 1,
  signal?: AbortSignal,
): Promise<GeoSearchResult[]> {
  try {
    const params = new URLSearchParams({
      q,
      limit: String(limit),
      addressdetails: String(addressdetails),
    });
    const res = await fetch(`/api/geocode/search?${params}`, signal ? { signal } : undefined);
    if (!res.ok) return [];
    return (await res.json()) as GeoSearchResult[];
  } catch {
    return [];
  }
}
