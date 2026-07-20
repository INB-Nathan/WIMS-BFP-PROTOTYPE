'use client';

import { useState } from 'react';
import { ChevronDown, AlertTriangle } from 'lucide-react';
import type { SafetyStatus } from '@/lib/api';
import { ReporterIdentityFields } from '@/components/civilian/ReporterIdentityFields';

export interface StepDetailsProps {
  description: string;
  reporterName: string;
  reporterPhone: string;
  authenticatedCivilian: boolean;
  safetyStatus: SafetyStatus;
  contactName: string;
  contactPhone: string;
  notes: string;
  onReporterChange: (next: { reporterName: string; reporterPhone: string }) => void;
  onSafetyStatusChange: (status: SafetyStatus) => void;
  onChange: (next: { description: string; contactName: string; contactPhone: string; notes: string }) => void;
}

/**
 * Step 4 — Details. Description REQUIRED. Optional contact + notes are behind
 * an "Add more detail" progressive-disclosure section (Issue #613).
 */
export function StepDetails({
  description,
  reporterName,
  reporterPhone,
  authenticatedCivilian,
  safetyStatus,
  contactName,
  contactPhone,
  notes,
  onReporterChange,
  onSafetyStatusChange,
  onChange,
}: StepDetailsProps) {
  const [showMore, setShowMore] = useState(
    Boolean(contactName || contactPhone || notes),
  );

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="safety-status" className="block text-sm font-medium mb-1.5">
          Immediate safety status
        </label>
        <select
          id="safety-status"
          value={safetyStatus}
          onChange={(event) => onSafetyStatusChange(event.target.value as SafetyStatus)}
          className="form-input"
        >
          <option value="UNKNOWN">Unknown / not specified</option>
          <option value="I_AM_SAFE">I am safe</option>
          <option value="I_NEED_HELP">I need help</option>
          <option value="SOMEONE_ELSE_NEEDS_HELP">Someone else needs help</option>
        </select>
      </div>

      <ReporterIdentityFields
        authenticatedCivilian={authenticatedCivilian}
        reporterName={reporterName}
        reporterPhone={reporterPhone}
        safetyStatus={safetyStatus}
        onChange={onReporterChange}
      />
      <div>
        <label htmlFor="description" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>
          Describe what is happening <span style={{ color: '#dc2626' }}>*</span>
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => onChange({ description: e.target.value, contactName, contactPhone, notes })}
          placeholder="What is on fire, how big, who is affected…"
          rows={5}
          data-testid="description-input"
          className="w-full rounded-xl border px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        />
        {description.trim().length === 0 && (
          <p className="text-xs mt-1 flex items-center gap-1" style={{ color: '#b91c1c' }}>
            <AlertTriangle className="w-3 h-3" /> A description is required to submit.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        data-testid="add-more-detail"
        aria-expanded={showMore}
        className="flex items-center gap-1.5 text-sm font-medium"
        style={{ color: 'var(--red)' }}
      >
        <ChevronDown className="w-4 h-4 transition-transform" style={{ transform: showMore ? 'rotate(180deg)' : 'none' }} />
        Add more detail
      </button>

      {showMore && (
        <div data-testid="more-detail" className="space-y-3">
          <div>
            <label htmlFor="contact-name" className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
              Direct eyewitness name (optional)
            </label>
            <input
              id="contact-name"
              type="text"
              value={contactName}
              onChange={(e) => onChange({ description, contactName: e.target.value, contactPhone, notes })}
              className="form-input"
              style={{ fontSize: '0.875rem' }}
            />
          </div>
          <div>
            <label htmlFor="contact-phone" className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
              Direct eyewitness phone (optional)
            </label>
            <input
              id="contact-phone"
              type="tel"
              value={contactPhone}
              onChange={(e) => onChange({ description, contactName, contactPhone: e.target.value, notes })}
              className="form-input"
              style={{ fontSize: '0.875rem' }}
            />
          </div>
          <div>
            <label htmlFor="notes" className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
              Additional notes (optional)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => onChange({ description, contactName, contactPhone, notes: e.target.value })}
              rows={3}
              className="form-input"
              style={{ fontSize: '0.875rem', resize: 'vertical' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
