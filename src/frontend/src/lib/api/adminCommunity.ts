import { ApiParseError } from '@/lib/validation';
import { apiFetch } from './transport';
import type { CommunityContentType } from './community';

export interface CommunityContentDraft {
  content_id: string;
  lifecycle_status: string;
  content_type: CommunityContentType;
  title_en: string;
  body_en: string;
  title_uk?: string | null;
  body_uk?: string | null;
  metadata_json?: Record<string, unknown> | null;
  slug?: string | null;
  expires_at?: string | null;
  urgent_banner?: boolean;
  last_reviewed_at?: string | null;
  row_version?: number;
}

export interface CommunityContentAdminItem extends CommunityContentDraft {
  slug: string;
  title_uk: string | null;
  body_uk: string | null;
  metadata_json: Record<string, unknown> | null;
  expires_at: string | null;
  urgent_banner: boolean;
  last_reviewed_at: string | null;
  row_version: number;
}

export interface CommunityDraftPayload {
  content_type: CommunityContentType;
  title_en: string;
  body_en: string;
  title_uk?: string | null;
  body_uk?: string | null;
  metadata_json?: Record<string, unknown> | null;
  slug?: string | null;
  expires_at?: string | null;
  urgent_banner?: boolean;
  last_reviewed_at?: string | null;
}

export interface CommunityActionResponse {
  content_id: string;
  lifecycle_status: string;
}

export function fetchAdminCommunityContent(): Promise<CommunityContentAdminItem[]> {
  return apiFetch<unknown>('/admin/community').then(parseAdminContentResponse);
}

function parseAdminContentResponse(value: unknown): CommunityContentAdminItem[] {
  if (!Array.isArray(value)) throw new ApiParseError('Invalid admin community API response shape', 200);
  return value.map((item) => {
    if (!isRecord(item)
      || typeof item.content_id !== 'string'
      || typeof item.slug !== 'string'
      || typeof item.lifecycle_status !== 'string'
      || (item.content_type !== 'SAFETY_ARTICLE' && item.content_type !== 'ANNOUNCEMENT' && item.content_type !== 'EVENT')
      || typeof item.title_en !== 'string' || typeof item.body_en !== 'string'
      || (item.title_uk !== null && typeof item.title_uk !== 'string')
      || (item.body_uk !== null && typeof item.body_uk !== 'string')
      || (item.metadata_json !== null && !isRecord(item.metadata_json))
      || (item.expires_at !== null && typeof item.expires_at !== 'string')
      || typeof item.urgent_banner !== 'boolean'
      || (item.last_reviewed_at !== null && typeof item.last_reviewed_at !== 'string')
      || typeof item.row_version !== 'number') {
      throw new ApiParseError('Invalid admin community API response shape', 200);
    }
    return item as unknown as CommunityContentAdminItem;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createCommunityDraft(payload: CommunityDraftPayload) {
  return apiFetch<{ content_id: string; lifecycle_status: string }>('/admin/community', {
    method: 'POST', body: JSON.stringify(payload),
  });
}

export function updateCommunityDraft(contentId: string, payload: Partial<Omit<CommunityDraftPayload, 'content_type'>>) {
  return apiFetch<CommunityActionResponse>(`/admin/community/${encodeURIComponent(contentId)}`, {
    method: 'PATCH', body: JSON.stringify(payload),
  });
}

export function publishCommunityContent(contentId: string, payload: Omit<CommunityDraftPayload, 'content_type' | 'slug'>) {
  return apiFetch<CommunityActionResponse>(`/admin/community/${encodeURIComponent(contentId)}/publish`, {
    method: 'POST', body: JSON.stringify(payload),
  });
}

export function archiveCommunityContent(contentId: string) {
  return apiFetch<CommunityActionResponse>(`/admin/community/${encodeURIComponent(contentId)}/archive`, {
    method: 'POST', body: JSON.stringify({}),
  });
}
