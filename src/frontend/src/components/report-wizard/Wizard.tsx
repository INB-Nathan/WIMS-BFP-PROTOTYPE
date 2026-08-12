'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import React from 'react';
import { ArrowLeft, AlertTriangle, RefreshCw, Link2 } from 'lucide-react';
import { TurnstileInstance } from '@marsidev/react-turnstile';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { SafetyBanner } from './SafetyBanner';
import { StepLocation } from './StepLocation';
import { StepPhoto } from './StepPhoto';
import { StepCategory, deriveCategory } from './StepCategory';
import { StepDetails } from './StepDetails';
import { StepReview } from './StepReview';
import { Receipt } from './Receipt';
import {
  EMPTY_DRAFT,
  clearDraft,
  hasDraft,
  loadDraft,
  saveDraft,
  type ReportDraft,
} from './DraftManager';
import type { PhotoGpsSample } from '@/components/civilian/PhotoUpload';
import type { ExifGpsData } from '@/lib/photoExif';
import type { CivilianCategory, CivilianDuplicateSuggestion, CivilianReportV2Response, ReportingContext, SafetyStatus } from '@/lib/api';
import {
  submitCivilianReportOfflineAware,
  checkReviewEligibility,
} from '@/lib/api/offlineCivilian';
import { fetchCivilianDuplicateSuggestions, fetchNearbyStations } from '@/lib/api';
import { fetchPublicTracking, type PublicTrackingData } from '@/lib/api/tracking';
import { parseLineStringToLatLng } from '@/components/map/RoutePolyline';
import { usePublicAutoSync } from '@/lib/usePublicAutoSync';
import { reporterIdentityComplete } from '@/components/civilian/ReporterIdentityFields';

const STEPS = ['Location', 'Photo', 'Category', 'Details', 'Review'] as const;

// Defaults for fields the new 5-step wizard no longer collects explicitly
// (the persistent SafetyBanner replaces the old Safety step; there is no
// separate context step). The backend still requires them on the payload.
const DEFAULT_REPORTING_CONTEXT: ReportingContext = 'WITNESS';

function getDeviceId(): string {
  const key = 'wims_civilian_device_id';
  if (typeof window === 'undefined') return '00000000-0000-4000-8000-000000000000';
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const generated = window.crypto?.randomUUID?.() ?? '00000000-0000-4000-8000-000000000000';
  window.localStorage.setItem(key, generated);
  return generated;
}

type Mode = 'prompt' | 'wizard' | 'queued' | 'receipt';

/**
 * ReportAuthStatus — compact auth-state indicator for the public report wizard.
 * Issue #680. Reuses the shared AuthContext via useAuth(); performs no extra
 * session fetch and never reads the HttpOnly JWT in browser code. Presentation
 * only: it never touches report ownership, payload, submission, offline-queue,
 * or CAPTCHA behavior.
 *
 * - Loading: neutral status, no guest/identity flash.
 * - Authenticated: signed-in row with the available username/email.
 * - Anonymous: guest-reporting row with a /login link. Anonymous reporting
 *   stays fully available — this is awareness, not a gate.
 * role="status" + aria-live="polite" keeps it in sync when the session changes
 * without a full-page refresh.
 */
function ReportAuthStatus() {
  const { user, loading } = useAuth();
  const isAuthenticated = user !== null;

  if (loading) {
    return (
      <div
        className="ps-report-auth-status ps-report-auth-status--loading"
        role="status"
        aria-live="polite"
        data-testid="report-auth-status"
        data-auth-state="loading"
      >
        <span className="ps-report-auth-dot" aria-hidden="true" />
        <span className="ps-report-auth-text">Checking your sign-in status…</span>
      </div>
    );
  }

  if (isAuthenticated && user) {
    const identity = user.preferred_username || user.email || 'your account';
    return (
      <div
        className="ps-report-auth-status ps-report-auth-status--signed-in"
        role="status"
        aria-live="polite"
        data-testid="report-auth-status"
        data-auth-state="authenticated"
      >
        <span className="ps-report-auth-dot" aria-hidden="true" />
        <span className="ps-report-auth-text">
          Signed in as <span className="ps-report-auth-name">{identity}</span>
        </span>
      </div>
    );
  }

  return (
    <div
      className="ps-report-auth-status ps-report-auth-status--guest"
      role="status"
      aria-live="polite"
      data-testid="report-auth-status"
      data-auth-state="anonymous"
    >
      <span className="ps-report-auth-dot" aria-hidden="true" />
      <span className="ps-report-auth-text">
        Reporting as a guest.{' '}
        <Link href="/login" className="ps-report-auth-link" data-testid="report-auth-signin">
          Sign in
        </Link>
      </span>
    </div>
  );
}

