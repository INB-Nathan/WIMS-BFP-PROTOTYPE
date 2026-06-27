"use client";

import type { MouseEvent } from "react";
import { Archive } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatIncidentDate } from "@/lib/incident-utils";
import { formatClassification } from "@/lib/afor-utils";
import { getShortRegionName } from "@/lib/ph-regions";
import type { ValidatorIncident } from "./types";

interface Props {
  inc: ValidatorIncident;
  idx: number;
  isArchiveView: boolean;
  selectedIds: Set<number>;
  acceptingId: number | null;
  runtimeDuplicates: Map<number, number>;
  queuedIncidentIds: Set<number>;
  isOnline: boolean;
  onRowClick: (incidentId: number) => void;
  onTogglePending: (inc: ValidatorIncident, checked: boolean) => void;
  onHoverStart: (incidentId: number, e: MouseEvent<HTMLElement>) => void;
  onHoverMove: () => void;
  onHoverEnd: () => void;
  onUnarchive: (inc: ValidatorIncident) => void;
  onDelete: (inc: ValidatorIncident) => void;
  onArchive: (inc: ValidatorIncident) => void;
  onReviewDuplicate: (inc: ValidatorIncident) => void;
  onAccept: (inc: ValidatorIncident) => void;
  onReject: (inc: ValidatorIncident) => void;
}

export function IncidentTableRow({
  inc,
  idx,
  isArchiveView,
  selectedIds,
  acceptingId,
  runtimeDuplicates,
  queuedIncidentIds,
  isOnline,
  onRowClick,
  onTogglePending,
  onHoverStart,
  onHoverMove,
  onHoverEnd,
  onUnarchive,
  onDelete,
  onArchive,
  onReviewDuplicate,
  onAccept,
  onReject,
}: Props) {
  const baseColor = idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA';
  const isQueued = queuedIncidentIds.has(inc.incident_id);

  return (
    <tr
      key={inc.incident_id}
      onClick={() => onRowClick(inc.incident_id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onRowClick(inc.incident_id);
        }
      }}
      tabIndex={0}
      role="link"
      aria-label={`View incident ${inc.incident_id}`}
      className="cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#C62828] focus-visible:ring-inset"
      style={{ backgroundColor: baseColor, borderBottom: '1px solid var(--border-color)' }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bfp-red-light)';
        onHoverStart(inc.incident_id, e);
      }}
      onMouseMove={onHoverMove}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = baseColor;
        onHoverEnd();
      }}
    >
      <td className="px-4 py-4">
        {inc.verification_status === "PENDING" ? (
          <input
            type="checkbox"
            checked={selectedIds.has(inc.incident_id)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onTogglePending(inc, e.target.checked)}
            className="rounded"
          />
        ) : null}
      </td>
      <td className="px-4 py-4 text-sm whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
        {formatIncidentDate(inc.submitted_at ?? inc.created_at)}
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={inc.verification_status} />
          {inc.is_resubmitted && ['PENDING', 'PENDING_VALIDATION'].includes(inc.verification_status) && (
            <span className="inline-flex w-fit max-w-full rounded-full bg-purple-100 px-2 py-0.5 text-xs font-bold leading-none text-purple-800 whitespace-nowrap">
              RESUBMITTED
            </span>
          )}
          {inc.parent_incident_id && (
            <span className="inline-flex w-fit max-w-full rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold leading-none text-amber-800 whitespace-nowrap">
              UPDATE
            </span>
          )}
          {(inc.is_duplicate || runtimeDuplicates.has(inc.incident_id)) && !["VERIFIED", "REJECTED", "REPLACED"].includes(inc.verification_status) && (
            <span className="inline-flex w-fit max-w-full rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold leading-none text-orange-800 whitespace-nowrap">
              DUPLICATE
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
        {getShortRegionName(inc.region_id)}
      </td>
      <td className="px-4 py-4 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        <div className="flex max-w-[260px] items-center gap-2">
          <span className="truncate">{inc.fire_station_name ?? "Unknown station"}</span>
        </div>
      </td>
      <td className="px-4 py-4 text-sm whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
        {formatIncidentDate(inc.notification_dt)}
      </td>
      <td className="px-4 py-4 text-sm" style={{ color: 'var(--text-primary)' }}>
        {formatClassification(inc.general_category)}
      </td>
      <td className="px-4 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
        {inc.alarm_level ?? "—"}
      </td>
      <td className="px-4 py-4 whitespace-nowrap">
        <div className="flex gap-1.5 items-center">
          {isQueued ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-amber-300 px-2.5 py-1 text-xs font-semibold"
              style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
              title="This incident has a pending queued action waiting for sync"
            >
              Queued
            </span>
          ) : isArchiveView ? (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onUnarchive(inc); }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-gray-200 bg-white font-medium transition-colors hover:bg-gray-50"
                style={{ color: 'var(--text-secondary)' }}
                title="Restore this incident to the active queue"
              >
                <Archive className="h-3.5 w-3.5" aria-hidden />
                Unarchive
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(inc); }}
                disabled={!isOnline}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-red-200 bg-white font-medium transition-colors hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ color: '#991B1B' }}
                title={!isOnline ? 'Go online to delete' : 'Permanently delete this archived incident'}
              >
                Delete
              </button>
            </>
          ) : ["VERIFIED", "REPLACED", "REJECTED"].includes(inc.verification_status) ? (
            <button
              onClick={(e) => { e.stopPropagation(); onArchive(inc); }}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-gray-200 bg-white font-medium transition-colors hover:bg-gray-50"
              style={{ color: 'var(--text-secondary)' }}
              title="Archive this incident"
            >
              <Archive className="h-3.5 w-3.5" aria-hidden />
              Archive
            </button>
          ) : (
            <>
              {(inc.is_duplicate || runtimeDuplicates.has(inc.incident_id)) ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onReviewDuplicate(inc); }}
                  disabled={acceptingId === inc.incident_id}
                  className="px-2.5 py-1 text-xs rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: '#9333EA' }}
                  onMouseEnter={(e) => { if (acceptingId !== inc.incident_id) (e.currentTarget as HTMLElement).style.backgroundColor = '#7E22CE'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#9333EA'; }}
                >
                  Review
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); onAccept(inc); }}
                  disabled={acceptingId === inc.incident_id}
                  className="px-2.5 py-1 text-xs rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: '#16A34A' }}
                  onMouseEnter={(e) => { if (acceptingId !== inc.incident_id) (e.currentTarget as HTMLElement).style.backgroundColor = '#15803D'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#16A34A'; }}
                >
                  {acceptingId === inc.incident_id ? "…" : "Accept"}
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onReject(inc); }}
                className="px-2.5 py-1 text-xs rounded-lg font-medium text-white transition-colors"
                style={{ backgroundColor: '#991B1B' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bfp-red-dark)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#991B1B'; }}
              >
                Reject
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
