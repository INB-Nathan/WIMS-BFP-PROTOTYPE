'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Send, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  fetchRegionalIncident,
  submitIncidentForReview,
  unpendIncident,
  deleteIncident,
  forceReplaceIncident,
  apiFetch,
  ApiRequestError,
  type RegionalIncidentDetailResponse,
} from '@/lib/api';
import dynamic from 'next/dynamic';
import { UpdateRequestDiffPanel } from '@/components/UpdateRequestDiffPanel';
import type { Incident } from '@/lib/edgeFunctions';
import { getShortRegionName } from '@/lib/ph-regions';

// Read-only map zoomed in on the pinned coordinates (M4 Bug 8-B/8-C)
const IncidentLocationMap = dynamic(
  () => import('@/components/MapPickerInner').then((mod) => {
    const ReadOnlyMap = (props: { latitude: number; longitude: number }) => (
      <div style={{ height: '320px', width: '100%', overflow: 'hidden' }}>
        <mod.MapPickerInner
          value={{ lat: props.latitude, lng: props.longitude }}
          center={[props.latitude, props.longitude]}
          zoom={mod.DETAIL_INCIDENT_MAP_ZOOM}
          mapHeight={mod.DETAIL_INCIDENT_MAP_HEIGHT}
        />
      </div>
    );
    ReadOnlyMap.displayName = 'ReadOnlyIncidentMap';
    return ReadOnlyMap;
  }),
  { ssr: false, loading: () => <div className="h-[320px] bg-gray-100 animate-pulse rounded" /> },
);

// Full AFOR form used for editing
const IncidentForm = dynamic(
  () => import('@/components/IncidentForm').then((m) => m.IncidentForm),
  { ssr: false, loading: () => <div className="py-8 text-center text-gray-500">Loading form…</div> },
);
import {
  FIELD_LABELS,
  fieldLabel,
  displayValue,
  ALL_PROBLEM_OPTIONS,
  normalizeProblemLabel,
  formatClassification,
} from '@/lib/afor-utils';

// ── FIX 4: Narrative as ordered bullets ──────────────────────────────────────
function NarrativeReport({ text }: { text: string }) {
  const paragraphs = text.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!paragraphs.length) return <span className="text-gray-400 text-sm">N/A</span>;
  return (
    <ol className="list-decimal list-inside space-y-2">
      {paragraphs.map((p, i) => (
        <li key={i} className="text-sm leading-relaxed text-gray-800">{p}</li>
      ))}
    </ol>
  );
}

