'use client';

import { PhotoUpload } from '@/components/civilian/PhotoUpload';
import { useNetworkStatus } from '@/lib/useNetworkStatus';
import type { PhotoGpsSample } from '@/components/civilian/PhotoUpload';
import type { ExifGpsData } from '@/lib/photoExif';

export interface StepPhotoProps {
  file: File | null;
  photoStatus: 'idle' | 'uploading' | 'uploaded' | 'failed';
  photoError: string | null;
  photoGps: PhotoGpsSample | null;
  photoExif: ExifGpsData | null;
  pendingCount: number;
  onChange: (next: {
    file: File | null;
    photoGps: PhotoGpsSample | null;
    photoExif: ExifGpsData | null;
    photoStatus: 'idle' | 'uploading' | 'uploaded' | 'failed';
    photoError: string | null;
  }) => void;
}

/**
 * Step 2 — Photo (optional). Thin wrapper around the shared PhotoUpload.
 */
export function StepPhoto({ file, photoStatus, photoError, photoGps, photoExif, pendingCount, onChange }: StepPhotoProps) {
  const { isOnline } = useNetworkStatus();
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
          Add a photo <span className="text-xs font-normal" style={{ color: 'var(--text-secondary)' }}>(optional)</span>
        </p>
        <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
          A photo can help BFP confirm the report. Do not get closer to take one if it is unsafe.
        </p>
      </div>
      <PhotoUpload
        file={file}
        onFileChange={(f) => onChange({ file: f, photoGps, photoExif, photoStatus: 'idle', photoError: null })}
        gps={photoGps}
        onGpsChange={(g) => onChange({ file, photoGps: g, photoExif, photoStatus, photoError })}
        onExifChange={(e) => onChange({ file, photoGps, photoExif: e, photoStatus, photoError })}
        disabled={photoStatus === 'uploading'}
        photoStatus={photoStatus}
        photoError={photoError}
        online={isOnline}
        pendingCount={pendingCount}
      />
    </div>
  );
}
