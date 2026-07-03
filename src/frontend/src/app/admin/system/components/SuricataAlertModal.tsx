'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeNarrative } from '@/lib/xaiNarrativeNormalizer';
import {
  analyzeSecurityLog,
  checkAnalysisStatus,
  checkRecommendedActionStatus,
  generateRecommendedAction,
  updateAdminSecurityLog,
  createIncidentFromAlert,
  fetchRelatedAuditLogs,
} from '@/lib/api/admin';
import type { RelatedAlertItem, RelatedAuditItem } from '@/lib/api/legacy';
import { ApiRequestError } from '@/lib/api/transport';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface SecurityLog {
  log_id: number;
  timestamp: string | null;
  source_ip: string | null;
  destination_ip: string | null;
  suricata_sid: number | null;
  severity_level: string | null;
  raw_payload: string | null;
  xai_narrative: string | null;
  xai_confidence: number | null;
  admin_action_taken: string | null;
  resolved_at: string | null;
  reviewed_by: string | null;
  hitl_decision?: {
    action?: string;
    note?: string | null;
    reviewed_at?: string | null;
    reviewed_by?: string | null;
  } | null;
}

interface SuricataAlertModalProps {
  log: SecurityLog;
  onClose: () => void;
  onDecisionComplete: (logId: number, updatedLog: Partial<SecurityLog>) => void;
}

// ---------------------------------------------------------------------------
// HITL helpers
// ---------------------------------------------------------------------------

const HITL_ACTION_LABELS: Record<string, string> = {
  CONFIRM_THREAT: 'Confirmed Threat',
  FALSE_POSITIVE: 'False Positive',
  REQUEST_MORE_INFO: 'More Info Requested',
};

function formatHitlAction(action: string): string {
  return HITL_ACTION_LABELS[action] ?? action.replaceAll('_', ' ').toLowerCase();
}

function hitlErrorMessage(error: unknown): string {
  const message = (error as { message?: string })?.message ?? 'Request failed';
  if (/Request failed:\s*500/i.test(message)) {
    return 'Server failed while applying the threat decision. The alert was not updated; please retry or check backend logs.';
  }
  return message;
}

function isAiInferenceConflict(error: unknown): boolean {
  if (!(error instanceof ApiRequestError) || error.status !== 409) return false;
  const message = String(error.message ?? error.detail ?? '');
  return /already running|in progress|inference/i.test(message);
}

// ---------------------------------------------------------------------------
// Inline SVG icon components (no external icon dependency)
// ---------------------------------------------------------------------------

function IconOverview() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="8" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
    </svg>
  );
}

function IconAiAnalysis() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  );
}

