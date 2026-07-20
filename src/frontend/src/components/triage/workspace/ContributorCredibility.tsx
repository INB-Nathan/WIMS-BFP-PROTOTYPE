'use client';

import { useState } from 'react';
import { revealTriageReporterContact } from '@/lib/api';
import type {
  ContactRevealResponse,
  ContributorCredibility as Credibility,
} from '@/types/triage-workspace';

interface ContributorCredibilityProps {
  reportId: number;
  credibility: Credibility;
}

export function ContributorCredibility({ reportId, credibility }: ContributorCredibilityProps) {
  const [expanded, setExpanded] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [contact, setContact] = useState<ContactRevealResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revealContact() {
    setRevealing(true);
    setError(null);
    try {
      setContact(await revealTriageReporterContact(reportId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Contact unavailable.');
    } finally {
      setRevealing(false);
    }
  }

  return (
    <section aria-labelledby="credibility-heading" className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="credibility-heading" className="text-lg font-semibold text-slate-950">Contributor credibility</h2>
          <p className="text-sm text-slate-600">
            {credibility.authenticated ? 'Authenticated contributor' : 'Anonymous reporter'}
            {credibility.badge ? ` · ${credibility.badge}` : ''}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      </div>

      <p className="mt-3 text-sm">Reliability score: <strong>{credibility.trust_score ?? 'Unavailable'}</strong></p>

      {expanded && (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Prior reports</dt><dd>{credibility.total_reports ?? 'Unavailable'}</dd>
          <dt className="text-slate-500">Actioned</dt><dd>{credibility.actioned_reports ?? 'Unavailable'}</dd>
          <dt className="text-slate-500">Pending</dt><dd>{credibility.pending_reports ?? 'Unavailable'}</dd>
          <dt className="text-slate-500">Evidence quality</dt><dd>{credibility.evidence_quality ?? 'Unavailable'}</dd>
          <dt className="text-slate-500">Active months</dt><dd>{credibility.active_months ?? 'Unavailable'}</dd>
        </dl>
      )}

      <div className="mt-4 border-t border-slate-200 pt-4">
        <p className="mb-2 text-xs text-slate-600">Contact reveal is explicit and recorded in sensitive audit.</p>
        {!contact ? (
          <button
            type="button"
            disabled={revealing}
            onClick={() => void revealContact()}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {revealing ? 'Revealing…' : 'Reveal contact'}
          </button>
        ) : (
          <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
            <p><strong>{contact.reporter_name}</strong></p>
            <p>{contact.reporter_phone ?? 'No phone supplied for this life-safety report.'}</p>
            <p className="mt-1 text-xs">Do not copy this contact into notes or persistent browser storage.</p>
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      </div>
    </section>
  );
}
