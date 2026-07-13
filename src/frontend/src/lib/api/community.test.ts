import { describe, expect, it, vi } from 'vitest';
import { fetchCommunityContent, fetchCommunityHub } from './community';
import { publicApiFetch } from './public-transport';

vi.mock('./public-transport', () => ({ publicApiFetch: vi.fn() }));

const validItem = {
  content_id: '1', slug: 'fire-safety', content_type: 'EVENT', title: 'Fire safety', body: 'Keep exits clear',
  language: 'en', urgent_banner: false, expires_at: null, metadata_json: null,
  last_reviewed_at: null, updated_at: null,
};

describe('community API client', () => {
  it('uses the public transport and parses the response contract', async () => {
    vi.mocked(publicApiFetch).mockResolvedValue({ items: [validItem], urgent_banner: null });
    const hub = await fetchCommunityHub({ language: 'uk', type: 'EVENT' });
    expect(publicApiFetch).toHaveBeenCalledWith('/community/hub?language=uk&type=EVENT');
    expect(hub.items[0]).toMatchObject({ content_type: 'EVENT', language: 'en', title: 'Fire safety' });

    vi.mocked(publicApiFetch).mockResolvedValue({ item: validItem });
    const detail = await fetchCommunityContent('fire safety', 'en');
    expect(publicApiFetch).toHaveBeenCalledWith('/community/fire%20safety?language=en');
    expect(detail.item.content_id).toBe('1');
  });

  it('preserves valid optional fields', async () => {
    const item = {
      ...validItem,
      expires_at: '2026-07-12T12:00:00Z',
      metadata_json: { source: 'public-hub', tags: ['fire'] },
      last_reviewed_at: '2026-07-11T12:00:00+00:00',
      updated_at: '2026-07-12T12:00:00.000Z',
    };
    vi.mocked(publicApiFetch).mockResolvedValue({ items: [item], urgent_banner: null });
    await expect(fetchCommunityHub()).resolves.toEqual({ items: [item], urgent_banner: null });
  });

  it.each([
    ['expires_at', { expires_at: 'not-a-timestamp' }],
    ['expires_at', { expires_at: 123 }],
    ['metadata_json', { metadata_json: 'not-an-object' }],
    ['metadata_json', { metadata_json: [] }],
    ['last_reviewed_at', { last_reviewed_at: {} }],
    ['updated_at', { updated_at: 'not-a-timestamp' }],
  ])('rejects malformed optional field %s', async (_field, override) => {
    vi.mocked(publicApiFetch).mockResolvedValue({
      items: [{ ...validItem, ...override }],
      urgent_banner: null,
    });
    await expect(fetchCommunityHub()).rejects.toThrow('Invalid community API response shape');
  });

  it('rejects malformed required and literal fields', async () => {
    vi.mocked(publicApiFetch).mockResolvedValue({ items: [{ ...validItem, language: 'de' }] });
    await expect(fetchCommunityHub()).rejects.toThrow('Invalid community API response shape');
  });
});
