'use client';

import { Activity as ActivityIcon, Clock, User as UserIcon } from 'lucide-react';
import type { TriageClusterActivityEntry } from '@/lib/api';

export interface ActivityPanelProps {
  activity: TriageClusterActivityEntry[];
}

/**
 * Right rail: cluster activity timeline.
 * - One event per row, ordered most-recent first.
 * - Shows actor, timestamp, status transition, and note.
 * - Empty state explains the operator what should appear here once the cluster is acted on.
 */
export function ActivityPanel({ activity }: ActivityPanelProps) {
  return (
    <section className="triage-panel" data-testid="triage-panel-activity">
      <header className="triage-panel__head">
        <span className="triage-panel__eyebrow">ACTION 5</span>
        <h3 className="triage-panel__title">Activity timeline</h3>
        <p className="triage-panel__desc">
          Most recent audit events for this cluster, newest first. Actions you take in this
          workspace will appear here.
        </p>
      </header>

      {activity.length === 0 ? (
        <div className="triage-activity-empty">
          <ActivityIcon className="h-5 w-5" />
          <p>No activity events yet for this cluster.</p>
          <p className="triage-activity-empty__hint">
            Once a validator claims, splits, merges, or applies a terminal action, the event
            will appear here.
          </p>
        </div>
      ) : (
        <ol className="triage-activity">
          {activity.map((event, index) => (
            <li key={`${event.event_type}-${event.occurred_at ?? index}`} className="triage-activity__item">
              <span className="triage-activity__dot" aria-hidden="true" />
              <div className="triage-activity__body">
                <div className="triage-activity__type">{event.event_type.replaceAll('_', ' ')}</div>
                <div className="triage-activity__meta">
                  <span className="triage-activity__time">
                    <Clock className="h-3 w-3" />
                    {event.occurred_at ? new Date(event.occurred_at).toLocaleString() : 'Time unavailable'}
                  </span>
                  {event.actor_username && (
                    <span className="triage-activity__actor">
                      <UserIcon className="h-3 w-3" />
                      {event.actor_username}
                    </span>
                  )}
                  {event.report_id && (
                    <span className="triage-activity__report">report #{event.report_id}</span>
                  )}
                </div>
                {event.previous_status && event.new_status && (
                  <div className="triage-activity__transition">
                    <span className="triage-activity__prev">{event.previous_status}</span>
                    <span className="triage-activity__arrow">→</span>
                    <span className="triage-activity__next">{event.new_status}</span>
                  </div>
                )}
                {event.note && <p className="triage-activity__note">{event.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
