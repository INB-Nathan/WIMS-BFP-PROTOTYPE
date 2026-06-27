'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { getShortRegionName } from '@/lib/ph-regions';
import type { ResponseTimeRegionItem } from '@/lib/api';

export interface ResponseTimeChartProps {
  data: ResponseTimeRegionItem[];
}

export function ResponseTimeChart({ data }: ResponseTimeChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-md border border-gray-200 bg-gray-50" style={{ minHeight: 220 }}>
        <p className="text-sm font-medium text-gray-500">No response time data.</p>
      </div>
    );
  }

  const chartData = data.map((d) => ({
    region: getShortRegionName(d.region_id),
    avg: parseFloat(d.avg_response_time.toFixed(1)),
    min: d.min_response_time,
    max: d.max_response_time,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ left: 4, right: 4, top: 4, bottom: 4 }}>
        <XAxis dataKey="region" tick={{ fontSize: 11 }} />
        <YAxis
          tickFormatter={(v) => `${v}m`}
          tick={{ fontSize: 11 }}
          width={40}
        />
        <Tooltip
          formatter={(value, name) => {
            const label = name === 'avg' ? 'Avg' : name === 'min' ? 'Min' : 'Max';
            return [`${Number(value).toFixed(1)} min`, label];
          }}
          contentStyle={{ fontSize: 12, borderRadius: 4, border: '1px solid #d8dbe0' }}
        />
        <Bar dataKey="avg" fill="#1A3263" radius={[4, 4, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}