export function ReportWizard() {
  usePublicAutoSync();
  const { user } = useAuth();
  const authenticatedCivilian = user?.role === 'CIVILIAN_REPORTER';

  const [mode, setMode] = useState<Mode>('prompt');
  const [stepIndex, setStepIndex] = useState(0);

  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [landmark, setLandmark] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoGps, setPhotoGps] = useState<PhotoGpsSample | null>(null);
  const [photoExif, setPhotoExif] = useState<ExifGpsData | null>(null);
  const [photoStatus, setPhotoStatus] = useState<'idle' | 'uploading' | 'uploaded' | 'failed'>('idle');
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [observables, setObservables] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [safetyStatus, setSafetyStatus] = useState<SafetyStatus>('UNKNOWN');
  const [reporterName, setReporterName] = useState('');
  const [reporterPhone, setReporterPhone] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');

  const [duplicates, setDuplicates] = useState<CivilianDuplicateSuggestion[]>([]);

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileExpired, setTurnstileExpired] = useState(false);
  const turnstileRef = useRef<TurnstileInstance | undefined>(undefined);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
  const turnstileEnabled = siteKey !== '' && !authenticatedCivilian;

  const onTurnstileSuccess = useCallback((token: string) => {
    setTurnstileToken(token);
    setTurnstileExpired(false);
  }, []);

  // Do NOT remount the widget on expiry. With refresh-expired: auto (default)
  // Turnstile auto-renews the token and re-invokes onSuccess, so the widget
  // never needs to be recreated. Remounting via a React key calls
  // turnstile.remove() on the old widget, which can fire the expired callback
  // again and create a solved -> expired loop that blocks every submit.
  const onTurnstileExpire = useCallback(() => {
    setTurnstileToken(null);
    setTurnstileExpired(true);
  }, []);

  const onTurnstileError = useCallback(() => {
    setTurnstileToken(null);
    setTurnstileExpired(true);
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [queuedLocalId, setQueuedLocalId] = useState<string | null>(null);

  const [submittedResponse, setSubmittedResponse] = useState<CivilianReportV2Response | null>(null);
  const [lastReport, setLastReport] = useState<{ id: number; trackingUrl: string } | null>(null);
  const [nearestStation, setNearestStation] = useState<{ name: string; phone: string | null; lat: number; lng: number } | null>(null);

  // Surface the user's most recent report so returning to the wizard shows
  // what to track (Fix B). When authenticated as a civilian reporter the
  // report is already linked server-side, so the banner also links the dashboard.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('wims_last_report');
      if (raw) {
        const parsed = JSON.parse(raw) as { id?: unknown; tracking_url?: unknown };
        const id = typeof parsed.id === 'number' ? parsed.id : Number(parsed.id);
        const trackingUrl = typeof parsed.tracking_url === 'string' ? parsed.tracking_url : null;
        if (Number.isFinite(id) && id > 0 && trackingUrl) {
          setLastReport({ id, trackingUrl });
        }
      }
    } catch {
      // ignore storage read failures
    }
  }, []);
  const [tracking, setTracking] = useState<PublicTrackingData | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);

  const parentLocalIdRef = useRef<string>(crypto.randomUUID());

  // ── Tracking polling ──────────────────────────────────────────────────────
  // Bounded non-overlapping: immediate + 5 retries at 2s, stop on valid
  // geometry, exhaustion, token absence, report replacement, or unmount.
  const pollingRef = useRef<{
    mounted: boolean;
    generation: number;
    timeout: ReturnType<typeof setTimeout> | null;
  }>({ mounted: true, generation: 0, timeout: null });

  function startTrackingPolling(reportId: number, token: string) {
    const ctx = pollingRef.current;
    ctx.generation++;
    const generation = ctx.generation;
    if (ctx.timeout) clearTimeout(ctx.timeout);

    function isCurrent() {
      return ctx.mounted && ctx.generation === generation;
    }

    function poll(attempt: number) {
      if (!isCurrent()) return;
      setTrackingLoading(true);

      fetchPublicTracking(reportId, token)
        .then((data) => {
          if (!isCurrent()) return;
          setTracking(data);

          if (parseLineStringToLatLng(data.routing_geometry)) {
            setTrackingLoading(false);
            return;
          }

          if (attempt < 5) {
            ctx.timeout = setTimeout(() => poll(attempt + 1), 2000);
          } else {
            setTrackingLoading(false);
          }
        })
        .catch(() => {
          if (!isCurrent()) return;
          if (attempt < 5) {
            ctx.timeout = setTimeout(() => poll(attempt + 1), 2000);
          } else {
            setTrackingLoading(false);
          }
        });
    }

    poll(0); // Immediate request, followed by at most five retries.
  }

  useEffect(() => {
    const ctx = pollingRef.current;
    ctx.mounted = true;
    return () => {
      ctx.mounted = false;
      ctx.generation++;
      if (ctx.timeout) clearTimeout(ctx.timeout);
    };
  }, []);

  // ── Entry: draft prompt ──────────────────────────────────────────────────
  useEffect(() => {
    if (mode === 'prompt') {
      const exists = hasDraft();
      if (!exists) {
        setMode('wizard');
      }
    }
  }, [mode]);

  function continueDraft() {
    const draft = loadDraft();
    if (draft) {
      setLatitude(draft.latitude);
      setLongitude(draft.longitude);
      setLandmark(draft.landmark);
      setObservables(draft.observables);
      setDescription(draft.description);
      setContactName(draft.contactName);
      setContactPhone(draft.contactPhone);
      setNotes(draft.notes);
      setStepIndex(Math.min(draft.stepIndex, STEPS.length - 1));
    }
    setMode('wizard');
  }

  function startFresh() {
    clearDraft();
    parentLocalIdRef.current = crypto.randomUUID();
    setLatitude(null);
    setLongitude(null);
    setLandmark('');
    setPhotoFile(null);
    setPhotoGps(null);
    setPhotoExif(null);
    setObservables([]);
    setDescription('');
    setSafetyStatus('UNKNOWN');
    setReporterName('');
    setReporterPhone('');
    setContactName('');
    setContactPhone('');
    setNotes('');
    setStepIndex(0);
    setMode('wizard');
  }

  // ── Draft autosave after each completed step ─────────────────────────────
  const persistDraft = useCallback(
    (nextStepIndex: number) => {
      const draft: ReportDraft = {
        stepIndex: nextStepIndex,
        savedAt: Date.now(),
        latitude,
        longitude,
        landmark,
        photoPresent: photoFile !== null,
        category: deriveCategory(observables),
        observables,
        description,
        contactName,
        contactPhone,
        notes,
      };
      saveDraft(draft);
    },
    [latitude, longitude, landmark, photoFile, observables, description, contactName, contactPhone, notes],
  );

  function goNext() {
    const next = Math.min(stepIndex + 1, STEPS.length - 1);
    persistDraft(next);
    setStepIndex(next);
  }

  // Location is required: valid coordinates (map pin or GPS). The landmark is
  // optional supplementary context, not a substitute for coordinates
  // (approved safe default — a fire report must have a pin/GPS location).
  const locationProvided = latitude !== null && longitude !== null;

  function goBack() {
    setStepIndex((s) => Math.max(0, s - 1));
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  function buildPayload() {
    if (description.trim().length === 0) return null;
    if (latitude === null || longitude === null) {
      // Coordinates are optional in the wizard; backend requires lat/lng.
      // If absent, we still require a manual/location-less submission is not
      // allowed — block with a message.
      return null;
    }
    return {
      latitude,
      longitude,
      category: deriveCategory(observables) as CivilianCategory,
      reporting_context: DEFAULT_REPORTING_CONTEXT,
      safety_status: safetyStatus,
      description: description.trim(),
      reporter_name: authenticatedCivilian ? undefined : reporterName.trim() || undefined,
      reporter_phone: authenticatedCivilian ? undefined : reporterPhone.trim() || undefined,
      witness_name: contactName || undefined,
      witness_phone: contactPhone || undefined,
      gps_warning_confirmed: false,
      device_id: getDeviceId(),
      client_report_id: parentLocalIdRef.current,
      turnstile_token: turnstileToken || undefined,
    };
  }

  function fetchStation(lat: number, lng: number) {
    fetchNearbyStations(lat, lng)
      .then((stations) => {
        if (stations.length > 0) {
          const nearest = stations[0];
          setNearestStation({
            name: nearest.station_name,
            phone: null,
            lat: nearest.latitude,
            lng: nearest.longitude,
          });
        }
      })
      .catch(() => {
        // Non-fatal: route feedback still renders without station.
      });
  }

  async function handleSubmit() {
    if (turnstileEnabled && !turnstileToken) {
      setSubmitError(
        turnstileExpired
          ? 'Security check expired. Please complete it again.'
          : 'Please complete the security check.',
      );
      return;
    }
    const payload = buildPayload();
    if (!payload) {
      setSubmitError('A description and a location are required to submit.');
      return;
    }
    if (!reporterIdentityComplete(authenticatedCivilian, reporterName, reporterPhone, safetyStatus)) {
      setSubmitError(
        reporterName.trim()
          ? 'Reporter phone is required unless this is a life-safety report.'
          : 'Reporter name is required.',
      );
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const deviceId = payload.device_id;
      const result = await submitCivilianReportOfflineAware(payload, deviceId);
      if (result.queued) {
        setQueuedLocalId(result.localId);
        setMode('queued');
        setSubmitting(false);
        return;
      }
      const resp = result.response;
      setSubmittedResponse(resp);
      clearDraft();

      // Independent station lookup (non-fatal).
      if (latitude !== null && longitude !== null) {
        fetchStation(latitude, longitude);
      }

      // Start bounded tracking polling.
      const token = resp.tracking_token ?? '';
      if (token) {
        setTracking(null);
        startTrackingPolling(resp.report_id, token);
      } else {
        setTrackingLoading(false);
      }

      setMode('receipt');
      setSubmitting(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Submission failed. Please try again.';
      // Turnstile tokens are single-use — consumed by this attempt regardless
      // of outcome. Reset the widget in place (no remount) so the user gets a
      // fresh token without triggering the remove()/expired loop.
      setTurnstileToken(null);
      setTurnstileExpired(true);
      turnstileRef.current?.reset();
      if (msg.toLowerCase().includes('captcha')) {
        setSubmitError('Security check failed. Please complete the CAPTCHA again.');
      } else if (authenticatedCivilian && msg === 'PROFILE_INCOMPLETE') {
        setSubmitError('Your account profile needs a display name and contact number before this report can be submitted. Complete your profile, then return to this preserved draft.');
      } else {
        setSubmitError(msg);
      }
      setSubmitting(false);
    }
  }

  async function handleQueueOffline() {
    const payload = buildPayload();
    if (!payload) {
      setSubmitError('A description and a location are required to queue.');
      return;
    }
    if (authenticatedCivilian) {
      setSubmitError('Authenticated reports must reconnect so the server can use your account profile.');
      return;
    }
    if (!reporterIdentityComplete(false, reporterName, reporterPhone, safetyStatus)) {
      setSubmitError(
        reporterName.trim()
          ? 'Reporter phone is required unless this is a life-safety report.'
          : 'Reporter name is required.',
      );
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const deviceId = payload.device_id;
      const result = await submitCivilianReportOfflineAware(payload, deviceId);
      if (result.queued) {
        setQueuedLocalId(result.localId);
        setMode('queued');
      } else {
        setMode('queued');
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save offline.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReviewEnter() {
    const payload = buildPayload();
    setDuplicates([]);
    if (!payload) return;
    try {
      checkReviewEligibility();
    } catch {
      // Offline — duplicate check skipped; user can still submit/queue.
      return;
    }
    try {
      const suggestions = await fetchCivilianDuplicateSuggestions(payload);
      setDuplicates(suggestions);
    } catch {
      setDuplicates([]);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (mode === 'receipt' && submittedResponse) {
    return (
      <Receipt
        data={{
          reportId: submittedResponse.report_id,
          trackingUrl: submittedResponse.tracking_url ?? `/tracking/v2/${submittedResponse.report_id}/${submittedResponse.tracking_token ?? ''}`,
          trackingToken: submittedResponse.tracking_token ?? '',
          createdAt: submittedResponse.created_at,
          category: submittedResponse.category,
          description,
          latitude: submittedResponse.latitude,
          longitude: submittedResponse.longitude,
          landmark,
          nearestStation,
        }}
        tracking={tracking}
        trackingLoading={trackingLoading}
      />
    );
  }

  if (mode === 'queued') {
    return (
      <div className="ps-has-mesh min-h-screen">
        <div className="ps-intent-bg" aria-hidden />
        <SafetyBanner />
        <div className="relative z-10 max-w-lg mx-auto px-4 mt-6 pb-8">
          <div className="ps-card">
            <div className="p-6 text-center">
              <div className="mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: 'var(--green-bg)' }}>
                <RefreshCw className="w-8 h-8" style={{ color: 'var(--green)' }} />
              </div>
              <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Report saved offline</h1>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                Ipapadala ang report mo kapag nakakonekta ulit.
              </p>
              {queuedLocalId && (
                <code data-testid="queued-local-id" className="block mt-3 break-all text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {queuedLocalId}
                </code>
              )}
              <div className="ps-warning mt-4">
                <AlertTriangle className="w-5 h-5 ps-warning-icon" />
                <p className="font-semibold">For immediate danger, call 911 now.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'prompt') {
    const draft = loadDraft();
    if (draft) {
      return (
        <div className="ps-has-mesh min-h-screen">
          <div className="ps-intent-bg" aria-hidden />
          <SafetyBanner />
          <div className="relative z-10 max-w-lg mx-auto px-4 mt-10 pb-8">
            <ReportAuthStatus />
            <div className="ps-card">
              <div className="p-6 text-center space-y-4">
                <AlertTriangle className="w-10 h-10 mx-auto" style={{ color: 'var(--orange)' }} />
                <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                  You have an unfinished report
                </h1>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Continue where you left off? / Ipagpatuloy kung saan ka huminto?
                </p>
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={continueDraft}
                    data-testid="continue-draft"
                    className="ps-btn ps-btn-primary w-full justify-center"
                  >
                    Continue draft
                  </button>
                  <button
                    type="button"
                    onClick={startFresh}
                    data-testid="start-fresh"
                    className="ps-btn ps-btn-outline w-full justify-center"
                  >
                    Start fresh
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }
  }

  // ── Wizard steps ───────────────────────────────────────────────────────────
  return (
    <div className="ps-has-mesh min-h-screen">
      <div className="ps-intent-bg" aria-hidden />
      <SafetyBanner />

      <div className="relative z-10 max-w-lg mx-auto px-4 mt-4 pb-8">
        <ReportAuthStatus />
        {lastReport && (
          <div
            className="ps-card ps-contributor-impact"
            data-testid="last-report-banner"
            style={{ marginBottom: '16px' }}
          >
            <Link2 className="w-5 h-5 flex-shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                Your last report #{lastReport.id}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                <Link href={lastReport.trackingUrl} className="underline break-all" style={{ color: 'var(--red)' }}>
                  Track this report
                </Link>
                {user?.role === 'CIVILIAN_REPORTER' && (
                  <>
                    {' '}·{' '}
                    <Link href="/contributor" className="underline" style={{ color: 'var(--red)' }}>
                      View on your dashboard
                    </Link>
                  </>
                )}
              </p>
            </div>
          </div>
        )}
        <div className="ps-card">
          <div className="p-6 space-y-5">
            {/* Progress */}
            <div className="flex items-center gap-1" data-testid="wizard-progress">
              {STEPS.map((label, i) => (
                <div key={label} className="flex-1 flex items-center">
                  <div
                    className="flex-1 h-1.5 rounded-full"
                    style={{ backgroundColor: i <= stepIndex ? 'var(--red)' : 'var(--border)' }}
                    data-testid={`step-dot-${i}`}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }} data-testid="step-label">
              Step {stepIndex + 1} of {STEPS.length}: {STEPS[stepIndex]}
            </p>

            {stepIndex === 0 && (
              <StepLocation
                latitude={latitude}
                longitude={longitude}
                landmark={landmark}
                onChange={(n) => {
                  setLatitude(n.latitude);
                  setLongitude(n.longitude);
                  setLandmark(n.landmark);
                }}
              />
            )}

            {stepIndex === 1 && (
              <StepPhoto
                file={photoFile}
                photoStatus={photoStatus}
                photoError={photoError}
                photoGps={photoGps}
                photoExif={photoExif}
                pendingCount={0}
                onChange={(n) => {
                  setPhotoFile(n.file);
                  setPhotoGps(n.photoGps);
                  setPhotoExif(n.photoExif);
                  setPhotoStatus(n.photoStatus);
                  setPhotoError(n.photoError);
                }}
              />
            )}

            {stepIndex === 2 && (
              <StepCategory observables={observables} onChange={setObservables} />
            )}

            {stepIndex === 3 && (
              <StepDetails
                description={description}
                reporterName={reporterName}
                reporterPhone={reporterPhone}
                authenticatedCivilian={authenticatedCivilian}
                safetyStatus={safetyStatus}
                contactName={contactName}
                contactPhone={contactPhone}
                notes={notes}
                onReporterChange={(next) => {
                  setReporterName(next.reporterName);
                  setReporterPhone(next.reporterPhone);
                }}
                onSafetyStatusChange={setSafetyStatus}
                onChange={(n) => {
                  setDescription(n.description);
                  setContactName(n.contactName);
                  setContactPhone(n.contactPhone);
                  setNotes(n.notes);
                }}
              />
            )}

            {stepIndex === 4 && (
              <StepReview
                draft={{
                  ...EMPTY_DRAFT,
                  stepIndex: 4,
                  savedAt: Date.now(),
                  latitude,
                  longitude,
                  landmark,
                  photoPresent: photoFile !== null,
                  category: deriveCategory(observables),
                  observables,
                  description,
                  contactName,
                  contactPhone,
                  notes,
                }}
                duplicates={duplicates}
                submitting={submitting}
                submitError={submitError}
                queuedOffline={false}
                queuedLocalId={queuedLocalId}
                reporterName={authenticatedCivilian ? null : reporterName}
                profileIdentityUsed={authenticatedCivilian}
                turnstileEnabled={turnstileEnabled}
                turnstileExpired={turnstileExpired}
                siteKey={siteKey}
                onTurnstileSuccess={onTurnstileSuccess}
                onTurnstileExpire={onTurnstileExpire}
                onTurnstileError={onTurnstileError}
                onBack={goBack}
                onSubmit={handleSubmit}
                onQueueOffline={handleQueueOffline}
              />
            )}

            {/* Navigation (Review step has its own buttons) */}
            {stepIndex < STEPS.length - 1 && (
              <>
              <div className="flex gap-3 pt-2">
                {stepIndex > 0 && (
                  <button
                    type="button"
                    onClick={goBack}
                    className="ps-btn ps-btn-outline"
                  >
                    <ArrowLeft className="w-4 h-4" /> Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={stepIndex === 3 ? handleReviewEnterThenNext : goNext}
                  disabled={
                    (stepIndex === 0 && !locationProvided) ||
                    (stepIndex === 3 && (
                      description.trim().length === 0 ||
                      !reporterIdentityComplete(authenticatedCivilian, reporterName, reporterPhone, safetyStatus)
                    ))
                  }
                  className="ps-btn ps-btn-primary flex-1 justify-center disabled:opacity-40"
                >
                  {stepIndex === STEPS.length - 2 ? 'Review' : 'Continue'}
                </button>
              </div>
              {stepIndex === 0 && !locationProvided && (
                <p className="text-xs flex items-center gap-1.5 pt-1" style={{ color: '#b91c1c' }}>
                  <AlertTriangle className="w-3.5 h-3.5" /> Add a location - drop a pin or use your location.
                </p>
              )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // Entering Review triggers the duplicate fetch before advancing.
  function handleReviewEnterThenNext() {
    void handleReviewEnter();
    goNext();
  }
}
