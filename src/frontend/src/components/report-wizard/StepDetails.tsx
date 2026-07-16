'use client';

import { useState } from 'react';
import { ChevronDown, AlertTriangle } from 'lucide-react';

export interface StepDetailsProps {
  description: string;
  contactName: string;
  contactPhone: string;
  notes: string;
  onChange: (next: { description: string; contactName: string; contactPhone: string; notes: string }) => void;
}

/**
 * Step 4 — Details. Description REQUIRED. Optional contact + notes are behind
 * an "Add more detail" progressive-disclosure section (Issue #613).
 */
export function StepDetails({ description, contactName, contactPhone, notes, onChange }: StepDetailsProps) {
  const [showMore, setShowMore] = useState(
    Boolean(contactName || contactPhone || notes),
  );

  return (
    <div className="space-y-4">
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
          style={{ backgroundColor: 'var(--input-bg)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
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
        style={{ color: 'var(--bfp-red, #dc2626)' }}
      >
        <ChevronDown className="w-4 h-4 transition-transform" style={{ transform: showMore ? 'rotate(180deg)' : 'none' }} />
        Add more detail
      </button>

      {showMore && (
        <div data-testid="more-detail" className="space-y-3">
          <div>
            <label htmlFor="contact-name" className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
              Contact name (optional)
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
              Contact phone (optional)
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
