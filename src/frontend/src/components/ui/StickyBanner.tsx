"use client";

import type { ReactNode } from "react";

type BannerTone = "blue" | "green" | "amber";

interface StickyBannerProps {
  tone: BannerTone;
  children: ReactNode;
  action?: ReactNode;
}

const TONE_STYLES: Record<BannerTone, { border: string; bg: string; text: string }> = {
  blue:  { border: "border-blue-200",  bg: "bg-blue-50",  text: "text-blue-800" },
  green: { border: "border-green-200", bg: "bg-green-50", text: "text-green-800" },
  amber: { border: "border-amber-200", bg: "bg-amber-50", text: "text-amber-800" },
};

/**
 * Sticky notification banner pinned to the top of the dashboard.
 * Used for new-incident alerts, sync notifications, and stale-cache warnings.
 */
export function StickyBanner({ tone, children, action }: StickyBannerProps) {
  const s = TONE_STYLES[tone];
  return (
    <div className="sticky top-0 z-40">
      <div
        className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm shadow-md ${s.border} ${s.bg} ${s.text}`}
      >
        <span>{children}</span>
        {action}
      </div>
    </div>
  );
}
