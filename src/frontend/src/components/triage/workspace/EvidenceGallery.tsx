'use client';

import { useState } from 'react';
import type { WorkspacePhoto } from '@/types/triage-workspace';

interface EvidenceGalleryProps {
  reportId: number;
  photos: WorkspacePhoto[];
}

type LoadState = 'loading' | 'loaded' | 'unavailable';

function safeContentUrl(reportId: number, photo: WorkspacePhoto): string | null {
  const expected = `/api/triage/reports/${reportId}/photos/${encodeURIComponent(photo.photo_id)}/content`;
  return photo.content_url === expected ? expected : null;
}

export function EvidenceGallery({ reportId, photos }: EvidenceGalleryProps) {
  const [states, setStates] = useState<Record<string, LoadState>>(() =>
    Object.fromEntries(photos.map((photo) => [photo.photo_id, 'loading'])),
  );

  if (photos.length === 0) {
    return <p role="status" className="rounded-lg border border-slate-200 p-4 text-sm text-slate-600">No image evidence submitted.</p>;
  }

  const loaded = Object.values(states).filter((state) => state === 'loaded').length;
  const unavailable = Object.values(states).filter((state) => state === 'unavailable').length;

  return (
    <section aria-labelledby="image-evidence-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="image-evidence-heading" className="text-lg font-semibold text-slate-950">Sanitized image evidence</h2>
        <span role="status" aria-live="polite" className="text-xs text-slate-600">
          {loaded} loaded{unavailable ? `, ${unavailable} unavailable` : ''}
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {photos.map((photo, index) => {
          const contentUrl = safeContentUrl(reportId, photo);
          const state = contentUrl ? states[photo.photo_id] ?? 'loading' : 'unavailable';
          return (
            <article key={photo.photo_id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {contentUrl && state !== 'unavailable' ? (
                // Backend route serves sanitized bytes with no-store and nosniff.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={contentUrl}
                  alt={`Sanitized evidence image ${index + 1} for report ${reportId}`}
                  className="h-56 w-full object-contain bg-slate-100"
                  onLoad={() => setStates((current) => ({ ...current, [photo.photo_id]: 'loaded' }))}
                  onError={() => setStates((current) => ({ ...current, [photo.photo_id]: 'unavailable' }))}
                />
              ) : (
                <div role="status" className="flex h-56 items-center justify-center bg-slate-100 px-6 text-center text-sm text-slate-600">
                  Sanitized image unavailable. Remaining evidence is still usable.
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 p-4 text-xs">
                <dt className="text-slate-500">Dimensions</dt><dd>{photo.image_width} × {photo.image_height}</dd>
                <dt className="text-slate-500">Capture time</dt><dd>{photo.capture_time ? new Date(photo.capture_time).toLocaleString() : 'Unavailable'}</dd>
                <dt className="text-slate-500">EXIF GPS</dt><dd>{photo.exif_available ? 'Available' : 'Unavailable'}</dd>
                <dt className="text-slate-500">GPS consensus</dt><dd>{photo.gps_consensus ?? 'Unavailable'}</dd>
                <dt className="text-slate-500">Report distance</dt><dd>{photo.image_to_report_distance_m === null ? 'Unavailable' : `${Math.round(photo.image_to_report_distance_m)} m`}</dd>
                <dt className="text-slate-500">Source</dt><dd>{photo.evidence_source ?? 'Unavailable'}</dd>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}
