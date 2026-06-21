import { StickyBanner } from './StickyBanner';

interface StaleCacheBannerProps {
  freshness?: { cachedAt?: number; isOnline: boolean };
  message?: string;
}

export function StaleCacheBanner({ freshness, message }: StaleCacheBannerProps) {
  if (freshness?.cachedAt == null) return null;

  const time = new Date(freshness.cachedAt).toLocaleTimeString();
  const bannerMessage =
    (message ?? 'Showing cached data — reconnect to refresh.') + ` from ${time}`;

  return <StickyBanner tone="amber">{bannerMessage}</StickyBanner>;
}
