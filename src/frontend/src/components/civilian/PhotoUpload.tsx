'use client';

import { useState, useEffect, useRef } from 'react';
import { Camera, Image, XCircle, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';

import type { ExifGpsData } from '@/lib/photoExif';
import { extractExifGps } from '@/lib/photoExif';
import type { CompressionResult } from '@/lib/photoCompression';
import { compressPhoto } from '@/lib/photoCompression';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];
const GPS_TIMEOUT_MS = 10_000;

// Mobile user-agent detection helper
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export interface PhotoGpsSample {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
}

interface PhotoUploadProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  gps: PhotoGpsSample | null;
  onGpsChange: (gps: PhotoGpsSample | null) => void;
  disabled?: boolean;
  photoStatus: 'idle' | 'uploading' | 'uploaded' | 'failed';
  photoError: string | null;
  /** Called with EXIF GPS data extracted from the selected photo (before compression). */
  onExifChange?: (exif: ExifGpsData | null) => void;
  /** Whether the device is online (hides camera/gallery when false at initial state). */
  online?: boolean;
  /** Number of photos pending in the offline queue (for badge). */
  pendingCount?: number;
}

/**
 * Compute the distance in meters between two lat/lng points using the Haversine formula.
 */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function PhotoUpload({
  file,
  onFileChange,
  gps,
  onGpsChange,
  disabled = false,
  photoStatus,
  photoError,
  onExifChange,
  online = true,
  pendingCount = 0,
}: PhotoUploadProps) {
  const [validationError, setValidationError] = useState<string | null>(null);
  const [exifData, setExifData] = useState<ExifGpsData | null>(null);
  const [isMobile] = useState(isMobileDevice);
  const [compressing, setCompressing] = useState(false);
  const [compressedSizeInfo, setCompressedSizeInfo] = useState<{ original: number; compressed: number } | null>(null);
  const [oversizedWarning, setOversizedWarning] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const previewImageRef = useRef<HTMLImageElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const gpsResolvedRef = useRef(false);
  const gpsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileGenerationRef = useRef(0);

  // Sync object URL when file changes, revoking the old one
  useEffect(() => {
    // Revoke previous URL if it exists
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (!file) return;

    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    if (previewImageRef.current) {
      previewImageRef.current.src = url;
    }

    return () => {
      URL.revokeObjectURL(url);
      if (objectUrlRef.current === url) {
        objectUrlRef.current = null;
      }
    };
  }, [file]);

  // Cleanup GPS timeout
  useEffect(() => {
    return () => {
      if (gpsTimeoutRef.current) {
        clearTimeout(gpsTimeoutRef.current);
      }
    };
  }, []);

  function requestGpsForPhoto() {
    gpsResolvedRef.current = false;

    if (!navigator.geolocation) {
      onGpsChange(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (gpsResolvedRef.current) return;
        gpsResolvedRef.current = true;
        if (gpsTimeoutRef.current) {
          clearTimeout(gpsTimeoutRef.current);
          gpsTimeoutRef.current = null;
        }
        onGpsChange({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date().toISOString(),
        });
      },
      () => {
        if (gpsResolvedRef.current) return;
        gpsResolvedRef.current = true;
        if (gpsTimeoutRef.current) {
          clearTimeout(gpsTimeoutRef.current);
          gpsTimeoutRef.current = null;
        }
        onGpsChange(null);
      },
      { timeout: GPS_TIMEOUT_MS, maximumAge: 30_000 },
    );

    gpsTimeoutRef.current = setTimeout(() => {
      if (!gpsResolvedRef.current) {
        gpsResolvedRef.current = true;
        onGpsChange(null);
      }
    }, GPS_TIMEOUT_MS + 100);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setValidationError(null);
    setOversizedWarning(null);
    setCompressedSizeInfo(null);
    const selected = e.target.files?.[0] ?? null;
    if (!selected) {
      onFileChange(null);
      onGpsChange(null);
      return;
    }

    // Validate type
    if (!ACCEPTED_TYPES.includes(selected.type)) {
      setValidationError('Please select a JPEG or PNG image.');
      onFileChange(null);
      onGpsChange(null);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
      return;
    }

    // Clear the non-triggered input to prevent stale selection
    if (e.target === cameraInputRef.current && galleryInputRef.current) {
      galleryInputRef.current.value = '';
    } else if (e.target === galleryInputRef.current && cameraInputRef.current) {
      cameraInputRef.current.value = '';
    }

    // Increment generation for stale async guard
    const gen = ++fileGenerationRef.current;

    // Start GPS acquisition (non-blocking, parallel with EXIF + compression)
    requestGpsForPhoto();

    // ── Step 1: Extract EXIF (must be BEFORE compression) ──────────────
    // Compression via OffscreenCanvas strips EXIF metadata, so we must
    // extract GPS data from the raw file while it is still intact.
    // Then compress (chained after EXIF so OffscreenCanvas hasn't stripped
    // the metadata yet).
    setCompressing(true);

    extractExifGps(selected).then((exif) => {
      // Check stale guard
      if (fileGenerationRef.current !== gen) return;
      setExifData(exif);
      onExifChange?.(exif);

      // ── Step 2: Compress photo (only after EXIF resolved) ──────────
      return compressPhoto(selected);
    }).then((result: CompressionResult | undefined) => {
      // If EXIF was stale (returned early), compression also aborts
      if (!result || fileGenerationRef.current !== gen) return;
      // Check stale guard — if user selected a different file while we were
      // processing, discard this result silently.
      if (fileGenerationRef.current !== gen) return;

      setCompressing(false);

      if (result.oversized && result.blob === selected) {
        // Oversized or couldn't be decoded — pass through original file
        if (selected.type === 'image/jpeg' || selected.type === 'image/png') {
          setOversizedWarning(
            'This photo is very large or could not be compressed. It will be uploaded as-is.',
          );
        }
        onFileChange(selected);
      } else if (result.oversized && result.blob !== selected) {
        // Compressed still >500KB — show warning but use compressed version
        setOversizedWarning(
          'This photo could not be compressed below 500 KB. It will be uploaded at reduced quality.',
        );
        const compressedFile = new File([result.blob], 'photo.jpg', { type: 'image/jpeg' });
        setCompressedSizeInfo({
          original: result.originalSizeBytes,
          compressed: result.compressedSizeBytes,
        });
        onFileChange(compressedFile);
      } else {
        // Successfully compressed
        const compressedFile = new File(
          [result.blob],
          'photo.jpg',
          { type: 'image/jpeg' },
        );
        setCompressedSizeInfo({
          original: result.originalSizeBytes,
          compressed: result.compressedSizeBytes,
        });
        onFileChange(compressedFile);
      }
    }).catch(() => {
      // Compression failed entirely — pass through original file as a fallback
      if (fileGenerationRef.current !== gen) return;
      setCompressing(false);
      setOversizedWarning(
        'Photo could not be compressed. It will be uploaded as-is.',
      );
      onFileChange(selected);
    });
  }

  function handleRemove() {
    onFileChange(null);
    onGpsChange(null);
    setExifData(null);
    onExifChange?.(null);
    setValidationError(null);
    setCompressedSizeInfo(null);
    setOversizedWarning(null);
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (galleryInputRef.current) galleryInputRef.current.value = '';
  }

  const isDisabled = disabled || photoStatus === 'uploading' || photoStatus === 'uploaded';

  /** Render GPS/EXIF status indicators inside the file preview area. */
  function renderGpsIndicators() {
    const indicators: React.ReactNode[] = [];

    // Browser GPS indicator
    if (gps) {
      indicators.push(
        <p key="browser-gps" className="text-xs" style={{ color: 'var(--text-muted)' }}>
          GPS captured
        </p>,
      );
    } else {
      indicators.push(
        <p key="browser-gps" className="text-xs" style={{ color: 'var(--text-muted)' }}>
          No GPS metadata
        </p>,
      );
    }

    // EXIF GPS indicator
    if (exifData) {
      indicators.push(
        <p key="exif-gps" className="text-xs" style={{ color: '#16a34a' }}>
          GPS from camera: ✓
        </p>,
      );
    } else if (file && file.type === 'image/jpeg') {
      indicators.push(
        <p key="exif-gps" className="text-xs" style={{ color: 'var(--text-muted)' }}>
          GPS from camera: not available
        </p>,
      );
    }

    // EXIF-vs-browser GPS match badge
    if (exifData && gps) {
      const distance = haversineM(
        exifData.latitude,
        exifData.longitude,
        gps.latitude,
        gps.longitude,
      );
      const threshold = Math.max(100, gps.accuracy * 3);
      const matches = distance <= threshold;

      indicators.push(
        <p
          key="exif-match"
          className="text-xs"
          style={{ color: matches ? '#16a34a' : '#d97706' }}
        >
          {matches ? 'GPS matches' : 'GPS differs'}
        </p>,
      );
    }

    return <>{indicators}</>;
  }

  return (
    <div className="space-y-2" data-testid="photo-upload">
      <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        Attach a photo (optional)
      </p>
      <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
        Share a photo of the fire. JPEG or PNG. One photo per report.
        <br />
        <span lang="fil">Mag-share ng litrato ng sunog. JPEG o PNG. Isang litrato bawat report.</span>
      </p>

      {/* ── Offline banners (non-blocking) ──────────────────────── */}
      {!online && !file && (
        <>
          <div
            className="flex items-center gap-2 p-3 rounded-lg text-sm"
            style={{ backgroundColor: 'rgba(245,158,11,0.06)', color: 'var(--text-secondary)' }}
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-500" />
            <span>
              Photos will be saved and uploaded when you reconnect.
              <br />
              <span lang="fil">Ang mga litrato ay nai-save at ia-upload kapag nakakonekta ka.</span>
            </span>
          </div>
          {pendingCount > 0 && (
            <div
              className="flex items-center gap-2 p-3 rounded-lg text-sm"
              style={{ backgroundColor: 'rgba(59,130,246,0.06)', color: '#2563eb' }}
            >
              <RefreshCw className="w-4 h-4 flex-shrink-0" />
              <span>
                {pendingCount} photo{pendingCount !== 1 ? 's' : ''} waiting to upload
              </span>
            </div>
          )}
        </>
      )}

      {validationError && (
        <div
          className="flex items-center gap-2 p-3 rounded-lg text-sm"
          style={{ backgroundColor: 'rgba(220,38,38,0.06)', color: '#b91c1c' }}
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {validationError}
        </div>
      )}

      {/* ── Compressing indicator ───────────────────────────────────── */}
      {compressing && (
        <div
          className="flex items-center gap-2 p-3 rounded-lg text-sm"
          style={{ backgroundColor: 'rgba(59,130,246,0.06)', color: '#2563eb' }}
          role="status"
        >
          <RefreshCw className="w-4 h-4 animate-spin" />
          Compressing photo...
        </div>
      )}

      {/* ── Oversized warning ───────────────────────────────────────── */}
      {oversizedWarning && !compressing && (
        <div
          className="flex items-center gap-2 p-3 rounded-lg text-sm"
          style={{ backgroundColor: 'rgba(245,158,11,0.06)', color: '#92400e' }}
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-500" />
          <span>{oversizedWarning}</span>
        </div>
      )}

      {!file ? (
        <div className="space-y-2">
          {isMobile && !isDisabled && (
            <label
              className="flex items-center justify-center gap-2 w-full p-4 rounded-xl border-2 border-dashed cursor-pointer transition-colors hover:opacity-80"
              style={{
                borderColor: 'var(--bfp-maroon-dark, #991B34)',
                backgroundColor: 'rgba(153,27,52,0.06)',
                color: 'var(--bfp-maroon-dark, #991B34)',
              }}
              data-testid="photo-take-photo-btn"
            >
              <Camera className="w-6 h-6" />
              <span className="text-sm font-semibold">Take Photo</span>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/jpeg,image/png"
                capture="environment"
                onChange={handleFileSelect}
                disabled={isDisabled}
                className="sr-only"
                aria-label="Take a photo with your camera"
                data-testid="photo-camera-input"
              />
            </label>
          )}
          <label
            className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
              isDisabled ? 'opacity-50 cursor-not-allowed' : ''
            }`}
            style={{
              borderColor: 'var(--border-color)',
              backgroundColor: 'var(--content-bg)',
            }}
            data-testid="photo-gallery-btn"
          >
            <Image className="w-6 h-6" style={{ color: 'var(--text-muted)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              {isDisabled ? 'Upload unavailable' : 'Choose from Gallery'}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {isDisabled ? '' : 'JPEG or PNG only'}
            </span>
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/jpeg,image/png"
              onChange={handleFileSelect}
              disabled={isDisabled}
              className="sr-only"
              aria-label="Select a photo from your gallery"
              data-testid="photo-file-input"
            />
          </label>
          {pendingCount > 0 && (
            <div
              className="flex items-center gap-2 p-3 rounded-lg text-sm"
              style={{ backgroundColor: 'rgba(59,130,246,0.06)', color: '#2563eb' }}
              data-testid="photo-pending-badge"
            >
              <RefreshCw className="w-4 h-4 flex-shrink-0" />
              <span>
                {pendingCount} photo{pendingCount !== 1 ? 's' : ''} waiting to upload
              </span>
            </div>
          )}
        </div>
      ) : (
        <div
          className="rounded-xl border p-3"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)' }}
        >
          <div className="flex items-start gap-3">
            <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
              <img
                ref={previewImageRef}
                alt="Photo preview"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                {file.name}
              </p>
              {compressedSizeInfo ? (
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {(compressedSizeInfo.original / 1024 / 1024).toFixed(1)} MB {'→'}{' '}
                  {(compressedSizeInfo.compressed / 1024 / 1024).toFixed(1)} MB
                </p>
              ) : (
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </p>
              )}
              {renderGpsIndicators()}
            </div>
            {photoStatus !== 'uploaded' && !disabled && (
              <button
                type="button"
                onClick={handleRemove}
                className="flex-shrink-0 p-1 rounded-full hover:bg-gray-100 transition-colors"
                aria-label="Remove photo"
                data-testid="photo-remove-btn"
              >
                <XCircle className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              </button>
            )}
          </div>
        </div>
      )}

      {photoStatus === 'uploading' && (
        <div
          className="flex items-center gap-2 p-3 rounded-lg text-sm"
          style={{ backgroundColor: 'rgba(59,130,246,0.06)', color: '#2563eb' }}
          role="status"
        >
          <RefreshCw className="w-4 h-4 animate-spin" />
          Uploading photo...
        </div>
      )}

      {photoStatus === 'uploaded' && (
        <div
          className="flex items-center gap-2 p-3 rounded-lg text-sm"
          style={{ backgroundColor: 'rgba(34,197,94,0.06)', color: '#16a34a' }}
          role="status"
        >
          <CheckCircle className="w-4 h-4" />
          Photo uploaded
        </div>
      )}

      {photoError && (
        <div
          className="flex items-center gap-2 p-3 rounded-lg text-sm"
          style={{ backgroundColor: 'rgba(220,38,38,0.06)', color: '#b91c1c' }}
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {photoError}
        </div>
      )}
    </div>
  );
}
