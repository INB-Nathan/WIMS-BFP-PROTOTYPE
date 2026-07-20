'use client';

import { useMemo, useState } from 'react';
import { correctTriageReport, type TerminalCitizenStatus } from '@/lib/api';
import { ConfirmActionDialog } from '@/components/triage/ConfirmActionDialog';
import { TERMINAL_OPTIONS } from '@/components/triage/useTriageWorkflowState';
import type { WorkspaceReport } from '@/types/triage-workspace';

interface CorrectionActionPanelProps {
  reports: WorkspaceReport[];
  onComplete: (message: string) => Promise<void> | void;
  onError: (message: string) => void;
}

function isTerminal(status: string) {
  return status === 'ACTIONED' || status.startsWith('REJECTED_');
}

export function CorrectionActionPanel({ reports, onComplete, onError }: CorrectionActionPanelProps) {
  const terminalReports = useMemo(() => reports.filter((report) => isTerminal(report.status)), [reports]);
  const [reportId, setReportId] = useState<number | null>(terminalReports[0]?.report_id ?? null);
  const [status, setStatus] = useState<TerminalCitizenStatus>('ACTIONED');
  const [explanation, setExplanation] = useState('Your report was reviewed and action was taken.');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (terminalReports.length === 0) return null;

  function requestConfirmation() {
    if (!reportId || !explanation.trim() || !reason.trim()) {
      onError('Correction requires a report, replacement citizen explanation, and audit reason.');
      return;
    }
    setConfirming(true);
  }

  async function applyCorrection() {
    if (!reportId) return;
    setConfirming(false);
    setBusy(true);
    try {
      await correctTriageReport(reportId, {
        status,
        status_explanation: explanation.trim(),
        correction_reason: reason.trim(),
      });
      setReason('');
      await onComplete(`Corrected terminal decision for report #${reportId}.`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Correction failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="correction-heading" className="rounded-xl border border-amber-300 bg-amber-50 p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Audited workflow</p>
      <h2 id="correction-heading" className="mt-1 text-lg font-semibold text-slate-950">Correct a terminal decision</h2>
      <p className="mt-1 text-sm text-slate-700">Only previously terminal reports appear here. Correction requires a replacement citizen message and an internal audit reason.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <label className="text-sm font-medium">Report
          <select value={reportId ?? ''} onChange={(event) => setReportId(Number(event.target.value))} className="mt-1 block w-full rounded-md border border-slate-300 bg-white p-2">
            {terminalReports.map((report) => <option key={report.report_id} value={report.report_id}>#{report.report_id} · {report.status}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Replacement status
          <select value={status} onChange={(event) => setStatus(event.target.value as TerminalCitizenStatus)} className="mt-1 block w-full rounded-md border border-slate-300 bg-white p-2">
            {TERMINAL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Audit reason
          <input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 bg-white p-2" />
        </label>
      </div>
      <label className="mt-4 block text-sm font-medium">Replacement citizen-visible explanation
        <textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} rows={3} className="mt-1 block w-full rounded-md border border-slate-300 bg-white p-2" />
      </label>
      <button type="button" disabled={busy} onClick={requestConfirmation} className="mt-4 rounded-md bg-amber-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? 'Applying correction…' : 'Review correction'}
      </button>

      <ConfirmActionDialog
        open={confirming}
        title={`Confirm correction for report #${reportId ?? ''}`}
        body="This replaces a terminal decision, notifies the citizen with the new explanation, and writes an audit event."
        confirmLabel="Apply correction"
        confirmTone="caution"
        preview={<div className="space-y-1 text-sm"><p><strong>Status:</strong> {status}</p><p><strong>Citizen message:</strong> {explanation}</p><p><strong>Audit reason:</strong> {reason}</p></div>}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void applyCorrection()}
      />
    </section>
  );
}
