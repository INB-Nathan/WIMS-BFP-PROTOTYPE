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
  apiFetch,
  ApiRequestError,
  type RegionalIncidentDetailResponse,
} from '@/lib/api';
import dynamic from 'next/dynamic';
import { UpdateRequestDiffPanel } from '@/components/UpdateRequestDiffPanel';
import { IncidentDiffPanel } from '@/components/IncidentDiffPanel';
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
  ALL_PROBLEM_OPTIONS,
  normalizeProblemLabel,
  formatClassification,
} from '@/lib/afor-utils';

// ── FIX 4: Narrative as ordered bullets ──────────────────────────────────────
type SectionTone =
  | 'slate'
  | 'red'
  | 'amber'
  | 'blue'
  | 'rose'
  | 'emerald'
  | 'green'
  | 'neutral';

const SECTION_TONES: Record<SectionTone, { section: string; header: string; accent: string; table: string }> = {
  slate: { section: 'border-slate-200/80', header: 'bg-slate-50/80', accent: 'bg-slate-500', table: 'bg-slate-50/80' },
  red: { section: 'border-rose-200/70', header: 'bg-rose-50/70', accent: 'bg-rose-700', table: 'bg-rose-50/60' },
  amber: { section: 'border-amber-200/70', header: 'bg-amber-50/65', accent: 'bg-amber-600', table: 'bg-amber-50/50' },
  blue: { section: 'border-sky-200/70', header: 'bg-sky-50/65', accent: 'bg-sky-700', table: 'bg-sky-50/55' },
  rose: { section: 'border-rose-200/65', header: 'bg-rose-50/55', accent: 'bg-rose-700', table: 'bg-rose-50/45' },
  emerald: { section: 'border-emerald-200/70', header: 'bg-emerald-50/55', accent: 'bg-emerald-700', table: 'bg-emerald-50/45' },
  green: { section: 'border-emerald-200/70', header: 'bg-emerald-50/55', accent: 'bg-emerald-700', table: 'bg-emerald-50/45' },
  neutral: { section: 'border-stone-200/80', header: 'bg-stone-50/80', accent: 'bg-stone-500', table: 'bg-stone-50/70' },
};

const SECTION_NAV_LINKS = [
  { id: 'sec-response', label: 'Response', observedIds: ['sec-response'] },
  { id: 'sec-class', label: 'Classification', observedIds: ['sec-class'] },
  { id: 'sec-affected-assets-nav', label: 'Affected & Assets', observedIds: ['sec-affected', 'sec-resources'] },
  { id: 'sec-timeline', label: 'Timeline', observedIds: ['sec-timeline'] },
  { id: 'sec-casualties', label: 'Casualties', observedIds: ['sec-casualties'] },
  { id: 'sec-pod', label: 'Personnel', observedIds: ['sec-pod'] },
  { id: 'sec-geo', label: 'Location', observedIds: ['sec-geo'] },
  { id: 'sec-narrative', label: 'Narrative', observedIds: ['sec-narrative'] },
  { id: 'sec-problems', label: 'Problems & Recommendations', observedIds: ['sec-problems', 'sec-rec'] },
] as const;

const SECTION_OBSERVER_ID_TO_NAV_ID = SECTION_NAV_LINKS.reduce<Record<string, string>>((acc, link) => {
  link.observedIds.forEach((id) => {
    acc[id] = link.id;
  });
  return acc;
}, {});

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value.trim() ? value : '—';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return JSON.stringify(value, null, 2);
}

function EmptyValue() {
  return <span className="text-gray-500">—</span>;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-5 text-sm text-slate-700">
      {message}
    </div>
  );
}

function DetailGrid({ children, columns = 2 }: { children: React.ReactNode; columns?: 2 | 3 }) {
  const gridClass = columns === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2';
  return <dl className={`grid grid-cols-1 gap-x-9 gap-y-5 md:grid-cols-2 ${gridClass}`}>{children}</dl>;
}

function DetailField({
  label,
  value,
  className = '',
  valueClassName = '',
}: {
  label: string;
  value: unknown;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={`min-w-0 border-b border-slate-200/80 pb-3.5 ${className}`}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500">{label}</dt>
      <dd className={`mt-1.5 whitespace-pre-wrap break-words text-sm font-medium leading-6 text-slate-950 ${valueClassName}`}>
        {formatDetailValue(value)}
      </dd>
    </div>
  );
}