// ── FIX 6: Problems grid ─────────────────────────────────────────────────────
function ProblemsGrid({ selected }: { selected: string[] }) {
  const selectedSet = new Set((selected ?? []).map((s) => normalizeProblemLabel(String(s))));
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
      {ALL_PROBLEM_OPTIONS.map((label) => {
        // Normalize both the label and check against the selected set
        const normalizedLabel = normalizeProblemLabel(label);
        const checked = selectedSet.has(normalizedLabel);
        return (
          <div key={label} className="flex items-center gap-2 py-1">
            {checked
              ? <span className="text-green-600">✅</span>
              : <span className="text-gray-400">—</span>}
            <span className={`text-sm ${checked ? 'font-bold text-gray-900' : 'text-gray-400'}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── FIX 5: Personnel on Duty section ────────────────────────────────────────
type PersonnelOnDuty = Record<string, string | { name?: string; contact?: string }>;
type OtherPerson = { name: string; designation: string };

function PersonnelSection({ pod, others }: { pod: PersonnelOnDuty; others: OtherPerson[] }) {
  const simpleKeys = ['engine_commander', 'shift_in_charge', 'nozzleman', 'lineman', 'engine_crew', 'driver'];
  const complexKeys = ['safety_officer', 'fire_arson_investigator'];

  return (
    <div className="space-y-2">
      {simpleKeys.map((k) => {
        const val = pod[k];
        if (val === undefined) return null;
        return (
          <div key={k} className="grid grid-cols-3 gap-4 text-sm border-b border-gray-100 pb-2">
            <span className="font-medium text-gray-600">{FIELD_LABELS[k] ?? k}</span>
            <span className="col-span-2 text-gray-900">{displayValue(typeof val === 'string' ? val : JSON.stringify(val))}</span>
          </div>
        );
      })}
      {complexKeys.map((k) => {
        const val = pod[k];
        if (val === undefined) return null;
        const nameStr = typeof val === 'object' ? (val as { name?: string }).name ?? '' : String(val ?? '');
        const contactStr = typeof val === 'object' ? (val as { contact?: string }).contact ?? '' : '';
        return (
          <div key={k} className="grid grid-cols-3 gap-4 text-sm border-b border-gray-100 pb-2">
            <span className="font-medium text-gray-600">{FIELD_LABELS[k] ?? k}</span>
            <span className="col-span-2 text-gray-900">
              {displayValue(nameStr)}
              {contactStr ? <span className="ml-2 text-gray-500 text-xs">({contactStr})</span> : null}
            </span>
          </div>
        );
      })}

      {others.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold text-gray-500 uppercase mb-2">Other Personnel at Scene</p>
          <table className="w-full text-sm border border-gray-200 rounded overflow-hidden">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Name</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Designation / Agency</th>
              </tr>
            </thead>
            <tbody>
              {others.map((p, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-3 py-2">{displayValue(p.name)}</td>
                  <td className="px-3 py-2">{displayValue(p.designation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Generic labeled field row ────────────────────────────────────────────────
function FieldRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-gray-100 pb-3 text-sm last:border-0">
      <div className="font-medium text-gray-600">{label}</div>
      <div className="whitespace-pre-wrap break-words text-gray-900 md:col-span-2">
        {displayValue(typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : value)}
      </div>
    </div>
  );
}

// ── 24h datetime formatter ───────────────────────────────────────────────────
function fmt24h(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return String(raw);
  return d.toLocaleString('en-PH', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function splitAlarmDateTime(raw: string | null | undefined): { date: string; time: string } | null {
  if (!raw) return null;
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return { date: `${mm}-${dd}-${yyyy}`, time: `${hh}:${min}` };
}

// ── Section card ─────────────────────────────────────────────────────────────
function Section({
  title,
  sectionId,
  children,
}: {
  title: string;
  sectionId: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card" aria-labelledby={sectionId}>
      <div className="card-header px-4 py-3 border-b">
        <h2 id={sectionId} className="font-bold text-base">{title}</h2>
      </div>
      <div className="card-body p-4 space-y-3">{children}</div>
    </section>
  );
}

// ── Alarm timeline display ───────────────────────────────────────────────────
type AlarmTimelineEntry = { time?: string | null; commander?: string };
type AlarmTimeline = Record<string, AlarmTimelineEntry | string | null>;

function AlarmTimelineSection({ timeline }: { timeline: AlarmTimeline }) {
  const keys = Object.keys(timeline).filter((k) => !k.startsWith('_'));
  const hasData = keys.some((k) => {
    const v = timeline[k];
    return v && (typeof v === 'string' ? v : (v as AlarmTimelineEntry).time);
  });
  if (!hasData) return <span className="text-gray-400 text-sm">No alarm escalation recorded</span>;

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-4 gap-4 text-xs font-semibold text-gray-500 border-b border-gray-200 pb-1">
        <span>Stage</span>
        <span>Date</span>
        <span>Time</span>
        <span>Commander</span>
      </div>
      {keys.map((k) => {
        const entry = timeline[k];
        const rawTime = entry ? (typeof entry === 'string' ? entry : (entry as AlarmTimelineEntry).time ?? '') : '';
        const commander = entry && typeof entry !== 'string' ? (entry as AlarmTimelineEntry).commander ?? '' : '';
        if (!rawTime && !commander) return null;
        const split = splitAlarmDateTime(rawTime);
        return (
          <div key={k} className="grid grid-cols-4 gap-4 text-sm border-b border-gray-100 pb-1 last:border-0">
            <span className="font-medium text-gray-600">{FIELD_LABELS[k] ?? fieldLabel(k)}</span>
            <span className="text-gray-900">{split?.date ?? rawTime}</span>
            <span className="text-gray-900">{split?.time ?? ''}</span>
            <span className="text-gray-700 text-xs">{commander}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function RegionalIncidentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const rawId = params?.id as string | undefined;
  const incidentId = rawId != null ? parseInt(rawId, 10) : NaN;

  const { user, loading: authLoading } = useAuth();
  const role = (user as { role?: string })?.role ?? null;
  const encoderAssignedRegionId = (user as { assignedRegionId?: number | null })?.assignedRegionId ?? null;
  const canAccessRegional =
    role === 'REGIONAL_ENCODER' ||
    role === 'NATIONAL_VALIDATOR' ||
    role === 'ENCODER' ||
    role === 'VALIDATOR';

  const [detail, setDetail] = useState<RegionalIncidentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveNotification, setSaveNotification] = useState<string | null>(null);
  const [showWithdrawPopup, setShowWithdrawPopup] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [duplicateFound, setDuplicateFound] = useState<{ matchedIncidentId: number } | null>(null);
  const [pendingDuplicateFound, setPendingDuplicateFound] = useState<{ matchedIncidentId: number } | null>(null);
  const [staleAlert, setStaleAlert] = useState(false);
  const [showMissingFieldsModal, setShowMissingFieldsModal] = useState(false);
  const [missingFieldsList, setMissingFieldsList] = useState<string[]>([]);
  const [missingFieldKeys, setMissingFieldKeys] = useState<string[]>([]);

  const isEncoder = role === 'REGIONAL_ENCODER' || role === 'ENCODER';
  const isValidator = role === 'NATIONAL_VALIDATOR' || role === 'VALIDATOR';

  // Validator action state
  const [validatorAction, setValidatorAction] = useState<'accept' | 'pending' | 'reject' | null>(null);
  const [validatorNotes, setValidatorNotes] = useState('');
  const [validatorLoading, setValidatorLoading] = useState(false);
  const [validatorError, setValidatorError] = useState<string | null>(null);
  const [validatorDupMatchedId, setValidatorDupMatchedId] = useState<number | null>(null);
  const dupAutoShownRef = useRef(false);

  useEffect(() => {
    if (!authLoading && !canAccessRegional) {
      router.replace('/dashboard');
    }
  }, [authLoading, canAccessRegional, router]);

  const load = useCallback(async () => {
    if (Number.isNaN(incidentId)) {
      setError('Invalid incident id.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRegionalIncident(incidentId);
      setDetail(data);
      setIsEditing(false);
    } catch (e) {
      setDetail(null);
      setError(e instanceof Error ? e.message : 'Failed to load incident.');
    } finally {
      setLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    if (authLoading || !canAccessRegional) return;
    load();
  }, [authLoading, canAccessRegional, load]);

  // Poll every 30 s while the incident is PENDING — alert the encoder if the validator acts.
  useEffect(() => {
    if (!isEncoder || !detail || detail.verification_status !== 'PENDING') return;
    const trackedUpdatedAt = detail.updated_at;
    const interval = setInterval(async () => {
      try {
        const fresh = await fetchRegionalIncident(incidentId);
        if (fresh.verification_status !== 'PENDING' || fresh.updated_at !== trackedUpdatedAt) {
          setStaleAlert(true);
          clearInterval(interval);
        }
      } catch {
        // non-critical — silently skip failed polls
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [isEncoder, detail, incidentId]);

  // Auto-show the duplicate comparison once when a validator opens a duplicate-flagged incident.
  useEffect(() => {
    if (!isValidator || !detail || dupAutoShownRef.current) return;
    if (detail.is_duplicate && detail.duplicate_of) {
      dupAutoShownRef.current = true;
      setValidatorDupMatchedId(detail.duplicate_of);
    }
  }, [isValidator, detail]);

  // Memoized: only recompute when detail changes so IncidentForm's hydration runs once
  const incidentFormData = useMemo<Incident | undefined>(() => {
    if (!detail) return undefined;
    return {
      incident_id: detail.incident_id,
      region_id: detail.region_id,
      latitude: detail.latitude,
      longitude: detail.longitude,
      incident_nonsensitive_details: detail.nonsensitive as unknown as Incident['incident_nonsensitive_details'],
      incident_sensitive_details: detail.sensitive as unknown as Incident['incident_sensitive_details'],
    };
  }, [detail]);

  const handleSubmit = async (options: { ackDuplicate?: boolean; force?: boolean } = {}) => {
    setActionLoading(true);
    setActionError(null);
    try {
      await submitIncidentForReview(incidentId, options);
      setDuplicateFound(null);
      setPendingDuplicateFound(null);
      await load();
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) {
        const detail = e.detail as { code?: string; matched_incident_id?: number; matched_status?: string } | null;
        if (detail?.code === 'DUPLICATE_DETECTED' && detail.matched_incident_id) {
          if (detail.matched_status === 'PENDING') {
            setPendingDuplicateFound({ matchedIncidentId: detail.matched_incident_id });
          } else {
            setDuplicateFound({ matchedIncidentId: detail.matched_incident_id });
          }
          return;
        }
      }
      setActionError(e instanceof Error ? e.message : 'Failed to submit incident.');
    } finally {
      setActionLoading(false);
    }
  };

  const MISSING_FIELD_KEY_MAP: Record<string, string> = {
    'Type of Responder': 'responder_type',
    'Name of Fire Station/Team': 'fire_station_name',
    'Date and Time of Fire Notification Received': 'notification_dt_date',
    'Region': 'region',
    'Province / District': 'province_district',
    'City / Municipality': 'city_municipality',
    'Highest Alarm Level': 'alarm_level',
    'Classification of Involved': 'classification_of_involved',
    'Type of Involved': 'type_of_involved_general_category',
    'Extent of Damage': 'extent_of_damage',
    'Location Coordinates (set via map pin)': 'map_location',
    'Prepared by (Officer)': 'disposition_prepared_by',
    'Noted by (Officer)': 'disposition_noted_by',
  };

  const handleSubmitClick = () => {
    if (!detail) return;

    // Region constraint: encoder must only submit incidents in their assigned region
    if (isEncoder && encoderAssignedRegionId && detail.region_id !== encoderAssignedRegionId) {
      const assignedName = getShortRegionName(encoderAssignedRegionId) ?? `Region ${encoderAssignedRegionId}`;
      setActionError(`You can only submit incidents for your assigned region (${assignedName}). This incident belongs to a different region.`);
      return;
    }

    const ns = (detail.nonsensitive as Record<string, unknown>) ?? {};
    const sen = (detail.sensitive as Record<string, unknown>) ?? {};
    const isEmpty = (v: unknown) => !v || String(v).trim() === '' || String(v).trim().toUpperCase() === 'N/A';
    const missing: string[] = [];
    if (!ns.responder_type) missing.push('Type of Responder');
    if (!ns.fire_station_name) missing.push('Name of Fire Station/Team');
    if (!ns.notification_dt) missing.push('Date and Time of Fire Notification Received');
    if (!detail.region_id) missing.push('Region');
    if (isEmpty(ns.province_district)) missing.push('Province / District');
    if (isEmpty(ns.city_municipality)) missing.push('City / Municipality');
    if (!ns.alarm_level) missing.push('Highest Alarm Level');
    if (!ns.general_category) missing.push('Classification of Involved');
    if (ns.general_category && !detail.incident_type_code) missing.push('Type of Involved');
    if (!ns.extent_of_damage) missing.push('Extent of Damage');
    if (!detail.latitude || !detail.longitude) missing.push('Location Coordinates (set via map pin)');
    if (isEmpty(sen.prepared_by_officer) && isEmpty(sen.disposition_prepared_by)) missing.push('Prepared by (Officer)');
    if (isEmpty(sen.noted_by_officer) && isEmpty(sen.disposition_noted_by)) missing.push('Noted by (Officer)');
    if (missing.length > 0) {
      setMissingFieldsList(missing);
      setMissingFieldKeys(missing.map((f) => MISSING_FIELD_KEY_MAP[f]).filter(Boolean));
      setShowMissingFieldsModal(true);
      return;
    }
    void handleSubmit({});
  };

  const handleUnpend = async () => {
    setActionLoading(true);
    setActionError(null);
    try {
      await unpendIncident(incidentId);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to withdraw submission.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnpendAndEdit = async () => {
    setShowWithdrawPopup(false);
    setActionLoading(true);
    setActionError(null);
    try {
      await unpendIncident(incidentId);
      await load();
      setIsEditing(true);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to withdraw submission.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    setActionLoading(true);
    setActionError(null);
    try {
      await deleteIncident(incidentId);
      router.push('/dashboard/regional');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to delete incident.');
      setActionLoading(false);
    }
  };

  const handleEditClick = () => {
    if (!detail) return;
    const status = detail.verification_status;
    if (status === 'PENDING') {
      setShowWithdrawPopup(true);
    } else if (status === 'DRAFT' || status === 'REJECTED') {
      setIsEditing(true);
      setActionError(null);
    } else {
      setActionError(`Cannot edit an incident with status "${status}".`);
    }
  };

  const submitValidatorAction = async (opts?: { force?: boolean; action?: string; originalIncidentId?: number }) => {
    const action = opts?.action ?? validatorAction;
    if (!action) return;
    setValidatorLoading(true);
    setValidatorError(null);
    const url = opts?.force
      ? `/regional/incidents/${incidentId}/verification?force=true`
      : `/regional/incidents/${incidentId}/verification`;
    try {
      await apiFetch(url, {
        method: 'PATCH',
        body: JSON.stringify({
          action,
          notes: validatorNotes.trim() || null,
          ...(opts?.originalIncidentId ? { original_incident_id: opts.originalIncidentId } : {}),
        }),
      });
      await load();
      setValidatorAction(null);
      setValidatorNotes('');
      setValidatorDupMatchedId(null);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) {
        const d = e.detail as { code?: string; matched_incident_id?: number } | null;
        if (d?.code === 'DUPLICATE_DETECTED' && d.matched_incident_id) {
          setValidatorAction(null);
          setValidatorDupMatchedId(d.matched_incident_id);
          return;
        }
      }
      setValidatorError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setValidatorLoading(false);
    }
  };

  if (authLoading || !canAccessRegional) {
    return <div className="flex min-h-[40vh] items-center justify-center text-gray-500">Loading…</div>;
  }

  const ns = detail?.nonsensitive as Record<string, unknown> | undefined;
  const sens = detail?.sensitive as Record<string, unknown> | undefined;
  const pod = (sens?.personnel_on_duty ?? {}) as PersonnelOnDuty;
  const others = (sens?.other_personnel ?? []) as OtherPerson[];
  const alarmTimeline = (ns?.alarm_timeline ?? {}) as AlarmTimeline;

  const buildPendingReplacePayload = (): Record<string, unknown> => ({
    notification_dt: ns?.notification_dt ?? null,
    alarm_level: ns?.alarm_level ?? null,
    general_category: ns?.general_category ?? ns?.classification_of_involved ?? null,
    sub_category: ns?.sub_category ?? ns?.type_of_involved_general_category ?? null,
    specific_type: ns?.specific_type ?? null,
    occupancy_type: ns?.occupancy_type ?? null,
    city_id: ns?.city_id ?? null,
    barangay_id: ns?.barangay_id ?? null,
    distance_from_station_km: ns?.distance_from_station_km ?? ns?.distance_to_fire_scene_km ?? null,
    estimated_damage_php: ns?.estimated_damage_php ?? null,
    civilian_injured: ns?.civilian_injured ?? null,
    civilian_deaths: ns?.civilian_deaths ?? null,
    firefighter_injured: ns?.firefighter_injured ?? null,
    firefighter_deaths: ns?.firefighter_deaths ?? null,
    families_affected: ns?.families_affected ?? null,
    structures_affected: ns?.structures_affected ?? null,
    households_affected: ns?.households_affected ?? null,
    individuals_affected: ns?.individuals_affected ?? null,
    responder_type: ns?.responder_type ?? null,
    fire_origin: ns?.fire_origin ?? ns?.area_of_origin ?? null,
    extent_of_damage: ns?.extent_of_damage ?? null,
    stage_of_fire: ns?.stage_of_fire ?? ns?.stage_of_fire_upon_arrival ?? null,
    fire_station_name: ns?.fire_station_name ?? null,
    total_response_time_minutes: ns?.total_response_time_minutes ?? null,
    recommendations: ns?.recommendations ?? null,
    province_district: ns?.province_district ?? null,
    city_municipality: ns?.city_municipality ?? null,
    station_code: ns?.station_code ?? null,
    street_address: sens?.street_address ?? ns?.incident_address ?? null,
    landmark: sens?.landmark ?? ns?.nearest_landmark ?? null,
    caller_name: sens?.caller_name ?? null,
    caller_number: sens?.caller_number ?? null,
    narrative_report: sens?.narrative_report ?? null,
    owner_name: sens?.owner_name ?? null,
    occupant_name: sens?.occupant_name ?? null,
    establishment_name: sens?.establishment_name ?? null,
    receiver_name: sens?.receiver_name ?? ns?.receiver_name ?? null,
    prepared_by_officer: sens?.prepared_by_officer ?? null,
    noted_by_officer: sens?.noted_by_officer ?? null,
    remarks: sens?.remarks ?? null,
    latitude: detail?.latitude ?? null,
    longitude: detail?.longitude ?? null,
  });

  // Defensive: problems_encountered may come back as a JSON array or (rarely) a string
  const rawProblems = ns?.problems_encountered;
  const problems: string[] = Array.isArray(rawProblems)
    ? (rawProblems as unknown[]).map(String)
    : typeof rawProblems === 'string' && rawProblems.trim()
    ? (() => { try { return JSON.parse(rawProblems); } catch { return []; } })()
    : [];

  const narrative = String(sens?.narrative_report ?? '');
  const resources = ns?.resources_deployed as Record<string, unknown> | undefined;

  // Response-timing fields stored in alarm_timeline._response or as direct ns fields
  const responseFields = ((alarmTimeline as Record<string, unknown>)._response as Record<string, string> | undefined) ?? {};
  const engineDispatched = String(ns?.engine_dispatched ?? responseFields.engine_dispatched ?? '').trim() || null;
  const timeEngineDispatched = String(ns?.time_engine_dispatched ?? responseFields.time_engine_dispatched ?? '').trim() || null;
  const timeArrivedAtScene = String(ns?.time_arrived_at_scene ?? responseFields.time_arrived_at_scene ?? '').trim() || null;
  const timeReturnedToBase = String(ns?.time_returned_to_base ?? responseFields.time_returned_to_base ?? '').trim() || null;

  const canSubmitOrDelete = isEncoder && detail &&
    (detail.verification_status === 'DRAFT' ||
     detail.verification_status === 'PENDING' ||
     detail.verification_status === 'REJECTED');

  const STATUS_COLORS: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    PENDING: 'bg-yellow-100 text-yellow-800',
    PENDING_VALIDATION: 'bg-blue-100 text-blue-800',
    VERIFIED: 'bg-green-100 text-green-800',
    REJECTED: 'bg-red-100 text-red-800',
    REPLACED: 'bg-purple-100 text-purple-800',
  };

  return (
    <div className="space-y-6">
      {/* Duplicate detected — modal with side-by-side comparison */}
      {duplicateFound && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-amber-800">Possible Duplicate Detected</h2>
            <p className="text-sm text-gray-700">
              A verified incident (#{duplicateFound.matchedIncidentId}) already exists with the same
              region, type, and fire date. Review the comparison below before deciding.
            </p>
            <UpdateRequestDiffPanel
              updateIncidentId={incidentId}
              originalIncidentId={duplicateFound.matchedIncidentId}
            />
            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => { setDuplicateFound(null); void handleSubmit({ force: true }); }}
                disabled={actionLoading}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-800 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? 'Submitting…' : 'Submit Anyway'}
              </button>
              <button
                onClick={() => { setDuplicateFound(null); setIsEditing(true); }}
                className="px-4 py-2 text-sm font-semibold text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Continue Editing
              </button>
              <button
                onClick={() => setDuplicateFound(null)}
                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pending duplicate detected — with side-by-side comparison */}
      {pendingDuplicateFound && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-blue-800">Duplicate Pending Incident Found</h2>
            <p className="text-sm text-gray-700">
              A similar incident (#{pendingDuplicateFound.matchedIncidentId}) is already pending review.
              Review the comparison below before deciding.
            </p>
            <UpdateRequestDiffPanel
              updateIncidentId={incidentId}
              originalIncidentId={pendingDuplicateFound.matchedIncidentId}
            />
            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => { setPendingDuplicateFound(null); void handleSubmit({ force: true }); }}
                disabled={actionLoading}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-800 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? 'Submitting…' : 'Submit Anyway'}
              </button>
              <button
                onClick={() => { setPendingDuplicateFound(null); setIsEditing(true); }}
                className="px-4 py-2 text-sm font-semibold text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Continue Editing
              </button>
              <button
                onClick={() => setPendingDuplicateFound(null)}
                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Validator duplicate resolution modal — shown on Accept 409 or auto-show on view */}
      {validatorDupMatchedId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-amber-800">Duplicate Incident Detected</h2>
            <p className="text-sm text-gray-700">
              Incident #{incidentId} matches an existing record (#{validatorDupMatchedId}).
              Review the side-by-side comparison before deciding.
            </p>
            <UpdateRequestDiffPanel
              updateIncidentId={incidentId}
              originalIncidentId={validatorDupMatchedId}
            />
            {validatorError && (
              <p className="text-sm text-red-600">{validatorError}</p>
            )}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
              <button
                onClick={() => setValidatorDupMatchedId(null)}
                disabled={validatorLoading}
                className="px-4 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setValidatorDupMatchedId(null);
                  setValidatorAction('reject');
                }}
                disabled={validatorLoading}
                className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                Reject
              </button>
              <button
                onClick={() => {
                  const mid = validatorDupMatchedId;
                  setValidatorDupMatchedId(null);
                  void submitValidatorAction({ force: true, action: 'accept_replace', originalIncidentId: mid });
                }}
                disabled={validatorLoading}
                className="px-4 py-2 text-sm rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {validatorLoading ? 'Saving…' : 'Replace Existing'}
              </button>
              <button
                onClick={() => {
                  setValidatorDupMatchedId(null);
                  void submitValidatorAction({ force: true, action: 'accept' });
                }}
                disabled={validatorLoading}
                className="px-4 py-2 text-sm rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {validatorLoading ? 'Saving…' : 'Verify as New'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Withdraw-to-edit confirmation popup */}
      {showWithdrawPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Withdraw to Edit?</h2>
            <p className="text-sm text-gray-600">
              This incident is currently <strong>Pending Review</strong>. You can only edit incidents in Draft status.
              Would you like to withdraw it from review so you can make changes? It will be set back to Draft.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowWithdrawPopup(false)}
                className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUnpendAndEdit}
                disabled={actionLoading}
                className="px-4 py-2 text-sm font-semibold text-white bg-yellow-600 rounded-lg hover:bg-yellow-700 disabled:opacity-50"
              >
                Withdraw &amp; Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation popup */}
      {showDeleteConfirm && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-red-900">Delete Incident?</h2>
            <p className="text-sm text-gray-600">
              This will permanently remove incident <strong>#{incidentId}</strong> ({detail.verification_status}).
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-700 rounded-lg hover:bg-red-800 disabled:opacity-50"
              >
                Delete Incident
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Missing required fields modal — shown when encoder tries to submit an incomplete draft */}
      {showMissingFieldsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-red-900">Incomplete Incident Report</h2>
            <p className="text-sm text-gray-600">
              The following required fields are missing. Please fill them in before submitting.
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-800">
              {missingFieldsList.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => { setShowMissingFieldsModal(false); setMissingFieldKeys([]); }}
                className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Dismiss
              </button>
              <button
                onClick={() => {
                  setShowMissingFieldsModal(false);
                  setIsEditing(true);
                }}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-800 rounded-lg hover:bg-red-700"
              >
                Continue Editing
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href={isValidator ? '/dashboard/validator' : '/dashboard/regional'}
          className="inline-flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {isValidator ? 'Back to Validator Dashboard' : 'Back to Regional Dashboard'}
        </Link>
        {detail && isEncoder && (
          <div className="flex items-center gap-2 flex-wrap">
            {!isEditing && (
              <>
                {/* Delete button — always visible for DRAFT/PENDING/REJECTED */}
                {canSubmitOrDelete && (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={actionLoading}
                    className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                )}

                {/* Withdraw button — standalone action for PENDING, no edit required */}
                {detail.verification_status === 'PENDING' && (
                  <button
                    onClick={handleUnpend}
                    disabled={actionLoading}
                    className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium border border-yellow-400 text-yellow-800 bg-yellow-50 hover:bg-yellow-100 disabled:opacity-50"
                  >
                    Withdraw
                  </button>
                )}

                {/* Edit button — DRAFT/REJECTED: opens edit directly; PENDING: shows withdraw-first popup */}
                <button
                  onClick={handleEditClick}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>

                {/* Submit / Resubmit — only for DRAFT or REJECTED */}
                {(detail.verification_status === 'DRAFT' || detail.verification_status === 'REJECTED') && (
                  <button
                    onClick={handleSubmitClick}
                    disabled={actionLoading}
                    className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium bg-red-800 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {detail.verification_status === 'REJECTED' ? 'Resubmit for Review' : 'Submit for Review'}
                  </button>
                )}
              </>
            )}
            {isEditing && (
              <button
                onClick={() => { setIsEditing(false); setActionError(null); setMissingFieldKeys([]); }}
                className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium border border-gray-300 bg-white hover:bg-gray-50 text-gray-700"
              >
                ← Back to View
              </button>
            )}
          </div>
        )}
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {actionError}
        </div>
      )}

      {saveNotification && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800" role="status">
          ✅ {saveNotification}
        </div>
      )}

      {detail && detail.verification_status === 'REJECTED' && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
          <p className="font-semibold">This incident was rejected by a validator.</p>
          {detail.rejection_reason && (
            <p className="mt-1">
              <span className="font-medium">Reason: </span>{detail.rejection_reason}
            </p>
          )}
          {detail.rejection_at && (
            <p className="mt-1 text-xs text-red-600">
              Rejected on {new Date(detail.rejection_at).toLocaleString()}
            </p>
          )}
          {isEncoder && (
            <p className="mt-2 text-xs text-red-700">You can edit the incident and resubmit for review.</p>
          )}
        </div>
      )}

      {detail && isEditing && incidentFormData && (
        <IncidentForm
          initialData={incidentFormData}
          existingIncidentId={detail.incident_id}
          initialErrors={missingFieldKeys.length > 0 ? missingFieldKeys : undefined}
          onSaved={() => {
            setSaveNotification('Incident saved successfully!');
            setTimeout(() => setSaveNotification(null), 5000);
            setIsEditing(false);
            setMissingFieldKeys([]);
            void load();
          }}
        />
      )}


      {loading && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-8 text-center text-gray-600">
          Loading incident…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      {!loading && !error && detail && !isEditing && (
        <>
          {/* Stale data alert — shown when a validator has acted while encoder is viewing */}
          {staleAlert && (
            <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 flex items-center justify-between gap-3" role="alert">
              <span className="text-sm text-blue-900 font-medium">
                This incident was updated by a validator. Refresh to see the latest status.
              </span>
              <button
                onClick={() => { setStaleAlert(false); void load(); }}
                className="shrink-0 rounded px-3 py-1.5 text-sm font-semibold bg-blue-700 text-white hover:bg-blue-800"
              >
                Refresh
              </button>
            </div>
          )}

          {/* Header */}
          <div className="flex flex-wrap items-start gap-3">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
                  {detail.verification_status === 'VERIFIED' && detail.reference_number
                    ? detail.reference_number
                    : `Incident #${detail.incident_id}`}
                </h1>
                {detail.is_wildland && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-sm font-semibold text-orange-800 border border-orange-200">
                    🌿 Wildland Fire AFOR
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {detail.verification_status !== 'VERIFIED' || !detail.reference_number
                  ? `Incident #${detail.incident_id} · `
                  : ''}
                {getShortRegionName(detail.region_id)}
                {detail.created_at && <>{' · '}Created {new Date(detail.created_at).toLocaleString()}</>}
              </p>
            </div>
            <span className={`mt-1 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${STATUS_COLORS[detail.verification_status] ?? 'bg-gray-100 text-gray-700'}`}>
              {detail.verification_status.replace('_', ' ')}
            </span>
          </div>

          {/* A. Response Details */}
          <Section title="A. Response Details" sectionId="sec-response">
            <FieldRow label={FIELD_LABELS.notification_dt} value={fmt24h(ns?.notification_dt as string | null)} />
            <FieldRow label={FIELD_LABELS.fire_station_name} value={ns?.fire_station_name} />
            <FieldRow label={FIELD_LABELS.responder_type} value={ns?.responder_type} />
            <FieldRow label={FIELD_LABELS.alarm_level} value={ns?.alarm_level} />
            {(() => {
              type EngineRow = { name?: string; time_dispatched?: string; time_arrived?: string };
              const engines = ((alarmTimeline as Record<string, unknown>)._engines as EngineRow[] | undefined) ?? [];
              const hasEngines = engines.some((e) => e.name || e.time_dispatched || e.time_arrived);
              if (hasEngines) {
                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-gray-100 pb-3 text-sm">
                    <div className="font-medium text-gray-600">Engine / Unit Dispatched</div>
                    <div className="md:col-span-2">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-gray-500 border-b border-gray-200">
                            <th className="text-left pb-1 pr-4 font-medium">Engine / Unit</th>
                            <th className="text-left pb-1 pr-4 font-medium">Time Dispatched</th>
                            <th className="text-left pb-1 font-medium">Time Arrived at Scene</th>
                          </tr>
                        </thead>
                        <tbody>
                          {engines.map((eng, i) =>
                            eng.name || eng.time_dispatched || eng.time_arrived ? (
                              <tr key={i} className="border-b border-gray-50 last:border-0">
                                <td className="py-1 pr-4">{displayValue(eng.name)}</td>
                                <td className="py-1 pr-4">{displayValue(eng.time_dispatched)}</td>
                                <td className="py-1">{displayValue(eng.time_arrived)}</td>
                              </tr>
                            ) : null
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              }
              return (
                <>
                  <FieldRow label="Engine / Unit Dispatched" value={engineDispatched} />
                  <FieldRow label="Time Engine Dispatched" value={timeEngineDispatched} />
                  <FieldRow label="Time Arrived at Fire Scene" value={timeArrivedAtScene} />
                </>
              );
            })()}
            <FieldRow label="Time Returned to Base" value={timeReturnedToBase} />
            <FieldRow label={FIELD_LABELS.distance_from_station_km} value={ns?.distance_from_station_km ?? ns?.distance_to_fire_scene_km} />
            <FieldRow label={FIELD_LABELS.total_response_time_minutes} value={ns?.total_response_time_minutes} />
            <FieldRow label={FIELD_LABELS.total_gas_consumed_liters} value={ns?.total_gas_consumed_liters} />
            <FieldRow label="Location" value={[ns?.city_municipality, ns?.province_district, ns?.region].filter(Boolean).join(', ') || null} />
            <FieldRow label={FIELD_LABELS.street_address} value={sens?.street_address ?? ns?.incident_address} />
            <FieldRow label={FIELD_LABELS.landmark} value={sens?.landmark ?? ns?.nearest_landmark} />
            <FieldRow label={FIELD_LABELS.caller_name} value={sens?.caller_name} />
            <FieldRow label={FIELD_LABELS.caller_number} value={sens?.caller_number} />
            <FieldRow label={FIELD_LABELS.receiver_name} value={sens?.receiver_name ?? ns?.receiver_name} />
          </Section>

          {/* B. Nature & Classification */}
          <Section title="B. Nature and Classification of Involved" sectionId="sec-class">
            <FieldRow label={FIELD_LABELS.general_category} value={formatClassification(String(ns?.general_category ?? ns?.classification_of_involved ?? ''))} />
            <FieldRow label={FIELD_LABELS.sub_category} value={ns?.sub_category ?? ns?.type_of_involved_general_category} />
            <FieldRow label="Name of Owner/Establishment" value={sens?.owner_name ?? ns?.owner_name} />
            <FieldRow label="General Description" value={ns?.general_description_of_involved} />
            <FieldRow label={FIELD_LABELS.fire_origin} value={ns?.fire_origin ?? ns?.area_of_origin} />
            <FieldRow label="Stage of Fire Upon Arrival" value={ns?.stage_of_fire_upon_arrival ?? ns?.stage_of_fire} />
            <FieldRow label={FIELD_LABELS.extent_of_damage} value={ns?.extent_of_damage} />
            {ns?.extent_description ? <FieldRow label="Description" value={ns.extent_description} /> : null}
            {ns?.extent_total_floor_area_sqm ? <FieldRow label={FIELD_LABELS.extent_total_floor_area_sqm} value={ns.extent_total_floor_area_sqm} /> : null}
            {ns?.extent_total_land_area_hectares ? <FieldRow label={FIELD_LABELS.extent_total_land_area_hectares} value={ns.extent_total_land_area_hectares} /> : null}
            {ns?.extent_objects_count ? <FieldRow label="No. of Objects/Properties Affected" value={ns.extent_objects_count} /> : null}
            {detail.is_wildland && (
              <>
                <FieldRow label="Wildland Fire Type" value={detail.wildland_fire_type} />
                {detail.wildland_area_display && (
                  <FieldRow label="Total Area Burned" value={detail.wildland_area_display} />
                )}
                {detail.wildland_area_hectares != null && (
                  <FieldRow label="Area Burned (Hectares)" value={detail.wildland_area_hectares} />
                )}
              </>
            )}
          </Section>

          {/* C. Affected */}
          <Section title="C. Affected Counts" sectionId="sec-affected">
            <FieldRow label={FIELD_LABELS.structures_affected} value={ns?.structures_affected} />
            <FieldRow label={FIELD_LABELS.households_affected} value={ns?.households_affected} />
            <FieldRow label={FIELD_LABELS.families_affected} value={ns?.families_affected} />
            <FieldRow label={FIELD_LABELS.individuals_affected} value={ns?.individuals_affected} />
            <FieldRow label={FIELD_LABELS.vehicles_affected} value={ns?.vehicles_affected} />
          </Section>

          {/* C. Assets and Resources Deployed */}
          <Section title="C. Assets and Resources Deployed" sectionId="sec-resources">
            {(() => {
              const trucks = resources?.trucks as Record<string, unknown> | undefined;
              const medical = resources?.medical as Record<string, unknown> | undefined;
              const special = resources?.special_assets as Record<string, unknown> | undefined;
              const tools = resources?.tools as Record<string, unknown> | undefined;
              const TRUCK_LABELS: Record<string, string> = { bfp: 'BFP Fire Trucks', lgu: 'BFP-Manned (LGU)', non_bfp: 'Non-BFP Fire Trucks', volunteer: 'Non-BFP Fire Trucks' };
              const MEDICAL_LABELS: Record<string, string> = { bfp: 'BFP Ambulance', non_bfp: 'Non-BFP Ambulance' };
              const SPECIAL_LABELS: Record<string, string> = { rescue_bfp: 'BFP Rescue Trucks', rescue_non_bfp: 'Non-BFP Rescue Trucks', others: 'Other Vehicles / Assets' };
              const TOOL_LABELS: Record<string, string> = { scba: 'SCBA', rope: 'Rope', ladder: 'Ladder', hoseline: 'Hoseline', hydraulic: 'Hydraulic Tools', others: 'Other Tools' };
              const rows: { label: string; value: unknown }[] = [];
              if (trucks) Object.entries(trucks).forEach(([k, v]) => rows.push({ label: TRUCK_LABELS[k] ?? k, value: v }));
              if (medical) Object.entries(medical).forEach(([k, v]) => rows.push({ label: MEDICAL_LABELS[k] ?? k, value: v }));
              if (special) Object.entries(special).forEach(([k, v]) => rows.push({ label: SPECIAL_LABELS[k] ?? k, value: v }));
              const hasAny = rows.some((r) => r.value !== 0 && r.value !== null && r.value !== undefined && r.value !== 'N/A');
              return (
                <>
                  {rows.length > 0 && (
                    <>
                      <p className="text-xs font-bold uppercase text-gray-500 mb-1">Vehicles</p>
                      {rows.map(({ label, value }) => (
                        <div key={label} className="grid grid-cols-3 gap-4 text-sm border-b border-gray-100 pb-1 pl-2">
                          <span className="font-medium text-gray-600">{label}</span>
                          <span className="col-span-2 text-gray-900">{displayValue(value)}</span>
                        </div>
                      ))}
                    </>
                  )}
                  {tools && (
                    <>
                      <p className="text-xs font-bold uppercase text-gray-500 mt-3 mb-1">Tools &amp; Equipment</p>
                      {Object.entries(tools).map(([k, v]) => (
                        <div key={k} className="grid grid-cols-3 gap-4 text-sm border-b border-gray-100 pb-1 pl-2">
                          <span className="font-medium text-gray-600">{TOOL_LABELS[k] ?? k}</span>
                          <span className="col-span-2 text-gray-900">{displayValue(v)}</span>
                        </div>
                      ))}
                    </>
                  )}
                  {resources?.hydrant_distance && (
                    <div className="grid grid-cols-3 gap-4 text-sm border-b border-gray-100 pb-1 pl-2 mt-1">
                      <span className="font-medium text-gray-600">Hydrant Location / Distance</span>
                      <span className="col-span-2 text-gray-900">{displayValue(resources.hydrant_distance)}</span>
                    </div>
                  )}
                  {!hasAny && !tools && !resources?.hydrant_distance && (
                    <span className="text-gray-400 text-sm">No resources recorded</span>
                  )}
                </>
              );
            })()}
          </Section>

          {/* D. Alarm Timeline */}
          <Section title="D. Fire Alarm Level / Timeline" sectionId="sec-timeline">
            <AlarmTimelineSection timeline={alarmTimeline} />
          </Section>

          {/* E. Casualties */}
          {sens?.casualty_details && (
            <Section title="E. Profile of Casualties" sectionId="sec-casualties">
              {(() => {
                const cd = sens.casualty_details as Record<string, Record<string, Record<string, number>>>;
                const rows = [
                  { label: 'Injured Civilian', path: ['injured', 'civilian'] },
                  { label: 'Injured BFP Firefighter', path: ['injured', 'firefighter'] },
                  { label: 'Injured Fire Auxiliary', path: ['injured', 'auxiliary'] },
                  { label: 'Civilian Fatality/ies', path: ['fatalities', 'civilian'] },
                  { label: 'BFP Firefighter Fatality/ies', path: ['fatalities', 'firefighter'] },
                  { label: 'Fire Auxiliary Fatality/ies', path: ['fatalities', 'auxiliary'] },
                ];
                return (
                  <table className="min-w-full text-xs border border-gray-200">
                    <thead className="bg-gray-50"><tr>
                      <th className="border px-3 py-2 text-left">Category</th>
                      <th className="border px-3 py-2 text-center">Male</th>
                      <th className="border px-3 py-2 text-center">Female</th>
                    </tr></thead>
                    <tbody>
                      {rows.map(({ label, path }) => {
                        const entry = cd?.[path[0]]?.[path[1]] ?? {};
                        return (
                          <tr key={label} className="border-t border-gray-100">
                            <td className="border px-3 py-1 font-semibold text-gray-700">{label}</td>
                            <td className="border px-3 py-1 text-center">{entry.m ?? 0}</td>
                            <td className="border px-3 py-1 text-center">{entry.f ?? 0}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
            </Section>
          )}

          {/* F. Personnel on Duty */}
          <Section title="F. Personnel on Duty" sectionId="sec-pod">
            <PersonnelSection pod={pod} others={others} />
          </Section>

          {/* G. ICP */}
          <Section title="G. Incident Command Post" sectionId="sec-icp">
            <FieldRow label={FIELD_LABELS.is_icp_present} value={sens?.is_icp_present} />
            <FieldRow label={FIELD_LABELS.icp_location} value={sens?.icp_location} />
          </Section>

          {/* H. Fire Scene Location (map) — placed here per AFOR sketch section position */}
          {detail.latitude != null && detail.longitude != null && (
            <Section title="H. Fire Scene Location" sectionId="sec-geo">
              <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                <div>
                  <span className="font-medium text-gray-600">Latitude</span>
                  <div className="font-mono text-gray-900">{detail.latitude.toFixed(6)}</div>
                </div>
                <div>
                  <span className="font-medium text-gray-600">Longitude</span>
                  <div className="font-mono text-gray-900">{detail.longitude.toFixed(6)}</div>
                </div>
              </div>
              <IncidentLocationMap latitude={detail.latitude} longitude={detail.longitude} />
            </Section>
          )}

          {/* H-alt: sketch attachment if present */}
          {Array.isArray((detail as unknown as Record<string, unknown>).attachments) &&
            ((detail as unknown as Record<string, unknown>).attachments as Array<{ file_name: string; url: string }>)
              .filter((a) => a.file_name === 'afor_sketch.png' && !!a.url)
              .map((a) => (
                <Section key={a.url} title="H. Fire Scene Sketch" sectionId="sec-sketch">
                  {/* Dynamic uploaded sketch URL; next/image cannot optimize this reliably. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt="Fire Scene Sketch" className="max-w-full rounded border border-gray-200" />
                </Section>
              ))}

          {/* I. Narrative Report */}
          <Section title="I. Narrative Report" sectionId="sec-narrative">
            <NarrativeReport text={narrative} />
          </Section>

          {/* J. Problems Encountered */}
          <Section title="J. Problems Encountered" sectionId="sec-problems">
            <ProblemsGrid selected={problems} />
            {(() => {
              const normalizedSet = new Set(ALL_PROBLEM_OPTIONS.map(normalizeProblemLabel));
              const customEntries = problems.filter((p) => !normalizedSet.has(normalizeProblemLabel(String(p))));
              if (!customEntries.length) return null;
              return (
                <div className="mt-2 border-t border-gray-100 pt-2">
                  <p className="text-xs font-bold text-gray-500 uppercase mb-1">Others (specify)</p>
                  <p className="text-sm text-gray-800">{customEntries.join(', ')}</p>
                </div>
              );
            })()}
          </Section>

          {/* K. Recommendations */}
          <Section title="K. Recommendations" sectionId="sec-rec">
            <FieldRow label={FIELD_LABELS.recommendations} value={ns?.recommendations} />
          </Section>

          {/* L. Disposition & Signatories */}
          <Section title="L. Disposition &amp; Signatories" sectionId="sec-disp">
            <FieldRow label={FIELD_LABELS.disposition} value={sens?.disposition} />
            <FieldRow label={FIELD_LABELS.prepared_by_officer} value={sens?.prepared_by_officer ?? sens?.disposition_prepared_by} />
            <FieldRow label={FIELD_LABELS.noted_by_officer} value={sens?.noted_by_officer ?? sens?.disposition_noted_by} />
          </Section>

          {/* Validator actions — shown only to validators at the bottom of the view */}
          {!isValidator && (
            <div className="flex justify-start pt-2">
              <Link
                href="/dashboard/regional"
                className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 border border-gray-300 rounded px-4 py-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Regional Dashboard
              </Link>
            </div>
          )}

          {isValidator && (
            <section className="card border-2 border-blue-200" aria-labelledby="sec-validator-actions">
              <div className="card-header px-4 py-3 border-b bg-blue-50">
                <h2 id="sec-validator-actions" className="font-bold text-base text-blue-900">Validator Actions</h2>
              </div>
              <div className="card-body p-4 space-y-4">
                {validatorError && (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{validatorError}</div>
                )}
                {validatorAction === 'reject' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Reason for rejection <span className="text-red-600">*</span>
                    </label>
                    <textarea
                      className="w-full border rounded px-3 py-2 text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Required for rejection…"
                      value={validatorNotes}
                      onChange={(e) => setValidatorNotes(e.target.value)}
                      disabled={validatorLoading}
                    />
                  </div>
                )}
                <div className="flex flex-wrap gap-2 items-center">
                  {validatorAction !== 'reject' && (
                    <>
                      <button
                        onClick={() => void submitValidatorAction({ action: 'accept' })}
                        disabled={validatorLoading || detail?.verification_status === 'VERIFIED' || detail?.verification_status === 'REJECTED'}
                        className="px-4 py-2 text-sm rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {validatorLoading && validatorAction === null ? 'Checking…' : 'Accept'}
                      </button>
                      <button
                        onClick={() => setValidatorAction('reject')}
                        disabled={validatorLoading || detail?.verification_status === 'REJECTED' || detail?.verification_status === 'VERIFIED'}
                        className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  <Link
                    href="/dashboard/validator"
                    className="ml-auto px-4 py-2 text-sm rounded bg-yellow-400 text-gray-900 hover:bg-yellow-500 font-medium"
                  >
                    Back to Dashboard
                  </Link>
                </div>
                {validatorAction === 'reject' && (
                  <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                    <span className="text-sm text-gray-600">
                      Confirm: <strong>Reject</strong> this incident?
                    </span>
                    <button
                      onClick={() => void submitValidatorAction()}
                      disabled={validatorLoading || !validatorNotes.trim()}
                      className="px-4 py-1.5 text-sm rounded text-white disabled:opacity-50 bg-red-600 hover:bg-red-700"
                    >
                      {validatorLoading ? 'Saving…' : 'Confirm Reject'}
                    </button>
                    <button
                      onClick={() => { setValidatorAction(null); setValidatorError(null); }}
                      disabled={validatorLoading}
                      className="px-4 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
