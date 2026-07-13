import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiRequestError } from '@/lib/api/errors';
import { fetchCommunityContent } from '@/lib/api/community';
import CommunityDetailPage from './page';

const { mockNotFound } = vi.hoisted(() => ({
  mockNotFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
}));

vi.mock('next/navigation', () => ({ notFound: mockNotFound }));
vi.mock('@/lib/api/community', () => ({ fetchCommunityContent: vi.fn() }));

describe('CommunityDetailPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps an API 404 to notFound', async () => {
    vi.mocked(fetchCommunityContent).mockRejectedValueOnce(new ApiRequestError('missing', 404));

    await expect(CommunityDetailPage({ params: Promise.resolve({ slug: 'missing' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledOnce();
  });

  it.each([
    new ApiRequestError('server failure', 500),
    new Error('invalid response'),
  ])('renders an accessible operational error for %s', async (error) => {
    vi.mocked(fetchCommunityContent).mockRejectedValueOnce(error);

    const result = await CommunityDetailPage({ params: Promise.resolve({ slug: 'safe-now' }) });
    expect(result.props.role).toBe('alert');
  });
});