function IconFile() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function IconBook() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function IconCheckCircle({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

function IconXCircle({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function IconSparkles() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <path d="M12 3l1.5 3.5L17 8l-3.5 1.5L12 13l-1.5-3.5L7 8l3.5-1.5L12 3z" />
      <path d="M12 17l1.5-1.5L17 14l-3.5-1.5L12 9l-1.5 3.5L7 14l3.5 1.5L12 17z" />
    </svg>
  );
}

function IconQuestion() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconFileText() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function IconSpinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
  HIGH: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800',
  MEDIUM: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  LOW: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
};

function severityBadgeClass(level: string | null): string {
  return SEVERITY_STYLES[level ?? ''] ?? SEVERITY_STYLES.LOW;
}

/** Inline severity badge (JSX) used in the Evidence tab's related alerts list. */
const severityBadge = (level: string | null) => {
  const colors: Record<string, string> = {
    CRITICAL: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    HIGH: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
    MEDIUM: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300',
    LOW: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  };
  const lvl = level?.toUpperCase() ?? '';
  return (
    <span
      className={`inline-block px-1.5 py-0.5 text-[10px] font-bold rounded ${
        colors[lvl] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
      }`}
    >
      {lvl || '\u2014'}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function SuricataAlertModal({ log, onClose, onDecisionComplete }: SuricataAlertModalProps) {
  // ── Tab state ────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<
    'overview' | 'ai-analysis' | 'raw-payload' | 'evidence' | 'history'
  >('overview');

  // ── AI analysis state ────────────────────────────────────────────────
  const [analysisState, setAnalysisState] = useState<
    'idle' | 'fetching' | 'analyzing' | 'normalizing' | 'complete' | 'error'
  >('idle');
  const [analysisElapsed, setAnalysisElapsed] = useState(0);
  const analysisStartRef = useRef<number | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<'idle' | 'generating' | 'complete' | 'error'>('idle');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActionBackgroundRunning, setIsActionBackgroundRunning] = useState(false);
  const actionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Whether analysis was started in a previous session (e.g. user navigated
  // away and came back).  We detect this via the GET /analyze-status endpoint.
  const [isBackgroundRunning, setIsBackgroundRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Decision / HITL state ────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hitlMessage, setHitlMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [createIncidentResult, setCreateIncidentResult] = useState<{
    incident_id: number;
  } | null>(null);

  // ── Evidence state ───────────────────────────────────────────────────
  const [relatedEvidence, setRelatedEvidence] = useState<RelatedAuditItem[] | null>(null);
  const [relatedAlerts, setRelatedAlerts] = useState<RelatedAlertItem[] | null>(null);
  const [isLoadingEvidence, setIsLoadingEvidence] = useState(false);
  const [relatedEvidenceCount, setRelatedEvidenceCount] = useState<number | null>(null);
  const [relatedEvidenceError, setRelatedEvidenceError] = useState<string | null>(null);

  // ── Refs ─────────────────────────────────────────────────────────────
  const abortRef = useRef<AbortController | null>(null);

  // ── Derived data ─────────────────────────────────────────────────────

  const parsedNarrative = useMemo(() => normalizeNarrative(log.xai_narrative), [log.xai_narrative]);

  const derivedFields = useMemo(() => {
    if (!log.raw_payload) return { protocol: null, port: null };
    try {
      const parsed = JSON.parse(log.raw_payload);
      const proto: string | null = parsed.proto ?? null;
      const srcPort: number | null = parsed.src_port ?? null;
      const destPort: number | null = parsed.dest_port ?? null;
      let port: string | null = null;
      if (srcPort || destPort) {
        port = `${srcPort ?? '?'} \u2192 ${destPort ?? '?'}`;
      }
      return { protocol: proto ? String(proto).toUpperCase() : null, port };
    } catch {
      return { protocol: null, port: null };
    }
  }, [log.raw_payload]);

  // Whether the alert has been resolved / reviewed
  const isReviewed = !!log.admin_action_taken;
  const isConfirmedThreat = log.admin_action_taken === 'Confirmed Threat';
  const isFalsePositive = log.admin_action_taken === 'False Positive';
  const isMoreInfoRequested = log.admin_action_taken === 'More Info Requested';

  // Whether AI threat analysis is currently running — disables all action buttons
  // to minimize CPU contention on the Ollama model.
  const isAnalysisRunning =
    analysisState === 'fetching' ||
    analysisState === 'analyzing' ||
    analysisState === 'normalizing' ||
    isBackgroundRunning ||
    actionState === 'generating' ||
    isActionBackgroundRunning;

  // ── Effects ──────────────────────────────────────────────────────────

  // Tab reset on log change
  useEffect(() => {
    setActiveTab('overview');
    setAnalysisState('idle');
    setAnalysisElapsed(0);
    setAnalysisError(null);
    setActionState('idle');
    setActionError(null);
    setIsActionBackgroundRunning(false);
    setRelatedEvidence(null);
    setRelatedAlerts(null);
    setRelatedEvidenceError(null);
    setHitlMessage(null);
    setCreateIncidentResult(null);
    setIsBackgroundRunning(false);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (actionPollRef.current) {
      clearInterval(actionPollRef.current);
      actionPollRef.current = null;
    }
  }, [log.log_id]);

  // Check if a previous analysis is still running in the background
  // (e.g. user navigated away and came back while analysis was in progress).
  useEffect(() => {
    if (log.xai_narrative) return; // already completed, nothing to check

    let cancelled = false;
    (async () => {
      try {
        const { status } = await checkAnalysisStatus(log.log_id);
        if (cancelled) return;
        if (status === 'running') {
          setIsBackgroundRunning(true);
        }
      } catch {
        // Ignore — status endpoint is best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [log.log_id, log.xai_narrative]);

  // Poll for completion when a background analysis is running
  useEffect(() => {
    if (!isBackgroundRunning) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const { status } = await checkAnalysisStatus(log.log_id);
        if (status !== 'running') {
          setIsBackgroundRunning(false);
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          // Analysis finished while we were away — fetch the cached result
          // from the existing /analyze endpoint (returns immediately when
          // xai_narrative is already populated).
          if (status === 'completed') {
            try {
              const updated = await analyzeSecurityLog(log.log_id);
              onDecisionComplete(log.log_id, {
                xai_narrative: updated.xai_narrative ?? undefined,
                xai_confidence: updated.xai_confidence ?? undefined,
              });
            } catch {
              // Fetch is best-effort; parent will re-read on next open
            }
          }
        }
      } catch {
        // Polling is best-effort
      }
    }, 5000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [isBackgroundRunning, log.log_id, onDecisionComplete]);

  // Check/poll stage-2 recommended action if it was started before a refresh/reopen.
  useEffect(() => {
    if (!log.xai_narrative || parsedNarrative.recommendedAction) return;

    let cancelled = false;
    (async () => {
      try {
        const { status } = await checkRecommendedActionStatus(log.log_id);
        if (cancelled) return;
        if (status === 'running') {
          setIsActionBackgroundRunning(true);
          setActionState('generating');
        }
      } catch {
        // best-effort only
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [log.log_id, log.xai_narrative, parsedNarrative.recommendedAction]);

  useEffect(() => {
    if (!isActionBackgroundRunning) {
      if (actionPollRef.current) {
        clearInterval(actionPollRef.current);
        actionPollRef.current = null;
      }
      return;
    }
    actionPollRef.current = setInterval(async () => {
      try {
        const { status } = await checkRecommendedActionStatus(log.log_id);
        if (status !== 'running') {
          setIsActionBackgroundRunning(false);
          if (actionPollRef.current) {
            clearInterval(actionPollRef.current);
            actionPollRef.current = null;
          }
          if (status === 'completed') {
            try {
              const updated = await generateRecommendedAction(log.log_id);
              setActionState('complete');
              onDecisionComplete(log.log_id, {
                xai_narrative: updated.xai_narrative ?? undefined,
                xai_confidence: updated.xai_confidence ?? undefined,
              });
            } catch {
              // best-effort; parent will refresh on next open
            }
          }
        }
      } catch {
        // Polling is best-effort
      }
    }, 5000);
    return () => {
      if (actionPollRef.current) {
        clearInterval(actionPollRef.current);
        actionPollRef.current = null;
      }
    };
  }, [isActionBackgroundRunning, log.log_id, onDecisionComplete]);

  // Stepper timer — tracks total elapsed since analysis first started, not per-stage
  useEffect(() => {
    if (
      analysisState === 'fetching' ||
      analysisState === 'analyzing' ||
      analysisState === 'normalizing'
    ) {
      // Initialize the start ref on first entry into a running state
      // (subsequent stage transitions keep the original start)
      if (analysisStartRef.current === null) {
        analysisStartRef.current = Date.now();
      }
      const interval = setInterval(() => {
        setAnalysisElapsed((Date.now() - analysisStartRef.current!) / 1000);
      }, 200);
      return () => clearInterval(interval);
    }
    if (analysisState === 'error' || analysisState === 'idle') {
      setAnalysisElapsed(0);
      analysisStartRef.current = null;
    }
    // 'complete' — interval is already cleared; elapsed stays frozen at final value.
    // Ref is reset when log changes or user retries (via 'idle'/'error' branch above).
  }, [analysisState]);

  // Related evidence eager fetch on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchRelatedAuditLogs(log.log_id);
        if (!cancelled) {
          setRelatedEvidence(data.items);
          setRelatedAlerts(data.related_alerts);
          setRelatedEvidenceCount(data.items.length + data.related_alerts.length);
        }
      } catch {
        if (!cancelled) {
          setRelatedEvidence(null);
          setRelatedAlerts(null);
          setRelatedEvidenceCount(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [log.log_id]);

  // ── Handlers ─────────────────────────────────────────────────────────

  const cleanupAnalysis = () => {
    setAnalysisState('idle');
    setAnalysisElapsed(0);
    abortRef.current = null;
  };

  const handleAnalyze = async () => {
    if (log.xai_narrative) return;
    if (isSubmitting || isAnalysisRunning) return; // don't start analysis while decision in progress
    setAnalysisState('fetching');
    setAnalysisError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Stage 1: Fetching (simulated minimum dwell)
      await new Promise((r) => setTimeout(r, 500));
      if (controller.signal.aborted) {
        cleanupAnalysis();
        return;
      }
      setAnalysisState('analyzing');

      // Actual API call
      const updated = await analyzeSecurityLog(log.log_id);

      if (controller.signal.aborted) {
        cleanupAnalysis();
        return;
      }
      setAnalysisState('normalizing');

      // Stage 3: Normalizing (simulated minimum dwell)
      await new Promise((r) => setTimeout(r, 500));
      if (controller.signal.aborted) {
        cleanupAnalysis();
        return;
      }

      setAnalysisState('complete');
      onDecisionComplete(log.log_id, {
        xai_narrative: updated.xai_narrative ?? undefined,
        xai_confidence: updated.xai_confidence ?? undefined,
      });
    } catch (e: unknown) {
      if ((e as Error)?.name === 'AbortError') {
        cleanupAnalysis();
        return;
      }
      if (isAiInferenceConflict(e)) {
        setAnalysisState('idle');
        setAnalysisError(null);
        setIsBackgroundRunning(true);
        return;
      }
      setAnalysisState('error');
      setAnalysisError(
        (e as { message?: string })?.message ?? 'Analysis failed'
      );
    }
  };

  const handleCancelAnalysis = () => {
    abortRef.current?.abort();
    cleanupAnalysis();
  };

  const handleGenerateRecommendedAction = async () => {
    if (!log.xai_narrative || parsedNarrative.recommendedAction) return;
    setActionState('generating');
    setActionError(null);
    setIsActionBackgroundRunning(true);
    try {
      const updated = await generateRecommendedAction(log.log_id);
      setActionState('complete');
      setIsActionBackgroundRunning(false);
      onDecisionComplete(log.log_id, {
        xai_narrative: updated.xai_narrative ?? undefined,
        xai_confidence: updated.xai_confidence ?? undefined,
      });
    } catch (e: unknown) {
      if (isAiInferenceConflict(e)) {
        setActionState('generating');
        setIsActionBackgroundRunning(true);
        setActionError(null);
        return;
      }
      setActionState('error');
      setIsActionBackgroundRunning(false);
      setActionError((e as { message?: string })?.message ?? 'Failed to generate recommended action');
    }
  };

  const handleHitlDecision = async (action: string, note?: string) => {
    if (isAnalysisRunning) return; // don't submit decision while AI analysis is running
    setIsSubmitting(true);
    setHitlMessage(null);
    try {
      await updateAdminSecurityLog(log.log_id, { action, note });
      const label = formatHitlAction(action);
      setHitlMessage({
        type: 'success',
        text: `${label} applied to alert #${log.log_id}.`,
      });
      onDecisionComplete(log.log_id, {
        admin_action_taken: label,
        resolved_at:
          action === 'REQUEST_MORE_INFO' ? null : new Date().toISOString(),
        hitl_decision: { action, note: note ?? null },
      });
    } catch (e: unknown) {
      setHitlMessage({
        type: 'error',
        text: hitlErrorMessage(e),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateIncident = async () => {
    if (isAnalysisRunning) return; // don't create incident while AI analysis is running
    setIsSubmitting(true);
    setCreateIncidentResult(null);
    setHitlMessage(null);
    try {
      const result = await createIncidentFromAlert(log.log_id);
      setCreateIncidentResult({ incident_id: result.incident_id });
      onDecisionComplete(log.log_id, {
        admin_action_taken: 'Incident Created',
      });
    } catch (e: unknown) {
      setHitlMessage({
        type: 'error',
        text:
          (e as { message?: string })?.message ?? 'Create incident failed',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleViewRelatedEvidence = async () => {
    if (isAnalysisRunning && relatedEvidence === null) return; // don't fetch while AI analysis is running
    if (relatedEvidence !== null) {
      setActiveTab('evidence');
      return;
    }
    setIsLoadingEvidence(true);
    setRelatedEvidenceError(null);
    try {
      const data = await fetchRelatedAuditLogs(log.log_id);
      setRelatedEvidence(data.items);
      setRelatedAlerts(data.related_alerts);
      setRelatedEvidenceCount(data.items.length + data.related_alerts.length);
      setActiveTab('evidence');
    } catch (e: unknown) {
      setRelatedEvidenceError(
        (e as { message?: string })?.message ??
          'Failed to load related evidence'
      );
    } finally {
      setIsLoadingEvidence(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Render helpers
  // ═══════════════════════════════════════════════════════════════════════

  // ── Tab bar ──────────────────────────────────────────────────────────

  const tabs: Array<{
    key: typeof activeTab;
    label: string;
    icon: React.ReactNode;
  }> = [
    { key: 'overview', label: 'Overview', icon: <IconOverview /> },
    { key: 'ai-analysis', label: 'AI Analysis', icon: <IconAiAnalysis /> },
    { key: 'raw-payload', label: 'Raw Payload', icon: <IconFile /> },
    { key: 'evidence', label: 'Evidence', icon: <IconBook /> },
    { key: 'history', label: 'History', icon: <IconClock /> },
  ];

  const renderTabBar = () => (
    <div className="flex border-b border-gray-200 dark:border-gray-700 px-5 gap-0">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 transition-colors ${
              isActive
                ? 'border-purple-600 text-purple-700 dark:text-purple-400 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );

  // ── Alert header ─────────────────────────────────────────────────────

  const renderAlertHeader = () => {
    const statusLabel = isReviewed
      ? isConfirmedThreat
        ? 'Confirmed Threat'
        : isFalsePositive
          ? 'False Positive'
          : isMoreInfoRequested
            ? 'More Info Requested'
            : 'Reviewed'
      : 'Unreviewed';

    const statusBadgeClass = isReviewed
      ? isConfirmedThreat
        ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800'
        : isFalsePositive
          ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800'
          : isMoreInfoRequested
            ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
            : 'bg-gray-50 text-gray-700 border-gray-200'
      : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800';

    return (
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center text-purple-600 dark:text-purple-400">
            <IconShield />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-[var(--foreground)]">
                Suricata Alert &mdash; #{log.log_id}
              </h3>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded border ${severityBadgeClass(log.severity_level)}`}
              >
                {log.severity_level ?? '\u2014'}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              <span>
                {log.timestamp
                  ? new Date(log.timestamp).toLocaleString()
                  : '\u2014'}
              </span>
              {log.reviewed_by && (
                <span>Reviewed by: {log.reviewed_by}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${statusBadgeClass}`}
          >
            {statusLabel}
          </span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <IconXCircle className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  };

  // ── Progress Stepper ─────────────────────────────────────────────────

  const STEP_LABELS = [
    { label: 'Fetching', sub: 'Alert data loaded' },
    { label: 'Analyzing', sub: 'Ollama inference' },
    { label: 'Normalizing', sub: 'Structuring output' },
    { label: 'Complete', sub: 'Ready for review' },
  ];

  const getStepState = (index: number) => {
    const order = ['fetching', 'analyzing', 'normalizing', 'complete'] as const;
    const currentIdx = order.indexOf(analysisState as typeof order[number]);
    if (currentIdx === -1) return 'pending';
    if (index < currentIdx) return 'completed';
    if (index === currentIdx) return 'active';
    return 'pending';
  };

  const renderProgressStepper = () => (
    <div className="py-4">
      <div className="relative flex items-center justify-between">
        {/* Background connector line */}
        <div className="absolute top-3.5 left-0 right-0 h-[2px] bg-gray-200 dark:bg-gray-700" />
        {/* Filled connector line */}
        <div
          className="absolute top-3.5 left-0 h-[2px] bg-purple-600 transition-all duration-500"
          style={{
            width: `${
              (() => {
                const order = ['fetching', 'analyzing', 'normalizing', 'complete'];
                const idx = order.indexOf(analysisState);
                if (analysisState === 'complete') return '100%';
                if (idx <= 0) return '0%';
                return `${(idx / (order.length - 1)) * 100}%`;
              })()
            }`,
          }}
        />
        {STEP_LABELS.map((step, i) => {
          const state = getStepState(i);
          return (
            <div key={step.label} className="flex flex-col items-center z-10">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  state === 'completed'
                    ? 'bg-purple-600 text-white'
                    : state === 'active'
                      ? 'bg-purple-600 text-white animate-pulse'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
                }`}
              >
                {state === 'completed' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : state === 'active' ? (
                  <IconSpinner className="w-3.5 h-3.5" />
                ) : (
                  <span>{i + 1}</span>
                )}
              </div>
              <p
                className={`text-xs mt-1.5 font-medium ${
                  state === 'completed' || state === 'active'
                    ? 'text-purple-700 dark:text-purple-400'
                    : 'text-gray-400'
                }`}
              >
                {step.label}
              </p>
              <p
                className={`text-[10px] ${
                  state === 'completed' || state === 'active'
                    ? 'text-gray-500'
                    : 'text-gray-400'
                }`}
              >
                {step.sub}
              </p>
            </div>
          );
        })}
      </div>
      {/* Elapsed timer + Cancel */}
      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <IconClock />
          <span>Elapsed: {analysisElapsed.toFixed(1)}s</span>
        </div>
        <button
          onClick={handleCancelAnalysis}
          className="px-3 py-1 text-xs font-medium text-purple-700 border border-purple-300 rounded hover:bg-purple-50 dark:text-purple-400 dark:border-purple-700 dark:hover:bg-purple-950/40"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  const renderRecommendedActionStage = () => {
    if (!log.xai_narrative || parsedNarrative.recommendedAction) return null;

    const isRunning = actionState === 'generating' || isActionBackgroundRunning;
    return (
      <div className="col-span-2 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800 p-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-amber-700 dark:text-amber-300">
            {isRunning ? <IconSpinner /> : <IconInfo />}
          </div>
          <div className="flex-1 space-y-2">
            <div>
              <p className="text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider">
                Stage 2: Recommended Action
              </p>
              <p className="text-xs text-amber-800/80 dark:text-amber-200/80 mt-1">
                To keep the first AI narrative fast, response guidance is generated in a separate focused pass.
                This may take around 1–2 minutes and will stay available after refresh once complete.
              </p>
            </div>
            {actionError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                {actionError}
              </div>
            )}
            <button
              type="button"
              onClick={handleGenerateRecommendedAction}
              disabled={isRunning || isAnalysisRunning}
              className="px-3 py-1.5 bg-amber-600 text-white rounded text-sm font-medium hover:bg-amber-700 disabled:opacity-50 flex items-center gap-2"
            >
              {isRunning ? <IconSpinner /> : <IconSparkles />}
              {isRunning ? 'Generating Recommended Action…' : 'Generate Recommended Action'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── AI Analysis Card ─────────────────────────────────────────────────

  const renderAiAnalysisCard = () => {
    // State 0: Background analysis running (started in a previous session)
    if (isBackgroundRunning) {
      return (
        <div className="bg-purple-50 dark:bg-purple-950/40 p-4 rounded-lg border border-purple-100 dark:border-purple-800">
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-6 h-6 rounded-md bg-purple-600 flex items-center justify-center">
              <IconSparkles />
            </div>
            <h4 className="text-xs font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider">
              AI Threat Analysis in Progress
            </h4>
          </div>
          <p className="text-xs text-gray-500 mb-2">
            Analysis was started earlier and is still running. Waiting for
            completion&hellip;
          </p>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            Running via Ollama
          </div>
        </div>
      );
    }

    // State 1: No analysis yet → show Analyze button
    if (!log.xai_narrative && (analysisState === 'idle' || analysisState === 'error')) {
      return (
        <div className="bg-purple-50 dark:bg-purple-950/40 p-4 rounded-lg border border-purple-100 dark:border-purple-800">
          <div className="flex items-center gap-1.5 mb-3">
            <div className="w-6 h-6 rounded-md bg-purple-600 flex items-center justify-center">
              <IconSparkles />
            </div>
            <h4 className="text-xs font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider">
              AI Threat Analysis
            </h4>
          </div>
          {analysisState === 'error' && analysisError && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 dark:bg-red-950/40 dark:border-red-800 dark:text-red-300">
              {analysisError}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleAnalyze}
              className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
            >
              <IconSparkles />
              {analysisState === 'error' ? 'Retry Analysis' : 'Analyze with AI'}
            </button>
          </div>
        </div>
      );
    }

    // State 2: Analysis in progress → show stepper
    if (
      analysisState === 'fetching' ||
      analysisState === 'analyzing' ||
      analysisState === 'normalizing'
    ) {
      return (
        <div className="bg-purple-50 dark:bg-purple-950/40 p-4 rounded-lg border border-purple-100 dark:border-purple-800">
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-6 h-6 rounded-md bg-purple-600 flex items-center justify-center">
              <IconSparkles />
            </div>
            <h4 className="text-xs font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider">
              AI Threat Analysis in Progress
            </h4>
          </div>
          <p className="text-xs text-gray-500 mb-2">
            Running analysis via Ollama...
          </p>
          {renderProgressStepper()}
        </div>
      );
    }

    // State 3: Complete → show results cards + confidence bars
    const hasStructuredOutput =
      parsedNarrative.anomalyDescription ||
      parsedNarrative.logEvidence ||
      parsedNarrative.riskAssessment ||
      parsedNarrative.recommendedAction;

    return (
      <div className="bg-purple-50 dark:bg-purple-950/40 p-4 rounded-lg border border-purple-100 dark:border-purple-800">
        <div className="flex items-center gap-1.5 mb-2">
          <div className="w-6 h-6 rounded-md bg-purple-600 flex items-center justify-center">
            <IconSparkles />
          </div>
          <h4 className="text-xs font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider">
            AI Threat Analysis Complete
          </h4>
          <span className="text-[10px] text-gray-400 ml-auto">
            {analysisState === 'complete' && `Completed in ${analysisElapsed.toFixed(1)}s \u00b7 Ollama qwen2.5:1.5b`}
          </span>
        </div>

        {/* Stepper (mini, all checkmarks) */}
        <div className="flex items-center justify-between px-2 mb-3">
          {['Fetching', 'Analyzing', 'Normalizing', 'Complete'].map((label, i) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-purple-600 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" className="w-3 h-3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <span className="text-[10px] text-purple-700 dark:text-purple-300 font-medium">{label}</span>
              {i < 3 && <span className="text-gray-300 dark:text-gray-600 text-xs">\u2014</span>}
            </div>
          ))}
        </div>

        {/* 2×2 Results Cards */}
        {hasStructuredOutput && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {parsedNarrative.anomalyDescription && (
                <div className="bg-white dark:bg-gray-900 rounded-lg border border-purple-200 dark:border-purple-800 p-3">
                  <p className="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider mb-1">
                    Anomaly Description
                  </p>
                  <p className="text-sm text-[var(--foreground)] leading-relaxed">
                    {parsedNarrative.anomalyDescription}
                  </p>
                </div>
              )}
              {parsedNarrative.riskAssessment && (
                <div className="bg-white dark:bg-gray-900 rounded-lg border border-purple-200 dark:border-purple-800 p-3">
                  <p className="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider mb-1">
                    Risk Assessment
                  </p>
                  <p className="text-sm text-[var(--foreground)] leading-relaxed">
                    {parsedNarrative.riskAssessment}
                  </p>
                </div>
              )}
              {parsedNarrative.logEvidence && (
                <div className="bg-white dark:bg-gray-900 rounded-lg border border-purple-200 dark:border-purple-800 p-3">
                  <p className="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider mb-1">
                    Log Evidence
                  </p>
                  <p className="text-sm text-[var(--foreground)] leading-relaxed">
                    {parsedNarrative.logEvidence}
                  </p>
                </div>
              )}
              {parsedNarrative.recommendedAction && (
                <div className="bg-white dark:bg-gray-900 rounded-lg border border-purple-200 dark:border-purple-800 p-3">
                  <p className="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider mb-1">
                    Recommended Action
                  </p>
                  <p className="text-sm text-[var(--foreground)] leading-relaxed">
                    {parsedNarrative.recommendedAction}
                  </p>
                </div>
              )}
              {renderRecommendedActionStage()}
            </div>

            {/* Source Annotation */}
            {parsedNarrative.sources && parsedNarrative.sources.length > 0 && (
              <div className="flex items-center gap-1.5 bg-purple-100 dark:bg-purple-900/30 rounded-md px-3 py-2 text-xs text-purple-700 dark:text-purple-300">
                <IconInfo />
                <span>
                  Sources:{' '}
                  {parsedNarrative.sources.map((s, i) => (
                    <span key={s}>
                      <strong>{s}</strong>
                      {i < parsedNarrative.sources!.length - 1 ? ' \u00b7 ' : ''}
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Fallback: raw narrative text */}
        {!hasStructuredOutput && log.xai_narrative && (
          <p className="text-sm text-[var(--foreground)] mb-3">
            {log.xai_narrative}
          </p>
        )}

        {/* Confidence Breakdown Bars */}
        <div className="mt-3 space-y-2">
          {/* Use breakdown if available, fall back to single xai_confidence */}
          {parsedNarrative.confidenceBreakdown ? (
            <>
              <ConfidenceBar
                label="Anomaly Detection"
                value={parsedNarrative.confidenceBreakdown.anomalyDetection}
                barColor="bg-purple-600"
              />
              <ConfidenceBar
                label="Classification"
                value={parsedNarrative.confidenceBreakdown.classification}
                barColor="bg-purple-500"
              />
              <ConfidenceBar
                label="Overall"
                value={parsedNarrative.confidenceBreakdown.overall}
                barColor="bg-purple-700"
              />
            </>
          ) : log.xai_confidence != null ? (
            <ConfidenceBar
              label="Overall Confidence"
              value={log.xai_confidence}
              barColor="bg-purple-600"
            />
          ) : null}
        </div>
      </div>
    );
  };

  // ── Individual confidence bar ────────────────────────────────────────

  const ConfidenceBar = ({
    label,
    value,
    barColor,
  }: {
    label: string;
    value: number;
    barColor: string;
  }) => (
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-gray-500">{label}</span>
        <span className="font-semibold text-[var(--foreground)]">
          {(value * 100).toFixed(0)}%
        </span>
      </div>
      <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${Math.min(100, value * 100)}%` }}
        />
      </div>
    </div>
  );

  // ── Stats cards ──────────────────────────────────────────────────────

  const renderStatsCards = () => {
    const overallConfidence = parsedNarrative.confidenceBreakdown?.overall ?? log.xai_confidence;
    const classificationLabel = log.hitl_decision?.action
      ? formatHitlAction(log.hitl_decision.action)
      : log.admin_action_taken ?? log.severity_level ?? '\u2014';

    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Card 1: AI Confidence */}
        <div className="bg-purple-50 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-800 rounded-lg p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-600 flex items-center justify-center shrink-0">
            <IconSparkles />
          </div>
          <div>
            <p className="text-lg font-bold text-purple-700 dark:text-purple-300">
              {overallConfidence != null
                ? `${(overallConfidence * 100).toFixed(1)}%`
                : '\u2014'}
            </p>
            <p className="text-xs text-purple-600/70 dark:text-purple-400/70">
              AI Confidence
            </p>
          </div>
        </div>

        {/* Card 2: Classification */}
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-800 rounded-lg p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-600 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-5 h-5">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-red-800 dark:text-red-300 break-words">
              {classificationLabel}
            </p>
            <p className="text-xs text-red-600/70 dark:text-red-400/70">
              Classification
            </p>
          </div>
        </div>

        {/* Card 3: Related Events */}
        <div className="bg-green-50 dark:bg-green-950/40 border border-green-100 dark:border-green-800 rounded-lg p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-600 flex items-center justify-center shrink-0">
            <IconFileText />
          </div>
          <div>
            <p className="text-lg font-bold text-green-700 dark:text-green-300">
              {relatedEvidenceCount != null ? relatedEvidenceCount : '\u2014'}
            </p>
            <p className="text-xs text-green-600/70 dark:text-green-400/70">
              Related Events
            </p>
          </div>
        </div>
      </div>
    );
  };

  // ── Alert fields grid ────────────────────────────────────────────────

  const renderAlertFields = () => (
    <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-4 text-sm">
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">
            Source IP
          </p>
          <p className="font-mono font-semibold text-[var(--foreground)] truncate">
            {log.source_ip ?? '\u2014'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">
            Destination IP
          </p>
          <p className="font-mono font-semibold text-[var(--foreground)] truncate">
            {log.destination_ip ?? '\u2014'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">
            SID
          </p>
          <p className="font-semibold text-[var(--foreground)]">
            {log.suricata_sid ?? '\u2014'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">
            Signature
          </p>
          <p
            className="font-semibold text-[var(--foreground)] truncate"
            title={log.hitl_decision?.action ?? undefined}
          >
            {'suricata_signature' in log
              ? (log as SecurityLog & { suricata_signature?: string }).suricata_signature ?? '\u2014'
              : '\u2014'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">
            Category
          </p>
          <p className="font-semibold text-[var(--foreground)] truncate">
            {'classification' in log
              ? (log as SecurityLog & { classification?: string }).classification ?? '\u2014'
              : '\u2014'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">
            Timestamp
          </p>
          <p className="text-[var(--foreground)]">
            {log.timestamp
              ? new Date(log.timestamp).toLocaleString()
              : '\u2014'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">
            Protocol
          </p>
          <p className="font-semibold text-[var(--foreground)]">
            {derivedFields.protocol ?? '\u2014'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">
            Port
          </p>
          <p className="font-mono text-[var(--foreground)]">
            {derivedFields.port ?? '\u2014'}
          </p>
        </div>
      </div>
    </div>
  );

  // ── Threat Decision Row ──────────────────────────────────────────────

  const renderRelatedEvidenceButton = () => {
    const disabled = isSubmitting || isAnalysisRunning;
    return (
      <button
        onClick={handleViewRelatedEvidence}
        disabled={disabled}
        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border transition-opacity ${
          disabled
            ? 'border-gray-300 text-gray-400 opacity-70 cursor-not-allowed'
            : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
        title={isAnalysisRunning ? 'AI analysis in progress — actions disabled' : undefined}
      >
        {isLoadingEvidence ? (
          <IconSpinner className="w-4 h-4" />
        ) : (
          <IconSearch />
        )}
        {isLoadingEvidence ? 'Loading\u2026' : 'View Related Evidence'}
      </button>
    );
  };

  const renderDecisionRow = () => {
    if (isReviewed) {
      return (
        <>
          {renderReviewedBanner()}
          <div className="mt-3">
            {renderRelatedEvidenceButton()}
          </div>
        </>
      );
    }

    return (
      <div>
        <div className="flex items-center gap-1.5 mb-3">
          <IconShield />
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            Threat Decision
          </h4>
        </div>
        <div
          className={`flex flex-wrap gap-2 ${(isSubmitting || isAnalysisRunning) ? 'pointer-events-none' : ''}`}
        >
          {/* Confirm Threat */}
          <button
            onClick={() => handleHitlDecision('CONFIRM_THREAT')}
            disabled={isSubmitting || isAnalysisRunning}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity ${
              isSubmitting || isAnalysisRunning
                ? 'bg-red-600 text-white opacity-70 cursor-not-allowed'
                : 'bg-red-600 text-white hover:bg-red-700'
            }`}
            title={isAnalysisRunning ? 'AI analysis in progress — actions disabled' : undefined}
          >
            {isSubmitting ? (
              <IconSpinner className="w-4 h-4" />
            ) : (
              <IconCheckCircle className="w-4 h-4" />
            )}
            {isSubmitting ? 'Applying\u2026' : 'Confirm Threat'}
          </button>

          {/* False Positive */}
          <button
            onClick={() => handleHitlDecision('FALSE_POSITIVE')}
            disabled={isSubmitting || isAnalysisRunning}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity ${
              isSubmitting || isAnalysisRunning
                ? 'bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 opacity-70 cursor-not-allowed'
                : 'bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-500'
            }`}
            title={isAnalysisRunning ? 'AI analysis in progress — actions disabled' : undefined}
          >
            {isSubmitting ? (
              <IconSpinner className="w-4 h-4" />
            ) : (
              <IconXCircle className="w-4 h-4" />
            )}
            {isSubmitting ? 'Applying\u2026' : 'False Positive'}
          </button>

          {/* Request More Info */}
          <button
            onClick={() => handleHitlDecision('REQUEST_MORE_INFO')}
            disabled={isSubmitting || isAnalysisRunning}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border transition-opacity ${
              isSubmitting || isAnalysisRunning
                ? 'border-gray-300 text-gray-400 opacity-70 cursor-not-allowed'
                : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
            title={isAnalysisRunning ? 'AI analysis in progress — actions disabled' : undefined}
          >
            {isSubmitting ? (
              <IconSpinner className="w-4 h-4" />
            ) : (
              <IconQuestion />
            )}
            {isSubmitting ? 'Applying\u2026' : 'Request More Info'}
          </button>

          {renderRelatedEvidenceButton()}

          {/* Create Incident */}
          <button
            onClick={handleCreateIncident}
            disabled={isSubmitting || isAnalysisRunning}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity ${
              isSubmitting || isAnalysisRunning
                ? 'bg-orange-600 text-white opacity-70 cursor-not-allowed'
                : 'bg-orange-600 text-white hover:bg-orange-700'
            }`}
            title={isAnalysisRunning ? 'AI analysis in progress — actions disabled' : undefined}
          >
            {isSubmitting ? (
              <IconSpinner className="w-4 h-4" />
            ) : (
              <IconFileText />
            )}
            {isSubmitting ? 'Creating\u2026' : 'Create Incident'}
          </button>
        </div>
      </div>
    );
  };

  // ── Reviewed State Banner ─────────────────────────────────────────────

  const renderReviewedBanner = () => (
    <div
      className={`rounded-lg border p-4 text-sm ${
        isConfirmedThreat
          ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-950/40 dark:border-green-800 dark:text-green-200'
          : isFalsePositive
            ? 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/40 dark:border-red-800 dark:text-red-200'
            : 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-200'
      }`}
    >
      <div className="flex items-center gap-2 font-semibold">
        <IconCheckCircle className="w-4 h-4" />
        <span>Reviewed: {log.admin_action_taken}</span>
      </div>
      {log.resolved_at && (
        <div className="text-xs opacity-80 mt-1 ml-6">
          Resolved {new Date(log.resolved_at).toLocaleString()}
        </div>
      )}
    </div>
  );

  // ── Hitl message / create incident result ────────────────────────────

  const renderMessages = () => (
    <>
      {hitlMessage && (
        <div
          className={`p-3 rounded-md text-sm font-medium ${
            hitlMessage.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-950/40 dark:border-green-800 dark:text-green-200'
              : 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/40 dark:border-red-800 dark:text-red-200'
          }`}
        >
          {hitlMessage.type === 'success' ? (
            <IconCheckCircle className="w-4 h-4 inline mr-1" />
          ) : (
            <IconXCircle className="w-4 h-4 inline mr-1" />
          )}
          {hitlMessage.text}
        </div>
      )}

      {createIncidentResult && (
        <div className="p-3 rounded-md text-sm font-medium bg-green-50 border border-green-200 text-green-800 dark:bg-green-950/40 dark:border-green-800 dark:text-green-200">
          <IconCheckCircle className="w-4 h-4 inline mr-1" />
          Incident #{createIncidentResult.incident_id} created from this alert.{' '}
          <a
            href={`/incidents/${createIncidentResult.incident_id}`}
            className="underline font-semibold hover:opacity-80"
          >
            View Incident
          </a>
        </div>
      )}
    </>
  );

  // ── Raw Payload Tab ──────────────────────────────────────────────────

  const renderRawPayloadTab = () => (
    <div>
      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
        Raw Payload
      </h4>
      {log.raw_payload ? (
        <pre className="bg-gray-100 dark:bg-gray-950 text-gray-800 dark:text-gray-200 p-3 rounded-lg text-xs overflow-x-auto font-mono max-h-96 overflow-y-auto border border-gray-200 dark:border-gray-700 leading-relaxed">
          {log.raw_payload}
        </pre>
      ) : (
        <p className="text-sm text-gray-400 italic">No raw payload available.</p>
      )}
    </div>
  );

  // ── Evidence Tab ─────────────────────────────────────────────────────

  const renderEvidenceTab = () => (
    <div className="space-y-6">
      {/* Same-Source-IP Alerts */}
      {relatedAlerts && relatedAlerts.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            Same Source IP Alerts
            <span className="font-normal text-[10px] text-gray-400">
              ({relatedAlerts.length})
            </span>
          </h4>
          <div className="max-h-48 overflow-y-auto space-y-1.5">
            {relatedAlerts.map((alert) => (
              <div
                key={alert.log_id}
                className="text-xs p-2.5 bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 flex items-center gap-3"
              >
                {severityBadge(alert.severity_level)}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800 dark:text-gray-200 truncate">
                    {alert.suricata_signature || `SID ${alert.suricata_sid ?? '?'}`}
                  </p>
                  <p className="text-gray-400 text-[10px]">
                    {alert.classification ? `${alert.classification} \u00b7 ` : ''}
                    {alert.timestamp
                      ? new Date(alert.timestamp).toLocaleString()
                      : ''}
                  </p>
                </div>
                <span className="font-mono text-[10px] text-gray-500 shrink-0">
                  #{alert.log_id}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit Evidence */}
      <div>
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
          Related Audit Evidence
        </h4>
        {isLoadingEvidence && (
          <p className="text-sm text-gray-500 italic">Loading related evidence\u2026</p>
        )}
        {relatedEvidenceError && (
          <p className="text-sm text-red-600">{relatedEvidenceError}</p>
        )}
        {!isLoadingEvidence && !relatedEvidenceError && relatedEvidence && relatedEvidence.length === 0 && !relatedAlerts?.length && (
          <p className="text-sm text-gray-500">
            No related audit records found in the &plusmn;1 hour window.
          </p>
        )}
        {relatedEvidence && relatedEvidence.length > 0 && (
          <div className="max-h-64 overflow-y-auto space-y-2">
            {relatedEvidence.map((item) => (
              <div
                key={item.audit_id}
                className="text-xs p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700"
              >
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-blue-700 dark:text-blue-300">
                    {item.action_type ?? '\u2014'}
                  </span>
                  <span className="text-gray-400">
                    {item.timestamp
                      ? new Date(item.timestamp).toLocaleString()
                      : '\u2014'}
                  </span>
                </div>
                <div className="text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {item.ip_address && (
                    <span className="font-mono">{item.ip_address}</span>
                  )}
                  {item.user_agent && (
                    <span className="truncate block max-w-full">
                      {item.user_agent.substring(0, 80)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
  // ── History Tab ──────────────────────────────────────────────────────

  const renderHistoryTab = () => {
    const decision = log.hitl_decision;
    if (!decision) {
      return (
        <div>
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
            Decision History
          </h4>
          <p className="text-sm text-gray-400 italic">
            No decision history available.
          </p>
        </div>
      );
    }

    return (
      <div>
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
          Decision History
        </h4>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Action</span>
            <span className="text-sm font-semibold text-[var(--foreground)]">
              {decision.action
                ? formatHitlAction(decision.action)
                : '\u2014'}
            </span>
          </div>
          {decision.note && (
            <div className="flex items-start justify-between">
              <span className="text-xs text-gray-500">Note</span>
              <span className="text-sm text-[var(--foreground)] max-w-[60%] text-right">
                {decision.note}
              </span>
            </div>
          )}
          {decision.reviewed_by && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Reviewed by</span>
              <span className="text-sm font-mono text-[var(--foreground)]">
                {decision.reviewed_by}
              </span>
            </div>
          )}
          {decision.reviewed_at && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Reviewed at</span>
              <span className="text-sm text-[var(--foreground)]">
                {new Date(decision.reviewed_at).toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Main tab content router ─────────────────────────────────────────

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div className="space-y-5">
            {renderMessages()}
            {renderAiAnalysisCard()}
            {renderStatsCards()}
            {renderAlertFields()}
            {renderDecisionRow()}
          </div>
        );

      case 'ai-analysis':
        return (
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider">
              AI Analysis Details
            </h4>
            {/* Reuse the results portion from AiAnalysisCard */}
            {parsedNarrative.anomalyDescription ||
            parsedNarrative.logEvidence ||
            parsedNarrative.riskAssessment ||
            parsedNarrative.recommendedAction ? (
              <div className="grid grid-cols-2 gap-4">
                {parsedNarrative.anomalyDescription && (
                  <div className="bg-white dark:bg-gray-900 rounded-lg border border-purple-200 dark:border-purple-800 p-4">
                    <p className="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider mb-1">
                      Anomaly Description
                    </p>
                    <p className="text-sm text-[var(--foreground)] leading-relaxed">
                      {parsedNarrative.anomalyDescription}
                    </p>
                  </div>
                )}
                {parsedNarrative.riskAssessment && (
                  <div className="bg-white dark:bg-gray-900 rounded-lg border border-purple-200 dark:border-purple-800 p-4">
                    <p className="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider mb-1">
                      Risk Assessment
                    </p>
                    <p className="text-sm text-[var(--foreground)] leading-relaxed">
                      {parsedNarrative.riskAssessment}
                    </p>
                  </div>
                )}
                {parsedNarrative.logEvidence && (
                  <div className="bg-white dark:bg-gray-900 rounded-lg border border-purple-200 dark:border-purple-800 p-4">
                    <p className="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider mb-1">
                      Log Evidence
                    </p>
                    <p className="text-sm text-[var(--foreground)] leading-relaxed">
                      {parsedNarrative.logEvidence}
                    </p>
                  </div>
                )}
                {parsedNarrative.recommendedAction && (
                  <div className="bg-white dark:bg-gray-900 rounded-lg border border-purple-200 dark:border-purple-800 p-4">
                    <p className="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider mb-1">
                      Recommended Action
                    </p>
                    <p className="text-sm text-[var(--foreground)] leading-relaxed">
                      {parsedNarrative.recommendedAction}
                    </p>
                  </div>
                )}
                {renderRecommendedActionStage()}

                {/* Source annotation */}
                {parsedNarrative.sources && parsedNarrative.sources.length > 0 && (
                  <div className="col-span-2 flex items-center gap-1.5 bg-purple-100 dark:bg-purple-900/30 rounded-md px-3 py-2 text-xs text-purple-700 dark:text-purple-300">
                    <IconInfo />
                    <span>
                      Sources:{' '}
                      {parsedNarrative.sources.map((s, i) => (
                        <span key={s}>
                          <strong>{s}</strong>
                          {i < parsedNarrative.sources!.length - 1 ? ' \u00b7 ' : ''}
                        </span>
                      ))}
                    </span>
                  </div>
                )}

                {/* Confidence bars */}
                <div className="col-span-2 space-y-2 mt-2">
                  {parsedNarrative.confidenceBreakdown ? (
                    <>
                      <ConfidenceBar label="Anomaly Detection" value={parsedNarrative.confidenceBreakdown.anomalyDetection} barColor="bg-purple-600" />
                      <ConfidenceBar label="Classification" value={parsedNarrative.confidenceBreakdown.classification} barColor="bg-purple-500" />
                      <ConfidenceBar label="Overall" value={parsedNarrative.confidenceBreakdown.overall} barColor="bg-purple-700" />
                    </>
                  ) : log.xai_confidence != null ? (
                    <ConfidenceBar label="Overall Confidence" value={log.xai_confidence} barColor="bg-purple-600" />
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">No AI analysis data available.</p>
            )}
          </div>
        );

      case 'raw-payload':
        return renderRawPayloadTab();

      case 'evidence':
        return renderEvidenceTab();

      case 'history':
        return renderHistoryTab();

      default:
        return null;
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Main render
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="rounded-lg shadow-xl max-w-4xl md:max-w-[95vw] w-full max-h-[90vh] overflow-y-auto bg-[var(--background)] text-[var(--foreground)]">
        {/* Modal header */}
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-[var(--background)] z-10">
          {renderAlertHeader()}
        </div>

        {/* Tab bar */}
        {renderTabBar()}

        {/* Tab content */}
        <div className="p-5">{renderTabContent()}</div>
      </div>
    </div>
  );
}
