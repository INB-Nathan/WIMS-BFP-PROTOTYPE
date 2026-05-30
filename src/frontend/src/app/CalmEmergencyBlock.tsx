'use client';

import { AlertTriangle, Shield, Phone } from 'lucide-react';

export function CalmEmergencyBlock() {
  return (
    <div
      className="mx-4 mt-4 rounded-xl p-4"
      style={{
        backgroundColor: 'var(--calm-amber-bg)',
        border: '1px solid var(--calm-amber-border)',
      }}
    >
      {/* Header row */}
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'rgba(234,179,8,0.18)' }}
        >
          <Shield className="w-4.5 h-4.5" style={{ color: 'var(--calm-amber-icon)' }} />
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            Safety First
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Kaligtasan Muna
          </p>
        </div>
      </div>

      {/* Three-rule list */}
      <ul className="space-y-2 text-sm" style={{ color: 'var(--text-primary)' }}>
        <li className="flex items-start gap-2">
          <Phone className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--calm-amber-icon)' }} />
          <span>
            Call 911 now if anyone is in immediate danger.{' '}
            <span lang="fil" style={{ color: 'var(--bilingual-color)' }}>
              Tumawag sa 911 kung may tao sa agarang panganib.
            </span>
          </span>
        </li>
        <li className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--calm-amber-icon)' }} />
          <span>
            Move away from smoke or fire.{' '}
            <span lang="fil" style={{ color: 'var(--bilingual-color)' }}>
              Umatras mula sa usok o sunog.
            </span>
          </span>
        </li>
        <li className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--calm-amber-icon)' }} />
          <span>
            Do not get closer to take photos.{' '}
            <span lang="fil" style={{ color: 'var(--bilingual-color)' }}>
              Huwag lumapit para kumuha ng litrato.
            </span>
          </span>
        </li>
      </ul>
    </div>
  );
}
