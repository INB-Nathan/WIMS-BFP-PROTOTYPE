'use client';

import { Activity, GitMerge, GitPullRequestArrow, RotateCcw, Terminal } from 'lucide-react';
import type { TriageActionTab } from './useTriageModalState';

export interface TriageActionTabsProps {
  tab: TriageActionTab;
  setTab: (tab: TriageActionTab) => void;
  inspectionMode: 'cluster' | 'singleton';
  selectedCount: number;
  totalCount: number;
  correctionReportId: number | null;
  mergeCandidateCount: number;
}

interface TabSpec {
  key: TriageActionTab;
  label: string;
  shortcut: string;
  Icon: typeof Activity;
  clusterOnly?: boolean;
  badge?: (props: TriageActionTabsProps) => string | null;
}

const TABS: TabSpec[] = [
  { key: 'terminal', label: 'Terminal', shortcut: '1', Icon: Terminal },
  { key: 'correct', label: 'Correct', shortcut: '2', Icon: RotateCcw,
    badge: (p) => (p.correctionReportId ? '#' + p.correctionReportId : null) },
  { key: 'split', label: 'Split', shortcut: '3', Icon: GitPullRequestArrow, clusterOnly: true,
    badge: (p) => (p.selectedCount >= 2 ? `${p.selectedCount}` : null) },
  { key: 'merge', label: 'Merge', shortcut: '4', Icon: GitMerge, clusterOnly: true,
    badge: (p) => (p.mergeCandidateCount > 0 ? `${p.mergeCandidateCount}` : null) },
  { key: 'activity', label: 'Activity', shortcut: '5', Icon: Activity },
];

/**
 * Left rail vertical action tabs with single-key shortcuts.
 * - Singleton mode hides Split / Merge tabs.
 * - Active tab is rendered with an accent stripe and bolder type.
 * - Keyboard shortcut hint is rendered next to each label.
 */
export function TriageActionTabs(props: TriageActionTabsProps) {
  const visibleTabs = TABS.filter((t) => !t.clusterOnly || props.inspectionMode === 'cluster');
  return (
    <nav className="triage-tabs" aria-label="Triage actions" data-testid="triage-action-tabs">
      {visibleTabs.map((tab) => {
        const active = props.tab === tab.key;
        const Icon = tab.Icon;
        const badge = tab.badge?.(props) ?? null;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => props.setTab(tab.key)}
            className={`triage-tab ${active ? 'triage-tab--active' : ''}`}
            data-tab={tab.key}
            aria-current={active ? 'true' : undefined}
          >
            <span className="triage-tab__stripe" aria-hidden="true" />
            <Icon className="triage-tab__icon" aria-hidden="true" />
            <span className="triage-tab__label">{tab.label}</span>
            {badge && <span className="triage-tab__badge">{badge}</span>}
            <kbd className="triage-tab__shortcut">{tab.shortcut}</kbd>
          </button>
        );
      })}
    </nav>
  );
}
