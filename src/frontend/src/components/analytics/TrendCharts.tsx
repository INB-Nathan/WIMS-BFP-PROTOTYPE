'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { TrendsResponse } from '@/lib/api';

export interface TrendChartsProps {
  data: TrendsResponse;
}

function formatBucket(bucket: string | null, interval: string = 'daily'): string {
  if (!bucket) return '—';
  try {
    const d = new Date(bucket);
    if (interval === 'monthly') {
      return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    }
    if (interval === 'weekly') {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

  const formatted = buckets.map((b) => ({
    ...b,
    label: formatBucket(b.bucket),
    count: b.count,
  }));

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Incidents by period</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={formatted} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#6b7280' }}
            tickLine={false}
            axisLine={{ stroke: '#d1d5db' }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#6b7280' }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            formatter={(value) => [`${value} incident${Number(value) !== 1 ? 's' : ''}`, 'Count']}
            labelFormatter={(label) => `Period: ${label}`}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="#1A3263"
            strokeWidth={2}
            dot={{ r: 3, fill: '#1A3263', strokeWidth: 0 }}
            activeDot={{ r: 5, fill: '#142849', strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}