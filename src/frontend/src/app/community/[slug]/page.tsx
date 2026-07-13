import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiRequestError } from '@/lib/api/errors';
import { fetchCommunityContent, type CommunityContentItem } from '@/lib/api/community';

export const metadata: Metadata = { title: 'Community Safety Hub — WIMS-BFP' };

function Detail({ item }: { item: CommunityContentItem }) {
  return <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6"><Link href="/community" className="text-sm font-semibold text-[var(--bfp-maroon)] underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--bfp-maroon)]">← Back to Community Safety Hub</Link><article className="mt-6 rounded-xl border bg-[var(--card-bg)] p-6 sm:p-8"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--bfp-maroon)]">{item.content_type.replaceAll('_', ' ')}</p><h1 className="mt-2 text-3xl font-bold text-[var(--text-primary)]">{item.title}</h1>{item.language !== 'en' && <p className="mt-2 text-xs text-[var(--text-secondary)]">Translated content</p>}<div className="mt-6 whitespace-pre-wrap text-base leading-7 text-[var(--text-primary)]">{item.body}</div></article></main>;
}

export default async function CommunityDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let item: CommunityContentItem;
  try {
    ({ item } = await fetchCommunityContent(slug));
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      notFound();
    }
    return (
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6" role="alert">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Community content unavailable</h1>
        <p className="mt-2 text-[var(--text-secondary)]">
          We could not load this safety content right now. Please try again later.
        </p>
        <Link href="/community" className="mt-4 inline-flex font-semibold text-[var(--bfp-maroon)] underline">
          Return to Community Safety Hub
        </Link>
      </main>
    );
  }
  return <Detail item={item} />;
}
