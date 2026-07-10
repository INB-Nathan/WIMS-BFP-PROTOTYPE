/**
 * photoCompression — Client-side photo compression using OffscreenCanvas.
 *
 * Compresses JPEG/PNG photos to <500KB for upload efficiency.
 * Must run AFTER EXIF extraction (Phase E) because OffscreenCanvas
 * strips all EXIF metadata.
 *
 * Key design:
 * - Megapixel gate: rejects files >8000px on either dimension
 * - createImageBitmap + OffscreenCanvas for resizing
 * - JPEG quality iteration (0.7 → 0.3 in 0.1 steps)
 * - Dimension reduction fallback (1280px → 1024px)
 * - Returns original as-is if already small enough
 * - Falls back to original when OffscreenCanvas unavailable (Safari <16.4)
 */

export interface CompressionResult {
  blob: Blob;
  width: number;
  height: number;
  originalSizeBytes: number;
  compressedSizeBytes: number;
  oversized: boolean;
}

const MAX_DIMENSION_INITIAL = 1280;
const MAX_DIMENSION_FALLBACK = 1024;
const SIZE_TARGET_BYTES = 500 * 1024; // 500KB
const QUALITY_START = 0.7;
const QUALITY_MIN = 0.3;
const QUALITY_STEP = 0.1;
const MEGAPIXEL_GATE = 8000;

/**
 * Check if OffscreenCanvas is available in this browser environment.
 * Safari added OffscreenCanvas in Safari 16.4 (March 2023).
 */
function isOffscreenCanvasSupported(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

/**
 * Decode an image file to get its natural dimensions without loading it
 * into the DOM. Returns width and height.
 *
 * Uses createImageBitmap which: (a) works off the main thread,
 * (b) respects EXIF orientation automatically, and (c) returns a
 * properly-oriented ImageBitmap even for camera-orientation photos.
 */
async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  bitmap.close();
  return { width, height };
}

/**
 * Main compression entry point.
 *
 * @param file - The raw File object (JPEG or PNG).
 * @returns CompressionResult with the compressed blob (or original if tiny).
 */
export async function compressPhoto(file: File): Promise<CompressionResult> {
  const originalSizeBytes = file.size;

  // ── Step 1: Check megapixel gate ──────────────────────────────────────
  // Reject images where either dimension exceeds 8000px — they cannot be
  // safely decoded in modern browsers and will crash the tab.
  try {
    const dims = await getImageDimensions(file);
    if (dims.width > MEGAPIXEL_GATE || dims.height > MEGAPIXEL_GATE) {
      return {
        blob: file,
        width: dims.width,
        height: dims.height,
        originalSizeBytes,
        compressedSizeBytes: originalSizeBytes,
        oversized: true,
      };
    }
  } catch {
    // If we can't decode the image at all, pass through oversized.
    return {
      blob: file,
      width: 0,
      height: 0,
      originalSizeBytes,
      compressedSizeBytes: originalSizeBytes,
      oversized: true,
    };
  }

  // ── Step 2: Check if OffscreenCanvas is available ─────────────────────
  if (!isOffscreenCanvasSupported()) {
    // Safari <16.4 — cannot compress; return original.
    const dims = await getImageDimensions(file).catch(() => ({ width: 0, height: 0 }));
    return {
      blob: file,
      width: dims.width,
      height: dims.height,
      originalSizeBytes,
      compressedSizeBytes: originalSizeBytes,
      oversized: true,
    };
  }

  // ── Step 3: If file is already small enough, return as-is ─────────────
  // If the file is ≤500KB AND ≤1280px on both dimensions, no compression needed.
  if (originalSizeBytes <= SIZE_TARGET_BYTES) {
    const dims = await getImageDimensions(file);
    if (dims.width <= MAX_DIMENSION_INITIAL && dims.height <= MAX_DIMENSION_INITIAL) {
      return {
        blob: file,
        width: dims.width,
        height: dims.height,
        originalSizeBytes,
        compressedSizeBytes: originalSizeBytes,
        oversized: false,
      };
    }
  }

  // ── Step 4: Compress via OffscreenCanvas ─────────────────────────────
  // Try the initial max dimension (1280px). If after iterating quality
  // from 0.7 down to 0.3 the result is still >500KB, fall back to 1024px
  // and retry from quality 0.7.
  const result = await attemptCompression(file, MAX_DIMENSION_INITIAL);
  if (result) return result;

  // Fallback: retry with smaller max dimension
  const fallbackResult = await attemptCompression(file, MAX_DIMENSION_FALLBACK);
  if (fallbackResult) return fallbackResult;

  // Extreme fallback: if even 1024px @ q=0.3 can't get below 500KB,
  // return the original with oversized flag.
  try {
    const bitmap = await createImageBitmap(file);
    const fallbackWidth = bitmap.width;
    const fallbackHeight = bitmap.height;
    bitmap.close();
    return {
      blob: file,
      width: fallbackWidth,
      height: fallbackHeight,
      originalSizeBytes,
      compressedSizeBytes: originalSizeBytes,
      oversized: true,
    };
  } catch {
    return {
      blob: file,
      width: 0,
      height: 0,
      originalSizeBytes,
      compressedSizeBytes: originalSizeBytes,
      oversized: true,
    };
  }
}

/**
 * Attempt to compress the image to the given max dimension,
 * iterating quality from 0.7 down to 0.3.
 *
 * Returns CompressionResult if successful, or null if the result
 * is still >500KB at the lowest quality.
 */
async function attemptCompression(
  file: File,
  maxDimension: number,
): Promise<CompressionResult | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  const origWidth = bitmap.width;
  const origHeight = bitmap.height;

  // Compute output dimensions maintaining aspect ratio
  const { width: outWidth, height: outHeight } = computeBoundedDimensions(
    origWidth,
    origHeight,
    maxDimension,
  );

  let bestBlob: Blob | null = null;
  let bestSize = Infinity;

  // Try each quality level from highest to lowest
  for (let q = QUALITY_START; q >= QUALITY_MIN - 0.01; q = Math.round((q - QUALITY_STEP) * 100) / 100) {
    const quality = Math.max(q, QUALITY_MIN);
    try {
      const blob = await renderToBlob(bitmap, outWidth, outHeight, quality);
      if (blob.size <= SIZE_TARGET_BYTES) {
        // Found a good quality — close the bitmap and return
        bitmap.close();
        return {
          blob,
          width: outWidth,
          height: outHeight,
          originalSizeBytes: file.size,
          compressedSizeBytes: blob.size,
          oversized: false,
        };
      }
      if (blob.size < bestSize) {
        bestBlob = blob;
        bestSize = blob.size;
      }
    } catch {
      continue;
    }
  }

  bitmap.close();

  // All quality levels exceeded the target size. Return null so the caller
  // falls through to the dimension-reduction retry (1024px). The final
  // extreme fallback in compressPhoto() handles returning the original.
  return null;
}

/**
 * Compute target dimensions bounded by maxDimension while maintaining aspect ratio.
 */
function computeBoundedDimensions(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }

  const ratio = Math.min(maxDimension / width, maxDimension / height);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

/**
 * Render an ImageBitmap to a JPEG Blob at the given quality using OffscreenCanvas.
 */
async function renderToBlob(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('OffscreenCanvas 2D context unavailable');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}
