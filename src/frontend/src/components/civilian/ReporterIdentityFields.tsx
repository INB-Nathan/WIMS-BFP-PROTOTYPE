'use client';

import type { SafetyStatus } from '@/lib/api';

const LIFE_SAFETY: SafetyStatus[] = ['I_NEED_HELP', 'SOMEONE_ELSE_NEEDS_HELP'];

export interface ReporterIdentityFieldsProps {
  authenticatedCivilian: boolean;
  reporterName: string;
  reporterPhone: string;
  safetyStatus: SafetyStatus;
  onChange: (next: { reporterName: string; reporterPhone: string }) => void;
}

export function reporterIdentityComplete(
  authenticatedCivilian: boolean,
  reporterName: string,
  reporterPhone: string,
  safetyStatus: SafetyStatus,
): boolean {
  if (authenticatedCivilian) return true;
  return Boolean(
    reporterName.trim() &&
      (LIFE_SAFETY.includes(safetyStatus) || reporterPhone.trim()),
  );
}

export function ReporterIdentityFields({
  authenticatedCivilian,
  reporterName,
  reporterPhone,
  safetyStatus,
  onChange,
}: ReporterIdentityFieldsProps) {
  if (authenticatedCivilian) {
    return (
      <section aria-labelledby="reporter-details-heading" data-testid="profile-reporter-identity">
        <h3 id="reporter-details-heading" className="text-sm font-semibold">
          Submitter details
        </h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Your account profile will identify you as reporter. Direct-eyewitness details below remain separate.
        </p>
      </section>
    );
  }

  const phoneRequired = !LIFE_SAFETY.includes(safetyStatus);
  return (
    <fieldset className="space-y-3" data-testid="anonymous-reporter-identity">
      <legend className="text-sm font-semibold">Submitter details</legend>
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        These identify person submitting report, not necessarily direct eyewitness.
      </p>
      <div>
        <label htmlFor="reporter-name" className="block text-xs font-medium mb-1">
          Reporter name <span aria-hidden="true" style={{ color: '#dc2626' }}>*</span>
        </label>
        <input
          id="reporter-name"
          value={reporterName}
          onChange={(event) => onChange({ reporterName: event.target.value, reporterPhone })}
          autoComplete="name"
          className="form-input"
          aria-required="true"
        />
      </div>
      <div>
        <label htmlFor="reporter-phone" className="block text-xs font-medium mb-1">
          Reporter phone {phoneRequired ? <span aria-hidden="true" style={{ color: '#dc2626' }}>*</span> : '(optional for life-safety reports)'}
        </label>
        <input
          id="reporter-phone"
          type="tel"
          value={reporterPhone}
          onChange={(event) => onChange({ reporterName, reporterPhone: event.target.value })}
          autoComplete="tel"
          className="form-input"
          aria-required={phoneRequired}
        />
      </div>
    </fieldset>
  );
}
