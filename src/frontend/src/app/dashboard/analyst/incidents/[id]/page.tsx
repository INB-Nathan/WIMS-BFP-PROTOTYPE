"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bell,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Eye,
  EyeOff,
  FileText,
  Flag,
  Flame,
  Info,
  ListTodo,
  Lock,
  MapPin,
  RefreshCw,
  Shield,
  ShieldAlert,
  Truck,
  Users,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import {
  downloadAnalyticsExport,
  fetchAnalystIncidentDetail,
  fetchAnalystIncidentSensitive,
  queueAnalyticsExport,
  type AnalystIncidentDetailResponse,
  type AnalystIncidentSensitiveResponse,
} from "@/lib/api";

const ANALYST_ROLES = ["NATIONAL_ANALYST", "SYSTEM_ADMIN"];
const DETAIL_EXPORT_COLUMNS = [
  "incident_id","notification_dt","province_name","municipality_name",
  "alarm_level","general_category","sub_category","estimated_damage_php",
  "total_response_time_minutes","fire_origin","extent_of_damage",
  "structures_affected","households_affected","families_affected",
  "individuals_affected","vehicles_affected",
];

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatDateTime(value: string | null): string {
  if (!value) return "N/A";
  return new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

function formatMoney(value: number | null): string {
  if (value == null) return "N/A";
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(value);
}

function formatMinutes(value: number | null): string {
  if (value == null) return "N/A";
  return `${Number(value).toFixed(1)} min`;
}

// ─── Semantic Icon Map ────────────────────────────────────────────────────────

const SECTION_ICONS: Record<string, ReactNode> = {
  "A. Response Details":   <MapPin className="h-4 w-4" />,
  "B. Classification":     <Flag className="h-4 w-4" />,
  "C. Impact & Casualties":<AlertTriangle className="h-4 w-4" />,
  "D. Assets & Resources": <Truck className="h-4 w-4" />,
  "E. Fire Alarm Timeline":<Bell className="h-4 w-4" />,
  "F. Problems & Recommendations": <ListTodo className="h-4 w-4" />,
  "G. Narrative & Disposition": <FileText className="h-4 w-4" />,
  "H. Provenance":         <Info className="h-4 w-4" />,
  "Wildland Data":         <Flame className="h-4 w-4" />,
};

// ─── Accent colors for stat tiles ─────────────────────────────────────────────
const STAT_COLORS = {
  maroon:  "text-red-700 bg-red-50 border-red-100",
  blue:    "text-blue-700 bg-blue-50 border-blue-100",
  green:   "text-green-700 bg-green-50 border-green-100",
  orange:  "text-orange-700 bg-orange-50 border-orange-100",
  purple:  "text-purple-700 bg-purple-50 border-purple-100",
};

// ─── KPI Stat Tile ─────────────────────────────────────────────────────────────
interface StatTileProps {
  label: string;
  value: string;
  icon: ReactNode;
  accent?: keyof typeof STAT_COLORS;
  tooltip?: string;
}

function StatTile({ label, value, icon, accent = "blue", tooltip }: StatTileProps) {
  return (
    <div
      className={`relative flex items-center gap-3 rounded-xl border px-4 py-3.5 shadow-sm transition-shadow hover:shadow-md ${STAT_COLORS[accent]}`}
      title={tooltip}
      role="region"
      aria-label={`${label}: ${value}`}
    >
      <div className="flex-shrink-0 opacity-80">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium uppercase tracking-wider opacity-70">{label}</p>
        <p className="truncate text-lg font-bold leading-tight">{value}</p>
      </div>
    </div>
  );
}

// ─── Collapsible Section ──────────────────────────────────────────────────────
interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: string;
  locked?: boolean;
  icon?: ReactNode;
  description?: string;
}

