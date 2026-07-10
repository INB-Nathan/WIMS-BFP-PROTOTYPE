'use client';

import { useState, useEffect, useRef } from 'react';
import { Camera, XCircle, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB
const GPS_TIMEOUT_MS = 10_000;

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
  /** When true, show an explanation that photos are unavailable while offline. */
  offlineExplanation?: boolean;
}

export function PhotoUpload({
  file,
  onFileChange,
  gps,
  onGpsChange,
  disabled = false,
  photoStatus,
  photoError,
  offlineExplanation = false,
}: PhotoUploadProps) {
  const [validationError, setValidationError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const previewImageRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gpsResolvedRef = useRef(false);
  const gpsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Validate size
    if (selected.size > MAX_SIZE_BYTES) {
      setValidationError('Photo must be under 5 MB.');
      onFileChange(null);
      onGpsChange(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    onFileChange(selected);
    requestGpsForPhoto();
  }

  function handleRemove() {
    onFileChange(null);
    onGpsChange(null);
    setValidationError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const isDisabled = disabled || photoStatus === 'uploading' || photoStatus === 'uploaded';

  // Offline explanation is shown when selecting or uploading is blocked by connectivity
  if (offlineExplanation && !file) {
    return (
      <div className="space-y-2" data-testid="photo-upload-offline">
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
          Attach a photo (optional)
        </p>
        <div
          className="flex items-center gap-2 p-3 rounded-lg text-sm"
          style={{ backgroundColor: 'rgba(245,158,11,0.06)', color: 'var(--text-secondary)' }}
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-500" />
          <span>
            Photos require an internet connection. Submit your report first, then add a photo when you have connection.
            <br />
            <span lang="fil">Ang mga litrato ay nangangailangan ng koneksyon sa internet.</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="photo-upload">
      <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        Attach a photo (optional)
      </p>
      <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
        Share a photo of the fire. JPEG or PNG, max 5 MB. One photo per report.
        <br />
        <span lang="fil">Mag-share ng litrato ng sunog. JPEG o PNG, max 5 MB. Isang litrato bawat report.</span>
      </p>

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

      {!file ? (
        <label
          className={`flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
            isDisabled ? 'opacity-50 cursor-not-allowed' : ''
          }`}
          style={{
            borderColor: 'var(--border-color)',
            backgroundColor: 'var(--content-bg)',
          }}
          data-testid="photo-upload-label"
        >
          <Camera className="w-8 h-8" style={{ color: 'var(--text-muted)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            {isDisabled ? 'Upload unavailable' : 'Tap to select a photo'}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {isDisabled ? '' : 'JPEG or PNG only'}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleFileSelect}
            disabled={isDisabled}
            className="sr-only"
            aria-label="Select a photo to upload"
            data-testid="photo-file-input"
          />
        </label>
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
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
              {gps ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  GPS captured
                </p>
              ) : (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  No GPS metadata
                </p>
              )}
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
