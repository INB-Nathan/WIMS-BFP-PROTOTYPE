import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './transport';
import { archiveCommunityContent, createCommunityDraft, fetchAdminCommunityContent, publishCommunityContent, updateCommunityDraft } from './adminCommunity';

vi.mock('./transport', () => ({ apiFetch: vi.fn() }));

describe('admin community API client', () => {
  beforeEach(() => vi.mocked(apiFetch).mockResolvedValue({ content_id: 'c1', lifecycle_status: 'DRAFT' }));
  it('fetches the typed admin list response', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce([{
      content_id: 'c1', slug: 'safety', content_type: 'SAFETY_ARTICLE', lifecycle_status: 'DRAFT',
      title_en: 'Title', title_uk: null, body_en: 'Body', body_uk: null, metadata_json: null,
      expires_at: null, urgent_banner: false, last_reviewed_at: null, row_version: 1,
    }]);
    await expect(fetchAdminCommunityContent()).resolves.toMatchObject([{ content_id: 'c1', lifecycle_status: 'DRAFT' }]);
    expect(apiFetch).toHaveBeenCalledWith('/admin/community');
  });

  it('uses authenticated admin lifecycle URLs and JSON payloads', async () => {
    const payload = { content_type: 'EVENT' as const, title_en: 'Title', body_en: 'Body' };
    await createCommunityDraft(payload);
    expect(apiFetch).toHaveBeenCalledWith('/admin/community', expect.objectContaining({ method: 'POST', body: JSON.stringify(payload) }));
    await updateCommunityDraft('c 1', { title_en: 'Updated' });
    expect(apiFetch).toHaveBeenCalledWith('/admin/community/c%201', expect.objectContaining({ method: 'PATCH' }));
    await publishCommunityContent('c1', { title_en: 'Title', body_en: 'Body' });
    expect(apiFetch).toHaveBeenCalledWith('/admin/community/c1/publish', expect.objectContaining({ method: 'POST' }));
    await archiveCommunityContent('c1');
    expect(apiFetch).toHaveBeenCalledWith('/admin/community/c1/archive', expect.objectContaining({ method: 'POST' }));
  });
});
