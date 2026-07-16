'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import React from 'react';
import { ArrowLeft, AlertTriangle, RefreshCw } from 'lucide-react';
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
import { fetchCivilianDuplicateSuggestions } from '@/lib/api';
import { fetchStations } from '@/lib/api/map';
import { fetchPublicTracking, type PublicTrackingData } from '@/lib/api/tracking';
import { usePublicAutoSync } from '@/lib/usePublicAutoSync';

const STEPS = ['Location', 'Photo', 'Category', 'Details', 'Review'] as const;

// Defaults for fields the new 5-step wizard no longer collects explicitly
// (the persistent SafetyBanner replaces the old Safety step; there is no
// separate context step). The backend still requires them on the payload.
const DEFAULT_REPORTING_CONTEXT: ReportingContext = 'WITNESS';
const DEFAULT_SAFETY_STATUS: SafetyStatus = 'UNKNOWN';

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

export function ReportWizard() {
  usePublicAutoSync();

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
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');

  const [duplicates, setDuplicates] = useState<CivilianDuplicateSuggestion[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [queuedLocalId, setQueuedLocalId] = useState<string | null>(null);

  const [submittedResponse, setSubmittedResponse] = useState<CivilianReportV2Response | null>(null);
  const [nearestStation, setNearestStation] = useState<{ name: string; phone: string | null; lat: number; lng: number } | null>(null);
  const [tracking, setTracking] = useState<PublicTrackingData | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingState, setTrackingState] = useState<'PENDING' | 'SUCCESS' | 'FAILED'>('PENDING');

  const parentLocalIdRef = useRef<string>(crypto.randomUUID());

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
      safety_status: DEFAULT_SAFETY_STATUS,
      description: description.trim(),
      witness_name: contactName || undefined,
      witness_phone: contactPhone || undefined,
      gps_warning_confirmed: false,
      device_id: getDeviceId(),
      client_report_id: parentLocalIdRef.current,
    };
  }

  const fetchTrackingAndStations = useCallback(async (resp: CivilianReportV2Response) => {
    const token = resp.tracking_token ?? '';
    const reportId = resp.report_id;
    setTrackingState('PENDING');
    setTrackingLoading(true);

    // Nearest station line target (public stations endpoint).
    if (latitude !== null && longitude !== null) {
      fetchStations(latitude, longitude)
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
          // Non-fatal: route feedback still renders the straight line.
        });
    }

    // Token-gated tracking fetch (drives PENDING->SUCCESS/FAILED).
    if (token) {
      fetchPublicTracking(reportId, token)
        .then((data) => {
          setTracking(data);
          setTrackingState(data.routing_data_source ? 'SUCCESS' : 'FAILED');
        })
        .catch(() => {
          setTrackingState('FAILED');
        })
        .finally(() => setTrackingLoading(false));
    } else {
      setTrackingLoading(false);
      setTrackingState('FAILED');
    }
  }, [latitude, longitude]);

  async function handleSubmit() {
    const payload = buildPayload();
    if (!payload) {
      setSubmitError('A description and a location are required to submit.');
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
      await fetchTrackingAndStations(resp);
      setMode('receipt');
      setSubmitting(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Submission failed. Please try again.';
      setSubmitError(msg);
      setSubmitting(false);
    }
  }

  async function handleQueueOffline() {
    const payload = buildPayload();
    if (!payload) {
      setSubmitError('A description and a location are required to queue.');
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
        trackingState={trackingState}
      />
    );
  }

  if (mode === 'queued') {
    return (
      <div className="min-h-screen" style={{ background: 'var(--content-bg)' }}>
        <SafetyBanner />
        <div className="max-w-lg mx-auto px-4 mt-6 pb-8">
          <div className="card overflow-hidden">
            <div className="p-6 text-center">
              <div className="mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: 'rgba(34,197,94,0.1)' }}>
                <RefreshCw className="w-8 h-8 text-green-600" />
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
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-4 text-left">
                <p className="text-sm font-semibold text-red-700">For immediate danger, call 911 now.</p>
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
        <div className="min-h-screen" style={{ background: 'var(--content-bg)' }}>
          <SafetyBanner />
          <div className="max-w-lg mx-auto px-4 mt-10 pb-8">
            <div className="card overflow-hidden">
              <div className="p-6 text-center space-y-4">
                <AlertTriangle className="w-10 h-10 mx-auto text-amber-500" />
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
                    className="w-full py-3 rounded-xl text-white text-sm font-bold"
                    style={{ background: 'var(--bfp-gradient)' }}
                  >
                    Continue draft
                  </button>
                  <button
                    type="button"
                    onClick={startFresh}
                    data-testid="start-fresh"
                    className="w-full py-3 rounded-xl border text-sm font-medium"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
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
    <div className="min-h-screen" style={{ background: 'var(--content-bg)' }}>
      <SafetyBanner />

      <div className="max-w-lg mx-auto px-4 mt-4 pb-8">
        <div className="card overflow-hidden">
          <div className="card-body p-6 space-y-5">
            {/* Progress */}
            <div className="flex items-center gap-1" data-testid="wizard-progress">
              {STEPS.map((label, i) => (
                <div key={label} className="flex-1 flex items-center">
                  <div
                    className="flex-1 h-1.5 rounded-full"
                    style={{ backgroundColor: i <= stepIndex ? '#991B1B' : 'var(--border-color)' }}
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
                contactName={contactName}
                contactPhone={contactPhone}
                notes={notes}
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
                onBack={goBack}
                onSubmit={handleSubmit}
                onQueueOffline={handleQueueOffline}
              />
            )}

            {/* Navigation (Review step has its own buttons) */}
            {stepIndex < STEPS.length - 1 && (
              <div className="flex gap-3 pt-2">
                {stepIndex > 0 && (
                  <button
                    type="button"
                    onClick={goBack}
                    className="flex items-center gap-1 px-4 py-3 rounded-xl border text-sm font-medium transition-colors"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', backgroundColor: 'var(--card-bg)' }}
                  >
                    <ArrowLeft className="w-4 h-4" /> Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={stepIndex === 3 ? handleReviewEnterThenNext : goNext}
                  disabled={stepIndex === 3 && description.trim().length === 0}
                  className="flex-1 py-3.5 rounded-xl text-white text-sm font-bold disabled:opacity-40 transition-all"
                  style={{ background: 'var(--bfp-gradient)', boxShadow: '0 2px 8px rgba(153,27,34,0.3)' }}
                >
                  {stepIndex === STEPS.length - 2 ? 'Review' : 'Continue'}
                </button>
              </div>
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
