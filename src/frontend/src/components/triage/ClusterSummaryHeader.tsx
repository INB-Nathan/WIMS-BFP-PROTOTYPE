'use client';

import { AlertTriangle, Clock, Flame, MapPin, Phone, Shield, Users, X } from 'lucide-react';
import type { TriageClusterEntry } from '@/lib/api';
import { formatTrustPercent } from '@/lib/trustColors';
import { useEffect, useState } from 'react';

export interface ClusterSummaryHeaderProps {
  cluster: TriageClusterEntry;
  inspectionMode: 'cluster' | 'singleton';
  onClose: () => void;
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Sticky top header for the triage inspection modal.
 * - Cluster / singleton breadcrumb
 * - Severity, life-safety, timeout risk, danger badges
 * - Member count, average trust, station, age
 * - Esc shortcut hint
 */
export function ClusterSummaryHeader({ cluster, inspectionMode, onClose }: ClusterSummaryHeaderProps) {
  // Tick once per 30s so the relative-age label stays fresh while modal is open.
  const now = useNow(30_000);
  const ageIso = cluster.oldest_report_at;
  const isCluster = inspectionMode === 'cluster' && cluster.cluster_id !== null;
  const titleText = isCluster ? `Cluster ${cluster.cluster_id}` : 'Singleton report';
  const typeLabel = isCluster ? 'CLUSTER' : 'SINGLETON';
  const stationName = cluster.station.name ?? 'Station unknown';
  const ageText = formatAge(ageIso);
  // Reference `now` so the relative age recomputes on every tick.
  void now;

  return (
    <header className="triage-modal-header">
      <div className="triage-modal-header__crumb">
        <span className="triage-modal-header__crumb-tag">TRIAGE</span>
        <span className="triage-modal-header__crumb-sep">/</span>
        <span className="triage-modal-header__crumb-tag triage-modal-header__crumb-tag--accent">QUEUE</span>
        <span className="triage-modal-header__crumb-sep">/</span>
        <span className="triage-modal-header__crumb-current">{typeLabel}</span>
      </div>

      <div className="triage-modal-header__row">
        <div className="triage-modal-header__title-block">
          <h2 id="triage-modal-title" className="triage-modal-header__title">
            {titleText}
          </h2>
          <p className="triage-modal-header__subtitle">
            {isCluster
              ? 'Inspect, split, merge, or apply a terminal action to this cluster.'
              : 'Inspect this single report and apply a terminal action.'}
          </p>
        </div>

        <div className="triage-modal-header__badges">
          <span className={`triage-sev triage-sev--${cluster.severity.toLowerCase()}`}>
            <Flame className="h-3 w-3" />
            {cluster.severity}
          </span>
          {cluster.has_life_safety && (
            <span className="triage-badge triage-badge--life" title="Life safety reported">
              <AlertTriangle className="h-3 w-3" />
              LIFE SAFETY
            </span>
          )}
          {cluster.is_danger && (
            <span className="triage-badge triage-badge--danger">
              <AlertTriangle className="h-3 w-3" />
              2H+ DANGER
            </span>
          )}
          {!cluster.is_danger && cluster.is_timeout_risk && (
            <span className="triage-badge triage-badge--timeout">
              <Clock className="h-3 w-3" />
              TIMEOUT RISK
            </span>
          )}
          {cluster.is_aging && (
            <span className="triage-badge triage-badge--aging">
              <Clock className="h-3 w-3" />
              AGING
            </span>
          )}
        </div>
      </div>

      <div className="triage-modal-header__meta">
        <span className="triage-meta">
          <Users className="h-3.5 w-3.5" />
          <strong>{cluster.member_count}</strong>&nbsp;member{cluster.member_count === 1 ? '' : 's'}
          {cluster.related_count > 0 && (
            <span className="triage-meta__related">+{cluster.related_count} related</span>
          )}
        </span>
        <span className="triage-meta">
          <Shield className="h-3.5 w-3.5" />
          trust&nbsp;<strong>{formatTrustPercent(cluster.avg_trust)}</strong>
        </span>
        <span className="triage-meta">
          <MapPin className="h-3.5 w-3.5" />
          {stationName}
        </span>
        <span className="triage-meta">
          <Phone className="h-3.5 w-3.5" />
          {cluster.station.phone_available ? 'Phone available' : 'No phone listed'}
        </span>
        <span className="triage-meta triage-meta--time" title={new Date(ageIso).toLocaleString()}>
          <Clock className="h-3.5 w-3.5" />
          oldest&nbsp;<strong>{ageText}</strong>
        </span>
        <span className="triage-modal-header__spacer" />
        <span className="triage-modal-header__hint">Esc close</span>
        <button
          type="button"
          aria-label="Close inspection modal"
          onClick={onClose}
          className="triage-modal-header__close"
        >
          <X className="h-4 w-4" />
          Close
        </button>
      </div>
    </header>
  );
}
