'use client';

import { Smartphone } from 'lucide-react';
import type { TerminalCitizenStatus } from '@/lib/api';
import { TERMINAL_OPTIONS } from './useTriageModalState';

export interface CitizenMessagePreviewProps {
  status: TerminalCitizenStatus;
  message: string;
  reportCount: number;
}

/**
 * Phone-card mock showing the exact civilian-facing message that will be
 * delivered for the current selection. Lets the operator see what a citizen
 * will read before they commit a terminal action.
 */
export function CitizenMessagePreview({ status, message, reportCount }: CitizenMessagePreviewProps) {
  const tone = TERMINAL_OPTIONS.find((o) => o.value === status)?.tone ?? 'standard';
  return (
    <div className="triage-citizen-preview" data-tone={tone}>
      <div className="triage-citizen-preview__chrome">
        <Smartphone className="h-3.5 w-3.5" />
        <span>Citizen message preview</span>
        <span className="triage-citizen-preview__count">{reportCount} report{reportCount === 1 ? '' : 's'}</span>
      </div>
      <div className="triage-citizen-preview__phone">
        <div className="triage-citizen-preview__notch" />
        <div className="triage-citizen-preview__screen">
          <div className="triage-citizen-preview__bubble">
            <div className="triage-citizen-preview__sender">BUREAU OF FIRE PROTECTION</div>
            <div className="triage-citizen-preview__status">{status.replaceAll('_', ' ')}</div>
            <p className="triage-citizen-preview__text">{message || 'No explanation entered.'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
