'use client';

interface MetricPillProps {
  label: string;
  value: number | null | undefined;
}

export function MetricPill({ label, value }: MetricPillProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-center">
      <div className="text-lg font-bold tabular-nums leading-none" style={{ color: '#7F1D1D' }}>
        {value ?? 0}
      </div>
      <div className="mt-1 text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </div>
    </div>
  );
}
