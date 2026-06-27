"use client";

interface WildlandTypeStat {
  fire_type: string | null;
  count: number;
}

interface Props {
  wildlandTotal: number;
  byWildlandType: WildlandTypeStat[] | undefined;
}

const WILDLAND_TYPES = [
  { type: 'fire', label: 'Fire', color: '#1A3263' },
  { type: 'agricultural land fire', label: 'Agricultural Fire', color: '#65a30d' },
  { type: 'forest fire', label: 'Forest Fire', color: '#166534' },
  { type: 'grassland fire', label: 'Grassland Fire', color: '#84cc16' },
  { type: 'brush fire', label: 'Brush Fire', color: '#d97706' },
  { type: 'peatland fire', label: 'Peatland Fire', color: '#78350f' },
  { type: 'grazing land fire', label: 'Grazing Land Fire', color: '#a16207' },
  { type: 'mineral land fire', label: 'Mineral Land Fire', color: '#57534e' },
];

export function WildlandFireBreakdown({ wildlandTotal, byWildlandType }: Props) {
  return (
    <section
      className="rounded-2xl overflow-hidden"
      style={{ backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)', border: '1px solid var(--border-color)' }}
      aria-labelledby="wildland-breakdown-heading"
    >
      <div className="flex items-center justify-between px-6 py-5 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div>
          <h2 id="wildland-breakdown-heading" className="font-bold text-[20px]" style={{ color: 'var(--text-primary)' }}>
            Wildland Fire Classifications
          </h2>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Breakdown by wildland fire type
          </p>
        </div>
        <span className="text-2xl font-bold" style={{ color: '#92400E' }}>
          {wildlandTotal.toLocaleString()}
        </span>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {WILDLAND_TYPES.map(({ type, label, color }) => {
            const count = byWildlandType?.find((w) => (w.fire_type ?? '').trim().toLowerCase() === type)?.count ?? 0;
            return (
              <div
                key={type}
                className="flex items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5 transition-shadow hover:shadow-sm"
                style={{ borderLeft: `3px solid ${color}` }}
              >
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white flex-shrink-0"
                  style={{ backgroundColor: color }}
                >
                  {count}
                </div>
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

