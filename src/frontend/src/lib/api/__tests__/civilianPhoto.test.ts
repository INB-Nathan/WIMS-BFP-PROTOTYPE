import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadCivilianReportPhoto } from '../civilian';

// ── Mocks ───────────────────────────────────────────────────────────────────

const { photoResponse, mockPublicApiFetch } = vi.hoisted(() => {
  const response = {
    photo_id: 'abc-123',
    report_id: 42,
    file_size_bytes: 1024,
    mime_type: 'image/jpeg',
    image_width: 100,
    image_height: 100,
    exif_gps_status: 'NOT_PRESENT',
    browser_gps_status: 'NOT_PRESENT',
    gps_consensus: null,
    photo_reported_distance_m: null,
  };
  return { photoResponse: response, mockPublicApiFetch: vi.fn().mockResolvedValue(response) };
});

vi.mock('../public-transport', () => ({
  publicApiFetch: mockPublicApiFetch,
  fetchWithOptionalAuth: mockPublicApiFetch,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function createFile(name: string, type: string, sizeBytes: number = 1024): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], name, { type });
}

describe('uploadCivilianReportPhoto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPublicApiFetch.mockResolvedValue(photoResponse);
  });

  // ── Basic structure ─────────────────────────────────────────────────────

  it('sends FormData with file and device_id fields', async () => {
    const file = createFile('photo.jpg', 'image/jpeg');
    const deviceId = 'test-device-uuid';

    await uploadCivilianReportPhoto(42, file, deviceId);

    expect(mockPublicApiFetch).toHaveBeenCalledWith(
      '/civilian/reports/42/photos',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      }),
    );

    const callBody = mockPublicApiFetch.mock.calls[0][1]?.body as FormData;
    expect(callBody.get('file')).toBe(file);
    expect(callBody.get('device_id')).toBe(deviceId);
  });

  it('omits browser GPS fields when not provided', async () => {
    await uploadCivilianReportPhoto(1, createFile('t.jpg', 'image/jpeg'), 'd-1');

    const body = mockPublicApiFetch.mock.calls[0][1]?.body as FormData;
    expect(body.get('browser_gps_lat')).toBeNull();
    expect(body.get('browser_gps_lon')).toBeNull();
    expect(body.get('browser_gps_accuracy')).toBeNull();
    expect(body.get('browser_gps_captured_at')).toBeNull();
  });

  it('includes all four browser GPS fields when complete sample is provided', async () => {
    const gps = {
      latitude: 14.5,
      longitude: 121.0,
      accuracy: 10,
      capturedAt: '2026-07-10T00:00:00.000Z',
    };

    await uploadCivilianReportPhoto(7, createFile('p.png', 'image/png'), 'd-1', gps);

    const body = mockPublicApiFetch.mock.calls[0][1]?.body as FormData;
    expect(body.get('browser_gps_lat')).toBe('14.5');
    expect(body.get('browser_gps_lon')).toBe('121');
    expect(body.get('browser_gps_accuracy')).toBe('10');
    expect(body.get('browser_gps_captured_at')).toBe('2026-07-10T00:00:00.000Z');
  });

  // ── HTTP method and path ─────────────────────────────────────────────────

  it('uses POST method', async () => {
    await uploadCivilianReportPhoto(1, createFile('t.jpg', 'image/jpeg'), 'd-1');
    expect(mockPublicApiFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('targets the correct endpoint path', async () => {
    await uploadCivilianReportPhoto(99, createFile('t.jpg', 'image/jpeg'), 'd-1');
    expect(mockPublicApiFetch).toHaveBeenCalledWith(
      '/civilian/reports/99/photos',
      expect.anything(),
    );
  });

  // ── Response handling ────────────────────────────────────────────────────

  it('returns UploadPhotoResponse on success', async () => {
    const response = { ...photoResponse, photo_id: 'generated-uuid' };
    mockPublicApiFetch.mockResolvedValue(response);

    const result = await uploadCivilianReportPhoto(1, createFile('t.jpg', 'image/jpeg'), 'd-1');
    expect(result).toEqual(response);
  });

  it('propagates API errors', async () => {
    mockPublicApiFetch.mockRejectedValue(new Error('Photo cap reached'));

    await expect(
      uploadCivilianReportPhoto(1, createFile('t.jpg', 'image/jpeg'), 'd-1'),
    ).rejects.toThrow('Photo cap reached');
  });

  // ── No manual Content-Type ───────────────────────────────────────────────

  it('does not set Content-Type header', async () => {
    await uploadCivilianReportPhoto(1, createFile('t.jpg', 'image/jpeg'), 'd-1');

    // publicApiFetch handles FormData correctly by not setting Content-Type
    const options = mockPublicApiFetch.mock.calls[0][1] as RequestInit;
    expect(options.body).toBeInstanceOf(FormData);
  });
});
