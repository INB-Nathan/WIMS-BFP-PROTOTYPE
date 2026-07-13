import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CommunityAdminPage from './page';
import { fetchAdminCommunityContent, publishCommunityContent } from '@/lib/api/adminCommunity';

const auth = { user: { role: 'SYSTEM_ADMIN' }, loading: false };
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/lib/api/adminCommunity', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/adminCommunity')>('@/lib/api/adminCommunity');
  return { ...actual, fetchAdminCommunityContent: vi.fn(), publishCommunityContent: vi.fn() };
});

describe('CommunityAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchAdminCommunityContent).mockResolvedValue([]);
    vi.mocked(publishCommunityContent).mockResolvedValue({ content_id: 'c1', lifecycle_status: 'PUBLISHED' });
  });

  it('gates non-admin presentation and does not request content', async () => {
    auth.user = { role: 'ANALYST' };
    render(<CommunityAdminPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Access restricted.');
    expect(fetchAdminCommunityContent).not.toHaveBeenCalled();
  });

  it('loads every lifecycle item, permits selection, and publishes plain text content', async () => {
    auth.user = { role: 'SYSTEM_ADMIN' };
    vi.mocked(fetchAdminCommunityContent).mockResolvedValue([{
      content_id: 'c1', slug: 'safe', content_type: 'SAFETY_ARTICLE', lifecycle_status: 'DRAFT',
      title_en: 'Safe title', title_uk: null, body_en: '<b>Safe body</b>', body_uk: null,
      metadata_json: null, expires_at: null, urgent_banner: false, last_reviewed_at: null, row_version: 1,
    }]);
    render(<CommunityAdminPage />);
    await waitFor(() => expect(screen.getByText('Safe title')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Safe title/i }));
    expect(screen.getByDisplayValue('<b>Safe body</b>')).toBeInTheDocument();
    expect(screen.queryByText('<b>')).not.toBeInTheDocument();
  });
});
