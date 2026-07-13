'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Flame, Languages } from 'lucide-react';
import { fetchCommunityHub, type CommunityContentItem, type CommunityHubResponse, type CommunityLanguage } from '@/lib/api/community';

type Props = { initialData: CommunityHubResponse | null; initialError?: string };

const labels: Record<string, string> = {
  SAFETY_ARTICLE: 'Safety guidance',
  ANNOUNCEMENT: 'Announcement',
  EVENT: 'Upcoming event',
};

export function CommunityHubContent({ initialData, initialError }: Props) {
  const [language, setLanguage] = useState<CommunityLanguage>('en');
  const [kind, setKind] = useState('ALL');
  const [data, setData] = useState(initialData);
  const [error, setError] = useState(initialError ?? '');
  const [loading, setLoading] = useState(false);

  const initialLanguage = useRef(true);

  useEffect(() => {
    // The server-provided English response is already available on first render;
    // subsequent language changes (including returning to English) must refresh it.
    if (initialLanguage.current) {
      initialLanguage.current = false;
      return;
    }
    let active = true;
    // Fetching language-specific content is an external synchronization effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError('');
    fetchCommunityHub({ language })
      .then((next) => active && setData(next))
      .catch(() => active && setError('Community safety content is temporarily unavailable.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [language]);

  const items = useMemo(
    () => (data?.items ?? []).filter((item) => kind === 'ALL' || item.content_type === kind),
    [data, kind],
  );
  const urgent = data?.urgent_banner;
  const grouped = (type: string) => items.filter((item) => item.content_type === type && !item.urgent_banner);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6" aria-busy={loading}>
      <header className="mb-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--bfp-maroon)]">Bureau of Fire Protection</p>
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">Community Safety Hub</h1>
        <p className="mt-2 max-w-2xl text-[var(--text-secondary)]">Practical, trusted guidance to help protect your household and community.</p>
      </header>

      <section className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border bg-[var(--card-bg)] p-4" aria-label="Content controls">
        <Languages className="h-5 w-5 text-[var(--bfp-maroon)]" aria-hidden="true" />
        <label htmlFor="community-language" className="text-sm font-semibold">Language</label>
        <select id="community-language" value={language} onChange={(event) => setLanguage(event.target.value as CommunityLanguage)} className="rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--bfp-maroon)]">
          <option value="en">English</option><option value="uk">Українська</option>
        </select>
        <label htmlFor="community-filter" className="ml-0 text-sm font-semibold sm:ml-auto">Show</label>
        <select id="community-filter" value={kind} onChange={(event) => setKind(event.target.value)} className="rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--bfp-maroon)]">
          <option value="ALL">Everything</option><option value="SAFETY_ARTICLE">Safety guidance</option><option value="ANNOUNCEMENT">Announcements</option><option value="EVENT">Events</option>
        </select>
      </section>

      {loading && <p className="mb-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-800" role="status">Loading translated content…</p>}
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}

      {urgent && (kind === 'ALL' || kind === urgent.content_type) && <UrgentBanner item={urgent} />}
      {!loading && !error && items.length === 0 && <p className="rounded-xl border bg-[var(--card-bg)] p-8 text-center text-[var(--text-secondary)]" role="status">No published community content is available right now.</p>}
      {(['SAFETY_ARTICLE', 'ANNOUNCEMENT', 'EVENT'] as const).map((type) => {
        const sectionItems = grouped(type);
        if (!sectionItems.length) return null;
        return <section key={type} className="mt-8" aria-labelledby={`${type}-heading`}><h2 id={`${type}-heading`} className="mb-3 text-xl font-bold text-[var(--text-primary)]">{type === 'SAFETY_ARTICLE' ? 'Safety guidance' : type === 'ANNOUNCEMENT' ? 'Announcements' : 'Upcoming events'}</h2><div className="grid gap-4 sm:grid-cols-2">{sectionItems.map((item) => <ContentCard key={item.content_id} item={item} />)}</div></section>;
      })}
    </main>
  );
}

function UrgentBanner({ item }: { item: CommunityContentItem }) {
  return <aside className="mb-6 rounded-xl border-l-4 border-red-700 bg-red-50 p-5 text-red-950" aria-labelledby="urgent-heading"><div className="flex gap-3"><AlertTriangle className="h-6 w-6 shrink-0 text-red-700" aria-hidden="true" /><div><h2 id="urgent-heading" className="font-bold">Urgent safety notice</h2><p className="mt-1 font-semibold">{item.title}</p><p className="mt-1 text-sm">{item.body}</p></div></div></aside>;
}

function ContentCard({ item }: { item: CommunityContentItem }) {
  return <article className="rounded-xl border bg-[var(--card-bg)] p-5 shadow-sm transition-shadow motion-safe:hover:shadow-md"><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--bfp-maroon)]"><Flame className="h-4 w-4" aria-hidden="true" />{labels[item.content_type] ?? 'Community content'}</div><h3 className="text-lg font-bold text-[var(--text-primary)]">{item.title}</h3><p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-[var(--text-secondary)]">{item.body}</p>{item.language !== 'en' && <p className="mt-3 text-xs text-[var(--text-secondary)]">Translated content</p>}<Link href={`/community/${encodeURIComponent(item.slug)}`} className="mt-4 inline-flex rounded-md font-semibold text-[var(--bfp-maroon)] underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--bfp-maroon)]">Read more<span className="sr-only">: {item.title}</span></Link></article>;
}