function TextBlock({ label, value }: { label?: string; value: unknown }) {
  return (
    <div>
      {label ? <p className="mb-2 text-xs font-semibold uppercase tracking-[0.04em] text-slate-500">{label}</p> : null}
      <div className="rounded-xl border border-stone-200/90 bg-stone-50/80 px-4 py-4 text-sm leading-7 text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <p className="whitespace-pre-wrap break-words">{formatDetailValue(value)}</p>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-xl border border-amber-200/70 bg-amber-50/45 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.035)]">
      <div className="text-lg font-semibold tabular-nums text-slate-950">{formatDetailValue(value)}</div>
      <div className="mt-1 text-xs font-medium leading-4 text-slate-600">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const statusColors: Record<string, string> = {
    DRAFT: 'border-gray-200 bg-gray-100 text-gray-800',
    PENDING: 'border-yellow-200 bg-yellow-100 text-yellow-900',
    PENDING_VALIDATION: 'border-blue-200 bg-blue-100 text-blue-900',
    VERIFIED: 'border-green-200 bg-green-100 text-green-900',
    REJECTED: 'border-red-200 bg-red-100 text-red-900',
    REPLACED: 'border-purple-200 bg-purple-100 text-purple-900',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusColors[status] ?? 'border-gray-200 bg-gray-100 text-gray-800'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function NarrativeReport({ text }: { text: string }) {
  const paragraphs = text.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!paragraphs.length) return <EmptyValue />;
  return (
    <div className="space-y-3 rounded-xl border border-stone-200/90 bg-stone-50/80 px-4 py-4 text-sm leading-7 text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {paragraphs.map((p, i) => (
        <p key={i} className="whitespace-pre-wrap break-words">{p}</p>
      ))}
    </div>
  );
}

// ── FIX 6: Problems grid ─────────────────────────────────────────────────────
function ProblemsGrid({ selected }: { selected: string[] }) {
  const selectedSet = new Set((selected ?? []).map((s) => normalizeProblemLabel(String(s))));
  const selectedOptions = ALL_PROBLEM_OPTIONS.filter((label) => selectedSet.has(normalizeProblemLabel(label)));

  if (!selectedOptions.length) {
    return <EmptyState message="No problems encountered were recorded." />;
  }

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {selectedOptions.map((label) => (
        <span
          key={label}
          className="inline-flex items-center rounded-xl border border-amber-200/70 bg-amber-50/60 px-3.5 py-2.5 text-sm font-medium leading-5 text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
        >
          <span className="mr-2 h-1.5 w-1.5 rounded-full bg-amber-600/70" aria-hidden />
          {label}
        </span>
      ))}
    </div>
  );
}

type PersonnelOnDuty = Record<string, string | { name?: string; contact?: string }>;
type OtherPerson = { name: string; designation: string };

function PersonnelSection({ pod, others }: { pod: PersonnelOnDuty; others: OtherPerson[] }) {
  const simpleKeys = ['engine_commander', 'shift_in_charge', 'nozzleman', 'lineman', 'engine_crew', 'driver'];
  const complexKeys = ['safety_officer', 'fire_arson_investigator'];

  return (
    <div className="space-y-6">
      <DetailGrid>
      {simpleKeys.map((k) => {
        const val = pod[k];
        if (val === undefined) return null;
        return (
          <DetailField
            key={k}
            label={FIELD_LABELS[k] ?? fieldLabel(k)}
            value={typeof val === 'string' ? val : JSON.stringify(val)}
          />
        );
      })}
      {complexKeys.map((k) => {
        const val = pod[k];
        if (val === undefined) return null;
        const nameStr = typeof val === 'object' ? (val as { name?: string }).name ?? '' : String(val ?? '');
        const contactStr = typeof val === 'object' ? (val as { contact?: string }).contact ?? '' : '';
        return (
          <DetailField
            key={k}
            label={FIELD_LABELS[k] ?? fieldLabel(k)}
            value={contactStr ? `${nameStr} (${contactStr})` : nameStr}
          />
        );
      })}
      </DetailGrid>

      {others.length > 0 && (
        <DataTable
          title="Other Personnel at Scene"
          columns={['Name', 'Designation / Agency']}
          rows={others.map((p) => [p.name, p.designation])}
        />
      )}
    </div>
  );
}

// ── Generic labeled field row ────────────────────────────────────────────────
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

function mark24h(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = String(raw).trim();
  return value || null;
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
  subtitle,
  children,
  tone = 'neutral',
}: {
  title: string;
  sectionId: string;
  subtitle?: string;
  children: React.ReactNode;
  tone?: SectionTone;
}) {
  const toneClasses = SECTION_TONES[tone];
  return (
    <section
      id={sectionId}
      className={`scroll-mt-24 overflow-hidden rounded-2xl border bg-white shadow-[0_8px_24px_rgba(15,23,42,0.045)] ${toneClasses.section}`}
      aria-labelledby={`${sectionId}-title`}
    >
      <div className={`relative border-b border-slate-200/70 px-5 py-4 ${toneClasses.header}`}>
        <span className={`absolute left-0 top-4 h-8 w-1 rounded-r-full ${toneClasses.accent}`} aria-hidden />
        <h2 id={`${sectionId}-title`} className="text-base font-semibold text-gray-950">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-gray-600">{subtitle}</p> : null}
      </div>
      <div className="space-y-6 p-5">{children}</div>
    </section>
  );
}

