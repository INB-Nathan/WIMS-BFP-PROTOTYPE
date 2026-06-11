'use client';

export const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  DRAFT:              { bg: '#F3F4F6', text: '#6B7280' },
  PENDING_SYNC:       { bg: '#FEF3C7', text: '#92400E' },
  PENDING:            { bg: '#FEF9C3', text: '#92400E' },
  PENDING_VALIDATION: { bg: '#DBEAFE', text: '#1D4ED8' },
  VERIFIED:           { bg: '#DCFCE7', text: '#15803D' },
  REJECTED:           { bg: '#FEE2E2', text: '#B91C1C' },
  REPLACED:           { bg: '#EDE9FE', text: '#5B21B6' },
};

export const STATUS_LABELS: Record<string, string> = {
  DRAFT:              'Draft',
  PENDING_SYNC:       'Pending Sync',
  PENDING:            'Pending',
  PENDING_VALIDATION: 'Awaiting Validation',
  VERIFIED:           'Verified',
  REJECTED:           'Rejected',
  REPLACED:           'Replaced',
};

interface StatusBadgeProps {
  status: string;
  showLabel?: boolean;
  className?: string;
}

export function StatusBadge({ status, showLabel = true, className = '' }: StatusBadgeProps) {
  const style = STATUS_COLORS[status] ?? { bg: '#F3F4F6', text: '#6B7280' };
  return (
    <span
      className={`inline-flex w-fit max-w-full items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold leading-none whitespace-nowrap ${className}`}
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {showLabel ? (STATUS_LABELS[status] ?? status) : status}
    </span>
  );
}
