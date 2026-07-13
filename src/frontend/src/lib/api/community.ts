import { ApiParseError } from '@/lib/validation';
import { publicApiFetch } from './public-transport';

export type CommunityLanguage = 'en' | 'uk';
export type CommunityContentType = 'SAFETY_ARTICLE' | 'ANNOUNCEMENT' | 'EVENT';

export interface CommunityContentItem {
  content_id: string;
  slug: string;
  content_type: CommunityContentType;
  title: string;
  body: string;
  language: CommunityLanguage;
  urgent_banner: boolean;
  expires_at: string | null;
  metadata_json: Record<string, unknown> | null;
  last_reviewed_at: string | null;
  updated_at: string | null;
}

export interface CommunityHubResponse {
  items: CommunityContentItem[];
  urgent_banner: CommunityContentItem | null;
}

export interface CommunityContentDetailResponse {
  item: CommunityContentItem;
}

export function fetchCommunityHub(options: {
  language?: CommunityLanguage;
  type?: CommunityContentType;
} = {}): Promise<CommunityHubResponse> {
  const params = new URLSearchParams({ language: options.language ?? 'en' });
  if (options.type) params.set('type', options.type);
  return publicApiFetch<unknown>(`/community/hub?${params.toString()}`).then(parseHubResponse);
}

export function fetchCommunityContent(
  slug: string,
  language: CommunityLanguage = 'en',
): Promise<CommunityContentDetailResponse> {
  return publicApiFetch<unknown>(
    `/community/${encodeURIComponent(slug)}?language=${language}`,
  ).then(parseDetailResponse);
}

function parseHubResponse(value: unknown): CommunityHubResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) return invalidResponse();
  const items = value.items.map(parseItem);
  const urgentBanner = value.urgent_banner === null ? null : parseItem(value.urgent_banner);
  return { items, urgent_banner: urgentBanner };
}

function parseDetailResponse(value: unknown): CommunityContentDetailResponse {
  if (!isRecord(value) || !('item' in value)) return invalidResponse();
  return { item: parseItem(value.item) };
}

function parseItem(value: unknown): CommunityContentItem {
  if (!isRecord(value)) return invalidResponse();
  const contentType = value.content_type;
  const language = value.language;
  if (
    typeof value.content_id !== 'string' || typeof value.slug !== 'string'
    || (contentType !== 'SAFETY_ARTICLE' && contentType !== 'ANNOUNCEMENT' && contentType !== 'EVENT')
    || (language !== 'en' && language !== 'uk')
    || typeof value.title !== 'string' || typeof value.body !== 'string'
    || typeof value.urgent_banner !== 'boolean'
    || !isNullableTimestamp(value.expires_at)
    || !isNullableMetadata(value.metadata_json)
    || !isNullableTimestamp(value.last_reviewed_at)
    || !isNullableTimestamp(value.updated_at)
  ) return invalidResponse();
  return {
    content_id: value.content_id,
    slug: value.slug,
    content_type: contentType,
    title: value.title,
    body: value.body,
    language,
    urgent_banner: value.urgent_banner,
    expires_at: value.expires_at,
    metadata_json: value.metadata_json,
    last_reviewed_at: value.last_reviewed_at,
    updated_at: value.updated_at,
  };
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

function isNullableMetadata(value: unknown): value is Record<string, unknown> | null {
  return value === null || isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(): never {
  throw new ApiParseError('Invalid community API response shape', 200);
}
