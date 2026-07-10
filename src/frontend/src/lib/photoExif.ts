/**
 * photoExif — Client-side EXIF GPS extraction (before compression).
 *
 * EXIF extraction must happen BEFORE compression because OffscreenCanvas
 * and browser-side JPEG re-encoding strip all EXIF metadata. This module
 * captures camera GPS data, altitude, and DateTimeOriginal from the raw
 * file blob while it is still intact.
 *
 * Uses exifr for robust parsing with ref-tag resolution:
 *   - GPSLatitudeRef / GPSLongitudeRef → signed lat/lng
 *   - GPSAltitudeRef → signed altitude
 *   - DateTimeOriginal → ISO string
 */

import exifr from 'exifr';

export interface ExifGpsData {
  latitude: number;
  longitude: number;
  altitude: number | null;
  timestamp: string | null; // DateTimeOriginal as ISO string
}

/**
 * Extract GPS EXIF data from a photo file.
 *
 * Must be called BEFORE any compression pipeline that re-encodes the image
 * (OffscreenCanvas, browser JPEG encoder, etc.) — these strip EXIF.
 *
 * @param file - The raw File object from the file/camera input.
 * @returns ExifGpsData on success, or null if EXIF is absent/unreadable.
 */
export async function extractExifGps(file: File): Promise<ExifGpsData | null> {
  // Only JPEG files carry EXIF — PNG/other formats do not.
  if (file.type !== 'image/jpeg') {
    return null;
  }

  try {
    // Parse selective tags for speed. exifr normalizes ref tags into signed
    // values internally: GPSLatitudeRef 'S' → negative latitude,
    // GPSLongitudeRef 'W' → negative longitude, GPSAltitudeRef 1 → negative altitude.
    const parsed = await exifr.parse(file, [
      'GPSLatitude',
      'GPSLongitude',
      'GPSAltitude',
      'GPSLatitudeRef',
      'GPSLongitudeRef',
      'GPSAltitudeRef',
      'DateTimeOriginal',
    ]);

    if (!parsed) {
      return null;
    }

    // Latitude and longitude are the core requirement. If either is missing, skip.
    const latitude = parsed.GPSLatitude as number | undefined;
    const longitude = parsed.GPSLongitude as number | undefined;

    if (latitude == null || longitude == null) {
      return null;
    }

    const altitude = (parsed.GPSAltitude as number | null) ?? null;
    const timestamp = (parsed.DateTimeOriginal as string | null) ?? null;

    return { latitude, longitude, altitude, timestamp };
  } catch {
    // Parsing failure — corrupted file, truncated EXIF, or unsupported format.
    return null;
  }
}
