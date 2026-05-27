/**
 * Regional incident list filters & pagination helpers (frontend).
 * Category/status values align with backend `GET /api/regional/incidents` (see `api/routes/regional.py`)
 * and DB constraints in `src/postgres-init/01_wims_initial.sql`.
 */

/** Matches regional stats / `incident_nonsensitive_details.general_category` buckets used in the UI. */
export const REGIONAL_INCIDENT_GENERAL_CATEGORIES = [
  'STRUCTURAL',
  'NON_STRUCTURAL',
  'VEHICULAR',
] as const;

/** `wims.fire_incidents.verification_status` CHECK constraint. */
export const REGIONAL_VERIFICATION_STATUSES = [
  'DRAFT',
  'PENDING',
  'VERIFIED',
  'REJECTED',
] as const;

export const REGIONAL_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
export type RegionalPageSize = (typeof REGIONAL_PAGE_SIZE_OPTIONS)[number];

export interface RegionalIncidentsQueryParams {
  limit?: number;
  offset?: number;
  category?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  date_basis?: 'modified' | 'fire';
}

/** Builds query string for `GET /api/regional/incidents` (omits empty/undefined filters). */
export function buildRegionalIncidentsQueryString(params: RegionalIncidentsQueryParams): string {
  const search = new URLSearchParams();
  if (params.limit != null) search.set('limit', String(params.limit));
  if (params.offset != null) search.set('offset', String(params.offset));
  const cat = params.category?.trim();
  if (cat) search.set('category', cat);
  const st = params.status?.trim();
  if (st) search.set('status', st);
  const dateFrom = params.date_from?.trim();
  if (dateFrom) search.set('date_from', dateFrom);
  const dateTo = params.date_to?.trim();
  if (dateTo) search.set('date_to', dateTo);
  if (params.date_basis) search.set('date_basis', params.date_basis);
  return search.toString();
}

export function clampRegionalPageSize(n: number): RegionalPageSize {
  if (n === 25 || n === 50) return n;
  return 10;
}

export function offsetFromPage(pageIndex0: number, pageSize: number): number {
  const p = Math.max(0, Math.floor(Number.isFinite(pageIndex0) ? pageIndex0 : 0));
  const s = clampRegionalPageSize(pageSize);
  return p * s;
}

/** Minimum 1 page (empty result still shows one “page”). */
export function totalRegionalPages(total: number, pageSize: number): number {
  const s = clampRegionalPageSize(pageSize);
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(total / s));
}
