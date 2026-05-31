"use client";

import type { MouseEvent } from "react";
import { Archive } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { MetricPill } from "@/components/ui/MetricPill";
import { InfoBlock } from "@/components/ui/InfoBlock";
import { formatIncidentDate, displayValue, statusBorderColor } from "@/lib/incident-utils";
import { formatClassification } from "@/lib/afor-utils";
import type { RegionalIncidentListItem } from "@/lib/api";

interface Props {
  inc: RegionalIncidentListItem;
  isArchiveView: boolean;
  onCardClick: (incidentId: number) => void;
  onHoverStart: (incidentId: number, e: MouseEvent<HTMLElement>) => void;
  onHoverMove: () => void;
  onHoverEnd: () => void;
  onArchive: (incidentId: number, e: React.MouseEvent) => void;
  onUnarchive: (incidentId: number, e: React.MouseEvent) => void;
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
}: Props) {
  return (
    <article
      onClick={() => onCardClick(inc.incident_id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCardClick(inc.incident_id);
        }
      }}
      tabIndex={0}
      role="link"
      aria-label={`View incident ${inc.incident_id}`}
      onMouseEnter={(e) => onHoverStart(inc.incident_id, e)}
      onMouseMove={onHoverMove}
      onMouseLeave={onHoverEnd}
      className="cursor-pointer rounded-xl border border-gray-200 bg-white p-5 shadow-sm outline-none transition-all hover:border-red-200 hover:bg-red-50/30 hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#C62828]"
      style={{ borderColor: statusBorderColor(inc.verification_status) }}
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
          <InfoBlock label="Caller / Contact" value={`${displayValue(inc.caller_name)} / ${displayValue(inc.caller_number)}`} />
          <div className="sm:col-span-2">
            <InfoBlock label="Extent of Damage" value={inc.extent_of_damage} />
          </div>
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
            onClick={(e) => isArchiveView ? onUnarchive(inc.incident_id, e) : onArchive(inc.incident_id, e)}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium transition-colors hover:bg-gray-50"
            style={{ color: 'var(--text-secondary)' }}
            title={isArchiveView ? 'Restore this incident to the active list' : 'Archive this verified incident'}
          >
            <Archive className="h-3.5 w-3.5" aria-hidden />
            {isArchiveView ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      )}
    </article>
  );
}
