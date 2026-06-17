'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MapPicker } from '@/components/MapPicker';
import { PublicFireMap } from '@/components/PublicFireMap';
import { fetchCivilianDuplicateSuggestions, submitCivilianReportV2, appendCivilianReport } from '@/lib/api';
import type { CivilianCategory, CivilianDuplicateSuggestion, CivilianReportV2Payload, ReportingContext, SafetyStatus } from '@/lib/api';
import React from 'react';

import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle,
  ChevronLeft,
  Circle,
  Clock,
  Flame,
  HelpCircle,
  Locate,
  MapPin,
  PhoneCall,
  RefreshCw,
  Search,
  Truck,
  User,
  XCircle,
  Zap,
} from 'lucide-react';
import { CalmEmergencyBlock } from './CalmEmergencyBlock';
import { EmergencyReferenceCard } from '@/components/EmergencyReferenceCard';
// ── Constants ────────────────────────────────────────────────────────────────

const GPS_TIMEOUT_MS = 10_000;
const GPS_MISMATCH_THRESHOLD_M = 200;

const CATEGORIES: { value: CivilianCategory; label: string; labelFil: string; icon: React.ReactElement<{ className?: string }> }[] = [
  { value: 'STRUCTURAL', label: 'Structural', labelFil: 'Gusali', icon: <Flame className="w-5 h-5" /> },
  { value: 'NON_STRUCTURAL', label: 'Non-Structural', labelFil: 'Di-gusali', icon: <Zap className="w-5 h-5" /> },
  { value: 'TRANSPORTATION', label: 'Transportation', labelFil: 'Transport', icon: <Truck className="w-5 h-5" /> },
  { value: 'UNSURE', label: 'Unsure', labelFil: 'Hindi sigurado', icon: <HelpCircle className="w-5 h-5" /> },
];

const SUB_CATEGORIES: Record<CivilianCategory, { value: string; label: string; labelFil: string }[]> = {
  STRUCTURAL: [
    { value: 'RESIDENTIAL', label: 'Residential', labelFil: 'Residensiyal' },
    { value: 'COMMERCIAL', label: 'Commercial', labelFil: 'Komersiyal' },
    { value: 'INDUSTRIAL', label: 'Industrial', labelFil: 'Industriya' },
    { value: 'MIXED_USE', label: 'Mixed Use', labelFil: 'Halo-halo' },
    { value: 'OPEN_STRUCTURE', label: 'Open Structure', labelFil: ' Bukas na estruktura' },
  ],
  NON_STRUCTURAL: [
    { value: 'WILDLAND', label: 'Wildland', labelFil: 'Kagubatan' },
    { value: 'VEHICLE', label: 'Vehicle', labelFil: 'Sasakyan' },
    { value: 'ELECTRICAL', label: 'Electrical', labelFil: 'Elektrikal' },
    { value: 'GARBAGE', label: 'Garbage/Dump', labelFil: 'Basura' },
    { value: 'OTHER', label: 'Other', labelFil: 'Iba pa' },
  ],
  TRANSPORTATION: [
    { value: 'VEHICLE_FIRE', label: 'Vehicle Fire', labelFil: 'Sunog ng sasakyan' },
    { value: 'MARINE_VESSEL', label: 'Marine Vessel', labelFil: 'Barko' },
    { value: 'AIRCRAFT', label: 'Aircraft', labelFil: 'Eroplano' },
    { value: 'RAIL', label: 'Rail', labelFil: 'Riles' },
  ],
  UNSURE: [],
};

const REPORTING_CONTEXTS: { value: ReportingContext; label: string; labelFil: string; desc: string; descFil: string }[] = [
  { value: 'WITNESS', label: 'I saw it happen', labelFil: 'Nakita ko', desc: 'I am at or near the fire location', descFil: 'Nasa lugar ako ng sunog' },
  { value: 'NEARBY', label: 'I am nearby', labelFil: 'Malapit lang ako', desc: 'I am in the area but not at the exact spot', descFil: ' Nasa lugar ako ngunit hindi eksakto' },
  { value: 'SECONDHAND', label: 'Someone told me', labelFil: 'May nagbigay info', desc: 'I heard about this from someone else', descFil: 'May nagkwento sa akin' },
];

const SAFETY_STATUSES: { value: SafetyStatus; label: string; labelFil: string; desc: string; descFil: string; urgent: boolean }[] = [
  { value: 'I_AM_SAFE', label: 'I am safe', labelFil: 'Ligtas ako', desc: 'I am not in danger', descFil: 'Wala akong panganib', urgent: false },
  { value: 'I_NEED_HELP', label: 'I need help', labelFil: 'Kailangan ko ng tulong', desc: 'I am in danger and need emergency assistance', descFil: 'Nasa peligro ako at kailangan ko ng saklolo', urgent: true },
  { value: 'SOMEONE_ELSE_NEEDS_HELP', label: 'Someone else needs help', labelFil: 'May iba na kailangan ng tulong', desc: 'Someone else is in danger', descFil: 'May ibang tao ang nasa peligro', urgent: true },
  { value: 'UNKNOWN', label: 'I am not sure', labelFil: 'Hindi ako sigurado', desc: 'I cannot tell my safety status', descFil: 'Hindi ko alam ang kalagayan ko', urgent: false },
];

// ── Types ────────────────────────────────────────────────────────────────────

type Step = 'context' | 'safety' | 'category' | 'details' | 'review' | 'submitted' | 'update';

