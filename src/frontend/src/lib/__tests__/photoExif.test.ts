/**
 * photoExif tests — client-side EXIF GPS extraction.
 *
 * Tests the extractExifGps function with:
 *   - JPEG files containing EXIF GPS data
 *   - Southern hemisphere (negative latitude)
 *   - Western hemisphere (negative longitude)
 *   - Negative altitude (below sea level)
 *   - JPEG without EXIF → null
 *   - PNG → null
 *   - Corrupted file → null
 *
 * Uses inline binary JPEG/EXIF construction to avoid external fixtures.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to mock exifr since it doesn't work in Node test environment
// without additional polyfills. We mock it to return controlled data.
vi.mock('exifr', () => {
  return {
    default: {
      parse: vi.fn(),
    },
  };
});

import exifr from 'exifr';
import { extractExifGps } from '../photoExif';
import type { ExifGpsData } from '../photoExif';

// Helper to create a minimal File object for testing
function createFile(data: unknown, name: string, type: string): File {
  const blob = new Blob([JSON.stringify(data)], { type });
  return new File([blob], name, { type });
}

// Helper to build a minimal JPEG file with specific EXIF values
function jpegWithExif(exifValues: Record<string, unknown>): File {
  return createFile(exifValues, 'photo.jpg', 'image/jpeg');
}

function jpegWithoutExif(): File {
  return createFile({}, 'photo.jpg', 'image/jpeg');
}

function pngFile(): File {
  return new File([new Blob(['fake-png'])], 'photo.png', { type: 'image/png' });
}

function corruptedJpeg(): File {
  return new File([new Blob([new Uint8Array([0xff, 0xd8, 0xff])])], 'corrupted.jpg', {
    type: 'image/jpeg',
  });
}

describe('extractExifGps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns GPS data for a JPEG with valid EXIF', async () => {
    const mockExifr = vi.mocked(exifr.parse);
    mockExifr.mockResolvedValue({
      GPSLatitude: 14.5,
      GPSLongitude: 121.0,
      GPSAltitude: 100,
      GPSLatitudeRef: 'N',
      GPSLongitudeRef: 'E',
      GPSAltitudeRef: 0,
      DateTimeOriginal: '2026-07-10T10:30:00',
    });

    const result = await extractExifGps(jpegWithExif({}));

    expect(result).not.toBeNull();
    expect(result!.latitude).toBeCloseTo(14.5, 5);
    expect(result!.longitude).toBeCloseTo(121.0, 5);
    expect(result!.altitude).toBe(100);
    expect(result!.timestamp).toBe('2026-07-10T10:30:00');
  });

  it('returns negative latitude for southern hemisphere', async () => {
    const mockExifr = vi.mocked(exifr.parse);
    mockExifr.mockResolvedValue({
      GPSLatitude: -33.8688,
      GPSLongitude: 151.2093,
      GPSLatitudeRef: 'S',
      GPSLongitudeRef: 'E',
      GPSAltitudeRef: 0,
    });

    const result = await extractExifGps(jpegWithExif({}));

    expect(result).not.toBeNull();
    expect(result!.latitude).toBeLessThan(0);
    expect(result!.latitude).toBeCloseTo(-33.8688, 4);
  });

  it('returns negative longitude for western hemisphere', async () => {
    const mockExifr = vi.mocked(exifr.parse);
    mockExifr.mockResolvedValue({
      GPSLatitude: 40.7128,
      GPSLongitude: -74.006,
      GPSLatitudeRef: 'N',
      GPSLongitudeRef: 'W',
      GPSAltitudeRef: 0,
    });

    const result = await extractExifGps(jpegWithExif({}));

    expect(result).not.toBeNull();
    expect(result!.longitude).toBeLessThan(0);
    expect(result!.longitude).toBeCloseTo(-74.006, 3);
  });

  it('returns negative altitude for below-sea-level', async () => {
    const mockExifr = vi.mocked(exifr.parse);
    mockExifr.mockResolvedValue({
      GPSLatitude: 31.5,
      GPSLongitude: 35.5,
      GPSAltitude: -420,
      GPSLatitudeRef: 'N',
      GPSLongitudeRef: 'E',
      GPSAltitudeRef: 1, // below sea level
    });

    const result = await extractExifGps(jpegWithExif({}));

    expect(result).not.toBeNull();
    expect(result!.altitude).toBeLessThan(0);
    expect(result!.altitude).toBe(-420);
  });

  it('returns null for JPEG without EXIF GPS', async () => {
    const mockExifr = vi.mocked(exifr.parse);
    mockExifr.mockResolvedValue({
      // No GPS fields — only other metadata
      Make: 'Canon',
      Model: 'EOS',
    });

    const result = await extractExifGps(jpegWithoutExif());
    expect(result).toBeNull();
  });

  it('returns null for PNG files', async () => {
    const result = await extractExifGps(pngFile());
    expect(result).toBeNull();
  });

  it('returns null for corrupted files', async () => {
    const mockExifr = vi.mocked(exifr.parse);
    mockExifr.mockRejectedValue(new Error('Failed to parse'));

    const result = await extractExifGps(corruptedJpeg());
    expect(result).toBeNull();
  });

  it('returns null when exifr returns null/undefined', async () => {
    const mockExifr = vi.mocked(exifr.parse);
    mockExifr.mockResolvedValue(null);

    const result = await extractExifGps(jpegWithExif({}));
    expect(result).toBeNull();
  });

  it('returns null when GPSLatitude is missing', async () => {
    const mockExifr = vi.mocked(exifr.parse);
    mockExifr.mockResolvedValue({
      GPSLongitude: 121.0,
    });

    const result = await extractExifGps(jpegWithExif({}));
    expect(result).toBeNull();
  });

  it('returns null when GPSLongitude is missing', async () => {
    const mockExifr = vi.mocked(exifr.parse);
    mockExifr.mockResolvedValue({
      GPSLatitude: 14.5,
    });

    const result = await extractExifGps(jpegWithExif({}));
    expect(result).toBeNull();
  });
});
