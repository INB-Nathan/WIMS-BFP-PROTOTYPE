'use client';

import type { TrendsResponse } from '@/lib/api';

export interface TrendChartsProps {
  data: TrendsResponse;
}

function formatBucket(bucket: string | null): string {
  if (!bucket) return '—';
  try {
    const d = new Date(bucket);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
  } catch {
    return String(bucket);
  }
}

export function TrendCharts({ data }: TrendChartsProps) {
  const buckets = data?.data ?? [];

  if (buckets.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-500"
        style={{ minHeight: 200 }}
      >
        <p className="text-sm font-medium">No trend data to display</p>
      </div>
    );
  }

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  const barWidth = Math.max(20, Math.min(48, 400 / buckets.length));

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Incidents by period</h3>
      <div className="flex flex-wrap items-end gap-2" style={{ minHeight: 120 }}>
        {buckets.map((b, i) => {
          const heightPct = maxCount > 0 ? (b.count / maxCount) * 100 : 0;
          return (
            <div
              key={i}
              className="flex flex-col items-center"
              style={{ width: barWidth }}
            >
              <span className="text-xs font-medium text-gray-600 mb-1">{b.count}</span>
              <div
                className="w-full rounded-t bg-red-600 transition-all"
                style={{
                  height: Math.max(4, heightPct),
                  minHeight: b.count > 0 ? 8 : 0,
                }}
                title={`${formatBucket(b.bucket)}: ${b.count}`}
              />
              <span className="text-[10px] text-gray-500 mt-1 truncate w-full text-center">
                {formatBucket(b.bucket)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
