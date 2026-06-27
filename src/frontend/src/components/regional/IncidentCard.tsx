"use client";

import type { MouseEvent } from "react";
import { Archive } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { MetricPill } from "@/components/ui/MetricPill";
import { InfoBlock } from "@/components/ui/InfoBlock";
import { formatIncidentDate, statusBorderColor } from "@/lib/incident-utils";
import { formatClassification } from "@/lib/afor-utils";
import type { RegionalIncidentListItem } from "@/lib/api";
import type { RegionalIncidentOfflineStatus } from "@/lib/regionalOfflineStatus";

interface Props {
  inc: RegionalIncidentListItem;
  isArchiveView: boolean;
  onCardClick: (incidentId: number) => void;
  onHoverStart: (incidentId: number, e: MouseEvent<HTMLElement>) => void;
  onHoverMove: () => void;
  onHoverEnd: () => void;
  onArchive: (incidentId: number, e: React.MouseEvent) => void;
  onUnarchive: (incidentId: number, e: React.MouseEvent) => void;
  isDetailCached?: boolean;
  isOnline?: boolean;
  offlineStatus?: RegionalIncidentOfflineStatus;
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  conflict: { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300' },
  failed: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' },
  pending: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
};

function OfflineSyncBadges({ status }: { status: RegionalIncidentOfflineStatus }) {
  const style = SEVERITY_STYLES[status.severity] ?? SEVERITY_STYLES.pending;
  const summary = status.labels.slice(0, 2).join(', ');

  return (
    <>
      {status.labels.slice(0, 2).map((label) => (
        <span
          key={label}
          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${style.bg} ${style.text} ${style.border}`}
          aria-label={`Offline status: ${label}`}
        >
          {label}
        </span>
      ))}
      {status.labels.length > 2 && (
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${style.bg} ${style.text} ${style.border}`}
          aria-label={`Offline status: ${status.labels.length - 2} more pending operations including ${summary}`}
        >
          +{status.labels.length - 2} more
        </span>
      )}
    </>
  );
}

function completeAddress(incident: RegionalIncidentListItem): string {
  return incident.street_address || '-';
}

export function IncidentCard({
  inc,
  isArchiveView,
  onCardClick,
  onHoverStart,
  onHoverMove,
  onHoverEnd,
  onArchive,
  onUnarchive,
  isDetailCached,
  isOnline,
  offlineStatus,
}: Props) {
  const offlineUncached = isOnline === false && isDetailCached === false;

  // Disable archive button when an archive_action is already queued for this incident
  const hasQueuedArchive = offlineStatus?.operations.some(
    (op) => op.operation === 'archive_action',
  );
  const archiveButtonLabel = hasQueuedArchive
    ? (isArchiveView ? 'Restore queued' : 'Archive queued')
    : (isArchiveView ? 'Unarchive' : 'Archive');

  return (
    <article
      onClick={() => {
        if (offlineUncached) return;
        onCardClick(inc.incident_id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (offlineUncached) return;
          onCardClick(inc.incident_id);
        }
      }}
      tabIndex={offlineUncached ? -1 : 0}
      role={offlineUncached ? 'article' : 'link'}
      aria-disabled={offlineUncached || undefined}
      aria-label={`View incident ${inc.incident_id}`}
      onMouseEnter={(e) => { if (!offlineUncached) onHoverStart(inc.incident_id, e); }}
      onMouseMove={() => { if (!offlineUncached) onHoverMove(); }}
      onMouseLeave={() => { if (!offlineUncached) onHoverEnd(); }}
      className={
        offlineUncached
          ? 'cursor-not-allowed rounded-xl border border-gray-200 bg-white p-5 shadow-sm opacity-60 outline-none'
          : 'cursor-pointer rounded-xl border border-gray-200 bg-white p-5 shadow-sm outline-none transition-all hover:border-red-200 hover:bg-red-50/30 hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#1A3263]'
      }
      style={{ borderColor: offlineUncached ? undefined : statusBorderColor(inc.verification_status) }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          Last modified <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{formatIncidentDate(inc.updated_at)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {inc.is_wildland && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              Wildland
            </span>
          )}
          <StatusBadge status={inc.verification_status} />
          {offlineStatus && <OfflineSyncBadges status={offlineStatus} />}
          {offlineUncached && (
            <span className="rounded-full bg-gray-100 border border-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-500" aria-label="This incident is not available offline">
              Go online to view
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <InfoBlock
            label="Date/Time of Fire"
            value={formatIncidentDate(inc.notification_dt || inc.created_at)}
            tone="primary"
          />
          <div className="mt-3">
            <InfoBlock label="Location" value={completeAddress(inc)} tone="primary" />
          </div>
        </div>

        <div className="grid gap-x-6 gap-y-3 border-t border-gray-100 pt-4 text-sm sm:grid-cols-2">
          <InfoBlock label="Classification" value={formatClassification(inc.general_category)} />
          <InfoBlock label="Category / Type" value={inc.sub_category || inc.alarm_level} />
          <InfoBlock label="District" value={inc.province_district} />
          <InfoBlock label="City" value={inc.city_municipality} />
        </div>

        <div className="grid gap-x-6 gap-y-3 border-t border-gray-100 pt-4 text-sm sm:grid-cols-2">
          <InfoBlock label="Responder Type" value={inc.responder_type} />
          <InfoBlock label="Fire Station" value={inc.fire_station_name} />
          <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Caller / Contact</div>
              <div className="mt-0.5 text-sm font-medium break-words leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                {[inc.caller_name, inc.caller_number].filter(Boolean).join(' / ')}
              </div>
            </div>
          <InfoBlock label="Extent of Damage" value={inc.extent_of_damage} />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <MetricPill label="Structures" value={inc.structures_affected} />
        <MetricPill label="Households" value={inc.households_affected} />
        <MetricPill label="Families" value={inc.families_affected} />
        <MetricPill label="Individuals" value={inc.individuals_affected} />
        <MetricPill label="Vehicles" value={inc.vehicles_affected} />
      </div>

      {inc.verification_status === 'VERIFIED' && (
        <div className="mt-4 flex justify-end border-t border-gray-100 pt-3">
          <button
            type="button"
            disabled={hasQueuedArchive}
            onClick={(e) => hasQueuedArchive ? undefined : isArchiveView ? onUnarchive(inc.incident_id, e) : onArchive(inc.incident_id, e)}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors min-h-[44px] ${
              hasQueuedArchive
                ? 'cursor-not-allowed border-amber-200 bg-amber-50 text-amber-600'
                : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
            style={{ color: hasQueuedArchive ? undefined : 'var(--text-secondary)' }}
            title={
              hasQueuedArchive
                ? `An archive ${isArchiveView ? 'restore' : 'action'} is already queued â€” it will sync when back online`
                : isArchiveView ? 'Restore this incident to the active list' : 'Archive this verified incident'
            }
          >
            <Archive className="h-3.5 w-3.5" aria-hidden />
            {archiveButtonLabel}
          </button>
        </div>
      )}
    </article>
  );
}

