'use client';

import { AlertTriangle, ShieldCheck } from 'lucide-react';

/**
 * Persistent, NON-DISMISSIBLE safety banner shown on every step of the
 * Report Wizard (Issue #613). Replaces the old separate Safety step.
 */
export function SafetyBanner() {
  return (
    <div
      role="alert"
      data-testid="safety-banner"
      className="flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium relative z-10"
      style={{
        backgroundColor: '#1f2937', // dark slate base for high visibility
        color: '#ffffff',
        borderBottom: '2px solid #dc2626',
      }}
    >
      <ShieldCheck className="w-4 h-4 flex-shrink-0" style={{ color: '#fca5a5' }} />
      <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: '#fca5a5' }} />
      <span>
        If you are in immediate danger, call 911 or your local BFP hotline now.
      </span>
    </div>
  );
}
