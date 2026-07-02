'use client';

import { useState, useCallback } from 'react';

type ExportState = 'idle' | 'queued' | 'polling' | 'downloading' | 'done' | 'error';

export function useWorkflowExport() {
  const [state, setState] = useState<ExportState>('idle');
  const [error, setError] = useState<string | null>(null);

  const exportWorkflow = useCallback(async (
    workflowType: string,
    body: Record<string, unknown>,
  ) => {
    setState('queued');
    setError(null);
    try {
      const resp = await fetch(`/api/analytics/export/workflow/${workflowType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const detail = await resp.json().catch(() => ({}));
        throw new Error((detail as Record<string, unknown>).detail as string || 'Export request failed');
      }
      const { task_id } = await resp.json() as { task_id: string };

      setState('polling');
      const maxAttempts = 30;
      let blob: Blob | null = null;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const path = `/api/analytics/export/${encodeURIComponent(task_id)}`;
          const downloadResp = await fetch(path, { credentials: 'include' });
          if (!downloadResp.ok) continue;
          blob = await downloadResp.blob();
          if (blob && blob.size > 0) break;
        } catch { /* still pending */ }
      }
      if (!blob || blob.size === 0) {
        setError('Export is taking longer than expected. Check back shortly.');
        setState('error');
        return;
      }
      const url = URL.createObjectURL(blob);
      const ext = workflowType === 'heatmap' ? 'png' : 'xlsx';
      const filename = `wims-${workflowType}-${new Date().toISOString().split('T')[0]}.${ext}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
      setState('error');
    }
  }, []);

  const reset = useCallback(() => {
    setState('idle');
    setError(null);
  }, []);

  return { state, error, exportWorkflow, reset };
}
