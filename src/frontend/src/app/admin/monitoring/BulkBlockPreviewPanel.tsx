'use client';

import type { BulkBlockPreviewResult } from '@/types/api';

export type BulkGroupChoice = 'device' | 'ip' | 'skip';

interface BulkBlockPreviewPanelProps {
  preview: BulkBlockPreviewResult;
  groupChoices: Record<string, BulkGroupChoice>;
  onGroupChoiceChange: (deviceTokenHash: string, choice: BulkGroupChoice) => void;
  ipOnlyChecked: boolean;
  onIpOnlyToggle: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Wayfinder #571 — bulk grouping preview panel. Shown below the bulk-action
 * bar once a multi-select of security logs has been grouped by
 * device_token_hash. Each device group gets an explicit Block Device /
 * Block IP / Skip choice (never a silent blanket IP block across a
 * selection that might span unrelated devices sharing a CGNAT IP); logs
 * with no device link at all get a single Block IP checkbox.
 *
 * Extracted out of page.tsx as a pure, prop-driven component so the
 * grouping UI can be reasoned about and tested independently of the rest
 * of the monitoring page's state.
 */
export function BulkBlockPreviewPanel({
  preview,
  groupChoices,
  onGroupChoiceChange,
  ipOnlyChecked,
  onIpOnlyToggle,
  onConfirm,
  onCancel,
}: BulkBlockPreviewPanelProps) {
  return (
    <div
      data-testid="bulk-block-preview-panel"
      className="card-body pt-0"
      style={{ borderTop: '1px solid var(--border-color)' }}
    >
      <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        Preview grouped blocks:
      </div>
      <div className="space-y-2 mb-3">
        {preview.device_groups.map(group => {
          const choice = groupChoices[group.device_token_hash] ?? 'device';
          return (
            <div
              key={group.device_token_hash}
              data-testid="bulk-preview-device-group"
              className="flex flex-wrap items-center gap-3 text-xs"
            >
              <span className="font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                {group.device_token_hash.slice(0, 12)}…
              </span>
              <span style={{ color: 'var(--text-muted)' }}>
                ({group.log_ids.length} {group.log_ids.length === 1 ? 'log' : 'logs'})
              </span>
              <div
                className="flex items-center gap-3"
                role="radiogroup"
                aria-label={`Block choice for device ${group.device_token_hash}`}
              >
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name={`bulk-group-choice-${group.device_token_hash}`}
                    checked={choice === 'device'}
                    onChange={() => onGroupChoiceChange(group.device_token_hash, 'device')}
                  />
                  Block Device
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name={`bulk-group-choice-${group.device_token_hash}`}
                    checked={choice === 'ip'}
                    onChange={() => onGroupChoiceChange(group.device_token_hash, 'ip')}
                  />
                  Block IP
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name={`bulk-group-choice-${group.device_token_hash}`}
                    checked={choice === 'skip'}
                    onChange={() => onGroupChoiceChange(group.device_token_hash, 'skip')}
                  />
                  Skip
                </label>
              </div>
            </div>
          );
        })}
        {preview.ip_only_log_ids.length > 0 && (
          <label
            data-testid="bulk-preview-ip-group"
            className="flex items-center gap-2 text-xs cursor-pointer"
          >
            <input type="checkbox" checked={ipOnlyChecked} onChange={onIpOnlyToggle} />
            <span style={{ color: 'var(--text-muted)' }}>
              IP-only ({preview.ip_only_log_ids.length}{' '}
              {preview.ip_only_log_ids.length === 1 ? 'log' : 'logs'}, no device link) — Block source IP(s)
            </span>
          </label>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onConfirm}
          className="px-3 py-1.5 text-xs font-semibold rounded-md transition-colors"
          style={{ backgroundColor: 'var(--bfp-maroon)', color: '#ffffff' }}
        >
          Confirm Blocks
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors"
          style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
