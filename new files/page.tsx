'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { fetchRegionalIncident, type RegionalIncidentDetailResponse } from '@/lib/api';
import dynamic from 'next/dynamic';

// Read-only map for displaying incident location
const IncidentLocationMap = dynamic(
  () => import('@/components/MapPickerInner').then((mod) => {
    const ReadOnlyMap = (props: { latitude: number; longitude: number }) => (
      <div style={{ height: '300px', width: '100%' }}>
        <mod.MapPickerInner
          value={{ lat: props.latitude, lng: props.longitude }}
          center={[props.latitude, props.longitude]}
        />
      </div>
    );
    ReadOnlyMap.displayName = 'ReadOnlyIncidentMap';
    return ReadOnlyMap;
  }),
  { ssr: false, loading: () => <div className="h-[300px] bg-gray-100 animate-pulse rounded" /> },
);
import {
  FIELD_LABELS,
  fieldLabel,
  displayValue,
  ALL_PROBLEM_OPTIONS,
  normalizeProblemLabel,
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
        const checked = selectedSet.has(label);
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
  const simpleKeys = ['engine_commander', 'shift_in_charge', 'nozzleman', 'lineman', 'engine_crew', 'driver', 'pump_operator'];
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
  const keys = Object.keys(timeline);
  const hasData = keys.some((k) => {
    const v = timeline[k];
    return v && (typeof v === 'string' ? v : (v as AlarmTimelineEntry).time);
  });
  if (!hasData) return <span className="text-gray-400 text-sm">No alarm escalation recorded</span>;

  return (
    <div className="space-y-1">
      {keys.map((k) => {
        const entry = timeline[k];
        const timeStr = entry ? (typeof entry === 'string' ? entry : (entry as AlarmTimelineEntry).time ?? '') : '';
        const commander = entry && typeof entry !== 'string' ? (entry as AlarmTimelineEntry).commander ?? '' : '';
        if (!timeStr) return null;
        return (
          <div key={k} className="grid grid-cols-3 gap-4 text-sm border-b border-gray-100 pb-1 last:border-0">
            <span className="font-medium text-gray-600">{FIELD_LABELS[k] ?? fieldLabel(k)}</span>
            <span className="col-span-2 text-gray-900">
              {timeStr}
              {commander ? <span className="ml-2 text-gray-500 text-xs">— {commander}</span> : null}
            </span>
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
  const assignedRegionId = (user as { assignedRegionId?: number | null })?.assignedRegionId ?? null;
  const canAccessRegional =
    role === 'REGIONAL_ENCODER' ||
    role === 'NATIONAL_VALIDATOR' ||
    role === 'ENCODER' ||
    role === 'VALIDATOR';

  const [detail, setDetail] = useState<RegionalIncidentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && (!canAccessRegional || !assignedRegionId)) {
      router.replace('/dashboard');
    }
  }, [authLoading, canAccessRegional, assignedRegionId, router]);

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
    } catch (e) {
      setDetail(null);
      setError(e instanceof Error ? e.message : 'Failed to load incident.');
    } finally {
      setLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    if (authLoading || !canAccessRegional || !assignedRegionId) return;
    load();
  }, [authLoading, canAccessRegional, assignedRegionId, load]);

  if (authLoading || !canAccessRegional || !assignedRegionId) {
    return <div className="flex min-h-[40vh] items-center justify-center text-gray-500">Loading…</div>;
  }

  const ns = detail?.nonsensitive as Record<string, unknown> | undefined;
  const sens = detail?.sensitive as Record<string, unknown> | undefined;
  const ru = detail?.responding_unit as Record<string, unknown> | undefined;
  const pod = (sens?.personnel_on_duty ?? {}) as PersonnelOnDuty;
  const others = (sens?.other_personnel ?? []) as OtherPerson[];
  const alarmTimeline = (ns?.alarm_timeline ?? {}) as AlarmTimeline;
  const problems = (ns?.problems_encountered ?? []) as string[];
  const narrative = String(sens?.narrative_report ?? '');
  const resources = ns?.resources_deployed as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/dashboard/regional" className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to regional dashboard
        </Link>
      </div>

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

      {!loading && !error && detail && (
        <>
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Incident #{detail.incident_id}
            </h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <span className="font-medium">{displayValue(detail.verification_status)}</span>
              {' · '}Region {detail.region_id}
              {detail.created_at && <>{' · '}Created {new Date(detail.created_at).toLocaleString()}</>}
            </p>
          </div>

          {/* Geolocation — always render; show placeholder when coords not recorded */}
          <Section title="Geolocation" sectionId="sec-geo">
            {detail.latitude != null && detail.longitude != null && detail.latitude !== 0 && detail.longitude !== 0 ? (
              <>
                <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                  <div>
                    <span className="font-medium text-gray-600">Latitude</span>
                    <div className="text-gray-900">{detail.latitude.toFixed(6)}</div>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Longitude</span>
                    <div className="text-gray-900">{detail.longitude.toFixed(6)}</div>
                  </div>
                </div>
                <IncidentLocationMap latitude={detail.latitude} longitude={detail.longitude} />
              </>
            ) : (
              <p className="text-sm text-gray-400 italic">No coordinates recorded for this incident.</p>
            )}
          </Section>

          {/* A. Response Details */}
          <Section title="A. Response Details" sectionId="sec-response">
            <FieldRow label={FIELD_LABELS.notification_dt} value={ns?.notification_dt} />
            <FieldRow label={FIELD_LABELS.fire_station_name} value={ns?.fire_station_name} />
            <FieldRow label={FIELD_LABELS.responder_type} value={ns?.responder_type} />
            <FieldRow label={FIELD_LABELS.alarm_level} value={ns?.alarm_level} />
            {/* engine dispatched — stored in both ns and responding_unit */}
            <FieldRow label={FIELD_LABELS.engine_dispatched} value={ns?.engine_dispatched ?? ru?.engine_number} />
            <FieldRow label={FIELD_LABELS.time_engine_dispatched} value={ns?.time_engine_dispatched ?? ru?.dispatch_dt} />
            <FieldRow label={FIELD_LABELS.time_arrived_at_scene} value={ns?.time_arrived_at_scene ?? ru?.arrival_dt} />
            <FieldRow label={FIELD_LABELS.total_response_time_minutes} value={ns?.total_response_time_minutes} />
            <FieldRow label={FIELD_LABELS.distance_from_station_km} value={ns?.distance_from_station_km ?? ns?.distance_to_fire_scene_km} />
            <FieldRow label={FIELD_LABELS.time_returned_to_base} value={ns?.time_returned_to_base ?? ru?.return_dt} />
            <FieldRow label={FIELD_LABELS.total_gas_consumed_liters} value={ns?.total_gas_consumed_liters} />
            {/* receiver_name stored in sensitive */}
            <FieldRow label={FIELD_LABELS.receiver_name} value={sens?.receiver_name} />
          </Section>

          {/* B. Nature & Classification */}
          <Section title="B. Nature &amp; Classification" sectionId="sec-class">
            <FieldRow label={FIELD_LABELS.classification_of_involved} value={ns?.general_category ?? ns?.classification_of_involved} />
            <FieldRow label={FIELD_LABELS.type_of_involved_general_category} value={ns?.sub_category ?? ns?.type_of_involved_general_category} />
            <FieldRow label={FIELD_LABELS.general_description_of_involved} value={ns?.general_description_of_involved} />
            <FieldRow label={FIELD_LABELS.fire_origin} value={ns?.fire_origin} />
            <FieldRow label={FIELD_LABELS.stage_of_fire_upon_arrival} value={ns?.stage_of_fire ?? ns?.stage_of_fire_upon_arrival} />
            <FieldRow label={FIELD_LABELS.extent_of_damage} value={ns?.extent_of_damage} />
            <FieldRow label={FIELD_LABELS.extent_total_floor_area_sqm} value={ns?.extent_total_floor_area_sqm} />
            <FieldRow label={FIELD_LABELS.extent_total_land_area_hectares} value={ns?.extent_total_land_area_hectares} />
          </Section>

          {/* C. Affected Counts */}
          <Section title="C. Affected Counts" sectionId="sec-affected">
            <FieldRow label={FIELD_LABELS.structures_affected} value={ns?.structures_affected} />
            <FieldRow label={FIELD_LABELS.households_affected} value={ns?.households_affected} />
            <FieldRow label={FIELD_LABELS.families_affected} value={ns?.families_affected} />
            <FieldRow label={FIELD_LABELS.individuals_affected} value={ns?.individuals_affected} />
            <FieldRow label={FIELD_LABELS.vehicles_affected} value={ns?.vehicles_affected} />
          </Section>

          {/* D. Alarm Timeline */}
          <Section title="D. Fire Alarm Level / Timeline" sectionId="sec-timeline">
            <AlarmTimelineSection timeline={alarmTimeline} />
          </Section>

          {/* E. ICP */}
          <Section title="E. Incident Command Post" sectionId="sec-icp">
            <FieldRow label={FIELD_LABELS.is_icp_present} value={sens?.is_icp_present} />
            <FieldRow label={FIELD_LABELS.icp_location} value={sens?.icp_location} />
          </Section>

          {/* F. Resources */}
          {resources && (
            <Section title="F. Resources Deployed" sectionId="sec-resources">
              {Object.entries(resources).map(([k, v]) => {
                const label = FIELD_LABELS[k] ?? fieldLabel(k);
                if (typeof v === 'object' && v !== null) {
                  // Legacy nested structure — render group header + sub-rows
                  return (
                    <div key={k} className="mb-2">
                      <p className="text-xs font-bold uppercase text-gray-500 mb-1">{label}</p>
                      {Object.entries(v as Record<string, unknown>).map(([sk, sv]) => (
                        <div key={sk} className="grid grid-cols-3 gap-4 text-sm border-b border-gray-100 pb-1 pl-3">
                          <span className="font-medium text-gray-600">{FIELD_LABELS[sk] ?? fieldLabel(sk)}</span>
                          <span className="col-span-2 text-gray-900">{displayValue(sv)}</span>
                        </div>
                      ))}
                    </div>
                  );
                }
                // Flat structure — render as a normal labeled field row
                return <FieldRow key={k} label={label} value={v} />;
              })}
            </Section>
          )}

          {/* G. Personnel on Duty — FIX 5 */}
          <Section title="G. Personnel on Duty" sectionId="sec-pod">
            <PersonnelSection pod={pod} others={others} />
          </Section>

          {/* H. Sketch (if attachment available) */}
          {Array.isArray((detail as Record<string, unknown>).attachments) &&
            ((detail as Record<string, unknown>).attachments as Array<{ file_name: string; url: string }>)
              .filter((a) => a.file_name === 'afor_sketch.png' && !!a.url)
              .map((a) => (
                <Section key={a.url} title="H. Fire Scene Sketch" sectionId="sec-sketch">
                  <img src={a.url} alt="Fire Scene Sketch" className="max-w-full rounded border border-gray-200" />
                </Section>
              ))}

          {/* I. Narrative — FIX 4 */}
          <Section title="I. Narrative Report" sectionId="sec-narrative">
            <NarrativeReport text={narrative} />
          </Section>

          {/* J. Problems Encountered — FIX 6 */}
          <Section title="J. Problems Encountered" sectionId="sec-problems">
            <ProblemsGrid selected={problems} />
          </Section>

          {/* K. Recommendations */}
          <Section title="K. Recommendations" sectionId="sec-rec">
            <FieldRow label={FIELD_LABELS.recommendations} value={ns?.recommendations} />
          </Section>

          {/* L. Disposition & Signatories */}
          <Section title="L. Disposition &amp; Signatories" sectionId="sec-disp">
            <FieldRow label={FIELD_LABELS.disposition} value={sens?.disposition} />
            <FieldRow label={FIELD_LABELS.prepared_by_officer} value={sens?.prepared_by_officer} />
            <FieldRow label={FIELD_LABELS.noted_by_officer} value={sens?.noted_by_officer} />
          </Section>

          {/* Caller / Contact (sensitive) */}
          <Section title="Caller &amp; Contact Information" sectionId="sec-contact">
            <FieldRow label={FIELD_LABELS.street_address} value={sens?.street_address} />
            <FieldRow label={FIELD_LABELS.landmark} value={sens?.landmark} />
            <FieldRow label={FIELD_LABELS.caller_name} value={sens?.caller_name} />
            <FieldRow label={FIELD_LABELS.caller_number} value={sens?.caller_number} />
            <FieldRow label={FIELD_LABELS.receiver_name} value={sens?.receiver_name} />
            <FieldRow label={FIELD_LABELS.owner_name} value={sens?.owner_name} />
          </Section>
        </>
      )}
    </div>
  );
}