interface GeoState {
  latitude: number | null;
  longitude: number | null;
  source: 'gps' | 'pin' | null;
  denied: boolean;
  timedOut: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Components ───────────────────────────────────────────────────────────────

function ProgressBar({ current, total }: { current: number; total: number }) {
  const labels = ['Safety', 'Context', 'Category', 'Details'];
  return (
    <div className="flex items-center mb-6">
      {labels.map((label, i) => {
        const isComplete = i < current;
        const isActive = i === current;
        return (
          <div key={label} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-200"
                style={{
                  backgroundColor: isComplete ? 'var(--step-complete)' : isActive ? 'var(--step-active)' : 'transparent',
                  borderColor: isComplete ? 'var(--step-complete)' : isActive ? 'var(--step-active)' : 'var(--step-inactive)',
                  color: isComplete || isActive ? '#ffffff' : 'var(--text-secondary)',
                  boxShadow: isActive ? '0 0 0 3px rgba(153,27,27,0.15)' : 'none',
                }}
              >
                {isComplete ? (
                  <CheckCircle className="w-4 h-4" />
                ) : (
                  i + 1
                )}
              </div>
              <span
                className="text-xs mt-1.5 font-medium"
                style={{ color: isActive ? '#991B1B' : 'var(--text-muted)' }}
              >
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div
                className="h-0.5 flex-1 mx-1 mb-4 rounded"
                style={{ backgroundColor: i < current ? 'var(--step-complete)' : 'var(--step-inactive)' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ContextCard({ value, selected, onSelect }: { value: (typeof REPORTING_CONTEXTS)[0]; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left rounded-xl p-4 transition-all duration-200 relative overflow-hidden"
      style={{
        border: `2px solid ${selected ? '#991B1B' : 'var(--border-color)'}`,
        backgroundColor: selected ? 'rgba(153,27,27,0.04)' : 'var(--card-bg)',
        boxShadow: selected ? '0 0 0 3px rgba(153,27,27,0.12)' : '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <div className="flex items-start gap-3">
        <div>
          <p className="font-semibold text-sm" style={{ color: selected ? '#991B1B' : 'var(--text-primary)' }}>{value.label}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{value.desc}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--bilingual-color)' }}>{value.labelFil}</p>
        </div>
      </div>
    </button>
  );
}

function SafetyCard({ value, selected, onSelect }: { value: (typeof SAFETY_STATUSES)[0]; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left rounded-xl p-4 transition-all duration-200 relative overflow-hidden"
      style={{
        border: `2px solid ${selected ? '#991B1B' : 'var(--border-color)'}`,
        backgroundColor: selected ? 'rgba(153,27,27,0.04)' : 'var(--card-bg)',
        boxShadow: selected ? '0 0 0 3px rgba(153,27,27,0.12)' : '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      {value.urgent && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
          style={{ backgroundColor: selected ? '#991B1B' : 'var(--border-color)' }}
        />
      )}
      <div className="flex items-start gap-3 pl-3">
        {value.urgent && (
          <div
            className="w-2 h-2 rounded-full mt-2 flex-shrink-0"
            style={{ backgroundColor: selected ? '#991B1B' : 'var(--text-muted)' }}
          />
        )}
        <div>
          <p className="font-semibold text-sm" style={{ color: value.urgent && selected ? '#991B1B' : 'var(--text-primary)' }}>
            {value.label}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{value.desc}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--bilingual-color)' }}>{value.labelFil}</p>
        </div>
      </div>
    </button>
  );
}

function CategoryCard({ cat, selected, onSelect }: { cat: (typeof CATEGORIES)[0]; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex flex-col items-center gap-2.5 p-5 rounded-xl border-2 transition-all duration-200"
      style={{
        borderColor: selected ? '#991B1B' : 'var(--border-color)',
        backgroundColor: selected ? 'rgba(153,27,27,0.04)' : 'var(--card-bg)',
        boxShadow: selected ? '0 0 0 3px rgba(153,27,27,0.10)' : '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center transition-colors"
        style={{ backgroundColor: selected ? 'rgba(153,27,27,0.10)' : 'var(--content-bg)' }}
      >
        <div style={{ color: selected ? '#991B1B' : 'var(--text-secondary)' }}>
          {React.cloneElement(cat.icon, { className: 'w-6 h-6' })}
        </div>
      </div>
      <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{cat.label}</p>
      <p className="text-xs" style={{ color: 'var(--bilingual-color)' }}>{cat.labelFil}</p>
    </button>
  );
}

function SubCategoryGrid({ options, selected, onSelect }: { options: { value: string; label: string; labelFil: string }[]; selected: string | null; onSelect: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onSelect(opt.value)}
          className="py-3 px-3 rounded-lg border text-center text-sm transition-all"
          style={{
            borderColor: selected === opt.value ? 'var(--bfp-red, #dc2626)' : 'var(--border-color, #e5e7eb)',
            backgroundColor: selected === opt.value ? 'rgba(220, 38, 38, 0.06)' : 'transparent',
            color: selected === opt.value ? 'var(--bfp-red, #dc2626)' : 'var(--text-primary)',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function GpsMismatchModal({ pinDist, onConfirm, onCancel }: { pinDist: number; onConfirm: () => void; onCancel: () => void }) {
  // Trap Escape key to close modal
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="w-6 h-6 text-yellow-500 flex-shrink-0" />
          <div>
            <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Location mismatch detected</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>Naiiba ang location na itinuro mo mula sa iyong kasalukuyang posisyon</p>
          </div>
        </div>
        <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
          The pin is <strong>{Math.round(pinDist)}m</strong> away from your current location. Is this correct?
        </p>
        <p className="text-xs mb-6" style={{ color: 'var(--text-secondary)' }}>
          Ang pin mo ay <strong>{Math.round(pinDist)}m</strong> ang layo mula sa iyong kasalukuyang lokasyon. Tamang-tama ba ito?
        </p>
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className="flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', backgroundColor: 'var(--card-bg)' }}>
            Go back
          </button>
          <button type="button" onClick={onConfirm} className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold transition-all" style={{ backgroundColor: '#991B1B', boxShadow: '0 2px 8px rgba(153,27,27,0.3)' }}>
            Yes, this is correct
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function ReportPage() {
  const searchParams = useSearchParams();
  const updateReportIdParam = searchParams.get('update_report_id');

  const [step, setStep] = useState<Step>('safety');
  const [isUpdateMode, setIsUpdateMode] = useState(!!updateReportIdParam);
  const [reportingContext, setReportingContext] = useState<ReportingContext | null>(null);
  const [safetyStatus, setSafetyStatus] = useState<SafetyStatus | null>(null);
  const [category, setCategory] = useState<CivilianCategory | null>(null);
  const [subCategory, setSubCategory] = useState<string | null>(null);
  const [observedTime, setObservedTime] = useState<string>('');
  const [witnessName, setWitnessName] = useState('');
  const [witnessPhone, setWitnessPhone] = useState('');
  const [gpsWarningConfirmed, setGpsWarningConfirmed] = useState(false);

  const [geo, setGeo] = useState<GeoState>({ latitude: null, longitude: null, source: null, denied: false, timedOut: false });
  const [phoneGeo, setPhoneGeo] = useState<{ lat: number; lng: number } | null>(null);
  // Tracks GPS permission/timeout state for phone — kept separate from the pin geo
  const [phoneGeoStatus, setPhoneGeoStatus] = useState<{ denied: boolean; timedOut: boolean }>({ denied: false, timedOut: false });
  const [showGpsMismatch, setShowGpsMismatch] = useState(false);
  const [gpsMismatchDist, setGpsMismatchDist] = useState(0);
  const [gpsSource, setGpsSource] = useState<'acquired' | 'manual' | null>(null);
  const [gpsChallengeOpen, setGpsChallengeOpen] = useState(false);
  const [pinClearedFromChallenge, setPinClearedFromChallenge] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitErrorType, setSubmitErrorType] = useState<'network' | 'validation' | 'rate_limit' | 'server' | 'unknown' | null>(null);
  const [submittedReportId, setSubmittedReportId] = useState<number | null>(null);
  const [submittedResponse, setSubmittedResponse] = useState<Awaited<ReturnType<typeof submitCivilianReportV2>> | null>(null);
  const [duplicateSuggestions, setDuplicateSuggestions] = useState<CivilianDuplicateSuggestion[]>([]);
  const [appendDescription, setAppendDescription] = useState('');
  const [appendTimestamp, setAppendTimestamp] = useState('');
  const [appending, setAppending] = useState(false);
  const [appendError, setAppendError] = useState<string | null>(null);
  const [appendSubmitted, setAppendSubmitted] = useState(false);

  const geoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLifeSafety = safetyStatus === 'I_NEED_HELP' || safetyStatus === 'SOMEONE_ELSE_NEEDS_HELP';

  // Step index for progress bar
  const stepOrder: Step[] = ['safety', 'context', 'category', 'details'];
  const currentStepIndex = stepOrder.indexOf(step as Step);

  // ── GPS ────────────────────────────────────────────────────────────────────

  /**
   * requestGps mode:
   *  - 'gps'       : WITNESS — set geo as the incident location AND populate phoneGeo
   *  - 'phone-only': NEARBY/SECONDHAND — populate phoneGeo + phoneGeoStatus only; do NOT overwrite the pin
   */
  function requestGps(mode: 'gps' | 'phone-only' = 'gps') {
    if (!navigator.geolocation) {
      if (mode === 'gps') {
        setGeo((g) => ({ ...g, denied: true, timedOut: true }));
      }
      setPhoneGeoStatus({ denied: true, timedOut: true });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setPhoneGeo({ lat, lng });
        setPhoneGeoStatus({ denied: false, timedOut: false });
        if (mode === 'gps') {
          // Only overwrite geo if user is still on WITNESS and hasn't placed a manual pin yet
          setGeo((g) => {
            if (g.source === 'pin') return g; // never clobber a manual pin
            return { latitude: lat, longitude: lng, source: 'gps', denied: false, timedOut: false };
          });
          setGpsSource('acquired');
        }
      },
      () => {
        setPhoneGeoStatus({ denied: true, timedOut: false });
        if (mode === 'gps') {
          setGeo((g) => ({ ...g, denied: true }));
        }
        if (geoTimeoutRef.current) clearTimeout(geoTimeoutRef.current);
      },
      { timeout: GPS_TIMEOUT_MS, maximumAge: 30_000 }
    );
    geoTimeoutRef.current = setTimeout(() => {
      if (mode === 'gps') {
        setGeo((g) => {
          if (g.source === 'gps') return g;
          return { ...g, timedOut: true };
        });
      }
      setPhoneGeoStatus((s) => s.denied ? s : { ...s, timedOut: true });
    }, GPS_TIMEOUT_MS);
  }

  // Auto-request GPS based on context:
  // - WITNESS: GPS becomes the incident location (geo.source = 'gps')
  // - NEARBY/SECONDHAND: request GPS in background for mismatch check only; never overwrite the pin
  useEffect(() => {
    if (reportingContext === 'WITNESS' && geo.source === null && !geo.denied && !geo.timedOut) {
      requestGps('gps');
    }
    if (reportingContext === 'NEARBY' || reportingContext === 'SECONDHAND') {
      // Request phone GPS for mismatch detection; do not use it as the incident location.
      // Clear any stale mismatch confirmation when context changes.
      setGpsWarningConfirmed(false);
      requestGps('phone-only');
    }
    // When context changes away from WITNESS, reset geo to require a pin — but only
    // if the user has not already placed a manual pin (never clobber an existing pin).
    if (reportingContext !== 'WITNESS' && geo.source === 'gps') {
      setGeo({ latitude: null, longitude: null, source: null, denied: false, timedOut: false });
      setPhoneGeo(null);
    }
  }, [reportingContext]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear mismatch confirmation when the pin changes (user dragged to a new spot)
  function handlePinChange(lat: number, lng: number) {
    setGpsWarningConfirmed(false);
    setGeo({ latitude: lat, longitude: lng, source: 'pin', denied: false, timedOut: false });
    setGpsSource('manual');
    setPinClearedFromChallenge(false);
  }

  // ── Context step ────────────────────────────────────────────────────────────

  function handleContextSelect(ctx: ReportingContext) {
    setReportingContext(ctx);
  }

  function canProceedFromContext(): boolean {
    if (reportingContext === 'WITNESS') {
      return geo.latitude !== null || geo.denied || geo.timedOut;
    }
    return geo.latitude !== null;
  }

  function tryAdvanceFromContext() {
    if (!canProceedFromContext()) return;

    // NEARBY / SECONDHAND: check GPS mismatch vs phone GPS
    if ((reportingContext === 'NEARBY' || reportingContext === 'SECONDHAND') && geo.source === 'pin' && phoneGeo) {
      const dist = haversineM(phoneGeo.lat, phoneGeo.lng, geo.latitude!, geo.longitude!);
      if (dist > GPS_MISMATCH_THRESHOLD_M) {
        setGpsMismatchDist(dist);
        setShowGpsMismatch(true);
        return;
      }
    }

    setStep('category');
  }

  function handleGpsMismatchConfirm() {
    setGpsWarningConfirmed(true);
    setShowGpsMismatch(false);
    setStep('category');
  }

  function handleGpsMismatchCancel() {
    setShowGpsMismatch(false);
  }

  // ── Safety step ─────────────────────────────────────────────────────────────

  function handleSafetySelect(status: SafetyStatus) {
    setSafetyStatus(status);
  }

  // ── Category step ───────────────────────────────────────────────────────────

  function handleCategorySelect(cat: CivilianCategory) {
    setCategory(cat);
    setSubCategory(null);
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  function getDeviceId(): string {
    const key = 'wims_civilian_device_id';
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const generated = window.crypto?.randomUUID?.() ?? '00000000-0000-4000-8000-000000000000';
    window.localStorage.setItem(key, generated);
    return generated;
  }

  function buildPayload(): CivilianReportV2Payload | null {
    if (!geo.latitude || !reportingContext || !safetyStatus || !category) return null;
    return {
      latitude: geo.latitude,
      longitude: geo.longitude!,
      category,
      sub_category: subCategory ?? undefined,
      reporting_context: reportingContext,
      safety_status: safetyStatus,
      phone_latitude: phoneGeo?.lat,
      phone_longitude: phoneGeo?.lng,
      gps_distance_m:
        phoneGeo && geo.latitude
          ? haversineM(phoneGeo.lat, phoneGeo.lng, geo.latitude, geo.longitude!)
          : undefined,
      gps_warning_confirmed: gpsWarningConfirmed,
      witness_name: witnessName || undefined,
      witness_phone: witnessPhone || undefined,
      reported_at: observedTime ? new Date(observedTime).toISOString() : undefined,
      device_id: getDeviceId(),
    };
  }

  async function handleReviewBeforeSubmit() {
    const payload = buildPayload();
    if (!payload) return;
    setSubmitError(null);
    setDuplicateSuggestions([]);
    try {
      const suggestions = await fetchCivilianDuplicateSuggestions(payload);
      setDuplicateSuggestions(suggestions);
    } catch {
      setDuplicateSuggestions([]);
    }
    setStep('review');
  }

  async function handleAppend() {
    if (!submittedReportId || !appendDescription.trim()) return;
    setAppending(true);
    setAppendError(null);
    try {
      await appendCivilianReport(submittedReportId, {
        latitude: geo.latitude ?? undefined,
        longitude: geo.longitude ?? undefined,
        category: category ?? undefined,
        reporting_context: reportingContext ?? undefined,
        safety_status: safetyStatus ?? undefined,
        reported_at: appendTimestamp || undefined,
        description: appendDescription.trim(),
      });
      setAppendSubmitted(true);
    } catch (err) {
      setAppendError(err instanceof Error ? err.message : 'Update failed. Please try again.');
    } finally {
      setAppending(false);
    }
  }

  async function handleSubmit() {
    const payload = buildPayload();
    if (!payload) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await submitCivilianReportV2(payload);
      setSubmittedResponse(res);
      setSubmittedReportId(res.report_id);
      setStep('submitted');
    } catch (err) {
      // Detect error type for targeted copy + 911 boundary
      const isNetworkError = err instanceof TypeError || (err instanceof Error && err.message.includes('fetch'));
      const status = (err as { response?: { status?: number } })?.response?.status;
      let type: typeof submitErrorType = 'unknown';
      if (isNetworkError) type = 'network';
      else if (status === 422) type = 'validation';
      else if (status === 429) type = 'rate_limit';
      else if (status && status >= 500) type = 'server';
      setSubmitErrorType(type);
      setSubmitError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
      setSubmitting(false);
    }
  }

  // ── Review screen (non-life-safety final check) ─────────────────────────

  if (step === 'review') {
    return (
      <div className="min-h-screen" style={{ background: 'var(--content-bg)' }}>
        <div className="text-center py-6 px-4" style={{ background: 'var(--bfp-gradient)' }}>
          <h1 className="text-lg font-bold text-white">Review Your Report</h1>
          <p className="text-xs text-white/60 mt-0.5">Suriin ang iyong report</p>
        </div>
        <div className="max-w-lg mx-auto px-4 mt-4 pb-8">
          <div className="card overflow-hidden">
          <div className="card-body space-y-4 p-6">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Context</span>
                <span style={{ color: 'var(--text-primary)' }}>{reportingContext}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Safety</span>
                <span style={{ color: 'var(--text-primary)' }}>{safetyStatus}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Category</span>
                <span style={{ color: 'var(--text-primary)' }}>{category}{subCategory ? ` / ${subCategory}` : ''}</span>
              </div>
              {observedTime && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>Observed at</span>
                  <span style={{ color: 'var(--text-primary)' }}>{new Date(observedTime).toLocaleString()}</span>
                </div>
              )}
              {witnessName && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>Witness</span>
                  <span style={{ color: 'var(--text-primary)' }}>{witnessName}{witnessPhone ? ` — ${witnessPhone}` : ''}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Location</span>
                <span style={{ color: 'var(--text-primary)' }}>{geo.latitude?.toFixed(5)}, {geo.longitude?.toFixed(5)}</span>
              </div>
            </div>

            <div className="text-xs p-3 rounded-lg" style={{ backgroundColor: 'var(--content-bg)', color: 'var(--text-secondary)' }}>
              Do not move closer or take photos if unsafe.
              <br />Huwag lumapit sa sunog kung hindi ka ligtas.
            </div>

            {/*
              911 emergency boundary — ALL users before final submit CTA.
              Required: "does not replace emergency call" in EN+FIL.
            */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-700">
                    For immediate danger, call 911 now. This report does not replace an emergency call.
                  </p>
                  <p className="text-xs text-red-600 mt-0.5">
                    Kung may agarang peligro, tumawag sa 911 ngayon. Ang report na ito ay hindi kapalit ng agarang tawag sa 911.
                  </p>
                </div>
              </div>
            </div>

            {duplicateSuggestions.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">Similar nearby report found</p>
                <p className="mt-1 text-xs">You may still submit this report; validators will use it as another signal.</p>
                <div className="mt-2 space-y-1">
                  {duplicateSuggestions.map((suggestion) => (
                    <div key={suggestion.report_id} className="flex justify-between gap-3 text-xs">
                      <span>Report #{suggestion.report_id} · {Math.round(suggestion.distance_m)}m away</span>
                      <span>{suggestion.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {submitError && submitErrorType && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-700">
                      {submitErrorType === 'network' && 'Network error. Check your connection.'}
                      {submitErrorType === 'validation' && 'Missing required information.'}
                      {submitErrorType === 'rate_limit' && 'Too many reports from this network.'}
                      {submitErrorType === 'server' && 'Server error. Please try again later.'}
                      {submitErrorType === 'unknown' && 'Submission failed. Please try again.'}
                    </p>
                    <p className="text-xs text-red-600 mt-0.5">
                      {submitErrorType === 'network' && 'Make sure you are connected to the internet and try again.'}
                      {submitErrorType === 'validation' && 'Please check the form and try again.'}
                      {submitErrorType === 'rate_limit' && 'Try tracking or updating an existing report instead.'}
                      {submitErrorType === 'server' && 'Retry in a few minutes. If this persists, contact BFP directly.'}
                      {submitErrorType === 'unknown' && 'If this persists, call 911 for immediate danger.'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep('details')}
                className="flex-1 py-3 rounded-xl border text-sm font-medium transition-colors"
                style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', backgroundColor: 'var(--card-bg)' }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 py-3.5 rounded-xl text-white text-sm font-bold disabled:opacity-50 transition-all"
                style={{ background: 'var(--bfp-gradient)', boxShadow: '0 2px 8px rgba(153,27,34,0.3)' }}
              >
                {submitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    );
  }

  // ── Update Report (appending to existing) ─────────────────────────────────

  if (isUpdateMode) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--content-bg)' }}>
        <div className="text-center py-6 px-4" style={{ background: 'var(--bfp-gradient)' }}>
          <h1 className="text-lg font-bold text-white">Update Report #{updateReportIdParam}</h1>
          <p className="text-xs text-white/60 mt-0.5">Magdagdag ng impormasyon sa iyong umiiral na report</p>
        </div>
        <div className="max-w-lg mx-auto px-4 mt-4 pb-8">
          <div className="card overflow-hidden">

          {appendSubmitted ? (
            <div className="p-6 space-y-4 text-center">
              <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: 'rgba(34,197,94,0.1)' }}>
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Update Submitted</h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Your update for Report #{updateReportIdParam} has been received.
              </p>
              <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
                Ang update mo para sa Report #{updateReportIdParam} ay natanggap na.
              </p>
              <div className="space-y-2">
                <Link
                  href={`/tracking?id=${updateReportIdParam}`}
                  className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl text-white text-sm font-semibold transition-colors"
                  style={{ background: 'var(--bfp-gradient)' }}
                >
                  Track This Report
                </Link>
                <Link
                  href="/"
                  className="flex items-center justify-center w-full py-2.5 text-sm font-medium"
                  style={{ color: 'var(--bfp-red, #dc2626)' }}
                >
                  Submit a New Report
                </Link>
              </div>
            </div>
          ) : (
            <div className="card-body space-y-4 p-6">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Append additional information to your existing report. This will be reviewed by BFP validators.
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Magdagdag ng karagdagang impormasyon sa iyong umiiral na report. Ito ay susuriin ng mga BFP validator.
              </p>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>
                  Additional Information *
                </label>
                <textarea
                  value={appendDescription}
                  onChange={(e) => setAppendDescription(e.target.value)}
                  placeholder="Describe any new details, changes, or additional observations…"
                  rows={5}
                  className="w-full rounded-xl border px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--input-bg)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>
                  Revised / Additional Timestamp
                </label>
                <input
                  type="datetime-local"
                  value={appendTimestamp}
                  onChange={(e) => setAppendTimestamp(e.target.value)}
                  className="w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--input-bg)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                />
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Optional — only fill this if the information you are providing has a different timestamp.
                </p>
              </div>

              {appendError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                  {appendError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Link
                  href="/"
                  className="flex-1 flex items-center justify-center py-2.5 rounded-xl border text-sm font-medium"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                >
                  Cancel
                </Link>
                <button
                  type="button"
                  onClick={handleAppend}
                  disabled={appending || !appendDescription.trim()}
                  className="flex-1 flex items-center justify-center py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
                  style={{ background: 'var(--bfp-gradient)' }}
                >
                  {appending ? 'Submitting…' : 'Submit Update'}
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    );
  }

  // ── Submitted success screen ─────────────────────────────────────────────

  if (step === 'submitted') {
    return (
      <div className="min-h-screen" style={{ background: 'var(--content-bg)' }}>
        <div className="text-center py-6 px-4" style={{ background: 'var(--bfp-gradient)' }}>
          <div className="mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
            <CheckCircle className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">
            Report Submitted
          </h1>
          <p className="text-xs text-white/60 mt-1">
            Report #{submittedReportId} has been received.
          </p>
        </div>
        <div className="max-w-lg mx-auto px-4 mt-4 pb-8">
          <div className="card overflow-hidden">
            <div className="p-6 text-center">

            <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
              Ang report #{submittedReportId} ay natanggap na.
            </p>

              {/*
              911 emergency boundary — ALL submissions, every safety status.
              Required: "does not replace emergency call" in EN+FIL.
            */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-left">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-700">Call 911 if you have not done so.</p>
                  <p className="text-xs text-red-600 mt-0.5">Kung kailangan mo ng agarang tulong, tumawag na sa 911.</p>
                  <p className="text-xs text-red-600 mt-1">
                    This report helps BFP review public signals — it does not replace an emergency call.
                  </p>
                  <p className="text-xs text-red-600 mt-0.5">
                    Ang report na ito ay tumutulong sa BFP na suriin ang mga signal mula sa publiko — hindi ito kapalit ng agarang tawag sa 911.
                  </p>
                </div>
              </div>
            </div>

            {submittedResponse?.nearest_station_name && (
              <div className="rounded-lg p-4 mb-4 text-left" style={{ backgroundColor: 'var(--content-bg)', border: '1px solid var(--border-color)' }}>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Nearest Fire Station</p>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{submittedResponse.nearest_station_name}</p>
                {submittedResponse.nearest_station_phone && (
                  <a
                    href={`tel:${submittedResponse.nearest_station_phone}`}
                    className="inline-flex items-center gap-1.5 mt-2 text-sm font-medium"
                    style={{ color: 'var(--bfp-red, #dc2626)' }}
                  >
                    <PhoneCall className="w-4 h-4" />
                    {submittedResponse.nearest_station_phone}
                  </a>
                )}
              </div>
            )}

            <div className="text-xs p-3 rounded-lg mb-4" style={{ backgroundColor: 'var(--content-bg)', color: 'var(--text-secondary)' }}>
              Track your report at <strong>/tracking?id={submittedReportId}</strong>
              <br />
              Subaybayan ang iyong report sa <strong>/tracking?id={submittedReportId}</strong>
            </div>

            {/* ── Update Report ─────────────────────────────────────── */}
            {!appendSubmitted ? (
              <div className="rounded-xl border p-4 mb-4 text-left" style={{ borderColor: 'var(--card-elevated-border)', backgroundColor: 'var(--card-bg)' }}>
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                  Update this report
                </p>
                <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                  Have new information? Add details without filing a new report.
                  <br />
                  <span lang="fil">May bagong impormasyon? Magdagdag ng detalye nang hindi nagfi-file ng bagong report.</span>
                </p>

                <textarea
                  className="form-input w-full mb-3"
                  style={{ minHeight: '100px', paddingTop: '0.75rem', resize: 'vertical', fontSize: '0.875rem' }}
                  placeholder="Describe any new information... / Ilarawan ang anumang bagong impormasyon..."
                  value={appendDescription}
                  onChange={(e) => setAppendDescription(e.target.value)}
                  disabled={appending}
                />

                <div className="mb-3">
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                    Revised time (optional) / Na-revise na oras (opsyonal)
                  </label>
                  <input
                    type="datetime-local"
                    className="form-input"
                    style={{ fontSize: '0.875rem' }}
                    value={appendTimestamp}
                    onChange={(e) => setAppendTimestamp(e.target.value)}
                    disabled={appending}
                  />
                </div>

                {appendError && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm mb-3">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {appendError}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handleAppend()}
                  disabled={appending || !appendDescription.trim()}
                  className="w-full py-2.5 rounded-xl border text-sm font-semibold transition-all disabled:opacity-50"
                  style={{ borderColor: '#991B1B', color: '#991B1B', backgroundColor: 'transparent' }}
                >
                  {appending ? 'Submitting update...' : 'Submit Update / Magsumite ng Update'}
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-green-200 bg-green-50 p-4 mb-4 text-left">
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-green-700">Update submitted</p>
                    <p className="text-xs text-green-600 mt-0.5">
                      Your update has been recorded. / Ang iyong update ay naitala na.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <a
              href={`/tracking?id=${submittedReportId}`}
              className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-bold"
              style={{ background: 'var(--bfp-gradient)', boxShadow: '0 2px 8px rgba(153,27,34,0.3)' }}
            >
              Track My Report
            </a>
          </div>
        </div>
        </div>
      </div>
    );
  }

  // ── Multi-step form ─────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ background: 'var(--content-bg)' }}>
      {/* Hero — matches /fire-stations style */}
      <div className="text-center py-8 px-4" style={{ background: 'var(--bfp-gradient)' }}>
        <div className="relative w-14 h-14 mx-auto mb-3">
          <Image src="/bfp-logo.svg" alt="BFP Logo" fill className="object-contain" />
        </div>
        <p className="text-xs text-white/50 uppercase tracking-widest mb-2">Bureau of Fire Protection</p>
        <h1 className="text-xl font-bold text-white leading-tight">
          Report Emergency
        </h1>
        <p className="text-xs text-white/60 mt-0.5">Mag-ulat ng Emergency</p>
      </div>

      {/* Emergency hotlines — like /fire-stations */}
      <div className="max-w-lg mx-auto px-4 -mt-4">
        <EmergencyReferenceCard compact />
      </div>

      {/* Main card */}
      <div className="max-w-lg mx-auto px-4 mt-4 pb-8">
        <div className="card overflow-hidden">

        <CalmEmergencyBlock />

        <div className="card-body space-y-5 px-6 pb-6">
          {currentStepIndex >= 0 && <ProgressBar current={currentStepIndex} total={stepOrder.length} />}

          {/* ── STEP 1: Context + Location ─────────────────────────────── */}
          {step === 'context' && (
            <>
              {/* SECONDHAND challenge modal */}
              {gpsChallengeOpen && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center p-4"
                  style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
                  onClick={(e) => { if (e.target === e.currentTarget) setGpsChallengeOpen(false); }}
                  onKeyDown={(e) => { if (e.key === 'Escape') setGpsChallengeOpen(false); }}
                  tabIndex={-1}
                >
                  <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
                    <div className="flex items-center gap-3 mb-4">
                      <MapPin className="w-6 h-6 text-yellow-500 flex-shrink-0" />
                      <div>
                        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Is this current location where the fire is?</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>Ito ba ang kasalukuyang lokasyon ng sunog?</p>
                      </div>
                    </div>
                    <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
                      You selected &quot;I saw it / Aking nakita&quot; but used current location. The pin will be set to your current location. Is that where the fire is?
                    </p>
                    <p className="text-xs mb-6" style={{ color: 'var(--text-secondary)' }}>
                      Nakita mo ito ngunit ginamit ang iyong kasalukuyang lokasyon. Ang pin ay ilalagay sa iyong kasalukuyang lokasyon. doon ba ang sunog?
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setGpsChallengeOpen(false);
                          tryAdvanceFromContext();
                        }}
                        className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold transition-all"
                        style={{ backgroundColor: '#991B1B', boxShadow: '0 2px 8px rgba(153,27,27,0.3)' }}
                      >
                        Yes, use my location
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setGpsChallengeOpen(false);
                          setGeo({ latitude: null, longitude: null, source: null, denied: false, timedOut: false });
                          setGpsSource(null);
                          setPinClearedFromChallenge(true);
                        }}
                        className="flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors"
                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', backgroundColor: 'var(--card-bg)' }}
                      >
                        No, I&apos;ll place the pin
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>How did you learn about this fire?</p>
                <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>Paano mo nalaman ang tungkol sa sunog?</p>
                <div className="grid grid-cols-1 gap-2">
                  {REPORTING_CONTEXTS.map((ctx) => (
                    <ContextCard
                      key={ctx.value}
                      value={ctx}
                      selected={reportingContext === ctx.value}
                      onSelect={() => handleContextSelect(ctx.value)}
                    />
                  ))}
                </div>
              </div>

              {reportingContext && (
                <div>
                  <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                    {reportingContext === 'WITNESS'
                      ? 'Your current location will be used as the incident location.'
                      : 'Place the pin where the fire is.'}
                  </p>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                    {reportingContext === 'WITNESS'
                      ? 'Gagamitin ang iyong kasalukuyang lokasyon bilang lokasyon ng insidente.'
                      : 'Ilagay ang pin kung saan nangyayari ang sunog.'}
                  </p>

                  {reportingContext === 'WITNESS' && (geo.latitude !== null || geo.denied || geo.timedOut) && (
                    <div className="flex items-center gap-2 p-3 rounded-lg mb-3 text-sm"
                      style={{
                        backgroundColor: geo.denied || geo.timedOut ? 'var(--content-bg)' : 'rgba(34,197,94,0.08)',
                        color: geo.denied || geo.timedOut ? 'var(--text-secondary)' : 'var(--text-primary)',
                      }}
                    >
                      {geo.latitude !== null ? (
                        <>
                          <MapPin className="w-4 h-4 text-green-600 flex-shrink-0" />
                          <span>GPS acquired — {geo.latitude.toFixed(5)}, {geo.longitude?.toFixed(5)}</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                          <span>Location access is off. Place the pin where the fire is.</span>
                        </>
                      )}
                      {geo.latitude === null && (geo.denied || geo.timedOut) && (
                        <span className="ml-auto text-xs" style={{ color: 'var(--text-secondary)' }}>
                          / Wala pang location. Maglagay ng pin.
                        </span>
                      )}
                    </div>
                  )}

                  {reportingContext !== 'WITNESS' && (
                    <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                      {geo.latitude === null && pinClearedFromChallenge
                        ? 'You chose to place the pin yourself. Tap the map to set the fire location. / Ikaw mismo ang maglalagay ng pin. I-tap ang mapa para ilagay ang lokasyon ng sunog.'
                        : geo.latitude === null && (geo.denied || geo.timedOut)
                        ? 'Location access is off. Place the pin where the fire is. / Wala ang location access. Maglagay ng pin sa lokasyon ng sunog.'
                        : 'Tap the map to pin the fire location. / I-tap ang mapa para ilagay ang pin sa lokasyon ng sunog.'}
                    </div>
                  )}

                  <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border-color)' }}>
                    <MapPicker
                      center={phoneGeo ? [phoneGeo.lat, phoneGeo.lng] : undefined}
                      value={geo.latitude !== null ? { lat: geo.latitude, lng: geo.longitude! } : null}
                      onChange={handlePinChange}
                    />
                  </div>

                  {(phoneGeoStatus.denied || phoneGeoStatus.timedOut) && reportingContext !== 'WITNESS' && (
                    <>
                      {/* 911 reminder — life-safety path only */}
                      {isLifeSafety && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 mb-2">
                          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600" />
                          <div>
                            <p className="text-xs font-semibold text-red-700">
                              For immediate danger, call 911. Your report helps BFP — but for life-threatening situations, call emergency services first.
                            </p>
                            <p className="text-xs text-red-600 mt-0.5">
                              Kung may agarang peligro, tumawag sa 911. Ang report mo ay tumutulong sa BFP — ngunit para sa mga Sitwasyong may banta sa buhay, tumawag muna sa emergency services.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Retry button */}
                      <div className="flex items-center gap-2 mt-1">
                        <button
                          type="button"
                          onClick={() => requestGps('phone-only')}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border"
                          style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
                        >
                          <Locate className="w-3.5 h-3.5" /> Try again / Subukan ulit
                        </button>
                      </div>
                    </>
                  )}

                  {/* NEARBY reminder — non-blocking, shows above Continue */}
                  {reportingContext === 'NEARBY' && gpsSource === 'acquired' && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 mb-2">
                      <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" />
                      <div>
                        <p className="text-xs font-medium text-amber-800">
                          If the fire is not exactly where you are, place the pin on the fire instead.
                        </p>
                        <p className="text-xs text-amber-600 mt-0.5">
                          Kung ang sunog ay wala sa iyong kasalukuyang lokasyon, ilagay ang pin sa lokasyon ng sunog.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('safety')}
                  className="flex items-center gap-1 px-4 py-3 rounded-xl border text-sm font-medium transition-colors"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', backgroundColor: 'var(--card-bg)' }}
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (canProceedFromContext()) {
                      if (reportingContext === 'SECONDHAND' && gpsSource === 'acquired') {
                        setGpsChallengeOpen(true);
                      } else {
                        tryAdvanceFromContext();
                      }
                    }
                  }}
                  disabled={!canProceedFromContext()}
                  className="flex-1 py-3.5 rounded-xl text-white text-sm font-bold disabled:opacity-40 transition-all"
                  style={{ background: 'var(--bfp-gradient)', boxShadow: '0 2px 8px rgba(153,27,34,0.3)' }}
                >
                  Continue
                </button>
              </div>
            </>
          )}

          {/* ── STEP 2: Safety Status ─────────────────────────────────── */}
          {step === 'safety' && (
            <>
              <div>
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Are you or anyone else in danger?</p>
                <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>May peligro ba kayo o may ibang tao?</p>
                <div className="grid grid-cols-1 gap-2">
                  {SAFETY_STATUSES.map((s) => (
                    <SafetyCard
                      key={s.value}
                      value={s}
                      selected={safetyStatus === s.value}
                      onSelect={() => handleSafetySelect(s.value)}
                    />
                  ))}
                </div>
              </div>

              {isLifeSafety && (
                <div className="rounded-xl p-4" style={{ backgroundColor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)' }}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(220,38,38,0.12)' }}>
                      <AlertTriangle className="w-5 h-5 text-red-600" />
                    </div>
                    <p className="text-sm font-semibold text-red-700">Call 911 immediately if you have not done so.</p>
                  </div>
                  <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>Kung kailangan mo ng tulong, tumawag na sa 911.</p>
                  {geo.latitude && geo.longitude && (
                    <a
                      href="tel:911"
                      className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-bold"
                      style={{ backgroundColor: '#991B1B', boxShadow: '0 2px 8px rgba(153,27,27,0.3)' }}
                    >
                      <PhoneCall className="w-4 h-4" /> Call 911
                    </a>
                  )}
                </div>
              )}

              {/* ── Public map: show nearby fire clusters (display-only) ── */}
              <div className="mt-2">
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Nearby fire activity / Mga kalapit na sunog
                </p>
                <p className="text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Based on nearby public reports awaiting review. Not yet confirmed by BFP.
                </p>
                <PublicFireMap
                  height={200}
                  zoom={11}
                  selectionMode={false}
                />
              </div>

              <button
                type="button"
                onClick={() => setStep('context')}
                disabled={!safetyStatus}
                className="w-full py-3.5 rounded-xl text-white text-sm font-bold disabled:opacity-40 transition-all"
                style={{ background: 'var(--bfp-gradient)', boxShadow: '0 2px 8px rgba(153,27,34,0.3)' }}
              >
                Continue
              </button>
            </>
          )}

          {/* ── STEP 3: Category + Sub-category ──────────────────────── */}
          {step === 'category' && (
            <>
              <div>
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>What type of fire is this?</p>
                <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>Anong uri ng sunog ito?</p>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {CATEGORIES.map((cat) => (
                    <CategoryCard
                      key={cat.value}
                      cat={cat}
                      selected={category === cat.value}
                      onSelect={() => handleCategorySelect(cat.value)}
                    />
                  ))}
                </div>

                {category && category !== 'UNSURE' && SUB_CATEGORIES[category].length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Sub-category (optional)</p>
                    <SubCategoryGrid
                      options={SUB_CATEGORIES[category]}
                      selected={subCategory}
                      onSelect={(v) => setSubCategory(v === subCategory ? null : v)}
                    />
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {isLifeSafety && category ? (
                  <>
                    {/* Row 1: two CTAs side by side */}
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => void handleSubmit()}
                        disabled={!geo.latitude || !reportingContext || !safetyStatus || !category || submitting}
                        className="flex-1 py-3 rounded-xl text-white text-sm font-bold disabled:opacity-50 transition-all"
                        style={{ background: '#991B1B', boxShadow: '0 2px 8px rgba(153,27,27,0.3)' }}
                      >
                        {submitting ? 'Sending...' : 'Send now / Ipadala na'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setStep('details')}
                        className="flex-1 py-3 rounded-xl border text-sm font-medium transition-colors"
                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', backgroundColor: 'var(--card-bg)' }}
                      >
                        Add details / Magdagdag ng detalye
                      </button>
                    </div>
                    {/* Row 2: full-width back button */}
                    <button
                      type="button"
                      onClick={() => setStep('context')}
                      className="w-full flex items-center justify-center gap-1 px-4 py-3 rounded-xl border text-sm font-medium transition-colors"
                      style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', backgroundColor: 'var(--card-bg)' }}
                    >
                      <ChevronLeft className="w-4 h-4" /> Back / Bumalik
                    </button>
                  </>
                ) : (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setStep('context')}
                      className="flex items-center gap-1 px-4 py-3 rounded-xl border text-sm font-medium transition-colors"
                      style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', backgroundColor: 'var(--card-bg)' }}
                    >
                      <ChevronLeft className="w-4 h-4" /> Back
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep('details')}
                      disabled={!category}
                      className="flex-1 py-3.5 rounded-xl text-white text-sm font-bold disabled:opacity-40 transition-all"
                      style={{ background: 'var(--bfp-gradient)', boxShadow: '0 2px 8px rgba(153,27,34,0.3)' }}
                    >
                      Continue
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── STEP 4: Additional Details ───────────────────────────── */}
          {step === 'details' && (
            <>
              <div className="space-y-4">
                <div>
                  <label className="flex items-center gap-1.5 text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>
                    <Clock className="w-4 h-4" /> Observed time (optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={observedTime}
                    onChange={(e) => setObservedTime(e.target.value)}
                    className="form-input"
                    style={{ fontSize: '0.875rem' }}
                  />
                </div>

                {reportingContext === 'SECONDHAND' && (
                  <div>
                    <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Direct eyewitness contact (optional) / Impormasyon ng eyewitness (opsyonal)
                    </p>
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Witness name / Pangalan ng eyewitness"
                        value={witnessName}
                        onChange={(e) => setWitnessName(e.target.value)}
                        className="form-input"
                        style={{ fontSize: '0.875rem' }}
                      />
                      <input
                        type="tel"
                        placeholder="Witness phone / Telepono ng eyewitness"
                        value={witnessPhone}
                        onChange={(e) => setWitnessPhone(e.target.value)}
                        className="form-input"
                        style={{ fontSize: '0.875rem' }}
                      />
                    </div>
                  </div>
                )}

                {(reportingContext === 'WITNESS' || reportingContext === 'NEARBY') && (
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                      <User className="w-3.5 h-3.5" /> Witness name (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Your name / Pangalan mo (opsyonal)"
                      value={witnessName}
                      onChange={(e) => setWitnessName(e.target.value)}
                      className="form-input"
                      style={{ fontSize: '0.875rem' }}
                    />
                  </div>
                )}

                <div className="text-xs p-3 rounded-lg" style={{ backgroundColor: 'var(--content-bg)', color: 'var(--text-secondary)' }}>
                  <strong>Do not move closer</strong> or take photos if it is unsafe.
                  <br />
                  <strong>Huwag lumapit</strong> sa sunog o kumuha ng litrato kung hindi ka ligtas.
                </div>

              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('category')}
                  className="flex items-center gap-1 px-4 py-3 rounded-xl border text-sm font-medium transition-colors"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', backgroundColor: 'var(--card-bg)' }}
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                {isLifeSafety ? (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!geo.latitude || !reportingContext || !safetyStatus || !category || submitting}
                    className="flex-1 py-3.5 rounded-xl text-white text-sm font-bold disabled:opacity-50 transition-all"
                    style={{ background: '#991B1B', boxShadow: '0 2px 8px rgba(153,27,27,0.3)' }}
                  >
                    {submitting ? 'Sending...' : 'Fast Submit / Mabilis na I-submit'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleReviewBeforeSubmit()}
                    disabled={!geo.latitude || !reportingContext || !safetyStatus || !category}
                    className="flex-1 py-3.5 rounded-xl text-white text-sm font-bold disabled:opacity-40 transition-all"
                    style={{ background: 'var(--bfp-gradient)', boxShadow: '0 2px 8px rgba(153,27,34,0.3)' }}
                  >
                    Review & Submit
                  </button>
                )}
              </div>

              {submitError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {submitError}
                </div>
              )}
            </>
          )}
        </div>
        </div>
      </div>

      {/* ── Consent Notice & Footer ──────────────────────────────────── */}
      <div className="max-w-lg mx-auto px-4 pb-4">
        <p className="text-xs leading-relaxed text-center" style={{ color: 'var(--text-secondary)' }}>
          By submitting a fire report, you consent to the collection, processing, and
          retention of your personal data under our{' '}
          <Link
            href="/privacy"
            className="underline underline-offset-2 font-medium"
            style={{ color: 'var(--bfp-maroon-dark)' }}
          >
            Data Retention Policy
          </Link>
          . Submission implies agreement — no separate checkbox required.
        </p>
        <p className="text-[0.675rem] text-center mt-3" style={{ color: 'var(--text-muted)' }}>
          WIMS-BFP · Bureau of Fire Protection ·{' '}
          <Link
            href="/privacy"
            className="underline underline-offset-2"
            style={{ color: 'var(--bfp-maroon-dark)' }}
          >
            Privacy Policy
          </Link>
        </p>
      </div>

      {showGpsMismatch && (
        <GpsMismatchModal
          pinDist={gpsMismatchDist}
          onConfirm={handleGpsMismatchConfirm}
          onCancel={handleGpsMismatchCancel}
        />
      )}
    </div>
  );
}
