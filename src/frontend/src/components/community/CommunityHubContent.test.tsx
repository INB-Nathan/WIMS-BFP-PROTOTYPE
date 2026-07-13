import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityHubContent } from './CommunityHubContent';
import { fetchCommunityHub, type CommunityHubResponse } from '@/lib/api/community';

vi.mock('@/lib/api/community', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/community')>('@/lib/api/community');
  return { ...actual, fetchCommunityHub: vi.fn() };
});

const item = { content_id: '1', slug: 'safe-now', content_type: 'SAFETY_ARTICLE' as const, title: 'Stay safe', body: '<script>alert(1)</script>', language: 'en', urgent_banner: false, expires_at: null, metadata_json: null, last_reviewed_at: null, updated_at: null };

describe('CommunityHubContent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders urgent notices, escaped plain text, and empty state', () => {
    render(<CommunityHubContent initialData={{ items: [{ ...item, urgent_banner: true }], urgent_banner: { ...item, urgent_banner: true } }} />);
    expect(screen.getByRole('heading', { name: 'Urgent safety notice' })).toBeInTheDocument();
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();

    render(<CommunityHubContent initialData={{ items: [], urgent_banner: null }} />);
    expect(screen.getByText(/No published community content/)).toBeInTheDocument();
  });

  it('loads Ukrainian content, restores English, and preserves backend English fallback', async () => {
    const ukrainian = { ...item, title: 'Безпека' as const, body: 'Залишайте виходи вільними' as const, language: 'uk' as const };
    vi.mocked(fetchCommunityHub)
      .mockResolvedValueOnce({ items: [ukrainian], urgent_banner: null })
      .mockResolvedValueOnce({ items: [item], urgent_banner: null });
    render(<CommunityHubContent initialData={{ items: [item], urgent_banner: null }} />);

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'uk' } });
    await waitFor(() => expect(screen.getByText('Безпека')).toBeInTheDocument());
    expect(fetchCommunityHub).toHaveBeenCalledWith({ language: 'uk' });

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'en' } });
    await waitFor(() => expect(screen.getByText('Stay safe')).toBeInTheDocument());
    expect(fetchCommunityHub).toHaveBeenCalledWith({ language: 'en' });
  });

  it('announces loading while a language request is pending', async () => {
    let resolve: (value: CommunityHubResponse) => void = () => undefined;
    vi.mocked(fetchCommunityHub).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<CommunityHubContent initialData={{ items: [item], urgent_banner: null }} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'uk' } });
    });
    expect(screen.getByRole('status')).toHaveTextContent(/Loading translated content/);
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      resolve({ items: [item], urgent_banner: null });
    });
  });

  it('filters cards by content type', () => {
    const announcement = { ...item, content_id: '2', slug: 'announcement', content_type: 'ANNOUNCEMENT' as const, title: 'Service announcement' };
    render(<CommunityHubContent initialData={{ items: [item, announcement], urgent_banner: null }} />);

    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'ANNOUNCEMENT' } });
    expect(screen.getByText('Service announcement')).toBeInTheDocument();
    expect(screen.queryByText('Stay safe')).not.toBeInTheDocument();
  });

  it('renders an initial fetch error accessibly', () => {
    render(<CommunityHubContent initialData={null} initialError="Community safety content is temporarily unavailable." />);
    expect(screen.getByRole('alert')).toHaveTextContent(/temporarily unavailable/);
  });

  it('announces language loading errors', async () => {
    vi.mocked(fetchCommunityHub).mockRejectedValueOnce(new Error('offline'));
    render(<CommunityHubContent initialData={{ items: [item], urgent_banner: null }} />);
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'uk' } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/temporarily unavailable/));
  });
});
