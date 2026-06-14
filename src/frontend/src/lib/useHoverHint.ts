"use client";

import { useState, useCallback, useRef, useEffect, type MouseEvent } from "react";

export interface HoverHintState {
  id: number;
  x: number;
  y: number;
}

export interface UseHoverHintReturn {
  hoverHint: HoverHintState | null;
  clearHoverHint: () => void;
  scheduleHoverHint: (id: number, event: MouseEvent<HTMLElement>) => void;
  hideHoverHintOnMove: () => void;
}

/**
 * Hook that manages a "click to view" hover-hint tooltip.
 * Shows after a 2-second hover, hides on move, and cleans up on unmount.
 */
export function useHoverHint(): UseHoverHintReturn {
  const [hoverHint, setHoverHint] = useState<HoverHintState | null>(null);
  const hoverHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoverHint = useCallback(() => {
    if (hoverHintTimer.current) {
      clearTimeout(hoverHintTimer.current);
      hoverHintTimer.current = null;
    }
    setHoverHint(null);
  }, []);

  const scheduleHoverHint = useCallback(
    (id: number, event: MouseEvent<HTMLElement>) => {
      if (hoverHintTimer.current) clearTimeout(hoverHintTimer.current);
      const { clientX, clientY } = event;
      hoverHintTimer.current = setTimeout(() => {
        setHoverHint({ id, x: clientX, y: clientY });
        hoverHintTimer.current = null;
      }, 2000);
    },
    [],
  );

  const hideHoverHintOnMove = useCallback(() => {
    if (hoverHintTimer.current) {
      clearTimeout(hoverHintTimer.current);
      hoverHintTimer.current = null;
    }
    if (hoverHint) setHoverHint(null);
  }, [hoverHint]);

  useEffect(() => {
    return () => {
      if (hoverHintTimer.current) clearTimeout(hoverHintTimer.current);
    };
  }, []);

  return { hoverHint, clearHoverHint, scheduleHoverHint, hideHoverHintOnMove };
}