// ── Alarm timeline display ───────────────────────────────────────────────────
type AlarmTimelineEntry = { time?: string | null; commander?: string };
type AlarmTimeline = Record<string, AlarmTimelineEntry | string | null>;

function DataTable({
  title,
  columns,
  rows,
  emptyMessage = 'No records available.',
}: {
  title?: string;
  columns: string[];
  rows: unknown[][];
  emptyMessage?: string;
}) {
  const visibleRows = rows.filter((row) => row.some((cell) => formatDetailValue(cell) !== '—'));
  if (!visibleRows.length) return <EmptyState message={emptyMessage} />;
  return (
    <div>
      {title ? <p className="mb-2 text-xs font-semibold uppercase tracking-[0.04em] text-slate-500">{title}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.035)]">
        <table className="min-w-full divide-y divide-slate-200/80 text-sm">
          <thead className="bg-slate-50/90">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.04em] text-slate-600">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {visibleRows.map((row, rowIndex) => (
              <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-white hover:bg-slate-50/80' : 'bg-slate-50/35 hover:bg-slate-50/90'}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-4 py-3 align-top text-slate-900">
                    <span className={cellIndex > 0 ? 'tabular-nums' : ''}>{formatDetailValue(cell)}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResourceGroup({ title, rows }: { title: string; rows: { label: string; value: unknown }[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.04em] text-slate-500">{title}</p>
      <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.035)] sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="border-b border-r border-slate-200/80 bg-slate-50/45 px-3.5 py-3">
            <div className="text-xs font-medium text-slate-600">{row.label}</div>
            <div className="mt-1 text-sm font-semibold tabular-nums text-slate-950">{formatDetailValue(row.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AlarmTimelineSection({ timeline }: { timeline: AlarmTimeline }) {
  const keys = Object.keys(timeline).filter((k) => !k.startsWith('_'));
  const hasData = keys.some((k) => {
    const v = timeline[k];
    return v && (typeof v === 'string' ? v : (v as AlarmTimelineEntry).time);
  });
  if (!hasData) return <EmptyState message="No alarm escalation recorded." />;

  const rows = keys
    .map((k) => {
        const entry = timeline[k];
        const rawTime = entry ? (typeof entry === 'string' ? entry : (entry as AlarmTimelineEntry).time ?? '') : '';
        const commander = entry && typeof entry !== 'string' ? (entry as AlarmTimelineEntry).commander ?? '' : '';
        const split = splitAlarmDateTime(rawTime);
        return [FIELD_LABELS[k] ?? fieldLabel(k), split?.date ?? rawTime, split?.time ?? '', commander];
      })
    .filter((row) => row.some((cell, index) => index > 0 && formatDetailValue(cell) !== '—'));

  return <DataTable columns={['Stage', 'Date', 'Time (24H)', 'Commander']} rows={rows} emptyMessage="No alarm escalation recorded." />;
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
  const [regionMismatchMsg, setRegionMismatchMsg] = useState<string | null>(null);
  const [saveNotification, setSaveNotification] = useState<string | null>(null);
  const [showWithdrawPopup, setShowWithdrawPopup] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [duplicateFound, setDuplicateFound] = useState<{ matchedIncidentId: number } | null>(null);
  const [pendingDuplicateFound, setPendingDuplicateFound] = useState<{ matchedIncidentId: number } | null>(null);
  const [staleAlert, setStaleAlert] = useState(false);
  const [showMissingFieldsModal, setShowMissingFieldsModal] = useState(false);
  const [missingFieldsList, setMissingFieldsList] = useState<string[]>([]);
  const [missingFieldKeys, setMissingFieldKeys] = useState<string[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string>(SECTION_NAV_LINKS[0].id);

  const isEncoder = role === 'REGIONAL_ENCODER' || role === 'ENCODER';
  const isValidator = role === 'NATIONAL_VALIDATOR' || role === 'VALIDATOR';
  const dashboardHref = isValidator ? '/dashboard/validator' : '/dashboard/regional';
  const dashboardLabel = isValidator ? 'Back to Validator Dashboard' : 'Back to Regional Dashboard';

  // Validator action state
  const [validatorAction, setValidatorAction] = useState<'accept' | 'pending' | 'reject' | null>(null);
  const [validatorNotes, setValidatorNotes] = useState('');
  const [validatorLoading, setValidatorLoading] = useState(false);
  const [validatorError, setValidatorError] = useState<string | null>(null);
  const [showAcceptConfirm, setShowAcceptConfirm] = useState(false);
  const [showAcceptConfirmDiff, setShowAcceptConfirmDiff] = useState(false);
  const [validatorDupMatchedId, setValidatorDupMatchedId] = useState<number | null>(null);
  const dupAutoShownRef = useRef(false);
  const pendingSubmitOnceRef = useRef(false);

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

  useEffect(() => {
    if (!detail || isEditing) return;
    const sections = Object.keys(SECTION_OBSERVER_ID_TO_NAV_ID)
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section));
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const navId = visible?.target.id ? SECTION_OBSERVER_ID_TO_NAV_ID[visible.target.id] : null;
        if (navId) {
          setActiveSectionId(navId);
        }
      },
      { rootMargin: '-20% 0px -65% 0px', threshold: [0.1, 0.25, 0.5] },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [detail, isEditing]);

  const scrollToReportSection = useCallback((sectionId: string) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

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

  // When IncidentForm saves + submits and gets a 409 DUPLICATE_DETECTED, it redirects
  // here with ?pending_submit=1. Re-fire the submit so the duplicate modal appears.
  useEffect(() => {
    if (!detail || pendingSubmitOnceRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('pending_submit') !== '1') return;
    pendingSubmitOnceRef.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    void handleSubmit({});
  }, [detail]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setRegionMismatchMsg(
        `You can only submit incidents for your assigned region (${assignedName}). This incident belongs to a different region.\nError code: REGION_MISMATCH`
      );
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
  const classificationDisplay = formatClassification(String(ns?.general_category ?? ns?.classification_of_involved ?? ''));
  const categoryDisplay = ns?.sub_category ?? ns?.type_of_involved_general_category;
  const locationDisplay = [ns?.city_municipality, ns?.province_district, ns?.region].filter(Boolean).join(', ') || null;
  const completeAddress = sens?.street_address ?? ns?.incident_address;
  const incidentTitle = detail?.verification_status === 'VERIFIED' && detail.reference_number
    ? detail.reference_number
    : detail
    ? `Incident #${detail.incident_id}`
    : 'Incident';
  type EngineRow = { name?: string; time_dispatched?: string; time_arrived?: string };
  const engines = ((alarmTimeline as Record<string, unknown>)._engines as EngineRow[] | undefined) ?? [];
  const engineRows = engines
    .filter((eng) => eng.name || eng.time_dispatched || eng.time_arrived)
    .map((eng) => [eng.name, mark24h(eng.time_dispatched), mark24h(eng.time_arrived)]);
  const casualtyRows = (() => {
    const cd = sens?.casualty_details as Record<string, Record<string, Record<string, number>>> | undefined;
    const rows = [
      { label: 'Injured Civilian', path: ['injured', 'civilian'] },
      { label: 'Injured BFP Firefighter', path: ['injured', 'firefighter'] },
      { label: 'Injured Fire Auxiliary', path: ['injured', 'auxiliary'] },
      { label: 'Civilian Fatality/ies', path: ['fatalities', 'civilian'] },
      { label: 'BFP Firefighter Fatality/ies', path: ['fatalities', 'firefighter'] },
      { label: 'Fire Auxiliary Fatality/ies', path: ['fatalities', 'auxiliary'] },
    ];
    return rows.map(({ label, path }) => {
      const entry = cd?.[path[0]]?.[path[1]] ?? {};
      return [label, entry.m ?? 0, entry.f ?? 0];
    });
  })();
  const canSubmitOrDelete = isEncoder && detail &&
    (detail.verification_status === 'DRAFT' ||
     detail.verification_status === 'PENDING' ||
     detail.verification_status === 'REJECTED');

  return (
    <div className="space-y-6">
      {!loading && !error && detail && (
        <>
          <Link
            href={dashboardHref}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700/40 md:hidden"
            aria-label="Back to Regional Dashboard"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Dashboard
          </Link>
          <Link
            href={dashboardHref}
            className="group fixed top-[45vh] z-40 hidden h-44 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-r-full border border-l-0 border-slate-200 bg-white/90 text-slate-600 shadow-md backdrop-blur transition-all duration-200 ease-out hover:w-12 hover:border-red-200 hover:bg-red-50/80 hover:text-red-800 hover:shadow-xl focus:outline-none focus-visible:w-12 focus-visible:ring-2 focus-visible:ring-red-700/50 md:flex"
            style={{ left: 'calc(var(--sidebar-width) + 1rem)' }}
            aria-label="Back to Regional Dashboard"
            title="Back to Regional Dashboard"
          >
            <ArrowLeft className="h-5 w-5 shrink-0 transition-transform duration-200 motion-safe:group-hover:-translate-x-0.5 motion-safe:group-focus-visible:-translate-x-0.5" aria-hidden />
          </Link>
        </>
      )}

      {/* Region mismatch modal */}
      {regionMismatchMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6 space-y-4">
            <div className="flex items-center gap-2">
              <span className="bg-red-100 text-red-800 text-xs font-bold px-2 py-1 rounded font-mono">
                REGION_MISMATCH
              </span>
              <h2 className="text-lg font-bold text-red-900">Region Access Denied</h2>
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-line">{regionMismatchMsg}</p>
            <button
              className="w-full bg-red-800 text-white rounded py-2 font-semibold hover:bg-red-700"
              onClick={() => setRegionMismatchMsg(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

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

      <div className="rounded-2xl border border-slate-200/90 bg-white px-5 py-4 shadow-[0_6px_18px_rgba(15,23,42,0.045)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-3">
            <Link
              href={dashboardHref}
              className="inline-flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-950"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {dashboardLabel}
            </Link>
            {detail ? (
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-semibold tracking-tight text-gray-950">
                    {incidentTitle}
                  </h1>
                  <StatusBadge status={detail.verification_status} />
                  {detail.is_wildland ? (
                    <span className="inline-flex items-center rounded border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-900">
                      Wildland Fire AFOR
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  {detail.verification_status !== 'VERIFIED' || !detail.reference_number
                    ? `Incident #${detail.incident_id} - `
                    : ''}
                  {getShortRegionName(detail.region_id)}
                  {detail.created_at ? <> - Created {new Date(detail.created_at).toLocaleString()}</> : null}
                </p>
              </div>
            ) : null}
          </div>

          {detail && isEncoder ? (
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {!isEditing ? (
                <>
                  <button
                    onClick={handleEditClick}
                    disabled={actionLoading}
                    className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  {detail.verification_status === 'PENDING' ? (
                    <button
                      onClick={handleUnpend}
                      disabled={actionLoading}
                      className="inline-flex items-center gap-1.5 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm font-semibold text-yellow-900 hover:bg-yellow-100 disabled:opacity-50"
                    >
                      Withdraw
                    </button>
                  ) : null}
                  {canSubmitOrDelete ? (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={actionLoading}
                      className="inline-flex items-center gap-1.5 rounded border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  ) : null}
                  {detail.verification_status === 'DRAFT' || detail.verification_status === 'REJECTED' ? (
                    <button
                      onClick={handleSubmitClick}
                      disabled={actionLoading}
                      className="inline-flex items-center gap-1.5 rounded bg-red-800 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" />
                      {detail.verification_status === 'REJECTED' ? 'Resubmit for Review' : 'Submit for Review'}
                    </button>
                  ) : null}
                </>
              ) : (
                <button
                  onClick={() => { setIsEditing(false); setActionError(null); setMissingFieldKeys([]); }}
                  className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to View
                </button>
              )}
            </div>
          ) : null}
        </div>
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

          <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_6px_18px_rgba(15,23,42,0.04)]" aria-labelledby="incident-summary-title">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 id="incident-summary-title" className="text-base font-semibold text-gray-950">Incident Summary</h2>
                <p className="mt-1 text-sm text-gray-600">Key report details for quick review.</p>
              </div>
            </div>
            <DetailGrid columns={3}>
              <DetailField label="Date & Time of Notification (24H)" value={fmt24h(ns?.notification_dt as string | null)} />
              <DetailField label={FIELD_LABELS.fire_station_name} value={ns?.fire_station_name} />
              <DetailField label={FIELD_LABELS.alarm_level} value={ns?.alarm_level} />
              <DetailField label={FIELD_LABELS.general_category} value={classificationDisplay} />
              <DetailField label={FIELD_LABELS.sub_category} value={categoryDisplay} />
              <DetailField label="Location" value={locationDisplay} className="lg:col-span-1" />
              <DetailField label={FIELD_LABELS.street_address} value={completeAddress} className="lg:col-span-2" />
            </DetailGrid>
          </section>

          <nav
            className="fixed right-6 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-3 xl:flex 2xl:right-8"
            aria-label="Incident report sections"
          >
            {SECTION_NAV_LINKS.map(({ id, label }) => (
              <a
                key={id}
                href={`#${id}`}
                onClick={(event) => {
                  event.preventDefault();
                  scrollToReportSection(id);
                }}
                aria-label={label}
                title={label}
                className="group relative flex h-8 w-8 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700/40"
              >
                <span
                  className={`h-3.5 w-3.5 rounded-full border shadow-sm transition-all duration-200 motion-safe:group-hover:scale-125 motion-safe:group-focus:scale-125 ${
                    activeSectionId === id
                      ? 'border-red-800 bg-red-800 ring-4 ring-red-100'
                      : 'border-slate-400 bg-white group-hover:border-red-700 group-focus:border-red-700 group-hover:bg-red-50 group-focus:bg-red-50'
                  }`}
                />
                <span className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 opacity-0 shadow-sm transition-all duration-150 group-hover:-translate-x-1 group-hover:opacity-100 group-focus:-translate-x-1 group-focus:opacity-100">
                  {label}
                </span>
              </a>
            ))}
          </nav>

          <Section title="A. Response Details" sectionId="sec-response" tone="blue" subtitle="Notification, dispatch, station, location, and caller information.">
            <DetailGrid columns={3}>
              <DetailField label={`${FIELD_LABELS.notification_dt} (24H)`} value={fmt24h(ns?.notification_dt as string | null)} />
              <DetailField label={FIELD_LABELS.fire_station_name} value={ns?.fire_station_name} />
              <DetailField label={FIELD_LABELS.responder_type} value={ns?.responder_type} />
              <DetailField label={FIELD_LABELS.alarm_level} value={ns?.alarm_level} />
              <DetailField label="Time Returned to Base (24H)" value={mark24h(timeReturnedToBase)} />
              <DetailField label={FIELD_LABELS.distance_from_station_km} value={ns?.distance_from_station_km ?? ns?.distance_to_fire_scene_km} />
              <DetailField label={FIELD_LABELS.total_response_time_minutes} value={ns?.total_response_time_minutes} />
              <DetailField label={FIELD_LABELS.total_gas_consumed_liters} value={ns?.total_gas_consumed_liters} />
              <DetailField label="Location" value={locationDisplay} />
              <DetailField label={FIELD_LABELS.street_address} value={completeAddress} className="lg:col-span-2" />
              <DetailField label={FIELD_LABELS.landmark} value={sens?.landmark ?? ns?.nearest_landmark} />
              <DetailField label={FIELD_LABELS.caller_name} value={sens?.caller_name} />
              <DetailField label={FIELD_LABELS.caller_number} value={sens?.caller_number} />
              <DetailField label={FIELD_LABELS.receiver_name} value={sens?.receiver_name ?? ns?.receiver_name} />
            </DetailGrid>
            {engineRows.length > 0 ? (
              <DataTable
                title="Engine / Unit Dispatched"
                columns={['Engine / Unit', 'Time Dispatched (24H)', 'Time Arrived at Scene (24H)']}
                rows={engineRows}
              />
            ) : (
              <DataTable
                title="Engine / Unit Dispatched"
                columns={['Engine / Unit', 'Time Dispatched (24H)', 'Time Arrived at Scene (24H)']}
                rows={[[engineDispatched, mark24h(timeEngineDispatched), mark24h(timeArrivedAtScene)]]}
              />
            )}
          </Section>

          <Section title="B. Nature and Classification of Involved" sectionId="sec-class" tone="red" subtitle="Incident classification, involved property, origin, and damage description.">
            <DetailGrid>
              <DetailField label={FIELD_LABELS.general_category} value={classificationDisplay} />
              <DetailField label={FIELD_LABELS.sub_category} value={categoryDisplay} />
              <DetailField label="Name of Owner/Establishment" value={sens?.owner_name ?? ns?.owner_name} />
              <DetailField label={FIELD_LABELS.fire_origin} value={ns?.fire_origin ?? ns?.area_of_origin} />
              <DetailField label="Stage of Fire Upon Arrival" value={ns?.stage_of_fire_upon_arrival ?? ns?.stage_of_fire} />
              <DetailField label={FIELD_LABELS.extent_of_damage} value={ns?.extent_of_damage} />
              {ns?.extent_total_floor_area_sqm ? <DetailField label={FIELD_LABELS.extent_total_floor_area_sqm} value={ns.extent_total_floor_area_sqm} /> : null}
              {ns?.extent_total_land_area_hectares ? <DetailField label={FIELD_LABELS.extent_total_land_area_hectares} value={ns.extent_total_land_area_hectares} /> : null}
              {ns?.extent_objects_count ? <DetailField label="No. of Objects/Properties Affected" value={ns.extent_objects_count} /> : null}
              {detail.is_wildland ? <DetailField label="Wildland Fire Type" value={detail.wildland_fire_type} /> : null}
              {detail.is_wildland && detail.wildland_area_display ? <DetailField label="Total Area Burned" value={detail.wildland_area_display} /> : null}
              {detail.is_wildland && detail.wildland_area_hectares != null ? <DetailField label="Area Burned (Hectares)" value={detail.wildland_area_hectares} /> : null}
            </DetailGrid>
            <TextBlock label="General Description" value={ns?.general_description_of_involved} />
            {ns?.extent_description ? <TextBlock label="Description" value={ns.extent_description} /> : null}
          </Section>

          <Section title="C. Affected Counts" sectionId="sec-affected" tone="amber" subtitle="Reported counts affected by the incident.">
            <div id="sec-affected-assets-nav" className="scroll-mt-24" aria-hidden />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <MetricCard label={FIELD_LABELS.structures_affected} value={ns?.structures_affected} />
              <MetricCard label={FIELD_LABELS.households_affected} value={ns?.households_affected} />
              <MetricCard label={FIELD_LABELS.families_affected} value={ns?.families_affected} />
              <MetricCard label={FIELD_LABELS.individuals_affected} value={ns?.individuals_affected} />
              <MetricCard label={FIELD_LABELS.vehicles_affected} value={ns?.vehicles_affected} />
            </div>
          </Section>

          <Section title="C. Assets and Resources Deployed" sectionId="sec-resources" tone="slate" subtitle="Vehicles, tools, equipment, and water access resources used for response.">
            {(() => {
              const trucks = resources?.trucks as Record<string, unknown> | undefined;
              const medical = resources?.medical as Record<string, unknown> | undefined;
              const special = resources?.special_assets as Record<string, unknown> | undefined;
              const tools = resources?.tools as Record<string, unknown> | undefined;
              const TRUCK_LABELS: Record<string, string> = { bfp: 'BFP Fire Trucks', lgu: 'BFP-Manned (LGU)', non_bfp: 'Non-BFP Fire Trucks', volunteer: 'Non-BFP Fire Trucks' };
              const MEDICAL_LABELS: Record<string, string> = { bfp: 'BFP Ambulance', non_bfp: 'Non-BFP Ambulance' };
              const SPECIAL_LABELS: Record<string, string> = { rescue_bfp: 'BFP Rescue Trucks', rescue_non_bfp: 'Non-BFP Rescue Trucks', others: 'Other Vehicles / Assets' };
              const TOOL_LABELS: Record<string, string> = { scba: 'SCBA', rope: 'Rope', ladder: 'Ladder', hoseline: 'Hoseline', hydraulic: 'Hydraulic Tools', others: 'Other Tools' };
              const vehicleRows: { label: string; value: unknown }[] = [];
              if (trucks) Object.entries(trucks).forEach(([k, v]) => vehicleRows.push({ label: TRUCK_LABELS[k] ?? k, value: v }));
              if (medical) Object.entries(medical).forEach(([k, v]) => vehicleRows.push({ label: MEDICAL_LABELS[k] ?? k, value: v }));
              if (special) Object.entries(special).forEach(([k, v]) => vehicleRows.push({ label: SPECIAL_LABELS[k] ?? k, value: v }));
              const toolRows = tools ? Object.entries(tools).map(([k, v]) => ({ label: TOOL_LABELS[k] ?? k, value: v })) : [];
              const hasResources = vehicleRows.length > 0 || toolRows.length > 0 || !!resources?.hydrant_distance;
              if (!hasResources) return <EmptyState message="No resources recorded." />;
              return (
                <div className="space-y-5">
                  {vehicleRows.length > 0 ? <ResourceGroup title="Vehicles" rows={vehicleRows} /> : null}
                  {toolRows.length > 0 ? <ResourceGroup title="Tools & Equipment" rows={toolRows} /> : null}
                  {resources?.hydrant_distance ? (
                    <DetailField label="Hydrant Location / Distance" value={resources.hydrant_distance} />
                  ) : null}
                </div>
              );
            })()}
          </Section>

          <Section title="D. Fire Alarm Level / Timeline" sectionId="sec-timeline" tone="blue" subtitle="Alarm escalation stages with date, time, and commander.">
            <AlarmTimelineSection timeline={alarmTimeline} />
          </Section>

          <Section title="E. Profile of Casualties" sectionId="sec-casualties" tone="rose" subtitle="Casualty counts by category and sex.">
            <DataTable columns={['Category', 'Male', 'Female']} rows={casualtyRows} />
          </Section>

          <Section title="F. Personnel on Duty" sectionId="sec-pod" tone="slate" subtitle="Key personnel assignments and other agencies/personnel at the scene.">
            <PersonnelSection pod={pod} others={others} />
          </Section>

          <Section title="G. Incident Command Post" sectionId="sec-icp" tone="neutral">
            <DetailGrid>
              <DetailField label={FIELD_LABELS.is_icp_present} value={sens?.is_icp_present} />
              <DetailField label={FIELD_LABELS.icp_location} value={sens?.icp_location} />
            </DetailGrid>
          </Section>

          <Section title="H. Fire Scene Location" sectionId="sec-geo" tone="emerald" subtitle="Recorded geographic coordinates and map pin.">
            <DetailGrid>
              <DetailField label="Latitude" value={detail.latitude != null ? detail.latitude.toFixed(6) : null} valueClassName="font-mono" />
              <DetailField label="Longitude" value={detail.longitude != null ? detail.longitude.toFixed(6) : null} valueClassName="font-mono" />
            </DetailGrid>
            {detail.latitude != null && detail.longitude != null ? (
              <div className="overflow-hidden border border-slate-200 bg-slate-100">
                <IncidentLocationMap latitude={detail.latitude} longitude={detail.longitude} />
              </div>
            ) : (
              <EmptyState message="No map coordinates recorded." />
            )}
          </Section>

          {Array.isArray((detail as unknown as Record<string, unknown>).attachments) &&
            ((detail as unknown as Record<string, unknown>).attachments as Array<{ file_name: string; url: string }>)
              .filter((a) => a.file_name === 'afor_sketch.png' && !!a.url)
              .map((a) => (
                <Section key={a.url} title="H. Fire Scene Sketch" sectionId="sec-sketch" tone="slate">
                  {/* Dynamic uploaded sketch URL; next/image cannot optimize this reliably. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt="Fire Scene Sketch" className="max-w-full rounded-lg border border-gray-200" />
                </Section>
              ))}

          <Section title="I. Narrative Report" sectionId="sec-narrative" tone="amber">
            <NarrativeReport text={narrative} />
          </Section>

          <Section title="J. Problems Encountered" sectionId="sec-problems" tone="amber">
            <ProblemsGrid selected={problems} />
            {(() => {
              const normalizedSet = new Set(ALL_PROBLEM_OPTIONS.map(normalizeProblemLabel));
              const customEntries = problems.filter((p) => !normalizedSet.has(normalizeProblemLabel(String(p))));
              if (!customEntries.length) return null;
              return <TextBlock label="Others (specify)" value={customEntries.join(', ')} />;
            })()}
          </Section>

          <Section title="K. Recommendations" sectionId="sec-rec" tone="green">
            <TextBlock value={ns?.recommendations} />
          </Section>

          <Section title="L. Disposition & Signatories" sectionId="sec-disp" tone="slate">
            <TextBlock label={FIELD_LABELS.disposition} value={sens?.disposition} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <DetailField label={FIELD_LABELS.prepared_by_officer} value={sens?.prepared_by_officer ?? sens?.disposition_prepared_by} />
              <DetailField label={FIELD_LABELS.noted_by_officer} value={sens?.noted_by_officer ?? sens?.disposition_noted_by} />
            </div>
          </Section>

          {!isValidator && (
            <div className="flex justify-start pt-2">
              <Link
                href="/dashboard/regional"
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:bg-gray-50 hover:text-gray-950"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Regional Dashboard
              </Link>
            </div>
          )}

          {/* Validator actions — shown only to validators at the bottom of the view */}
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
                        onClick={() => { setShowAcceptConfirm(true); setShowAcceptConfirmDiff(false); }}
                        disabled={validatorLoading || detail?.verification_status === 'VERIFIED' || detail?.verification_status === 'REJECTED'}
                        className="px-4 py-2 text-sm rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Accept
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

      {/* ── Accept confirmation modal ── */}
      {showAcceptConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-1 text-gray-900">Confirm Acceptance</h2>
            <p className="text-sm mb-4 text-gray-500">
              Incident #{incidentId} — verify the details before confirming.
            </p>
            <button
              onClick={() => setShowAcceptConfirmDiff((v) => !v)}
              className="text-sm font-medium underline mb-4 block text-red-700"
            >
              {showAcceptConfirmDiff ? 'Hide' : 'View'} revision history
            </button>
            {showAcceptConfirmDiff && (
              <div className="mb-4">
                <IncidentDiffPanel incidentId={incidentId} />
              </div>
            )}
            <div className="flex justify-end gap-3 mt-2">
              <button
                onClick={() => { setShowAcceptConfirm(false); setShowAcceptConfirmDiff(false); }}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowAcceptConfirm(false);
                  setShowAcceptConfirmDiff(false);
                  void submitValidatorAction({ action: 'accept' });
                }}
                disabled={validatorLoading}
                className="px-4 py-2 text-sm rounded-lg text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
              >
                Confirm Accept
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
