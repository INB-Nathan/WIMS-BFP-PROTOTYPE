/**
 * Shared date and display helpers used by both the Encoder and Validator dashboards.
 */

export function formatIncidentDate(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  const month = d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short' });
  const day = d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', day: 'numeric' });
  const time = d.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `${month} ${day} • ${time}`;
}

export function manilaTodayUtcDate(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  return new Date(Date.UTC(year, month - 1, day));
}

export function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && dateOnly(parsed) === value;
}

export function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

type DateFilterValue = 'today' | 'week' | 'month' | 'year' | 'all' | 'specific';

export function getDateBounds(
  filter: DateFilterValue,
  specificDate: string,
): { date_from?: string; date_to?: string } {
  if (filter === 'all') return {};
  if (filter === 'specific') return specificDate ? { date_from: specificDate, date_to: specificDate } : {};
  const today = manilaTodayUtcDate();
  if (filter === 'today') return { date_from: dateOnly(today), date_to: dateOnly(today) };
  if (filter === 'week') {
    const day = today.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    return {
      date_from: dateOnly(addUtcDays(today, mondayOffset)),
      date_to: dateOnly(addUtcDays(today, mondayOffset + 6)),
    };
  }
  if (filter === 'month') {
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    return { date_from: dateOnly(first), date_to: dateOnly(last) };
  }
  const first = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  const last = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
  return { date_from: dateOnly(first), date_to: dateOnly(last) };
}

export function displayValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

export function categoryCount(
  stats: { by_category?: Array<{ category: string | null; count: number }> } | null,
  aliases: Array<string | null>,
): string {
  const aliasSet = new Set(aliases.map((a) => a?.toUpperCase()));
  const total = stats?.by_category?.reduce(
    (sum, entry) => (aliasSet.has(entry.category?.toUpperCase()) ? sum + entry.count : sum),
    0,
  ) ?? 0;
  return total.toLocaleString();
}

export function statusBorderColor(status: string | null | undefined): string {
  const normalized = (status ?? '').toUpperCase();
  if (normalized === 'VERIFIED') return '#22C55E';
  if (normalized === 'REJECTED') return '#EF4444';
  if (normalized === 'DRAFT') return '#9CA3AF';
  if (normalized === 'PENDING_SYNC') return '#F59E0B';
  if (normalized === 'PENDING' || normalized === 'PENDING_VALIDATION') return '#F59E0B';
  return '#E5E7EB';
}
