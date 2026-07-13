"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, RefreshCw, Zap } from "lucide-react";

interface AutoRefreshToastProps {
  /** Show the "new data incoming" pre-refresh notification. */
  pending?: boolean;
  /** Show the "refreshing in progress" spinner. */
  refreshing?: boolean;
  /** Show the "data refreshed" confirmation briefly after completion. */
  justRefreshed?: boolean;
  /** Override the notification text (defaults per-state). */
  text?: string;
}

type ToastState = "pending" | "refreshing" | "done" | null;

const STATE_STYLES: Record<
  NonNullable<ToastState>,
  { bg: string; border: string; text: string; Icon: React.ElementType; label: string }
> = {
  pending: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-800",
    Icon: Zap,
    label: "New data available — refreshing shortly…",
  },
  refreshing: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-800",
    Icon: RefreshCw,
    label: "Refreshing…",
  },
  done: {
    bg: "bg-green-50",
    border: "border-green-200",
    text: "text-green-800",
    Icon: CheckCircle,
    label: "Data refreshed",
  },
};

/**
 * Non-blocking slide-in toast for event-driven auto-refresh.
 * Cycles through three states: pending → refreshing → done.
 * Positioned fixed at the bottom-right, never blocks user interaction.
 */
export function AutoRefreshToast({
  pending = false,
  refreshing = false,
  justRefreshed = false,
  text,
}: AutoRefreshToastProps) {
  // Derive the current state, preferring active states over done.
  const activeState: ToastState = refreshing
    ? "refreshing"
    : pending
    ? "pending"
    : justRefreshed
    ? "done"
    : null;

  // Keep element mounted during fade-out after state clears.
  const [mounted, setMounted] = useState(false);
  const [displayState, setDisplayState] = useState<ToastState>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (activeState !== null) {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      // Synchronous update is intentional: display content and mount flag must
      // change atomically so the fade-in renders with the correct label.
      // React 18 batches both into one commit.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplayState(activeState);
      setMounted(true);
    } else if (mounted) {
      hideTimer.current = setTimeout(() => {
        setMounted(false);
        setDisplayState(null);
      }, 400);
    }
    return () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    };
  }, [activeState]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted || displayState === null) return null;

  const style = STATE_STYLES[displayState];
  const label = text ?? style.label;
  const isSpinning = displayState === "refreshing";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: "fixed",
        bottom: "1.25rem",
        right: "1.25rem",
        zIndex: 9999,
        transition: "opacity 300ms ease, transform 300ms ease",
        opacity: activeState !== null ? 1 : 0,
        transform: activeState !== null ? "translateY(0)" : "translateY(0.5rem)",
      }}
    >
      <div
        className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium shadow-lg ${style.bg} ${style.border} ${style.text}`}
      >
        <style.Icon
          className={`h-3.5 w-3.5 flex-shrink-0 ${isSpinning ? "animate-spin" : ""}`}
          aria-hidden
        />
        {label}
      </div>
    </div>
  );
}
