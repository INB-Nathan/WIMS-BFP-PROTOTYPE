'use client';

import { AlertTriangle } from 'lucide-react';

export function CalmEmergencyBlock() {
  return (
    <div
      className="mx-6 mt-4 rounded-xl border px-4 py-3.5 relative overflow-hidden"
      style={{
        backgroundColor: 'var(--calm-amber-bg)',
        borderColor: 'var(--calm-amber-border)',
      }}
    >
      {/* Left accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
        style={{ backgroundColor: 'var(--calm-amber-icon)' }}
      />

      {/* Icon in amber circle */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center mb-2"
        style={{ backgroundColor: 'rgba(251,191,36,0.20)' }}
      >
        <AlertTriangle
          className="w-4 h-4"
          style={{ color: 'var(--calm-amber-icon)' }}
          aria-hidden="true"
        />
      </div>

      <div className="space-y-1.5 text-sm pl-8">
        <p style={{ color: 'var(--text-primary)' }}>
          Call 911 now if anyone is in immediate danger.{' '}
          <span lang="fil" style={{ color: 'var(--bilingual-color)' }}>
            Tumawag sa 911 kung may tao sa agarang panganib.
          </span>
        </p>
        <p style={{ color: 'var(--text-secondary)' }}>
          Move away from smoke or fire.{' '}
          <span lang="fil" style={{ color: 'var(--bilingual-color)' }}>
            Umatras mula sa usok o sunog.
          </span>
        </p>
        <p style={{ color: 'var(--text-secondary)' }}>
          Do not get closer to take photos.{' '}
          <span lang="fil" style={{ color: 'var(--bilingual-color)' }}>
            Huwag lumapit para kumuha ng litrato.
          </span>
        </p>
      </div>
    </div>
  );
}