function CollapsibleSection({
  title, children, defaultOpen = false, badge, locked = false, icon, description,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => !locked && setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`section-${title.replace(/\s+/g, "-").toLowerCase()}`}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-60"
      >
        {icon && (
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="flex-1">
          <span className="block text-sm font-semibold text-gray-800">{title}</span>
          {description && <span className="mt-0.5 block text-xs text-gray-500">{description}</span>}
        </span>
        {badge && (
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600" aria-label={`Badge: ${badge}`}>
            {badge}
          </span>
        )}
        {locked
          ? <Lock className="h-4 w-4 flex-shrink-0 text-gray-400" aria-label="Locked" />
          : open
            ? <ChevronDown className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden="true" />
            : <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden="true" />
        }
      </button>
      {open && !locked && (
        <div
          id={`section-${title.replace(/\s+/g, "-").toLowerCase()}`}
          className="border-t border-gray-100 px-5 py-5"
          role="region"
          aria-label={title}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Field Row (HCI: clear label-value gestalt, null-safe) ─────────────────────
interface FieldRowProps {
  label: string;
  value: unknown;
  twocol?: boolean;
  highlight?: boolean;
}

function FieldRow({ label, value, twocol = false, highlight = false }: FieldRowProps) {
  const display = value == null || value === "" ? null : String(value);
  return (
    <div className={`grid gap-2 border-b border-gray-100 py-3 text-sm last:border-0 ${twocol ? "grid-cols-2" : "grid-cols-1 md:grid-cols-3 md:gap-6"}`}>
      <dt className="font-medium text-gray-500">{label}</dt>
      <dd className={`break-words font-medium ${twocol ? "" : "md:col-span-2"} ${highlight ? "text-red-700" : "text-gray-900"}`}>
        {display ?? <span className="text-gray-400 italic">Not recorded</span>}
      </dd>
    </div>
  );
}

// ─── Blurred Row (HCI: obvious affordance + reveal affordance) ─────────────────
interface BlurredRowProps {
  label: string;
  fieldKey: string;
  value: string | null;
  revealed: Set<string>;
  onReveal: (key: string) => void;
}

function BlurredRow({ label, fieldKey, value, revealed, onReveal }: BlurredRowProps) {
  const isRevealed = revealed.has(fieldKey);
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-gray-100 py-3 text-sm last:border-0 md:grid-cols-3 md:gap-4">
      <dt className="font-medium text-gray-500">{label}</dt>
      <dd className="flex items-center gap-2 md:col-span-2">
        {!value || value === ""
          ? <span className="text-gray-400 italic">Not recorded</span>
          : isRevealed
            ? <span className="text-gray-900">{value}</span>
            : (
              <span className="group flex items-center gap-2">
                <span className="blur-sm contrast-75 select-none" aria-hidden="true">{value}</span>
                <button
                  type="button"
                  onClick={() => onReveal(fieldKey)}
                  aria-label={`Reveal ${label}`}
                  className="rounded-md border border-gray-200 bg-white p-1.5 text-gray-500 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
              </span>
            )
        }
      </dd>
    </div>
  );
}

// ─── Alarm Timeline Table ─────────────────────────────────────────────────────
interface AlarmTimelineTableProps {
  rows: Array<{ alarm_level: string; time: string; commander: string }>;
  revealed: Set<string>;
  timelineKey: string;
}

function AlarmTimelineTable({ rows, revealed, timelineKey }: AlarmTimelineTableProps) {
  const isRevealed = revealed.has(timelineKey);
  return (
    <div className="overflow-x-auto" role="region" aria-label="Fire alarm timeline">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="pb-3 pr-4 font-medium">#</th>
            <th className="pb-3 pr-4 font-medium">Alarm Level</th>
            <th className="pb-3 pr-4 font-medium">Time</th>
            <th className="pb-3 font-medium">Commander</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
              <td className="py-3 pr-4 text-gray-400">{i + 1}</td>
              <td className="py-3 pr-4">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />
                  {row.alarm_level}
                </span>
              </td>
              <td className="py-3 pr-4 text-gray-900">
                {isRevealed ? row.time : <span className="blur-sm contrast-75 select-none" aria-hidden="true">{row.time}</span>}
              </td>
              <td className="py-3 text-gray-700">
                {isRevealed ? row.commander ?? "—" : <span className="blur-sm contrast-75 select-none" aria-hidden="true">{row.commander ?? "—"}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Alarm Progression Visual (HCI: spatial encoding for timeline at a glance) ─
interface AlarmVisualProps {
  timeline: Array<{ alarm_level: string; time: string; commander: string }>;
}

function AlarmVisual({ timeline }: AlarmVisualProps) {
  if (!timeline?.length) return null;
  return (
    <nav aria-label="Alarm progression" className="mb-5 flex items-center gap-1 overflow-x-auto pb-2">
      {timeline.map((row, i) => (
        <div key={i} className="flex items-center">
          <div className="flex flex-col items-center" aria-label={`Alarm ${i + 1}: ${row.alarm_level}`}>
            <div
              className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-red-100 to-red-200 shadow-sm ring-2 ring-red-300"
              aria-hidden="true"
            >
              <span className="text-sm font-bold text-red-700">{i + 1}</span>
            </div>
            <span className="mt-1.5 whitespace-nowrap text-xs font-semibold text-red-600">{row.alarm_level}</span>
            <span className="text-xs text-gray-400">
              {row.time ? new Date(row.time).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }) : "—"}
            </span>
          </div>
          {i < timeline.length - 1 && (
            <div className="mx-1 h-0.5 w-8 rounded-full bg-gray-200" aria-hidden="true" />
          )}
        </div>
      ))}
    </nav>
  );
}

// ─── Quick Stats Bar (HCI: summary-first, scannable KPIs) ───────────────────────
interface QuickStatsProps { detail: AnalystIncidentDetailResponse; }

function QuickStats({ detail }: QuickStatsProps) {
  return (
    <section aria-label="Incident summary KPIs" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile label="Response Time"   value={formatMinutes(detail.total_response_time_minutes)} icon={<Clock className="h-5 w-5" />}         accent="blue"   tooltip="Time from notification to first unit on scene" />
      <StatTile label="Est. Damage"     value={formatMoney(detail.estimated_damage_php)}         icon={<AlertTriangle className="h-5 w-5" />}    accent="orange" tooltip="Estimated property damage in PHP" />
      <StatTile label="Structures Hit"  value={detail.structures_affected != null ? String(detail.structures_affected) : "—"} icon={<Activity className="h-5 w-5" />} accent="maroon" tooltip="Number of structures affected" />
      <StatTile label="Families Hit"    value={detail.families_affected != null ? String(detail.families_affected) : "—"}   icon={<Users className="h-5 w-5" />}       accent="green"  tooltip="Number of families affected" />
    </section>
  );
}

// ─── Empty State (HCI: consistent no-data messaging) ────────────────────────────
function EmptyState({ icon: Icon, message }: { icon: ReactNode; message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-gray-50 px-4 py-4 text-sm text-gray-500" role="status">
      <Icon className="h-4 w-4 flex-shrink-0 opacity-60" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

// ─── Wildland Section ──────────────────────────────────────────────────────────
interface WildlandSectionProps { detail: AnalystIncidentDetailResponse; }

function WildlandSection({ detail }: WildlandSectionProps) {
  const isWildland = detail.form_kind === "WILDLAND_AFOR";
  return (
    <CollapsibleSection
      title="Wildland Data"
      icon={<Flame className="h-4 w-4" />}
      locked={!isWildland}
      badge={isWildland ? "AFOR" : undefined}
      description={isWildland ? "Wildland fire incident data" : "Only available for WILDLAND_AFOR incidents"}
    >
      {isWildland && detail.wildland ? (
        <div className="space-y-4">
          {Object.entries(detail.wildland).map(([key, val]) => (
            <FieldRow
              key={key}
              label={key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              value={val}
              twocol
            />
          ))}
          {detail.alarm_statuses?.length ? (
            <div className="mt-6">
              <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <Bell className="h-3.5 w-3.5" aria-hidden="true" /> Alarm Statuses
              </h4>
              <table className="min-w-full text-sm" aria-label="Alarm statuses table">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="pb-3 pr-4 font-medium">#</th>
                    <th className="pb-3 pr-4 font-medium">Alarm Status</th>
                    <th className="pb-3 pr-4 font-medium">Time Declared</th>
                    <th className="pb-3 font-medium">Ground Commander</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.alarm_statuses.map((row) => (
                    <tr key={row.sort_order} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="py-3 pr-4 text-gray-400">{row.sort_order}</td>
                      <td className="py-3 pr-4 text-gray-900">{row.alarm_status}</td>
                      <td className="py-3 pr-4 text-gray-700">{row.time_declared ?? "—"}</td>
                      <td className="py-3 text-gray-700">{row.ground_commander ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {detail.assistance_rows?.length ? (
            <div className="mt-6">
              <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <Users className="h-3.5 w-3.5" aria-hidden="true" /> Mutual Aid / Assistance
              </h4>
              <table className="min-w-full text-sm" aria-label="Mutual aid table">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="pb-3 pr-4 font-medium">#</th>
                    <th className="pb-3 pr-4 font-medium">Organization / Unit</th>
                    <th className="pb-3 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.assistance_rows.map((row) => (
                    <tr key={row.sort_order} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="py-3 pr-4 text-gray-400">{row.sort_order}</td>
                      <td className="py-3 pr-4 text-gray-900">{row.organization_or_unit}</td>
                      <td className="py-3 text-gray-700">{row.detail ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState icon={Info} message="Wildland data not applicable for structural incidents." />
      )}
    </CollapsibleSection>
  );
}

// ─── Sensitive Data Section (HCI: progressive disclosure, audit affordance) ─────
interface SensitiveSectionProps { incidentId: number; }

function SensitiveSection({ incidentId }: SensitiveSectionProps) {
  const [sensitiveData, setSensitiveData] = useState<AnalystIncidentSensitiveResponse | null>(null);
  const [sensitiveLoading, setSensitiveLoading] = useState(false);
  const [sensitiveError, setSensitiveError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const loadSensitive = useCallback(async () => {
    setSensitiveLoading(true); setSensitiveError(null);
    try {
      const data = await fetchAnalystIncidentSensitive(incidentId);
      setSensitiveData(data);
    } catch (e) {
      setSensitiveError(e instanceof Error ? e.message : "Failed to load protected information.");
    } finally { setSensitiveLoading(false); }
  }, [incidentId]);

  const reveal = useCallback((key: string) => {
    setRevealed((prev) => new Set([...prev, key]));
  }, []);

  if (!sensitiveData && !sensitiveLoading) {
    return (
      <div className="overflow-hidden rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50 shadow-sm" role="region" aria-label="Protected information">
        <div className="flex flex-col items-center justify-center px-6 py-9 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 shadow-sm" aria-hidden="true">
            <ShieldAlert className="h-8 w-8 text-amber-600" />
          </div>
          <p className="mb-1.5 text-sm font-semibold text-amber-900">Protected Information</p>
          <p className="mb-5 max-w-sm text-xs text-amber-700">
            This section contains sensitive personal and incident data.
            Access is logged and monitored for compliance.
          </p>
          <button
            type="button"
            onClick={() => void loadSensitive()}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-5 py-2.5 text-sm font-semibold text-amber-900 shadow-sm transition-colors hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            <Shield className="h-4 w-4" aria-hidden="true" />
            Access Protected Data
          </button>
          {sensitiveError && <p className="mt-3 text-xs text-red-600" role="alert">{sensitiveError}</p>}
        </div>
      </div>
    );
  }

  if (sensitiveLoading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-4 py-10 shadow-sm" role="status" aria-live="polite">
        <RefreshCw className="h-5 w-5 animate-spin text-amber-600" aria-hidden="true" />
        <span className="ml-3 text-sm font-medium text-amber-700">Loading protected data...</span>
      </div>
    );
  }

  if (!sensitiveData) return null;

  const revealedCount = revealed.size;

  return (
    <div className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm" role="region" aria-label="Protected information — accessed">
      {/* Header bar */}
      <div className="border-b border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100" aria-hidden="true">
              <Shield className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <span className="text-sm font-semibold text-amber-900">Protected Information</span>
              {revealedCount > 0 && (
                <span className="ml-2 text-xs text-amber-600" aria-live="polite">
                  {revealedCount} field{revealedCount !== 1 ? "s" : ""} revealed
                </span>
              )}
            </div>
          </div>
          {revealedCount > 0 && (
            <button
              type="button"
              onClick={() => setRevealed(new Set())}
              aria-label="Hide all revealed fields"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              Hide All
            </button>
          )}
        </div>
      </div>

      {/* Field list */}
      <dl className="px-5 py-1">
        {([
          ["caller_name", "Caller Name"],
          ["caller_number", "Caller Number"],
          ["owner_name", "Owner Name"],
          ["establishment_name", "Establishment Name"],
          ["occupant_name", "Occupant Name"],
          ["fire_origin", "Fire Origin"],
          ["extent_of_damage", "Extent of Damage"],
          ["prepared_by_officer", "Prepared By Officer"],
          ["noted_by_officer", "Noted By Officer"],
          ["disposition", "Disposition"],
          ["narrative_report", "Narrative Report"],
        ] as const).map(([fieldKey, label]) => (
          <BlurredRow
            key={fieldKey}
            label={label}
            fieldKey={fieldKey}
            value={sensitiveData[fieldKey]}
            revealed={revealed}
            onReveal={reveal}
          />
        ))}
      </dl>

      {/* Alarm timeline in sensitive section */}
      {sensitiveData.alarm_timeline?.length ? (
        <div className="border-t border-gray-100 px-5 py-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <Bell className="h-3.5 w-3.5" aria-hidden="true" />
              Alarm Timeline
            </span>
            <button
              type="button"
              onClick={() => reveal("alarm_timeline")}
              disabled={revealed.has("alarm_timeline")}
              aria-label={revealed.has("alarm_timeline") ? "Alarm timeline revealed" : "Reveal alarm timeline"}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              {revealed.has("alarm_timeline") ? "Revealed" : "Reveal Timeline"}
            </button>
          </div>
          <AlarmTimelineTable rows={sensitiveData.alarm_timeline} revealed={revealed} timelineKey="alarm_timeline" />
        </div>
      ) : null}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AnalystIncidentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const rawId = params?.id as string | undefined;
  const incidentId = rawId != null ? parseInt(rawId, 10) : NaN;
  const { user, loading: authLoading } = useAuth();
  const role = (user as { role?: string })?.role ?? null;
  const canAccess = ANALYST_ROLES.includes(role ?? "");

  const [detail, setDetail] = useState<AnalystIncidentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportTask, setExportTask] = useState<{ taskId: string; format: "csv" | "pdf" } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState<"csv" | "pdf" | "download" | null>(null);

  useEffect(() => {
    if (!authLoading && role && !canAccess) router.replace("/dashboard");
  }, [authLoading, canAccess, role, router]);

  const load = useCallback(async () => {
    if (Number.isNaN(incidentId)) { setError("Invalid incident id."); setLoading(false); return; }
    setLoading(true); setError(null);
    try { setDetail(await fetchAnalystIncidentDetail(incidentId)); }
    catch (e) { setDetail(null); setError(e instanceof Error ? e.message : "Failed to load incident."); }
    finally { setLoading(false); }
  }, [incidentId]);

  useEffect(() => {
    if (authLoading || !canAccess) return;
    void load();
  }, [authLoading, canAccess, load]);

  const queueExport = async (format: "csv" | "pdf") => {
    setExportError(null); setExportLoading(format);
    try {
      const response = await queueAnalyticsExport({ format, filters: { incident_id: incidentId }, columns: DETAIL_EXPORT_COLUMNS });
      setExportTask({ taskId: response.task_id, format });
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Failed to queue export.");
    } finally { setExportLoading(null); }
  };

  const downloadQueuedExport = async () => {
    if (!exportTask) return;
    setExportError(null); setExportLoading("download");
    try {
      const blob = await downloadAnalyticsExport(exportTask.taskId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `incident-${incidentId}.${exportTask.format}`;
      anchor.click(); URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export is not ready yet.");
    } finally { setExportLoading(null); }
  };

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400" aria-hidden="true" />
        <span className="ml-3 text-sm text-gray-500">Loading incident data...</span>
      </div>
    );
  }

  if (role && !canAccess) return <div className="text-sm text-gray-500">Redirecting...</div>;

  if (error || !detail) {
    return (
      <div className="space-y-4" role="alert">
        <Link href="/dashboard/analyst" className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to analyst dashboard
        </Link>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || "Incident not found."}
        </div>
      </div>
    );
  }

  const isWildland = detail.form_kind === "WILDLAND_AFOR";

  return (
    <main className="space-y-5" aria-label="Incident Detail">
      {/* ── Page Header ─────────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <Link
              href="/dashboard/analyst"
              className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-800"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to analyst dashboard
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2.5">
              <h1 className="font-mono text-2xl font-bold tracking-tight text-gray-900">
                {detail.reference_number || `Incident #${detail.incident_id}`}
              </h1>

              {/* Status badge — HCI: clear affordance with dot indicator */}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                {detail.verification_status}
              </span>

              {/* Type badge */}
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${isWildland ? "bg-orange-50 text-orange-700 ring-1 ring-orange-200" : "bg-blue-50 text-blue-700 ring-1 ring-blue-200"}`}>
                {isWildland
                  ? <><Flame className="h-3 w-3" aria-hidden="true" /> Wildland</>
                  : <><Activity className="h-3 w-3" aria-hidden="true" /> Structural</>
                }
              </span>

              {/* Alarm level */}
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
                Alarm {detail.alarm_level}
              </span>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-500">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <span>{detail.municipality_name}, {detail.province_name} · {detail.region}</span>
            </p>
          </div>

          {/* Export actions */}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Export actions">
            <button
              type="button"
              onClick={() => void queueExport("pdf")}
              disabled={exportLoading !== null}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-90 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{ backgroundColor: "var(--bfp-maroon)",  }}
              aria-disabled={exportLoading !== null}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Export PDF
            </button>
            <button
              type="button"
              onClick={() => void queueExport("csv")}
              disabled={exportLoading !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              aria-disabled={exportLoading !== null}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Export CSV
            </button>
          </div>
        </div>

        {/* KPI Stats */}
        <QuickStats detail={detail} />

        {/* Export status */}
        {(exportTask || exportError) && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${exportError ? "border-red-200 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-800"}`}
            role={exportError ? "alert" : "status"}
            aria-live="polite"
          >
            {exportError ? (
              exportError
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-center gap-2">
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  Export queued: <code className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-xs">{exportTask?.taskId}</code>
                </span>
                <button
                  type="button"
                  onClick={() => void downloadQueuedExport()}
                  disabled={exportLoading !== null}
                  className="rounded-lg bg-blue-700 px-4 py-1.5 font-semibold text-white transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                >
                  {exportLoading === "download"
                    ? <span className="flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> Downloading...</span>
                    : <span className="flex items-center gap-2"><Download className="h-4 w-4" aria-hidden="true" /> Download</span>
                  }
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Detail Sections ────────────────────────────────────────────────────── */}
      <CollapsibleSection
        title="A. Response Details"
        icon={SECTION_ICONS["A. Response Details"]}
        description="Incident notification, location, and responder information"
        defaultOpen
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
          <FieldRow label="Notification Date/Time" value={formatDateTime(detail.notification_dt)} twocol />
          <FieldRow label="Region"    value={detail.region} twocol />
          <FieldRow label="Province" value={detail.province_name} twocol />
          <FieldRow label="Municipality" value={detail.municipality_name} twocol />
          <FieldRow label="Barangay" value={detail.barangay_name} twocol />
          <FieldRow label="Responder Type" value={detail.responder_type} twocol />
          <FieldRow label="Fire Station Name" value={detail.fire_station_name} twocol />
          <FieldRow label="Distance from Station" value={detail.distance_from_station_km != null ? `${detail.distance_from_station_km} km` : "—"} twocol />
          <FieldRow label="Alarm Level" value={detail.alarm_level} twocol />
          <FieldRow label="Total Response Time" value={formatMinutes(detail.total_response_time_minutes)} twocol highlight />
        </dl>
      </CollapsibleSection>

      <CollapsibleSection
        title="B. Classification"
        icon={SECTION_ICONS["B. Classification"]}
        description="Fire type, origin, and extent classification"
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
          <FieldRow label="General Category" value={detail.general_category} twocol />
          <FieldRow label="Sub Category" value={detail.sub_category} twocol />
          <FieldRow label="Fire Origin" value={detail.fire_origin} twocol />
          <FieldRow label="Extent of Damage" value={detail.extent_of_damage} twocol />
          <FieldRow label="Stage of Fire" value={detail.stage_of_fire} twocol />
          <FieldRow label="Total Floor Area" value={detail.extent_total_floor_area_sqm != null ? `${detail.extent_total_floor_area_sqm} sqm` : "—"} twocol />
          <FieldRow label="Total Land Area" value={detail.extent_total_land_area_hectares != null ? `${detail.extent_total_land_area_hectares} ha` : "—"} twocol />
        </dl>
      </CollapsibleSection>

      <CollapsibleSection
        title="C. Impact & Casualties"
        icon={SECTION_ICONS["C. Impact & Casualties"]}
        description="Humanitarian and structural impact assessment"
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
          <FieldRow label="Estimated Damage (PHP)" value={formatMoney(detail.estimated_damage_php)} twocol highlight />
          <FieldRow label="Casualty Severity" value={detail.casualty_severity ?? "—"} twocol />
          <FieldRow label="Structures Affected" value={detail.structures_affected ?? "—"} twocol />
          <FieldRow label="Households Affected" value={detail.households_affected ?? "—"} twocol />
          <FieldRow label="Families Affected" value={detail.families_affected ?? "—"} twocol />
          <FieldRow label="Individuals Affected" value={detail.individuals_affected ?? "—"} twocol />
          <FieldRow label="Vehicles Affected" value={detail.vehicles_affected ?? "—"} twocol />
          <FieldRow label="Water Tankers Used" value={detail.water_tankers_used ?? "—"} twocol />
          <FieldRow label="Breathing Apparatus Used" value={detail.breathing_apparatus_used ?? "—"} twocol />
          <FieldRow label="Total Gas Consumed" value={detail.total_gas_consumed_liters != null ? `${detail.total_gas_consumed_liters} L` : "—"} twocol />
        </dl>
      </CollapsibleSection>

      <CollapsibleSection
        title="D. Assets & Resources"
        icon={SECTION_ICONS["D. Assets & Resources"]}
        description="Equipment and personnel deployed"
      >
        {detail.resources_deployed && Object.keys(detail.resources_deployed).length > 0 ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
            {Object.entries(detail.resources_deployed).map(([key, val]) => (
              <FieldRow
                key={key}
                label={key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                value={val ?? "—"}
                twocol
              />
            ))}
          </dl>
        ) : (
          <EmptyState icon={Info} message="No resource deployment data recorded." />
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="E. Fire Alarm Timeline"
        icon={SECTION_ICONS["E. Fire Alarm Timeline"]}
        description="Progressive alarm levels and incident commander assignments"
      >
        {detail.alarm_timeline && detail.alarm_timeline.length > 0 ? (
          <>
            <AlarmVisual timeline={detail.alarm_timeline} />
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm" aria-label="Fire alarm timeline">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="pb-3 pr-4 font-medium">#</th>
                    <th className="pb-3 pr-4 font-medium">Alarm Level</th>
                    <th className="pb-3 pr-4 font-medium">Time</th>
                    <th className="pb-3 font-medium">Commander</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.alarm_timeline.map((row, i) => (
                    <tr key={i} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="py-3 pr-4 text-gray-400">{i + 1}</td>
                      <td className="py-3 pr-4">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />
                          {row.alarm_level}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-gray-900">{formatDateTime(row.time)}</td>
                      <td className="py-3 text-gray-700">{row.commander ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState icon={Bell} message="No alarm timeline recorded." />
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="F. Problems & Recommendations"
        icon={SECTION_ICONS["F. Problems & Recommendations"]}
        description="Operational issues encountered during response"
      >
        {detail.problems_encountered && detail.problems_encountered.length > 0 ? (
          <ul className="space-y-2.5" aria-label="Problems encountered">
            {detail.problems_encountered.map((p, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-gray-700"
              >
                <span
                  className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-800"
                  aria-label={`Problem ${i + 1}`}
                >
                  {i + 1}
                </span>
                <span className="flex-1 leading-relaxed">{p}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Info} message="No problems reported." />
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="G. Narrative & Disposition"
        icon={SECTION_ICONS["G. Narrative & Disposition"]}
        description="Formal incident narrative — protected under data privacy"
      >
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="note">
          <Shield className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>Narrative and disposition are protected. Scroll down to the Protected Information section to access them.</span>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
          <FieldRow label="Prepared By Officer" value="[Protected — see below]" twocol />
          <FieldRow label="Noted By Officer" value="[Protected — see below]" twocol />
          <FieldRow label="Disposition" value="[Protected — see below]" twocol />
        </dl>
      </CollapsibleSection>

      <CollapsibleSection
        title="H. Provenance"
        icon={SECTION_ICONS["H. Provenance"]}
        description="Record origin, encoder identity, and sync status"
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
          <FieldRow label="Reference Number" value={detail.reference_number ?? "—"} twocol />
          <FieldRow label="Encoder Username" value={detail.encoder_username ?? "—"} twocol />
          <FieldRow label="Created At" value={formatDateTime(detail.created_at)} twocol />
          <FieldRow label="Data Hash" value={detail.data_hash ?? "—"} twocol />
          <FieldRow label="Analytics Sync Status" value={detail.sync_status ?? "—"} twocol />
        </dl>
      </CollapsibleSection>

      {/* Wildland conditional */}
      <WildlandSection detail={detail} />

      {/* Protected data */}
      <SensitiveSection incidentId={incidentId} />
    </main>
  );
}
