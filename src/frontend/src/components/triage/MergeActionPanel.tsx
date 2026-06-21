'use client';

import { ArrowRight, GitMerge, Info, Loader2, MapPin, Users } from 'lucide-react';
import type { MergeCandidateEntry, TriageClusterEntry } from '@/lib/api';

export interface MergeActionPanelProps {
  cluster: TriageClusterEntry;
  mergeCandidates: MergeCandidateEntry[];
  mergeSourceClusterId: string;
  setMergeSourceClusterId: (s: string) => void;
  mergeNote: string;
  setMergeNote: (s: string) => void;
  onPickCandidate: (c: MergeCandidateEntry) => void;
  onApply: () => void;
  busy: boolean;
}

/**
 * Right rail: merge form.
 * - Suggested candidates rendered as visual cards (not text rows).
 * - Source → target diff preview using the cluster's station / trust / member-count.
 * - Cluster-id input is a backup for the candidate cards.
 */
export function MergeActionPanel({
  cluster,
  mergeCandidates,
  mergeSourceClusterId,
  setMergeSourceClusterId,
  mergeNote,
  setMergeNote,
  onPickCandidate,
  onApply,
  busy,
}: MergeActionPanelProps) {
  const sourceId = Number(mergeSourceClusterId);
  const sourceValid = Number.isInteger(sourceId) && sourceId > 0;
  const canApply = !busy && !!cluster.cluster_id && sourceValid && mergeNote.trim().length > 0;
  const activeCandidate = mergeCandidates.find((c) => c.cluster_id === sourceId) ?? null;

  return (
    <section className="triage-panel" data-testid="triage-panel-merge">
      <header className="triage-panel__head">
        <span className="triage-panel__eyebrow">ACTION 4</span>
        <h3 className="triage-panel__title">Merge another cluster into this one</h3>
        <p className="triage-panel__desc">
          Use when a nearby cluster within 250m and 1 hour is actually the same incident. The
          source cluster&apos;s members become part of this cluster.
        </p>
      </header>

      <div className="triage-merge-flow">
        <MergeClusterCard
          tone="source"
          title="Source"
          clusterId={activeCandidate?.cluster_id ?? null}
          subtitle={activeCandidate ? `${activeCandidate.distance_m.toFixed(0)}m away · ${activeCandidate.minutes_apart.toFixed(0)}min ago` : 'Pick a candidate below'}
          meta={activeCandidate ? `${activeCandidate.member_count} members · ${activeCandidate.status}` : null}
          empty={!activeCandidate}
        />
        <ArrowRight className="triage-merge-flow__arrow" />
        <MergeClusterCard
          tone="target"
          title="Target (this cluster)"
          clusterId={cluster.cluster_id}
          subtitle={`${cluster.station.name ?? 'Station unknown'} · trust ${Math.round(cluster.avg_trust * 100)}%`}
          meta={`${cluster.member_count} members · ${cluster.severity}`}
        />
      </div>

      <div className="triage-field">
        <label className="triage-field__label">Suggested candidates (within 250m / 1h)</label>
        {mergeCandidates.length === 0 ? (
          <p className="triage-merge-empty">
            <Info className="h-3.5 w-3.5" /> No nearby clusters found. You can still enter a
            cluster id manually below.
          </p>
        ) : (
          <ul className="triage-candidate-list">
            {mergeCandidates.map((c) => {
              const active = c.cluster_id === sourceId;
              return (
                <li key={c.cluster_id}>
                  <button
                    type="button"
                    onClick={() => onPickCandidate(c)}
                    className={`triage-candidate ${active ? 'triage-candidate--active' : ''}`}
                    data-testid={`triage-candidate-${c.cluster_id}`}
                  >
                    <span className="triage-candidate__head">
                      <GitMerge className="h-3.5 w-3.5" />
                      <span className="triage-candidate__id">Cluster #{c.cluster_id}</span>
                    </span>
                    <span className="triage-candidate__meta">
                      <span><MapPin className="h-3 w-3" /> {c.distance_m.toFixed(0)}m</span>
                      <span><Users className="h-3 w-3" /> {c.member_count}</span>
                      <span className="triage-candidate__status">{c.status}</span>
                    </span>
                    <span className="triage-candidate__time">
                      anchor #{c.anchor_report_id} · {c.minutes_apart.toFixed(0)}min ago
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="triage-field">
        <label className="triage-field__label" htmlFor="triage-merge-source">
          Source cluster id
        </label>
        <input
          id="triage-merge-source"
          value={mergeSourceClusterId}
          onChange={(e) => setMergeSourceClusterId(e.target.value)}
          inputMode="numeric"
          placeholder="Source cluster id"
          className="triage-input"
        />
      </div>

      <div className="triage-field">
        <label className="triage-field__label" htmlFor="triage-merge-note">
          Internal note <span className="triage-field__required">required</span>
        </label>
        <textarea
          id="triage-merge-note"
          value={mergeNote}
          onChange={(e) => setMergeNote(e.target.value)}
          rows={3}
          placeholder="Why is this the same incident?"
          className="triage-textarea triage-textarea--audit"
        />
      </div>

      <details className="triage-why">
        <summary>
          <Info className="h-3.5 w-3.5" />
          What will happen?
        </summary>
        <p>
          The source cluster&apos;s members are appended to this cluster and the source is closed.
          The merge is recorded in the audit log. Pick carefully — merges are not auto-reversible.
        </p>
      </details>

      <button
        type="button"
        disabled={!canApply}
        onClick={onApply}
        className="triage-commit triage-commit--destructive"
        data-testid="triage-commit-merge"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        <span>
          Merge source <strong>#{sourceValid ? sourceId : '—'}</strong> into this cluster
        </span>
        <span className="triage-commit__hint">click to confirm</span>
      </button>
    </section>
  );
}

interface MergeClusterCardProps {
  tone: 'source' | 'target';
  title: string;
  clusterId: number | null;
  subtitle: string;
  meta: string | null;
  empty?: boolean;
}

function MergeClusterCard({ tone, title, clusterId, subtitle, meta, empty }: MergeClusterCardProps) {
  return (
    <div className={`triage-merge-card triage-merge-card--${tone} ${empty ? 'triage-merge-card--empty' : ''}`}>
      <div className="triage-merge-card__label">{title}</div>
      <div className="triage-merge-card__id">
        {clusterId === null ? <span className="triage-merge-card__placeholder">—</span> : `#${clusterId}`}
      </div>
      <div className="triage-merge-card__subtitle">{subtitle}</div>
      {meta && <div className="triage-merge-card__meta">{meta}</div>}
    </div>
  );
}
