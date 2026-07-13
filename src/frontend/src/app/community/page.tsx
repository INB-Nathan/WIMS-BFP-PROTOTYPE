import type { Metadata } from 'next';
import { fetchCommunityHub } from '@/lib/api/community';
import { CommunityHubContent } from '@/components/community/CommunityHubContent';

export const metadata: Metadata = {
  title: 'Community Safety Hub — WIMS-BFP',
  description: 'Public fire safety guidance, announcements, and events from the Bureau of Fire Protection.',
};

export default async function CommunityPage() {
  let data = null;
  let error = '';
  try {
    data = await fetchCommunityHub();
  } catch {
    error = 'Community safety content is temporarily unavailable.';
  }
  return <CommunityHubContent initialData={data} initialError={error} />;
}
