/**
 * photoCompression tests — client-side photo compression.
 *
 * Since OffscreenCanvas and createImageBitmap are not available in jsdom,
 * we mock them to test the logic paths. The key tests verify:
 *   - Compression reduces file size
 *   - Small files pass through as-is
 *   - Portrait images are bounded on height
 *   - Oversized dimensions (>8000px) return oversized
 *   - OffscreenCanvas unavailable fallback
 *   - Aspect ratio preservation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { compressPhoto } from '../photoCompression';

// ── Mock helpers ────────────────────────────────────────────────────────────

interface MockCanvasContext {
  drawImage: ReturnType<typeof vi.fn>;
}

interface MockOffscreenCanvas {
  width: number;
  height: number;
  getContext: ReturnType<typeof vi.fn>;
  convertToBlob: ReturnType<typeof vi.fn>;
}

interface MockImageBitmap {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
}

let mockDimensions: { width: number; height: number } = { width: 1920, height: 1080 };
let mockCanvasSupported = true;
let mockBlobSize = 400 * 1024; // 400KB default
let mockCreateImageBitmapFails = false;
let mockConvertToBlobFails = false;

function createMockBitmap(width: number, height: number): MockImageBitmap {
  return {
    width,
    height,
    close: vi.fn(),
  };
}

function setupMocks() {
  // Mock createImageBitmap
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (_file: File) => {
      if (mockCreateImageBitmapFails) {
        throw new Error('Failed to decode image');
      }
      return createMockBitmap(mockDimensions.width, mockDimensions.height);
    }),
  );

  // Mock OffscreenCanvas
  vi.stubGlobal(
    'OffscreenCanvas',
    vi.fn(function (this: MockOffscreenCanvas, width: number, height: number) {
      this.width = width;
      this.height = height;
      this.getContext = vi.fn(() => {
        const ctx: MockCanvasContext = {
          drawImage: vi.fn(),
        };
        return ctx;
      });
      this.convertToBlob = vi.fn(async () => {
        if (mockConvertToBlobFails) {
          throw new Error('Conversion failed');
        }
        return new Blob([new Uint8Array(mockBlobSize)], { type: 'image/jpeg' });
      });
    } as unknown as OffscreenCanvasConstructor),
  );
}

function cleanupMocks() {
  vi.unstubAllGlobals();
}

// ── File helpers ────────────────────────────────────────────────────────────

function createFile(name: string, type: string, sizeBytes: number): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], name, { type });
}

const smallJpeg = () => createFile('small.jpg', 'image/jpeg', 100 * 1024); // 100KB
const largeJpeg = () => createFile('large.jpg', 'image/jpeg', 3 * 1024 * 1024); // 3MB
const tinyPng = () => createFile('tiny.png', 'image/png', 50 * 1024); // 50KB

// ── Tests ───────────────────────────────────────────────────────────────────

describe('compressPhoto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDimensions = { width: 1920, height: 1080 };
    mockCanvasSupported = true;
    mockBlobSize = 400 * 1024; // 400KB
    mockCreateImageBitmapFails = false;
    mockConvertToBlobFails = false;
    setupMocks();
  });

  afterEach(() => {
    cleanupMocks();
  });

  it('compresses JPEG >500KB to <500KB', async () => {
    // 3MB file at 1920x1080 should be compressed heavily
    mockBlobSize = 350 * 1024; // Simulate compression to 350KB

    const result = await compressPhoto(largeJpeg());

    expect(result.oversized).toBe(false);
    expect(result.compressedSizeBytes).toBeLessThan(500 * 1024);
    expect(result.originalSizeBytes).toBe(3 * 1024 * 1024);
    // Should have compressed (blob !== original file)
    expect(result.blob).not.toBe(largeJpeg());
    // Should have reasonable dimensions (≤1280px)
    expect(result.width).toBeLessThanOrEqual(1280);
    expect(result.height).toBeLessThanOrEqual(1280);
  });

  it('returns small file as-is when under limit and within dimensions', async () => {
    // 100KB file at 800x600 — small enough to skip compression
    mockDimensions = { width: 800, height: 600 };
    const file = smallJpeg();

    const result = await compressPhoto(file);

    expect(result.oversized).toBe(false);
    // Should return the original file unchanged (reference equality)
    expect(result.blob).toBe(file);
    expect(result.originalSizeBytes).toBe(100 * 1024);
    expect(result.compressedSizeBytes).toBe(100 * 1024);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it('bounds portrait on height (1200×3000 → width ≤1280)', async () => {
    // Portrait 1200x3000 — dimension needs reducing
    mockDimensions = { width: 1200, height: 3000 };
    mockBlobSize = 250 * 1024; // compressed size

    const result = await compressPhoto(largeJpeg());

    expect(result.oversized).toBe(false);
    // Height should be bounded
    expect(result.height).toBeLessThanOrEqual(1280);
    // Aspect ratio should be preserved (roughly)
    const ratio = 1200 / 3000;
    expect(result.width / result.height).toBeCloseTo(ratio, 2);
  });

  it('returns oversized: true when dimensions exceed 8000px', async () => {
    mockDimensions = { width: 9000, height: 6000 };

    const result = await compressPhoto(createFile('huge.jpg', 'image/jpeg', 1024));

    expect(result.oversized).toBe(true);
    // Should return the original file
    expect(result.blob).toBeInstanceOf(File);
  });

  it('returns oversized: true when OffscreenCanvas is unavailable', async () => {
    // Remove OffscreenCanvas from global scope
    vi.stubGlobal('OffscreenCanvas', undefined);

    mockDimensions = { width: 1920, height: 1080 };
    const file = largeJpeg();

    const result = await compressPhoto(file);

    expect(result.oversized).toBe(true);
    // Should return the original file (reference equality)
    expect(result.blob).toBe(file);
  });

  it('returns oversized: true when createImageBitmap fails', async () => {
    mockCreateImageBitmapFails = true;

    const result = await compressPhoto(createFile('broken.jpg', 'image/jpeg', 1024));

    expect(result.oversized).toBe(true);
    expect(result.blob).toBeInstanceOf(File);
  });

  it('preserves aspect ratio when compressing', async () => {
    // Wide image 4000x1000
    mockDimensions = { width: 4000, height: 1000 };
    mockBlobSize = 200 * 1024;

    const result = await compressPhoto(largeJpeg());

    expect(result.oversized).toBe(false);
    const originalRatio = 4000 / 1000; // 4.0
    const compressedRatio = result.width / result.height;
    // Should be approximately 4:1
    expect(compressedRatio).toBeCloseTo(originalRatio, 1);
    expect(result.width).toBeLessThanOrEqual(1280);
  });

  it('returns oversized: true when convertToBlob fails', async () => {
    mockConvertToBlobFails = true;

    const result = await compressPhoto(largeJpeg());

    expect(result.oversized).toBe(true);
  });

  it('compresses PNG files as well', async () => {
    mockDimensions = { width: 1920, height: 1080 };
    mockBlobSize = 300 * 1024;

    const result = await compressPhoto(tinyPng());

    expect(result.oversized).toBe(false);
    expect(result.compressedSizeBytes).toBeLessThan(500 * 1024);
    // PNG should be converted to JPEG
    expect(result.blob.type).toBe('image/jpeg');
  });
});
