'use client';

import { AlertTriangle } from 'lucide-react';

export function CalmEmergencyBlock() {
  return (
    <div
      className="mx-6 mt-4 flex items-start gap-3 rounded-lg border px-4 py-3"
      style={{
        backgroundColor: 'rgba(251, 191, 36, 0.08)',
        borderColor: 'rgba(251, 191, 36, 0.4)',
      }}
    >
      <AlertTriangle
        className="w-4 h-4 mt-0.5 shrink-0"
        style={{ color: 'var(--color-amber-500, #f59e0b)' }}
        aria-hidden="true"
      />
      <div className="space-y-1 text-sm">
        <p style={{ color: 'var(--text-secondary)' }}>
          Call 911 now if anyone is in immediate danger /{' '}
          <span lang="fil">Tumawag sa 911 kung may tao sa agarang panganib</span>
        </p>
        <p style={{ color: 'var(--text-secondary)' }}>
          Move away from smoke or fire /{' '}
          <span lang="fil">Umatras mula sa usok o sunog</span>
        </p>
        <p style={{ color: 'var(--text-secondary)' }}>
          Do not get closer to take photos /{' '}
          <span lang="fil">Huwag lumapit para kumuha ng litrato</span>
        </p>
      </div>
    </div>
  );
}