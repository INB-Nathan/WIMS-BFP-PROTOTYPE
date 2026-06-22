import { StickyBanner } from './StickyBanner';

interface StaleCacheBannerProps {
  /**
   * Cache freshness. The banner renders only when `cachedAt` is provided;
   * an undefined or null `cachedAt` is treated as "no cache yet" and the
   * banner renders nothing. This contract lets a parent pass an undefined
   * `cachedAt` (e.g. an empty filter result) without the banner silently
   * appearing with no data.
   *
   * Issue #19: previously the `cachedAt == null` short-circuit was
   * undocumented. The JSDoc + the pinned sync-guard test make the
   * "render null when no cache" contract explicit.
   */
  freshness?: { cachedAt?: number; isOnline: boolean };
  /**
   * Optional message override. Defaults to
   * "Showing cached data — reconnect to refresh.".
   * Note: the displayed string is always suffixed with the cache time.
   */
  message?: string;
}

export function StaleCacheBanner({ freshness, message }: StaleCacheBannerProps) {
  if (freshness?.cachedAt == null) return null;

  const time = new Date(freshness.cachedAt).toLocaleTimeString();
  const bannerMessage =
    (message ?? 'Showing cached data — reconnect to refresh.') + ` from ${time}`;

  return <StickyBanner tone="amber">{bannerMessage}</StickyBanner>;
}
