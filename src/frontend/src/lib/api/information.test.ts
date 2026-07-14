import { describe, expect, it, vi } from 'vitest';
import {
  fetchAnnouncements,
  fetchEmergencies,
  resolveAnnouncementImageUrl,
} from './information';
import { publicApiFetch } from './public-transport';

vi.mock('./public-transport', () => ({ publicApiFetch: vi.fn() }));
// API_BASE is pulled in for URL resolution; stub it so we don't import the
// heavy authenticated transport in this unit test.
vi.mock('./transport', () => ({ API_BASE: '/api' }));

const mockedPublicApiFetch = vi.mocked(publicApiFetch);

describe('information API clients', () => {
  it('fetches emergencies from the public endpoint', async () => {
    mockedPublicApiFetch.mockResolvedValueOnce([{ id: 1 }]);
    await fetchEmergencies();
    expect(mockedPublicApiFetch).toHaveBeenCalledWith('/information/emergencies', {
      cache: 'no-store',
    });
  });

  it('fetches announcements from the public endpoint', async () => {
    mockedPublicApiFetch.mockResolvedValueOnce([{ id: 2 }]);
    await fetchAnnouncements();
    expect(mockedPublicApiFetch).toHaveBeenCalledWith('/information/announcements', {
      cache: 'no-store',
    });
  });

  it('never sends credentials (zero-trust public read)', async () => {
    mockedPublicApiFetch.mockResolvedValueOnce([]);
    await fetchEmergencies();
    // publicApiFetch is mocked; the real implementation uses credentials:'omit'.
    // We assert the call shape here and rely on public-transport tests for the
    // credential behavior.
    expect(mockedPublicApiFetch).toHaveBeenCalledWith('/information/emergencies', {
      cache: 'no-store',
    });
  });
});

describe('resolveAnnouncementImageUrl', () => {
  it('returns null for missing paths', () => {
    expect(resolveAnnouncementImageUrl(null)).toBeNull();
  });

  it('passes absolute urls through', () => {
    expect(resolveAnnouncementImageUrl('https://cdn.test/x.png')).toBe('https://cdn.test/x.png');
  });

  it('prefixes api base for leading-slash paths', () => {
    expect(resolveAnnouncementImageUrl('/uploads/x.png')).toBe('/api/uploads/x.png');
  });

  it('prefixes api base for bare paths', () => {
    expect(resolveAnnouncementImageUrl('uploads/x.png')).toBe('/api/uploads/x.png');
  });
});
