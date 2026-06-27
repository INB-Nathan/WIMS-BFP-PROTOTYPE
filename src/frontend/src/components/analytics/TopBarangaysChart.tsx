'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import type { TopBarangayItem } from '@/lib/api';

const BFP_RED = '#1A3263';
const BFP_RED_LIGHT = '#547792';

export interface TopBarangaysChartProps {
  data: TopBarangayItem[];
}

export function TopBarangaysChart({ data }: TopBarangaysChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-md border border-gray-200 bg-gray-50" style={{ minHeight: 220 }}>
        <p className="text-sm font-medium text-gray-500">No barangay data.</p>
      </div>
    );
  }

  // Truncate long barangay names for readability
  const formatted = data.map((d) => ({
    ...d,
    barangay: d.barangay.length > 18 ? d.barangay.slice(0, 16) + 'â€¦' : d.barangay,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        data={formatted}
        layout="vertical"
        margin={{ left: 8, right: 8, top: 4, bottom: 4 }}
      >
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis
          type="category"
          dataKey="barangay"
          tick={{ fontSize: 11, width: 100 }}
          width={100}
        />
        <Tooltip
          formatter={(value) => [Number(value ?? 0), 'Incidents']}
          cursor={{ fill: 'rgba(26, 50, 99,0.06)' }}
          contentStyle={{ fontSize: 12, borderRadius: 4, border: '1px solid #d8dbe0' }}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={28}>
          {formatted.map((_, index) => (
            <Cell
              key={`bar-${index}`}
              fill={index === 0 ? BFP_RED : BFP_RED_LIGHT}
              fillOpacity={1 - index * 0.07}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

